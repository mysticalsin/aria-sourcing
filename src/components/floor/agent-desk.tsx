"use client";

import * as React from "react";
import { Badge } from "@/components/ui";
import { cn, type Tone } from "@/lib/utils";
import { effectiveDailyCap } from "@/lib/fleet";
import { AgentBot, botColorForSeat } from "@/components/floor/agent-bot";
import type { AgentSeat } from "@/lib/types";
import type { AgentActivity } from "@/lib/floor";

const DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  tangerine: "bg-tangerine",
  electric: "bg-electric",
  aqua: "bg-aqua",
  violet: "bg-violet",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function AgentDesk({
  seat,
  activity,
  onSelect,
}: {
  seat: AgentSeat;
  activity: AgentActivity;
  onSelect: (seat: AgentSeat) => void;
}) {
  const cap = effectiveDailyCap(seat);
  const pct = cap ? Math.min(100, (seat.sentToday / cap) * 100) : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(seat)}
      className="card-surface group relative flex w-full flex-col gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <AgentBot
            color={botColorForSeat(seat.id)}
            size={48}
            busy={activity.busy}
            paused={activity.state === "paused"}
            warming={activity.state === "warming"}
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-surface",
              DOT[activity.tone],
              activity.busy && "status-live",
            )}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink">{seat.name}</span>
          <span className="block truncate text-[0.6875rem] text-muted">{seat.provider}</span>
        </span>
      </div>

      <div>
        <Badge tone={activity.tone} size="sm" dot>
          {activity.label}
        </Badge>
        <p className="mt-1.5 truncate text-xs text-muted">{activity.detail}</p>
      </div>

      <div className="min-h-[1.25rem] text-xs text-ink-soft">
        {activity.focusName ? (
          <span className="flex items-center gap-1 truncate">
            <span className="text-muted">On:</span>
            <span className="truncate font-medium text-ink">{activity.focusName}</span>
            {activity.busy && (
              <span className="dot-typing ml-0.5 text-muted" aria-hidden>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted">{activity.contacted} contacted total</span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[0.625rem] font-semibold text-muted">
          <span>Today</span>
          <span className="tabular-nums text-ink-soft">
            {seat.sentToday}/{cap}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
          <div className={cn("h-full rounded-full", DOT[activity.tone])} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}
