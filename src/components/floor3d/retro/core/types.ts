// Ported from iamlukethedev/Claw3D (MIT License)
// Simplified subset: no janitor, no gym, no QA lab, no ping-pong, no away state.

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
};
