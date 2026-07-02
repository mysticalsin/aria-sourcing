/* ============================================================================
   Device capability tier — used to scale expensive rendering (3D floor, heavy
   effects) so the app runs smoothly on low-end phones/laptops. Pure + SSR-safe.
   ========================================================================== */

export type DeviceQuality = "high" | "low";

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * Heuristic device tier. Errs toward "high" on the server and when signals are
 * unavailable, and drops to "low" for reduced-motion, few cores, low memory, or
 * small coarse-pointer (mobile) devices — the cases where the full 3D scene and
 * heavy shadow passes cause jank or WebGL context loss.
 */
export function getDeviceQuality(): DeviceQuality {
  if (typeof window === "undefined") return "high";
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "low";
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as NavigatorWithMemory).deviceMemory ?? 8;
    if (cores <= 4 || mem <= 4) return "low";
    const small = window.matchMedia?.("(max-width: 820px)").matches;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (small && coarse) return "low";
    return "high";
  } catch {
    return "high";
  }
}

/** Max full-detail 3D agent models to render per quality tier. Above this the
 *  floor's 2D grid view is the honest way to see the whole fleet. */
export const MAX_3D_AGENTS: Record<DeviceQuality, number> = {
  high: 64,
  low: 22,
};
