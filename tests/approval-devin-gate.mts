/**
 * Devin's void-gate findings on #167. These assertions describe the required
 * behavior. They fail until the following commit implements it.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { recipientAllowlist, recipientAllowed } from "../src/lib/approval/allowlist.ts";
import { exactBodyHash } from "../src/lib/approval/hash.ts";
import { ApprovalLedger } from "../src/lib/approval/ledger.ts";
import type { ExactMessage } from "../src/lib/approval/types.ts";

const ACTOR = "operator.synthetic";
const NOW = "2026-11-20T12:00:00.000Z";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function message(overrides: Partial<ExactMessage> = {}): ExactMessage {
  return {
    messageId: "msg-devin-1",
    campaignId: "campaign-synthetic-1",
    candidateId: "candidate-synthetic-1",
    channel: "Email",
    recipient: "ada@example.test",
    subject: "Example note",
    body: "Ada, the example ledger is why I wrote, including the hash bound to this exact note.",
    noticeVersion: "art14-lgpd-2026-11-20",
    ...overrides,
  };
}

test("test_exact_hash_normalizes_nfc_and_binds_approver_and_timestamp", () => {
  const base = {
    channel: "Email",
    recipient: "ada@example.test",
    subject: "Example note",
    body: "Hello from the example ledger.",
    noticeVersion: "art14-lgpd-2026-11-20",
    approverId: "operator-a",
    approvedAt: "2026-11-20T00:00:00.000Z",
  };
  assert.equal(
    exactBodyHash({ ...base, body: "caf\u00e9" }),
    exactBodyHash({ ...base, body: "cafe\u0301" }),
  );
  assert.notEqual(
    exactBodyHash(base),
    exactBodyHash({ ...base, approverId: "operator-b" }),
  );
  assert.notEqual(
    exactBodyHash(base),
    exactBodyHash({ ...base, approvedAt: "2026-11-21T00:00:00.000Z" }),
  );
});

test("test_send_path_uses_exact_body_hash_and_refuses_a_later_edit", async () => {
  const send = read("src/app/api/outreach/send/route.ts");
  const dispatch = read("src/lib/dispatch-outbound.ts");
  assert.match(send, /exactBodyHash\(/);
  assert.match(send, /approvalHash\(/);
  assert.match(dispatch, /exactBodyHash\(/);
  assert.match(dispatch, /approvalHash\(/);
  assert.match(send, /consultApprovalLedger\(/);
  assert.match(dispatch, /consultApprovalLedger\(/);

  const ledger = await import("../src/lib/approval/ledger.ts");
  assert.equal(typeof ledger.consultApprovalLedger, "function");
  const approvedAt = "2026-11-20T00:00:00.000Z";
  const text = message();
  const stored = exactBodyHash({ ...text, approverId: ACTOR, approvedAt });
  const shared = {
    channel: text.channel,
    recipient: text.recipient,
    subject: text.subject,
    noticeVersion: text.noticeVersion,
    approverId: ACTOR,
    approvedAt,
    storedBodyHash: stored,
    env: { ARIA_MODE: "demo", ARIA_RECIPIENT_ALLOWLIST: text.recipient },
    nowMs: Date.parse(approvedAt),
  };
  assert.equal(ledger.consultApprovalLedger({ ...shared, body: text.body }).allowed, true);
  const edited = ledger.consultApprovalLedger({ ...shared, body: `${text.body} Edited.` });
  assert.equal(edited.allowed, false);
  assert.equal(edited.reason, "body-hash-mismatch");
});

test("test_demo_unset_allowlist_fails_closed", () => {
  const open = recipientAllowlist("demo", undefined);
  assert.equal(open.enforced, true);
  assert.equal(recipientAllowed(open, "ada@example.test"), false);
  const ledger = new ApprovalLedger({
    runMode: "demo",
    allowlist: "",
    channelCaps: { Email: 1 },
    now: () => NOW,
  });
  const decision = ledger.approveManual(message(), ACTOR);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "allowlist");
});

test("test_approval_lifecycle_transitions", async () => {
  const ledger = await import("../src/lib/approval/ledger.ts");
  assert.equal(typeof ledger.transitionApprovalState, "function");
  const legal: Array<[string, string]> = [
    ["draft", "pending"],
    ["pending", "approved"],
    ["approved", "sent"],
    ["draft", "invalidated"],
    ["pending", "invalidated"],
    ["approved", "invalidated"],
    ["sent", "invalidated"],
  ];
  for (const [from, to] of legal) {
    assert.equal(ledger.transitionApprovalState(from, to), to, `${from} -> ${to}`);
  }
  const illegal: Array<[string, string]> = [
    ["draft", "approved"],
    ["draft", "sent"],
    ["pending", "sent"],
    ["approved", "pending"],
    ["sent", "approved"],
    ["sent", "draft"],
    ["invalidated", "draft"],
    ["invalidated", "approved"],
  ];
  for (const [from, to] of illegal) {
    assert.throws(() => ledger.transitionApprovalState(from, to), /illegal/, `${from} -> ${to}`);
  }
});

test("test_per_channel_cap_resets_each_utc_day", () => {
  let now = "2026-11-20T12:00:00.000Z";
  const ledger = new ApprovalLedger({
    runMode: "demo",
    allowlist: "ada@example.test",
    channelCaps: { Email: 1 },
    now: () => now,
  });
  const first = message({ messageId: "day-1" });
  const second = message({
    messageId: "day-2",
    body: `${first.body} Second note, still about the example ledger.`,
  });
  assert.equal(ledger.approveManual(first, ACTOR).allowed, true);
  assert.equal(ledger.approveManual(second, ACTOR).allowed, true);
  assert.equal(ledger.decideSend(first, ACTOR).allowed, true);
  assert.equal(ledger.decideSend(second, ACTOR).reason, "channel-cap");
  now = "2026-11-21T00:00:00.000Z";
  assert.equal(ledger.decideSend(second, ACTOR).allowed, true);
});

test("test_expired_approval_is_refused_on_the_send_route_and_the_dispatcher", async () => {
  const send = read("src/app/api/outreach/send/route.ts");
  const dispatch = read("src/lib/dispatch-outbound.ts");
  assert.match(send, /approvalIsCurrent\(/);
  assert.match(dispatch, /approvalIsCurrent\(/);
  const ledger = await import("../src/lib/approval/ledger.ts");
  assert.equal(typeof ledger.consultApprovalLedger, "function");
  const approvedAt = "2026-11-01T00:00:00.000Z";
  const text = message();
  const stored = exactBodyHash({ ...text, approverId: ACTOR, approvedAt });
  const decision = ledger.consultApprovalLedger({
    channel: text.channel,
    recipient: text.recipient,
    subject: text.subject,
    body: text.body,
    noticeVersion: text.noticeVersion,
    approverId: ACTOR,
    approvedAt,
    storedBodyHash: stored,
    env: { ARIA_MODE: "demo", ARIA_RECIPIENT_ALLOWLIST: text.recipient, ARIA_APPROVAL_TTL_DAYS: "7" },
    nowMs: Date.parse("2026-11-20T00:00:00.000Z"),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "approval-expired");
});

test("test_claim_email_outbound_requires_a_current_approved_at", () => {
  const sql = read("supabase/migrations/0001_baseline.sql");
  const start = sql.indexOf("CREATE FUNCTION public.claim_email_outbound(");
  const end = sql.indexOf("CREATE FUNCTION public.claim_email_outbound_queued");
  const fn = sql.slice(start, end);
  assert.match(fn, /approved_at is null/);
  assert.match(fn, /interval '7 days'/);
  assert.match(fn, /approval-expired/);
  assert.equal(existsSync("tests/db/approval-ttl.sql"), true);
  assert.match(read("tests/schema-authority-db.sh"), /approval-ttl/);
});

test("test_sentinel_uses_synthetic_hosts_and_outbox_get_is_gone", () => {
  assert.doesNotMatch(read("tests/approval-sentinel.mts"), /linkedin\.com/);
  const outbox = read("src/app/api/linkedin/outbox/route.ts");
  const get = outbox.slice(outbox.indexOf("export async function GET"), outbox.indexOf("export async function POST"));
  assert.match(get, /status:\s*410/);
  assert.doesNotMatch(get, /linkedin_bridge_outbox/);
});

test("test_secret_scan_covers_full_history_and_the_harness_fingerprint", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /log-opts='--all'/);
  const ignore = read(".gitleaksignore");
  assert.match(
    ignore,
    /^fc1d82a8e16b0ec2e0dc3cc8b5c9db749f1bd32e:services\/channels\/harness_test\.go:generic-api-key:22$/m,
  );
  const lines = ignore.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^[0-9a-f]{40}:/.test(lines[i] ?? "")) continue;
    assert.match(lines[i - 1] ?? "", /^# \S/, `justification comment for ${lines[i]}`);
  }
});

test("test_agents_healthcheck_uses_the_shared_process_probe", () => {
  const agents = read("docker-compose.yml").slice(read("docker-compose.yml").indexOf("\n  agents:"));
  assert.match(agents, /process\.kill\(1,\s*0\)/);
  assert.doesNotMatch(agents, /process\.exit\(0\)/);
});

test("test_allowlist_matches_exact_host_or_dot_boundary_only", () => {
  const list = recipientAllowlist("demo", "example.com");
  assert.equal(recipientAllowed(list, "ada@example.com"), true);
  assert.equal(recipientAllowed(list, "ada@mail.example.com"), true);
  assert.equal(recipientAllowed(list, "ada@evil-example.com"), false);
  assert.equal(recipientAllowed(list, "ada@example.com.evil.test"), false);
});

test("test_allowlist_trims_ascii_and_refuses_homoglyphs", () => {
  const list = recipientAllowlist("demo", "ada@example.test");
  assert.equal(recipientAllowed(list, "  ada@example.test  "), true);
  assert.equal(recipientAllowed(list, "\u0430da@example.test"), false);
});

test("test_dispatcher_passes_profile_url_to_the_allowlist_target", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  assert.match(dispatch, /deliveryTargetForChannel\([\s\S]*profileUrl:/);
});
