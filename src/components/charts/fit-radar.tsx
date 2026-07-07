"use client";

import * as React from "react";
import { Radar } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { MatchBreakdownItem } from "@/lib/types";
import { clamp, round, scoreTone } from "@/lib/utils";
import type { Tone } from "@/lib/utils";

/* Shared tone→CSS-var map, matching score-gauge.tsx / score-distribution.tsx. */
const TONE_VAR: Record<Tone, string> = {
  neutral: "--muted",
  tangerine: "--tangerine",
  electric: "--electric",
  aqua: "--aqua",
  violet: "--violet",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

/** Concentric grid rings drawn at these fractions of the max radius. */
const GRID_RINGS = [0.25, 0.5, 0.75, 1] as const;

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

function axisPoint(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function polygonPath(points: { x: number; y: number }[]): string {
  return (
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") + " Z"
  );
}

export interface FitRadarProps {
  /** The candidate's real per-dimension score breakdown (see `types.ts`
   *  `MatchBreakdownItem`/`ScoringWeights` — skills, experience, companyStage,
   *  industry, location, activity). Plotted one axis per entry, in the given
   *  order — distinct candidates naturally produce distinct silhouettes
   *  because the shape is a direct function of these real scores, nothing
   *  is derived or randomised here. */
  matchBreakdown: MatchBreakdownItem[];
  size?: number;
  label?: string;
}

/**
 * Self-contained SVG radar/spider chart — no chart library. The polygon draws
 * itself in via a `stroke-dashoffset` sweep (using the `pathLength` trick so
 * the math is a simple 1→0 offset regardless of the real perimeter length).
 * Under `prefers-reduced-motion` the final polygon renders immediately.
 */
export function FitRadar({ matchBreakdown, size = 220, label }: FitRadarProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [drawn, setDrawn] = React.useState(false);

  React.useEffect(() => {
    if (reducedMotion) {
      setDrawn(true);
      return;
    }
    setDrawn(false);
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
    // Re-key the draw-in whenever the underlying breakdown changes so
    // switching candidates re-plays the reveal instead of snapping silently.
  }, [reducedMotion, matchBreakdown]);

  const n = matchBreakdown.length;

  if (n === 0) {
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center">
        <EmptyState
          icon={<Radar className="h-5 w-5" aria-hidden />}
          title="No fit breakdown yet"
          description="Score a candidate to see the dimension radar."
        />
      </div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.28;
  const labelR = size * 0.42;
  const startAngle = -Math.PI / 2;
  const step = (Math.PI * 2) / n;

  const dataPoints = matchBreakdown.map((item, i) =>
    axisPoint(cx, cy, (clamp(item.score, 0, 100) / 100) * maxR, startAngle + i * step),
  );
  const dataPath = polygonPath(dataPoints);

  const totalWeight = matchBreakdown.reduce((s, it) => s + it.weight, 0) || 1;
  const overallScore = matchBreakdown.reduce((s, it) => s + it.score * it.weight, 0) / totalWeight;
  const tone = scoreTone(overallScore);
  const color = `hsl(var(${TONE_VAR[tone]}))`;

  const summary = matchBreakdown.map((it) => `${it.label} ${round(it.score)}`).join(", ");
  const noTransition = "none";

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Fit breakdown${label ? `, ${label}` : ""}: ${summary}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {GRID_RINGS.map((frac) => (
          <path
            key={frac}
            d={polygonPath(
              Array.from({ length: n }, (_, i) => axisPoint(cx, cy, maxR * frac, startAngle + i * step)),
            )}
            fill="none"
            stroke="hsl(var(--line))"
            strokeWidth={1}
          />
        ))}
        {matchBreakdown.map((item, i) => {
          const p = axisPoint(cx, cy, maxR, startAngle + i * step);
          return (
            <line
              key={item.key}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke="hsl(var(--line))"
              strokeWidth={1}
            />
          );
        })}
        {/* Soft fill fade-in */}
        <path
          d={dataPath}
          fill={color}
          fillOpacity={drawn ? 0.18 : 0}
          style={{ transition: reducedMotion ? noTransition : "fill-opacity 500ms ease-out 250ms" }}
        />
        {/* Animated stroke draw-in: pathLength=1 normalises the perimeter to
            1 unit so the dash math is always a plain 1 -> 0 offset. */}
        <path
          d={dataPath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={drawn ? 0 : 1}
          style={{ transition: reducedMotion ? noTransition : "stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1)" }}
        />
        {dataPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={color}
            opacity={drawn ? 1 : 0}
            style={{ transition: reducedMotion ? noTransition : "opacity 200ms ease-out 750ms" }}
          />
        ))}
      </svg>
      {matchBreakdown.map((item, i) => {
        const p = axisPoint(cx, cy, labelR, startAngle + i * step);
        return (
          <div
            key={item.key}
            className="absolute w-20 -translate-x-1/2 -translate-y-1/2 text-center text-[0.6rem] font-semibold uppercase leading-tight tracking-[0.08em] text-muted"
            style={{ left: p.x, top: p.y }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
