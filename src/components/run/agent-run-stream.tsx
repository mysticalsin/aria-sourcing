"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, EmptyState, Eyebrow, Progress } from "@/components/ui";
import { RevealStream } from "@/components/reveal/reveal-stream";
import { useTypewriter } from "@/components/reveal/use-typewriter";
import { useCountUp } from "@/components/reveal/use-count-up";
import { FitRadar } from "@/components/charts/fit-radar";
import { runCampaignSourcing } from "@/lib/sourcing/campaign-run";
import { runMission } from "@/lib/agents/mission";
import { campaignLaunchPlan, MAX_MISSION_DRAFTS, type DraftedPair } from "@/lib/agents/campaign-mission";
import { useActions, useCampaign, useCampaignOutreach, useSettings } from "@/lib/store";
import { demoLoginEnabled, isProduction, supabaseEnabled } from "@/lib/supabase/config";
import type { Candidate } from "@/lib/types";
import { initialsFrom, scoreTone, toneForOutreachStatus } from "@/lib/utils";
import { AlertTriangle, Bot, PlayCircle, ShieldCheck, Sparkles, X } from "lucide-react";

type RunPhase = "idle" | "sourcing" | "drafting" | "done" | "empty" | "error";

/**
 * One materializing card per just-drafted candidate: the fit score counts up
 * next to the real radar (reusing FitRadar exactly as the sourcing feed
 * does), and the drafted body types out cosmetically over the ALREADY
 * committed `message.body` — the drafting agent already wrote this message
 * into the approval queue before this card ever renders, so nothing here is
 * computed, re-scored, or sent. `onRevealed` fires once per card the instant
 * it mounts (mirrors SourcedCandidateCard's per-card bus ping) purely to
 * drive the parent's cosmetic "climbing" queue counter.
 */
function DraftedCandidateCard({
  pair,
  onRevealed,
}: {
  pair: DraftedPair;
  onRevealed: () => void;
}) {
  const { candidate, message } = pair;
  const { text: typedBody, done: bodyTyped } = useTypewriter(message.body, { speed: 90 });
  const displayScore = useCountUp(Math.round(candidate.matchScore), { durationMs: 700 });
  const revealedRef = React.useRef(false);

  React.useEffect(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    onRevealed();
  }, [onRevealed]);

  const initials = candidate.avatarInitials || initialsFrom(candidate.name);

  return (
    <Card className="overflow-hidden">
      <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-sm font-bold text-ink-soft"
              aria-hidden
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-ink">{candidate.name}</p>
              <p className="truncate text-sm text-muted">
                {candidate.currentTitle} · {candidate.currentCompany}
              </p>
            </div>
            {message.draftedBy && (
              <Badge tone={message.draftedBy === "ai" ? "electric" : "neutral"} size="sm" className="shrink-0">
                {message.draftedBy === "ai" ? "Drafted by Claude" : "Template draft"}
              </Badge>
            )}
            <Badge tone={toneForOutreachStatus(message.status)} size="sm" className="shrink-0">
              {message.status}
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <span
              className="text-lg font-extrabold tabular-nums text-ink"
              aria-label={`Fit score ${Math.round(candidate.matchScore)} of 100`}
            >
              {Math.round(displayScore)}
            </span>
            <Progress
              value={displayScore}
              tone={scoreTone(candidate.matchScore)}
              className="w-28"
              aria-label={`Fit score ${Math.round(candidate.matchScore)} of 100`}
            />
          </div>

          <div className="rounded-2xl bg-ink/[0.03] p-3.5">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
              {message.subject}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
              {typedBody}
              {!bodyTyped && (
                <span aria-hidden className="ml-0.5 animate-pulse text-muted">
                  ▍
                </span>
              )}
            </p>
          </div>
        </div>
        <FitRadar matchBreakdown={candidate.matchBreakdown} size={140} label={candidate.name} />
      </CardBody>
    </Card>
  );
}

