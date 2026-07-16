import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import { isPublicDemoSideEffectBlocked } from "../src/lib/demo-side-effect-policy";
import { approvalHash, approvalScopeHash } from "../src/lib/outreach-content";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function guardBetween(path: string, trustedMarker: string, irreversibleMarker: string) {
  const code = source(path);
  const trusted = code.indexOf(trustedMarker);
  const guard = code.indexOf("publicDemoSideEffectsDisabled()", trusted + trustedMarker.length);
  const irreversible = code.indexOf(irreversibleMarker, trusted + trustedMarker.length);
  return trusted >= 0 && guard > trusted && irreversible > guard;
}

ok(
  "public demo mode disables external side effects",
  isPublicDemoSideEffectBlocked({ NEXT_PUBLIC_ENABLE_DEMO_LOGIN: "true" }),
);
ok(
  "normal tenant mode preserves external side effects",
  !isPublicDemoSideEffectBlocked({ NEXT_PUBLIC_ENABLE_DEMO_LOGIN: "false" }),
);
ok("an unset demo flag preserves normal tenant behavior", !isPublicDemoSideEffectBlocked({}));

const serverBoundary = source("src/lib/server/demo-side-effects.ts");
ok("the runtime helper has a Next-enforced server-only boundary", /from "next\/headers"/.test(serverBoundary));
ok(
  "email send checks the live owned seat before the demo decision and checks the decision before DNS or claims",
  guardBetween("src/app/api/outreach/send/route.ts", 'if (seat.mode !== "live")', "domainVerified("),
);
ok(
  "WhatsApp send checks the live owned seat before the demo decision and checks the decision before queueing",
  guardBetween("src/app/api/outreach/send/route.ts", 'phoneSeat.provider !== "WhatsApp Cloud"', '.from("messages_outbound")'),
);
ok(
  "approval validates recipient scope before the demo decision",
  guardBetween("src/app/api/outreach/approve/route.ts", "approvalScopeHash(", 'rpc("record_outreach_approval"'),
);
ok(
  "revocation validates the authenticated request before the demo decision",
  guardBetween("src/app/api/outreach/revoke/route.ts", "validateBody(req, RevokeSchema)", 'rpc("revoke_outreach_approval"'),
);
ok(
  "calendar verifies a live owned provider seat before reading mailbox credentials",
  guardBetween("src/app/api/calendar/event/route.ts", 'seat.provider !== "Gmail API"', "getServiceSupabase()"),
);
ok(
  "WhatsApp template queue validates trusted template scope before approval persistence",
  guardBetween("src/app/api/outreach/whatsapp-template/route.ts", "approvalScopeHash(", 'rpc("record_outreach_approval"'),
);
ok(
  "WhatsApp review validates the stored draft before queue mutation",
  guardBetween("src/app/api/outreach/whatsapp-review/route.ts", "gateOutbound(current.body)", 'rpc("review_whatsapp_outbound"'),
);
ok(
  "mailbox disconnect verifies the RLS-owned seat before credential access",
  guardBetween("src/app/api/email/disconnect/route.ts", '.from("agent_seats")', "oauth2.googleapis.com/revoke"),
);
ok(
  "mailbox sync authenticates and resolves workspace before credential access",
  guardBetween("src/app/api/email/sync/route.ts", 'rpc("current_workspace_id")', "getAccessTokenForReading("),
);
ok(
  "dispatcher retains a final no-wire backstop",
  guardBetween("src/lib/dispatch-outbound.ts", "const stats:", "sendWhatsApp("),
);
ok(
  "Google mailbox connect validates seat_id after admin auth and before provider redirect",
  guardBetween("src/app/auth/google/route.ts", "if (!seatId)", "accounts.google.com/o/oauth2"),
);
ok(
  "Microsoft mailbox connect validates seat_id after admin auth and before provider redirect",
  guardBetween("src/app/auth/microsoft/route.ts", "if (!seatId)", "login.microsoftonline.com/common/oauth2"),
);

const storeSource = source("src/lib/store.ts");
const dryRunBranch = storeSource.indexOf("if (persisted.dryRun)");
const liveApprovalCommit = storeSource.indexOf("commit((prev)", dryRunBranch);
const dryRunReturn = storeSource.indexOf("dryRun: true", dryRunBranch);
ok(
  "a simulated approval returns before the live approval commit",
  dryRunBranch >= 0 && dryRunReturn > dryRunBranch && liveApprovalCommit > dryRunReturn,
);

