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
    : campaigns;
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
};

/**
 * Resolve a live VM hint for a desk. Prefer seatId key; computerId fallback is
 * allowed only when the hint is unbound (no seatId) or bound to this same seat.
 */
export function resolveComputerHint(
  seat: { id: string; computerId?: string | null },
  computers?: ReadonlyMap<string, FloorComputerHint>,
): FloorComputerHint | undefined {
  if (!computers) return undefined;
  const bySeat = computers.get(seat.id);
  if (bySeat) return bySeat;
  const computerId = typeof seat.computerId === "string" ? seat.computerId.trim() : "";
  if (!computerId) return undefined;
  const byComputer = computers.get(computerId);
  if (!byComputer) return undefined;
  if (byComputer.seatId && byComputer.seatId !== seat.id) return undefined;
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
    const a = agentActivity(seat, state, now);
    if (a.state === "paused") {
      paused++;
      continue;
    }
    if (a.state === "warming") {
      warming++;
      continue;
    }
    // Theatrical idle still counts as working when the live VM is ready+healthy
    // (otherwise 3D can show working while the rollup omits the desk).
    if (a.state === "idle") {
      if (computers && seat.provider === "LinkedIn Browser Computer") {
        const hint = resolveComputerHint(seat, computers);
        if (hint?.status === "ready" && hint.sessionHealthy === true) {
          working++;
        }
      }
      continue;
    }

    // With live computer hints loaded, "Working now" is VM-truth mode:
    // Browser Computer seats need ready + probed-healthy; other seats need real
    // sends today — never the theatrical activity lottery (masks unhealthy LI VMs).
    if (computers) {
      if (seat.provider === "LinkedIn Browser Computer") {
        const hint = resolveComputerHint(seat, computers);
        if (hint?.status === "ready" && hint.sessionHealthy === true) {
          working++;
        }
      } else if (seat.sentToday > 0) {
        working++;
      }
      continue;
    }
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

/** Overlay live VM truth onto theatrical activity for 2D desks (same rules as 3D). */
export function agentActivityWithComputers(
  seat: AgentSeat,
  state: HermesState,
  now = Date.now(),
  computers?: ReadonlyMap<string, FloorComputerHint>,
): AgentActivity {
  const base = agentActivity(seat, state, now);
  if (!computers || seat.provider !== "LinkedIn Browser Computer") return base;

  const hint = resolveComputerHint(seat, computers);

  if (!hint) {
    return {
      ...base,
      state: "idle",
      label: seat.computerId ? "VM not on host" : "No Browser Computer",
      detail: base.detail,
      busy: false,
      tone: "neutral",
    };
  }
  if (hint.status === "help_requested" || hint.status === "error") {
    return {
      ...base,
      state: "paused",
      label: hint.status === "help_requested" ? "Needs Take control" : "VM error",
      busy: false,
      tone: "danger",
    };
  }
  if (hint.status === "starting" || hint.status === "busy") {
    return {
      ...base,
      state: "warming",
      label: hint.status === "starting" ? "Booting VM" : base.label,
      busy: true,
      tone: "warning",
    };
  }
  if (hint.status === "ready" && hint.sessionHealthy === true) {
    return {
      ...base,
      state: base.state === "idle" ? "sourcing" : base.state,
      label: "LinkedIn session healthy",
      busy: true,
      tone: "electric",
    };
  }
  if (hint.status === "ready" && hint.sessionHealthy === false) {
    return {
      ...base,
      state: "paused",
      label: "LinkedIn session unhealthy",
      busy: false,
      tone: "danger",
    };
  }
  if (hint.status === "ready") {
    return {
      ...base,
      state: "idle",
      label: "LinkedIn unverified — Take control",
      busy: false,
      tone: "warning",
    };
  }
  if (hint.status === "stopped") {
    return {
      ...base,
      state: "idle",
      label: "VM stopped",
      busy: false,
      tone: "neutral",
    };
  }
  return base;
}
