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

  // Prefer campaigns this seat is actually attached to (Campaign Agents), not a hash lottery.
  const assigned = seat.assignedCampaignIds ?? [];
  const attached = assigned.length
    ? campaigns.filter((c) => assigned.includes(c.id))
    : [];
  // LinkedIn Browser Computer desks must be explicitly attached — never narrate
  // foreign-campaign sourcing/outreach from an unassigned N-agent seat.
  if (
    attached.length === 0 &&
    (seat.provider === "LinkedIn Browser Computer" ||
      seat.linkedinDeliveryBackend === "browser-computer")
  ) {
    return make("idle", "Standing by", "No campaign assigned");
  }
  const pool = attached.length > 0 ? attached : campaigns;
  const h = hash(seat.id);
  const campaign = pool[h % pool.length];
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

/** Live VM hint — when provided, Browser Computer seats only count as working if ready+healthy. */
export type FloorComputerHint = {
  status: string;
  sessionHealthy?: boolean | null;
  /** Bound Chromium id from fleet API — preferred over HermesState when present. */
  computerId?: string | null;
  /**
   * Fleet-bound seat for this Chromium. When set, computerId fallback must match
   * so a poisoned/stale seat.computerId cannot show another seat's VM on the floor.
   */
  seatId?: string | null;
  /** Human takeover mutex — floor must not show working while operator holds control. */
  control?: "bot" | "human" | null;
};

/**
 * Resolve a live VM hint for a desk. Prefer seatId key; computerId fallback is
 * allowed only when the hint is bound to this same seat — never empty/`__orphan__`
 * owners (those paint cross-desk green via Hermes twin ids).
 */
export function resolveComputerHint(
  seat: { id: string; computerId?: string | null },
  computers?: ReadonlyMap<string, FloorComputerHint>,
): FloorComputerHint | undefined {
  if (!computers) return undefined;
  const bySeat = computers.get(seat.id);
  if (bySeat) {
    const owner = typeof bySeat.seatId === "string" ? bySeat.seatId.trim() : "";
    // Seat-keyed hint must still be owned by this seat (or unbound legacy).
    if (owner && owner !== seat.id && owner !== "__orphan__") return undefined;
    if (owner === "__orphan__") return undefined;
    return bySeat;
  }
  const computerId = typeof seat.computerId === "string" ? seat.computerId.trim() : "";
  if (!computerId) return undefined;
  const byComputer = computers.get(computerId);
  if (!byComputer) return undefined;
  const owner = typeof byComputer.seatId === "string" ? byComputer.seatId.trim() : "";
  // Empty / orphan owner must not paint this desk — match computerHealthOwnedBySeat.
  if (!owner || owner === "__orphan__" || owner !== seat.id) return undefined;
  return byComputer;
}

export function floorRollup(
  seats: AgentSeat[],
  state: HermesState,
  now = Date.now(),
  computers?: ReadonlyMap<string, FloorComputerHint>,
): FloorRollup {
  let working = 0,
    warming = 0,
    paused = 0;
  for (const seat of seats) {
    // When fleet hints are loaded, rollup must match 2D/3D overlays — never keep
    // theatrical warmup/working while desks show unverified / unhealthy / idle.
    const a = computers
      ? agentActivityWithComputers(seat, state, now, computers)
      : agentActivity(seat, state, now);
    if (a.state === "paused") {
      paused++;
      continue;
    }
    if (a.state === "warming") {
      warming++;
      continue;
    }
    if (a.state === "idle") continue;
    // sourcing | outreach | booking — real working buckets only
    working++;
  }
  return {
    total: seats.length,
    working,
    warming,
    paused,
    contactedToday: seats.reduce((sum, s) => sum + s.sentToday, 0),
  };
}

/**
 * Honest Floor browser-desk counts: bound VM ≠ probed healthy.
 * Never invent healthy from computerId alone.
 */
export function floorBrowserVmTruth(
  seats: AgentSeat[],
  computers: ReadonlyMap<string, FloorComputerHint>,
): { bound: number; healthy: number; unverified: number } {
  let bound = 0;
  let healthy = 0;
  let unverified = 0;
  for (const seat of seats) {
    if (seat.provider !== "LinkedIn Browser Computer") continue;
    const hint = resolveComputerHint(seat, computers);
    if (!hint?.computerId) continue;
    bound++;
    if (hint.sessionHealthy === true) healthy++;
    else unverified++;
  }
  return { bound, healthy, unverified };
}

