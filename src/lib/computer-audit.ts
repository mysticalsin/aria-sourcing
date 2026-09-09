/**
 * Durable + in-process computer audit trail for Fleet / OpenBot.
 *
 * Writes:
 *  1. Process ring buffer (fast UI)
 *  2. Append-only JSONL (local/dev survival across soft restarts)
 *  3. Postgres `computer_audits` when service-role Supabase is configured
 *
 * Reads merge in-memory + JSONL; live tenants should prefer Postgres via API.
 */

import fs from "node:fs";
import path from "node:path";
import { getServiceSupabase } from "@/lib/supabase/server";

export type ComputerAuditActor = "bot" | "human" | "system";

export type ComputerAuditEvent = {
  id: string;
  at: string;
  workspaceId: string;
  computerId: string;
  seatId?: string | null;
  campaignId?: string | null;
  action: string;
  detail: string;
  actor: ComputerAuditActor;
  correlationId?: string | null;
  jobId?: string | null;
  meta?: Record<string, unknown>;
};

const MAX_MEMORY = 5_000;
const memory: ComputerAuditEvent[] = [];

function auditLogPath(): string {
  return (
    process.env.COMPUTER_AUDIT_LOG_PATH?.trim() ||
    path.join(process.env.ARIA_DATA_DIR?.trim() || "/tmp", "aria-computer-audits.jsonl")
  );
}

