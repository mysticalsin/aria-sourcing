import type { HermesState, OutreachLedgerEntry } from "./types";
import { colorForAgent, type OfficeAgent } from "./floor3d";
import { bookingInterviewTitle } from "./booking-status";
import { isRealSendFact } from "./metrics";

/* ============================================================================
   Autopilot Replay (DVR) — a purely derived read model. Nothing here is
   persisted: every call rebuilds (or reads a cached rebuild of) a time-ordered
   event stream from data that already lives in the store (candidates,
   outreach, replies, bookings, reports, activities, the outreach ledger).
   The /replay page scrubs a cursor across this stream; it never mutates it.
   ========================================================================== */

/** Only the slice of HermesState this module actually reads — same
 *  "stateLike" convention /floor uses (src/app/floor/page.tsx) to assemble a
 *  narrow object from individual selector hooks instead of the raw store
 *  context, so /replay never needs `useHermes()` or the module-private
 *  `EMPTY` fallback. */
export type ReplaySourceState = Pick<
  HermesState,
  "candidates" | "outreach" | "replies" | "bookings" | "reports" | "activities" | "seats" | "ledger"
>;

export type ReplayEventKind =
  | "source"
  | "score"
  | "draft"
  | "approve"
  | "reply"
  | "book"
  | "report";

export interface ReplayEvent {
  /** Epoch ms — parsed from the entity's own ISO timestamp (or a stable
   *  derived instant when no dedicated timestamp exists — see buildEventStream). */
  at: number;
  kind: ReplayEventKind;
  candidateId?: string;
  /** The AgentSeat that did the work, when known (see buildCandidateSeatMap). */
  seatId?: string;
  label: string;
}

/** How long a seat renders "working" on either side of an event's real
 *  timestamp once the playhead is near it. Mirrors PULSE_MS in
 *  src/lib/floor3d.ts (kept as a local,
 *  duplicated constant rather than an import so this module has zero
 *  dependency on the 3D scene subsystem). */
const WORKING_WINDOW_MS = 4000;

