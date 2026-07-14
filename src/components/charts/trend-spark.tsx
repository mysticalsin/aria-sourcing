"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { Tone } from "@/lib/utils";

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

export function TrendSpark({
  data,
  tone = "electric",
}: {
  data: number[];
  tone?: Tone;
}) {
  const gradientId = useId();
  const color = `hsl(var(${TONE_VAR[tone]}))`;

  if (data.length === 0) {
    return (
      <div
        className="h-10 w-full rounded-full bg-line/50"
        aria-hidden
        style={{ height: 40 }}
      />
    );
  }

  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div className="w-full" style={{ height: 40 }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 3, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
