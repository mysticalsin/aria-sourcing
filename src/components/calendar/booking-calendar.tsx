"use client";

import * as React from "react";
import {
  CalendarDays,
  CalendarClock,
  CalendarCog,
  CheckCircle2,
  Clock,
  Video,
  CalendarPlus,
  UserRound,
  UserX,
  XCircle,
  ListChecks,
} from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, useToast } from "@/components/ui";
import { bookingNeedsCalendar } from "@/lib/booking-status";
import { useActions } from "@/lib/store";
import type { Booking, BookingStatus } from "@/lib/types";
import { cn, formatTime, formatDate, formatDateTime, ianaForAbbrev, toneForBookingStatus } from "@/lib/utils";

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "No Show"]);

type DayGroup = { key: string; label: string; bookings: Booking[] };

function byStartAsc(a: Booking, b: Booking) {
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

/** ISO -> value a `<input type="datetime-local">` accepts, in local time. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  // No Teams/Outlook URL until Graph confirmLive succeeds — show a clear
  // disabled state instead of a fabricated link that 404s.
  if (!href) {
    return (
      <span
        aria-disabled="true"
        title="Needs calendar — connect Microsoft Graph and book with confirmLive for a Teams meeting (Cal.com roadmap-only)"
        className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full bg-ink/[0.04] px-3 text-xs font-semibold text-muted ring-1 ring-inset ring-line"
      >
        {icon}
        {children} · needs calendar
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
  const actions = useActions();
  const { toast } = useToast();
  const previewAgenda = Array.isArray(booking.agenda) ? booking.agenda.slice(0, 3) : [];
  const extra = (Array.isArray(booking.agenda) ? booking.agenda.length : 0) - previewAgenda.length;
  const isTerminal = TERMINAL_STATUSES.has(booking.status);

  const [rescheduling, setRescheduling] = React.useState(false);
  const [newStart, setNewStart] = React.useState(() => toDatetimeLocalValue(booking.startTime));

  const setOutcome = (status: Extract<BookingStatus, "Completed" | "No Show" | "Cancelled">) => {
    const result = actions.updateBooking(booking.id, { status });
    if (!result.ok) {
      toast({
        title: "Couldn't update the interview",
        description: result.error,
        variant: "error",
      });
      return;
    }
    toast({
      title: `Interview marked ${status}`,
      description: `${booking.candidateName} · ${booking.role}`,
      variant: status === "Completed" ? "success" : "warning",
    });
  };

  const openReschedule = () => {
    setNewStart(toDatetimeLocalValue(booking.startTime));
    setRescheduling(true);
  };

  const saveReschedule = () => {
    const nextStart = new Date(newStart);
    if (!newStart || Number.isNaN(nextStart.getTime())) {
      toast({ title: "Pick a valid date and time", variant: "warning" });
      return;
    }
    const durationMs = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
    const startTime = nextStart.toISOString();
    const endTime = new Date(nextStart.getTime() + durationMs).toISOString();
    const result = actions.updateBooking(booking.id, { startTime, endTime });
    if (!result.ok) {
      toast({ title: "Couldn't reschedule", description: result.error, variant: "error" });
      return;
    }
    toast({
      title: "Interview rescheduled",
      description: `${booking.candidateName} · ${formatDateTime(startTime)}`,
      variant: "success",
    });
    setRescheduling(false);
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-soft">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col gap-0.5 sm:w-32">
          <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink">
            <Clock className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
            {formatTime(booking.startTime, ianaForAbbrev(booking.timezone))}
          </div>
          <div className="pl-5 text-xs text-muted tabular-nums">
            to {formatTime(booking.endTime, ianaForAbbrev(booking.timezone))}
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
            {bookingNeedsCalendar(booking) ? (
              <Badge tone="warning" size="sm" dot>
                Needs calendar
              </Badge>
            ) : null}
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
          {booking.teamsLink ? (
            <LinkButton href={booking.teamsLink} tone="teams" icon={<Video className="h-3.5 w-3.5" aria-hidden />}>
              Teams
            </LinkButton>
          ) : null}
          {booking.calLink ? (
            <LinkButton href={booking.calLink} tone="cal" icon={<CalendarPlus className="h-3.5 w-3.5" aria-hidden />}>
              Calendar
            </LinkButton>
          ) : null}
          {!booking.teamsLink && !booking.calLink ? (
            <span
              aria-disabled="true"
              title="Needs calendar — connect Microsoft Graph and book with confirmLive for a Teams meeting (Cal.com roadmap-only)"
              className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full bg-ink/[0.04] px-3 text-xs font-semibold text-muted ring-1 ring-inset ring-line"
            >
              <Video className="h-3.5 w-3.5" aria-hidden />
              Teams · needs calendar
            </span>
          ) : null}
        </div>
      </div>

      {!isTerminal && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs font-semibold text-muted">Mark outcome:</span>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
            disabled={bookingNeedsCalendar(booking)}
            title={
              bookingNeedsCalendar(booking)
                ? "Needs calendar — connect Microsoft Graph and book with confirmLive before marking Completed"
                : undefined
            }
            onClick={() => setOutcome("Completed")}
          >
            Completed
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<UserX className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => setOutcome("No Show")}
          >
            No show
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => setOutcome("Cancelled")}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<CalendarCog className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => (rescheduling ? setRescheduling(false) : openReschedule())}
          >
            Reschedule
          </Button>
        </div>
      )}

      {!isTerminal && rescheduling && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-ink/[0.03] p-3">
          <Field label="New time" htmlFor={`reschedule-${booking.id}`} className="min-w-[220px] flex-1">
            <Input
              id={`reschedule-${booking.id}`}
              type="datetime-local"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </Field>
          <Button variant="primary" size="sm" onClick={saveReschedule} disabled={!newStart}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRescheduling(false)}>
            Cancel
          </Button>
        </div>
      )}
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
