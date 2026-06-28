"use client";

import * as React from "react";
import {
  CalendarDays,
  CalendarClock,
  Clock,
  Video,
  CalendarPlus,
  UserRound,
  ListChecks,
} from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import type { Booking } from "@/lib/types";
import { cn, formatTime, formatDate, toneForBookingStatus } from "@/lib/utils";

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "No Show"]);

type DayGroup = { key: string; label: string; bookings: Booking[] };

function byStartAsc(a: Booking, b: Booking) {
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

function groupByDay(bookings: Booking[], order: "asc" | "desc"): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const b of bookings) {
    const d = new Date(b.startTime);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let group = map.get(key);
    if (!group) {
      group = { key, label: formatDate(b.startTime), bookings: [] };
      map.set(key, group);
    }
    group.bookings.push(b);
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.bookings.sort(byStartAsc);
  groups.sort((a, b) => {
    const da = new Date(a.bookings[0].startTime).getTime();
    const db = new Date(b.bookings[0].startTime).getTime();
    return order === "asc" ? da - db : db - da;
  });
  return groups;
}

function LinkButton({
  href,
  icon,
  children,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone: "teams" | "cal";
}) {
  // No real meeting URL until a live calendar integration is connected — show a
  // clear disabled state instead of a fabricated link that 404s.
  if (!href) {
    return (
      <span
        aria-disabled="true"
        title="Meeting link is generated once the calendar integration goes live"
        className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full bg-ink/[0.04] px-3 text-xs font-semibold text-muted ring-1 ring-inset ring-line"
      >
        {icon}
        {children} · on live send
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
        tone === "teams"
          ? "bg-electric-soft text-electric ring-electric/20 hover:bg-electric/15"
          : "bg-violet-soft text-violet ring-violet/20 hover:bg-violet/15",
      )}
    >
      {icon}
      {children}
    </a>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const previewAgenda = booking.agenda.slice(0, 3);
  const extra = booking.agenda.length - previewAgenda.length;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-soft sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col gap-0.5 sm:w-32">
        <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink">
          <Clock className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
          {formatTime(booking.startTime)}
        </div>
        <div className="pl-5 text-xs text-muted tabular-nums">
          to {formatTime(booking.endTime)}
        </div>
        <div className="pl-5 text-[0.6875rem] uppercase tracking-wide text-muted">
          {booking.timezone}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-bold text-ink">{booking.candidateName}</h4>
          <Badge tone={toneForBookingStatus(booking.status)} size="sm" dot>
            {booking.status}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-soft">{booking.role}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <UserRound className="h-3.5 w-3.5" aria-hidden />
          {booking.interviewer}
        </p>

        {previewAgenda.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
            {previewAgenda.map((item, i) => (
              <span
                key={i}
                className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-[0.6875rem] font-medium text-ink-soft"
              >
                {item}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-[0.6875rem] font-semibold text-muted">+{extra} more</span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
        <LinkButton href={booking.teamsLink} tone="teams" icon={<Video className="h-3.5 w-3.5" aria-hidden />}>
          Teams
        </LinkButton>
        <LinkButton href={booking.calLink} tone="cal" icon={<CalendarPlus className="h-3.5 w-3.5" aria-hidden />}>
          Cal.com
        </LinkButton>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  groups,
}: {
  title: string;
  icon: React.ReactNode;
  groups: DayGroup[];
}) {
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, g) => sum + g.bookings.length, 0);
  return (
    <section className="animate-fade-in">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-soft">
          {icon}
        </span>
        <h3 className="eyebrow">{title}</h3>
        <Badge tone="neutral" size="sm">
          {total}
        </Badge>
      </div>
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-tangerine" aria-hidden />
              {group.label}
            </div>
            <div className="space-y-2.5">
              {group.bookings.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BookingCalendar({ bookings }: { bookings: Booking[] }) {
  const { upcoming, past } = React.useMemo(() => {
    const now = Date.now();
    const up: Booking[] = [];
    const old: Booking[] = [];
    for (const b of bookings) {
      const isTerminal = TERMINAL_STATUSES.has(b.status);
      const isFuture = new Date(b.startTime).getTime() >= now;
      if (isFuture && !isTerminal) up.push(b);
      else old.push(b);
    }
    return {
      upcoming: groupByDay(up, "asc"),
      past: groupByDay(old, "desc"),
    };
  }, [bookings]);

  if (bookings.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-6 w-6" aria-hidden />}
        title="No interviews scheduled"
        description="Book an interview from a candidate or the Ready-to-book panel and it will appear here as an agenda."
      />
    );
  }

  return (
    <div className="space-y-10">
      <Section
        title="Upcoming"
        icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
        groups={upcoming}
      />
      <Section
        title="Past / Completed"
        icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
        groups={past}
      />
    </div>
  );
}
