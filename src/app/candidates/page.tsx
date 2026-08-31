"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Eyebrow,
  Field,
  Input,
  Progress,
  Select,
  SkeletonCard,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { CandidateTable } from "@/components/candidates/candidate-table";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { SourcingFeed } from "@/components/tania/sourcing-feed";
import { useActions, useActiveCampaign, useCandidates, useHydrated, useIntegrations } from "@/lib/store";
import {
  emptyPeopleFirstShortlistError,
  peoplePluginFailLoudUi,
} from "@/lib/sourcing/people-plugins";
import { corpusServerReadEnabled } from "@/lib/supabase/config";
import { CANDIDATE_STAGES, SOURCE_PLATFORMS, type Candidate, type CandidateStage } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { Bookmark, Radar, Search, Sparkles } from "lucide-react";

/** Small batches so a bulk draft over dozens of candidates never blocks the
 *  main thread — each batch commits synchronously (generateOutreachFor is
 *  synchronous), then we yield one tick before the next so the Progress meter
 *  actually paints and the rest of the UI stays responsive. */
const DRAFT_BATCH_SIZE = 5;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SORT_OPTIONS = [
  { value: "match", label: "Match score" },
  { value: "recent", label: "Most recent" },
];

/** Manual, human-decided forward-progression stages — mirrors the same set the
 *  candidate drawer's Interview stage panel exposes, so bulk moves can't reach
 *  a stage that's normally only driven by outreach/reply automation. */
const BULK_STAGE_OPTIONS: { value: CandidateStage; label: string }[] = [
  { value: "Interviewed", label: "Interviewed" },
  { value: "Offer", label: "Offer" },
  { value: "Hired", label: "Hired" },
  { value: "Rejected", label: "Rejected" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "25", label: "25 / page" },
  { value: "50", label: "50 / page" },
  { value: "100", label: "100 / page" },
];
const DEFAULT_PAGE_SIZE = 50;

type CandidateSort = "match" | "recent";

interface ServerCandidatesState {
  candidates: Candidate[];
  total: number;
  loading: boolean;
}

function isCandidateArray(value: unknown): value is Candidate[] {
  return Array.isArray(value);
}

