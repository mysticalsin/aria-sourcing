"use client";

import * as React from "react";
import { Card, CardContent, CardTitle, Eyebrow, Badge, EmptyState } from "@/components/ui";
import type { AllocationResult, AllocationSkip } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { Users, UserCheck, SkipForward, Clock4, Inbox } from "lucide-react";

interface SeatGroup {
  seatId: string;
  seatName: string;
  candidates: { candidateId: string; candidateName: string }[];
}

function groupBySeat(assignments: AllocationResult["assignments"]): SeatGroup[] {
  const map = new Map<string, SeatGroup>();
  for (const a of assignments) {
    let g = map.get(a.seatId);
    if (!g) {
      g = { seatId: a.seatId, seatName: a.seatName, candidates: [] };
      map.set(a.seatId, g);
    }
    g.candidates.push({ candidateId: a.candidateId, candidateName: a.candidateName });
  }
  return Array.from(map.values());
}

function SkipList({
  title,
  items,
  tone,
  icon,
}: {
  title: string;
  items: AllocationSkip[];
  tone: "warning" | "neutral";
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink-soft" aria-hidden>
          {icon}
        </span>
        <h4 className="text-sm font-bold text-ink">{title}</h4>
        <Badge tone={tone} size="sm">
          {items.length}
        </Badge>
      </div>
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li
            key={s.candidateId}
            className="flex items-center justify-between gap-3 rounded-2xl bg-canvas px-3 py-2 text-sm"
          >
            <span className="truncate font-medium text-ink">{s.candidateName}</span>
            <span className="shrink-0 text-xs text-muted">{s.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AllocationResultView({
  result,
  embedded,
}: {
  result: AllocationResult | null;
  embedded?: boolean;
}) {
  if (!result) {
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        title="No allocation run yet"
        description="Run “Allocate outreach” to fan the ready pool across your agents. Every candidate gets one draft from exactly one seat, within each account's daily cap. Each draft still needs your approval before it sends."
      />
    );
  }

  const groups = groupBySeat(result.assignments);
  const total = result.assignments.length;

  const body = (
    <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Allocation plan</Eyebrow>
            <CardTitle>
              {pluralize(total, "draft")} across {pluralize(groups.length, "agent")}
            </CardTitle>
          </div>
          <Badge tone="aqua" dot>
            {result.fleetCapacityRemaining} fleet capacity left today
          </Badge>
        </div>

        {total === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Nothing drafted"
            description="No candidate cleared the guardrails. See skipped and deferred below for why."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.seatId} className="rounded-2xl border border-line bg-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-success-soft text-success" aria-hidden>
                    <UserCheck className="h-4 w-4" />
                  </span>
                  <p className="font-bold text-ink">{g.seatName}</p>
                  <Badge tone="success" size="sm" className="ml-auto">
                    {g.candidates.length}
                  </Badge>
                </div>
                <ul className="space-y-1">
                  {g.candidates.map((c) => (
                    <li key={c.candidateId} className="truncate text-sm text-ink-soft">
                      {c.candidateName}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {(result.skipped.length > 0 || result.deferred.length > 0) && (
          <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
            <SkipList
              title="Skipped"
              items={result.skipped}
              tone="neutral"
              icon={<SkipForward className="h-4 w-4" />}
            />
            <SkipList
              title="Deferred (no capacity)"
              items={result.deferred}
              tone="warning"
              icon={<Clock4 className="h-4 w-4" />}
            />
          </div>
        )}
    </>
  );

  if (embedded) {
    return <div className="animate-fade-in space-y-5 border-t border-line/60 pt-5">{body}</div>;
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="space-y-5">{body}</CardContent>
    </Card>
  );
}
