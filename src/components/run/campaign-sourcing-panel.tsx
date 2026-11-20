"use client";

import * as React from "react";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import { useCampaign, useCampaignCandidates, useRole, useWorkspaceStatus, useSettings } from "@/lib/store";
import { can } from "@/lib/rbac";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { campaignAllowsLiveSourcing } from "@/lib/sourcing/campaign-lifecycle";
import { shortlistIdentity } from "@/lib/sourcing/shortlist-preview";
import { SOURCE_LABELS, type PublicSourcingJob, type SourceChoice } from "@/lib/sourcing/unified-contract";
import type { Candidate } from "@/lib/types";
import { Linkedin } from "lucide-react";
import { CandidateAvatar } from "@/components/candidates/candidate-avatar";
import { SourcingScan } from "@/components/run/sourcing-scan";

const activeStep = (job: PublicSourcingJob) => job.steps.find((s) => ["queued", "starting", "running"].includes(s.status));
const labels = { queued: "Waiting", starting: "Searching", running: "Searching", completed: "Complete", failed: "Failed", uncertain: "Needs review" };

export function CampaignSourcingPanel({ campaignId, open, onClose, onCandidates, onCandidate }: {
  campaignId: string; open: boolean; onClose: () => void; onCandidates: () => void; onCandidate: (candidate: Candidate) => void;
}) {
  const campaign = useCampaign(campaignId);
  const candidates = useCampaignCandidates(campaignId);
  const role = useRole();
  const settings = useSettings();
  const idBase = React.useId();
  const { retryWorkspace, flushWorkspace, workspaceStatus } = useWorkspaceStatus();
  const [runs, setRuns] = React.useState<PublicSourcingJob[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const [paused, setPaused] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const launchKey = React.useRef<string | null>(null);
  const restoredPlan = React.useRef(false);
  const [github, setGithub] = React.useState(false);
  const [githubQuery, setGithubQuery] = React.useState(campaign?.sourcingStrategy.githubQueries[0]?.query ?? "");
  const [limit, setLimit] = React.useState(6);
  const current = runs.find((r) => r.status === "active") ?? runs[0];
  const enabled = can(role, "source") && workspaceStatus.phase === "ready";
  const liveRef = React.useRef(true);
  React.useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; }; }, []);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/source/campaign?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.runs)) throw new Error(body.error || "Sourcing history unavailable.");
      if (liveRef.current) {
        setRuns(body.runs); setLoaded(true); setError("");
        if (!restoredPlan.current && body.runs[0]) {
          const previous = body.runs[0] as PublicSourcingJob;
          const gh = previous.steps.find((s) => s.source === "GitHub");
          setGithub(Boolean(gh));
          if (gh) setGithubQuery(gh.query);
          setLimit(previous.steps[0].limit);
        }
        restoredPlan.current = true;
      }
    } catch (err) { if (liveRef.current) { setError(err instanceof Error ? err.message : "Sourcing history unavailable."); setPaused(true); } }
  }, [campaignId]);
  React.useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  const mutate = React.useCallback(async (payload: object) => {
    const response = await fetch("/api/source/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok || !body.ok || !body.run) throw new Error(body.error || "Sourcing paused. Resume the saved run.");
    const run = body.run as PublicSourcingJob;
    if (liveRef.current) setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    return run;
  }, []);

  React.useEffect(() => {
    if (!enabled || busy || paused || !current || current.status !== "active" || !current.canAdvance || inFlight.current) return;
    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true);
      try {
        const updated = await mutate({ action: "advance", runId: current.id });
        if (updated.status !== "active") {
          // Server committed results before reporting completion. Hydrate the
          // shared store from that version; never replay a client-side append.
          await retryWorkspace();
        } else if (activeStep(updated)?.error) setPaused(true);
      } catch (err) { setError(err instanceof Error ? err.message : "Sourcing paused."); setPaused(true); }
      finally { inFlight.current = false; if (liveRef.current) setBusy(false); }
    }, 4_000);
    return () => clearTimeout(timer);
  }, [current, enabled, busy, mutate, paused, retryWorkspace]);

  async function start() {
    if (inFlight.current || !enabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      // Persist the reviewed brief before the server resolves it. A conflict
      // reloads the shared version and requires a fresh operator review.
      if (!(await flushWorkspace())) throw new Error("The workspace is saving or changed. Review the current brief and try again.");
      const sources: SourceChoice[] = [];
      if (github) sources.push({ source: "GitHub", query: githubQuery.trim(), limit });
      launchKey.current ??= crypto.randomUUID();
      await mutate({ action: "start", campaignId, sources, requestKey: launchKey.current });
      launchKey.current = null; setPaused(false); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Sourcing could not start."); setPaused(true); }
    finally { inFlight.current = false; if (liveRef.current) setBusy(false); }
  }
  async function close() {
    if (inFlight.current || !current) return;
    inFlight.current = true; setBusy(true);
    try { await mutate({ action: "close", runId: current.id }); setPaused(false); setError(""); await retryWorkspace(); }
    catch (err) { setError(err instanceof Error ? err.message : "Run could not be closed."); }
    finally { inFlight.current = false; if (liveRef.current) setBusy(false); }
  }
  if (!enabled || !campaign) return null;
  const showForm = open || (loaded && !current);
  const campaignReady = campaignAllowsLiveSourcing(campaign.status) && evaluateNeedReadiness(campaign.jobAnalysis).ready;
  const active = current?.status === "active";
  const newCandidates = current ? candidates.filter((c) => c.sourceRunId === current.id).slice(0, 5) : [];
  return <Card className="mb-6" id="campaign-sourcing">
    <CardBody className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-bold text-ink">Find candidates</h2><p className="text-sm text-muted">GitHub public profiles. LinkedIn web search is disabled. Review the query and limit before launching.</p></div>
        {current && <span className="text-sm font-semibold">Run {current.status}</span>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {error && !active && <Button variant="secondary" onClick={() => void retryWorkspace()}>Reload saved searches</Button>}
      {!loaded && <Button variant="secondary" onClick={() => void load()}>Load sourcing history</Button>}
      {showForm && !active && <div className="space-y-4">
        {!campaignReady && <p className="text-sm text-muted">Review the campaign brief and move it to Sourcing or Outreach before launching.</p>}
        <p className="text-sm text-muted">LinkedIn web search is disabled.</p>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={github} onChange={(e) => setGithub(e.target.checked)} />GitHub public profiles</label>
        {github && <Field label="GitHub search" htmlFor={`${idBase}-github`}><Input id={`${idBase}-github`} value={githubQuery} maxLength={256} onChange={(e) => setGithubQuery(e.target.value)} /></Field>}
        <Field label="Maximum profiles per selected source (1–20)" htmlFor={`${idBase}-limit`}><Input id={`${idBase}-limit`} type="number" min={1} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field>
        <p className="text-sm text-muted">Up to {limit * Number(github) || 0} profiles. Duplicates and exclusions can reduce your shortlist. No model is required.</p>
        <Button onClick={() => void start()} loading={busy} disabled={busy || !campaignReady || !loaded || !github || !githubQuery.trim() || !Number.isInteger(limit) || limit < 1 || limit > 20}>Start reviewed search</Button>
      </div>}
      {current && <div aria-live="polite" className="space-y-3">
        {active && <SourcingScan job={current} />}
        {current.steps.map((step) => <div key={step.source} className="rounded-xl border border-ink/10 p-3">
          <p className="font-semibold">{SOURCE_LABELS[step.source]} · {labels[step.status]} · limit {step.limit}</p>
          <p className="break-words text-xs text-muted">{step.query}</p>
          <p className="mt-1 text-sm">{step.found} found · {step.added} added · {step.duplicates} duplicates · {step.excluded} excluded</p>
          {step.error && <p className="mt-1 text-sm text-danger">{step.error}</p>}
        </div>)}
        {active && <p className="text-xs text-muted">Progress is saved. Returning to this campaign resumes the same run; the next steps wait for your return.</p>}
        {active && current.canClose && <div className="flex gap-2">
          {paused && current.canAdvance && <Button disabled={busy} onClick={() => void retryWorkspace()}>Resume saved run</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => void close()}>Close run</Button>
        </div>}
        {active && !current.canAdvance && <p className="text-sm text-muted">The initiating operator must resume this search. An administrator can close it.</p>}
        {!active && <Button variant="secondary" onClick={onCandidates}>Review saved candidates</Button>}
      </div>}
      {newCandidates.length > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold">Shortlist preview</h3>
        {newCandidates.map((c, i) => { const identity = shortlistIdentity(c, settings.confidentialityMode); return <div key={c.id} className="flex items-start gap-3 border-t border-ink/10 pt-2 text-sm animate-fade-in" style={{ animationDelay: `${i * 70}ms` }}>
          <CandidateAvatar candidate={identity.display} size="md" />
          <div className="min-w-0 flex-1"><button type="button" className="font-semibold underline" onClick={() => onCandidate(c)}>{identity.name}</button> · {Math.round(c.matchScore)}/100 · {c.sourcePlatform}
            <p className="text-xs text-muted">{c.techStack.length ? `Observed skills: ${c.techStack.join(", ")}` : "Skills need verification"} · {c.email ? "Review fit and contact permission" : "Find contact details before email outreach"}{c.yearsExperience === null ? " · Experience unknown" : ""}</p></div>
          <div className="flex shrink-0 items-center gap-3">
            {identity.profileUrl && <a className="inline-flex items-center gap-1 underline" href={identity.profileUrl} target="_blank" rel="noreferrer">{identity.profileLabel === "LinkedIn" && <Linkedin className="h-3.5 w-3.5" aria-hidden />}{identity.profileLabel}<span className="sr-only"> profile of {identity.name} (opens in a new tab)</span></a>}
            <button type="button" className="font-semibold text-electric underline" onClick={() => onCandidate(c)}>View details</button>
          </div>
        </div>; })}
      </div>}
      {runs.length > 1 && <details><summary className="cursor-pointer text-sm">Previous searches ({runs.length - 1})</summary>{runs.slice(1).map((r) => <p key={r.id} className="mt-2 text-xs text-muted">{new Date(r.createdAt).toLocaleString()} · {r.status} · {r.steps.map((s) => `${SOURCE_LABELS[s.source]}: ${s.added} added`).join(" / ")}</p>)}</details>}
    </CardBody>
  </Card>;
}
