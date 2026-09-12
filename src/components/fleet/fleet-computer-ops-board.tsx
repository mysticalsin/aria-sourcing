"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Download,
  Eye,
  Filter,
  Hand,
  Monitor,
  RefreshCw,
  Shield,
  Users,
} from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  isOrphanComputer,
  type FleetComputerRow,
} from "@/components/fleet/fleet-computers-panel";

export type FleetAuditEvent = {
  id?: string;
  at: string;
  computerId: string;
  seatId?: string | null;
  action: string;
  detail: string;
  actor: "bot" | "human" | "system";
  correlationId?: string | null;
  jobId?: string | null;
};

export type FleetOpsSummary = {
  total: number;
  ready: number;
  starting: number;
  busy: number;
  humanControl: number;
  botControl: number;
  helpRequested: number;
  error: number;
  stopped: number;
  withLiveView: number;
};

const ACTION_LABEL: Record<string, string> = {
  ensure: "Registered",
  start: "Starting",
  ready: "Process ready",
  stop: "Stopped",
  takeover: "Take control",
  release: "Released",
  help_requested: "Help requested",
  act_done: "Action done",
  act_refused: "Refused",
  session_probe: "Session probe",
  session_probe_failed: "Session probe failed",
  start_failed: "Start failed",
  takeover_remote_failed: "Take control failed",
  release_remote_failed: "Release failed",
  start_local_viewport: "Local viewport",
};

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/** Pair takeover→release by correlationId for session length hints. */
function sessionDurationMs(
  eventsAsc: FleetAuditEvent[],
  event: FleetAuditEvent,
): number | null {
  if (event.action !== "release" || !event.correlationId) return null;
  const start = eventsAsc.find(
    (e) => e.action === "takeover" && e.correlationId === event.correlationId,
  );
  if (!start) return null;
  const a = Date.parse(start.at);
  const b = Date.parse(event.at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "danger" | "human";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "danger" && "border-rose-500/30 bg-rose-500/5",
        tone === "human" && "border-tangerine/30 bg-tangerine/5",
        tone === "default" && "border-line bg-surface/60",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Enterprise ops board: KPI strip, filters, per-computer audit timeline, CSV export.
 */
export function FleetComputerOpsBoard({
  computers,
  summary,
  recentAudits,
  onRefresh,
  onSelectComputer,
  selectedComputerId,
}: {
  computers: FleetComputerRow[];
  summary: FleetOpsSummary | null;
  recentAudits: FleetAuditEvent[];
  onRefresh: () => void;
  onSelectComputer?: (computerId: string | null) => void;
  selectedComputerId?: string | null;
}) {
  const [filter, setFilter] = React.useState<"all" | "human" | "help" | "error" | "ready">("all");
  const [actorFilter, setActorFilter] = React.useState<"all" | "human" | "bot" | "system">("all");
  const [correlationFilter, setCorrelationFilter] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const filteredComputers = React.useMemo(() => {
    return computers.filter((c) => {
      // Match GET summary — unbound host VMs must not inflate Ready / seat filters.
      if (isOrphanComputer(c)) return false;
      if (filter === "human" && c.control !== "human") return false;
      if (filter === "help" && c.status !== "help_requested") return false;
      if (filter === "error" && c.status !== "error") return false;
      if (filter === "ready" && c.status !== "ready") return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const hay = `${c.seatName ?? ""} ${c.seatId} ${c.computerId} ${c.lastAudit ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [computers, filter, query]);

  const timeline = React.useMemo(() => {
    let events = recentAudits;
    if (selectedComputerId) {
      events = events.filter((e) => e.computerId === selectedComputerId);
    }
    if (actorFilter !== "all") {
      events = events.filter((e) => e.actor === actorFilter);
    }
    if (correlationFilter) {
      events = events.filter((e) => e.correlationId === correlationFilter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      events = events.filter((e) =>
        `${e.action} ${e.detail} ${e.computerId} ${e.correlationId ?? ""}`.toLowerCase().includes(q),
      );
    }
    return [...events].reverse();
  }, [recentAudits, selectedComputerId, actorFilter, correlationFilter, query]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (selectedComputerId) params.set("computerId", selectedComputerId);
    if (actorFilter !== "all") params.set("actor", actorFilter);
    if (correlationFilter) params.set("correlationId", correlationFilter);
    params.set("format", "csv");
    params.set("limit", "2000");
    window.open(`/api/fleet/computers/audits?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(text);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }

  const s = summary ?? {
    total: computers.length,
    ready: 0,
    starting: 0,
    busy: 0,
    humanControl: 0,
    botControl: 0,
    helpRequested: 0,
    error: 0,
    stopped: 0,
    withLiveView: 0,
  };

  return (
    <section
      className="rounded-2xl border border-line bg-surface/80"
      aria-labelledby="fleet-ops-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Computer operations
          </p>
          <h2 id="fleet-ops-heading" className="mt-0.5 flex items-center gap-2 text-base font-semibold text-ink">
            <Shield className="h-4 w-4 text-electric" aria-hidden />
            Track, audit, and intervene
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Live status for every Chromium seat, human takeover sessions with correlation IDs, and an
            append-only audit trail you can filter and export for compliance reviews.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Computers" value={s.total} hint={`${s.withLiveView} with live view`} />
        <StatCard label="Ready" value={s.ready} tone="good" />
        <StatCard label="Human control" value={s.humanControl} tone="human" hint="Bot paused" />
        <StatCard label="Needs help" value={s.helpRequested} tone="warn" />
        <StatCard label="Errors" value={s.error} tone={s.error ? "danger" : "default"} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-line/60 px-5 py-3">
        <Filter className="h-3.5 w-3.5 text-muted" aria-hidden />
        {(
          [
            ["all", "All"],
            ["ready", "Ready"],
            ["human", "Human control"],
            ["help", "Help"],
            ["error", "Errors"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              filter === id ? "bg-ink text-white" : "bg-ink/5 text-muted hover:bg-ink/10",
            )}
          >
            {label}
          </button>
        ))}
        {correlationFilter ? (
          <button
            type="button"
            onClick={() => setCorrelationFilter(null)}
            className="rounded-full bg-tangerine/15 px-3 py-1 text-xs font-semibold text-tangerine"
            title="Clear session filter"
          >
            Session · clear
          </button>
        ) : null}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search seat, computer, audit, correlation…"
          className="ml-auto min-w-[200px] flex-1 rounded-lg border border-line bg-white/50 px-3 py-1.5 text-sm text-ink outline-none focus:border-electric"
          aria-label="Search fleet computers and audits"
        />
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ul className="max-h-[420px] divide-y divide-line/50 overflow-auto">
          {filteredComputers.length === 0 ? (
            <li className="px-5 py-8 text-sm text-muted">No computers match this filter.</li>
          ) : (
            filteredComputers.map((c) => {
              const selected = selectedComputerId === c.computerId;
              return (
                <li key={c.computerId}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectComputer?.(selected ? null : c.computerId)
                    }
                    className={cn(
                      "flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-ink/[0.03]",
                      selected && "bg-electric/5",
                    )}
                  >
                    <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-electric" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">
                          {c.seatName ?? c.seatId}
                        </span>
                        <Badge
                          size="sm"
                          tone={c.control === "human" ? "tangerine" : "electric"}
                        >
                          {c.control === "human" ? (
                            <span className="inline-flex items-center gap-1">
                              <Hand className="h-3 w-3" /> Human
                            </span>
                          ) : (
                            "Bot"
                          )}
                        </Badge>
                        <span className="text-xs text-muted">{c.status}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{c.computerId}</p>
                      {c.lastAudit ? (
                        <p className="mt-1 truncate text-xs text-muted">{c.lastAudit}</p>
                      ) : null}
                      {c.lastError ? (
                        <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {c.lastError}
                        </p>
                      ) : null}
                    </div>
                    <Eye className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-line/60 lg:border-l lg:border-t-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Activity className="h-4 w-4 text-electric" aria-hidden />
              Audit timeline
              {selectedComputerId ? (
                <span className="font-mono text-xs font-normal text-muted">{selectedComputerId}</span>
              ) : (
                <span className="text-xs font-normal text-muted">Fleet-wide</span>
              )}
            </div>
            <div className="flex gap-1">
              {(["all", "human", "bot", "system"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActorFilter(a)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize",
                    actorFilter === a ? "bg-ink text-white" : "text-muted hover:bg-ink/5",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <ol className="max-h-[380px] space-y-0 overflow-auto px-4 py-2">
            {timeline.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted">
                No audit events yet. Start a computer or Take control to begin the trail.
              </li>
            ) : (
              timeline.map((e, idx) => {
                const duration = sessionDurationMs(recentAudits, e);
                return (
                  <li
                    key={e.id ?? `${e.at}-${e.computerId}-${idx}`}
                    className="relative border-l border-line/70 py-2 pl-4"
                  >
                    <span
                      className={cn(
                        "absolute -left-1 top-3 h-2 w-2 rounded-full",
                        e.actor === "human" && "bg-tangerine",
                        e.actor === "bot" && "bg-electric",
                        e.actor === "system" && "bg-muted",
                      )}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {ACTION_LABEL[e.action] ?? e.action}
                        <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-muted">
                          {e.actor}
                        </span>
                        {duration != null ? (
                          <span className="ml-2 text-[11px] font-normal text-tangerine">
                            session {fmtDuration(duration)}
                          </span>
                        ) : null}
                      </p>
                      <time className="text-[11px] tabular-nums text-muted" dateTime={e.at}>
                        {fmtTime(e.at)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{e.detail}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted/80">
                      <button
                        type="button"
                        className="hover:text-ink"
                        title="Copy computer id"
                        onClick={() => void copyText(e.computerId)}
                      >
                        {copiedId === e.computerId ? "copied" : e.computerId}
                      </button>
                      {e.correlationId ? (
                        <button
                          type="button"
                          className="rounded bg-ink/5 px-1.5 py-0.5 hover:bg-ink/10 hover:text-ink"
                          title="Filter this takeover session"
                          onClick={() =>
                            setCorrelationFilter((cur) =>
                              cur === e.correlationId ? null : e.correlationId ?? null,
                            )
                          }
                        >
                          {e.correlationId}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })
            )}
          </ol>
          <div className="flex items-center gap-2 border-t border-line/50 px-4 py-2 text-[11px] text-muted">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Append-only trail (memory → JSONL → Postgres). CSV export includes correlation and job ids
            for SOC / compliance review.
          </div>
        </div>
      </div>
    </section>
  );
}
