"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Visualizes where a follow-up-due candidate sits in the outreach sequence:
 *  a compact step ladder (Intro -> #1 -> #2 -> ...) with the step about to be
 *  drafted highlighted, plus how long they've gone silent. Pure
 *  presentational -- reads only the two `FollowUpDueItem` fields it needs and
 *  never touches the store. The highlight uses Tailwind's `animate-pulse`,
 *  which the global `prefers-reduced-motion` rule in globals.css already
 *  neutralizes site-wide, so no separate JS media-query check is needed here.
 *
 *  `nextSequenceStep` is the raw `OutreachMessage.sequenceStep` the next
 *  draft will use; the intro touch always claims step 1 (see
 *  `newOutreachMessage`'s default), so the human-facing follow-up ordinal is
 *  `nextSequenceStep - 1`. */
export function SequenceLadder({
  nextSequenceStep,
  daysSinceContact,
  className,
}: {
  nextSequenceStep: number;
  daysSinceContact: number;
  className?: string;
}) {
  const followUpNumber = Math.max(1, nextSequenceStep - 1);
  const days = Math.floor(daysSinceContact);

  // Cap the visible rungs so a candidate deep into a long sequence doesn't
  // turn the row into an unreadable wall of chips -- collapse everything
  // before the most recent prior follow-up behind a "…" rung instead.
  const MAX_VISIBLE_PRIOR = 2;
  const priorCount = followUpNumber - 1;
  const priorSteps =
    priorCount <= MAX_VISIBLE_PRIOR ? Array.from({ length: priorCount }, (_, i) => i + 1) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <div className="flex items-center gap-1 text-[11px] font-semibold" aria-hidden>
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-muted">Intro</span>
        {priorSteps === null ? (
          <>
            <span className="text-muted">→</span>
            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-muted">…</span>
          </>
        ) : (
          priorSteps.map((n) => (
            <React.Fragment key={n}>
              <span className="text-muted">→</span>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-muted">#{n}</span>
            </React.Fragment>
          ))
        )}
        <span className="text-muted">→</span>
        <span className="animate-pulse rounded-full bg-aqua-soft px-2 py-0.5 text-aqua ring-1 ring-inset ring-aqua/30">
          #{followUpNumber}
        </span>
      </div>
      <span className="text-xs font-medium text-muted">
        Follow-up #{followUpNumber} · {days}d silent
      </span>
    </div>
  );
}
