/* ============================================================================
   tests/email-send-ambiguity.mts
   Email provider ambiguity must never release the duplicate guard (finding F1).

   A provider timeout / disconnect / 5xx can arrive AFTER the provider accepted
   the message. Reconciling that unknown outcome to 'skipped' frees the partial
   unique indexes, so a retry of the same human approval could contact the same
   candidate twice. Four sections:
     1. Adapter error-phase classification (real adapters, mocked fetch):
        proven pre-transport failure -> deliveryState 'not-sent' (retryable);
        unknown post-transport outcome -> 'unknown' (never retryable).
     2. Route behavior end-to-end (node:test mock.module, real adapters):
        'unknown' parks the ledger claim as 'ambiguous' + 502
        reconciliation-required; 'not-sent' stays retryable 'skipped'; a
        known-sent email is reconciled 'sent' BEFORE token bookkeeping.
     3. Migration 0022 source pins (build-before-drop index supersession).
     4. Route/type source pins (phase-aware catch, LEDGER_STATUSES).
   ========================================================================== */

import { existsSync, readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import { sendViaProvider, type SendRequest } from "../src/lib/providers";
import {
  sendViaGmailApi,
  sendViaMicrosoftGraph,
  type OAuthSendRequest,
} from "../src/lib/email-oauth";
import { approvalHash, approvalScopeHash } from "../src/lib/outreach-content";
import { LEDGER_STATUSES, type EmailConnection } from "../src/lib/types";

let pass = 0;
let fail = 0;

// Adapter/route audit logging is silenced below; report failures through the
// real stdout so a FAIL line can never be swallowed.
const realLog = console.log.bind(console);

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    realLog("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringHeader(payload: unknown, name: string): string | undefined {
  const headers = record(record(payload)?.headers);
  const value = headers?.[name];
  return typeof value === "string" ? value : undefined;
}

const UNSUBSCRIBE_URL = "https://aria.example.test/api/unsubscribe/abcDEF0123456789_abcDEF0123456789_abcDEF01234";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalEnv: Record<string, string | undefined> = {};
for (const key of [
  "RESEND_API_KEY", "SENDGRID_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "OUTREACH_UNSUBSCRIBE_BASE_URL", "NEXT_PUBLIC_ENABLE_DEMO_LOGIN",
]) originalEnv[key] = process.env[key];

function connection(over: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: "conn-1",
    seatId: "seat-1",
    provider: "Gmail API",
    accountEmail: "owner@acme.example",
    accessToken: "access-token",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    scope: "mail.send",
    connectedAt: "",
    updatedAt: "",
    ...over,
  };
}

const emailReq = {
  from: "owner@acme.example",
  to: "candidate@example.test",
  subject: "Role",
  body: "Hello",
  unsubscribeUrl: UNSUBSCRIBE_URL,
} satisfies Omit<SendRequest, "provider"> & OAuthSendRequest;

