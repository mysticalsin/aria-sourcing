"use client";

import * as React from "react";
import { HealthStrip } from "@/components/settings/integration-connection-primitives";
import { useSeats, useFleetSummary, useActions } from "@/lib/store";
import { isBrowserComputerSeat } from "@/lib/campaign-seat-attach";
import type { Tone } from "@/lib/utils";

/**
 * Fleet readiness strip — email seats need mailbox+verify; LinkedIn Browser
 * Computer seats need fleet-probed sessionHealthy (never invent send-ready).
 */
export function FleetHealthStrip() {
  const seats = useSeats();
  const s = useFleetSummary();
  const actions = useActions();
  const [liHealthyBySeat, setLiHealthyBySeat] = React.useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/fleet/computers", { credentials: "same-origin" });
        if (cancelled) return;
        if (!res.ok) {
          // Fail closed: clear probed-true so strip cannot stay green while BE is down.
          setLiHealthyBySeat(new Map());
          return;
        }
        const data = (await res.json()) as {
          computers?: { seatId?: string | null; sessionHealthy?: boolean | null }[];
          browserSeatBindings?: Array<{
            id: string;
            name?: string;
            computerId?: string | null;
            status?: string;
            assignedCampaignIds?: string[];
          }>;
        };
        const m = new Map<string, boolean>();
        for (const c of data.computers ?? []) {
          const sid = (c.seatId ?? "").trim();
          if (!sid || sid === "__orphan__") continue;
          // Seat-owned only; true only when probed healthy.
          m.set(sid, c.sessionHealthy === true);
        }
        if (!cancelled) setLiHealthyBySeat(m);
        // Durable → Hermes roster (append missing desks + patch attach).
        actions.ingestDurableBrowserBindings(data.browserSeatBindings);
      } catch {
        if (!cancelled) setLiHealthyBySeat(new Map());
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [actions, seats]);

  const needsMailbox = seats.filter(
    (seat) => !isBrowserComputerSeat(seat) && !seat.connectedAccount,
  ).length;
  const needsVerify = seats.filter(
    (seat) =>
      !isBrowserComputerSeat(seat) && seat.connectedAccount && !seat.domainVerified,
  ).length;
  const liveReady = seats.filter((seat) => {
    if (isBrowserComputerSeat(seat)) {
      // LI desks: live mode + probed healthy only — never mailbox theater.
      return seat.mode === "live" && liHealthyBySeat.get(seat.id) === true;
    }
    return seat.mode === "live" && seat.connectedAccount && seat.domainVerified;
  }).length;
  const liUnverified = seats.filter(
    (seat) =>
      isBrowserComputerSeat(seat) &&
      seat.mode === "live" &&
      liHealthyBySeat.get(seat.id) !== true,
  ).length;

  const readyPct = s.seats ? (liveReady / s.seats) * 100 : 0;
  let tone: Tone =
    liveReady > 0 ? "success" : needsMailbox > 0 || liUnverified > 0 ? "warning" : "neutral";
  if (s.pausedSeats > s.seats / 2 && s.seats > 0) tone = "warning";

  return (
    <HealthStrip
      title="Fleet readiness"
      primary={`${liveReady} send-ready · ${s.activeSeats} active`}
      secondary={[
        needsMailbox > 0 ? `${needsMailbox} need mailbox` : "",
        needsVerify > 0 ? `${needsVerify} need domain verify` : "",
        liUnverified > 0 ? `${liUnverified} LI need Take→login→Release` : "",
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
