import type {
  AgentSeat,
  AllocationResult,
  Candidate,
  FleetSettings,
  OutreachLedgerEntry,
  SeatProvider,
  SendWindow,
  SuppressionEntry,
} from "./types";
import { normalizeSuppressionValue } from "./manual-suppression";
import type { Tone } from "./utils";
import { clamp } from "./utils";

/* ============================================================================
   FLEET GUARDRAIL ENGINE
   Coordinates multiple authorized seats so the team scales outreach WITHOUT
   exceeding any single account's official limits and WITHOUT ever contacting
   the same person twice. Every rule here is anti-ban / pro-deliverability:
   conservative caps, warm-up ramps, send windows, human-paced spacing, global
   suppression + de-dupe, and automatic pausing on bounce/complaint spikes.
   ========================================================================== */

export function defaultFleetSettings(): FleetSettings {
  return {
    recontactWindowDays: 90,
    bounceRatePauseThreshold: 0.05, // pause a seat above 5% bounces
    complaintRatePauseThreshold: 0.001, // pause above 0.1% complaints (ESP red line)
    enforceBusinessHours: true,
    jitter: true,
    globalDailyCap: null,
    maxAgents: 300,
  };
}

export function defaultSendWindow(timezone = "CET"): SendWindow {
  return { startHour: 8, endHour: 18, timezone, days: [1, 2, 3, 4, 5] };
}

/** Conservative official-limit guidance per provider (cold-send safe defaults). */
export const PROVIDER_LIMIT_NOTE: Record<SeatProvider, string> = {
  "Microsoft Graph": "Microsoft 365 caps ~10k recipients/day; keep cold sends ≤ 40/day/mailbox warmed.",
  "Gmail API": "Workspace ~2k sends/day; keep cold sends ≤ 40/day/mailbox warmed.",
  SendGrid: "Respect plan limits; warm dedicated IPs gradually.",
  Resend: "Respect plan limits; verify domain (SPF/DKIM/DMARC) before sending.",
  "WhatsApp Cloud": "Cold WhatsApp needs a pre-approved Meta template; keep volume low and honor opt-out.",
  "Twilio SMS": "Honor SMS regulations (opt-in/TCPA); keep cold sends low and include opt-out.",
  "LinkedIn Assisted Manual": "Assisted-manual only: draft, profile deep-link, human copy/paste/send, then record outcome.",
  "LinkedIn Vendor API": "Licensed vendor API only; fails closed until credentials and a signed provider contract exist.",
};

/* ---- Warm-up + capacity --------------------------------------------------- */

export function daysActive(seat: AgentSeat, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(seat.warmupStartedAt).getTime()) / 86_400_000));
}

/** Today's allowed cap: warm-up ramp grows toward the full dailyLimit. */
export function effectiveDailyCap(seat: AgentSeat, now = Date.now()): number {
  if (!seat.warmup) return seat.dailyLimit;
  const ramped = seat.warmupStartCap + seat.warmupStepPerDay * daysActive(seat, now);
  return Math.min(seat.dailyLimit, Math.max(seat.warmupStartCap, ramped));
}

export function seatRemainingToday(seat: AgentSeat, now = Date.now()): number {
  return Math.max(0, effectiveDailyCap(seat, now) - seat.sentToday);
}

export function warmupStage(seat: AgentSeat, now = Date.now()): { day: number; cap: number; full: boolean } {
  const cap = effectiveDailyCap(seat, now);
  return { day: daysActive(seat, now), cap, full: !seat.warmup || cap >= seat.dailyLimit };
}

/* ---- Send window ---------------------------------------------------------- */

export function isWithinSendWindow(seat: AgentSeat, now = new Date(), enforce = true): boolean {
  if (!enforce) return true;
  const w = seat.sendWindow;
  const day = now.getDay();
  const hour = now.getHours();
  return w.days.includes(day) && hour >= w.startHour && hour < w.endHour;
}

/* ---- Health / auto-pause -------------------------------------------------- */

export interface SeatHealthStatus {
  tone: Tone;
  label: string;
  shouldPause: boolean;
  detail: string;
}

