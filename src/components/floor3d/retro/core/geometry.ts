// Ported from iamlukethedev/Claw3D (MIT License)

import { CANVAS_H, CANVAS_W, SCALE } from "./constants";

/**
 * Convert canvas pixel coordinates (cx, cy) to Three.js world coordinates.
 * Canvas center (900, 900) maps to world (0, 0, 0).
 * Y is always 0 (floor plane).
 */
export function toWorld(cx: number, cy: number): [number, number, number] {
  return [
    cx * SCALE - CANVAS_W * SCALE * 0.5,
    0,
    cy * SCALE - CANVAS_H * SCALE * 0.5,
  ];
}
