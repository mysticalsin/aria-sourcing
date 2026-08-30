/* ============================================================================
   tests/calendar-booking-authority.mts
   Calendar booking authority (closes a NO-GO finding): /api/calendar/event
   created a LIVE Google/Microsoft calendar event with no durable, auditable
   authority record and no claim-before-effect — unlike every other live
   mutation in this app. Four sections:
     1. Migration 0034 source pins (table, double-book partial index, retry
        unique constraint, RPC ACL, FOR UPDATE / unique_violation pattern) —
        mirrors tests/claim-serialization.mts.
     2. src/lib/calendar.ts adapter delivery-state classification (real
        adapters, mocked fetch) — mirrors section 1 of
        tests/email-send-ambiguity.mts.
     3. src/lib/calendar-authority.ts unit tests against a hand-built fake
        service-role client (no module mocking needed: the service client is
        a parameter, not resolved internally).
     4. Route behavior end-to-end (real route, real calendar.ts, real
        calendar-authority.ts, a FAITHFUL in-memory simulation of the two
        ledger RPCs, mocked fetch) — mirrors section 2 of
        tests/email-send-ambiguity.mts. Proves:
          - the claim is recorded BEFORE the provider is ever called;
          - a double-book on the same (candidate, start_time) fails closed
            with zero provider calls;
          - a retry with the same requestId is idempotent (no second
            provider call);
          - a successful create reconciles 'confirmed'; a proven rejection
            reconciles 'failed' (freeing the slot); an unknown post-transport
            outcome is never reconciled (the row stays 'claimed', still
            blocking the slot).
   ========================================================================== */

import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import type { EmailConnection } from "../src/lib/types";

let pass = 0;
let fail = 0;
const realLog = console.log.bind(console);
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    realLog("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const originalFetch = globalThis.fetch;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_ENABLE_DEMO_LOGIN"]) {
  originalEnv[key] = process.env[key];
}

