// Ported from iamlukethedev/Claw3D (MIT License)
// Simplified subset: no janitor, no gym, no QA lab, no ping-pong, no away state.

/** Transient FX-layer marker recording the most recent agent-events emit this
 *  agent was chosen to represent. `kind` mirrors AgentEvent["kind"]
 *  (src/lib/agent-events.ts) by value rather than by import, so this
 *  self-contained core module stays dependency-free. */
export type RenderAgentEmitMarker = {
  kind: "source" | "send" | "reply" | "book" | "allocate";
  color: string;
  at: number;
};

export type RenderAgent = {
  id: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  /** Canvas pixel X */
  x: number;
  /** Canvas pixel Y */
  y: number;
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  facing: number;
  frame: number;
  walkSpeed: number;
  phaseOffset: number;
  state: "walking" | "sitting" | "standing";
  bumpedUntil?: number;
  bumpTalkUntil?: number;
  collisionCooldownUntil?: number;
  /** FX-only status pulse (src/components/floor3d/retro/scene/PacketFX.tsx):
   *  set when this agent is chosen as an event's responder, read to draw a
   *  glow at its live position. agentTick never reads or writes these — they
   *  ride along for free via its per-frame object spreads and are never
   *  persisted to the store. */
  pulseUntil?: number;
  emit?: RenderAgentEmitMarker;
};
