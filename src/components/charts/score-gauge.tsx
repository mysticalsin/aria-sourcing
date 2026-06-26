"use client";

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";
import { scoreTone } from "@/lib/utils";
import type { Tone } from "@/lib/utils";
import { clamp, round } from "@/lib/utils";

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

export function ScoreGauge({
  score,
  size = 140,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const safe = round(clamp(score, 0, 100));
  const tone = scoreTone(safe);
  const color = `hsl(var(${TONE_VAR[tone]}))`;
  const numeralSize = Math.round(size * 0.27);

  return (
    <div
      className="relative animate-fade-in"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Match score ${safe} out of 100${label ? `, ${label}` : ""}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="74%"
          outerRadius="100%"
          data={[{ name: "score", value: safe }]}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            background={{ fill: "hsl(var(--line))" }}
            dataKey="value"
            cornerRadius={999}
            fill={color}
            angleAxisId={0}
            isAnimationActive
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-extrabold tabular-nums leading-none"
          style={{ fontSize: numeralSize, color }}
        >
          {safe}
        </span>
        {label ? (
          <span className="mt-1 max-w-[80%] truncate text-center text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
