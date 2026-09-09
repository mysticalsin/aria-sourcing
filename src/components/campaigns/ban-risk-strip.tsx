"use client";

import * as React from "react";
import type { AgentSeat } from "@/lib/types";
import { effectiveMinGapMinutes } from "@/lib/send-pacing";
import type { FleetSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

type AuditLike = {
  at: string;
  computerId: string;
  action: string;
  detail: string;
};

/**
 * Ban-risk strip — honest pacing signal for LinkedIn Browser Computer agents.
 * Shows sends/hour estimate, last help_requested, and effective gap.
 */
export function BanRiskStrip(props: {
  seats: AgentSeat[];
  audits?: AuditLike[];
  fleet?: Pick<FleetSettings, "jitter" | "enforceBusinessHours">;
  className?: string;
}) {
  const seat = props.seats[0];
  const gap = seat
    ? effectiveMinGapMinutes(seat, { jitter: props.fleet?.jitter ?? true })
    : null;
  const sendsPerHour =
    gap != null && gap > 0 ? Math.max(0.1, Math.round((60 / gap) * 10) / 10) : null;

  const lastHelp = React.useMemo(() => {
    const helps = (props.audits ?? [])
      .filter((a) => a.action === "help_requested" || /help_requested|authwall|login/i.test(a.detail))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return helps[0] ?? null;
  }, [props.audits]);

  if (!seat) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-warning/25 bg-warning-soft/10 px-4 py-3 text-xs text-ink-soft",
        props.className,
      )}
      role="status"
    >
      <p className="font-semibold text-ink">Ban-risk pacing</p>
      <p className="mt-1">
        Gap ~{gap ?? "—"}m
        {sendsPerHour != null ? ` · ~${sendsPerHour} sends/hour max` : ""}
        {seat.sentToday != null ? ` · ${seat.sentToday} sent today` : ""}
        {seat.lastSendAt
          ? ` · last send ${new Date(seat.lastSendAt).toLocaleString()}`
          : " · no sends yet"}
      </p>
      <p className="mt-1 text-muted">
        {lastHelp
          ? `Last help_requested: ${new Date(lastHelp.at).toLocaleString()} — ${lastHelp.detail.slice(0, 120)}`
          : "No help_requested audits in the recent trail."}
      </p>
    </div>
  );
}
