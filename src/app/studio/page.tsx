"use client";

/* Agent Studio — create and tune on-demand sourcing agents. Flow execution is
   limited to ARIA-owned runtime bindings; Flowise authoring is intentionally
   private until a per-workspace deployment boundary exists. Reply drafting is
   queue-only: every generated reply waits for a named human reviewer. */

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
}

const ALL_CHANNELS = ["Email", "WhatsApp", "LinkedIn", "SMS"] as const;

export default function StudioPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [demo, setDemo] = React.useState(false);
  const [specs, setSpecs] = React.useState<SpecRow[]>([]);
  const [name, setName] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [channels, setChannels] = React.useState<string[]>(["Email"]);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/agents/specs");
      const json = (await res.json()) as { ok: boolean; demo?: boolean; specs?: SpecRow[] };
      setDemo(Boolean(json.demo));
      setSpecs(json.specs ?? []);
    } catch {
      toast({ title: "Could not load agents.", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createSpec(e: React.FormEvent) {
    e.preventDefault();
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
          channels,
        }),
      });
      const json = (await res.json()) as { ok: boolean; reason?: string };
      if (!json.ok) throw new Error(json.reason ?? "Create failed");
      toast({ title: "Agent created. Generated replies will wait for human review.", variant: "success" });
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
            <form onSubmit={createSpec} className="flex flex-col gap-4">
              <Field label="Agent name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend hunter — Paris" maxLength={120} />
              </Field>
              <Field label="Role title">
                <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Staff Backend Engineer" maxLength={120} />
              </Field>
              <Field label="Required skills (comma-separated)">
                <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Go, Postgres, Kubernetes" maxLength={300} />
              </Field>
              <Field label="Channels">
                <div className="flex flex-wrap gap-2">
                  {ALL_CHANNELS.map((c) => {
                    const active = channels.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setChannels((prev) => (active ? prev.filter((x) => x !== c) : [...prev, c]))
                        }
                        className={
                          active
                            ? "rounded-full border border-ink/20 bg-ink px-3 py-1 text-xs text-paper"
                            : "rounded-full border border-ink/15 px-3 py-1 text-xs text-muted hover:border-ink/30"
                        }
                        aria-pressed={active}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Button type="submit" disabled={saving || !name.trim() || !roleTitle.trim() || channels.length === 0}>
                {saving ? "Creating…" : "Create agent"}
              </Button>
              <p className="text-xs text-muted">
                Reply drafting is queue-only. Every generated reply stays in human review until a named operator
                approves its exact content and recipient.
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
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Reply drafting
                        <Badge tone="success">Human review</Badge>
                      </div>
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
