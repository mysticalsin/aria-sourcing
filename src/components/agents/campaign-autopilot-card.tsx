"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";

/* Campaign autopilot (ADR 0002, POC): the owner signs a standing approval;
   the agents runner then sources the campaign on a schedule and contacts the
   best candidates on LinkedIn from the owner's own account, without a click
   per message. Server: /api/agent/autopilot. */

interface AutopilotView {
  enabled: boolean;
  mine: boolean;
  ownerName: string;
  sourceEveryHours: number;
  sourceLimit: number;
  contactEnabled: boolean;
  contactsPerRun: number;
  minScore: number;
  approvedAt: string;
  lastSourceAt: string | null;
  lastContactAt: string | null;
}
interface AutopilotPayload {
  ok: boolean;
  error?: string;
  agentsEnabled: boolean;
  bridgeEnabled: boolean;
  autopilot: AutopilotView | null;
  delegation: { active: boolean; scopes: string[] } | null;
  linkedin: { connected: boolean; lastSeenAt: string | null };
  missions: { id: string; kind: string; status: string; summary: string | null; started_at: string }[];
  contacts: { candidate_id: string; state: string; kind: string | null; score: number | null; reason: string | null; updated_at: string }[];
}

const STATE_LABEL: Record<string, string> = {
  selected: "Picked",
  awaiting_lookup: "Checking LinkedIn",
  queued: "Waiting for your browser",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export function CampaignAutopilotCard({ campaignId, candidateName }: { campaignId: string; candidateName: (id: string) => string }) {
  const [data, setData] = React.useState<AutopilotPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ sourceEveryHours: 24, sourceLimit: 8, contactEnabled: true, contactsPerRun: 3, minScore: 70 });
  const [consent, setConsent] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/autopilot?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
      const body = (await res.json()) as AutopilotPayload;
      if (!body.ok) { setError(body.error ?? "Autopilot unavailable."); return; }
      setError(null);
      setData(body);
      if (body.autopilot) {
        const a = body.autopilot;
        setForm({ sourceEveryHours: a.sourceEveryHours, sourceLimit: a.sourceLimit, contactEnabled: a.contactEnabled, contactsPerRun: a.contactsPerRun, minScore: a.minScore });
      }
    } catch {
      setError("Autopilot unavailable.");
    }
  }, [campaignId]);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/agent/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!out.ok) setError(out.error ?? "Could not save.");
      else { setError(null); setConsent(false); }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const pilot = data?.autopilot;
  const running = Boolean(pilot?.enabled);
  const lockedByOther = Boolean(pilot?.enabled && !pilot.mine);
  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  return (
    <Card className="mb-6" id="campaign-autopilot">
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">Autopilot (agent, proof of concept)</h2>
            <p className="text-sm text-muted">Sources this campaign on a schedule, then contacts the best candidates on LinkedIn from the owner&apos;s account, without a click per message.</p>
          </div>
          {pilot && <span className="text-sm font-semibold">{running ? `On · owner: ${pilot.ownerName}` : "Off"}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {data && !data.agentsEnabled && <p className="text-sm text-muted">The agents runner is off on this server (AGENTS_ENABLED and AGENT_RUNNER_SECRET). Settings are kept; nothing runs.</p>}
        {data && !data.bridgeEnabled && <p className="text-sm text-muted">The LinkedIn bridge is off on this server: the agent can source, not contact.</p>}
        {data && !data.linkedin.connected && <p className="text-sm text-muted">Your LinkedIn is not connected: <Link className="underline" href="/settings?tab=integrations#linkedin">connect it</Link> before the agent can contact anyone for you.</p>}

        {!lockedByOther && (
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Source every (hours)" htmlFor="ap-every"><Input id="ap-every" type="number" min={1} max={168} value={form.sourceEveryHours} onChange={num("sourceEveryHours")} /></Field>
            <Field label="Profiles per source" htmlFor="ap-limit"><Input id="ap-limit" type="number" min={1} max={20} value={form.sourceLimit} onChange={num("sourceLimit")} /></Field>
            <Field label="Contacts per run" htmlFor="ap-contacts"><Input id="ap-contacts" type="number" min={1} max={5} value={form.contactsPerRun} onChange={num("contactsPerRun")} /></Field>
            <Field label="Minimum score" htmlFor="ap-score"><Input id="ap-score" type="number" min={0} max={100} value={form.minScore} onChange={num("minScore")} /></Field>
            <label className="flex items-end gap-2 pb-3 text-sm font-semibold">
              <input type="checkbox" checked={form.contactEnabled} onChange={(e) => setForm((f) => ({ ...f, contactEnabled: e.target.checked }))} />
              Contact on LinkedIn
            </label>
          </div>
        )}

        {!lockedByOther && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I approve in advance that the agent sends, from my LinkedIn account and without asking me, an invitation note or a message
              written by Claude to the {form.contactsPerRun} best candidate{form.contactsPerRun > 1 ? "s" : ""} (score {form.minScore} or more) after each run.
              LinkedIn forbids automated messaging and can restrict my account; I accept that risk for this proof of concept.
            </span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          {!lockedByOther && (
            <Button disabled={busy || (form.contactEnabled && !consent)} onClick={() => act({ action: "enable", campaignId, settings: form })}>
              {running ? "Save and re-approve" : "Turn on autopilot"}
            </Button>
          )}
          {running && (pilot?.mine || !lockedByOther) && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => act({ action: "run-now", campaignId })}>Run now</Button>
              <Button variant="outline" disabled={busy} onClick={() => act({ action: "disable", campaignId })}>Turn off</Button>
            </>
          )}
          {data?.delegation?.active && (
            <Button variant="ghost" disabled={busy} onClick={() => act({ action: "revoke" })}>Stop all agents acting for me</Button>
          )}
        </div>
        {lockedByOther && <p className="text-sm text-muted">{pilot?.ownerName} runs this campaign&apos;s autopilot. They or an admin can turn it off.</p>}

        {pilot && (
          <p className="text-xs text-muted">
            Approved {when(pilot.approvedAt)} · last sourcing {when(pilot.lastSourceAt)} · last pick {when(pilot.lastContactAt)}
          </p>
        )}

        {data && data.contacts.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Contacts by the agent</h3>
            <ul className="space-y-1 text-sm">
              {data.contacts.map((c) => (
                <li key={c.candidate_id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-ink/10 px-3 py-2">
                  <span className="font-medium">{candidateName(c.candidate_id)}{c.score !== null ? ` · ${c.score}` : ""}</span>
                  <span className="text-muted">{STATE_LABEL[c.state] ?? c.state}{c.kind ? ` (${c.kind})` : ""}{c.reason ? ` · ${c.reason}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data && data.missions.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Recent missions</h3>
            <ul className="space-y-1 text-xs text-muted">
              {data.missions.map((m) => (
                <li key={m.id}>{when(m.started_at)} · {m.kind} · {m.status}{m.summary ? ` · ${m.summary}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