export interface AgentRunStreamProps {
  campaignId: string;
  /** Kick off the run the instant this component mounts — the host page owns
   *  the actual "Run Aria" click and remounts this component (e.g. via a
   *  changing `key`) to trigger each fresh run. Guarded so it only ever fires
   *  once per mount, including under React Strict Mode's double-invoke. */
  autoStart?: boolean;
  /** Optional dismiss control rendered top-right (the host page decides
   *  whether the panel can be hidden again). */
  onClose?: () => void;
  className?: string;
}

/**
 * "Watch Aria Work" — runs the campaign launch mission (campaignLaunchPlan):
 * a sourcing agent, then one drafting agent per top candidate, two at a
 * time, streaming each draft as a revealed card (fit radar + a typing body)
 * while a live "queued — awaiting approval" counter climbs next to the
 * approval-gate pill.
 *
 * Live sourcing goes through the canonical store action, which calls the
 * in-process sourcing agent (/api/sourcing-agent). An explicit demo
 * deployment uses the deterministic Talent Pool source. Drafts are written by
 * Claude through generateOutreachLive, which keeps a template draft when the
 * model is unavailable. The reveal only stages presentation of data that is
 * already committed. No agent calls a send path; every draft stops in the
 * human approval queue.
 */
export function AgentRunStream({ campaignId, autoStart = false, onClose, className }: AgentRunStreamProps) {
  const actions = useActions();
  const settings = useSettings();
  const campaign = useCampaign(campaignId);
  const campaignOutreach = useCampaignOutreach(campaignId);

  const [phase, setPhase] = React.useState<RunPhase>("idle");
  const [queue, setQueue] = React.useState<DraftedPair[]>([]);
  const [runKey, setRunKey] = React.useState(0);
  const [revealedCount, setRevealedCount] = React.useState(0);
  const [sourcedCount, setSourcedCount] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const baselineQueuedRef = React.useRef(0);
  const missionAbortRef = React.useRef<AbortController | null>(null);
  // Leaving the page stops queued agents; drafts already committed stay queued.
  // The abort is deferred one tick: Strict Mode unmounts and immediately
  // remounts in development, and that simulated unmount must not cancel the
  // auto-started run (the autoStart guard would not start it again).
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const controller = missionAbortRef.current;
      setTimeout(() => {
        if (!mountedRef.current) controller?.abort();
      }, 0);
    };
  }, []);

  const handleRevealed = React.useCallback(() => {
    setRevealedCount((n) => n + 1);
  }, []);

  const handleRun = React.useCallback(async () => {
    // Re-entrancy guard: a run already in flight ignores a second trigger.
    if (phase === "sourcing" || phase === "drafting") return;

    baselineQueuedRef.current = campaignOutreach.filter((m) => m.status === "Needs Approval").length;
    setErrorMessage(null);
    setPhase("sourcing");
    setQueue([]);
    setRevealedCount(0);
    setSourcedCount(0);

    if (!campaign) {
      setErrorMessage("Campaign state is unavailable. No sourcing was started.");
      setPhase("error");
      return;
    }

    missionAbortRef.current?.abort();
    const controller = new AbortController();
    missionAbortRef.current = controller;
    const plan = campaignLaunchPlan(campaignId, {
      sourceBatch: () =>
        runCampaignSourcing({
          campaignId,
          count: MAX_MISSION_DRAFTS,
          demoAuthorized: !supabaseEnabled && (!isProduction || demoLoginEnabled),
          sourceNextBatch: actions.sourceNextBatch,
        }),
      draftLive: (candidateId) => actions.generateOutreachLive(candidateId),
      draftTemplate: (candidateId) => actions.generateOutreachFor(candidateId),
    });
    const report = await runMission(plan, {
      // Two drafts in flight keeps the run quick without bursting the API.
      concurrency: 2,
      agentTimeoutMs: 90_000,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "step_started" && event.stepId === "drafts") setPhase("drafting");
      },
    });
    // Unmounted or restarted meanwhile: this run's results are no longer shown.
    if (controller.signal.aborted) return;

    const sourceStep = report.steps.source;
    if (sourceStep?.status === "failed") {
      setErrorMessage(sourceStep.error ?? "Sourcing failed.");
      setPhase("error");
      return;
    }
    const sourced = (report.results.source as Candidate[] | undefined) ?? [];
    setSourcedCount(sourced.length);
    if (sourced.length === 0) {
      setPhase("empty");
      return;
    }

    const pairs = (report.results.drafts as DraftedPair[] | undefined) ?? [];
    if (pairs.length === 0) {
      setPhase("empty");
      return;
    }
    setQueue(pairs);
    setRunKey((k) => k + 1);
    // phase flips to "done" from the RevealStream's onDone once every card
    // has materialized (or instantly, on Skip / prefers-reduced-motion).
  }, [phase, campaignId, campaign, campaignOutreach, actions]);

  const autoStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void handleRun();
    // Intentionally runs once per mount — the host remounts via `key` to
    // trigger a fresh run rather than re-invoking this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const running = phase === "sourcing" || phase === "drafting";
  const hasRun = phase !== "idle";

  const liveQueuedCount = campaignOutreach.filter((m) => m.status === "Needs Approval").length;
  const queuedTarget = phase === "drafting" ? baselineQueuedRef.current + revealedCount : liveQueuedCount;
  const displayQueued = useCountUp(queuedTarget, { durationMs: 400 });

  const aiDrafted = queue.filter((pair) => pair.message.draftedBy === "ai").length;

  const runLabel = running
    ? phase === "sourcing"
      ? "Sourcing…"
      : "Drafting…"
    : hasRun
      ? "Run another batch"
      : "Run Aria";

  return (
    <Card className={className}>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow className="flex items-center gap-1.5">
              <Bot className="h-3 w-3" aria-hidden /> Watch Aria work
            </Eyebrow>
            <p className="mt-1 text-sm text-muted">
              Sources a batch, scores every candidate, and drafts outreach for each one, streamed live.
              Every draft stops at your approval gate below. Nothing is ever sent automatically.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button leftIcon={<PlayCircle className="h-4 w-4" />} onClick={() => void handleRun()} loading={running} disabled={running}>
              {runLabel}
            </Button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Aria run panel"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-ink/[0.05] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Badge tone={settings.humanApprovalGate ? "success" : "warning"} size="sm" dot>
            <ShieldCheck className="h-3 w-3" aria-hidden /> Approval gate {settings.humanApprovalGate ? "on" : "off"}
          </Badge>
          <Badge tone="warning" size="sm">
            {Math.round(displayQueued)} queued, awaiting approval
          </Badge>
          {phase === "done" && (
            <Badge tone="electric" size="sm">
              Sourced {sourcedCount} · drafted {queue.length}
              {aiDrafted > 0 && ` (${aiDrafted} by Claude)`} · 0 sent
            </Badge>
          )}
        </div>

        {phase === "error" && errorMessage && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-danger-soft px-3.5 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{errorMessage}</span>
          </div>
        )}

        {phase === "empty" && (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" aria-hidden />}
            title="No new candidates this run"
            description="Aria didn't find any fresh candidates to add this batch. Try running again: dedupe and exclusion rules can skip a whole batch."
          />
        )}

        {queue.length > 0 && (
          <RevealStream
            key={runKey}
            items={queue}
            keyExtractor={(pair) => pair.message.id}
            renderItem={(pair) => <DraftedCandidateCard pair={pair} onRevealed={handleRevealed} />}
            staggerMs={550}
            itemClassName="mb-3 last:mb-0"
            onDone={() => setPhase("done")}
          />
        )}
      </CardBody>
    </Card>
  );
}
