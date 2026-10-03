"use client";

import { useId, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { EmptyState } from "@/components/ui";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { Filter } from "lucide-react";
import type { FunnelPoint } from "@/lib/types";
import { formatNumber, formatPercent } from "@/lib/utils";

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: FunnelPoint & { conversionFromPrior: number | null; share: number } }>;
}

function FunnelTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-lift">
      <p className="text-xs font-semibold text-ink">{point.stage}</p>
      <p className="text-xs text-muted">{pluralLabel(point.count)}</p>
      {point.conversionFromPrior != null ? (
        <p className="mt-1 text-[0.65rem] font-semibold text-electric">
          {formatPercent(point.conversionFromPrior)} from prior stage
        </p>
      ) : null}
    </div>
  );
}

function pluralLabel(count: number): string {
  return `${formatNumber(count)} candidate${count === 1 ? "" : "s"}`;
}

const STAGE_STOPS = [
  "hsl(var(--tangerine))",
  "hsl(var(--electric))",
  "hsl(var(--aqua))",
  "hsl(var(--violet))",
  "hsl(var(--success))",
];

export function FunnelChart({
  data,
  height = 300,
}: {
  data: FunnelPoint[];
  height?: number;
}) {
  const gradientId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const total = data.reduce((sum, point) => sum + point.count, 0);

  const enriched = useMemo(() => {
    return data.map((point, index) => {
      const prior = index === 0 ? null : data[index - 1]!.count;
      const conversionFromPrior =
        prior != null && prior > 0 ? point.count / prior : prior === 0 ? 0 : null;
      const share = total > 0 ? point.count / total : 0;
      return { ...point, conversionFromPrior, share };
    });
  }, [data, total]);

  if (data.length === 0 || total === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <EmptyState
          icon={<Filter className="h-5 w-5" aria-hidden />}
          title="No funnel data yet"
          description="Source candidates to populate the conversion funnel."
        />
      </div>
    );
  }

  const summary = data
    .map((point) => `${point.stage} ${formatNumber(point.count)}`)
    .join(", ");

  const overallConversion =
    data.length >= 2 && data[0]!.count > 0
      ? data[data.length - 1]!.count / data[0]!.count
      : null;

  return (
    <motion.div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`Conversion funnel: ${summary}`}
      variants={fadeUp}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
    >
      {overallConversion != null ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted">
            End-to-end conversion{" "}
            <span className="font-bold tabular-nums text-ink">
              {formatPercent(overallConversion)}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {enriched.slice(1).map((point) =>
              point.conversionFromPrior != null ? (
                <span
                  key={point.stage}
                  className="rounded-full bg-ink/[0.04] px-2 py-0.5 text-[0.62rem] font-semibold tabular-nums text-ink-soft"
                >
                  → {point.stage} {formatPercent(point.conversionFromPrior)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      <div style={{ height: overallConversion != null ? height - 36 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={enriched}
            margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
            barCategoryGap={12}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--tangerine))" />
                <stop offset="55%" stopColor="hsl(var(--electric))" />
                <stop offset="100%" stopColor="hsl(var(--aqua))" />
              </linearGradient>
            </defs>
            <CartesianGrid
              horizontal={false}
              stroke="hsl(var(--line))"
              strokeDasharray="3 3"
            />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="stage"
              width={84}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "hsl(var(--ink-soft))", fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--ink) / 0.04)" }}
              content={<FunnelTooltip />}
            />
            <Bar
              dataKey="count"
              radius={[0, 10, 10, 0]}
              maxBarSize={28}
              isAnimationActive={!reducedMotion}
              animationDuration={850}
              animationEasing="ease-out"
            >
              {enriched.map((entry, index) => (
                <Cell
                  key={entry.stage}
                  fill={STAGE_STOPS[index % STAGE_STOPS.length] ?? `url(#${gradientId})`}
                  fillOpacity={0.88 - index * 0.06}
                />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                formatter={(value: number) => formatNumber(value)}
                fill="hsl(var(--ink-soft))"
                style={{ fontSize: 12, fontWeight: 700 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
