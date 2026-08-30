"use client";

import * as React from "react";
import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { useCountUp } from "@/components/reveal/use-count-up";
import {
  fadeUp,
  formatAnimatedMetric,
  parseMetricNumber,
  seriesPeriodTrendPercent,
} from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn, formatNumber, type Tone } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

const TONE_VAR: Record<Tone, string> = {
  neutral: "--ink-soft",
  tangerine: "--tangerine",
  electric: "--electric",
  aqua: "--aqua",
  violet: "--violet",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

export function TrendBadge({
  value,
  className,
}: {
  /** Percent change, e.g. 12.4 or -4.8 */
  value: number;
  className?: string;
}) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums",
        positive
          ? "border-success/20 bg-success/10 text-success"
          : "border-danger/20 bg-danger/10 text-danger",
        className,
      )}
    >
      {positive ? (
        <ArrowUp className="h-3 w-3" aria-hidden />
      ) : (
        <ArrowDown className="h-3 w-3" aria-hidden />
      )}
      {positive ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

interface HoverState {
  value: number | null;
  label: string | null;
  trend: number | null;
}

/**
 * Bklit-style compact KPI card: title + trend badge, large value with
 * secondary label, and an edge-bleed axis-free area sparkline. Hovering the
 * spark swaps the value/label/trend to the active point (ChartStatFlow pattern).
 */
export function MetricCard({
  label,
  value,
  hint,
  secondaryLabel,
  icon: _icon,
  tone = "electric",
  delta,
  series,
  trend,
  className,
  delay: _delay = 0,
}: {
  label: string;
  value: string | number;
  /** Kept for callers; prefer `secondaryLabel` for the Bklit sub-label. */
  hint?: string;
  /** Shown under the value (Bklit uses "Avg", "Total", etc.). */
  secondaryLabel?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  /** Legacy absolute delta chip; prefer numeric `trend` percent. */
  delta?: { value: string; positive?: boolean };
  /** Axis-free sparkline series. When set, chart bleeds to card edges. */
  series?: number[];
  /** Period trend percent for the badge. Auto-derived from `series` when omitted. */
  trend?: number | null;
  className?: string;
  delay?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const gradientId = useId();
  const [hover, setHover] = React.useState<HoverState>({
    value: null,
    label: null,
    trend: null,
  });

  const numeric = parseMetricNumber(value);
  const animated = useCountUp(numeric ?? 0, {
    durationMs: 900,
    enabled: numeric != null && !reducedMotion && hover.value == null,
  });

  const chartData = React.useMemo(
    () => (series ?? []).map((point, index) => ({ index, value: point })),
    [series],
  );

  const derivedTrend =
    trend ?? (series && series.length >= 2 ? seriesPeriodTrendPercent(series) : null);
  const displayTrend = hover.trend ?? derivedTrend;
  const subLabel = hover.label ?? secondaryLabel ?? hint;
  const display =
    hover.value != null
      ? formatNumber(hover.value)
      : numeric != null && !reducedMotion
        ? formatAnimatedMetric(value, animated)
        : String(value);

  const color = `hsl(var(${TONE_VAR[tone]}))`;
  const hasChart = chartData.length >= 2;

  return (
    <motion.div
      variants={fadeUp}
      whileHover={
        reducedMotion
          ? undefined
          : { y: -2, transition: { type: "spring", stiffness: 420, damping: 30 } }
      }
      className={cn("h-full", className)}
    >
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-xl border border-line/70 bg-surface shadow-sm",
          "gap-0 py-0",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <p className="text-sm font-medium leading-none text-ink-soft">{label}</p>
          {displayTrend != null ? (
            <TrendBadge value={displayTrend} />
          ) : delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-xs font-medium",
                delta.positive
                  ? "border-success/20 bg-success/10 text-success"
                  : "border-danger/20 bg-danger/10 text-danger",
              )}
            >
              {delta.positive ? (
                <ArrowUp className="h-3 w-3" aria-hidden />
              ) : (
                <ArrowDown className="h-3 w-3" aria-hidden />
              )}
              {delta.value}
            </span>
          ) : null}
        </div>

        <div className={cn("flex flex-1 flex-col gap-3 px-4", hasChart ? "pb-0 pt-1" : "pb-4 pt-1")}>
          <div>
            <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-ink">
              {display}
            </p>
            {subLabel ? (
              <p className="mt-1.5 text-xs font-normal text-muted">{subLabel}</p>
            ) : null}
          </div>

          {hasChart ? (
            <div
              className="relative -mx-4 -mb-0 h-[96px] overflow-hidden"
              role="img"
              aria-label={`${label} trend`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
                  onMouseMove={(state) => {
                    const idx =
                      typeof state?.activeTooltipIndex === "number"
                        ? state.activeTooltipIndex
                        : -1;
                    const point = idx >= 0 ? chartData[idx] : null;
                    if (!point) {
                      setHover({ value: null, label: null, trend: null });
                      return;
                    }
                    const prior = idx > 0 ? chartData[idx - 1]!.value : null;
                    const pointTrend =
                      prior != null && prior !== 0
                        ? ((point.value - prior) / Math.abs(prior)) * 100
                        : prior === 0 && point.value !== 0
                          ? 100
                          : prior === 0
                            ? 0
                            : null;
                    setHover({
                      value: point.value,
                      label: `Period ${point.index + 1}`,
                      trend: pointTrend,
                    });
                  }}
                  onMouseLeave={() => setHover({ value: null, label: null, trend: null })}
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="index" hide />
                  <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                  <Tooltip
                    cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.25 }}
                    content={() => null}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    fillOpacity={1}
                    dot={false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "hsl(var(--surface))",
                      fill: color,
                    }}
                    isAnimationActive={!reducedMotion}
                    animationDuration={850}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
