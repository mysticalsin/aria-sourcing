"use client";

import { HealthStrip } from "@/components/settings/integration-connection-primitives";
import { useSeats, useFleetSummary } from "@/lib/store";
import { seatMailboxLiveReady, seatNeedsDomainVerify } from "@/lib/fleet";
import type { Tone } from "@/lib/utils";

export function FleetHealthStrip() {
  const seats = useSeats();
  const s = useFleetSummary();

  const needsMailbox = seats.filter((seat) => !seat.connectedAccount).length;
  const needsVerify = seats.filter((seat) => seatNeedsDomainVerify(seat)).length;
  const liveReady = seats.filter((seat) => seatMailboxLiveReady(seat)).length;

  const readyPct = s.seats ? (liveReady / s.seats) * 100 : 0;
  let tone: Tone = liveReady > 0 ? "success" : needsMailbox > 0 ? "warning" : "neutral";
  if (s.pausedSeats > s.seats / 2 && s.seats > 0) tone = "warning";

  return (
    <HealthStrip
      title="Fleet readiness"
      primary={`${s.liveSeats} live · ${s.activeSeats} active`}
      secondary={[
        needsMailbox > 0 ? `${needsMailbox} need mailbox` : "",
        needsVerify > 0 ? `${needsVerify} need domain verify` : "",
        s.pausedSeats > 0 ? `${s.pausedSeats} paused` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      numerator={liveReady}
      denominator={s.seats || 1}
      progressPct={readyPct}
      tone={tone}
      ariaLabel={`${liveReady} of ${s.seats} agents ready to send live`}
    />
  );
}