export function seatHealthStatus(seat: AgentSeat, settings: FleetSettings): SeatHealthStatus {
  const { bounceRate, complaintRate } = seat.health;
  if (complaintRate > settings.complaintRatePauseThreshold) {
    return {
      tone: "danger",
      label: "Complaint spike",
      shouldPause: true,
      detail: `Complaint rate ${(complaintRate * 100).toFixed(2)}% over the ${(settings.complaintRatePauseThreshold * 100).toFixed(2)}% red line.`,
    };
  }
  if (bounceRate > settings.bounceRatePauseThreshold) {
    return {
      tone: "danger",
      label: "Bounce spike",
      shouldPause: true,
      detail: `Bounce rate ${(bounceRate * 100).toFixed(1)}% over the ${(settings.bounceRatePauseThreshold * 100).toFixed(0)}% threshold.`,
    };
  }
  if (bounceRate > settings.bounceRatePauseThreshold * 0.6) {
    return { tone: "warning", label: "Watch", shouldPause: false, detail: "Bounce rate climbing, keep monitoring." };
  }
  return { tone: "success", label: "Healthy", shouldPause: false, detail: "Deliverability within safe limits." };
}

/** Live sending requires verified domain + explicit live mode (else dry-run). */
export function seatCanSendLive(seat: AgentSeat): { ok: boolean; reason: string } {
  if (seat.mode !== "live") return { ok: false, reason: "Seat in dry-run (mock) mode" };
  if (!seat.domainVerified) return { ok: false, reason: "Domain not verified (SPF/DKIM/DMARC)" };
  return { ok: true, reason: "" };
}

/* ---- Suppression + de-dupe ------------------------------------------------ */

export function suppressionMatch(
  suppression: SuppressionEntry[],
  candidate: Pick<Candidate, "email" | "linkedinUrl" | "phone">,
  now = Date.now(),
): SuppressionEntry | null {
  const email = candidate.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const li = candidate.linkedinUrl.toLowerCase();
  const phone = candidate.phone ? normalizeSuppressionValue("phone", candidate.phone) : null;
  for (const s of suppression) {
    if (s.expiresAt && new Date(s.expiresAt).getTime() < now) continue;
    const v = s.value.toLowerCase();
    if (s.type === "email" && v === email) return s;
    if (s.type === "domain" && domain === v) return s;
    if (s.type === "phone" && phone && phone === normalizeSuppressionValue("phone", s.value)) return s;
    if (s.type === "linkedin" && li && li.includes(v)) return s;
  }
  return null;
}

export function ledgerHasActiveContact(ledger: OutreachLedgerEntry[], candidateId: string): boolean {
  return ledger.some(
    (e) =>
      e.candidateId === candidateId &&
      // "pending_manual" (LinkedIn assisted-manual) is an active claim too —
      // omitting it lets the same candidate be allocated and contacted twice.
      (e.status === "claimed" || e.status === "sent" || e.status === "pending_manual"),
  );
}

export function recentlyContacted(
  ledger: OutreachLedgerEntry[],
  candidateId: string,
  windowDays: number,
  now = Date.now(),
): boolean {
  const cutoff = now - windowDays * 86_400_000;
  return ledger.some(
    (e) =>
      e.candidateId === candidateId &&
      (e.status === "sent" || e.status === "claimed" || e.status === "pending_manual") &&
      new Date(e.at).getTime() >= cutoff,
  );
}

/* ---- Batch allocation (the core coordinator) ----------------------------- */

/**
 * Distribute a pool of candidates across sendable seats:
 *  - suppressed / unsubscribed / do-not-contact → skipped
 *  - already in the ledger or contacted inside the re-contact window → skipped
 *  - never assigns the same candidate to two seats
 *  - load-balances to the seat with the most remaining capacity
 *  - respects per-seat caps, warm-up, windows, and the optional global cap
 * Pure function — returns a plan; the store applies it to the ledger.
 */
export const EMAIL_ALLOCATION_PROVIDERS = new Set([
  "Microsoft Graph",
  "Gmail API",
  "SendGrid",
  "Resend",
]);

