"use client";

/* Agent Studio runs only owner-scoped specs bound to an independently approved
   Flowise workflow. DeerFlow may orchestrate the exact reviewed campaign query;
   the canonical store action remains the only candidate persistence authority. */

import * as React from "react";
import { Bot, ShieldCheck, Wand2 } from "lucide-react";
import {
  Card,
  CardContent,
  Badge,
  Button,
  Field,
  Input,
  EmptyState,
  useToast,
} from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { useActions, useCampaigns } from "@/lib/store";
import {
  acquireStudioRunIdempotencyKey,
  executeStudioAgentRun,
  resolveStudioCampaign,
  settleStudioRunIdempotencyKey,
} from "@/lib/agents/studio-runner";

interface SpecRow {
  id: string;
  name: string;
  role_brief: { title?: string; requiredSkills?: string[] } & Record<string, unknown>;
  channels: string[];
  status: string;
  runtime_eligible: boolean;
  runtime_reason: string | null;
  workflowVersionId: string | null;
  workflowName: string | null;
  workflowSha256: string | null;
}

const SUPPORTED_CHANNELS = ["Email"] as const;

function getStudioSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export default function StudioPage() {
  const { toast } = useToast();
  const actions = useActions();
  const campaigns = useCampaigns();
  const [loading, setLoading] = React.useState(true);
  const [availability, setAvailability] = React.useState<"loading" | "ready" | "unavailable">("loading");
  const [demo, setDemo] = React.useState(false);
  const [specs, setSpecs] = React.useState<SpecRow[]>([]);
  const [name, setName] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [runningSpecId, setRunningSpecId] = React.useState<string | null>(null);
  const pendingRunIdempotencyKeys = React.useRef(new Map<string, string>());

  const load = React.useCallback(async () => {
    setLoading(true);
    setAvailability("loading");
    try {
      const res = await fetch("/api/agents/specs");
      const json = (await res.json()) as { ok: boolean; demo?: boolean; specs?: SpecRow[] };
      if (!res.ok || json.ok !== true) throw new Error("Agent Studio is unavailable.");
      setDemo(Boolean(json.demo));
      setSpecs(json.specs ?? []);
      setAvailability("ready");
    } catch (err) {
      setAvailability("unavailable");
      setSpecs([]);
      toast({
        title: "Agent Studio unavailable.",
        description: err instanceof Error ? err.message : "Could not load agents.",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createSpec(e: React.FormEvent) {
    e.preventDefault();
    if (availability !== "ready") {
      toast({ title: "Agent Studio unavailable.", description: "Retry loading agents before creating one.", variant: "error" });
      return;
    }
    if (!name.trim() || !roleTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agents/specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role_brief: {
            title: roleTitle.trim(),
            requiredSkills: skills.split(",").map((s) => s.trim()).filter(Boolean),
          },
          channels: SUPPORTED_CHANNELS,
        }),
      });
      const json = (await res.json()) as { ok: boolean; reason?: string };
      if (!json.ok) throw new Error(json.reason ?? "Create failed");
      toast({
        title: "Agent definition created.",
        description: "An administrator must import and independently approve its Flowise workflow before it can run.",
        variant: "success",
      });
      setName("");
      setRoleTitle("");
      setSkills("");
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Create failed.", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function runSpec(spec: SpecRow) {
    if (runningSpecId || !spec.runtime_eligible || !spec.workflowVersionId) return;
    const campaign = resolveStudioCampaign(spec.role_brief.title ?? "", campaigns);
    if (!campaign.ok) {
      toast({ title: "No unambiguous reviewed campaign", description: campaign.reason, variant: "error" });
      return;
    }
    setRunningSpecId(spec.id);
    try {
      const idempotencyScope = {
        specId: spec.id,
        workflowVersionId: spec.workflowVersionId,
        campaignId: campaign.campaignId,
      };
      const retryStorage = getStudioSessionStorage();
      const idempotencyKey = acquireStudioRunIdempotencyKey(
        idempotencyScope,
        pendingRunIdempotencyKeys.current,
        retryStorage,
      );
      const result = await executeStudioAgentRun({
        specId: spec.id,
        workflowVersionId: spec.workflowVersionId,
        campaignId: campaign.campaignId,
        count: 5,
        idempotencyKey,
        sourceNextBatch: actions.sourceNextBatch,
      });
      settleStudioRunIdempotencyKey(
        idempotencyScope,
        result,
        pendingRunIdempotencyKeys.current,
        retryStorage,
      );
      if (!result.ok) {
        toast({ title: "Agent run failed", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: result.accepted === 0
          ? "Real search completed with no new candidates"
          : `Sourced ${result.accepted} real candidate${result.accepted === 1 ? "" : "s"}`,
        description: result.skipped > 0
          ? `${result.skipped} provider result${result.skipped === 1 ? " was" : "s were"} excluded or already present.`
          : `DeerFlow completed approved workflow ${spec.workflowName ?? spec.workflowVersionId}.`,
        variant: result.accepted === 0 ? "info" : "success",
      });
    } finally {
      setRunningSpecId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Agent Studio"
        description="Run approved Flowise workflows through DeerFlow against exact reviewed campaign needs. Candidate search and persistence remain under ARIA authority."
      />

      {demo && (
        <Card className="mb-6">
          <CardContent>
            <p className="text-sm text-muted">
              Demo mode: agent specs need the Supabase backend. Everything else on this page is wired and goes live with
              the production environment.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card>
          <CardContent>
            <div className="mb-4 flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-muted" />
              <h2 className="text-sm font-semibold text-ink">New sourcing agent</h2>
            </div>
            {availability === "unavailable" && (
              <div
                id="studio-unavailable"
                role="alert"
                className="mb-4 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"
              >
                <p className="font-semibold">Agent Studio is unavailable.</p>
                <p className="mt-1 text-xs text-muted">Existing agents are hidden until the backend responds successfully.</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                  Retry loading agents
                </Button>
              </div>
            )}
            <form onSubmit={createSpec} className="flex flex-col gap-4" aria-describedby={availability === "unavailable" ? "studio-unavailable" : undefined}>
              <Field label="Agent name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend hunter, Paris" maxLength={120} disabled={availability !== "ready"} />
              </Field>
              <Field label="Role title">
                <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Staff Backend Engineer" maxLength={120} disabled={availability !== "ready"} />
              </Field>
              <Field label="Required skills (comma-separated)">
                <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Go, Postgres, Kubernetes" maxLength={300} disabled={availability !== "ready"} />
              </Field>
              <Field label="Channels">
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_CHANNELS.map((channel) => (
                    <Badge key={channel} tone="neutral">{channel}</Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Email is the only stored channel currently accepted. Creating a spec does not approve or execute a workflow.</p>
              </Field>
              <Button type="submit" disabled={availability !== "ready" || saving || !name.trim() || !roleTitle.trim()}>
                {saving ? "Creating…" : "Create agent"}
              </Button>
              <p className="text-xs text-muted">
                A second administrator must approve the imported Flowise version. DeerFlow can then orchestrate only an exact active campaign match.
              </p>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {loading ? (
            <Card>
              <CardContent>
                <p className="text-sm text-muted">Loading agents…</p>
              </CardContent>
            </Card>
          ) : availability === "unavailable" ? (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="Agent Studio unavailable"
              description="The backend did not return a successful agent list. Retry before treating this workspace as empty."
              action={
                <Button type="button" variant="outline" onClick={() => void load()}>
                  Retry loading agents
                </Button>
              }
            />
          ) : specs.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="No agents yet"
              description="Create an owner-scoped definition, then have an administrator import and independently approve its Flowise workflow."
            />
          ) : (
            specs.map((spec) => {
              const campaign = resolveStudioCampaign(spec.role_brief.title ?? "", campaigns);
              const runBlockedReason = !spec.runtime_eligible
                ? spec.runtime_reason ?? "Stored policy is not executable by this runtime."
                : !campaign.ok
                  ? campaign.reason
                  : null;
              return (
              <Card key={spec.id}>
                <CardContent>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{spec.name}</h3>
                        <Badge tone={spec.status === "active" ? "success" : "neutral"}>{spec.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {spec.role_brief.title ?? "Untitled role"}
                        {spec.role_brief.requiredSkills?.length ? ` · ${spec.role_brief.requiredSkills.join(", ")}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {spec.channels.map((c) => (
                          <Badge key={c} tone="neutral">
                            {c}
                          </Badge>
                        ))}
                        {spec.workflowName && <Badge tone="neutral">Flowise: {spec.workflowName}</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {spec.runtime_eligible ? (
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Approved Flowise workflow
                            <Badge tone="neutral">DeerFlow</Badge>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void runSpec(spec)}
                            disabled={Boolean(runBlockedReason) || runningSpecId !== null}
                            title={runBlockedReason ?? "Run against the exact matching active campaign"}
                          >
                            {runningSpecId === spec.id ? "Running real search…" : "Run approved agent"}
                          </Button>
                          {runBlockedReason && <span className="max-w-sm text-right text-xs text-danger">{runBlockedReason}</span>}
                        </div>
                      ) : (
                        <div className="flex max-w-sm flex-col items-end gap-1 text-xs text-danger">
                          <Badge tone="danger">Execution blocked</Badge>
                          <span className="text-right">{spec.runtime_reason ?? "Stored policy is not executable by this runtime."}</span>
                        </div>
                      )}
                      <span className="text-xs text-muted">No delivery authority</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
