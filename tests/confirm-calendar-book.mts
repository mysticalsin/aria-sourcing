/* ============================================================================
   tests/confirm-calendar-book.mts
   Behavioral pins for /api/cron/confirm-calendar-book — loop-side live Teams
   book must mirror /api/calendar/event claim/replay/reconcile honesty:
     - claimed replay → 502, never call Graph
     - confirmed replay without Teams join URL → 502
     - confirmed replay with Teams URL → created (no Graph)
     - deliveryState not-sent → reconcile failed + skipped
     - unknown outcome → 502 without failed reconcile
   ========================================================================== */

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const CRON_SECRET = "cron-secret-material-with-enough-length-0001";
const WORKSPACE_ID = "61111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "camp-confirm-1";
const CANDIDATE_ID = "cand-confirm-1";
const SEAT_ID = "71111111-1111-4111-8111-111111111111";
const TEAMS_URL = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_confirm_live";

process.env.CRON_SECRET = CRON_SECRET;

type ClaimResult = {
  status: "claimed" | "double_booked" | "dependency_unavailable" | "idempotency_conflict";
  id?: string;
  replay?: boolean;
  bookingStatus?: "claimed" | "confirmed" | "failed" | "released";
  meetingUrl?: string | null;
  externalEventId?: string | null;
};

let claimResult: ClaimResult = { status: "claimed", id: "claim-1", replay: false };
let graphCalls = 0;
let reconcileCalls: Array<{ status: string }> = [];
let graphOutcome: {
  ok: boolean;
  deliveryState?: "sent" | "not-sent" | "unknown";
  link?: string | null;
  eventId?: string | null;
  detail?: string;
} = {
  ok: true,
  deliveryState: "sent",
  link: TEAMS_URL,
  eventId: "evt-1",
  detail: "ok",
};

const src = readFileSync("src/app/api/cron/confirm-calendar-book/route.ts", "utf8");
assert.match(src, /claim\.replay/);
assert.match(src, /bookingStatus === "claimed"/);
assert.match(src, /deliveryState === "not-sent"/);
assert.match(src, /isTeamsMeetingJoinUrl\(claim\.meetingUrl\)/);
assert.match(src, /OnlineMeetings\.ReadWrite/);
assert.match(src, /interviewerEmail/);
assert.match(src, /connection\.accountEmail/);

mock.module(moduleUrl("src/lib/calendar-authority.ts"), {
  namedExports: {
    claimCalendarBooking: async () => claimResult,
    reconcileCalendarBooking: async (
      _svc: unknown,
      args: { status: string },
    ) => {
      reconcileCalls.push({ status: args.status });
      return { status: "reconciled", bookingStatus: args.status };
    },
  },
});

mock.module(moduleUrl("src/lib/calendar.ts"), {
  namedExports: {
    isTeamsMeetingJoinUrl: (url: string) =>
      typeof url === "string" && /teams\.microsoft\.com\/l\/meetup-join\//i.test(url),
    createGraphCalendarEvent: async () => {
      graphCalls += 1;
      return graphOutcome;
    },
  },
});

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => ({
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === "get_sourcing_loop_controls") {
          return {
            data: [{ kill_switch: false, sequences_enabled: true }],
            error: null,
          };
        }
        if (name === "read_workspace_campaign_for_loop") {
          return {
            data: {
              status: "ok",
              campaign: {
                id: CAMPAIGN_ID,
                title: "Senior Engineer",
                jobAnalysis: { title: "Senior Engineer" },
              },
            },
            error: null,
          };
        }
        if (name === "read_workspace_candidates_for_loop") {
          return {
            data: {
              status: "ok",
              candidates: [
                {
                  id: CANDIDATE_ID,
                  name: "Ada Lovelace",
                  email: "ada@example.test",
                  campaignId: CAMPAIGN_ID,
                },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: { message: `unexpected ${name}:${JSON.stringify(args ?? {})}` } };
      },
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = self;
        chain.eq = self;
        chain.in = self;
        chain.limit = self;
        chain.update = self;
        chain.maybeSingle = async () => {
          if (table === "email_connections") {
            return {
              data: {
                id: "conn-1",
                access_token: "access-token",
                refresh_token: "refresh-token",
                expires_at: new Date(Date.now() + 3600_000).toISOString(),
                scope: "Calendars.ReadWrite OnlineMeetings.ReadWrite Mail.Send offline_access",
                account_email: "recruiter@mantu.com",
                workspace_id: WORKSPACE_ID,
              },
              error: null,
            };
          }
          if (table === "sourcing_loop_controls") {
            return {
              data: { kill_switch: false, sequences_enabled: true },
              error: null,
            };
          }
          if (table === "profiles") {
            return {
              data: { id: "profile-autopilot-1" },
              error: null,
            };
          }
          return { data: null, error: null };
        };
        // seats list path uses awaiting then .find on array
        const thenable = {
          then(resolve: (v: unknown) => void) {
            if (table === "agent_seats") {
              resolve({
                data: [
                  {
                    id: SEAT_ID,
                    provider: "Microsoft Graph",
                    mode: "live",
                    status: "active",
                    connected_account: "recruiter@mantu.com",
                  },
                ],
                error: null,
              });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        Object.assign(chain, thenable);
        return chain;
      },
    }),
  },
});

