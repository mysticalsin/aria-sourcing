"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, EmptyState, Eyebrow, Progress } from "@/components/ui";
import { RevealStream } from "@/components/reveal/reveal-stream";
import { useTypewriter } from "@/components/reveal/use-typewriter";
import { useCountUp } from "@/components/reveal/use-count-up";
import { FitRadar } from "@/components/charts/fit-radar";
import { executePrimaryAgentSourcing } from "@/lib/agents/studio-runner";
import { useActions, useCampaign, useCampaignOutreach, useIntegrations, useSettings } from "@/lib/store";
import {
  emptyPeopleFirstShortlistError,
  missingPeoplePluginsToast,
  peoplePluginFailLoudUi,
} from "@/lib/sourcing/people-plugins";
import { demoLoginEnabled, isProduction, supabaseEnabled } from "@/lib/supabase/config";
import type { Candidate, OutreachMessage } from "@/lib/types";
import { initialsFrom, scoreTone, toneForOutreachStatus } from "@/lib/utils";
import { AlertTriangle, Bot, PlayCircle, ShieldCheck, Sparkles, X } from "lucide-react";

type RunPhase = "idle" | "sourcing" | "drafting" | "done" | "empty" | "error";

interface DraftedPair {
  candidate: Candidate;
  message: OutreachMessage;
}

/**
 * One materializing card per just-drafted candidate: the fit score counts up
 * next to the real radar (reusing FitRadar exactly as the sourcing feed
 * does), and the drafted body types out cosmetically over the ALREADY
 * committed `message.body` — generateOutreachFor already wrote this message
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
      <CardBody className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
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
 * "Watch Aria Work" — a single client-side orchestration that sources a
 * batch for a campaign, then loops drafting outreach for every sourced
 * candidate, streaming each as a revealed card (fit radar + a typing body)
 * while a live "queued — awaiting approval" counter climbs next to the
 * approval-gate pill.
 *
 * Live sourcing first executes the campaign's one exact runtime-eligible,
 * independently approved Flowise workflow through DeerFlow, then passes its
 * short-lived command to the canonical store persistence action. An explicit
 * demo deployment may use the deterministic Talent Pool source. The reveal
 * only stages presentation of data that is already committed.
 * `generateOutreachFor` never calls a send path; it only ever leaves a Draft
 * in the human approval queue.
 */
export function AgentRunStream({ campaignId, autoStart = false, onClose, className }: AgentRunStreamProps) {
  const actions = useActions();
  const settings = useSettings();
  const campaign = useCampaign(campaignId);
  const integrations = useIntegrations();
  const campaignOutreach = useCampaignOutreach(campaignId);
  const pendingRunIdempotencyKeys = React.useRef(new Map<string, string>());

  const [phase, setPhase] = React.useState<RunPhase>("idle");
  const [queue, setQueue] = React.useState<DraftedPair[]>([]);
  const [runKey, setRunKey] = React.useState(0);
  const [revealedCount, setRevealedCount] = React.useState(0);
  const [sourcedCount, setSourcedCount] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const baselineQueuedRef = React.useRef(0);

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
    const missingPlugins = missingPeoplePluginsToast(campaign.jobAnalysis, integrations);
    if (missingPlugins) {
      setErrorMessage(missingPlugins);
      setPhase("error");
      return;
    }

    let retryStorage: Storage | null = null;
    try {
      retryStorage = globalThis.sessionStorage ?? null;
    } catch {
      retryStorage = null;
    }
    const result = await executePrimaryAgentSourcing({
      campaignId,
      campaignTitle: campaign.jobAnalysis.title,
      count: 6,
      demoAuthorized: !supabaseEnabled && (!isProduction || demoLoginEnabled),
      idempotencyMemory: pendingRunIdempotencyKeys.current,
      retryStorage,
      sourceNextBatch: actions.sourceNextBatch,
    });
    if (!result.ok) {
      const failLoud = peoplePluginFailLoudUi(
        result.error,
        campaign.jobAnalysis,
        integrations,
      );
      setErrorMessage(failLoud?.description ?? result.error);
      setPhase("error");
      return;
    }
    const sourced: Candidate[] = result.candidates;

    setSourcedCount(sourced.length);
    if (sourced.length === 0) {
      const emptyPeopleFirst = emptyPeopleFirstShortlistError(
        campaign.jobAnalysis,
        integrations,
        { accepted: sourced, source: result.source },
      );
      if (emptyPeopleFirst) {
        setErrorMessage(emptyPeopleFirst);
        setPhase("error");
        return;
      }
      setPhase("empty");
      return;
    }

    setPhase("drafting");
    const pairs: DraftedPair[] = [];
    for (const candidate of sourced) {
      try {
        const msg = actions.generateOutreachFor(candidate.id);
        if (msg) pairs.push({ candidate, message: msg });
      } catch {
        // Degrade gracefully — a single failed draft never aborts the run.
      }
    }

    if (pairs.length === 0) {
      setPhase("empty");
      return;
    }
    setQueue(pairs);
    setRunKey((k) => k + 1);
    // phase flips to "done" from the RevealStream's onDone once every card
    // has materialized (or instantly, on Skip / prefers-reduced-motion).
  }, [phase, campaignId, campaign, campaignOutreach, actions, integrations]);

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
              Sourced {sourcedCount} · drafted {queue.length} · 0 sent
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