for (const path of [
  "src/app/api/outreach/whatsapp-template/route.ts",
  "src/app/api/outreach/whatsapp-review/route.ts",
]) {
  const code = source(path);
  const getBody = code.slice(code.indexOf("export async function GET"), code.indexOf("export async function POST"));
  ok(`${path} keeps authenticated read-only data visible`, !getBody.includes("publicDemoSideEffectsDisabled()"));
}

// Behavioral route proof. The public-demo decision is injected while the rest
// of the handler runs against a valid authenticated workspace, matching the
// production route contract without contacting any real provider.
process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

let blockExternalEffects = true;
let providerCalls = 0;
let serverClientReads = 0;
let serviceClientReads = 0;
let durableMutations = 0;
let authenticatedUser: { id: string } | null = { id: "user-1" };
let adminAllowed = true;
let currentSupabase: any;
let currentService: any = null;

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

// src/lib/calendar-authority.ts (imported transitively by the calendar route
// below) is server-only.
mock.module("server-only", { namedExports: {} });

mock.module(moduleUrl("src/lib/server/demo-side-effects.ts"), {
  namedExports: {
    PUBLIC_DEMO_DRY_RUN_DETAIL: "Public demo: provider effects disabled.",
    publicDemoSideEffectsDisabled: () => blockExternalEffects,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      serverClientReads += 1;
      return currentSupabase;
    },
    getServiceSupabase: () => {
      serviceClientReads += 1;
      return currentService;
    },
    requireAdmin: async () => adminAllowed
      ? { ok: true, role: "admin" }
      : { ok: false, response: new Response(JSON.stringify({ ok: false, error: "Admins only." }), { status: 403 }) },
  },
});
mock.module(moduleUrl("src/lib/providers.ts"), {
  namedExports: { sendViaProvider: async () => { providerCalls += 1; return { status: "sent", detail: "sent" }; } },
});
mock.module(moduleUrl("src/lib/email-oauth.ts"), {
  namedExports: {
    sendViaGmailApi: async () => { providerCalls += 1; return { status: "sent", detail: "sent" }; },
    sendViaMicrosoftGraph: async () => { providerCalls += 1; return { status: "sent", detail: "sent" }; },
  },
});
mock.module(moduleUrl("src/lib/domain-verification.ts"), {
  namedExports: { domainVerified: async () => { providerCalls += 1; return true; } },
});
mock.module(moduleUrl("src/lib/dispatch-outbound.ts"), {
  namedExports: { dispatchDue: async () => { providerCalls += 1; return { processed: 1, sent: 1, blocked: 0, failed: 0 }; } },
});
mock.module(moduleUrl("src/lib/calendar.ts"), {
  namedExports: {
    createGoogleCalendarEvent: async () => { providerCalls += 1; return { ok: true, eventId: "evt-1", link: "https://calendar.example.test/evt-1" }; },
    createGraphCalendarEvent: async () => { providerCalls += 1; return { ok: true, eventId: "evt-1", link: "https://calendar.example.test/evt-1" }; },
  },
});

const workspaceId = "11111111-1111-4111-8111-111111111111";
const seatId = "22222222-2222-4222-8222-222222222222";
const sendPayload = {
  seatId,
  messageId: "message-1",
  candidateId: "candidate-1",
  candidateEmail: "candidate@example.test",
  campaignId: "campaign-1",
  subject: "A role you may like",
  body: "Hello, I saw your recent platform work and thought this role could be relevant. Open to a short conversation?",
  channel: "Email",
  confirmLive: true,
};
const approvedBodyHash = approvalHash(sendPayload.subject, sendPayload.body);
const approvedScopeHash = approvalScopeHash({
  candidateId: sendPayload.candidateId,
  channel: sendPayload.channel,
  recipient: sendPayload.candidateEmail,
});

function queryResult(data: unknown) {
  const query: any = {
    select: () => query,
    eq: () => query,
    is: () => query,
    in: () => query,
    lte: () => query,
    maybeSingle: async () => ({ data, error: null }),
    single: async () => ({ data, error: null }),
    insert: () => { durableMutations += 1; return query; },
    update: () => { durableMutations += 1; return query; },
    delete: () => { durableMutations += 1; return query; },
  };
  return query;
}

