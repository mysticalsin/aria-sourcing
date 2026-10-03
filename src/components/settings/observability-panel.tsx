"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge, Card, CardContent, Eyebrow } from "@/components/ui";
import { recentEvents, subscribe, type AgentEvent } from "@/lib/agent-events";
import { useActivities, useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Eye, Radio } from "lucide-react";

const KIND_LABEL: Record<AgentEvent["kind"], string> = {
  source: "Source",
  send: "Send",
  reply: "Reply",
  book: "Book",
  allocate: "Allocate",
};

const KIND_COLOR: Record<AgentEvent["kind"], string> = {
  source: "bg-electric",
  send: "bg-tangerine",
  reply: "bg-aqua",
  book: "bg-success",
  allocate: "bg-violet",
};

function countByKind(events: AgentEvent[]): Record<AgentEvent["kind"], number> {
  const base: Record<AgentEvent["kind"], number> = {
    source: 0,
    send: 0,
    reply: 0,
    book: 0,
    allocate: 0,
  };
  for (const e of events) base[e.kind] += 1;
  return base;
}

/** Compact bar chart — Bklit-inspired data viz without a new chart dependency. */
function SparkBars({ counts }: { counts: Record<AgentEvent["kind"], number> }) {
  const kinds = Object.keys(KIND_LABEL) as AgentEvent["kind"][];
  const max = Math.max(1, ...kinds.map((k) => counts[k]));
  return (
    <div className="grid grid-cols-5 gap-2" role="img" aria-label="Agent event counts by kind">
      {kinds.map((kind) => {
        const n = counts[kind];
        const pct = Math.round((n / max) * 100);
        return (
          <div key={kind} className="flex flex-col items-center gap-1.5">
            <div className="flex h-24 w-full items-end justify-center rounded-xl bg-ink/[0.04] px-1.5 pb-1.5">
              <motion.div
                className={cn("w-full max-w-[28px] rounded-lg", KIND_COLOR[kind])}
                initial={{ height: 4 }}
                animate={{ height: `${Math.max(8, pct)}%` }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                title={`${KIND_LABEL[kind]}: ${n}`}
              />
            </div>
            <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
              {KIND_LABEL[kind]}
            </span>
            <span className="text-xs font-semibold tabular-nums text-ink">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ObservabilityPanel() {
  const activities = useActivities();
  const settings = useSettings();
  const [events, setEvents] = React.useState<AgentEvent[]>(() => recentEvents());

  React.useEffect(() => subscribe((e) => setEvents((prev) => [...prev.slice(-63), e])), []);

  const counts = React.useMemo(() => countByKind(events), [events]);
  const recent = [...events].reverse().slice(0, 8);
  const recentActivities = activities.slice(0, 6);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-violet/20 bg-gradient-to-br from-surface to-violet/[0.05]">
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Eyebrow>Live pulse</Eyebrow>
              <p className="mt-1 text-sm font-semibold text-ink">Observability</p>
              <p className="mt-1 max-w-lg text-xs text-muted">
                Motion-smooth charts of what the fleet just did — sourced, sent, replied, booked.
                Pair with the Floor for a full mission-control view.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={settings.dryRunMode ? "aqua" : "tangerine"} size="sm" dot>
                {settings.dryRunMode ? "Dry-run" : "Live sends"}
              </Badge>
              <Badge tone={settings.humanApprovalGate ? "success" : "warning"} size="sm">
                {settings.humanApprovalGate ? "Approval on" : "Approval off"}
              </Badge>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface/90 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
              Event mix (session buffer)
            </div>
            <SparkBars counts={counts} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface/90 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                <Radio className="h-3.5 w-3.5" aria-hidden />
                Agent bus
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-muted">No agent events yet this session. Run a source or outreach pass.</p>
              ) : (
                <ul className="space-y-2">
                  {recent.map((e, i) => (
                    <motion.li
                      key={`${e.at}-${e.kind}-${i}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <span className={cn("h-2 w-2 rounded-full", KIND_COLOR[e.kind])} aria-hidden />
                        {KIND_LABEL[e.kind]}
                        {e.candidateName ? (
                          <span className="truncate font-normal text-muted">{e.candidateName}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {new Date(e.at).toLocaleTimeString()}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-line bg-surface/90 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Activity log
              </div>
              {recentActivities.length === 0 ? (
                <p className="text-sm text-muted">No persisted activities yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentActivities.map((a) => (
                    <li key={a.id} className="text-sm">
                      <p className="font-medium text-ink">{a.title}</p>
                      {a.notes ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{a.notes}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/floor"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm font-semibold text-paper hover:bg-ink/90"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Open Floor
            </Link>
            <Link
              href="/replay"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-canvas"
            >
              Decision replay
            </Link>
            <Link
              href="/exec"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-canvas"
            >
              Exec dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
