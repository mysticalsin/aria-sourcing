import type { AgentSeat, HermesState } from "./types";
import type { Tone } from "./utils";
import { roleProfile } from "./roles";
import { applyConfidentiality, hasOutreachPurpose } from "./confidential";
import { bookingNeedsCalendar } from "./booking-status";
import { seatHealthStatus, warmupStage } from "./fleet";

/* ============================================================================
   Operations-floor model — derives what each agent is working on from real
   workspace state (pending drafts, interested candidates, sourced pool).
   Stable across renders (no time-based flicker); liveliness comes from CSS.
   Never invent busy work via seat-id hash.
   ========================================================================== */

export type AgentActivityState = "sourcing" | "outreach" | "booking" | "warming" | "idle" | "paused";

export interface AgentActivity {
  state: AgentActivityState;
  label: string; // "Sourcing Murex consultants"
  detail: string; // campaign / context line
  focusName: string | null; // current candidate (confidentiality-masked)
  contacted: number; // candidates this seat has touched (ledger)
  busy: boolean; // animate when true
  tone: Tone;
}

const STATE_TONE: Record<AgentActivityState, Tone> = {
  sourcing: "electric",
  outreach: "tangerine",
  booking: "violet",
  warming: "warning",
  idle: "neutral",
  paused: "danger",
};

function hash(s: string): number {
  return s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
}

/** Floor helpers accept a full HermesState or the narrow "stateLike" slice
 *  /floor assembles from selector hooks. Missing arrays must not crash the page. */
function arr<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function agentActivity(seat: AgentSeat, state: HermesState, now = Date.now()): AgentActivity {
  const ledger = arr(state.ledger);
  const campaignsAll = arr(state.campaigns);
  const outreach = arr(state.outreach);
  const candidates = arr(state.candidates);
  const settings = state.settings;
  const confidentialityMode = settings?.confidentialityMode === true;

  const contacted = ledger.filter(
    (l) => l.seatId === seat.id && (l.status === "sent" || l.status === "claimed"),
  ).length;

  const make = (s: AgentActivityState, label: string, detail: string, focusName: string | null = null, busy = false): AgentActivity => ({
    state: s,
    label,
    detail,
    focusName,
    contacted,
    busy,
    tone: STATE_TONE[s],
  });

  if (seat.status === "disabled") return make("idle", "Offline", "Agent disabled");
  if (seat.status === "paused") return make("paused", "Paused", "Paused by operator");
  if (settings?.fleet && seatHealthStatus(seat, settings.fleet).shouldPause)
    return make("paused", "Auto-paused", "Deliverability guardrail tripped");

  const ws = warmupStage(seat, now);
  if (!ws.full) return make("warming", "Warming up", `Day ${ws.day} · cap ${ws.cap}/day`, null, true);

  const campaigns = campaignsAll.filter((c) => !["Filled", "Paused"].includes(c.status));
  if (campaigns.length === 0) return make("idle", "Standing by", "No active campaigns");

  const maskName = (name: string, stage: string): string =>
    confidentialityMode && !hasOutreachPurpose(stage as never)
      ? applyConfidentiality({ name } as never, { confidentialityMode: true, reveal: false }).name
      : name;

  const campaignIds = new Set(campaigns.map((c) => c.id));
  const h = hash(seat.id);

  // Real pending outreach awaiting human approval or explicit send.
  const pendingOutreach = outreach.filter(
    (m) =>
      campaignIds.has(m.campaignId)
      && (
        m.status === "Needs Approval"
        || m.status === "Draft"
        || m.status === "Pending Manual Send"
        || (m.status === "Approved" && m.dryRun !== true)
      ),
  );
  if (pendingOutreach.length > 0) {
    const msg = pendingOutreach[h % pendingOutreach.length]!;
    const campaign = campaigns.find((c) => c.id === msg.campaignId) ?? campaigns[0]!;
    const focus = candidates.find((c) => c.id === msg.candidateId);
    return make(
      "outreach",
      msg.status === "Pending Manual Send"
        ? "Awaiting manual send"
        : msg.status === "Approved"
          ? "Awaiting send"
          : "Outreach awaiting approval",
      campaign.title,
      focus ? maskName(focus.name, focus.stage) : null,
      true,
    );
  }

  // Interested candidates that still need a Teams/calendar URL (needs calendar).
  const needsBook = candidates.filter(
    (c) =>
      campaignIds.has(c.campaignId)
      && c.stage === "Interested"
      && (!c.booking || bookingNeedsCalendar(c.booking)),
  );
  if (needsBook.length > 0) {
    const focus = needsBook[h % needsBook.length]!;
    const campaign = campaigns.find((c) => c.id === focus.campaignId) ?? campaigns[0]!;
    return make(
      "booking",
      "Needs calendar — confirmLive",
      campaign.title,
      maskName(focus.name, focus.stage),
      true,
    );
  }

  // Sourced pool awaiting contact for an active campaign.
  const sourced = candidates.filter(
    (c) => campaignIds.has(c.campaignId) && c.stage === "Sourced",
  );
  if (sourced.length > 0) {
    const focus = sourced[h % sourced.length]!;
    const campaign = campaigns.find((c) => c.id === focus.campaignId) ?? campaigns[0]!;
    const role = campaign.jobAnalysis
      ? roleProfile(campaign.jobAnalysis).label.toLowerCase()
      : "talent";
    return make(
      "sourcing",
      `Sourcing ${role}`,
      campaign.title,
      maskName(focus.name, focus.stage),
      true,
    );
  }

  return make("idle", "Standing by", "No pending drafts, bookings, or sourced leads");
}

export interface FloorRollup {
  total: number;
  working: number;
  warming: number;
  paused: number;
  contactedToday: number;
}

export function floorRollup(seats: AgentSeat[], state: HermesState, now = Date.now()): FloorRollup {
  let working = 0,
    warming = 0,
    paused = 0;
  for (const seat of seats) {
    const a = agentActivity(seat, state, now);
    if (a.state === "paused") paused++;
    else if (a.state === "warming") warming++;
    else if (a.state !== "idle") working++;
  }
  return {
    total: seats.length,
    working,
    warming,
    paused,
    contactedToday: seats.reduce((sum, s) => sum + s.sentToday, 0),
  };
}
