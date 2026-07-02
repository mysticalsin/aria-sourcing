"use client";

import { useEffect, useState } from "react";

export interface UseTypewriterOptions {
  /** Characters revealed per second. Default 40. */
  speed?: number;
  /** Set false to render the full text immediately (e.g. a Skip control).
   *  Reduced-motion forces this behaviour on regardless of this prop. */
  enabled?: boolean;
}

export interface UseTypewriterResult {
  /** The text revealed so far — equals the full string once `done`. */
  text: string;
  done: boolean;
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
 * Progressively reveals `text` one character at a time at `speed` chars/sec.
 * Restarts whenever `text` changes. Returns the full string instantly (no
 * interval, `done: true` from the first render) when `enabled` is false or
 * the user prefers reduced motion — never leaves reduced-motion users
 * waiting on a decorative interval.
 */
export function useTypewriter(
  text: string,
  { speed = 40, enabled = true }: UseTypewriterOptions = {},
): UseTypewriterResult {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;
  const [shown, setShown] = useState(active ? 0 : text.length);

  useEffect(() => {
    if (!active) {
      setShown(text.length);
      return;
    }
    setShown(0);
    if (text.length === 0) return;
    const msPerChar = Math.max(1000 / Math.max(speed, 1), 1);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) window.clearInterval(id);
    }, msPerChar);
    return () => window.clearInterval(id);
  }, [text, active, speed]);

  const clamped = Math.min(shown, text.length);
  return { text: text.slice(0, clamped), done: clamped >= text.length };
}