try {
  // Silence adapter audit logs; FAIL lines go through realLog above.
  const silent = (() => undefined) as typeof console.log;
  console.log = silent;
  console.error = silent;
  console.warn = silent as typeof console.warn;
  process.env.RESEND_API_KEY = "re_live_supersecretvalue";
  process.env.SENDGRID_API_KEY = "SG.supersecret_sendgrid_key_value";

  /* =========================================================================
     1. Adapter error-phase classification.
     ======================================================================= */
  const sharedClassifierUrl = new URL("../src/lib/delivery-outcome.ts", import.meta.url);
  ok("delivery ambiguity classifier has one shared domain owner", existsSync(sharedClassifierUrl));
  if (existsSync(sharedClassifierUrl)) {
    const { classifyFailedHttpDeliveryState } = await import("../src/lib/delivery-outcome");
    for (const status of [400, 409, 422, 429, 499]) {
      ok(
        `HTTP ${status} is a definitive provider rejection`,
        classifyFailedHttpDeliveryState(status) === "not-sent",
      );
    }
    for (const status of [408, 500, 502, 503, 599]) {
      ok(
        `HTTP ${status} can be ambiguous after request transport`,
        classifyFailedHttpDeliveryState(status) === "unknown",
      );
    }
  }
  const providersSource = readFileSync(new URL("../src/lib/providers.ts", import.meta.url), "utf8");
  const oauthSource = readFileSync(new URL("../src/lib/email-oauth.ts", import.meta.url), "utf8");
  const channelsSource = readFileSync(new URL("../src/lib/channels.ts", import.meta.url), "utf8");
  for (const [adapter, source] of [
    ["API-key email", providersSource],
    ["OAuth email", oauthSource],
    ["messaging", channelsSource],
  ] as const) {
    ok(
      `${adapter} adapter imports the shared delivery classifier`,
      /import\s+\{\s*classifyFailedHttpDeliveryState\s*\}\s+from\s+["']@\/lib\/delivery-outcome["']/.test(source),
    );
    ok(
      `${adapter} adapter defines no private copy of delivery classification`,
      !/function\s+failedHttpDeliveryState\s*\(/.test(source),
    );
  }

  const throwingFetch = (async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  }) as typeof fetch;
  const fetchWith = (status: number, body: unknown = {}) => (async () => jsonResponse(status, body)) as typeof fetch;

  globalThis.fetch = throwingFetch;
  const resendThrew = await sendViaProvider({ provider: "Resend", ...emailReq });
  ok("Resend fetch timeout/disconnect -> ambiguous delivery", resendThrew.status === "error" && resendThrew.deliveryState === "unknown");

  globalThis.fetch = fetchWith(500);
  ok("Resend upstream 500 -> ambiguous delivery", (await sendViaProvider({ provider: "Resend", ...emailReq })).deliveryState === "unknown");
  globalThis.fetch = fetchWith(408);
  ok("Resend upstream 408 -> ambiguous delivery", (await sendViaProvider({ provider: "Resend", ...emailReq })).deliveryState === "unknown");
  globalThis.fetch = fetchWith(422);
  const resendRejected = await sendViaProvider({ provider: "Resend", ...emailReq });
  ok("Resend definitive 422 rejection -> not-sent (retryable)", resendRejected.status === "error" && resendRejected.deliveryState === "not-sent");

  delete process.env.RESEND_API_KEY;
  const resendDryRun = await sendViaProvider({ provider: "Resend", ...emailReq });
  ok("Resend without an API key is a not-sent dry-run", resendDryRun.status === "dry-run" && resendDryRun.deliveryState === "not-sent");
  process.env.RESEND_API_KEY = "re_live_supersecretvalue";

  const missingLink = await sendViaProvider({ provider: "Resend", ...emailReq, unsubscribeUrl: undefined });
  ok("Resend without an unsubscribe link is a not-sent refusal", missingLink.status === "error" && missingLink.deliveryState === "not-sent");

  let resendPayload: unknown = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    resendPayload = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return jsonResponse(200, { id: "email-1" });
  }) as typeof fetch;
  const resendSent = await sendViaProvider({ provider: "Resend", ...emailReq, attemptId: "attempt-resend-1" });
  ok("Resend acceptance -> accepted delivery", resendSent.status === "sent" && resendSent.deliveryState === "accepted");
  ok(
    "Resend payload carries the X-Aria-Send-Attempt identity",
    stringHeader(resendPayload, "X-Aria-Send-Attempt") === "attempt-resend-1",
  );
  resendPayload = null;
  await sendViaProvider({ provider: "Resend", ...emailReq });
  ok(
    "Resend omits the attempt header when no attemptId is given",
    stringHeader(resendPayload, "X-Aria-Send-Attempt") === undefined,
  );

  globalThis.fetch = throwingFetch;
  ok("SendGrid fetch throw -> ambiguous delivery", (await sendViaProvider({ provider: "SendGrid", ...emailReq })).deliveryState === "unknown");
  globalThis.fetch = fetchWith(503);
  ok("SendGrid upstream 503 -> ambiguous delivery", (await sendViaProvider({ provider: "SendGrid", ...emailReq })).deliveryState === "unknown");
  globalThis.fetch = fetchWith(400);
  ok("SendGrid definitive 400 rejection -> not-sent (retryable)", (await sendViaProvider({ provider: "SendGrid", ...emailReq })).deliveryState === "not-sent");
  let sendgridPayload: unknown = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sendgridPayload = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return jsonResponse(202, {});
  }) as typeof fetch;
  const sendgridSent = await sendViaProvider({ provider: "SendGrid", ...emailReq, attemptId: "attempt-sendgrid-1" });
  ok("SendGrid acceptance -> accepted delivery", sendgridSent.status === "sent" && sendgridSent.deliveryState === "accepted");
  ok(
    "SendGrid payload carries the X-Aria-Send-Attempt identity",
    stringHeader(sendgridPayload, "X-Aria-Send-Attempt") === "attempt-sendgrid-1",
  );

  const oauthDryRun = await sendViaProvider({ provider: "Gmail API", ...emailReq });
  ok("OAuth provider stub dry-run stays not-sent", oauthDryRun.status === "dry-run" && oauthDryRun.deliveryState === "not-sent");

  globalThis.fetch = throwingFetch;
  ok("Gmail fetch throw -> ambiguous delivery", (await sendViaGmailApi(emailReq, connection())).deliveryState === "unknown");
  globalThis.fetch = fetchWith(400);
  ok("Gmail definitive 400 rejection -> not-sent (retryable)", (await sendViaGmailApi(emailReq, connection())).deliveryState === "not-sent");
  globalThis.fetch = fetchWith(503);
  ok("Gmail upstream 503 -> ambiguous delivery", (await sendViaGmailApi(emailReq, connection())).deliveryState === "unknown");

  let gmailRaw = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
    gmailRaw = Buffer.from(payload.raw ?? "", "base64url").toString("utf8");
    return jsonResponse(200, { id: "gmail-1" });
  }) as typeof fetch;
  const gmailSent = await sendViaGmailApi({ ...emailReq, attemptId: "attempt-gmail-1" }, connection());
  ok("Gmail acceptance -> accepted delivery", gmailSent.status === "sent" && gmailSent.deliveryState === "accepted");
  ok("Gmail MIME carries the X-Aria-Send-Attempt identity", gmailRaw.includes("X-Aria-Send-Attempt: attempt-gmail-1"));

  // Token refresh is a separate pre-transport endpoint: its failure proves the
  // message never reached the send API, so the attempt must stay retryable.
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  let gmailSendHits = 0;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return jsonResponse(400, { error: "invalid_grant" });
    gmailSendHits += 1;
    return jsonResponse(200, {});
  }) as typeof fetch;
  const refreshFailed = await sendViaGmailApi(
    emailReq,
    connection({ accessToken: "stale", refreshToken: "refresh-1", expiresAt: new Date(Date.now() - 60_000).toISOString() }),
  );
  ok("Gmail refresh failure is a proven pre-transport not-sent", refreshFailed.status === "error" && refreshFailed.deliveryState === "not-sent");
  ok("Gmail refresh failure never reaches the send endpoint", gmailSendHits === 0);

  globalThis.fetch = fetchWith(502);
  ok("Graph upstream 502 -> ambiguous delivery", (await sendViaMicrosoftGraph(emailReq, connection({ provider: "Microsoft Graph" }))).deliveryState === "unknown");
  globalThis.fetch = throwingFetch;
  ok("Graph fetch throw -> ambiguous delivery", (await sendViaMicrosoftGraph(emailReq, connection({ provider: "Microsoft Graph" }))).deliveryState === "unknown");
  globalThis.fetch = fetchWith(202);
  ok(
    "Graph acceptance -> accepted delivery",
    (await sendViaMicrosoftGraph(emailReq, connection({ provider: "Microsoft Graph" }))).deliveryState === "accepted",
  );

  /* =========================================================================
     2. Route behavior end-to-end. Real adapters + mocked global fetch drive
        the exact production classification; only the Supabase clients, the
        public-demo switch, and DNS verification are injected.
     ======================================================================= */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = "https://aria.example.test";
  // encryptionRequiredButMissing() must stay false so the refreshed-token
  // persist path actually runs in case (d) below.
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true";

  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const seatId = "22222222-2222-4222-8222-222222222222";
  const ledgerId = "33333333-3333-4333-8333-333333333333";

  let seatProvider = "Resend";
  let emailConnRow: Record<string, unknown> | null = null;
  let connectionPersistThrows = false;
  let userLedgerThrowNext = 0;
  const userLedgerPatches: Array<Record<string, unknown>> = [];
  const serviceLedgerPatches: Array<Record<string, unknown>> = [];
  const events: string[] = [];

  function chainQuery(opts: { result?: unknown; onUpdate?: (patch: Record<string, unknown>) => void } = {}) {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ["select", "eq", "is", "in", "or", "lte"]) q[m] = self;
    q.insert = self;
    q.update = (patch: Record<string, unknown>) => {
      opts.onUpdate?.(patch);
      return q;
    };
    q.maybeSingle = async () => ({ data: opts.result ?? null, error: null });
    q.single = async () => ({ data: opts.result ?? null, error: null });
    q.then = (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: opts.result ?? null, error: null });
    return q;
  }

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

  const userSupabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: async (name: string) => {
      if (name === "current_profile_role") return { data: "admin", error: null };
      if (name === "current_workspace_id") return { data: workspaceId, error: null };
      if (name === "claim_email_outbound") return { data: { allowed: true, reason: "ok", ledger_id: ledgerId }, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "workspace_state") return chainQuery({ result: { state: {} } });
      if (table === "outreach_approvals") {
        return chainQuery({ result: { body_hash: approvedBodyHash, approval_scope_hash: approvedScopeHash, approval_source: "human" } });
      }
      if (table === "agent_seats") {
        return chainQuery({
          result: { id: seatId, provider: seatProvider, operator_email: "recruiter@example.test", mode: "live", domain_verified: true, status: "active" },
        });
      }
      if (table === "suppression_list") return chainQuery({ result: [] });
      if (table === "outreach_ledger") {
        return chainQuery({
          onUpdate: (patch) => {
            if (userLedgerThrowNext > 0) {
              userLedgerThrowNext -= 1;
              throw new Error("ledger update connection reset");
            }
            userLedgerPatches.push(patch);
            events.push(`reconcile:${String(patch.status)}`);
          },
        });
      }
      return chainQuery({ result: [] });
    },
  };

  const serviceSupabase = {
    from: (table: string) => {
      if (table === "outreach_ledger") {
        return chainQuery({
          result: { id: ledgerId },
          onUpdate: (patch) => {
            serviceLedgerPatches.push(patch);
            events.push("stamp");
          },
        });
      }
      if (table === "email_connections") {
        return chainQuery({
          result: emailConnRow,
          onUpdate: () => {
            if (connectionPersistThrows) throw new Error("token persist storage failure");
          },
        });
      }
      return chainQuery({ result: null });
    },
  };

  const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
  mock.module(moduleUrl("src/lib/supabase/server.ts"), {
    namedExports: {
      getServerSupabase: async () => userSupabase,
      getServiceSupabase: () => serviceSupabase,
      requireAdmin: async () => ({ ok: true, role: "admin" }),
    },
  });
  mock.module(moduleUrl("src/lib/server/demo-side-effects.ts"), {
    namedExports: {
      PUBLIC_DEMO_DRY_RUN_DETAIL: "Public demo: provider effects disabled.",
      publicDemoSideEffectsDisabled: () => false,
    },
  });
  mock.module(moduleUrl("src/lib/domain-verification.ts"), {
    namedExports: { domainVerified: async () => true },
  });
  mock.module("server-only", { namedExports: {} });
  mock.module(moduleUrl("src/lib/outreach-quality-pipeline-live.ts"), {
    namedExports: {
      validateOutreachQualityLive: async (input: { subject: string; body: string; channel?: string }) => {
        const { validateOutreachQuality } = await import("../src/lib/outreach-quality-pipeline");
        return validateOutreachQuality(input);
      },
    },
  });

  const sendModule = await import("../src/app/api/outreach/send/route");
  const sendPost = ((sendModule as { POST?: unknown }).POST) as (req: NextRequest) => Promise<Response>;

  const post = async () =>
    sendPost(new NextRequest("http://localhost/api/outreach/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sendPayload),
    }));

  const resetCase = () => {
    userLedgerPatches.length = 0;
    serviceLedgerPatches.length = 0;
    events.length = 0;
    userLedgerThrowNext = 0;
    connectionPersistThrows = false;
  };
  const lastStatus = () => userLedgerPatches[userLedgerPatches.length - 1]?.status;
  const everSkipped = () => userLedgerPatches.some((p) => p.status === "skipped");

  // (a) Provider 500: acceptance unknown -> ledger 'ambiguous', 502, no retry invite.
  resetCase();
  let providerFetches = 0;
  globalThis.fetch = (async () => {
    providerFetches += 1;
    events.push("provider-fetch");
    return jsonResponse(500, {});
  }) as typeof fetch;
  const ambiguousRes = await post();
  const ambiguousBody = await ambiguousRes.json() as { status?: string; delivery?: string; detail?: string; sendAttemptId?: string };
  ok("unknown provider outcome returns 502 reconciliation-required", ambiguousRes.status === 502 && ambiguousBody.status === "reconciliation-required");
  ok("unknown provider outcome names the email reconciliation channel", ambiguousBody.delivery === "email-reconciliation-required");
  ok("unknown provider outcome forbids a retry in its detail", /do not retry/i.test(ambiguousBody.detail ?? ""));
  ok("unknown provider outcome parks the ledger claim as ambiguous", lastStatus() === "ambiguous");
  ok("unknown provider outcome never writes a retryable skipped", !everSkipped());
  ok("response exposes a well-formed send attempt id", UUID_RE.test(ambiguousBody.sendAttemptId ?? ""));
  ok(
    "the attempt id was stamped on the claim by the service client before transport",
    serviceLedgerPatches[0]?.send_attempt_id === ambiguousBody.sendAttemptId &&
      events.indexOf("stamp") >= 0 &&
      events.indexOf("stamp") < events.indexOf("provider-fetch"),
  );
  ok("the stamp rides the same update as the unsubscribe token bind", typeof serviceLedgerPatches[0]?.email_unsubscribe_token_hash === "string");
  ok("the provider was called exactly once", providerFetches === 1);

  // (b) Provider 422: definitive rejection -> retryable 'skipped', as before.
  resetCase();
  globalThis.fetch = (async () => jsonResponse(422, {})) as typeof fetch;
  const rejectedRes = await post();
  const rejectedBody = await rejectedRes.json() as { status?: string };
  ok("definitive provider rejection stays a retryable skipped", lastStatus() === "skipped" && rejectedBody.status === "error");

  // (c) Transport throw (timeout/disconnect): unknown -> 'ambiguous' + 502.
  resetCase();
  globalThis.fetch = throwingFetch;
  const thrownRes = await post();
  const thrownBody = await thrownRes.json() as { status?: string };
  ok(
    "transport timeout/disconnect parks the claim as ambiguous",
    thrownRes.status === 502 && thrownBody.status === "reconciliation-required" && lastStatus() === "ambiguous" && !everSkipped(),
  );

  // (c2) A throw AFTER transport began (even in our own bookkeeping) fails
  // closed through the route catch: ambiguous, never skipped.
  resetCase();
  userLedgerThrowNext = 1; // the reconcile('sent') write fails
  globalThis.fetch = (async () => jsonResponse(200, { id: "email-9" })) as typeof fetch;
  const bookkeepingRes = await post();
  const bookkeepingBody = await bookkeepingRes.json() as { status?: string };
  ok(
    "a post-transport throw in reconciliation fails closed to ambiguous",
    bookkeepingRes.status === 502 && bookkeepingBody.status === "reconciliation-required" && lastStatus() === "ambiguous" && !everSkipped(),
  );

  // (d) OAuth: accepted send is reconciled 'sent' BEFORE the refreshed-token
  // persist, so a storage throw there can never mark a delivered email skipped.
  resetCase();
  seatProvider = "Gmail API";
  emailConnRow = {
    id: "conn-route-1",
    access_token: "plain-token",
    refresh_token: "plain-refresh",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    scope: "mail.send",
    account_email: "recruiter@example.test",
    workspace_id: workspaceId,
  };
  connectionPersistThrows = true;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse(200, { access_token: "refreshed-token", expires_in: 3600 });
    }
    events.push("provider-fetch");
    return jsonResponse(200, { id: "gmail-route-1" });
  }) as typeof fetch;
  const sentRes = await post();
  const sentBody = await sentRes.json() as { status?: string };
  ok(
    "a known-sent email survives a token-persist failure as 'sent'",
    sentRes.status === 200 && sentBody.status === "sent" && lastStatus() === "sent" && !everSkipped(),
  );
  ok(
    "OAuth path reconciled 'sent' after transport, never 'ambiguous'",
    userLedgerPatches.every((p) => p.status === "sent"),
  );
  seatProvider = "Resend";
  emailConnRow = null;

  /* =========================================================================
     3. Migration 0022 source pins.
     ======================================================================= */
  const migration = readFileSync(new URL("../supabase/migrations/0022_email_send_reconciliation.sql", import.meta.url), "utf8");
  const fleetMigration = readFileSync(new URL("../supabase/migrations/0002_fleet.sql", import.meta.url), "utf8");
  const raceMigration = readFileSync(new URL("../supabase/migrations/0013_outreach_approval_race_safety.sql", import.meta.url), "utf8");

  ok("0022 adds the immutable send_attempt_id column", /add column if not exists send_attempt_id uuid/.test(migration));
  ok(
    "0022 makes the attempt identity unique when present",
    /outreach_ledger_send_attempt_uniq[\s\S]*?where send_attempt_id is not null/.test(migration),
  );
  ok(
    "0022 extends the candidate de-dupe index to ambiguous rows",
    /outreach_ledger_active_reconcile_uniq[\s\S]*?\(workspace_id, candidate_id\)[\s\S]*?where status in \('claimed', 'sent', 'ambiguous'\)/.test(migration),
  );
  ok(
    "0022 extends the approval-id de-dupe index to ambiguous rows",
    /outreach_ledger_approval_message_reconcile_uniq[\s\S]*?\(workspace_id, approval_message_id\)[\s\S]*?approval_message_id is not null[\s\S]*?status in \('claimed', 'sent', 'ambiguous'\)/.test(migration),
  );
  ok(
    "0022 builds the candidate index before dropping the superseded one",
    migration.indexOf("outreach_ledger_active_reconcile_uniq") >= 0 &&
      migration.indexOf("outreach_ledger_active_reconcile_uniq") < migration.indexOf("drop index if exists public.outreach_ledger_active_uniq"),
  );
  ok(
    "0022 builds the approval index before dropping the superseded one",
    migration.indexOf("outreach_ledger_approval_message_reconcile_uniq") >= 0 &&
      migration.indexOf("outreach_ledger_approval_message_reconcile_uniq") <
        migration.indexOf("drop index if exists public.outreach_ledger_approval_message_live_uniq"),
  );
  ok(
    "0022 leaves transaction ownership to the bootstrap runner",
    !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
  );
  ok("0022 never rebuilds indexes concurrently inside the runner transaction", !/concurrently/i.test(migration));
  ok(
    "0002 and 0013 are superseded in place, never edited",
    /create unique index if not exists outreach_ledger_active_uniq/.test(fleetMigration) &&
      /create unique index if not exists outreach_ledger_approval_message_live_uniq/.test(raceMigration),
  );

  /* =========================================================================
     4. Route/type source pins.
     ======================================================================= */
  const routeSource = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
  ok("route reconciles ambiguous outcomes distinctly from skipped", /reconcile\("ambiguous"/.test(routeSource));
  ok("route only keeps proven not-sent failures retryable", /outcome\.deliveryState === "not-sent"/.test(routeSource));
  ok("route reports email reconciliation over a retryable error", /email-reconciliation-required/.test(routeSource));
  ok(
    "route catch is phase-aware instead of unconditionally skipping",
    /catch \(err\)[\s\S]*?if \(transportStarted\)[\s\S]*?reconcile\("ambiguous", detail\)/.test(routeSource) &&
      !/else await reconcile\("skipped", outcome\.detail\)/.test(routeSource),
  );
  ok("route stamps the attempt id in the token-bind service update", /send_attempt_id: sendAttemptId/.test(routeSource));
  ok("ledger statuses include the non-retryable ambiguous state", (LEDGER_STATUSES as readonly string[]).includes("ambiguous"));
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`RESULT email-send-ambiguity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
