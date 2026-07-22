"use client";

import * as React from "react";
import {
  Check,
  Database,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { Badge, Button, Input, Select, Textarea, useToast } from "@/components/ui";
import { can } from "@/lib/rbac";
import { useRole } from "@/lib/store";
import { MEMORY_KINDS, type MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

type AgentSpecSummary = {
  id: string;
  name: string;
  status: string;
};

type AgentMemory = {
  id: string;
  specId: string;
  kind: MemoryKind;
  content: string;
  revision: number;
  status: "pending_review" | "approved" | "rejected";
  sourceType: string;
  pinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CandidateIdentifierKind =
  | "candidate_id"
  | "email"
  | "phone"
  | "linkedin"
  | "github"
  | "source_url"
  | "source_external_id"
  | "source_authority_id"
  | "provider_external_id";

type CandidateIdentifier = { kind: CandidateIdentifierKind; value: string };
type CandidateProvenance =
  | { classification: "none" }
  | {
    classification: "exact";
    campaignId: string | null;
    identifiers: CandidateIdentifier[];
  };
type CandidateClassification = "" | CandidateProvenance["classification"];
type MemoryEdit = Partial<Pick<AgentMemory, "kind" | "content" | "pinned">> & {
  candidateProvenance?: CandidateProvenance;
};

type MemoryResponse = {
  ok: boolean;
  code?: string;
  specs?: AgentSpecSummary[];
  memories?: AgentMemory[];
  memory?: AgentMemory;
  nextCursor?: string | null;
  nextSpecCursor?: string | null;
  bounds?: {
    specLimit: number;
    specsTruncated: boolean;
  };
};

const MEMORY_PAGE_LIMIT = 25;
const MAX_CANDIDATE_IDENTIFIERS = 32;
const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CANDIDATE_IDENTIFIER_OPTIONS: ReadonlyArray<{
  value: CandidateIdentifierKind;
  label: string;
}> = [
  { value: "candidate_id", label: "Candidate ID" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn URL" },
  { value: "github", label: "GitHub URL" },
  { value: "source_url", label: "Source URL" },
  { value: "source_external_id", label: "Source external ID" },
  { value: "source_authority_id", label: "Source authority ID" },
  { value: "provider_external_id", label: "Provider external ID" },
];

const KIND_TONE: Record<MemoryKind, "electric" | "warning" | "violet" | "aqua"> = {
  fact: "electric",
  preference: "warning",
  instruction: "violet",
  episodic: "aqua",
};

const STATUS_TONE: Record<AgentMemory["status"], "warning" | "success" | "neutral"> = {
  pending_review: "warning",
  approved: "success",
  rejected: "neutral",
};

function statusLabel(status: AgentMemory["status"]): string {
  return status === "pending_review" ? "Pending review" : status[0].toUpperCase() + status.slice(1);
}

function apiErrorMessage(code?: string): string {
  if (code === "invalid_request") return "Memory content or its candidate classification is invalid.";
  if (code === "revision_conflict") return "This memory changed in another session. The current version has been reloaded.";
  if (code === "memory_in_use") return "An active agent run is using this memory. Try again after the run finishes.";
  if (code === "invalid_state") return "This memory is no longer waiting for review.";
  if (code === "insufficient_permissions") return "Your role cannot manage agent memory.";
  if (code === "memory_not_found") return "This memory or agent is no longer available.";
  if (code === "rate_limited") return "Too many memory changes were requested. Wait briefly, then try again.";
  if (code === "cross_origin_request") return "The memory request was blocked by the application security policy. Reload and try again.";
  if (code === "candidate_provenance_blocked") return "This candidate identity was erased and cannot be written back into agent memory.";
  return "Agent memory is unavailable. No change was saved.";
}

function candidateProvenancePayload(
  classification: CandidateClassification,
  campaignId: string,
  identifiers: CandidateIdentifier[],
): CandidateProvenance | null {
  if (classification === "none") return { classification: "none" };
  if (classification !== "exact" || identifiers.length < 1) return null;
  const normalizedCampaignId = campaignId.trim();
  if (normalizedCampaignId && !CAMPAIGN_ID_PATTERN.test(normalizedCampaignId)) return null;
  const normalizedIdentifiers = identifiers.map((identifier) => ({
    kind: identifier.kind,
    value: identifier.value.trim(),
  }));
  if (normalizedIdentifiers.some((identifier) => (
    !identifier.value
    || new TextEncoder().encode(identifier.value).byteLength > 2048
  ))) return null;
  return {
    classification: "exact",
    campaignId: normalizedCampaignId || null,
    identifiers: normalizedIdentifiers,
  };
}

function useCandidateProvenanceDraft() {
  const [classification, setClassification] = React.useState<CandidateClassification>("");
  const [campaignId, setCampaignId] = React.useState("");
  const [identifiers, setIdentifiers] = React.useState<CandidateIdentifier[]>([]);
  const reset = React.useCallback(() => {
    setClassification("");
    setCampaignId("");
    setIdentifiers([]);
  }, []);
  const selectClassification = React.useCallback((next: CandidateClassification) => {
    setClassification(next);
    setCampaignId("");
    setIdentifiers(next === "exact" ? [{ kind: "candidate_id", value: "" }] : []);
  }, []);
  return {
    classification,
    campaignId,
    identifiers,
    setCampaignId,
    setIdentifiers,
    selectClassification,
    reset,
    payload: candidateProvenancePayload(classification, campaignId, identifiers),
  };
}

function CandidateProvenanceFields({
  draft,
  disabled,
}: {
  draft: ReturnType<typeof useCandidateProvenanceDraft>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-violet/10 bg-surface/50 p-3">
      <p className="text-xs font-semibold text-ink-soft">Candidate identity classification</p>
      <Select
        aria-label="Candidate reference classification"
        value={draft.classification}
        disabled={disabled}
        onChange={(event) => draft.selectClassification(event.target.value as CandidateClassification)}
      >
        <option value="" disabled>Choose candidate scope</option>
        <option value="none">I confirm: no candidate identity is present</option>
        <option value="exact">References specific candidate aliases</option>
      </Select>
      {draft.classification === "exact" && (
        <div className="space-y-2">
          <Input
            aria-label="Candidate campaign ID"
            placeholder="Campaign ID (optional)"
            maxLength={120}
            autoComplete="off"
            value={draft.campaignId}
            disabled={disabled}
            onChange={(event) => draft.setCampaignId(event.target.value)}
          />
          {draft.identifiers.map((identifier, index) => (
            <div key={index} className="grid grid-cols-[minmax(9rem,0.4fr)_1fr_auto] gap-2">
              <Select
                aria-label={`Candidate identifier kind ${index + 1}`}
                value={identifier.kind}
                disabled={disabled}
                onChange={(event) => draft.setIdentifiers((current) => current.map((item, itemIndex) => (
                  itemIndex === index
                    ? { ...item, kind: event.target.value as CandidateIdentifierKind }
                    : item
                )))}
              >
                {CANDIDATE_IDENTIFIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <Input
                aria-label={`Candidate identifier value ${index + 1}`}
                placeholder="Exact alias"
                maxLength={2048}
                autoComplete="off"
                value={identifier.value}
                disabled={disabled}
                onChange={(event) => draft.setIdentifiers((current) => current.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, value: event.target.value } : item
                )))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove candidate identifier ${index + 1}`}
                disabled={disabled || draft.identifiers.length === 1}
                onClick={() => draft.setIdentifiers((current) => (
                  current.filter((_, itemIndex) => itemIndex !== index)
                ))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || draft.identifiers.length >= MAX_CANDIDATE_IDENTIFIERS}
            onClick={() => draft.setIdentifiers((current) => [
              ...current,
              { kind: "candidate_id", value: "" },
            ])}
          >
            Add candidate alias
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">
        Choose explicitly. Candidate-bound memories require every exact alias; otherwise the save is blocked.
      </p>
    </div>
  );
}

function AddEntryForm({
  specId,
  busy,
  onCancel,
  onCreate,
}: {
  specId: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (body: {
    specId: string;
    kind: MemoryKind;
    content: string;
    candidateProvenance: CandidateProvenance;
  }) => Promise<boolean>;
}) {
  const [kind, setKind] = React.useState<MemoryKind>("fact");
  const [content, setContent] = React.useState("");
  const provenance = useCandidateProvenanceDraft();

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || !provenance.payload || busy) return;
    if (await onCreate({
      specId,
      kind,
      content: trimmed,
      candidateProvenance: provenance.payload,
    })) {
      setContent("");
      provenance.reset();
    }
  }

  return (
    <div className="rounded-2xl border border-violet/20 bg-canvas/60 p-3 space-y-2">
      <div className="flex gap-2">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as MemoryKind)}
          className="w-36 shrink-0"
          aria-label="Memory kind"
        >
          {MEMORY_KINDS.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </Select>
        <Textarea
          rows={3}
          maxLength={8192}
          placeholder="Add a reviewed fact, preference, instruction, or experience"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
          className="flex-1 resize-none"
        />
      </div>
      <CandidateProvenanceFields draft={provenance} disabled={busy} />
      <p className="text-xs text-muted">
        New and edited entries stay pending until you explicitly approve them.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" disabled={busy || !content.trim() || !provenance.payload} onClick={() => void submit()}>
          Save for review
        </Button>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  canEdit,
  busy,
  onEdit,
  onReview,
  onDelete,
}: {
  entry: AgentMemory;
  canEdit: boolean;
  busy: boolean;
  onEdit: (entry: AgentMemory, update: MemoryEdit) => Promise<boolean>;
  onReview: (entry: AgentMemory, action: "approve" | "reject") => Promise<void>;
  onDelete: (entry: AgentMemory) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(entry.content);
  const [kind, setKind] = React.useState(entry.kind);
  const provenance = useCandidateProvenanceDraft();
  const resetProvenance = provenance.reset;

  React.useEffect(() => {
    setDraft(entry.content);
    setKind(entry.kind);
    resetProvenance();
  }, [entry.content, entry.kind, resetProvenance]);

  async function saveEdit() {
    const content = draft.trim();
    if (!content || !provenance.payload || busy) return;
    if (await onEdit(entry, {
      content,
      kind,
      candidateProvenance: provenance.payload,
    })) setEditing(false);
  }

  return (
    <li className="rounded-2xl border border-violet/10 bg-surface/50 px-3 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <Badge tone={KIND_TONE[entry.kind]} size="sm" className="mt-0.5 shrink-0">
          {entry.kind}
        </Badge>
        <Badge tone={STATUS_TONE[entry.status]} size="sm" className="mt-0.5 shrink-0">
          {statusLabel(entry.status)}
        </Badge>

        {editing ? (
          <div className="flex-1 space-y-2">
            <Select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
              {MEMORY_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
            <Textarea
              autoFocus
              rows={3}
              maxLength={8192}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void saveEdit();
                if (event.key === "Escape") setEditing(false);
              }}
              className="resize-none text-sm"
            />
            <CandidateProvenanceFields draft={provenance} disabled={busy} />
            <div className="flex gap-1.5 justify-end">
              <Button variant="ghost" size="icon" aria-label="Cancel edit" onClick={() => {
                setEditing(false);
                provenance.reset();
              }}>
                <X className="h-3.5 w-3.5 text-muted" />
              </Button>
              <Button size="icon" aria-label="Save edit" onClick={() => void saveEdit()} disabled={busy || !draft.trim() || !provenance.payload}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="flex-1 min-w-0 text-sm text-ink leading-snug break-words">{entry.content}</p>
        )}

        {!editing && entry.pinned && (
          <Pin className="h-3.5 w-3.5 text-violet shrink-0 mt-0.5" aria-label="Pinned" />
        )}
      </div>

      {!editing && canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {entry.status === "pending_review" && (
            <>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<ShieldCheck className="h-3.5 w-3.5" />}
                disabled={busy}
                onClick={() => void onReview(entry, "approve")}
              >
                Approve
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onReview(entry, "reject")}>
                Reject
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={entry.pinned ? "Unpin" : "Pin"}
            disabled={busy}
            onClick={() => void onEdit(entry, { pinned: !entry.pinned })}
          >
            {entry.pinned
              ? <PinOff className="h-3.5 w-3.5 text-violet" />
              : <Pin className="h-3.5 w-3.5 text-muted" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit memory"
            disabled={busy}
            onClick={() => {
              provenance.reset();
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete memory"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this memory and replace its stored content with a tombstone?")) {
                void onDelete(entry);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </Button>
        </div>
      )}
    </li>
  );
}

export function MemoryPanel() {
  const canEditMemory = can(useRole(), "skills");
  const { toast } = useToast();
  const [specs, setSpecs] = React.useState<AgentSpecSummary[]>([]);
  const [memories, setMemories] = React.useState<AgentMemory[]>([]);
  const [selectedSpecId, setSelectedSpecId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [loadingSpecs, setLoadingSpecs] = React.useState(true);
  const [loadingMoreSpecs, setLoadingMoreSpecs] = React.useState(false);
  const [loadingMemories, setLoadingMemories] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [bounds, setBounds] = React.useState<MemoryResponse["bounds"]>(undefined);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [nextSpecCursor, setNextSpecCursor] = React.useState<string | null>(null);
  const selectedSpecIdRef = React.useRef<string | null>(null);
  const specRequestSequence = React.useRef(0);
  const memoryRequestSequence = React.useRef(0);

  const selectSpec = React.useCallback((specId: string) => {
    selectedSpecIdRef.current = specId;
    setSelectedSpecId(specId);
  }, []);

  const loadSpecs = React.useCallback(async (
    specCursor: string | null = null,
    append = false,
  ) => {
    const sequence = ++specRequestSequence.current;
    if (append) setLoadingMoreSpecs(true);
    else {
      setLoadingSpecs(true);
      setLoadingMoreSpecs(false);
    }
    try {
      const params = new URLSearchParams();
      if (specCursor) params.set("specCursor", specCursor);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      const response = await fetch(`/api/agents/memories${query}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as MemoryResponse;
      if (
        !response.ok
        || !body.ok
        || !body.specs
        || !body.memories
        || body.memories.length !== 0
        || body.nextCursor !== null
        || (body.nextSpecCursor !== null && typeof body.nextSpecCursor !== "string")
      ) {
        throw new Error(apiErrorMessage(body.code));
      }
      if (sequence !== specRequestSequence.current) return false;
      if (append) {
        setSpecs((current) => {
          const seen = new Set(current.map((spec) => spec.id));
          return [...current, ...body.specs!.filter((spec) => !seen.has(spec.id))];
        });
      } else {
        setSpecs(body.specs);
        const current = selectedSpecIdRef.current;
        const next = current && body.specs.some((spec) => spec.id === current)
          ? current
          : body.specs[0]?.id ?? null;
        selectedSpecIdRef.current = next;
        setSelectedSpecId(next);
      }
      setBounds(body.bounds);
      setNextSpecCursor(body.nextSpecCursor);
      setError(null);
      return true;
    } catch (caught) {
      if (sequence !== specRequestSequence.current) return false;
      if (!append) {
        setSpecs([]);
        setMemories([]);
        selectedSpecIdRef.current = null;
        setSelectedSpecId(null);
        setBounds(undefined);
        setNextCursor(null);
        setNextSpecCursor(null);
      }
      setError(caught instanceof Error ? caught.message : apiErrorMessage());
      return false;
    } finally {
      if (sequence === specRequestSequence.current) {
        if (append) setLoadingMoreSpecs(false);
        else setLoadingSpecs(false);
      }
    }
  }, []);

  const loadMemories = React.useCallback(async (
    specId: string,
    cursor: string | null = null,
    append = false,
  ) => {
    const sequence = ++memoryRequestSequence.current;
    if (append) setLoadingMore(true);
    else {
      setLoadingMemories(true);
      setLoadingMore(false);
      setMemories([]);
      setNextCursor(null);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      params.set("specId", specId);
      params.set("limit", String(MEMORY_PAGE_LIMIT));
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/agents/memories?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as MemoryResponse;
      if (
        !response.ok
        || !body.ok
        || !body.specs
        || body.specs.length !== 1
        || body.specs[0]?.id !== specId
        || !body.memories
        || body.memories.some((memory) => memory.specId !== specId)
        || (body.nextCursor !== null && typeof body.nextCursor !== "string")
      ) {
        throw new Error(apiErrorMessage(body.code));
      }
      if (sequence !== memoryRequestSequence.current) return false;
      if (append) {
        setMemories((current) => {
          const seen = new Set(current.map((memory) => memory.id));
          return [...current, ...body.memories!.filter((memory) => !seen.has(memory.id))];
        });
      } else {
        setMemories(body.memories);
      }
      setNextCursor(body.nextCursor);
      setError(null);
      return true;
    } catch (caught) {
      if (sequence !== memoryRequestSequence.current) return false;
      if (!append) {
        setMemories([]);
        setNextCursor(null);
      }
      setError(caught instanceof Error ? caught.message : apiErrorMessage());
      return false;
    } finally {
      if (sequence === memoryRequestSequence.current) {
        if (append) setLoadingMore(false);
        else setLoadingMemories(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void loadSpecs();
  }, [loadSpecs]);

  React.useEffect(() => {
    selectedSpecIdRef.current = selectedSpecId;
  }, [selectedSpecId]);

  React.useEffect(() => {
    setAdding(false);
    if (selectedSpecId) {
      void loadMemories(selectedSpecId);
      return;
    }
    memoryRequestSequence.current += 1;
    setMemories([]);
    setNextCursor(null);
    setLoadingMemories(false);
    setLoadingMore(false);
  }, [loadMemories, selectedSpecId]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", body: object, successTitle: string) {
    const mutationSpecId = "specId" in body && typeof body.specId === "string"
      ? body.specId
      : null;
    const reloadMutationSpecIfSelected = async () => {
      if (mutationSpecId && selectedSpecIdRef.current === mutationSpecId) {
        await loadMemories(mutationSpecId);
      }
    };
    setBusy(true);
    try {
      const response = await fetch("/api/agents/memories", {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as MemoryResponse;
      if (!response.ok || !result.ok) {
        toast({ title: apiErrorMessage(result.code), variant: "error" });
        if (
          result.code === "revision_conflict"
          || result.code === "invalid_state"
        ) await reloadMutationSpecIfSelected();
        return false;
      }
      await reloadMutationSpecIfSelected();
      toast({ title: successTitle, variant: "success" });
      return true;
    } catch {
      toast({ title: apiErrorMessage(), variant: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectedSpec = specs.find((spec) => spec.id === selectedSpecId) ?? null;
  const visibleMemories = memories;
  const pinned = visibleMemories.filter((memory) => memory.pinned);
  const byKind = MEMORY_KINDS.map((kind) => ({
    kind,
    items: visibleMemories.filter((memory) => !memory.pinned && memory.kind === kind),
  })).filter((group) => group.items.length > 0);
  const loading = loadingSpecs || loadingMemories;

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[440px] overflow-hidden rounded-3xl border border-violet/10 bg-surface/60 backdrop-blur shadow-soft">
      <div className="w-60 shrink-0 border-r border-violet/10 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-violet/10">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">AgentSpecs</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {specs.map((spec) => {
            const selected = selectedSpecId === spec.id;
            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => selectSpec(spec.id)}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm transition-colors",
                  selectedSpecId === spec.id ? "bg-violet/10 text-violet font-semibold" : "text-ink-soft hover:bg-surface/80",
                )}
              >
                <span className="block truncate">{spec.name}</span>
                <span className="text-xs text-muted">
                  {selected ? `${memories.length} loaded · ` : ""}{spec.status}
                </span>
              </button>
            );
          })}
          {nextSpecCursor && (
            <div className="p-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={loadingMoreSpecs || loadingSpecs}
                onClick={() => void loadSpecs(nextSpecCursor, true)}
              >
                Load more agents
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-violet/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink truncate">
              {selectedSpec?.name ?? "Agent memory"}
            </p>
            <p className="text-xs text-muted">
              {visibleMemories.length} loaded entries · each run receives at most 8 approved entries and 8 KiB
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reload agent memory"
              disabled={loading || busy}
              onClick={() => {
                void loadSpecs();
                if (selectedSpecId) void loadMemories(selectedSpecId);
              }}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            {selectedSpecId && canEditMemory && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setAdding(true)}
                disabled={busy || selectedSpec?.status === "archived"}
              >
                Add
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {bounds?.specsTruncated && (
            <div role="status" className="rounded-2xl border border-warning/20 bg-warning/5 p-3 text-xs text-ink-soft">
              AgentSpecs load in pages of {bounds.specLimit}. Load more agents to reach the next owned page.
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-2xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
              {error}
            </div>
          )}

          {adding && selectedSpecId && canEditMemory && (
            <AddEntryForm
              specId={selectedSpecId}
              busy={busy}
              onCancel={() => setAdding(false)}
              onCreate={async (body) => {
                const created = await mutate("POST", body, "Memory saved for review");
                if (created) setAdding(false);
                return created;
              }}
            />
          )}

          {!loading && !error && specs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Database className="h-10 w-10 text-muted mb-3" />
              <p className="text-sm font-semibold text-ink-soft">No owned AgentSpecs</p>
              <p className="text-xs text-muted mt-1">Create an agent in Agent Studio before adding memory.</p>
            </div>
          )}

          {!loading && !error && specs.length > 0 && visibleMemories.length === 0 && !adding && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Database className="h-10 w-10 text-muted mb-3" />
              <p className="text-sm font-semibold text-ink-soft">No normalized memories yet</p>
              <p className="text-xs text-muted mt-1">Select an agent, add an entry, then approve it for use.</p>
            </div>
          )}

          {pinned.length > 0 && (
            <section>
              <p className="text-xs font-bold text-violet uppercase tracking-wider mb-2">Pinned</p>
              <ul className="space-y-2">
                {pinned.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    canEdit={canEditMemory}
                    busy={busy}
                    onEdit={(current, update) => mutate("PATCH", {
                      action: "edit", id: current.id, specId: current.specId,
                      revision: current.revision, ...update,
                    }, update.content !== undefined || update.kind !== undefined
                      ? "Memory updated and queued for review"
                      : "Memory pin updated")}
                    onReview={async (current, action) => { await mutate("PATCH", {
                      action, id: current.id, specId: current.specId, revision: current.revision,
                    }, action === "approve" ? "Memory approved" : "Memory rejected"); }}
                    onDelete={async (current) => { await mutate("DELETE", {
                      id: current.id, specId: current.specId, revision: current.revision,
                    }, "Memory deleted"); }}
                  />
                ))}
              </ul>
            </section>
          )}

          {byKind.map(({ kind, items }) => (
            <section key={kind}>
              <p className="text-xs font-bold text-ink-soft uppercase tracking-wider mb-2">{kind}</p>
              <ul className="space-y-2">
                {items.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    canEdit={canEditMemory}
                    busy={busy}
                    onEdit={(current, update) => mutate("PATCH", {
                      action: "edit", id: current.id, specId: current.specId,
                      revision: current.revision, ...update,
                    }, update.content !== undefined || update.kind !== undefined
                      ? "Memory updated and queued for review"
                      : "Memory pin updated")}
                    onReview={async (current, action) => { await mutate("PATCH", {
                      action, id: current.id, specId: current.specId, revision: current.revision,
                    }, action === "approve" ? "Memory approved" : "Memory rejected"); }}
                    onDelete={async (current) => { await mutate("DELETE", {
                      id: current.id, specId: current.specId, revision: current.revision,
                    }, "Memory deleted"); }}
                  />
                ))}
              </ul>
            </section>
          ))}

          {nextCursor && selectedSpecId && (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loadingMore || loadingMemories || busy}
                onClick={() => void loadMemories(selectedSpecId, nextCursor, true)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
