"use client";

import { motion } from "framer-motion";
import type { CampaignMetrics } from "@/lib/types";
import { fadeUp, staggerFast } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { Tone } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/utils";

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

export function MiniFunnel({ metrics }: { metrics: CampaignMetrics | null | undefined }) {
  const reducedMotion = usePrefersReducedMotion();
  // Fail-soft: sparse remote campaigns can omit metrics before hydrate repair.
  const m = metrics ?? {
    sourced: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    booked: 0,
    interviewed: 0,
    offer: 0,
    hired: 0,
    notInterested: 0,
    replyRate: 0,
    avgMatchScore: 0,
    timeToFirstInterviewHours: null,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  };
  const rows: { label: string; value: number; tone: Tone }[] = [
    { label: "Sourced", value: m.sourced, tone: "neutral" },
    { label: "Contacted", value: m.contacted, tone: "electric" },
    { label: "Replied", value: m.replied, tone: "aqua" },
    { label: "Booked", value: m.booked, tone: "violet" },
  ];
  const max = Math.max(m.sourced, 1);

  return (
    <motion.div
      className="flex flex-col gap-2.5"
      aria-label="Sourcing funnel snapshot"
      variants={staggerFast}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
    >
      {rows.map((row, index) => {
        const pct = Math.round((row.value / max) * 100);
        const prior = index === 0 ? null : rows[index - 1]!.value;
        const conversion =
          prior != null && prior > 0 ? row.value / prior : prior === 0 ? 0 : null;
        return (
          <motion.div key={row.label} className="flex items-center gap-3" variants={fadeUp}>
            <span className="w-16 shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
              {row.label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line/60">
              <motion.div
                className="h-full rounded-full"
                style={{
                  backgroundColor: `hsl(var(${TONE_VAR[row.tone]}))`,
                }}
                initial={reducedMotion ? false : { width: 0 }}
                animate={{
                  width: `${Math.max(pct, row.value > 0 ? 6 : 0)}%`,
                }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: 0.7, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }
                }
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums text-ink">
              {formatNumber(row.value)}
            </span>
            {conversion != null ? (
              <span className="hidden w-10 shrink-0 text-right text-[0.62rem] font-semibold tabular-nums text-muted sm:inline">
                {formatPercent(conversion)}
              </span>
            ) : (
              <span className="hidden w-10 sm:inline" aria-hidden />
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
