"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardHeader, CardBody, CardTitle, Eyebrow, Badge, EmptyState } from "@/components/ui";
import { useDashboardKpis } from "@/lib/store";
import { cn, pluralize, type Tone } from "@/lib/utils";
import {
  ShieldCheck,
  Flame,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";

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

interface Row {
  label: string;
  hint: string;
  count: number;
  href: string;
  tone: Tone;
  icon: React.ReactNode;
}

export function AttentionPanel() {
  const kpis = useDashboardKpis();

  const rows: Row[] = [
    {
      label: "Outreach pending approval",
      hint: "Drafts waiting for your sign-off",
      count: kpis.pendingApprovals,
      href: "/outreach",
      tone: "warning",
      icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
    },
    {
      label: "Hot replies within SLA",
      hint: "Interested candidates to answer fast",
      count: kpis.hotReplies,
      href: "/replies",
      tone: "tangerine",
      icon: <Flame className="h-4 w-4" aria-hidden />,
    },
    {
      label: "Interested awaiting booking",
      hint: "Ready to schedule an interview",
      count: kpis.interested,
      href: "/calendar",
      tone: "violet",
      icon: <CalendarClock className="h-4 w-4" aria-hidden />,
    },
  ];

  const active = rows.filter((r) => r.count > 0);
  const total = active.reduce((sum, r) => sum + r.count, 0);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <Eyebrow>Triage</Eyebrow>
          <CardTitle className="mt-1">Attention needed</CardTitle>
        </div>
        {total > 0 && (
          <Badge tone="warning" dot>
            {pluralize(total, "item")}
          </Badge>
        )}
      </CardHeader>

      <CardBody className="pt-0">
        {active.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-success" aria-hidden />}
            title="All clear"
            description="No approvals, hot replies, or pending bookings right now. The pipeline is flowing."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((row) => (
              <li key={row.href}>
                <Link
                  href={row.href}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-canvas/40 p-3 transition-all duration-150 hover:border-ink/15 hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      TONE_TILE[row.tone],
                    )}
                    aria-hidden
                  >
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {row.label}
                    </span>
                    <span className="block truncate text-xs text-muted">{row.hint}</span>
                  </span>
                  <Badge tone={row.tone} size="sm">
                    {row.count}
                  </Badge>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
