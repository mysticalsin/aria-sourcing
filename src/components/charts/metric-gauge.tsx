"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useCountUp } from "@/components/reveal/use-count-up";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn, formatNumber } from "@/lib/utils";

/**
 * Bklit-inspired notch gauge (arc). `value` is fill 0–100; `centerValue` is the
 * labeled statistic (may differ from fill).
 */
export function MetricGauge({
  value,
  centerValue,
  label = "Total",
  totalNotches = 40,
  spacing = 22,
  className,
  formatCenter,
}: {
  /** Fill level 0–100 */
  value: number;
  centerValue?: number;
  label?: string;
  totalNotches?: number;
  /** Percent gap between notches */
  spacing?: number;
  className?: string;
  formatCenter?: (n: number) => string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));
  const animatedFill = useCountUp(clamped, { durationMs: 900, enabled: !reducedMotion });
  const centerTarget = centerValue ?? clamped;
  const animatedCenter = useCountUp(centerTarget, {
    durationMs: 900,
    enabled: !reducedMotion && centerValue != null,
  });

  const size = 220;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const outerR = 92;
  const innerR = 68;
  const startAngle = 135;
  const endAngle = 405;
  const sweep = endAngle - startAngle;
  const filledCount = Math.round((animatedFill / 100) * totalNotches);

  const notches = React.useMemo(() => {
    const items: { d: string; active: boolean; i: number }[] = [];
    const slot = sweep / totalNotches;
    const gap = (slot * spacing) / 100;
    const span = Math.max(0.5, slot - gap);
    for (let i = 0; i < totalNotches; i++) {
      const a0 = startAngle + i * slot + gap / 2;
      const a1 = a0 + span;
      items.push({
        i,
        active: i < filledCount,
        d: annularSector(cx, cy, innerR, outerR, a0, a1, 2),
      });
    }
    return items;
  }, [filledCount, spacing, totalNotches]);

  const displayCenter =
    centerValue != null
      ? formatCenter
        ? formatCenter(animatedCenter)
        : formatNumber(Math.round(animatedCenter))
      : null;

  return (
    <motion.div
      variants={fadeUp}
      className={cn("flex flex-col items-center justify-center", className)}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-auto w-full max-w-[240px]"
        role="img"
        aria-label={`${label}: ${displayCenter ?? `${Math.round(clamped)}%`}`}
      >
        {notches.map((n) => (
          <path
            key={n.i}
            d={n.d}
            fill={n.active ? "hsl(var(--electric))" : "hsl(var(--line))"}
            fillOpacity={n.active ? 1 : 0.45}
          />
        ))}
        {displayCenter != null ? (
          <g>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="fill-ink"
              style={{ fontSize: 28, fontWeight: 600 }}
            >
              {displayCenter}
            </text>
            <text
              x={cx}
              y={cy + 18}
              textAnchor="middle"
              className="fill-muted"
              style={{ fontSize: 11, fontWeight: 500 }}
            >
              {label}
            </text>
          </g>
        ) : null}
      </svg>
    </motion.div>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function annularSector(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  corner: number,
) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const p0 = polar(cx, cy, r1, a0);
  const p1 = polar(cx, cy, r1, a1);
  const p2 = polar(cx, cy, r0, a1);
  const p3 = polar(cx, cy, r0, a0);
  // Sharp notches by default; corner kept for future capsule clamping.
  void corner;
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}