function toMs(iso: string | null | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

/**
 * Which seat "owns" a candidate for replay purposes — the seat behind the
 * candidate's EARLIEST logged outreach-ledger contact attempt. The ledger
 * (OutreachLedgerEntry.seatId) is the only place a real seat is attributed to
 * a candidate; everything else (OutreachMessage, ClassifiedReply, Booking)
 * carries no seatId. Candidates with no ledger history yet simply have no
 * entry in the returned map (seatId stays undefined for their events).
 */
function buildCandidateSeatMap(ledger: OutreachLedgerEntry[]): Map<string, string> {
  const earliest = new Map<string, { seatId: string; at: number }>();
  for (const entry of ledger) {
    const at = toMs(entry.at, Number.POSITIVE_INFINITY);
    const existing = earliest.get(entry.candidateId);
    if (!existing || at < existing.at) {
      earliest.set(entry.candidateId, { seatId: entry.seatId, at });
    }
  }
  const out = new Map<string, string>();
  for (const [candidateId, v] of earliest) out.set(candidateId, v.seatId);
  return out;
}

/** Precomputed-stream cache, keyed by state object identity. The caller only
 *  hands in a new `stateLike` object when something actually changes (it's
 *  built once per render from selector hooks), so this turns "rebuild the
 *  whole stream" into an O(1) hit on every call made between store updates
 *  (i.e. every animation frame while scrubbing/playing). */
const streamCache = new WeakMap<ReplaySourceState, ReplayEvent[]>();

/**
 * Synthesize a time-ordered event stream from existing per-entity timestamps.
 * No new data is invented: every event's `at` traces back to a real ISO
 * timestamp already on the record, except the per-candidate "score" event
 * (Candidate has no dedicated scoredAt — scoring happens inline at sourcing
 * time) which is pinned 1ms after that same candidate's real `createdAt` so
 * ordering is deterministic without colliding with the "source" event.
 */
export function buildEventStream(state: ReplaySourceState): ReplayEvent[] {
  const cached = streamCache.get(state);
  if (cached) return cached;

  const events: ReplayEvent[] = [];
  const candidateSeat = buildCandidateSeatMap(state.ledger);
  const candidateById = new Map(state.candidates.map((c) => [c.id, c]));

  for (const c of state.candidates) {
    const sourcedAt = toMs(c.createdAt, 0);
    const seatId = candidateSeat.get(c.id);
    events.push({
      at: sourcedAt,
      kind: "source",
      candidateId: c.id,
      seatId,
      label: `${c.name} sourced from ${c.sourcePlatform}`,
    });
    events.push({
      at: sourcedAt + 1,
      kind: "score",
      candidateId: c.id,
      seatId,
      label: `${c.name} scored ${Math.round(c.matchScore)}`,
    });
  }

  // Fallback contact claim for candidates with lastContactedAt but no outreach
  // row — seed/legacy only. Never label as a live send without isRealSendFact.
  const candidatesWithOutreach = new Set(state.outreach.map((m) => m.candidateId));
  for (const c of state.candidates) {
    if (c.lastContactedAt && !candidatesWithOutreach.has(c.id)) {
      events.push({
        at: toMs(c.lastContactedAt, toMs(c.createdAt, 0)),
        kind: "approve",
        candidateId: c.id,
        seatId: candidateSeat.get(c.id),
        label: `${c.name} contact claimed (no outreach receipt)`,
      });
    }
  }

  for (const m of state.outreach) {
    const name = candidateById.get(m.candidateId)?.name ?? m.candidateId;
    const seatId = candidateSeat.get(m.candidateId);
    const draftAt = toMs(m.createdAt, 0);
    events.push({
      at: draftAt,
      kind: "draft",
      candidateId: m.candidateId,
      seatId,
      label: `${m.channel} draft for ${name}: ${m.subject}`,
    });
    if (m.status === "Approved" || m.status === "Pending Manual Send" || m.status === "Scheduled") {
      const approvedAt = Math.max(toMs(m.sentAt ?? m.scheduledFor, draftAt + 1), draftAt + 1);
      const realSend = isRealSendFact(m);
      events.push({
        at: approvedAt,
        kind: "approve",
        candidateId: m.candidateId,
        seatId,
        label: realSend
          ? `${m.channel} sent to ${name}: ${m.subject}`
          : m.dryRun === true && m.sentAt
            ? `${m.channel} approved (dry-run) for ${name}: ${m.subject}`
            : `${m.channel} approved for ${name}: ${m.subject}`,
      });
    }
  }

  for (const r of state.replies) {
    const name = candidateById.get(r.candidateId)?.name ?? r.candidateId;
    events.push({
      at: toMs(r.receivedAt, 0),
      kind: "reply",
      candidateId: r.candidateId,
      seatId: candidateSeat.get(r.candidateId),
      label: `${r.intent} reply from ${name}`,
    });
  }

  for (const b of state.bookings) {
    events.push({
      at: toMs(b.createdAt, 0),
      kind: "book",
      candidateId: b.candidateId,
      seatId: candidateSeat.get(b.candidateId),
      label: `${bookingInterviewTitle(b, b.candidateName)}${b.interviewer ? ` with ${b.interviewer}` : ""}`,
    });
  }

  for (const rep of state.reports) {
    events.push({
      at: toMs(rep.generatedAt, 0),
      kind: "report",
      label: `Weekly report generated: ${rep.campaignTitle}`,
    });
  }

  // Campaign-wide re-score sweeps (the only "score" Activity the store ever
  // logs — see updateCampaign in store.ts) are genuinely new information not
  // captured anywhere above, so they're folded in too. Per-candidate outreach/
  // reply/booking Activities are deliberately NOT replayed here — they'd just
  // be near-duplicate timestamps of the authoritative records already added
  // above (candidate/outreach/reply/booking), and would flicker the timeline
  // with double dots for the same real-world event.
  for (const act of state.activities) {
    if (act.type !== "score") continue;
    events.push({
      at: toMs(act.createdAt, 0),
      kind: "score",
      label: act.title,
    });
  }

  events.sort((a, b) => a.at - b.at);
  streamCache.set(state, events);
  return events;
}

/** Index of the first event with `at > t` (i.e. count of events with `at <= t`). */
function upperBound(events: ReplayEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first event with `at >= t`. */
function lowerBound(events: ReplayEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].at < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Deterministic hash of an event into [0, n) — used only as a last resort
 *  when an event has no real seatId (no ledger history for its candidate,
 *  or it's a candidate-less report/re-score event), so some robot still
 *  reacts instead of the floor staying silent. Mirrors the same
 *  hash-a-fallback-responder idea as pickResponderIndex in
 *  src/lib/floor3d.ts, kept local since the event shapes differ. */
function hashEvent(e: ReplayEvent, n: number): number {
  if (n <= 0) return 0;
  const key = `${e.kind}:${e.candidateId ?? ""}:${e.label}:${e.at}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % n;
}

export interface ReplayStateAt {
  revealedCandidateIds: Set<string>;
  /** All events revealed up to the cursor (`at <= cursorMs`), stream order. */
  events: ReplayEvent[];
  agents: OfficeAgent[];
}

/**
 * The revealed subset of the stream at `cursorMs`, plus a synthetic
 * OfficeAgent[] for the 3D floor: idle by default, "working" for whichever
 * seat(s) have an event within ±WORKING_WINDOW_MS of the cursor. Binary-
 * searches the (cached) precomputed stream — no re-scan of the full history
 * per call.
 */
export function replayStateAt(state: ReplaySourceState, cursorMs: number): ReplayStateAt {
  const stream = buildEventStream(state);

  const revealedCount = upperBound(stream, cursorMs);
  const revealed = stream.slice(0, revealedCount);
  const revealedCandidateIds = new Set<string>();
  for (const e of revealed) if (e.candidateId) revealedCandidateIds.add(e.candidateId);

  const employees = state.seats.slice(1); // index 0 = CEO (src/lib/floor3d.ts convention)
  const workingSeatIds = new Set<string>();
  const lo = lowerBound(stream, cursorMs - WORKING_WINDOW_MS);
  const hi = upperBound(stream, cursorMs + WORKING_WINDOW_MS);
  for (let i = lo; i < hi; i += 1) {
    const e = stream[i];
    const seatId = e.seatId ?? (employees.length > 0 ? employees[hashEvent(e, employees.length)].id : undefined);
    if (seatId) workingSeatIds.add(seatId);
  }

  const agents: OfficeAgent[] = state.seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    status: workingSeatIds.has(seat.id) ? "working" : "idle",
    color: seat.color ?? colorForAgent(index),
    position: index === 0 ? "ceo" : "employee",
    provider: seat.provider,
  }));

  return { revealedCandidateIds, events: revealed, agents };
}
