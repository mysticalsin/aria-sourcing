import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { killSwitchEngaged } from "../src/lib/approval/allowlist.ts";
import { deliveryTargetForChannel, dispatchChannelDecision } from "../src/lib/approval/dispatch-guard.ts";
import { exactBodyHash } from "../src/lib/approval/hash.ts";
import { ApprovalLedger } from "../src/lib/approval/ledger.ts";
import { calendarInviteHash, calendarSendUpdates, createGoogleCalendarEvent, createGraphCalendarEvent } from "../src/lib/calendar.ts";
import { getLinkedInAdapter } from "../src/lib/linkedin-channel.ts";
import type { EmailConnection } from "../src/lib/types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("test_linkedin_delivery_is_hard_refused", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const outbox = read("src/app/api/linkedin/outbox/route.ts");
  const poll = read("src/app/api/linkedin/bridge/poll/route.ts");
  assert.match(dispatch, /linkedin-delivery-refused/);
  assert.doesNotMatch(dispatch, /adapter\.deliver/);
  assert.match(outbox, /status:\s*410/);
  assert.match(outbox, /linkedInDeliveryRefusal|linkedin-delivery-refused/);
  assert.match(poll, /status:\s*410/);
  assert.match(poll, /linkedInDeliveryRefusal|linkedin-delivery-refused/);
  const outboxPost = outbox.slice(outbox.indexOf("export async function POST"));
  assert.ok(outboxPost.indexOf("410") < outboxPost.indexOf("linkedin_bridge_outbox") || !outboxPost.includes(".insert("));
  const decision = dispatchChannelDecision({ ARIA_MODE: "demo" }, "LinkedIn", {
    toAddress: "ada.candidate@example.test",
    profileUrl: "https://www.linkedin.com/in/ada-example",
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.status, 410);
    assert.equal(decision.reason, "linkedin-delivery-refused");
  }
});

test("test_calendar_invite_requires_send_policy", async () => {
  const calendar = read("src/lib/calendar.ts");
  const route = read("src/app/api/calendar/event/route.ts");
  assert.match(calendar, /sendPolicyFromEnv/);
  assert.match(route, /sendPolicyFromEnv|calendarSendUpdates/);
  const ev = {
    candidateName: "Ada Example",
    role: "Platform Engineer",
    startTime: "2026-11-20T14:00:00.000Z",
    endTime: "2026-11-20T14:30:00.000Z",
    timezone: "UTC",
    candidateEmail: "ada.candidate@example.test",
    interviewerEmail: "recruiter@example.test",
    agenda: ["Walk through the example ledger"],
  };
  const connection = {
    id: "conn-1",
    seatId: "seat-1",
    provider: "Gmail API",
    accountEmail: "recruiter@example.test",
    accessToken: "access-token",
    refreshToken: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope: "calendar.events",
    connectedAt: "",
    updatedAt: "",
  } as EmailConnection;
  let googleUrl = "";
  let graphBody = "";
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = "";
    }
    if (host === "graph.microsoft.com") graphBody = String(init?.body ?? "");
    else googleUrl = url;
    return new Response(JSON.stringify({ id: "evt-1", htmlLink: "https://calendar.example.test/evt-1", webLink: "https://calendar.example.test/evt-1" }), { status: 200 });
  }) as typeof fetch;
  try {
    await createGoogleCalendarEvent(ev, connection);
    await createGraphCalendarEvent(ev, { ...connection, provider: "Microsoft Graph" });
  } finally {
    globalThis.fetch = original;
  }
  assert.match(googleUrl, /sendUpdates=none/);
  assert.doesNotMatch(googleUrl, /sendUpdates=all/);
  assert.equal(JSON.parse(graphBody).attendees, undefined);

  const env = {
    ARIA_MODE: "demo" as const,
    ARIA_RECIPIENT_ALLOWLIST: "ada.candidate@example.test,recruiter@example.test",
  };
  const approved = calendarInviteHash(ev);
  assert.equal(calendarSendUpdates(env, ev, approved), "all");
  assert.equal(calendarSendUpdates({ ...env, ARIA_SEND_KILL_SWITCH: "1" }, ev, approved), "none");
  assert.equal(calendarSendUpdates(env, ev, null), "none");
  assert.equal(calendarSendUpdates({ ARIA_MODE: "demo", ARIA_RECIPIENT_ALLOWLIST: "ada.candidate@example.test" }, ev, approved), "none");
});

