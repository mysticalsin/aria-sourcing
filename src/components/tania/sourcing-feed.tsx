"use client";

import * as React from "react";
import { Badge, Card, CardBody, Progress } from "@/components/ui";
import { RevealStream } from "@/components/reveal/reveal-stream";
import { useTypewriter } from "@/components/reveal/use-typewriter";
import { useCountUp } from "@/components/reveal/use-count-up";
import { FitRadar } from "@/components/charts/fit-radar";
import { emit } from "@/lib/agent-events";
import type { Candidate } from "@/lib/types";
import { initialsFrom, scoreTone, toneForStage } from "@/lib/utils";

/**
 * One materializing card for a single just-sourced candidate: the name types
 * out, the fit score counts up, and the six-spoke radar draws itself from the
 * candidate's REAL `matchBreakdown`. This is presentation only — every value
 * here is read straight off the already-committed `Candidate` record that
 * `sourceNextBatch` produced; nothing is computed, re-scored, or randomised.
 */
function SourcedCandidateCard({
  candidate,
  campaignId,
}: {
  candidate: Candidate;
  campaignId?: string;
}) {
  const { text: typedName, done: nameTyped } = useTypewriter(candidate.name, { speed: 28 });
  const displayScore = useCountUp(Math.round(candidate.matchScore), { durationMs: 900 });
  const emittedRef = React.useRef(false);

  // Fire a lightweight per-card bus event the instant this candidate
  // materializes, so the 3D floor / HUD can react per-candidate as the feed
  // streams. This carries no `count` field — `sourceNextBatch` already
  // emitted the one authoritative batch-total `source` event the moment it
  // committed (store.ts, right after the commit()) — so nothing here can
  // double-count a real total, it only adds a per-card ping for animation.
  React.useEffect(() => {
    if (emittedRef.current) return;
    emittedRef.current = true;
    emit({ kind: "source", candidateName: candidate.name, campaignId });
  }, [candidate.name, campaignId]);

  const initials = candidate.avatarInitials || initialsFrom(candidate.name);

  return (
    <Card className="overflow-hidden">
      <CardBody className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0 space-y-2.5">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-sm font-bold text-ink-soft"
              aria-hidden
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-ink">
                {typedName}
                {!nameTyped && (
                  <span aria-hidden className="ml-0.5 animate-pulse text-muted">
                    ▍
                  </span>
                )}
              </p>
              <p className="truncate text-sm text-muted">
                {candidate.currentTitle} · {candidate.currentCompany}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneForStage(candidate.stage)} size="sm" dot>
              {candidate.stage}
            </Badge>
            <span className="text-xs text-muted">{candidate.sourcePlatform}</span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span
              className="text-lg font-extrabold tabular-nums text-ink"
              aria-label={`Fit score ${Math.round(candidate.matchScore)} of 100`}
            >
              {Math.round(displayScore)}
            </span>
            <Progress
              value={displayScore}
              tone={scoreTone(candidate.matchScore)}
              className="w-32"
              aria-label={`Fit score ${Math.round(candidate.matchScore)} of 100`}
            />
          </div>
        </div>
        <FitRadar matchBreakdown={candidate.matchBreakdown} size={152} label={candidate.name} />
      </CardBody>
    </Card>
  );
}

export interface SourcingFeedProps {
  /** The just-sourced batch — the unchanged, already-committed result of
   *  `sourceNextBatch` (e.g. `res.accepted`). Never re-derived or re-scored
   *  here; this component only stages the reveal of data that already exists
   *  in the store. */
  candidates: Candidate[];
  /** Threaded into each card's per-candidate bus event (see 1.1's
   *  `AgentEvent.campaignId`). Optional — omit if the batch isn't scoped to
   *  a single campaign context. */
  campaignId?: string;
  className?: string;
}

/**
 * Streams a just-sourced batch in one card at a time (~1 / 400ms) instead of
 * resolving atomically — toasts become a machine you watch. Fully skippable
 * via `RevealStream`'s built-in Skip control so a 40+ candidate batch never
 * drags, and honors `prefers-reduced-motion` end to end (inherited from
 * `RevealStream` + `useTypewriter` + `useCountUp` + `FitRadar`, each of which
 * renders its final state immediately with no animation in that mode).
 */
export function SourcingFeed({ candidates, campaignId, className }: SourcingFeedProps) {
  if (candidates.length === 0) return null;
  return (
    <RevealStream
      items={candidates}
      keyExtractor={(c) => c.id}
      renderItem={(c) => <SourcedCandidateCard candidate={c} campaignId={campaignId} />}
      staggerMs={400}
      className={className}
      itemClassName="mb-3 last:mb-0"
    />
  );
}