currentSupabase = {
  auth: { getUser: async () => ({ data: { user: authenticatedUser }, error: null }) },
  rpc: async (name: string) => {
    if (name === "current_profile_role") return { data: "admin", error: null };
    if (name === "current_workspace_id") return { data: workspaceId, error: null };
    durableMutations += 1;
    return { data: { allowed: true }, error: null };
  },
  from: (table: string) => {
    if (table === "outreach_approvals") {
      return queryResult({
        body_hash: approvedBodyHash,
        approval_scope_hash: approvedScopeHash,
        approval_source: "human",
      });
    }
    if (table === "agent_seats") {
      return queryResult({
        id: seatId,
        provider: "SMTP",
        operator_email: "recruiter@example.test",
        mode: "live",
        domain_verified: false,
        status: "active",
      });
    }
    return queryResult([]);
  },
};

const sendModule = await import("../src/app/api/outreach/send/route");
const sendPost = ((sendModule as any).POST ?? (sendModule as any).default?.POST) as (req: NextRequest) => Promise<Response>;

const malformed = await sendPost(new NextRequest("http://localhost/api/outreach/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
}));
ok("public demo does not bypass body validation", malformed.status === 400);

authenticatedUser = null;
const unauthenticated = await sendPost(new NextRequest("http://localhost/api/outreach/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(sendPayload),
}));
ok("public demo does not bypass authentication", unauthenticated.status === 401);

authenticatedUser = { id: "user-1" };
providerCalls = 0;
serviceClientReads = 0;
durableMutations = 0;
const guardedSend = await sendPost(new NextRequest("http://localhost/api/outreach/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(sendPayload),
}));
const guardedSendBody = await guardedSend.json() as { status?: string };
ok("valid public-demo admin/live-seat send resolves as dry-run", guardedSend.status === 200 && guardedSendBody.status === "dry-run");
ok("valid public-demo send performs zero provider calls", providerCalls === 0);
ok("valid public-demo send performs zero durable mutations", durableMutations === 0);
ok("valid public-demo send never reads service credentials", serviceClientReads === 0);

blockExternalEffects = false;
providerCalls = 0;
serverClientReads = 0;
serviceClientReads = 0;
durableMutations = 0;
const explicitDryRun = await sendPost(new NextRequest("http://localhost/api/outreach/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...sendPayload, confirmLive: false }),
}));
const explicitDryRunBody = await explicitDryRun.json() as { status?: string };
ok(
  "normal-tenant confirmLive=false resolves through the real route as dry-run",
  explicitDryRun.status === 200 && explicitDryRunBody.status === "dry-run",
);
ok("normal-tenant confirmLive=false performs zero provider or DNS calls", providerCalls === 0);
ok("normal-tenant confirmLive=false performs zero server or service client reads", serverClientReads === 0 && serviceClientReads === 0);
ok("normal-tenant confirmLive=false performs zero durable mutations", durableMutations === 0);
blockExternalEffects = true;

const approvalSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? "admin" : workspaceId,
    error: null,
  }),
  from: () => queryResult([]),
};
currentSupabase = approvalSupabase;
const approvalModule = await import("../src/app/api/outreach/approve/route");
const approvalPost = ((approvalModule as any).POST ?? (approvalModule as any).default?.POST) as (req: NextRequest) => Promise<Response>;
const invalidApproval = await approvalPost(new NextRequest("http://localhost/api/outreach/approve", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messageId: "message-1",
    candidateId: "candidate-1",
    channel: "WhatsApp",
    recipient: "not-a-phone",
    subject: "Hello",
    body: "Hello from Aria.",
  }),
}));
ok("public demo preserves invalid approval-recipient validation", invalidApproval.status === 400);

const viewerSupabase = {
  ...approvalSupabase,
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? "viewer" : workspaceId, error: null }),
};
currentSupabase = viewerSupabase;
const forbiddenApproval = await approvalPost(new NextRequest("http://localhost/api/outreach/approve", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messageId: "message-1",
    candidateId: "candidate-1",
    channel: "Email",
    recipient: "candidate@example.test",
    subject: "Hello",
    body: "Hello from Aria.",
  }),
}));
ok("public demo preserves insufficient-role rejection", forbiddenApproval.status === 403);

process.env.GOOGLE_CLIENT_ID = "google-client";
process.env.MICROSOFT_CLIENT_ID = "microsoft-client";
adminAllowed = true;
currentSupabase = approvalSupabase;
const googleModule = await import("../src/app/auth/google/route");
const googleGet = ((googleModule as any).GET ?? (googleModule as any).default?.GET) as (req: NextRequest) => Promise<Response>;
const missingGoogleSeat = await googleGet(new NextRequest("http://localhost/auth/google"));
ok("public demo preserves Google seat_id validation", missingGoogleSeat.status === 400);

