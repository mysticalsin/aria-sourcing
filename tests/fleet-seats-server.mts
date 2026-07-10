import { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AgentSeatRow } from "../src/lib/fleet-seats";

process.env.NODE_ENV = "test";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const serverSeatId = "22222222-2222-4222-8222-222222222222";
let role: "admin" | "member" = "admin";
let insertedRows: Record<string, unknown>[] = [];

function seatRow(input: Record<string, unknown>): AgentSeatRow {
  return {
    id: serverSeatId,
    workspace_id: String(input.workspace_id ?? workspaceId),
    name: String(input.name ?? "Agent One"),
    operator_email: String(input.operator_email ?? "agent@example.test"),
    provider: String(input.provider ?? "Gmail API"),
    status: "active",
    mode: String(input.mode ?? "mock"),
    domain_verified: false,
    daily_limit: Number(input.daily_limit ?? 40),
    warmup: Boolean(input.warmup ?? true),
    warmup_start_cap: Number(input.warmup_start_cap ?? 10),
    warmup_step_per_day: Number(input.warmup_step_per_day ?? 4),
    warmup_started_at: "2026-07-10T00:00:00.000Z",
    min_gap_minutes: Number(input.min_gap_minutes ?? 12),
    persona: String(input.persona ?? ""),
    signature: String(input.signature ?? ""),
    connected_account: "",
    created_at: "2026-07-10T00:00:00.000Z",
  };
}

function makeFakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "admin@example.test" } }, error: null }) },
    rpc: async (fn: string) => {
      if (fn === "ensure_workspace") return { data: workspaceId, error: null };
      if (fn === "current_profile_role") return { data: role, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      assert.equal(table, "agent_seats");
      let pendingInsert: Record<string, unknown> | null = null;
      const query: any = {
        insert: (row: Record<string, unknown>) => {
          pendingInsert = row;
          insertedRows.push(row);
          return query;
        },
        update: () => query,
        delete: () => query,
        eq: () => query,
        select: () => query,
        single: async () => ({ data: pendingInsert ? seatRow(pendingInsert) : null, error: null }),
        maybeSingle: async () => ({ data: pendingInsert ? seatRow(pendingInsert) : null, error: null }),
      };
      return query;
    },
  };
}

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: true,
    prodFailClosed: () => null,
  },
});

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => makeFakeSupabase(),
    getServiceSupabase: () => null,
    requireAdmin: async () => ({ ok: true, role: "admin" }),
  },
});

const { NextRequest } = await import("next/server");
const route = await import("../src/app/api/fleet/seats/route.ts");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/fleet/seats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

{
  role = "admin";
  insertedRows = [];
  const res = await route.POST(req({
    name: "Agent One",
    operatorEmail: "agent@example.test",
    provider: "Gmail API",
    dailyLimit: 35,
  }));
  const json = await res.json();
  ok("POST creates an agent_seats row", res.status === 200 && json.ok === true && insertedRows.length === 1);
  ok("POST scopes the row to ensure_workspace workspace", insertedRows[0]?.workspace_id === workspaceId);
  ok("POST returns the server UUID id", json.id === serverSeatId && /^[0-9a-f-]{36}$/i.test(json.id));
}

{
  role = "member";
  insertedRows = [];
  const res = await route.POST(req({
    name: "Blocked Agent",
    operatorEmail: "blocked@example.test",
    provider: "Gmail API",
  }));
  ok("non-admin without manage_fleet gets 403", res.status === 403 && insertedRows.length === 0);
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      ok: true,
      id: serverSeatId,
      seat: seatRow({
        id: serverSeatId,
        name: "Server Agent",
        operator_email: "server@example.test",
        provider: "Gmail API",
        mode: "mock",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const { createFleetSeatOnServer } = await import("../src/lib/fleet-seats.ts");
  const created = await createFleetSeatOnServer({
    id: "seat_1",
    name: "Local Agent",
    operatorEmail: "local@example.test",
    provider: "Gmail API",
    status: "active",
    mode: "mock",
    domainVerified: false,
    dailyLimit: 40,
    warmup: true,
    warmupStartCap: 10,
    warmupStepPerDay: 4,
    warmupStartedAt: "2026-07-10T00:00:00.000Z",
    minGapMinutes: 12,
    sendWindow: { startHour: 9, endHour: 17, timezone: "UTC", days: [1, 2, 3, 4, 5] },
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "",
    createdAt: "2026-07-10T00:00:00.000Z",
  });
  globalThis.fetch = originalFetch;
  ok("live seat creation adopts server UUID", created.ok && created.seat.id === serverSeatId);
  ok("server row is authoritative for operator email", created.ok && created.seat.operatorEmail === "server@example.test");
}

{
  const sql = readFileSync("supabase/migrations/0018_first_admin.sql", "utf8");
  const createdBranch = sql.indexOf("workspace_was_created := true");
  const adminBranch = sql.indexOf("case when workspace_was_created then 'admin'");
  ok("migration 0018 exists and replaces ensure_workspace", sql.includes("create or replace function public.ensure_workspace()"));
  ok("migration contains role='admin' marker", sql.includes("role='admin'"));
  ok("admin assignment is tied to workspace creation branch", createdBranch > 0 && adminBranch > createdBranch);
  ok("join branch keeps existing/default role", /else 'member'/.test(sql) && /else public\.profiles\.role/.test(sql));
}

console.log(`RESULT fleet-seats-server: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