test("test_kill_switch_fails_closed", () => {
  assert.equal(killSwitchEngaged({}), false);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "" }), false);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "0" }), false);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "false" }), false);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "off" }), false);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "1" }), true);
  assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "TRUE" }), true);
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "yes" }), true);
    assert.equal(killSwitchEngaged({ ARIA_SEND_KILL_SWITCH: "maybe" }), true);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((line) => !line.toLowerCase().includes("yes") && !line.toLowerCase().includes("maybe")));
});

test("test_allowlist_checks_delivery_target", () => {
  const allowlisted = "ada.candidate@example.test";
  const other = "other.person@example.test";
  const env = { ARIA_MODE: "demo" as const, ARIA_RECIPIENT_ALLOWLIST: allowlisted };
  assert.equal(
    deliveryTargetForChannel("Email", { toAddress: other, profileUrl: "https://www.linkedin.com/in/ada-example" }),
    other,
  );
  assert.equal(
    deliveryTargetForChannel("LinkedIn", { toAddress: allowlisted, profileUrl: "https://www.linkedin.com/in/other-example" }),
    "https://www.linkedin.com/in/other-example",
  );
  const email = dispatchChannelDecision(env, "Email", { toAddress: other, profileUrl: allowlisted });
  assert.equal(email.ok, false);
  if (!email.ok) assert.equal(email.reason, "allowlist");
  const linkedin = dispatchChannelDecision(env, "LinkedIn", {
    toAddress: allowlisted,
    profileUrl: "https://www.linkedin.com/in/other-example",
  });
  assert.equal(linkedin.ok, false);
  if (!linkedin.ok) assert.equal(linkedin.reason, "allowlist");
  const dispatch = read("src/lib/dispatch-outbound.ts");
  assert.match(dispatch, /deliveryTargetForChannel/);
});

test("test_approval_hash_is_length_prefixed_and_expires", () => {
  const base = {
    channel: "a\nb",
    recipient: "c",
    subject: "Subject",
    body: "Body text for the example ledger.",
    noticeVersion: "art14-lgpd-2026-11-20",
  };
  const collided = { ...base, channel: "a", recipient: "b\nc" };
  assert.notEqual(exactBodyHash(base), exactBodyHash(collided));

  let now = "2026-11-20T00:00:00.000Z";
  const ledger = new ApprovalLedger({
    runMode: "demo",
    allowlist: "ada.candidate@example.test",
    channelCaps: { Email: 5 },
    now: () => now,
  });
  const message = {
    messageId: "msg-expiry",
    campaignId: "campaign-synthetic-1",
    candidateId: "candidate-synthetic-1",
    channel: "Email",
    recipient: "ada.candidate@example.test",
    subject: "Platform role",
    body: "Ada, your notes on the example ledger are the reason I wrote, including the hash you bound to each line.",
    noticeVersion: "art14-lgpd-2026-11-20",
  };
  assert.equal(ledger.approveManual(message, "operator.synthetic").allowed, true);
  now = "2026-11-26T00:00:00.000Z";
  assert.equal(ledger.decideSend(message, "operator.synthetic").allowed, true);
  now = "2026-11-28T00:00:00.000Z";
  const expired = ledger.decideSend(message, "operator.synthetic");
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, "approval-expired");

  const claim = read("supabase/migrations/0001_baseline.sql");
  const emailClaim = claim.slice(claim.indexOf("CREATE FUNCTION public.claim_email_outbound_queued"));
  assert.match(emailClaim, /outbound\.subject/);
  assert.match(emailClaim, /outbound\.body/);
  assert.match(emailClaim, /outbound\.channel/);
  assert.match(emailClaim, /recipient/);
  const linkedinClaim = claim.slice(claim.indexOf("CREATE FUNCTION public.claim_linkedin_outbound_queued"));
  assert.match(linkedinClaim, /outbound\.subject/);
  assert.match(linkedinClaim, /outbound\.body/);
  assert.match(linkedinClaim, /outbound\.channel/);
  assert.match(linkedinClaim, /recipient/);
});