const microsoftModule = await import("../src/app/auth/microsoft/route");
const microsoftGet = ((microsoftModule as any).GET ?? (microsoftModule as any).default?.GET) as (req: NextRequest) => Promise<Response>;
const missingMicrosoftSeat = await microsoftGet(new NextRequest("http://localhost/auth/microsoft"));
ok("public demo preserves Microsoft seat_id validation", missingMicrosoftSeat.status === 400);

adminAllowed = false;
const forbiddenOAuth = await googleGet(new NextRequest(`http://localhost/auth/google?seat_id=${seatId}`));
ok("public demo preserves OAuth admin authorization", forbiddenOAuth.status === 403);
adminAllowed = true;

let ownedDisconnectSeat: { id: string } | null = null;
currentSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? "admin" : workspaceId, error: null }),
  from: (table: string) => table === "agent_seats" ? queryResult(ownedDisconnectSeat) : queryResult([]),
};
const disconnectModule = await import("../src/app/api/email/disconnect/route");
const disconnectPost = ((disconnectModule as any).POST ?? (disconnectModule as any).default?.POST) as (req: NextRequest) => Promise<Response>;
serviceClientReads = 0;
const absentDisconnect = await disconnectPost(new NextRequest("http://localhost/api/email/disconnect", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ seatId }),
}));
const absentDisconnectBody = await absentDisconnect.json() as { status?: string; revoked?: boolean };
ok(
  "public demo preserves absent or foreign mailbox no-op semantics",
  absentDisconnect.status === 200 && absentDisconnectBody.revoked === false && absentDisconnectBody.status !== "dry-run",
);
ok("absent or foreign mailbox check reads no service credential", serviceClientReads === 0);

ownedDisconnectSeat = { id: seatId };
const ownedDisconnect = await disconnectPost(new NextRequest("http://localhost/api/email/disconnect", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ seatId }),
}));
const ownedDisconnectBody = await ownedDisconnect.json() as { status?: string; changed?: boolean };
ok(
  "owned mailbox disconnect becomes an explicit non-changing dry-run",
  ownedDisconnectBody.status === "dry-run" && ownedDisconnectBody.changed === false,
);
ok("owned demo mailbox disconnect reads no service credential", serviceClientReads === 0);

// Normal tenant path proof on the smaller calendar route: the same auth, role,
// validation, ownership and live-seat contract reaches the provider when the
// public-demo switch is off.
const calendarSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? "admin" : workspaceId, error: null }),
  from: (table: string) => table === "agent_seats"
    ? queryResult({ id: seatId, provider: "Gmail API", status: "active", mode: "live" })
    : queryResult([]),
};
currentService = {
  from: () => queryResult({
    id: "connection-1",
    access_token: "access-token",
    refresh_token: null,
    expires_at: null,
    scope: "calendar.events",
    account_email: "recruiter@example.test",
    workspace_id: workspaceId,
  }),
  // The calendar route claims/reconciles a durable booking authority row
  // (0034) via these two service-role RPCs before/after the provider call.
  rpc: async (name: string) => {
    if (name === "claim_calendar_booking") {
      durableMutations += 1;
      return { data: { status: "claimed", id: "booking-1", booking_status: "claimed", external_event_id: null, replay: false }, error: null };
    }
    if (name === "reconcile_calendar_booking") {
      durableMutations += 1;
      return { data: { status: "reconciled", id: "booking-1", booking_status: "confirmed" }, error: null };
    }
    return { data: null, error: null };
  },
};
currentSupabase = calendarSupabase;
const calendarModule = await import("../src/app/api/calendar/event/route");
const calendarPost = ((calendarModule as any).POST ?? (calendarModule as any).default?.POST) as (req: NextRequest) => Promise<Response>;
const calendarPayload = {
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
};

blockExternalEffects = true;
providerCalls = 0;
serviceClientReads = 0;
const guardedCalendar = await calendarPost(new NextRequest("http://localhost/api/calendar/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(calendarPayload),
}));
ok("valid public-demo calendar request is dry-run", (await guardedCalendar.json()).status === "dry-run");
ok("public-demo calendar reads no service credentials and calls no provider", serviceClientReads === 0 && providerCalls === 0);

blockExternalEffects = false;
providerCalls = 0;
serviceClientReads = 0;
const liveCalendar = await calendarPost(new NextRequest("http://localhost/api/calendar/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(calendarPayload),
}));
const liveCalendarBody = await liveCalendar.json() as { status?: string };
ok("normal authenticated tenant still reaches the calendar provider", liveCalendarBody.status === "created" && providerCalls === 1);
ok("normal authenticated tenant resolves its service credential once", serviceClientReads === 1);

console.log(`RESULT demo-live-side-effects: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