export function allocateBatch(
  pool: Candidate[],
  seats: AgentSeat[],
  ledger: OutreachLedgerEntry[],
  suppression: SuppressionEntry[],
  settings: FleetSettings,
  now = new Date(),
): AllocationResult {
  const nowMs = now.getTime();
  const remaining = new Map<string, number>();
  for (const seat of seats) {
    // Planning/claiming respects status, auto-pause health and daily caps.
    // LinkedIn / WhatsApp / SMS seats are not email allocators.
    // The send WINDOW governs when a claimed send actually fires, not whether we
    // can plan it — so allocation works any hour; sends still wait for the window.
    const blocked =
      seat.status !== "active" ||
      !EMAIL_ALLOCATION_PROVIDERS.has(seat.provider) ||
      seatHealthStatus(seat, settings).shouldPause;
    remaining.set(seat.id, blocked ? 0 : seatRemainingToday(seat, nowMs));
  }

  let globalRemaining =
    settings.globalDailyCap != null
      ? Math.max(0, settings.globalDailyCap - seats.reduce((a, s) => a + s.sentToday, 0))
      : Infinity;

  const assignments: AllocationResult["assignments"] = [];
  const skipped: AllocationResult["skipped"] = [];
  const deferred: AllocationResult["deferred"] = [];
  const claimedThisRun = new Set<string>();

  for (const cand of pool) {
    const supp = suppressionMatch(suppression, cand, nowMs);
    if (supp) {
      skipped.push({ candidateId: cand.id, candidateName: cand.name, reason: `Suppressed (${supp.reason || supp.type})` });
      continue;
    }
    if (cand.complianceFlags.doNotContact || cand.complianceFlags.unsubscribed) {
      skipped.push({ candidateId: cand.id, candidateName: cand.name, reason: "Do-not-contact / unsubscribed" });
      continue;
    }
    if (claimedThisRun.has(cand.id) || ledgerHasActiveContact(ledger, cand.id)) {
      skipped.push({ candidateId: cand.id, candidateName: cand.name, reason: "Already contacted by the fleet" });
      continue;
    }
    if (recentlyContacted(ledger, cand.id, settings.recontactWindowDays, nowMs)) {
      skipped.push({ candidateId: cand.id, candidateName: cand.name, reason: `Inside ${settings.recontactWindowDays}-day re-contact window` });
      continue;
    }
    // Belt-and-suspenders: honor lastContactedAt even if the ledger entry is missing.
    if (
      cand.lastContactedAt &&
      nowMs - new Date(cand.lastContactedAt).getTime() < settings.recontactWindowDays * 86_400_000
    ) {
      skipped.push({ candidateId: cand.id, candidateName: cand.name, reason: "Already contacted (re-contact window)" });
      continue;
    }
    if (globalRemaining <= 0) {
      deferred.push({ candidateId: cand.id, candidateName: cand.name, reason: "Global daily cap reached" });
      continue;
    }

    // pick the seat with the most remaining capacity
    let bestSeat: AgentSeat | null = null;
    let bestCap = 0;
    for (const seat of seats) {
      const cap = remaining.get(seat.id) ?? 0;
      if (cap > bestCap) {
        bestCap = cap;
        bestSeat = seat;
      }
    }
    if (!bestSeat || bestCap <= 0) {
      deferred.push({ candidateId: cand.id, candidateName: cand.name, reason: "No seat capacity today" });
      continue;
    }

    assignments.push({ seatId: bestSeat.id, seatName: bestSeat.name, candidateId: cand.id, candidateName: cand.name });
    remaining.set(bestSeat.id, bestCap - 1);
    claimedThisRun.add(cand.id);
    globalRemaining -= 1;
  }

  const fleetCapacityRemaining = Array.from(remaining.values()).reduce((a, b) => a + b, 0);
  return { assignments, deferred, skipped, fleetCapacityRemaining };
}

/* ---- Fleet roll-ups for the dashboard ------------------------------------ */

export interface FleetSummary {
  seats: number;
  activeSeats: number;
  liveSeats: number;
  sentToday: number;
  capacityToday: number;
  remainingToday: number;
  pausedSeats: number;
  avgBounceRate: number;
  avgComplaintRate: number;
}

export function fleetSummary(seats: AgentSeat[], settings: FleetSettings, now = Date.now()): FleetSummary {
  const active = seats.filter((s) => s.status === "active");
  const capacity = active.reduce((a, s) => a + effectiveDailyCap(s, now), 0);
  const sent = seats.reduce((a, s) => a + s.sentToday, 0);
  const remaining = active.reduce((a, s) => a + seatRemainingToday(s, now), 0);
  const paused = seats.filter(
    (s) => s.status === "paused" || seatHealthStatus(s, settings).shouldPause,
  ).length;
  const n = seats.length || 1;
  return {
    seats: seats.length,
    activeSeats: active.length,
    liveSeats: seats.filter((s) => s.mode === "live" && s.domainVerified).length,
    sentToday: sent,
    capacityToday: capacity,
    remainingToday: remaining,
    pausedSeats: paused,
    avgBounceRate: seats.reduce((a, s) => a + s.health.bounceRate, 0) / n,
    avgComplaintRate: seats.reduce((a, s) => a + s.health.complaintRate, 0) / n,
  };
}