test("test_gitleaks_ignore_is_an_exact_fingerprint", () => {
  const ignore = read(".gitleaksignore");
  const entry = ignore
    .split(/\r?\n/)
    .find((line) => line.includes("src/lib/store/sourcing-actions.ts"));
  assert.equal(
    entry,
    "da301b172b1796738f402b779297dfa9fadced88:src/lib/store/sourcing-actions.ts:linkedin-client-secret:333",
  );
  const comment = ignore.slice(0, ignore.indexOf(entry ?? "")).split(/\r?\n/).filter((line) => line.startsWith("#")).at(-1) ?? "";
  assert.match(comment, /linkedinPublicId/);
  assert.match(comment, /not a credential/);
  assert.doesNotMatch(ignore, /^\s*src\//m);
});

test("test_linkedin_vendor_adapter_makes_no_network_call", async () => {
  const originalUrl = process.env.LINKEDIN_VENDOR_API_URL;
  const originalKey = process.env.LINKEDIN_VENDOR_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.LINKEDIN_VENDOR_API_URL = "https://vendor.example.test/linkedin/send";
  process.env.LINKEDIN_VENDOR_API_KEY = "synthetic-vendor-fixture";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const assisted = await getLinkedInAdapter("assisted-manual").deliver({
      workspaceId: "ws-synthetic",
      messageId: "msg-synthetic",
      candidateId: "candidate-synthetic",
      profileUrl: "https://www.linkedin.com/in/ada-example",
      subject: "Example note",
      body: "Hello from the example ledger.",
      attemptId: "11111111-1111-4111-8111-111111111111",
    });
    const vendor = await getLinkedInAdapter("vendor-api").deliver({
      workspaceId: "ws-synthetic",
      messageId: "msg-synthetic",
      candidateId: "candidate-synthetic",
      profileUrl: "https://www.linkedin.com/in/ada-example",
      subject: "Example note",
      body: "Hello from the example ledger.",
      attemptId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(calls, 0);
    assert.equal(assisted.status, "error");
    assert.equal(assisted.deliveryState, "not-sent");
    assert.equal(vendor.status, "error");
    assert.equal(vendor.deliveryState, "not-sent");
    assert.equal(vendor.detail, "Aria does not deliver to LinkedIn.");
    assert.equal(getLinkedInAdapter("vendor-api").configured(), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.LINKEDIN_VENDOR_API_URL;
    else process.env.LINKEDIN_VENDOR_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.LINKEDIN_VENDOR_API_KEY;
    else process.env.LINKEDIN_VENDOR_API_KEY = originalKey;
  }
});

test("test_linkedin_token_channel_requires_workspace_flag", () => {
  const message = {
    messageId: "msg-li-token",
    campaignId: "campaign-synthetic-1",
    candidateId: "candidate-synthetic-1",
    channel: "linkedin_token",
    recipient: "https://www.linkedin.com/in/ada-example",
    subject: "Example note",
    body: "Ada, the example ledger is why I wrote, including the hash bound to this exact note.",
    noticeVersion: "art14-lgpd-2026-11-20",
  };
  const off = new ApprovalLedger({
    runMode: "demo",
    allowlist: message.recipient,
    channelCaps: { linkedin_token: 2 },
    now: () => "2026-11-20T18:53:00.000Z",
  });
  assert.equal(off.approveManual(message, "operator.synthetic").allowed, true);
  const blocked = off.decideSend(message, "operator.synthetic");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "linkedin-token-disabled");

  const on = new ApprovalLedger({
    runMode: "demo",
    allowlist: message.recipient,
    channelCaps: { linkedin_token: 2 },
    linkedinTokenEnabled: true,
    now: () => "2026-11-20T18:53:00.000Z",
  });
  assert.equal(on.approveManual(message, "operator.synthetic").allowed, true);
  const allowed = on.decideSend(message, "operator.synthetic");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "authorized");
  assert.equal(allowed.bodyHash, exactBodyHash(message));
  const edited = { ...message, body: `${message.body} Edited.` };
  assert.notEqual(exactBodyHash(edited), exactBodyHash(message));
  assert.equal(on.decideSend(edited, "operator.synthetic").reason, "body-hash-mismatch");
});

void DAY_MS;
