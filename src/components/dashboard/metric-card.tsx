"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Card, Eyebrow } from "@/components/ui";
import { useCountUp } from "@/components/reveal/use-count-up";
import {
  fadeUp,
  formatAnimatedMetric,
  parseMetricNumber,
} from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
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

const TONE_GLOW: Record<Tone, string> = {
  neutral: "from-ink/[0.04] to-transparent",
  tangerine: "from-tangerine/10 to-transparent",
  electric: "from-electric/10 to-transparent",
  aqua: "from-aqua/10 to-transparent",
  violet: "from-violet/10 to-transparent",
  success: "from-success/10 to-transparent",
  warning: "from-warning/10 to-transparent",
  danger: "from-danger/10 to-transparent",
};

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  delta,
  className,
  delay = 0,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  delta?: { value: string; positive?: boolean };
  className?: string;
  /** Stagger delay in seconds when not wrapped in a stagger parent. */
  delay?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const numeric = parseMetricNumber(value);
  const animated = useCountUp(numeric ?? 0, {
    durationMs: 900,
    enabled: numeric != null && !reducedMotion,
  });
  const display =
    numeric != null && !reducedMotion
      ? formatAnimatedMetric(value, animated)
      : String(value);

  return (
    <motion.div
      variants={fadeUp}
      whileHover={
        reducedMotion
          ? undefined
          : { y: -3, transition: { type: "spring", stiffness: 420, damping: 28 } }
      }
      className={cn("h-full", className)}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      <Card className="relative h-full overflow-hidden p-5">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b opacity-80",
            TONE_GLOW[tone],
          )}
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-3">
          <Eyebrow>{label}</Eyebrow>
          {icon && (
            <motion.span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]",
                TONE_TILE[tone],
              )}
              aria-hidden
              whileHover={reducedMotion ? undefined : { rotate: [-2, 2, 0], scale: 1.06 }}
              transition={{ duration: 0.35 }}
            >
              {icon}
            </motion.span>
          )}
        </div>

        <div className="relative mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
          <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums text-ink">
            {display}
          </span>
          {delta && (
            <motion.span
              initial={reducedMotion ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: delay + 0.25, duration: 0.35 }}
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
            </motion.span>
          )}
        </div>

        {hint && <p className="relative mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>}
      </Card>
    </motion.div>
  );
}
