import type { AgentSeat, HermesState } from "@/lib/types";
import { agentActivity } from "@/lib/floor";
import type { OfficeAgent } from "@/components/floor3d/types";

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

/** djb2-style stable string hash. Deterministic, unsigned 32-bit. */
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Deterministic robot colour for a seat id. */
export function robotColor(seatId: string): string {
  return ROBOT_PALETTE[stableHash(seatId) % ROBOT_PALETTE.length];
}

// Activity states that mean the agent is actively doing work.
const BUSY_STATES = new Set(["sourcing", "outreach", "booking", "warming"]);

/**
 * Map real seats to 3D-floor agents. The FIRST seat (index 0) is treated as the
 * lead/CEO (AgentSeat has no lead field — first-seat-as-lead is the agreed
 * rule). Status collapses the richer activity model into the three render
 * states the characters understand.
 */
export function seatsToOfficeAgents(
  seats: AgentSeat[],
  state: HermesState,
): OfficeAgent[] {
  return seats.map((seat, index) => {
    const activity = agentActivity(seat, state);
    const status: OfficeAgent["status"] = BUSY_STATES.has(activity.state)
      ? "working"
      : activity.state === "idle"
        ? "idle"
        : "error"; // "paused" / auto-paused → error
    return {
      id: seat.id,
      name: seat.name,
      subtitle: activity.label,
      status,
      // Assign by seat index so robots step through the palette in order
      // (Blue, Orange, Green, Purple, Yellow, …) — distinct neighbours and
      // faithful to the reference lineup. Stable because seat order is stable.
      color: ROBOT_PALETTE[index % ROBOT_PALETTE.length],
      position: index === 0 ? "ceo" : "employee",
      provider: seat.provider,
    };
  });
}
