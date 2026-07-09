import * as React from "react";
import { cn, type Tone } from "@/lib/utils";

const FILL: Record<Tone, string> = {
  neutral: "bg-ink/40",
  tangerine: "bg-tangerine",
  electric: "bg-electric",
  aqua: "bg-aqua",
  violet: "bg-violet",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Progress({
  value,
  tone = "electric",
  className,
  trackClassName,
  "aria-label": ariaLabel,
}: {
  value: number; // 0-100
  tone?: Tone;
  className?: string;
  trackClassName?: string;
  "aria-label"?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-ink/10", trackClassName, className)}
    >
      <div
        className={cn("motion-progress-fill h-full origin-left rounded-full transition-transform duration-[180ms] ease-motion-out", FILL[tone])}
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

export function Meter({
  label,
  used,
  limit,
  tone = "electric",
}: {
  label: string;
  used: number;
  limit: number;
  tone?: Tone;
}) {
  const pct = limit ? (used / limit) * 100 : 0;
  const effective: Tone = used >= limit ? "danger" : used >= limit - 2 ? "warning" : tone;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="font-bold tabular-nums text-ink">
          {used}
          <span className="text-muted font-medium">/{limit}</span>
        </span>
      </div>
      <Progress value={pct} tone={effective} aria-label={`${label}: ${used} of ${limit}`} />
    </div>
  );
}
