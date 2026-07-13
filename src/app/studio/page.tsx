"use client";

/* Agent Studio — create and tune on-demand sourcing agents. Flow execution is
   limited to ARIA-owned runtime bindings; Flowise authoring is intentionally
   private until a per-workspace deployment boundary exists. Generated drafts
   remain in run history and have no delivery authority. */

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

interface SpecRow {
  id: string;
  name: string;
  role_brief: { title?: string; requiredSkills?: string[] } & Record<string, unknown>;
  channels: string[];
  flowise_chatflow_id: string | null;
  status: string;
  runtime_eligible: boolean;
  runtime_reason: string | null;
}

const SUPPORTED_CHANNELS = ["Email"] as const;

export default function StudioPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [availability, setAvailability] = React.useState<"loading" | "ready" | "unavailable">("loading");
  const [demo, setDemo] = React.useState(false);
  const [specs, setSpecs] = React.useState<SpecRow[]>([]);
  const [name, setName] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [saving, setSaving] = React.useState(false);

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
      toast({ title: "Agent created. Generated drafts will remain in run history.", variant: "success" });
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

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Agent Studio"
        description="Build on-demand sourcing agents: one role, one task, hard guardrails. Runtime flows stay bound to this workspace; Flowise authoring remains private."
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
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend hunter — Paris" maxLength={120} disabled={availability !== "ready"} />
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
                <p className="mt-2 text-xs text-muted">This runtime currently produces Email drafts only. Other channels remain unavailable until their guardrails are enforced end to end.</p>
              </Field>
              <Button type="submit" disabled={availability !== "ready" || saving || !name.trim() || !roleTitle.trim()}>
                {saving ? "Creating…" : "Create agent"}
              </Button>
              <p className="text-xs text-muted">
                Generated Email drafts are stored in run history only. This workflow has no review queue and no
                delivery authority.
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
              description="Create your first on-demand sourcing agent — one role, one task, fully guardrailed."
            />
          ) : (
            specs.map((spec) => (
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
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {spec.runtime_eligible ? (
                        <div className="flex items-center gap-2 text-xs text-muted">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Draft storage
                          <Badge tone="neutral">Run history only</Badge>
                        </div>
                      ) : (
                        <div className="flex max-w-sm flex-col items-end gap-1 text-xs text-danger">
                          <Badge tone="danger">Execution blocked</Badge>
                          <span className="text-right">{spec.runtime_reason ?? "Stored policy is not executable by this runtime."}</span>
                        </div>
                      )}
                      <span className="text-xs text-muted">No delivery authority</span>
                      {spec.flowise_chatflow_id && <Badge tone="neutral">Workspace-bound Flowise runtime</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
