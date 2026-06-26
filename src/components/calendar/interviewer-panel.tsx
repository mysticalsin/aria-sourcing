"use client";

import * as React from "react";
import { Users, Sparkles, CalendarCheck } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle, Eyebrow, Badge, Progress, EmptyState } from "@/components/ui";
import { getInterviewers, nextInterviewer } from "@/lib/mock-ai";
import { useBookings } from "@/lib/store";
import { cn, initialsFrom, pluralize } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["Proposed", "Confirmed", "Completed"]);

export function InterviewerPanel() {
  const bookings = useBookings();
  const interviewers = getInterviewers();

  const { rows, nextUpEmail, totalLoad } = React.useMemo(() => {
    const counts = new Map<string, number>();
    let active = 0;
    for (const b of bookings) {
      if (!ACTIVE_STATUSES.has(b.status)) continue;
      active += 1;
      counts.set(b.interviewerEmail, (counts.get(b.interviewerEmail) ?? 0) + 1);
    }
    const built = interviewers.map((iv) => ({
      ...iv,
      load: counts.get(iv.email) ?? 0,
    }));
    const maxLoad = built.reduce((m, r) => Math.max(m, r.load), 0);
    const next = nextInterviewer(active);
    return {
      rows: built.map((r) => ({ ...r, pct: maxLoad === 0 ? 0 : (r.load / maxLoad) * 100 })),
      nextUpEmail: next.email,
      totalLoad: active,
    };
  }, [bookings, interviewers]);

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Round-robin</Eyebrow>
          <CardTitle className="mt-1">Interviewer panel</CardTitle>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-aqua-soft text-aqua">
          <Users className="h-4 w-4" aria-hidden />
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
          {pluralize(totalLoad, "interview")} balanced across {pluralize(interviewers.length, "interviewer")}
        </p>

        {interviewers.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden />}
            title="No interviewers configured"
            description="Add interviewers to enable round-robin scheduling."
          />
        ) : (
          <ul className="space-y-2.5">
            {rows.map((iv) => {
              const isNext = iv.email === nextUpEmail;
              return (
                <li
                  key={iv.email}
                  className={cn(
                    "rounded-2xl border p-3.5 transition-colors",
                    isNext
                      ? "border-tangerine/30 bg-tangerine-soft/60 ring-1 ring-inset ring-tangerine/20"
                      : "border-line bg-surface",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isNext ? "bg-tangerine text-white" : "bg-ink/[0.06] text-ink-soft",
                      )}
                      aria-hidden
                    >
                      {initialsFrom(iv.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold text-ink">{iv.name}</span>
                        {isNext && (
                          <Badge tone="tangerine" size="sm">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            Next up
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted">{iv.role}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-extrabold tabular-nums text-ink">{iv.load}</div>
                      <div className="text-[0.6875rem] uppercase tracking-wide text-muted">load</div>
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <Progress value={iv.pct} tone={isNext ? "tangerine" : "aqua"} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
