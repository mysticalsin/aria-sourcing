import type { AgentSeat, HermesState } from "./types";
import type { Tone } from "./utils";
import { roleProfile } from "./roles";
import { applyConfidentiality, hasOutreachPurpose } from "./confidential";
import { seatHealthStatus, warmupStage } from "./fleet";

/* ============================================================================
   Operations-floor model — derives, deterministically, what each agent is
   "working on" right now from real workspace state (campaigns, ledger, health).
   Stable across renders (no time-based flicker); liveliness comes from CSS.
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

export function agentActivity(seat: AgentSeat, state: HermesState, now = Date.now()): AgentActivity {
  const contacted = state.ledger.filter(
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
  if (seatHealthStatus(seat, state.settings.fleet).shouldPause)
    return make("paused", "Auto-paused", "Deliverability guardrail tripped");

  const ws = warmupStage(seat, now);
  if (!ws.full) return make("warming", "Warming up", `Day ${ws.day} · cap ${ws.cap}/day`, null, true);

  const campaigns = state.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  if (campaigns.length === 0) return make("idle", "Standing by", "No active campaigns");

  const h = hash(seat.id);
  const campaign = campaigns[h % campaigns.length];
  const cands = state.candidates.filter((c) => c.campaignId === campaign.id);
  const mode = h % 3;

  const maskName = (name: string, stage: string): string =>
    state.settings.confidentialityMode && !hasOutreachPurpose(stage as never)
      ? applyConfidentiality({ name } as never, { confidentialityMode: true, reveal: false }).name
      : name;

  if (mode === 0) {
    const role = roleProfile(campaign.jobAnalysis).label.toLowerCase();
    const focus = cands.find((c) => c.stage === "Sourced") ?? cands[h % Math.max(1, cands.length)];
    return make(
      "sourcing",
      `Sourcing ${role}`,
      campaign.title,
      focus ? maskName(focus.name, focus.stage) : null,
      true,
    );
  }
  if (mode === 1) {
    const focus = cands.find((c) => c.stage === "Contacted") ?? cands[h % Math.max(1, cands.length)];
    return make(
      "outreach",
      "Drafting personalized outreach",
      campaign.title,
      focus ? maskName(focus.name, focus.stage) : null,
      true,
    );
  }
  const focus = cands.find((c) => c.stage === "Interested" || c.stage === "Booked") ?? cands[0];
  return make(
    "booking",
    "Coordinating interviews",
    campaign.title,
    focus ? maskName(focus.name, focus.stage) : null,
    true,
  );
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
