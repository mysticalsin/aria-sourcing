"use client";

import * as React from "react";
import {
  Activity as ActivityIcon,
  CalendarCheck,
  GraduationCap,
  Megaphone,
  MessageSquare,
  ScanText,
  Send,
  Settings,
  ShieldCheck,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import type { Activity, ActivityType } from "@/lib/types";
import { cn, formatTimeAgo, type Tone } from "@/lib/utils";

const TYPE_META: Record<ActivityType, { icon: LucideIcon; tone: Tone }> = {
  parse: { icon: ScanText, tone: "electric" },
  campaign: { icon: Megaphone, tone: "tangerine" },
  score: { icon: Target, tone: "violet" },
  sourcing: { icon: Users, tone: "electric" },
  outreach: { icon: Send, tone: "tangerine" },
  reply: { icon: MessageSquare, tone: "aqua" },
  booking: { icon: CalendarCheck, tone: "violet" },
  learning: { icon: GraduationCap, tone: "success" },
  compliance: { icon: ShieldCheck, tone: "warning" },
  system: { icon: Settings, tone: "neutral" },
};

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-soft",
  tangerine: "bg-tangerine-soft text-tangerine",
  electric: "bg-electric-soft text-electric",
  aqua: "bg-aqua-soft text-aqua",
  violet: "bg-violet-soft text-violet",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[hsl(32_90%_34%)]",
  danger: "bg-danger-soft text-danger",
};

export function ActivityTimeline({
  activities,
  limit = 12,
  emptyHint,
}: {
  activities: Activity[];
  limit?: number;
  emptyHint?: string;
}) {
  const items = React.useMemo(
    () =>
      [...activities]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit),
    [activities, limit],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon className="h-6 w-6" aria-hidden />}
        title="No activity yet"
        description={emptyHint ?? "Actions across sourcing, outreach, replies and bookings will appear here as the agent works."}
      />
    );
  }

  return (
    <ol className="relative animate-fade-in">
      {items.map((a, i) => {
        const meta = TYPE_META[a.type] ?? TYPE_META.system;
        const Icon = meta.icon;
        const isLast = i === items.length - 1;
        return (
          <li key={a.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[1.125rem] top-10 bottom-0 w-px bg-line"
                aria-hidden
              />
            )}
            <div
              className={cn(
                "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-ink/5",
                TONE_SOFT[meta.tone],
              )}
              aria-hidden
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold leading-snug text-ink">{a.title}</p>
                <time className="shrink-0 text-xs tabular-nums text-muted" dateTime={a.createdAt}>
                  {formatTimeAgo(a.createdAt)}
                </time>
              </div>
              {a.notes && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{a.notes}</p>}
              {a.outcome && (
                <Badge tone={meta.tone} size="sm" className="mt-2">
                  {a.outcome}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
