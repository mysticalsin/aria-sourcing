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

/** Deterministic robot colour for a seat id (hash-based; order-independent). */
export function robotColor(seatId: string): string {
  return ROBOT_PALETTE[stableHash(seatId) % ROBOT_PALETTE.length];
}

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
      // Honour a custom per-agent colour when set; otherwise auto-assign a
      // distinct colour by seat index — curated palette first (faithful to the
      // reference lineup), then generated hues for any number of new agents.
      color: seat.color ?? colorForAgent(index),
      position: index === 0 ? "ceo" : "employee",
      provider: seat.provider,
    };
  });
}
