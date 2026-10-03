import type { AgentSeat, HermesState } from "@/lib/types";
import { agentActivityWithComputers, type FloorComputerHint } from "@/lib/floor";
import type { AgentEvent } from "@/lib/agent-events";
import type { SoundKind } from "@/lib/sound";

/* ============================================================================
   Shared 3D-floor types and pure helpers. This module is deliberately free of
   React, three.js, and @react-three/fiber imports so lib code and non-canvas UI
   can share the floor contract without pulling in the 3D subsystem.
   ========================================================================== */

/** working = real sends/outreach activity; warming = VM busy/starting; idle includes ready+healthy zero-sends; error = paused/unhealthy */
export type AgentStatus = "working" | "warming" | "idle" | "error";

/** Org position. Everyone is an employee; the first seat is treated as CEO. */
export type AgentPosition = "employee" | "ceo";

export type RenderState = "walking" | "sitting" | "standing";

export interface OfficeAgent {
  id: string;
  name: string;
  subtitle?: string | null;
  status: AgentStatus;
  color: string;
  position?: AgentPosition;
  provider?: string;
  model?: string;
}

/**
 * The live, mutated-in-place render record. Characters read their own entry
 * from a shared ref each frame (no React re-render), exactly like the hermes
 * AgentsLayer pattern.
 */
export interface RenderAgent3D extends OfficeAgent {
  x: number;
  y: number;
  facing: number;
  state: RenderState;
  frame: number;
  walkSpeed?: number;
  phaseOffset: number;
}

/** Packet/pulse color per event kind. */
export const EVENT_COLOR: Record<AgentEvent["kind"], string> = {
  source: "#22D3EE",
  allocate: "#F97316",
  send: "#F97316",
  reply: "#EF4444",
  book: "#8B5CF6",
};

/** WebAudio cue per event kind. */
export const EVENT_SOUND: Record<AgentEvent["kind"], SoundKind> = {
  source: "packet",
  allocate: "ping",
  send: "ping",
  reply: "beacon",
  book: "chord",
};

export const PULSE_MS = 4000;

export const PACKET_FLIGHT_MS = 850;

export function pickResponderIndex(e: AgentEvent, n: number, seatIds?: string[]): number {
  if (n <= 0) return -1;
  // Fail-closed: only the seat that owns the event may light up — never hash-pick.
  if (!e.seatId || !seatIds?.length) return -1;
  const idx = seatIds.indexOf(e.seatId);
  return idx >= 0 ? idx % n : -1;
}

export function describeEvent(e: AgentEvent, seatName?: string | null): string {
  const who = seatName ? ` · ${seatName}` : "";
  switch (e.kind) {
    case "source":
      return `Sourced ${e.count ?? "new"} candidate${e.count === 1 ? "" : "s"}${who}`;
    case "allocate":
      return e.candidateName
        ? `Drafted outreach for ${e.candidateName}${who}`
        : `Drafted ${e.count ?? ""} outreach draft${e.count === 1 ? "" : "s"}${who}`;
    case "send":
      return `Approved outreach${e.candidateName ? ` to ${e.candidateName}` : ""}${who}`;
    case "reply":
      return `Reply received${e.candidateName ? ` from ${e.candidateName}` : ""}${who}`;
    case "book":
      return `Interview booked${e.candidateName ? ` with ${e.candidateName}` : ""}${who}`;
    default:
      return "Agent activity";
  }
}

/* ============================================================================
   Adapter + palette bridging the real fleet/seat model to the self-contained
   3D-floor agent model. Deterministic colour assignment so a seat keeps its
   robot colour across renders.
   ========================================================================== */

export const ROBOT_PALETTE: string[] = [
  "#3B82F6", // Blue
  "#F97316", // Orange
  "#22C55E", // Green
  "#8B5CF6", // Purple
  "#EAB308", // Yellow
  "#EF4444", // Red
  "#06B6D4", // Cyan
  "#EC4899", // Pink
  "#84CC16", // Lime
  "#6366F1", // Indigo
  "#14B8A6", // Teal
  "#F59E0B", // Amber
  "#F43F5E", // Rose
];

