"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui";
import { Filter } from "lucide-react";
import type { FunnelPoint } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: FunnelPoint }>;
}

function FunnelTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-lift">
      <p className="text-xs font-semibold text-ink">{point.stage}</p>
      <p className="text-xs text-muted">{pluralLabel(point.count)}</p>
    </div>
  );
}

function pluralLabel(count: number): string {
  return `${formatNumber(count)} candidate${count === 1 ? "" : "s"}`;
}

export function FunnelChart({
  data,
  height = 300,
}: {
  data: FunnelPoint[];
  height?: number;
}) {
  const gradientId = useId();
  const total = data.reduce((sum, point) => sum + point.count, 0);

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

  return (
    <div className="animate-fade-in" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 36, bottom: 4, left: 8 }}
          barCategoryGap={10}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--tangerine))" />
              <stop offset="100%" stopColor="hsl(var(--electric))" />
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
            fill={`url(#${gradientId})`}
            radius={[0, 8, 8, 0]}
            maxBarSize={26}
            isAnimationActive
          >
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
  );
}
