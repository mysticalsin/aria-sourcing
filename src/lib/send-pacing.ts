/**
 * Real send pacing for LinkedIn (reusable for other seats).
 * Enforces min-gap + jitter and business-hour windows that used to be UI theater.
 */

import type { AgentSeat, FleetSettings } from "@/lib/types";
import { isWithinSendWindow } from "@/lib/fleet";

export type PaceBlockReason =
  | "min_gap"
  | "business_hours"
  | "daily_cap"
  | "seat_paused"
  | "session_unhealthy";

export type PaceDecision = {
  ok: boolean;
  reason?: PaceBlockReason;
  detail?: string;
  nextEligibleAt?: string;
  gapMinutes?: number;
};

export function pacingJitterMinutes(seed: string, jitterMaxMinutes: number): number {
  if (jitterMaxMinutes <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % (jitterMaxMinutes + 1);
}

export function effectiveMinGapMinutes(
  seat: Pick<AgentSeat, "minGapMinutes" | "id">,
  settings: Pick<FleetSettings, "jitter">,
  seed = seat.id,
): number {
  const base = Math.max(0, seat.minGapMinutes ?? 0);
  const jitter = settings.jitter
    ? pacingJitterMinutes(seed, Math.min(15, Math.max(3, Math.floor(base / 3) || 3)))
    : 0;
  return base + jitter;
}

/** Conservative LinkedIn Browser Computer defaults (much lower than email). */
export const LINKEDIN_BROWSER_SEAT_DEFAULTS = {
  dailyLimit: 15,
  warmup: true,
  warmupStartCap: 5,
  warmupStepPerDay: 2,
  minGapMinutes: 18,
} as const;

export function evaluateSendPace(opts: {
  seat: AgentSeat;
  settings: FleetSettings;
  now?: Date;
  seed?: string;
  /** When provided (Browser Computer path), only `true` may send. */
  sessionHealthy?: boolean | null;
}): PaceDecision {
  const now = opts.now ?? new Date();
  const { seat, settings } = opts;

  if (seat.status !== "active") {
    return { ok: false, reason: "seat_paused", detail: `Seat status is ${seat.status}.` };
  }

  // Caller passed an explicit session flag — fail closed unless probed healthy.
  if (opts.sessionHealthy !== undefined && opts.sessionHealthy !== true) {
    return {
      ok: false,
      reason: "session_unhealthy",
      detail:
        opts.sessionHealthy === false
          ? "LinkedIn session unhealthy — Take control and log in, then Release."
          : "LinkedIn session unverified — Take control, log in, then Release to probe.",
    };
  }

  const daysWarm = Math.max(
    0,
    Math.floor((now.getTime() - new Date(seat.warmupStartedAt).getTime()) / 86_400_000),
  );
  const cap = seat.warmup
    ? Math.min(
        seat.dailyLimit,
        Math.max(seat.warmupStartCap, seat.warmupStartCap + seat.warmupStepPerDay * daysWarm),
      )
    : seat.dailyLimit;

  if (seat.sentToday >= cap) {
    return {
      ok: false,
      reason: "daily_cap",
      detail: `Daily cap reached (${seat.sentToday}/${cap}).`,
    };
  }

  if (settings.enforceBusinessHours && !isWithinSendWindow(seat, now, true)) {
    const w = seat.sendWindow;
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(w.startHour);
    if (next <= now) next.setDate(next.getDate() + 1);
    while (!w.days.includes(next.getDay())) {
      next.setDate(next.getDate() + 1);
    }
    return {
      ok: false,
      reason: "business_hours",
      detail: `Outside send window (${w.startHour}:00–${w.endHour}:00 ${w.timezone}).`,
      nextEligibleAt: next.toISOString(),
    };
  }

  const gap = effectiveMinGapMinutes(seat, settings, opts.seed ?? seat.id);
  if (seat.lastSendAt && gap > 0) {
    const elapsedMin = (now.getTime() - new Date(seat.lastSendAt).getTime()) / 60_000;
    if (elapsedMin < gap) {
      const waitMs = (gap - elapsedMin) * 60_000;
      return {
        ok: false,
        reason: "min_gap",
        detail: `Human pacing: wait ${Math.ceil(gap - elapsedMin)} more minute(s) (gap ${gap}m).`,
        nextEligibleAt: new Date(now.getTime() + waitMs).toISOString(),
        gapMinutes: gap,
      };
    }
  }

  return { ok: true, gapMinutes: gap };
}