/** HSL (h∈[0,360), s/l∈[0,1]) → "#rrggbb". */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Deterministic, distinct robot colour for the Nth agent on the floor — no cap.
 * The first ROBOT_PALETTE.length agents use the curated palette (faithful to the
 * reference lineup). Beyond that, hues rotate by the golden angle (137.508°) so
 * each additional agent gets a well-separated colour; lightness steps across
 * three bands so colours stay distinct even after the hue wraps. New agents thus
 * always get their own colour, well past the 13 named ones.
 */
export function colorForAgent(index: number): string {
  if (index < ROBOT_PALETTE.length) return ROBOT_PALETTE[index];
  const overflow = index - ROBOT_PALETTE.length;
  const hue = (overflow * 137.508) % 360;
  const lightness = overflow % 3 === 0 ? 0.56 : overflow % 3 === 1 ? 0.46 : 0.66;
  return hslToHex(hue, 0.78, lightness);
}

// Activity states that mean the agent is actively doing probed work (not VM boot).
const WORKING_STATES = new Set(["sourcing", "outreach", "booking"]);

/**
 * Map real seats to 3D-floor agents. Uses the same overlay as 2D desks /
 * floorRollup (`agentActivityWithComputers`) so Warming / Working counts match
 * the robots. Never invents sessionHealthy=true.
 */
/** Live computer hint — overlays VM truth onto theatrical activity. */
export type ComputerFloorHint = FloorComputerHint;

export function seatsToOfficeAgents(
  seats: AgentSeat[],
  state: HermesState,
  computers?: ReadonlyMap<string, ComputerFloorHint>,
  now = Date.now(),
): OfficeAgent[] {
  return seats.map((seat, index) => {
    const activity = agentActivityWithComputers(seat, state, now, computers);
    let status: OfficeAgent["status"];
    if (activity.state === "warming") status = "warming";
    else if (activity.state === "paused") status = "error";
    else if (activity.state === "idle") status = "idle";
    else if (WORKING_STATES.has(activity.state)) status = "working";
    else status = "idle";

    // Label already includes VM suffix when computers map is present.
    const subtitle = activity.label;

    return {
      id: seat.id,
      name: seat.name,
      subtitle,
      status,
      color: seat.color ?? colorForAgent(index),
      position: "employee" as OfficeAgent["position"],
      provider: seat.provider,
    };
  }).map((agent, index, all) => {
    // PacketFX hub: only probed-healthy bound LI. No hub CEO when none are healthy
    // (never elect unverified/non-LI as packet theater center).
    const hubId =
      all.find(
        (a) =>
          a.provider === "LinkedIn Browser Computer" &&
          a.status === "working" &&
          typeof a.subtitle === "string" &&
          /session healthy/i.test(a.subtitle) &&
          /…[0-9a-zA-Z_-]{4,}/.test(a.subtitle),
      )?.id ??
      all.find(
        (a) =>
          a.provider === "LinkedIn Browser Computer" &&
          typeof a.subtitle === "string" &&
          /session healthy/i.test(a.subtitle) &&
          /…[0-9a-zA-Z_-]{4,}/.test(a.subtitle),
      )?.id ??
      null;
    return {
      ...agent,
      position: hubId && agent.id === hubId ? ("ceo" as const) : ("employee" as const),
    };
  });
}

/** Prefer Browser Computer seats (esp. probed-healthy bound VMs) when the 3D view is capped. */
export function preferBrowserComputerAgents<T extends { provider?: string; subtitle?: string | null; position?: string; id: string }>(
  agents: T[],
  selectedId?: string | null,
): T[] {
  const rank = (a: T) => {
    if (a.position === "ceo") return 0;
    if (selectedId && a.id === selectedId) return 1;
    if (a.provider === "LinkedIn Browser Computer") {
      const sub = typeof a.subtitle === "string" ? a.subtitle : "";
      // Prefer probed-healthy bound desks over unverified suffix-only theater.
      if (/session healthy/i.test(sub) && /…[0-9a-zA-Z_-]{4,}/.test(sub)) return 2;
      if (/…[0-9a-zA-Z_-]{4,}/.test(sub)) return 3;
      return 4;
    }
    return 5;
  };
  return [...agents].sort((a, b) => rank(a) - rank(b));
}

