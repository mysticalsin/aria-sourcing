"use client";

import * as React from "react";
import type { AgentSeat, FleetSettings } from "@/lib/types";
import { effectiveMinGapMinutes } from "@/lib/send-pacing";
import { cn } from "@/lib/utils";

type AuditLike = {
  at: string;
  computerId: string;
  action: string;
  detail: string;
};

function seatPacingLine(
  seat: AgentSeat,
  fleet?: Pick<FleetSettings, "jitter" | "enforceBusinessHours">,
  lastHelp?: AuditLike | null,
): string {
  const gap = effectiveMinGapMinutes(seat, { jitter: fleet?.jitter ?? true });
  const sendsPerHour =
    gap > 0 ? Math.max(0.1, Math.round((60 / gap) * 10) / 10) : null;
  const bits = [
    `${seat.name}: gap ~${gap}m`,
    sendsPerHour != null ? `~${sendsPerHour}/hr` : null,
    seat.sentToday != null ? `${seat.sentToday} sent today` : null,
    seat.lastSendAt
      ? `last ${new Date(seat.lastSendAt).toLocaleString()}`
      : "no sends yet",
    lastHelp
      ? `help ${new Date(lastHelp.at).toLocaleString()}`
      : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

/**
 * Ban-risk strip — honest pacing signal for LinkedIn Browser Computer agents.
 * Per-desk help_requested (matched by computerId) — never collapses N desks onto seats[0].
 */
export function BanRiskStrip(props: {
  seats: AgentSeat[];
  audits?: AuditLike[];
  fleet?: Pick<FleetSettings, "jitter" | "enforceBusinessHours">;
  className?: string;
}) {
  const seats = props.seats;
  const helpByComputer = React.useMemo(() => {
    const map = new Map<string, AuditLike>();
    const helps = (props.audits ?? [])
      .filter(
        (a) => a.action === "help_requested" || /help_requested|authwall|login/i.test(a.detail),
      )
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const h of helps) {
      const id = (h.computerId ?? "").trim();
      if (id && !map.has(id)) map.set(id, h);
    }
    return map;
  }, [props.audits]);

  if (seats.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-warning/25 bg-warning-soft/10 px-4 py-3 text-xs text-ink-soft",
        props.className,
      )}
      role="status"
    >
      <p className="font-semibold text-ink">Ban-risk pacing</p>
      <ul className="mt-1 space-y-0.5">
        {seats.map((seat) => {
          const cid = (seat.computerId ?? "").trim();
          const help = cid ? helpByComputer.get(cid) ?? null : null;
          return <li key={seat.id}>{seatPacingLine(seat, props.fleet, help)}</li>;
        })}
      </ul>
    </div>
  );
}
