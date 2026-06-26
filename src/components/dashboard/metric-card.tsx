"use client";

import * as React from "react";
import { Card, Eyebrow } from "@/components/ui";
import { cn, type Tone } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

const TONE_TILE: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-soft",
  tangerine: "bg-tangerine-soft text-tangerine",
  electric: "bg-electric-soft text-electric",
  aqua: "bg-aqua-soft text-aqua",
  violet: "bg-violet-soft text-violet",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[hsl(32_90%_34%)]",
  danger: "bg-danger-soft text-danger",
};

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  delta?: { value: string; positive?: boolean };
}) {
  return (
    <Card className="p-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        {icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]",
              TONE_TILE[tone],
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
        <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums text-ink">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "mb-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
              delta.positive
                ? "bg-success-soft text-success ring-success/20"
                : "bg-danger-soft text-danger ring-danger/20",
            )}
          >
            {delta.positive ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden />
            )}
            {delta.value}
          </span>
        )}
      </div>

      {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>}
    </Card>
  );
}
