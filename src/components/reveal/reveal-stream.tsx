"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export interface RevealStreamState {
  revealed: number;
  total: number;
  done: boolean;
}

export interface RevealStreamProps<T> {
  /** Items to stream in one at a time. Provide either `items` + `renderItem`
   *  (preferred — gives each entry a stable key via `keyExtractor`), or plain
   *  `children` (each top-level child is staggered in the same way). */
  items?: T[];
  renderItem?: (item: T, index: number) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => React.Key;
  children?: React.ReactNode;
  /** ms between each item's reveal. Default 220. */
  staggerMs?: number;
  /** ms each item takes to animate in. Default 320. */
  itemDurationMs?: number;
  className?: string;
  itemClassName?: string;
  /** Hide the built-in Skip button (e.g. a host renders its own trigger). */
  hideSkipButton?: boolean;
  skipLabel?: string;
  /** Render a custom Skip control instead of the built-in button. Receives
   *  the same `skip()` handler the built-in button calls, so a host can wire
   *  it up anywhere (a topbar control, an overlay, etc). */
  renderSkip?: (skip: () => void, state: RevealStreamState) => React.ReactNode;
  onSkip?: () => void;
  onDone?: () => void;
}

/**
 * Staggered reveal wrapper (framer-motion) — renders a growing prefix of
 * `items`/`children` on a timer so results appear to "materialize" one at a
 * time instead of resolving atomically. `Skip` instantly resolves every item
 * (including ones already mid-animation) to its final state by flipping their
 * `transition` duration to 0, which framer-motion picks up as a live
 * retarget. Honors `prefers-reduced-motion`: renders the final frame for
 * every item immediately, with no interval and no animation, from the first
 * render.
 */
export function RevealStream<T = unknown>({
  items,
  renderItem,
  keyExtractor,
  children,
  staggerMs = 220,
  itemDurationMs = 320,
  className,
  itemClassName,
  hideSkipButton = false,
  skipLabel = "Skip",
  renderSkip,
  onSkip,
  onDone,
}: RevealStreamProps<T>) {
  const reducedMotion = usePrefersReducedMotion();

  const entries: { key: React.Key; node: React.ReactNode }[] = React.useMemo(() => {
    if (items && renderItem) {
      return items.map((item, i) => ({
        key: keyExtractor ? keyExtractor(item, i) : i,
        node: renderItem(item, i),
      }));
    }
    return React.Children.toArray(children).map((node, i) => ({
      key: (node as { key?: React.Key | null })?.key ?? i,
      node,
    }));
    // items/renderItem/children are read directly; keyExtractor is stable in
    // typical usage and re-running on every render is inexpensive here.
  }, [items, renderItem, keyExtractor, children]);

  const total = entries.length;
  const [revealed, setRevealed] = React.useState(() => (reducedMotion ? total : total > 0 ? 1 : 0));
  const [skipped, setSkipped] = React.useState(reducedMotion);
  const doneNotifiedRef = React.useRef(false);
  const prevTotalRef = React.useRef(total);

  // Start (or restart) the stream whenever the item count changes — e.g. a
  // fresh sourcing run replacing the previous batch.
  React.useEffect(() => {
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    doneNotifiedRef.current = false;
    if (reducedMotion) {
      setSkipped(true);
      setRevealed(total);
    } else {
      setSkipped(false);
      setRevealed(total > 0 ? 1 : 0);
    }
  }, [total, reducedMotion]);

  React.useEffect(() => {
    if (skipped || revealed >= total) return;
    const id = window.setTimeout(() => {
      setRevealed((r) => Math.min(r + 1, total));
    }, staggerMs);
    return () => window.clearTimeout(id);
  }, [revealed, total, skipped, staggerMs]);

  React.useEffect(() => {
    if (total > 0 && revealed >= total && !doneNotifiedRef.current) {
      doneNotifiedRef.current = true;
      onDone?.();
    }
  }, [revealed, total, onDone]);

  const skip = React.useCallback(() => {
    setSkipped(true);
    setRevealed(total);
    onSkip?.();
  }, [total, onSkip]);

  const done = total === 0 || revealed >= total;
  const instant = skipped || reducedMotion;
  const state: RevealStreamState = { revealed, total, done };

  return (
    <div className={className}>
      {!hideSkipButton && !done ? (
        renderSkip ? (
          renderSkip(skip, state)
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={skip} className="mb-3">
            {skipLabel}
          </Button>
        )
      ) : null}
      <div aria-busy={!done} aria-live="off">
        {entries.slice(0, revealed).map(({ key, node }) => (
          <motion.div
            key={key}
            className={itemClassName}
            initial={instant ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: instant ? 0 : itemDurationMs / 1000, ease: "easeOut" }}
          >
            {node}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
