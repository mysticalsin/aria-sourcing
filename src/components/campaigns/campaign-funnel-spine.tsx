"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Booking, Candidate, ClassifiedReply, OutreachMessage } from "@/lib/types";

export type FunnelCounts = {
  sourced: number;
  scored: number;
  approved: number;
  sent: number;
  replied: number;
  booked: number;
};

export function deriveCampaignFunnelCounts(input: {
  candidates: Candidate[];
  outreach: OutreachMessage[];
  replies: ClassifiedReply[];
  bookings?: Booking[];
}): FunnelCounts {
  const { candidates, outreach, replies, bookings = [] } = input;
  const candidateIds = new Set(candidates.map((c) => c.id));

  const sourced = candidates.length;
  const scored = candidates.filter((c) => typeof c.matchScore === "number" && c.matchScore > 0).length;
  const approved = outreach.filter(
    (m) =>
      candidateIds.has(m.candidateId) &&
      (m.status === "Approved" ||
        m.status === "Scheduled" ||
        m.status === "Pending Manual Send" ||
        Boolean(m.sentAt)),
  ).length;
  const sent = outreach.filter(
    (m) => candidateIds.has(m.candidateId) && (Boolean(m.sentAt) || m.status === "Scheduled"),
  ).length;
  const replied = replies.filter((r) => candidateIds.has(r.candidateId)).length;
  const bookedFromCandidates = candidates.filter(
    (c) => c.stage === "Booked" || c.stage === "Interviewed" || Boolean(c.booking),
  ).length;
  const bookedFromBookings = bookings.filter((b) => candidateIds.has(b.candidateId)).length;
  const booked = Math.max(bookedFromCandidates, bookedFromBookings);

  return { sourced, scored, approved, sent, replied, booked };
}

const STEPS: { key: keyof FunnelCounts; label: string }[] = [
  { key: "sourced", label: "Sourced" },
  { key: "scored", label: "Scored" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "replied", label: "Replied" },
  { key: "booked", label: "Booked" },
];

/**
 * Campaign funnel spine — sourced → scored → approved → sent → replied → booked.
 */
export function CampaignFunnelSpine(props: {
  candidates: Candidate[];
  outreach: OutreachMessage[];
  replies: ClassifiedReply[];
  bookings?: Booking[];
  className?: string;
  counts?: FunnelCounts;
}) {
  const counts = React.useMemo(
    () =>
      props.counts ??
      deriveCampaignFunnelCounts({
        candidates: props.candidates,
        outreach: props.outreach,
        replies: props.replies,
        bookings: props.bookings,
      }),
    [props.candidates, props.outreach, props.replies, props.bookings, props.counts],
  );

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-canvas/40 px-4 py-3",
        props.className,
      )}
      aria-label="Campaign funnel"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Funnel</p>
      <ol className="flex flex-wrap items-center gap-2 sm:gap-1">
        {STEPS.map((step, i) => (
          <li key={step.key} className="flex items-center gap-2 sm:gap-1">
            <div className="min-w-[4.5rem] rounded-xl bg-surface px-3 py-2 text-center ring-1 ring-inset ring-line">
              <p className="text-lg font-bold tabular-nums text-ink">{counts[step.key]}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{step.label}</p>
            </div>
            {i < STEPS.length - 1 ? (
              <span className="hidden text-muted sm:inline" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