/** Overlay live VM truth onto theatrical activity for 2D desks (same rules as 3D). */
export function agentActivityWithComputers(
  seat: AgentSeat,
  state: HermesState,
  now = Date.now(),
  computers?: ReadonlyMap<string, FloorComputerHint>,
): AgentActivity {
  const base = agentActivity(seat, state, now);
  // With a live computers map, non-LI desks stay idle unless they actually sent today —
  // never keep the hash lottery busy theater after fleet poll.
  if (computers && seat.provider !== "LinkedIn Browser Computer") {
    if ((seat.sentToday ?? 0) > 0) return base;
    return {
      ...base,
      state: "idle",
      label: "Standing by",
      busy: false,
      tone: "neutral",
    };
  }
  if (!computers || seat.provider !== "LinkedIn Browser Computer") return base;

  const hint = resolveComputerHint(seat, computers);
  // Bound VM suffix = fleet hint only. Never fall back to Hermes seat.computerId
  // (stale twin / foreign id can paint the wrong …suffix on a healthy desk).
  const vmId = hint?.computerId?.trim() || null;
  const withVm = (label: string) =>
    vmId ? `${label} · …${vmId.slice(-8)}` : label;

  if (!hint) {
    return {
      ...base,
      state: "idle",
      label: seat.computerId ? "VM not on host" : "No Browser Computer",
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "neutral",
    };
  }
  if (hint.control === "human") {
    return {
      ...base,
      state: "idle",
      label: withVm("Operator in control"),
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "warning",
    };
  }
  if (hint.status === "help_requested" || hint.status === "error") {
    return {
      ...base,
      state: "paused",
      label: withVm(hint.status === "help_requested" ? "Needs Take control" : "VM error"),
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "danger",
    };
  }
  if (hint.status === "starting" || hint.status === "busy") {
    const healthyBusy = hint.sessionHealthy === true;
    // Busy + probed-healthy is real work (linkedin_send in flight) — keep base
    // activity, never lie "session unverified". Unverified/null stays warming.
    if (hint.status === "busy" && healthyBusy) {
      return {
        ...base,
        state: base.state,
        label: withVm("VM busy — LinkedIn session healthy"),
        busy: true,
        tone: base.state === "idle" ? "electric" : base.tone,
      };
    }
    return {
      ...base,
      state: "warming",
      // Never keep theatrical sourcing/outreach labels while session is unverified.
      label: withVm(
        hint.status === "starting"
          ? "Booting VM"
          : healthyBusy
            ? "VM busy — LinkedIn session healthy"
            : "VM busy — session unverified",
      ),
      busy: true,
      tone: "warning",
    };
  }
  if (hint.status === "ready" && hint.sessionHealthy === true) {
    // Healthy LinkedIn is ready — not automatic "working". Only real sends
    // (or VM status=busy above) count as working; never keep hash theater.
    const realSends = (seat.sentToday ?? 0) > 0;
    if (!realSends) {
      return {
        ...base,
        state: "idle",
        label: withVm("LinkedIn session healthy"),
        detail: "Standing by",
        focusName: null,
        busy: false,
        tone: "electric",
      };
    }
    return {
      ...base,
      state: base.state === "idle" ? "sourcing" : base.state,
      label: withVm("LinkedIn session healthy"),
      busy: true,
      tone: base.state !== "idle" ? base.tone : "electric",
    };
  }
  if (hint.status === "ready" && hint.sessionHealthy === false) {
    return {
      ...base,
      state: "paused",
      label: withVm("LinkedIn session unhealthy"),
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "danger",
    };
  }
  if (hint.status === "ready") {
    return {
      ...base,
      state: "idle",
      label: withVm("LinkedIn unverified — Take control"),
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "warning",
    };
  }
  if (hint.status === "stopped") {
    return {
      ...base,
      state: "idle",
      label: withVm("VM stopped"),
      detail: "Standing by",
      focusName: null,
      busy: false,
      tone: "neutral",
    };
  }
  return base;
}