function useServerCandidates({
  enabled,
  query,
  sort,
  stage,
  source,
  limit,
  offset,
}: {
  enabled: boolean;
  query: string;
  sort: CandidateSort;
  stage: string;
  source: string;
  limit: number;
  offset: number;
}): ServerCandidatesState {
  const [state, setState] = React.useState<ServerCandidatesState>({
    candidates: [],
    total: 0,
    loading: false,
  });

  React.useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    const trimmed = query.trim();
    if (trimmed) params.set("search", trimmed);
    if (stage !== "all") params.set("stage", stage);
    if (source !== "all") params.set("source", source);
    params.set("sort", sort);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    setState((prev) => ({ ...prev, loading: true }));
    fetch(`/api/candidates?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        if (!res.ok || typeof json !== "object" || json === null) {
          throw new Error("Candidate corpus read failed.");
        }
        const body = json as { candidates?: unknown; total?: unknown };
        setState({
          candidates: isCandidateArray(body.candidates) ? body.candidates : [],
          total: typeof body.total === "number" ? body.total : 0,
          loading: false,
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ candidates: [], total: 0, loading: false });
      });
    return () => ctrl.abort();
  }, [enabled, query, sort, stage, source, limit, offset]);

  return state;
}

function lastActivityIso(c: Candidate): number {
  return new Date(c.lastContactedAt ?? c.createdAt).getTime();
}

/** Reads `?focus=<id>` to auto-open a drawer. Must live under a Suspense boundary. */
function CandidatesView() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const actions = useActions();
  const activeCampaign = useActiveCampaign();
  const integrations = useIntegrations();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const serverPreview = corpusServerReadEnabled;

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<CandidateSort>("match");
  const [stage, setStage] = React.useState("all");
  const [source, setSource] = React.useState("all");
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = React.useState<CandidateStage | "">("");
  const [bulkReason, setBulkReason] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [sourcing, setSourcing] = React.useState(false);
  const [draftingOutreach, setDraftingOutreach] = React.useState(false);
  const [draftProgress, setDraftProgress] = React.useState({ done: 0, total: 0 });
  // The just-sourced batch, staged for the streaming reveal below — purely a
  // display buffer; `sourceNextBatch` already committed these candidates for
  // real. `sourceBatchKey` remounts <SourcingFeed> on every new batch (even
  // one of the same size as the last) so the reveal always replays.
  const [justSourced, setJustSourced] = React.useState<Candidate[]>([]);
  const [sourceBatchKey, setSourceBatchKey] = React.useState(0);

  const handledFocus = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!hydrated || !focus) return;
    if (handledFocus.current === focus) return;
    const found = candidates.find((c) => c.id === focus);
    if (found) {
      setSelected(found);
      setDrawerOpen(true);
      handledFocus.current = focus;
    }
  }, [hydrated, focus, candidates]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = candidates.filter((c) => {
      if (stage !== "all" && c.stage !== stage) return false;
      if (source !== "all" && c.sourcePlatform !== source) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.currentTitle.toLowerCase().includes(q) ||
        c.currentCompany.toLowerCase().includes(q)
      );
    });
    result.sort((a, b) =>
      sort === "match" ? b.matchScore - a.matchScore : lastActivityIso(b) - lastActivityIso(a),
    );
    return result;
  }, [candidates, query, stage, source, sort]);

  // Reset to page 1 whenever the result set could reshuffle out from under the
  // current page (filter/sort change or a bigger page size) — never leave the
  // user staring at a page that's now past the end.
  React.useEffect(() => {
    setPage(0);
  }, [query, stage, source, sort, pageSize]);

  const localTotalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const localClampedPage = Math.min(page, localTotalPages - 1);
  const serverCandidates = useServerCandidates({
    enabled: hydrated && serverPreview,
    query,
    sort,
    stage,
    source,
    limit: pageSize,
    offset: page * pageSize,
  });
  const totalPages = serverPreview
    ? Math.max(1, Math.ceil(serverCandidates.total / pageSize))
    : localTotalPages;
  const clampedPage = Math.min(page, totalPages - 1);
  const paged = React.useMemo(
    () =>
      serverPreview
        ? serverCandidates.candidates
        : filtered.slice(localClampedPage * pageSize, localClampedPage * pageSize + pageSize),
    [filtered, localClampedPage, pageSize, serverPreview, serverCandidates.candidates],
  );

  React.useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);

  const stageOptions = [
    { value: "all", label: "All stages" },
    ...CANDIDATE_STAGES.map((s) => ({ value: s, label: s })),
  ];
  const sourceOptions = [
    { value: "all", label: "All sources" },
    ...SOURCE_PLATFORMS.map((s) => ({ value: s, label: s })),
  ];

  const hasActiveFilters = query.trim() !== "" || stage !== "all" || source !== "all";

  function clearFilters() {
    setQuery("");
    setStage("all");
    setSource("all");
  }

  // Filtering can drop selected rows out of view (e.g. move a stage filter
  // after selecting); drop stale ids so "N selected" never counts hidden rows.
  const filteredIds = React.useMemo(() => new Set(filtered.map((c) => c.id)), [filtered]);
  const visibleSelectedIds = React.useMemo(
    () => (serverPreview ? new Set<string>() : new Set(Array.from(selectedIds).filter((id) => filteredIds.has(id)))),
    [selectedIds, filteredIds, serverPreview],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selects the current PAGE (standard pagination convention), not every
  // filtered result — selections still persist across pages via selectedIds.
  function toggleSelectAll() {
    if (serverPreview) return;
    const allPageSelected = paged.length > 0 && paged.every((c) => visibleSelectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((c) => (allPageSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkStage("");
    setBulkReason("");
  }

  /** Sources the active campaign's next batch via the SAME unchanged
   *  `sourceNextBatch` action the campaign page and dashboard already use —
   *  then stages the exact, already-committed result for the streaming
   *  reveal below instead of only a toast. */
  async function handleSourceBatch() {
    if (sourcing) return;
    if (!activeCampaign) {
      toast({
        title: "No active campaign",
        description: "Open a campaign (or start a new intake) to source its next batch.",
        variant: "warning",
      });
      return;
    }
    setSourcing(true);
    const res = await actions.sourceNextBatch(activeCampaign.id);
    setSourcing(false);
    if (!res.ok) {
      const failLoud = peoplePluginFailLoudUi(
        res.error,
        activeCampaign.jobAnalysis,
        integrations,
      );
      toast({
        title: failLoud
          ? failLoud.title
          : res.source === "paused"
            ? "Campaign is paused"
            : "Sourcing failed",
        description: failLoud?.description ?? res.error,
        variant: "error",
      });
      return;
    }
    const emptyPeopleFirst = emptyPeopleFirstShortlistError(
      activeCampaign.jobAnalysis,
      integrations,
      res,
    );
    if (emptyPeopleFirst) {
      toast({
        title: "Connect LinkedIn and Apify",
        description: emptyPeopleFirst,
        variant: "error",
      });
      return;
    }
    setJustSourced(res.accepted);
    setSourceBatchKey((k) => k + 1);
    const isLive = res.source === "github" || res.source === "web";
    toast({
      title: `Sourced ${pluralize(res.accepted.length, "candidate")}${isLive ? " (live)" : ""}`,
      description: `${activeCampaign.title} · ${pluralize(res.skipped.length, "candidate")} skipped by dedupe & exclusions.`,
      variant: res.accepted.length > 0 ? "success" : "info",
    });
  }

  /** Bulk stage move — routes every selected candidate through the SAME
   *  setCandidateStage the drawer's per-candidate buttons use (preserves the
   *  maxStageRank high-water mark via withStage), reusing outreach's
   *  commit-loop pattern (handleBulkApprove) for triaging a sourced batch. */
  function handleBulkStageApply() {
    if (!bulkStage) return;
    const ids = Array.from(visibleSelectedIds);
    if (ids.length === 0) return;
    ids.forEach((id) => {
      actions.setCandidateStage(id, bulkStage);
      if (bulkStage === "Rejected" && bulkReason.trim()) {
        actions.setRejectionReason(id, bulkReason.trim());
      }
    });
    toast({
      title: `Moved ${pluralize(ids.length, "candidate")} to ${bulkStage}`,
      variant: bulkStage === "Rejected" ? "warning" : "success",
    });
    clearSelection();
  }

  /** Bulk personalized outreach — drafts one message per selected candidate via
   *  the SAME generateOutreachFor the drawer's "Generate outreach" button and
   *  QuickDraft already use, so every draft gets its own distinct
   *  personalizationEvidence from mock-ai.ts (never a shared/spam template) and
   *  lands in the approval queue exactly like a single draft — never sends.
   *  Runs in small batches, yielding between them so a big selection (dozens+)
   *  never freezes the store while the Progress meter below reports done/total. */
  async function handleBulkDraftOutreach() {
    if (draftingOutreach) return;
    const ids = Array.from(visibleSelectedIds);
    if (ids.length === 0) return;

    setDraftingOutreach(true);
    setDraftProgress({ done: 0, total: ids.length });
    let drafted = 0;
    for (let i = 0; i < ids.length; i += DRAFT_BATCH_SIZE) {
      const batch = ids.slice(i, i + DRAFT_BATCH_SIZE);
      for (const id of batch) {
        if (actions.generateOutreachFor(id)) drafted += 1;
      }
      setDraftProgress({ done: Math.min(i + DRAFT_BATCH_SIZE, ids.length), total: ids.length });
      await nextTick();
    }
    setDraftingOutreach(false);

    const skipped = ids.length - drafted;
    toast({
      title: `Drafted ${pluralize(drafted, "outreach message")}`,
      description:
        skipped > 0
          ? `${pluralize(skipped, "candidate")} skipped (no matching campaign). Each draft carries its own personalization evidence, review it in the outreach queue.`
          : "Each draft carries its own personalization evidence. Review and approve it in the outreach queue; nothing was sent.",
      variant: drafted > 0 ? "success" : "warning",
    });
    clearSelection();
  }

  function handleBulkVivier() {
    const ids = Array.from(visibleSelectedIds).filter(
      (id) => !candidates.find((c) => c.id === id)?.vivier,
    );
    if (ids.length === 0) {
      toast({ title: "Selected candidates are already in #Vivier", variant: "info" });
      return;
    }
    ids.forEach((id) => actions.toggleVivier(id));
    toast({ title: `Added ${pluralize(ids.length, "candidate")} to #Vivier`, variant: "success" });
    clearSelection();
  }

  const tableEmptyState =
    paged.length === 0 && (serverPreview ? serverCandidates.total > 0 : candidates.length > 0) && hasActiveFilters
      ? {
          title: "No candidates match your filters",
          description: "Try a different search term, or reset the filters below.",
          action: (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ),
        }
      : undefined;

  return (
    <HydrationGate
      hydrated={hydrated}
      fallback={
        <div className="space-y-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      }
    >
      <Card className="mb-6">
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="candidate-search">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                id="candidate-search"
                className="pl-10"
                placeholder="Name, title, company"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Sort by" htmlFor="candidate-sort">
            <Select
              id="candidate-sort"
              options={SORT_OPTIONS}
              value={sort}
              onChange={(e) => setSort(e.target.value === "recent" ? "recent" : "match")}
            />
          </Field>
          <Field label="Stage" htmlFor="candidate-stage">
            <Select
              id="candidate-stage"
              options={stageOptions}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            />
          </Field>
          <Field label="Source" htmlFor="candidate-source">
            <Select
              id="candidate-source"
              options={sourceOptions}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">
            {serverPreview ? serverCandidates.total : filtered.length}
          </span>{" "}
          {serverPreview
            ? pluralize(serverCandidates.total, "server candidate")
            : `of ${pluralize(candidates.length, "candidate")} across all campaigns`}
          {serverPreview && serverCandidates.loading ? " (loading)" : ""}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Radar className="h-4 w-4" />}
          onClick={handleSourceBatch}
          loading={sourcing}
          disabled={sourcing}
          title={activeCampaign ? `Source the next batch for ${activeCampaign.title}` : "No active campaign"}
        >
          {sourcing ? "Sourcing…" : "Source next batch"}
        </Button>
      </div>

      {justSourced.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2">
            <Eyebrow>Just sourced</Eyebrow>
            <Badge tone="electric" size="sm">
              {justSourced.length}
            </Badge>
          </div>
          <SourcingFeed
            key={sourceBatchKey}
            candidates={justSourced}
            campaignId={activeCampaign?.id}
          />
        </div>
      )}

      {!serverPreview && visibleSelectedIds.size > 0 && (
        <Card className="mb-4 border-electric/30 bg-electric-soft/40">
          <CardBody className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">
              {pluralize(visibleSelectedIds.size, "candidate")} selected
            </span>
            <Select
              aria-label="Bulk move to stage"
              className="w-48"
              options={[{ value: "", label: "Move to stage…" }, ...BULK_STAGE_OPTIONS]}
              value={bulkStage}
              onChange={(e) => setBulkStage(e.target.value as CandidateStage | "")}
            />
            {bulkStage === "Rejected" && (
              <Input
                aria-label="Shared rejection reason"
                className="w-64"
                placeholder="Shared rejection reason (optional)"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={handleBulkStageApply}
              disabled={!bulkStage || draftingOutreach}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
              onClick={handleBulkVivier}
              disabled={draftingOutreach}
            >
              Add to #Vivier
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
              onClick={handleBulkDraftOutreach}
              loading={draftingOutreach}
              disabled={draftingOutreach}
            >
              {draftingOutreach
                ? `Drafting ${draftProgress.done}/${draftProgress.total}…`
                : "Draft personalized outreach for selected"}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection} disabled={draftingOutreach}>
              Clear selection
            </Button>
            {draftingOutreach && (
              <div className="w-full max-w-sm">
                <Progress
                  value={draftProgress.total ? (draftProgress.done / draftProgress.total) * 100 : 0}
                  tone="electric"
                  aria-label={`Drafting personalized outreach: ${draftProgress.done} of ${draftProgress.total}`}
                />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <CardBody>
          <CandidateTable
            candidates={paged}
            showCampaign
            emptyState={tableEmptyState}
            selectedIds={serverPreview ? undefined : visibleSelectedIds}
            onToggleSelect={serverPreview ? undefined : toggleSelect}
            onToggleSelectAll={serverPreview ? undefined : toggleSelectAll}
            onSelect={(c) => {
              const candidate = serverPreview ? candidates.find((local) => local.id === c.id) : c;
              if (!candidate) {
                toast({
                  title: "Candidate not yet synced locally — refresh to open",
                  variant: "warning",
                });
                return;
              }
              setSelected(candidate);
              setDrawerOpen(true);
            }}
          />
        </CardBody>
      </Card>

      {(serverPreview ? serverCandidates.total : filtered.length) > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Select
            aria-label="Rows per page"
            className="w-36"
            options={PAGE_SIZE_OPTIONS}
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted tabular-nums">
              Page {clampedPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <CandidateDrawer candidate={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </HydrationGate>
  );
}

export default function CandidatesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Talent pool"
        title="Candidates"
        description="Every sourced candidate, ranked by fit across all campaigns. Filter, sort, and open a profile to score, message, or book."
      />
      <React.Suspense
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        }
      >
        <CandidatesView />
      </React.Suspense>
    </div>
  );
}
