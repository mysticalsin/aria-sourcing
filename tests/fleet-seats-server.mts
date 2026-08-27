import { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AgentSeatRow } from "../src/lib/fleet-seats";
import { createProcessEnvScope } from "./helpers/process-env.mts";

const envScope = createProcessEnvScope(["NODE_ENV"]);
envScope.set({ NODE_ENV: "test" });

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

mock.module("server-only", { namedExports: {} });

const workspaceId = "11111111-1111-4111-8111-111111111111";
const serverSeatId = "22222222-2222-4222-8222-222222222222";
let role: "admin" | "member" = "admin";
let insertedRows: Record<string, unknown>[] = [];
let serviceReady = false;
let serviceSeatProvider = "Microsoft Graph";

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
      let updating = false;
      const query: any = {
        insert: (row: Record<string, unknown>) => {
          pendingInsert = row;
          insertedRows.push(row);
          return query;
        },
        update: (row: Record<string, unknown>) => {
          updating = true;
          pendingInsert = {
            provider: serviceSeatProvider,
            mode: row.mode ?? "mock",
            operator_email: row.operator_email ?? "agent@example.test",
            workspace_id: workspaceId,
            name: "Agent One",
          };
          return query;
        },
        delete: () => query,
        eq: () => query,
        select: () => query,
        single: async () => ({ data: pendingInsert ? seatRow(pendingInsert) : null, error: null }),
        maybeSingle: async () => {
          if (pendingInsert) return { data: seatRow(pendingInsert), error: null };
          // PATCH live-gate reads the existing seat before update.
          return {
            data: seatRow({
              provider: serviceSeatProvider,
              mode: updating ? "live" : "mock",
              workspace_id: workspaceId,
            }),
            error: null,
          };
        },
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

function makeServiceSupabase() {
  return {
    from: (table: string) => {
      const state: Record<string, string> = {};
      const query: any = {
        select: () => query,
        eq: (col: string, val: string) => {
          state[col] = val;
          return query;
        },
        update: () => query,
        maybeSingle: async () => {
          if (table === "agent_seats") {
            return {
              data: {
                id: serverSeatId,
                provider: serviceSeatProvider,
                workspace_id: workspaceId,
              },
              error: null,
            };
          }
          if (table === "email_connections") {
            if (!serviceReady) return { data: null, error: null };
            return {
              data: {
                id: "33333333-3333-4333-8333-333333333333",
                account_email: "recruiter@mantu.com",
                refresh_token: "enc",
              },
              error: null,
            };
          }
          if (table === "graph_mail_subscriptions") {
            if (!serviceReady) return { data: null, error: null };
            return { data: { id: "sub-1", status: "active" }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === "inbound_mailbox_routes") {
            resolve({
              data: serviceReady
                ? [
                    {
                      id: "route-1",
                      connection_id: "33333333-3333-4333-8333-333333333333",
                      mailbox_address: "recruiter@mantu.com",
                      active: true,
                    },
                  ]
                : [],
              error: null,
            });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
}

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => makeFakeSupabase(),
    getServiceSupabase: () => makeServiceSupabase(),
    requireAdmin: async () => ({ ok: true, role: "admin" }),
  },
});

const { NextRequest } = await import("next/server");
const route = await import("../src/app/api/fleet/seats/route.ts");

function req(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/fleet/seats", {
    method,
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
  role = "admin";
  insertedRows = [];
  const res = await route.POST(req({
    name: "Live Graph Agent",
    operatorEmail: "live@example.test",
    provider: "Microsoft Graph",
    mode: "live",
  }));
  const json = await res.json();
  ok(
    "POST refuses Microsoft Graph seat created already-live",
    res.status === 409 && json.ok === false && insertedRows.length === 0,
  );
}

{
  role = "admin";
  serviceReady = false;
  serviceSeatProvider = "Microsoft Graph";
  // Fake update path: makeFakeSupabase update/maybeSingle returns pendingInsert seat (null) —
  // extend fake so PATCH can load existing seat then update.
  const res = await route.PATCH(req({ id: serverSeatId, mode: "live" }, "PATCH"));
  const json = await res.json();
  ok(
    "PATCH mode=live without Graph webhook returns 409",
    res.status === 409 && json.ok === false && /webhook|Connect Outlook|inbound/i.test(String(json.error ?? "")),
  );
}

{
  role = "admin";
  serviceReady = true;
  serviceSeatProvider = "Microsoft Graph";
  const res = await route.PATCH(req({ id: serverSeatId, mode: "live" }, "PATCH"));
  const json = await res.json();
  ok(
    "PATCH mode=live allowed when inbound route + Graph sub active",
    res.status === 200 && json.ok === true,
  );
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
  const databaseTest = readFileSync("tests/db/ensure-workspace-authority.sql", "utf8");
  const databaseHarness = readFileSync("scripts/test-db-privileges.sh", "utf8");
  const createdBranch = sql.indexOf("workspace_was_created := true");
  const adminBranch = sql.indexOf("case when workspace_was_created then 'admin'");
  ok("migration 0018 exists and replaces ensure_workspace", sql.includes("create or replace function public.ensure_workspace()"));
  ok("migration contains role='admin' marker", sql.includes("role='admin'"));
  ok("admin assignment is tied to workspace creation branch", createdBranch > 0 && adminBranch > createdBranch);
  ok("join branch keeps existing/default role", /else 'member'/.test(sql) && /else public\.profiles\.role/.test(sql));
  for (const marker of [
    "anonymous ensure_workspace call is denied",
    "first authenticated user creates an exact-domain workspace as admin",
    "second same-domain user joins the existing workspace as member",
    "repeat ensure_workspace calls never elevate an existing member profile",
    "pre-existing member profile remains a member after ensure_workspace",
    "cross-domain users receive distinct exact-domain workspaces",
  ]) {
    ok(`real ensure_workspace database test covers ${marker}`, databaseTest.includes(marker));
  }
  ok(
    "real ensure_workspace database test changes effective roles and JWT claims",
    /set local role anon/i.test(databaseTest) &&
      /set local role authenticated/i.test(databaseTest) &&
      /request\.jwt\.claims/i.test(databaseTest),
  );
  ok(
    "disposable database harness runs ensure_workspace behavior verification",
    /tests\/db\/ensure-workspace-authority\.sql/.test(databaseHarness),
  );
}

envScope.restore();
console.log(`RESULT fleet-seats-server: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
