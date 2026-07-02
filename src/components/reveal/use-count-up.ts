"use client";

import { useEffect, useRef, useState } from "react";

export interface UseCountUpOptions {
  /** How long a count animates over, in ms. Default 800. */
  durationMs?: number;
  /** Set false to jump straight to `target` (e.g. a Skip control). Reduced-
   *  motion forces this behaviour on regardless of this prop. */
  enabled?: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Animates a number from its last displayed value to `target` whenever
 * `target` changes, eased over `durationMs` via requestAnimationFrame — on
 * first mount it counts up from 0. Returns `target` immediately, with no
 * animation, when `enabled` is false or the user prefers reduced motion. The
 * rAF loop is cancelled on unmount and whenever a new target interrupts it.
 *
 * Returns the raw interpolated number — round/format it for display
 * (e.g. `Math.round(...)` for integer counters, `.toFixed(1)` for a ratio).
 */
export function useCountUp(target: number, { durationMs = 800, enabled = true }: UseCountUpOptions = {}): number {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;
  const [value, setValue] = useState(active ? 0 : target);
  const displayedRef = useRef(active ? 0 : target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!active) {
      displayedRef.current = target;
      setValue(target);
      return;
    }
    const from = displayedRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const dur = Math.max(durationMs, 1);

    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      if (t >= 1) {
        displayedRef.current = to;
        setValue(to);
        rafRef.current = null;
        return;
      }
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = from + (to - from) * eased;
      displayedRef.current = current;
      setValue(current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, active, durationMs]);

  return value;
}
