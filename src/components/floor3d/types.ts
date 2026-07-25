/* ============================================================================
   Self-contained 3D-floor agent types. Mirrors the hermes office model but
   carries only what the MSourcing floor needs — no avatar profiles, no
   electron/vite coupling.
   ========================================================================== */

export type AgentStatus = "working" | "idle" | "error";

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
 * AgentsLayer pattern. For this slice agents simply sit at their desk; the
 * walking fields exist so the future walking sim can drop in without a type
 * change.
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
