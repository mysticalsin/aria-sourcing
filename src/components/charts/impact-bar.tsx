"use client";

import { useId } from "react";
import { clamp, round } from "@/lib/utils";

export interface ImpactBarProps {
  /** Metric value before the change. Computed by the caller — this component
   *  only visualizes numbers it's given, it never derives them. */
  before: number;
  /** Metric value after the change. */
  after: number;
  beforeLabel?: string;
  afterLabel?: string;
  /** Format a raw value for display. Default: one decimal place. */
  format?: (value: number) => string;
  height?: number;
  className?: string;
}

const VIEW_W = 320;
const BAR_H = 20;
const ROW_GAP = 34;
const LABEL_W = 64;
const VALUE_W = 46;
const TRACK_W = VIEW_W - LABEL_W - VALUE_W;

/**
 * Custom SVG before/after comparison bar (no charting library) — two
 * horizontal tracks scaled to a shared domain: a muted "before" bar and a
 * tangerine→success gradient "after" bar, plus a signed delta readout.
 * Matches the charts/* convention (role="img" + aria-label, animate-fade-in,
 * CSS custom-property colors) used by score-gauge and funnel-chart.
 */
export function ImpactBar({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  format = (v) => String(round(v, 1)),
  height = 96,
  className,
}: ImpactBarProps) {
  const gradId = useId();
  const domain = Math.max(Math.abs(before), Math.abs(after), 1) * 1.25;
  const beforeW = clamp((Math.abs(before) / domain) * TRACK_W, before === 0 ? 0 : 3, TRACK_W);
  const afterW = clamp((Math.abs(after) / domain) * TRACK_W, after === 0 ? 0 : 3, TRACK_W);
  const delta = round(after - before, 1);
  const flat = delta === 0;
  const improved = delta > 0;
  const deltaLabel = flat ? "No change" : `${improved ? "+" : ""}${delta}`;
  const deltaColor = flat
    ? "hsl(var(--muted))"
    : improved
      ? "hsl(var(--success))"
      : "hsl(var(--danger))";

  const y1 = 4;
  const y2 = y1 + ROW_GAP;
  const viewH = y2 + BAR_H + 20;

  return (
    <div
      className={className ? `animate-fade-in ${className}` : "animate-fade-in"}
      role="img"
      aria-label={`${beforeLabel} ${format(before)}, ${afterLabel} ${format(after)}, ${
        flat ? "no change" : `change ${improved ? "+" : ""}${delta}`
      }`}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMinYMid meet"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--tangerine))" />
            <stop offset="100%" stopColor="hsl(var(--success))" />
          </linearGradient>
        </defs>

        {/* Before row */}
        <text x={0} y={y1 + BAR_H / 2} dy="0.32em" fontSize={10} fontWeight={700} fill="hsl(var(--muted))">
          {beforeLabel.toUpperCase()}
        </text>
        <rect x={LABEL_W} y={y1} width={TRACK_W} height={BAR_H} rx={BAR_H / 2} fill="hsl(var(--line))" />
        <rect x={LABEL_W} y={y1} width={beforeW} height={BAR_H} rx={BAR_H / 2} fill="hsl(var(--muted))" />
        <text
          x={LABEL_W + TRACK_W + 8}
          y={y1 + BAR_H / 2}
          dy="0.32em"
          fontSize={12}
          fontWeight={700}
          fill="hsl(var(--ink-soft))"
        >
          {format(before)}
        </text>

        {/* After row */}
        <text x={0} y={y2 + BAR_H / 2} dy="0.32em" fontSize={10} fontWeight={700} fill="hsl(var(--success))">
          {afterLabel.toUpperCase()}
        </text>
        <rect x={LABEL_W} y={y2} width={TRACK_W} height={BAR_H} rx={BAR_H / 2} fill="hsl(var(--line))" />
        <rect x={LABEL_W} y={y2} width={afterW} height={BAR_H} rx={BAR_H / 2} fill={`url(#${gradId})`} />
        <text
          x={LABEL_W + TRACK_W + 8}
          y={y2 + BAR_H / 2}
          dy="0.32em"
          fontSize={12}
          fontWeight={800}
          fill="hsl(var(--ink))"
        >
          {format(after)}
        </text>

        {/* Delta readout */}
        <text x={LABEL_W} y={y2 + BAR_H + 16} fontSize={11} fontWeight={700} fill={deltaColor}>
          {deltaLabel}
        </text>
      </svg>
    </div>
  );
}