const { POST } = await import("../src/app/api/cron/confirm-calendar-book/route.ts");

function post(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/cron/confirm-calendar-book", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        campaignId: CAMPAIGN_ID,
        candidateId: CANDIDATE_ID,
        startTime: "2026-08-29T10:00:00.000Z",
        endTime: "2026-08-29T10:30:00.000Z",
        ...body,
      }),
    }),
  );
}

test("confirm-calendar-book refuses cookie/origin and missing bearer", async () => {
  const noAuth = await POST(
    new NextRequest("http://localhost/api/cron/confirm-calendar-book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        campaignId: CAMPAIGN_ID,
        candidateId: CANDIDATE_ID,
      }),
    }),
  );
  assert.equal(noAuth.status, 401);

  const withCookie = await post({}, { cookie: "session=1" });
  assert.equal(withCookie.status, 401);
});

test("claimed replay returns 502 without calling Graph", async () => {
  graphCalls = 0;
  reconcileCalls = [];
  claimResult = {
    status: "claimed",
    id: "claim-claimed",
    replay: true,
    bookingStatus: "claimed",
  };
  const res = await post();
  const body = (await res.json()) as { ok?: boolean; status?: string };
  assert.equal(res.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.status, "reconciliation_required");
  assert.equal(graphCalls, 0);
  assert.equal(reconcileCalls.length, 0);
});

test("confirmed replay without Teams URL returns 502 without Graph", async () => {
  graphCalls = 0;
  claimResult = {
    status: "claimed",
    id: "claim-bad-url",
    replay: true,
    bookingStatus: "confirmed",
    meetingUrl: "https://outlook.office365.com/calendar/view",
    externalEventId: "evt-orphan",
  };
  const res = await post();
  const body = (await res.json()) as { ok?: boolean; status?: string };
  assert.equal(res.status, 502);
  assert.equal(body.status, "reconciliation_required");
  assert.equal(graphCalls, 0);
});

test("confirmed replay with Teams URL returns created without Graph", async () => {
  graphCalls = 0;
  claimResult = {
    status: "claimed",
    id: "claim-ok",
    replay: true,
    bookingStatus: "confirmed",
    meetingUrl: TEAMS_URL,
    externalEventId: "evt-ok",
  };
  const res = await post();
  const body = (await res.json()) as {
    ok?: boolean;
    status?: string;
    teamsLink?: string;
    replay?: boolean;
    interviewerEmail?: string;
    interviewer?: string;
  };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "created");
  assert.equal(body.teamsLink, TEAMS_URL);
  assert.equal(body.replay, true);
  assert.equal(body.interviewerEmail, "recruiter@mantu.com");
  assert.equal(body.interviewer, "recruiter@mantu.com");
  assert.equal(graphCalls, 0);
});

test("fresh confirm created returns interviewerEmail from Graph mailbox", async () => {
  graphCalls = 0;
  reconcileCalls = [];
  claimResult = { status: "claimed", id: "claim-fresh-ok", replay: false };
  graphOutcome = {
    ok: true,
    deliveryState: "sent",
    link: TEAMS_URL,
    eventId: "evt-fresh",
    detail: "ok",
  };
  const res = await post();
  const body = (await res.json()) as {
    ok?: boolean;
    status?: string;
    interviewerEmail?: string;
    eventId?: string | null;
    replay?: boolean;
  };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "created");
  assert.equal(body.interviewerEmail, "recruiter@mantu.com");
  assert.equal(body.eventId, "evt-fresh");
  assert.equal(body.replay, false);
  assert.equal(graphCalls, 1);
  assert.deepEqual(reconcileCalls, [{ status: "confirmed" }]);
});

test("not-sent Graph outcome reconciles failed and returns skipped", async () => {
  graphCalls = 0;
  reconcileCalls = [];
  claimResult = { status: "claimed", id: "claim-fresh", replay: false };
  graphOutcome = {
    ok: false,
    deliveryState: "not-sent",
    detail: "scope missing",
    link: null,
    eventId: null,
  };
  const res = await post();
  const body = (await res.json()) as { ok?: boolean; status?: string };
  assert.equal(res.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, "skipped");
  assert.equal(graphCalls, 1);
  assert.deepEqual(reconcileCalls, [{ status: "failed" }]);
});

test("unknown Graph outcome stays claimed (502, no failed reconcile)", async () => {
  graphCalls = 0;
  reconcileCalls = [];
  claimResult = { status: "claimed", id: "claim-unknown", replay: false };
  graphOutcome = {
    ok: false,
    deliveryState: "unknown",
    detail: "timeout after accept",
    link: null,
    eventId: "evt-maybe",
  };
  const res = await post();
  const body = (await res.json()) as { ok?: boolean; status?: string };
  assert.equal(res.status, 502);
  assert.equal(body.status, "reconciliation_required");
  assert.equal(graphCalls, 1);
  assert.equal(reconcileCalls.length, 0);
});
