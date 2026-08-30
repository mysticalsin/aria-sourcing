"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MetricCard } from "@/components/dashboard/metric-card";
import { staggerContainer } from "@/lib/dashboard-motion";
import { useFleetSummary } from "@/lib/store";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { formatNumber, formatPercent } from "@/lib/utils";
import { Bot, Radio, Send, Gauge, PauseOctagon, MailWarning, AlertOctagon } from "lucide-react";

/**
 * Roll-up strip for the whole fleet. Self-contained via useFleetSummary().
 */
export function FleetSummary() {
  const s = useFleetSummary();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
      variants={staggerContainer}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
    >
      <MetricCard
        label="Active agents"
        value={`${s.activeSeats}`}
        hint={`${formatNumber(s.seats)} total seats`}
        icon={<Bot />}
        tone="electric"
      />
      <MetricCard
        label="Live agents"
        value={`${s.liveSeats}`}
        hint="Verified domain + live mode"
        icon={<Radio />}
        tone="tangerine"
      />
      <MetricCard
        label="Sent today"
        value={formatNumber(s.sentToday)}
        hint="Across all seats (dry-run)"
        icon={<Send />}
        tone="aqua"
      />
      <MetricCard
        label="Capacity left"
        value={formatNumber(s.remainingToday)}
        hint={`of ${formatNumber(s.capacityToday)} warmed cap`}
        icon={<Gauge />}
        tone="violet"
      />
      <MetricCard
        label="Paused"
        value={`${s.pausedSeats}`}
        hint="Manual or auto-paused"
        icon={<PauseOctagon />}
        tone={s.pausedSeats > 0 ? "warning" : "neutral"}
      />
      <MetricCard
        label="Avg bounce"
        value={formatPercent(s.avgBounceRate, 1)}
        hint="Auto-pause guards deliverability"
        icon={<MailWarning />}
        tone={s.avgBounceRate > 0.05 ? "danger" : s.avgBounceRate > 0.03 ? "warning" : "success"}
      />
      <MetricCard
        label="Avg complaint"
        value={formatPercent(s.avgComplaintRate, 2)}
        hint="ESP red line is 0.10%"
        icon={<AlertOctagon />}
        tone={s.avgComplaintRate > 0.001 ? "danger" : "success"}
      />
    </motion.div>
  );
}
