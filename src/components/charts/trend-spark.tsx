"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn, formatNumber, type Tone } from "@/lib/utils";

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

interface TipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { index: number; value: number } }>;
  label?: string | number;
}

function SparkTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const value = typeof point.value === "number" ? point.value : 0;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-lift">
      <p className="text-xs font-semibold tabular-nums text-ink">{formatNumber(value)}</p>
      <p className="text-[0.65rem] text-muted">Point {(point.payload?.index ?? 0) + 1}</p>
    </div>
  );
}

export function TrendSpark({
  data,
  tone = "electric",
  height = 40,
  showSummary = false,
  label,
  className,
}: {
  data: number[];
  tone?: Tone;
  height?: number;
  /** bklit-style header: latest value + period delta */
  showSummary?: boolean;
  label?: string;
  className?: string;
}) {
  const gradientId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const color = `hsl(var(${TONE_VAR[tone]}))`;

  const chartData = useMemo(
    () => data.map((value, index) => ({ index, value })),
    [data],
  );

  const latest = data.length ? data[data.length - 1]! : 0;
  const previous = data.length > 1 ? data[data.length - 2]! : latest;
  const delta = latest - previous;
  const deltaPositive = delta >= 0;

  if (data.length === 0) {
    return (
      <div
        className={cn("w-full rounded-2xl bg-line/40", className)}
        aria-hidden
        style={{ height }}
      />
    );
  }

  const chart = (
    <div className="w-full" style={{ height }} aria-hidden={!showSummary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="55%" stopColor={color} stopOpacity={0.12} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {height >= 72 ? (
            <CartesianGrid
              vertical={false}
              stroke="hsl(var(--line))"
              strokeDasharray="3 3"
              strokeOpacity={0.7}
            />
          ) : null}
          <XAxis dataKey="index" hide />
          <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
          {height >= 56 ? (
            <Tooltip
              cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.35 }}
              content={<SparkTooltip />}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.25}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={
              height >= 56
                ? { r: 4, strokeWidth: 2, stroke: "hsl(var(--surface))", fill: color }
                : false
            }
            isAnimationActive={!reducedMotion}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  if (!showSummary) {
    return <div className={className}>{chart}</div>;
  }

  return (
    <motion.div
      className={cn("rounded-2xl border border-line bg-surface/70 p-3", className)}
      variants={fadeUp}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {label ? <p className="truncate text-sm font-bold text-ink">{label}</p> : null}
          <p className="text-2xl font-extrabold tabular-nums tracking-tight text-ink">
            {formatNumber(latest)}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.65rem] font-bold tabular-nums ring-1 ring-inset",
            deltaPositive
              ? "bg-success-soft text-success ring-success/20"
              : "bg-danger-soft text-danger ring-danger/20",
          )}
        >
          {deltaPositive ? "+" : ""}
          {formatNumber(delta)}
        </span>
      </div>
      {chart}
    </motion.div>
  );
}