try {
  /* =========================================================================
     1. Migration 0034 source pins.
     ======================================================================= */
  const migration = readFileSync(new URL("../supabase/migrations/0034_calendar_booking_authority.sql", import.meta.url), "utf8");

  ok(
    "migration defines the calendar booking ledger table",
    migration.includes("create table if not exists public.calendar_booking_ledger ("),
  );
  ok(
    "status is constrained to the exact four-value enum",
    migration.includes("check (status in ('claimed', 'confirmed', 'failed', 'released'))"),
  );
  ok(
    "retry idempotency on (workspace_id, request_id) is a real unique constraint",
    migration.includes("constraint calendar_booking_ledger_workspace_request_uniq unique (workspace_id, request_id)"),
  );
  ok(
    "the double-book guard is a partial unique index over the two active statuses",
    migration.includes(
      "create unique index if not exists calendar_booking_ledger_active_slot_uniq\n  on public.calendar_booking_ledger (workspace_id, candidate_id, start_time)\n  where status in ('claimed', 'confirmed');",
    ),
  );
  ok(
    "table RLS is enabled and forced",
    migration.includes("alter table public.calendar_booking_ledger enable row level security;") &&
      migration.includes("alter table public.calendar_booking_ledger force row level security;"),
  );
  ok(
    "every role — including service_role — loses direct table grants; only the RPCs mediate access",
    migration.includes(
      "revoke all on public.calendar_booking_ledger\n  from public, anon, authenticated, service_role, authenticator;",
    ),
  );
  ok(
    "claim_calendar_booking is SECURITY DEFINER with the 0021-style saved search_path",
    migration.includes("create or replace function public.claim_calendar_booking(") &&
      migration.includes("language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$"),
  );
  ok(
    "claim locks and returns an existing request_id row BEFORE ever attempting an insert (idempotent retry, no pre-check TOCTOU)",
    migration.indexOf("where workspace_id = p_workspace_id and request_id = p_request_id\n   for update;") <
      migration.indexOf("insert into public.calendar_booking_ledger ("),
  );
  ok(
    "claim relies on unique_violation + GET STACKED DIAGNOSTICS to distinguish a retry race from a double-book, never a pre-check",
    migration.includes("exception when unique_violation then") &&
      migration.includes("get stacked diagnostics violated_constraint = constraint_name;") &&
      migration.includes("return jsonb_build_object('status', 'double_booked');"),
  );
  ok(
    "a request_id reused for a different candidate/start_time/provider is an idempotency_conflict, never silently treated as a replay",
    (migration.match(/return jsonb_build_object\('status', 'idempotency_conflict'\);/g) ?? []).length === 2 &&
      migration.includes(
        "if existing_row.candidate_id <> p_candidate_id\n       or existing_row.start_time <> p_start_time\n       or existing_row.provider <> p_provider then\n      return jsonb_build_object('status', 'idempotency_conflict');",
      ),
  );
  ok(
    "claim_calendar_booking ACL is service-role only (0021 pattern)",
    migration.includes(
      "revoke all on function public.claim_calendar_booking(uuid, text, timestamptz, text, text)\n  from public, anon, authenticated, service_role, authenticator;\ngrant execute on function public.claim_calendar_booking(uuid, text, timestamptz, text, text)\n  to service_role;",
    ),
  );
  ok(
    "reconcile_calendar_booking only transitions a row that is still 'claimed' (one-shot terminal reconciliation)",
    migration.includes("where id = p_id\n     and workspace_id = p_workspace_id\n     and status = 'claimed'"),
  );
  ok(
    "reconcile_calendar_booking ACL is service-role only",
    migration.includes(
      "revoke all on function public.reconcile_calendar_booking(uuid, uuid, text, text, text)\n  from public, anon, authenticated, service_role, authenticator;\ngrant execute on function public.reconcile_calendar_booking(uuid, uuid, text, text, text)\n  to service_role;",
    ),
  );
  ok(
    "no standalone transaction statements (bootstrap owns the transaction)",
    !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
  );

  /* =========================================================================
     2. src/lib/calendar.ts adapter delivery-state classification.
     ======================================================================= */
  const { createGoogleCalendarEvent, createGraphCalendarEvent } = await import("../src/lib/calendar");

  function connection(over: Partial<EmailConnection> = {}): EmailConnection {
    const provider = over.provider ?? "Gmail API";
    const defaultScope =
      provider === "Microsoft Graph"
        ? "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/OnlineMeetings.ReadWrite offline_access"
        : "calendar.events";
    return {
      id: "conn-1",
      seatId: "seat-1",
      provider,
      accountEmail: "recruiter@example.test",
      accessToken: "access-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scope: defaultScope,
      connectedAt: "",
      updatedAt: "",
      ...over,
      // Keep provider/scope coherent when callers override only provider.
      provider,
      scope: over.scope ?? defaultScope,
    };
  }
  const ev = {
    candidateName: "Candidate One",
    role: "Platform Engineer",
    startTime: "2026-07-10T14:00:00.000Z",
    endTime: "2026-07-10T14:30:00.000Z",
    timezone: "UTC",
    candidateEmail: "candidate@example.test",
    interviewerEmail: "recruiter@example.test",
    agenda: ["Introductions"],
  };
  const throwingFetch = (async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  }) as typeof fetch;
  const fetchWith = (status: number, body: unknown = {}) => (async () => jsonResponse(status, body)) as typeof fetch;

  const noToken = await createGoogleCalendarEvent(ev, connection({ accessToken: "", expiresAt: null, refreshToken: null }));
  ok("Google: missing access token is a proven pre-transport not-sent", noToken.ok === false && noToken.deliveryState === "not-sent");

  globalThis.fetch = throwingFetch;
  const googleThrew = await createGoogleCalendarEvent(ev, connection());
  ok("Google: fetch throw is an unknown/ambiguous outcome", googleThrew.ok === false && googleThrew.deliveryState === "unknown");

  globalThis.fetch = fetchWith(400);
  const googleRejected = await createGoogleCalendarEvent(ev, connection());
  ok("Google: definitive 400 rejection is not-sent (retryable)", googleRejected.ok === false && googleRejected.deliveryState === "not-sent");

  globalThis.fetch = fetchWith(500);
  const googleServerErr = await createGoogleCalendarEvent(ev, connection());
  ok("Google: upstream 500 is an unknown/ambiguous outcome", googleServerErr.ok === false && googleServerErr.deliveryState === "unknown");

  globalThis.fetch = fetchWith(200, { id: "evt-1", htmlLink: "https://calendar.example.test/evt-1" });
  const googleCreated = await createGoogleCalendarEvent(ev, connection());
  ok(
    "Google: acceptance is 'accepted' with the provider's event id and link",
    googleCreated.ok === true &&
      googleCreated.deliveryState === "accepted" &&
      googleCreated.eventId === "evt-1" &&
      googleCreated.link === "https://calendar.example.test/evt-1",
  );

  const graphNoToken = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph", accessToken: "", expiresAt: null, refreshToken: null }));
  ok("Graph: missing access token is a proven pre-transport not-sent", graphNoToken.ok === false && graphNoToken.deliveryState === "not-sent");

  const graphNoCalScope = await createGraphCalendarEvent(
    ev,
    connection({ provider: "Microsoft Graph", scope: "https://graph.microsoft.com/Mail.Send offline_access" }),
  );
  ok(
    "Graph: missing Calendars.ReadWrite is a proven pre-transport not-sent",
    graphNoCalScope.ok === false &&
      graphNoCalScope.deliveryState === "not-sent" &&
      /Calendars\.ReadWrite/.test(graphNoCalScope.detail ?? ""),
  );

  const graphNoTeamsScope = await createGraphCalendarEvent(
    ev,
    connection({
      provider: "Microsoft Graph",
      scope: "https://graph.microsoft.com/Calendars.ReadWrite offline_access",
    }),
  );
  ok(
    "Graph: missing OnlineMeetings.ReadWrite is a proven pre-transport not-sent",
    graphNoTeamsScope.ok === false &&
      graphNoTeamsScope.deliveryState === "not-sent" &&
      /OnlineMeetings\.ReadWrite/.test(graphNoTeamsScope.detail ?? ""),
  );

  globalThis.fetch = throwingFetch;
  const graphThrew = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph" }));
  ok("Graph: fetch throw is an unknown/ambiguous outcome", graphThrew.ok === false && graphThrew.deliveryState === "unknown");

  globalThis.fetch = fetchWith(502);
  const graphServerErr = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph" }));
  ok("Graph: upstream 502 is an unknown/ambiguous outcome", graphServerErr.ok === false && graphServerErr.deliveryState === "unknown");

  const graphEmptyScope = await createGraphCalendarEvent(
    ev,
    connection({ provider: "Microsoft Graph", scope: "" }),
  );
  ok(
    "Graph: empty/missing scope is a proven pre-transport not-sent",
    graphEmptyScope.ok === false &&
      graphEmptyScope.deliveryState === "not-sent" &&
      /Calendars\.ReadWrite/.test(graphEmptyScope.detail ?? ""),
  );

  globalThis.fetch = fetchWith(200, { id: "evt-2", webLink: "https://outlook.office.com/calendar/item/evt-2" });
  const graphWebLinkOnly = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph" }));
  ok(
    "Graph: webLink-only create is not accepted as a Teams booking",
    graphWebLinkOnly.ok === false &&
      graphWebLinkOnly.deliveryState === "not-sent" &&
      /orphan event deleted|safe to retry/i.test(graphWebLinkOnly.detail ?? ""),
  );

  // DELETE of the orphan fails → stay unknown (do not free the ledger slot).
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "DELETE") return jsonResponse(500, { error: "delete-failed" });
    return jsonResponse(200, { id: "evt-orphan", webLink: "https://outlook.office.com/calendar/item/evt-orphan" });
  }) as typeof fetch;
  const graphWebLinkDeleteFail = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph" }));
  ok(
    "Graph: webLink-only with failed orphan delete stays unknown",
    graphWebLinkDeleteFail.ok === false &&
      graphWebLinkDeleteFail.deliveryState === "unknown" &&
      graphWebLinkDeleteFail.eventId === "evt-orphan",
  );

  globalThis.fetch = fetchWith(200, {
    id: "evt-2",
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_e2e" },
  });
  const graphCreated = await createGraphCalendarEvent(ev, connection({ provider: "Microsoft Graph" }));
  ok(
    "Graph: acceptance requires Teams joinUrl",
    graphCreated.ok === true &&
      graphCreated.deliveryState === "accepted" &&
      graphCreated.eventId === "evt-2" &&
      graphCreated.link === "https://teams.microsoft.com/l/meetup-join/19%3ameeting_e2e",
  );

  /* =========================================================================
     3. src/lib/calendar-authority.ts unit tests (fake service client — the
        service client is a parameter, so no module mocking is needed here).
     ======================================================================= */
  mock.module("server-only", { namedExports: {} });
  const { claimCalendarBooking, reconcileCalendarBooking } = await import("../src/lib/calendar-authority");

  let lastRpc: { name: string; args: Record<string, unknown> } | null = null;
  let nextResponse: { data: unknown; error: { message?: string } | null } = { data: null, error: null };
  const fakeService = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      lastRpc = { name, args };
      return nextResponse;
    },
  };

  nextResponse = {
    data: { status: "claimed", id: "booking-1", booking_status: "claimed", external_event_id: null, meeting_url: null, replay: false },
    error: null,
  };
  const freshClaim = await claimCalendarBooking(fakeService, {
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    startTime: "2026-07-10T14:00:00.000Z",
    requestId: "req-1",
    provider: "Gmail API",
  });
  const claimRpc = lastRpc as { name: string; args: Record<string, unknown> } | null;
  ok(
    "claimCalendarBooking calls the exact RPC with the exact argument shape",
    claimRpc !== null &&
      claimRpc.name === "claim_calendar_booking" &&
      JSON.stringify(claimRpc.args) ===
        JSON.stringify({
          p_workspace_id: "workspace-1",
          p_candidate_id: "candidate-1",
          p_start_time: "2026-07-10T14:00:00.000Z",
          p_request_id: "req-1",
          p_provider: "Gmail API",
        }),
  );
  ok(
    "claimCalendarBooking parses a fresh claim",
    freshClaim.status === "claimed" && freshClaim.id === "booking-1" && freshClaim.bookingStatus === "claimed" && freshClaim.replay === false,
  );

  nextResponse = { data: { status: "double_booked" }, error: null };
  ok(
    "claimCalendarBooking passes through double_booked verbatim",
    (await claimCalendarBooking(fakeService, { workspaceId: "w", candidateId: "c", startTime: "t", requestId: "r", provider: "Gmail API" })).status ===
      "double_booked",
  );

  nextResponse = { data: { status: "idempotency_conflict" }, error: null };
  ok(
    "claimCalendarBooking passes through idempotency_conflict verbatim (a reused requestId for a different candidate/time)",
    (await claimCalendarBooking(fakeService, { workspaceId: "w", candidateId: "c", startTime: "t", requestId: "r", provider: "Gmail API" })).status ===
      "idempotency_conflict",
  );

  nextResponse = { data: null, error: { message: "network down" } };
  ok(
    "claimCalendarBooking never throws on transport failure — fails closed as dependency_unavailable",
    (await claimCalendarBooking(fakeService, { workspaceId: "w", candidateId: "c", startTime: "t", requestId: "r", provider: "Gmail API" })).status ===
      "dependency_unavailable",
  );

  nextResponse = { data: { status: "claimed", id: "", booking_status: "claimed", replay: false }, error: null };
  ok(
    "claimCalendarBooking fails closed on a malformed claimed result (empty id)",
    (await claimCalendarBooking(fakeService, { workspaceId: "w", candidateId: "c", startTime: "t", requestId: "r", provider: "Gmail API" })).status ===
      "dependency_unavailable",
  );

  nextResponse = { data: { status: "reconciled", id: "booking-1", booking_status: "confirmed" }, error: null };
  const reconciled = await reconcileCalendarBooking(fakeService, {
    workspaceId: "workspace-1",
    id: "booking-1",
    status: "confirmed",
    externalEventId: "evt-1",
    meetingUrl: "https://teams.example/join/1",
    detail: "Event created.",
  });
  const reconcileRpc = lastRpc as { name: string; args: Record<string, unknown> } | null;
  ok(
    "reconcileCalendarBooking calls the exact RPC with the exact argument shape",
    reconcileRpc !== null &&
      reconcileRpc.name === "reconcile_calendar_booking" &&
      JSON.stringify(reconcileRpc.args) ===
        JSON.stringify({
          p_workspace_id: "workspace-1",
          p_id: "booking-1",
          p_status: "confirmed",
          p_external_event_id: "evt-1",
          p_detail: "Event created.",
          p_meeting_url: "https://teams.example/join/1",
        }),
  );
  ok(
    "reconcileCalendarBooking parses a reconciled result",
    reconciled.status === "reconciled" && reconciled.id === "booking-1" && reconciled.bookingStatus === "confirmed",
  );

  nextResponse = { data: { status: "not_found" }, error: null };
  ok(
    "reconcileCalendarBooking passes through not_found verbatim",
    (await reconcileCalendarBooking(fakeService, { workspaceId: "w", id: "missing", status: "failed" })).status === "not_found",
  );

  nextResponse = { data: null, error: { message: "network down" } };
  ok(
    "reconcileCalendarBooking never throws on transport failure — fails closed as dependency_unavailable",
    (await reconcileCalendarBooking(fakeService, { workspaceId: "w", id: "booking-1", status: "failed" })).status === "dependency_unavailable",
  );

  /* =========================================================================
     4. Route behavior end-to-end. Real route, real calendar.ts, real
        calendar-authority.ts. Only the Supabase clients + demo-side-effects
        switch are injected; the ledger RPCs are a faithful in-memory
        simulation of the migration's SQL semantics (double-book partial
        index + request_id idempotency + one-shot reconciliation).
     ======================================================================= */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  // Keeps encryptionRequiredButMissing() false so the (unexercised here)
  // refreshed-token persist path never blocks a response.
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true";

  type BookingRow = {
    id: string;
    workspaceId: string;
    candidateId: string;
    startTime: string;
    requestId: string;
    provider: string;
    status: "claimed" | "confirmed" | "failed" | "released";
    externalEventId: string | null;
    meetingUrl: string | null;
    detail: string | null;
  };

  function createFakeLedger(events: string[]) {
    const rows = new Map<string, BookingRow>();
    let counter = 0;
    const byRequestId = (workspaceId: string, requestId: string) =>
      [...rows.values()].find((row) => row.workspaceId === workspaceId && row.requestId === requestId) ?? null;
    const activeSlot = (workspaceId: string, candidateId: string, startTime: string) =>
      [...rows.values()].find(
        (row) =>
          row.workspaceId === workspaceId &&
          row.candidateId === candidateId &&
          row.startTime === startTime &&
          (row.status === "claimed" || row.status === "confirmed"),
      ) ?? null;
    return {
      rows,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_calendar_booking") {
          events.push("claim");
          const workspaceId = String(args.p_workspace_id);
          const candidateId = String(args.p_candidate_id);
          const startTime = String(args.p_start_time);
          const requestId = String(args.p_request_id);
          const provider = String(args.p_provider);
          const existing = byRequestId(workspaceId, requestId);
          if (existing) {
            if (existing.candidateId !== candidateId || existing.startTime !== startTime || existing.provider !== provider) {
              return { data: { status: "idempotency_conflict" }, error: null };
            }
            return {
              data: {
                status: "claimed",
                id: existing.id,
                booking_status: existing.status,
                external_event_id: existing.externalEventId,
                meeting_url: existing.meetingUrl,
                replay: true,
              },
              error: null,
            };
          }
          if (activeSlot(workspaceId, candidateId, startTime)) {
            return { data: { status: "double_booked" }, error: null };
          }
          counter += 1;
          const id = `booking-${counter}`;
          rows.set(id, {
            id,
            workspaceId,
            candidateId,
            startTime,
            requestId,
            provider,
            status: "claimed",
            externalEventId: null,
            meetingUrl: null,
            detail: null,
          });
          return {
            data: {
              status: "claimed",
              id,
              booking_status: "claimed",
              external_event_id: null,
              meeting_url: null,
              replay: false,
            },
            error: null,
          };
        }
        if (name === "reconcile_calendar_booking") {
          const id = String(args.p_id);
          const row = rows.get(id);
          if (!row || row.status !== "claimed") return { data: { status: "not_found" }, error: null };
          row.status = args.p_status as BookingRow["status"];
          if (typeof args.p_external_event_id === "string") row.externalEventId = args.p_external_event_id;
          if (typeof args.p_meeting_url === "string") row.meetingUrl = args.p_meeting_url;
          row.detail = typeof args.p_detail === "string" ? args.p_detail : null;
          events.push(`reconcile:${row.status}`);
          return {
            data: {
              status: "reconciled",
              id: row.id,
              booking_status: row.status,
              meeting_url: row.meetingUrl,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
  }

  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const seatId = "22222222-2222-4222-8222-222222222222";

  function chainQuery(result: unknown) {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.maybeSingle = async () => ({ data: result, error: null });
    q.single = async () => ({ data: result, error: null });
    return q;
  }

  const events: string[] = [];
  const ledger = createFakeLedger(events);

  const userSupabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: async (name: string) => {
      if (name === "current_profile_role") return { data: "admin", error: null };
      if (name === "current_workspace_id") return { data: workspaceId, error: null };
      return { data: null, error: null };
    },
    from: (table: string) =>
      table === "agent_seats"
        ? chainQuery({ id: seatId, provider: "Gmail API", status: "active", mode: "live" })
        : chainQuery(null),
  };
  const serviceSupabase = {
    rpc: ledger.rpc,
    from: (table: string) =>
      table === "email_connections"
        ? chainQuery({
            id: "conn-1",
            access_token: "access-token",
            refresh_token: null,
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            scope: "calendar.events",
            account_email: "recruiter@example.test",
            workspace_id: workspaceId,
          })
        : chainQuery(null),
  };

  const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
  mock.module(moduleUrl("src/lib/supabase/server.ts"), {
    namedExports: {
      getServerSupabase: async () => userSupabase,
      getServiceSupabase: () => serviceSupabase,
    },
  });
  mock.module(moduleUrl("src/lib/server/demo-side-effects.ts"), {
    namedExports: {
      PUBLIC_DEMO_DRY_RUN_DETAIL: "Public demo: provider effects disabled.",
      publicDemoSideEffectsDisabled: () => false,
    },
  });

  const routeModule = await import("../src/app/api/calendar/event/route");
  const routePost = ((routeModule as { POST?: unknown }).POST) as (req: NextRequest) => Promise<Response>;

  function payload(over: Record<string, unknown> = {}) {
    return {
      seatId,
      candidateId: "candidate-1",
      candidateName: "Candidate One",
      candidateEmail: "candidate@example.test",
      role: "Platform Engineer",
      startTime: "2026-07-10T14:00:00.000Z",
      endTime: "2026-07-10T14:30:00.000Z",
      timezone: "UTC",
      interviewerEmail: "recruiter@example.test",
      agenda: ["Introductions"],
      confirmLive: true,
      ...over,
    };
  }
  const post = (body: Record<string, unknown>) =>
    routePost(
      new NextRequest("http://localhost/api/calendar/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const rowFor = (requestId: string) => [...ledger.rows.values()].find((row) => row.requestId === requestId);

  // (a) A fresh booking claims BEFORE the provider is ever called, and a
  // successful create reconciles the ledger row to 'confirmed'.
  let providerFetches = 0;
  events.length = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    events.push("provider-fetch");
    return jsonResponse(200, { id: "evt-1", htmlLink: "https://calendar.example.test/evt-1" });
  }) as typeof fetch;
  const slotA = "2026-07-10T14:00:00.000Z";
  const freshRes = await post(payload({ startTime: slotA, requestId: "req-a" }));
  const freshBody = (await freshRes.json()) as { status?: string; eventId?: string };
  ok("a fresh booking succeeds and returns the provider's event id", freshRes.status === 200 && freshBody.status === "created" && freshBody.eventId === "evt-1");
  ok("the provider was called exactly once", providerFetches === 1);
  ok(
    "the claim was recorded BEFORE the provider was ever called",
    events.indexOf("claim") >= 0 && events.indexOf("claim") < events.indexOf("provider-fetch"),
  );
  ok("a successful create reconciles the ledger row to confirmed", events.includes("reconcile:confirmed"));
  ok("the confirmed ledger row carries the provider's event id", rowFor("req-a")?.status === "confirmed" && rowFor("req-a")?.externalEventId === "evt-1");

  // (b) Double-book: a NEW requestId for the SAME candidate + start_time (now
  // 'confirmed', still an active slot) fails closed with zero provider calls.
  const rowsBeforeDoubleBook = ledger.rows.size;
  providerFetches = 0;
  const doubleBookRes = await post(payload({ startTime: slotA, requestId: "req-a-dup" }));
  ok("double-booking the same candidate + start_time fails closed with 409", doubleBookRes.status === 409);
  ok("double-booking performs zero provider calls", providerFetches === 0);
  ok("double-booking creates no new ledger row", ledger.rows.size === rowsBeforeDoubleBook);

  // (c) Retry idempotency: the SAME requestId never calls the provider twice.
  const slotB = "2026-07-11T14:00:00.000Z";
  providerFetches = 0;
  const firstRes = await post(payload({ startTime: slotB, requestId: "req-b" }));
  ok("the first attempt for a new slot succeeds", (await firstRes.json()).status === "created" && providerFetches === 1);
  const retryRes = await post(payload({ startTime: slotB, requestId: "req-b" }));
  const retryBody = (await retryRes.json()) as { status?: string; eventId?: string };
  ok("a retry with the same requestId never calls the provider a second time", providerFetches === 1);
  ok(
    "a retry with the same requestId returns the previously confirmed outcome",
    retryRes.status === 200 && retryBody.status === "created" && retryBody.eventId === "evt-1",
  );

  // (c2) Reusing "req-b" for a DIFFERENT candidate/time is not a valid retry —
  // it is an idempotency conflict, and it must never call the provider.
  providerFetches = 0;
  const conflictRes = await post(payload({ candidateId: "candidate-other", startTime: "2026-07-11T15:00:00.000Z", requestId: "req-b" }));
  ok("reusing a requestId for a different candidate/time fails closed instead of being treated as a replay", conflictRes.status === 409);
  ok("an idempotency conflict performs zero provider calls", providerFetches === 0);

  // (d) Proven rejection reconciles 'failed' and frees the slot for a new request.
  const slotC = "2026-07-12T14:00:00.000Z";
  providerFetches = 0;
  events.length = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    return jsonResponse(400, {});
  }) as typeof fetch;
  const rejectedRes = await post(payload({ startTime: slotC, requestId: "req-c" }));
  const rejectedBody = (await rejectedRes.json()) as { status?: string };
  ok("a definitive provider rejection stays a retryable skipped", rejectedRes.status === 200 && rejectedBody.status === "skipped");
  ok("a definitive rejection reconciles the ledger row to failed", events.includes("reconcile:failed"));
  ok("the failed ledger row frees the slot", rowFor("req-c")?.status === "failed");
  providerFetches = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    return jsonResponse(200, { id: "evt-3", htmlLink: "https://calendar.example.test/evt-3" });
  }) as typeof fetch;
  const afterFailureRes = await post(payload({ startTime: slotC, requestId: "req-c-2" }));
  ok("a failed booking frees the slot for a brand-new request", (await afterFailureRes.json()).status === "created" && providerFetches === 1);

  // (e) Unknown/ambiguous outcome is NEVER reconciled: the row stays 'claimed'
  // and keeps blocking the slot until a human resolves it.
  const slotD = "2026-07-13T14:00:00.000Z";
  providerFetches = 0;
  events.length = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    return jsonResponse(500, {});
  }) as typeof fetch;
  const ambiguousRes = await post(payload({ startTime: slotD, requestId: "req-d" }));
  const ambiguousBody = (await ambiguousRes.json()) as { status?: string; delivery?: string };
  ok(
    "an unknown post-transport outcome returns 502 reconciliation-required",
    ambiguousRes.status === 502 && ambiguousBody.status === "reconciliation-required" && ambiguousBody.delivery === "calendar-reconciliation-required",
  );
  ok("an unknown outcome is never reconciled", !events.some((event) => event.startsWith("reconcile:")));
  ok("the ledger row stays 'claimed' pending human reconciliation", rowFor("req-d")?.status === "claimed");
  const blockedRes = await post(payload({ startTime: slotD, requestId: "req-d-new" }));
  ok("an unreconciled ambiguous claim keeps blocking a NEW booking for the same slot", blockedRes.status === 409);
  providerFetches = 0;
  const sameRetryDuringAmbiguity = await post(payload({ startTime: slotD, requestId: "req-d" }));
  const sameRetryBody = (await sameRetryDuringAmbiguity.json()) as { status?: string };
  ok(
    "a retry with the same requestId while still ambiguous never calls the provider again",
    providerFetches === 0 && sameRetryDuringAmbiguity.status === 502 && sameRetryBody.status === "reconciliation-required",
  );

  // (f) A network throw is likewise never reconciled (fails closed the same way).
  const slotE = "2026-07-14T14:00:00.000Z";
  providerFetches = 0;
  events.length = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    throw new Error("connection reset");
  }) as typeof fetch;
  const throwRes = await post(payload({ startTime: slotE, requestId: "req-e" }));
  const throwBody = (await throwRes.json()) as { status?: string };
  ok("a transport throw returns 502 reconciliation-required", throwRes.status === 502 && throwBody.status === "reconciliation-required");
  ok("a transport throw is never reconciled", !events.some((event) => event.startsWith("reconcile:")));
  ok("the ledger row stays 'claimed' after a transport throw", rowFor("req-e")?.status === "claimed");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`RESULT calendar-booking-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
