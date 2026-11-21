"use client";

import * as React from "react";
import { CalendarCheck, ClipboardCheck, MailCheck, Reply, UserCheck, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  formatQuickStatValue,
  selectQuickStats,
  type QuickStatId,
  type QuickStatSource,
} from "@/lib/quick-stats";

const ICONS: Record<QuickStatId, React.ReactNode> = {
  toRate: <Users aria-hidden />,
  inAssessment: <ClipboardCheck aria-hidden />,
  interviewsThisWeek: <CalendarCheck aria-hidden />,
  awaitingApproval: <MailCheck aria-hidden />,
  replies: <Reply aria-hidden />,
  hires: <UserCheck aria-hidden />,
};

/** Six quick-stat cards. The numbers come from the selector module. */
export function CommandCenterStats({ source }: { source: QuickStatSource }) {
  const stats = selectQuickStats(source);
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Quick stats">
      {stats.map((stat) => (
        <MetricCard
          key={stat.id}
          label={stat.label}
          value={formatQuickStatValue(stat.value)}
          hint={stat.hint}
          icon={ICONS[stat.id]}
          tone={stat.tone}
        />
      ))}
    </section>
  );
}
