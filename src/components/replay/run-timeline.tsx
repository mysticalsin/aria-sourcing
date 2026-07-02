"use client";

import * as React from "react";
import { Play, Pause } from "lucide-react";
import { Button } from "@/components/ui";
import { playSound, type SoundKind } from "@/lib/sound";
import type { ReplayEvent, ReplayEventKind } from "@/lib/replay";

/* ============================================================================
   RunTimeline — a bespoke multi-lane SVG scrubber (no chart library), styled
   after src/components/charts/fit-radar.tsx: plain <svg viewBox>, computed
   geometry helpers, prefers-reduced-motion gating, inline CSS transitions.
   One lane per ReplayEventKind. Dragging the playhead (or clicking anywhere
   on the strip) scrubs the whole replay via pointer capture — no window
   listeners needed. Play / 2x / 8x sweep the cursor forward with rAF and
   play a cue on every event crossed, reusing the existing playSound/SoundKind
   vocabulary (src/lib/sound.ts) — no new sound kinds are added.
   ========================================================================== */

const VIEWBOX_W = 1000;
const LANE_H = 26;
const LANE_GAP = 6;
const TOP_PAD = 12;
const BOTTOM_PAD = 4;
const LABEL_W = 74; // reserved left margin for lane labels, in viewBox units

const LANES: { kind: ReplayEventKind; label: string; color: string }[] = [
  { kind: "source", label: "Sourced", color: "#22D3EE" },
  { kind: "score", label: "Scored", color: "#C084FC" },
  { kind: "draft", label: "Drafted", color: "#FB923C" },
  { kind: "approve", label: "Approved", color: "#FACC15" },
  { kind: "reply", label: "Replied", color: "#EF4444" },
  { kind: "book", label: "Booked", color: "#8B5CF6" },
  { kind: "report", label: "Reported", color: "#22C55E" },
];

/** Reuses the existing sound vocabulary (src/lib/sound.ts) — no new kinds. */
const EVENT_SOUND: Record<ReplayEventKind, SoundKind> = {
  source: "packet",
  score: "select",
  draft: "ping",
  approve: "ping",
  reply: "beacon",
  book: "chord",
  report: "success",
};

const BASE_PLAYBACK_MS = 20_000; // 1x sweeps the full visible span in ~20 real seconds
type Speed = 2 | 8;

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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface RunTimelineProps {
  /** Full stream, sorted ascending by `at` (see buildEventStream) — both
   *  revealed and not-yet-revealed events render, at different opacities. */
  events: ReplayEvent[];
  minMs: number;
  maxMs: number;
  cursorMs: number;
  onScrub: (ms: number) => void;
  soundEnabled: boolean;
}

export function RunTimeline({ events, minMs, maxMs, cursorMs, onScrub, soundEnabled }: RunTimelineProps) {
  const reducedMotion = usePrefersReducedMotion();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<Speed>(2);

  const span = Math.max(1, maxMs - minMs);
  const laneAreaW = VIEWBOX_W - LABEL_W;
  const height = TOP_PAD + LANES.length * LANE_H + (LANES.length - 1) * LANE_GAP + BOTTOM_PAD;

  const msToX = React.useCallback(
    (ms: number) => LABEL_W + ((ms - minMs) / span) * laneAreaW,
    [minMs, span, laneAreaW],
  );
  const xToMs = React.useCallback(
    (x: number) => minMs + ((x - LABEL_W) / laneAreaW) * span,
    [minMs, span, laneAreaW],
  );

  const scrubToClientX = React.useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = ((clientX - rect.left) / rect.width) * VIEWBOX_W;
      onScrub(clamp(xToMs(x), minMs, maxMs));
    },
    [xToMs, onScrub, minMs, maxMs],
  );

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    setPlaying(false);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    scrubToClientX(e.clientX);
  }
  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  // Playback loop: advances cursorMs via rAF, playing a cue for every event
  // it crosses. Cancelled whenever `playing` flips off, speed changes, or the
  // component unmounts. Never autoplays under reduced motion; manual drag
  // above is unaffected either way.
  const cursorRef = React.useRef(cursorMs);
  React.useEffect(() => {
    cursorRef.current = cursorMs;
  }, [cursorMs]);

  React.useEffect(() => {
    if (!playing || reducedMotion) return;
    let raf = 0;
    let lastTs: number | null = null;
    const tick = (ts: number) => {
      if (lastTs == null) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      const prev = cursorRef.current;
      const next = Math.min(maxMs, prev + (dt / BASE_PLAYBACK_MS) * span * speed);
      if (soundEnabled) {
        // Event counts here are bounded by the seeded demo dataset (at most a
        // few thousand), so a linear crossing-scan per frame is negligible —
        // not worth an index-tracking optimisation for this small a list.
        for (const e of events) {
          if (e.at > prev && e.at <= next) playSound(EVENT_SOUND[e.kind], true);
        }
      }
      onScrub(next);
      if (next >= maxMs) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, maxMs, span, events, soundEnabled, onScrub, reducedMotion]);

  const playheadX = msToX(clamp(cursorMs, minMs, maxMs));

  return (
    <div className="w-full select-none">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant={playing ? "primary" : "outline"}
          size="sm"
          disabled={reducedMotion}
          onClick={() => setPlaying((p) => !p)}
          leftIcon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        {([2, 8] as const).map((s) => (
          <Button
            key={s}
            variant={speed === s && playing ? "primary" : "outline"}
            size="sm"
            disabled={reducedMotion}
            onClick={() => {
              setSpeed(s);
              setPlaying(true);
            }}
          >
            {s}×
          </Button>
        ))}
        {reducedMotion && (
          <span className="text-xs text-muted">
            Autoplay disabled (reduced motion) — drag the playhead to scrub.
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${height}`}
        className="w-full rounded-xl border border-line bg-canvas"
        style={{ touchAction: "none" }}
        role="slider"
        aria-label="Replay timeline"
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={cursorMs}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {LANES.map((lane, i) => {
          const y = TOP_PAD + i * (LANE_H + LANE_GAP);
          return (
            <g key={lane.kind}>
              <text
                x={4}
                y={y + LANE_H / 2 + 4}
                className="text-[10px] font-semibold uppercase tracking-wide"
                fill="hsl(var(--muted))"
              >
                {lane.label}
              </text>
              <line
                x1={LABEL_W}
                y1={y + LANE_H / 2}
                x2={VIEWBOX_W}
                y2={y + LANE_H / 2}
                stroke="hsl(var(--line))"
                strokeWidth={1}
              />
              {events
                .filter((e) => e.kind === lane.kind)
                .map((e, idx) => {
                  const revealed = e.at <= cursorMs;
                  return (
                    <circle
                      key={`${lane.kind}-${idx}`}
                      cx={msToX(e.at)}
                      cy={y + LANE_H / 2}
                      r={revealed ? 4 : 2.5}
                      fill={lane.color}
                      opacity={revealed ? 0.95 : 0.3}
                      style={{
                        transition: reducedMotion ? "none" : "r 150ms ease-out, opacity 150ms ease-out",
                      }}
                    >
                      <title>{e.label}</title>
                    </circle>
                  );
                })}
            </g>
          );
        })}
        {/* Playhead */}
        <line x1={playheadX} y1={0} x2={playheadX} y2={height} stroke="hsl(var(--ink))" strokeWidth={2} />
        <circle cx={playheadX} cy={0} r={6} fill="hsl(var(--ink))" />
      </svg>
    </div>
  );
}
