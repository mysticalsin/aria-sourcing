"use client";

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
import { EmptyState } from "@/components/ui";
import { Gauge } from "lucide-react";
import { scoreDistribution } from "@/lib/scoring";
import type { Tone } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";

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

/* Ascending palette: low bands warm/red, high bands green. */
const BAND_TONE: Tone[] = ["danger", "warning", "tangerine", "electric", "success"];

interface DistPoint {
  band: string;
  count: number;
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: DistPoint }>;
}

function DistTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-lift">
      <p className="text-xs font-semibold text-ink">Match {point.band}</p>
      <p className="text-xs text-muted">
        {formatNumber(point.count)} candidate{point.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function ScoreDistribution({
  scores,
  height = 220,
}: {
  scores: number[];
  height?: number;
}) {
  if (scores.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <EmptyState
          icon={<Gauge className="h-5 w-5" aria-hidden />}
          title="No scores yet"
          description="Match scores appear once candidates are sourced."
        />
      </div>
    );
  }

  const data = scoreDistribution(scores);

  return (
    <div className="animate-fade-in" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid
            vertical={false}
            stroke="hsl(var(--line))"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="band"
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--line))" }}
            tick={{ fill: "hsl(var(--ink-soft))", fontSize: 11, fontWeight: 600 }}
          />
          <YAxis hide allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "hsl(var(--ink) / 0.04)" }}
            content={<DistTooltip />}
          />
          <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={56} isAnimationActive>
            {data.map((entry, index) => (
              <Cell
                key={entry.band}
                fill={`hsl(var(${TONE_VAR[BAND_TONE[index] ?? "neutral"]}))`}
              />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              formatter={(value: number) => (value > 0 ? formatNumber(value) : "")}
              fill="hsl(var(--ink-soft))"
              style={{ fontSize: 11, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
