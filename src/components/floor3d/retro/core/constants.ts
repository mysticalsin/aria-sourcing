// Ported from iamlukethedev/Claw3D (MIT License)

export const WALK_SPEED = 0.3;
export const WORKING_WALK_SPEED_MULTIPLIER = 3;
export const WALK_ANIM_SPEED = 0.15;
export const AGENT_SCALE = 1.75;
export const AGENT_RADIUS = 20;
export const SEPARATION_STRENGTH = 3;
export const BUMP_FREEZE_MS = 1500;
export const BUMP_RECOVERY_MS = 1200;
export const DESK_STICKY_MS = 10_000;

// World-Z distance in front of the desk's front edge where the chair sits and
// a "working" agent is seated. Tuned so chair + seated robot tuck to the desk
// (desk front edge ≈ +0.01 world-units from center; 0.15 leaves a natural gap).
// Keeps desk + chair + seated robot aligned (RobotAgentModel uses this too).
export const CHAIR_SEAT_OFFSET = 0.15;

// 2-D canvas dimensions (pixel space — agents navigate in this coordinate system)
export const CANVAS_W = 1800;
export const CANVAS_H = 1800;

// Canvas → world-unit scale factor
export const SCALE = 0.018;

// Derived world extents
export const WORLD_W = CANVAS_W * SCALE; // 32.4
export const WORLD_H = CANVAS_H * SCALE; // 32.4