function makeId(): string {
  return `caud_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function pushMemory(event: ComputerAuditEvent) {
  memory.push(event);
  if (memory.length > MAX_MEMORY) {
    memory.splice(0, memory.length - MAX_MEMORY);
  }
}

function appendJsonl(event: ComputerAuditEvent) {
  try {
    const file = auditLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  } catch {
    /* disk full / read-only — memory still holds the event */
  }
}

async function appendPostgres(event: ComputerAuditEvent) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) return;
    await supabase.from("computer_audits").insert({
      id: event.id,
      workspace_id: event.workspaceId,
      computer_id: event.computerId,
      seat_id: event.seatId ?? null,
      campaign_id: event.campaignId ?? null,
      action: event.action,
      detail: event.detail,
      actor: event.actor,
      correlation_id: event.correlationId ?? null,
      job_id: event.jobId ?? null,
      meta: event.meta ?? {},
      created_at: event.at,
    });
  } catch {
    /* table may not exist yet in older envs — JSONL remains */
  }
}

export function recordComputerAudit(
  input: Omit<ComputerAuditEvent, "id" | "at"> & { at?: string; id?: string },
): ComputerAuditEvent {
  const event: ComputerAuditEvent = {
    id: input.id ?? makeId(),
    at: input.at ?? new Date().toISOString(),
    workspaceId: input.workspaceId,
    computerId: input.computerId,
    seatId: input.seatId ?? null,
    campaignId: input.campaignId ?? null,
    action: input.action,
    detail: input.detail,
    actor: input.actor,
    correlationId: input.correlationId ?? null,
    jobId: input.jobId ?? null,
    meta: input.meta ?? {},
  };
  pushMemory(event);
  appendJsonl(event);
  void appendPostgres(event);
  return event;
}

export type ComputerAuditQuery = {
  workspaceId: string;
  computerId?: string;
  campaignId?: string;
  action?: string;
  actor?: ComputerAuditActor;
  correlationId?: string;
  /** Inclusive lower bound (ISO). */
  since?: string;
  /** Inclusive upper bound (ISO). */
  until?: string;
  limit?: number;
};

function readJsonlTail(limit: number): ComputerAuditEvent[] {
  try {
    const file = auditLogPath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const slice = lines.slice(-Math.max(limit * 4, 200));
    const out: ComputerAuditEvent[] = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as ComputerAuditEvent);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function matches(event: ComputerAuditEvent, q: ComputerAuditQuery): boolean {
  if (event.workspaceId !== q.workspaceId) return false;
  if (q.computerId && event.computerId !== q.computerId) return false;
  if (q.campaignId && event.campaignId !== q.campaignId) return false;
  if (q.action && event.action !== q.action) return false;
  if (q.actor && event.actor !== q.actor) return false;
  if (q.correlationId && event.correlationId !== q.correlationId) return false;
  if (q.since && event.at < q.since) return false;
  if (q.until && event.at > q.until) return false;
  return true;
}

/** Sync query for Fleet UI (memory + JSONL). */
export function queryComputerAudits(q: ComputerAuditQuery): ComputerAuditEvent[] {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 2_000);
  const merged = new Map<string, ComputerAuditEvent>();
  for (const e of readJsonlTail(limit)) {
    if (matches(e, q)) merged.set(e.id, e);
  }
  for (const e of memory) {
    if (matches(e, q)) merged.set(e.id, e);
  }
  return [...merged.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit);
}

/** Prefer Postgres when available (enterprise multi-instance). */
export async function queryComputerAuditsDurable(
  q: ComputerAuditQuery,
): Promise<ComputerAuditEvent[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 2_000);
  try {
    const supabase = getServiceSupabase();
    if (supabase) {
      let req = supabase
        .from("computer_audits")
        .select(
          "id, workspace_id, computer_id, seat_id, campaign_id, action, detail, actor, correlation_id, job_id, meta, created_at",
        )
        .eq("workspace_id", q.workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (q.computerId) req = req.eq("computer_id", q.computerId);
      if (q.campaignId) req = req.eq("campaign_id", q.campaignId);
      if (q.action) req = req.eq("action", q.action);
      if (q.actor) req = req.eq("actor", q.actor);
      if (q.correlationId) req = req.eq("correlation_id", q.correlationId);
      if (q.since) req = req.gte("created_at", q.since);
      if (q.until) req = req.lte("created_at", q.until);
      const { data, error } = await req;
      if (!error && data) {
        return data
          .map((row) => ({
            id: String(row.id),
            at: String(row.created_at),
            workspaceId: String(row.workspace_id),
            computerId: String(row.computer_id),
            seatId: row.seat_id ? String(row.seat_id) : null,
            campaignId: row.campaign_id ? String(row.campaign_id) : null,
            action: String(row.action),
            detail: String(row.detail ?? ""),
            actor: row.actor as ComputerAuditActor,
            correlationId: row.correlation_id ? String(row.correlation_id) : null,
            jobId: row.job_id ? String(row.job_id) : null,
            meta: (row.meta as Record<string, unknown>) ?? {},
          }))
          .reverse();
      }
    }
  } catch {
    /* fall through */
  }
  return queryComputerAudits(q);
}

export function computerAuditsToCsv(events: ComputerAuditEvent[]): string {
  const header = [
    "at",
    "workspace_id",
    "computer_id",
    "seat_id",
    "campaign_id",
    "action",
    "actor",
    "detail",
    "correlation_id",
    "job_id",
    "id",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = events.map((e) =>
    [
      e.at,
      e.workspaceId,
      e.computerId,
      e.seatId ?? "",
      e.campaignId ?? "",
      e.action,
      e.actor,
      e.detail,
      e.correlationId ?? "",
      e.jobId ?? "",
      e.id,
    ]
      .map((c) => escape(String(c)))
      .join(","),
  );
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

export type FleetComputerOpsSummary = {
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

export function summarizeFleetComputers(
  computers: Array<{
    status: string;
    control: string;
    viewUrl?: string | null;
    remoteUrl?: string | null;
  }>,
): FleetComputerOpsSummary {
  const summary: FleetComputerOpsSummary = {
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
  for (const c of computers) {
    if (c.status === "ready") summary.ready += 1;
    else if (c.status === "starting") summary.starting += 1;
    else if (c.status === "busy") summary.busy += 1;
    else if (c.status === "help_requested") summary.helpRequested += 1;
    else if (c.status === "error") summary.error += 1;
    else if (c.status === "stopped") summary.stopped += 1;
    if (c.control === "human") summary.humanControl += 1;
    else summary.botControl += 1;
    if (c.viewUrl || c.remoteUrl) summary.withLiveView += 1;
  }
  return summary;
}

/** Test helper — clear in-memory buffer only. */
export function __resetComputerAuditMemoryForTests() {
  memory.length = 0;
}
