import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { approvalPolicyFromEnv } from "../src/lib/approval/allowlist.ts";
import { sendPolicyFromEnv } from "../src/lib/approval/dispatch-guard.ts";
import { exactBodyHash, lengthPrefixed } from "../src/lib/approval/hash.ts";
import { ApprovalLedger, type LedgerOptions } from "../src/lib/approval/ledger.ts";
import { MIN_QC_RUBRIC_SCORE, stubQualityCheckAgent, type QcEvaluation } from "../src/lib/approval/qc.ts";
import type { ExactMessage } from "../src/lib/approval/types.ts";
import { sanitizeOutreachSubject } from "../src/lib/outreach-content.ts";

const ACTOR = "operator.synthetic";
const CAMPAIGN = "campaign-synthetic-1";
const NOTICE = "art14-lgpd-2026-11-20";
const RECIPIENT = "ada.candidate@example.test";

const PASSING_QC: QcEvaluation = {
  pass: true,
  rubricScore: 90,
  generic: false,
  reasons: [],
};

function message(overrides: Partial<ExactMessage> = {}): ExactMessage {
  return {
    messageId: "msg-synthetic-1",
    campaignId: CAMPAIGN,
    candidateId: "candidate-synthetic-1",
    channel: "Email",
    recipient: RECIPIENT,
    subject: "Platform role",
    body: "Ada, your notes on the example ledger are the reason I wrote, including the hash you bound to each line.",
    noticeVersion: NOTICE,
    ...overrides,
  };
}

function createLedger(overrides: Partial<LedgerOptions> = {}): ApprovalLedger {
  return new ApprovalLedger({
    runMode: "demo",
    allowlist: RECIPIENT,
    killSwitch: false,
    channelCaps: { Email: 5, LinkedIn: 5 },
    now: () => "2026-11-20T18:53:00.000Z",
    ...overrides,
  });
}

test("test_send_refused_without_matching_body_hash", () => {
  const original = message();
  const ledger = createLedger({
    allowlist: `${original.recipient},ada.other@example.test`,
  });
  const approval = ledger.approveManual(original, ACTOR);
  assert.equal(approval.allowed, true);
  assert.equal(approval.reason, "approved");
  assert.equal(approval.bodyHash, exactBodyHash(original));

  const expected = createHash("sha256")
    .update(
      lengthPrefixed(original.channel) +
        lengthPrefixed(original.recipient.trim().toLocaleLowerCase()) +
        lengthPrefixed(sanitizeOutreachSubject(original.subject)) +
        lengthPrefixed(original.body) +
        lengthPrefixed(original.noticeVersion),
      "utf8",
    )
    .digest("hex");
  assert.equal(exactBodyHash(original), expected, "the ledger hash length-prefixes channel, recipient, subject, body, and notice");
  assert.notEqual(
    exactBodyHash(original),
    exactBodyHash({ ...original, body: `${original.body} Edited.` }),
  );

  const dirty = { ...original, subject: "Platform role\r\nBcc: attacker@example.test" };
  const sanitized = { ...original, subject: "Platform role Bcc: attacker@example.test" };
  assert.equal(exactBodyHash(dirty), exactBodyHash(sanitized));
  assert.notEqual(exactBodyHash(sanitized), exactBodyHash(original));

  const sent = ledger.decideSend(original, ACTOR);
  assert.equal(sent.allowed, true);
  assert.equal(sent.reason, "authorized");
  assert.equal(sent.bodyHash, exactBodyHash(original));

  const edits: Array<[string, ExactMessage]> = [
    ["body", { ...original, body: `${original.body} Edited.` }],
    ["subject", { ...original, subject: "Different subject" }],
    ["recipient", { ...original, recipient: "ada.other@example.test" }],
    ["channel", { ...original, channel: "LinkedIn" }],
    ["notice", { ...original, noticeVersion: "art14-lgpd-2026-11-21" }],
  ];
  for (const [label, edited] of edits) {
    const decision = ledger.decideSend(edited, ACTOR);
    assert.equal(decision.allowed, false, label);
    assert.equal(decision.reason, "body-hash-mismatch", label);
    assert.notEqual(decision.bodyHash, exactBodyHash(original), label);
  }

  const replay = ledger.decideSend(original, ACTOR);
  assert.equal(replay.allowed, false);
  assert.equal(replay.reason, "already-authorized");
  assert.equal(replay.bodyHash, exactBodyHash(original));
});

test("test_manual_approval_respects_allowlist", () => {
  const ledger = createLedger({
    runMode: "demo",
    allowlist: "tony.synthetic@example.test",
    channelCaps: { Email: 3 },
  });
  const allowed = message({ recipient: "tony.synthetic@example.test" });
  const blocked = message({
    messageId: "msg-other",
    recipient: "other.person@example.test",
  });

  const refused = ledger.approveManual(blocked, ACTOR);
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, "allowlist");
  assert.equal(
    ledger.auditLog().some((entry) => entry.kind === "manual-approval" && entry.outcome === "refused" && entry.reason === "allowlist"),
    true,
  );

  const batch = ledger.approveManualBatch([allowed, blocked], ACTOR);
  assert.deepEqual(batch.map((decision) => decision.allowed), [true, false]);
  assert.equal(batch[1]?.reason, "allowlist");
  assert.equal(ledger.decideSend(allowed, ACTOR).allowed, true);
  assert.equal(ledger.decideSend(blocked, ACTOR).reason, "allowlist");

  const openDemo = createLedger({ runMode: "demo", allowlist: "", channelCaps: { Email: 2 } });
  assert.equal(openDemo.approveManual(blocked, ACTOR).allowed, true);

  const policy = approvalPolicyFromEnv(
    { ARIA_MODE: "demo", ARIA_RECIPIENT_ALLOWLIST: "tony.synthetic@example.test" },
    "other.person@example.test",
  );
  assert.equal(policy.ok, false);
  if (!policy.ok) assert.equal(policy.reason, "allowlist");

  const approveRoute = readFileSync("src/app/api/outreach/approve/route.ts", "utf8");
  const policyAt = approveRoute.indexOf("approvalPolicyFromEnv");
  const rpcAt = approveRoute.indexOf('rpc("record_outreach_approval"');
  assert.ok(policyAt >= 0 && rpcAt > policyAt, "manual approval must consult the allowlist before it is recorded");
});

test("test_auto_mode_requires_qc_pass_bound_to_hash", async () => {
  const ledger = createLedger();
  const original = message();
  assert.equal(ledger.enableAutomatic(CAMPAIGN, "Email", ACTOR).allowed, true);
  assert.equal(ledger.sendMode(CAMPAIGN, "Email"), "automatic");
  assert.equal(ledger.sendMode(CAMPAIGN, "LinkedIn"), "manual");
  assert.equal(ledger.sendMode("campaign-synthetic-2", "Email"), "manual");

  assert.equal(ledger.approveManual(original, ACTOR).allowed, true);
  assert.equal(ledger.decideSend(original, ACTOR).reason, "qc-required");

  for (const evaluation of [
    { pass: true, rubricScore: 99, generic: true, reasons: ["boilerplate"] },
    { pass: true, rubricScore: MIN_QC_RUBRIC_SCORE - 1, generic: false, reasons: [] },
    { pass: false, rubricScore: 95, generic: false, reasons: ["rubric"] },
  ] satisfies QcEvaluation[]) {
    const rejected = ledger.recordQualityCheck(original, evaluation, ACTOR);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.reason, "qc-rejected");
    assert.equal(ledger.decideSend(original, ACTOR).reason, "qc-required");
  }

  const passed = ledger.recordQualityCheck(original, PASSING_QC, ACTOR);
  assert.equal(passed.allowed, true);
  assert.equal(passed.reason, "qc-passed");
  assert.equal(passed.bodyHash, exactBodyHash(original));
  const authorized = ledger.decideSend(original, ACTOR);
  assert.equal(authorized.allowed, true);
  assert.equal(authorized.reason, "authorized");
  assert.equal(authorized.bodyHash, exactBodyHash(original));

  const edited = { ...original, body: `${original.body} One more sentence about the example role.` };
  const mismatch = ledger.decideSend(edited, ACTOR);
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, "body-hash-mismatch");
  assert.notEqual(mismatch.bodyHash, exactBodyHash(original));

  const specific = message({
    messageId: "msg-specific",
    body: "Ada, the example ledger you published in 2024 is the piece I want to talk about, including the hash binding and the audit trail you kept.",
  });
  const fromAgent = await ledger.recordQualityCheckFromAgent(specific, stubQualityCheckAgent(), ACTOR);
  assert.equal(fromAgent.allowed, true);
  assert.equal(fromAgent.bodyHash, exactBodyHash(specific));
  assert.equal(ledger.decideSend(specific, ACTOR).allowed, true);

  const generic = message({
    messageId: "msg-generic",
    body: "I hope this email finds you well. I came across your profile and wanted to reach out about an exciting opportunity.",
  });
  const genericResult = await ledger.recordQualityCheckFromAgent(generic, stubQualityCheckAgent(), ACTOR);
  assert.equal(genericResult.allowed, false);
  assert.equal(genericResult.reason, "qc-rejected");
  assert.equal(ledger.decideSend(generic, ACTOR).reason, "qc-required");
});

test("test_auto_mode_off_by_default", () => {
  const ledger = createLedger();
  const original = message();
  assert.equal(ledger.sendMode(CAMPAIGN, "Email"), "manual");
  assert.equal(ledger.sendMode(CAMPAIGN, "LinkedIn"), "manual");

  const recorded = ledger.recordQualityCheck(original, PASSING_QC, ACTOR);
  assert.equal(recorded.allowed, true);
  const send = ledger.decideSend(original, ACTOR);
  assert.equal(send.allowed, false);
  assert.equal(send.reason, "approval-required");
});

test("test_kill_switch_blocks_all_sends", () => {
  const manual = createLedger({ killSwitch: true });
  const original = message();
  assert.equal(manual.approveManual(original, ACTOR).allowed, true);
  assert.equal(manual.decideSend(original, ACTOR).allowed, false);
  assert.equal(manual.decideSend(original, ACTOR).reason, "kill-switch");

  const automatic = createLedger({ killSwitch: true });
  automatic.enableAutomatic(CAMPAIGN, "Email", ACTOR);
  automatic.recordQualityCheck(original, PASSING_QC, ACTOR);
  assert.equal(automatic.decideSend(original, ACTOR).reason, "kill-switch");

  const toggled = createLedger({ killSwitch: false });
  toggled.approveManual(original, ACTOR);
  assert.equal(toggled.decideSend(original, ACTOR).allowed, true);
  assert.equal(toggled.setKillSwitch(true, ACTOR).allowed, true);
  assert.equal(toggled.decideSend(original, ACTOR).reason, "kill-switch");

  toggled.enableAutomatic(CAMPAIGN, "LinkedIn", ACTOR);
  const linkedin = message({ messageId: "msg-linkedin", channel: "LinkedIn" });
  toggled.recordQualityCheck(linkedin, PASSING_QC, ACTOR);
  assert.equal(toggled.decideSend(linkedin, ACTOR).reason, "kill-switch");
  assert.equal(toggled.setKillSwitch(false, ACTOR).allowed, true);
  assert.equal(toggled.decideSend(original, ACTOR).reason, "already-authorized");

  for (const [label, env] of [
    ["1", { ARIA_SEND_KILL_SWITCH: "1" }],
    ["true", { ARIA_SEND_KILL_SWITCH: "true" }],
    ["on", { ARIA_SEND_KILL_SWITCH: "ON" }],
  ] as const) {
    const blocked = sendPolicyFromEnv(env, RECIPIENT);
    assert.equal(blocked.ok, false, label);
    if (!blocked.ok) assert.equal(blocked.reason, "kill-switch", label);
  }
  assert.equal(sendPolicyFromEnv({}, RECIPIENT).ok, true);
  assert.equal(sendPolicyFromEnv({ ARIA_SEND_KILL_SWITCH: "0" }, RECIPIENT).ok, true);

  const sendRoute = readFileSync("src/app/api/outreach/send/route.ts", "utf8");
  const dispatcher = readFileSync("src/lib/dispatch-outbound.ts", "utf8");
  assert.ok(sendRoute.includes("sendPolicyFromEnv"));
  assert.ok(dispatcher.includes("sendPolicyFromEnv"));
  assert.ok(sendRoute.indexOf("sendPolicyFromEnv") < sendRoute.indexOf("performEmailSend("));
  assert.ok(dispatcher.indexOf("sendPolicyFromEnv") < dispatcher.indexOf("performEmailSend("));

  const approvalSources = readdirSync("src/lib/approval").map((file) => readFileSync(`src/lib/approval/${file}`, "utf8")).join("\n");
  assert.doesNotMatch(approvalSources, /performEmailSend|linkedin-channel|linkedin\.com/);
});

test("test_per_channel_cap_enforced", () => {
  const ledger = createLedger({
    allowlist: RECIPIENT,
    channelCaps: { Email: 1, LinkedIn: 1 },
  });
  const emailOne = message({ messageId: "email-1" });
  const emailTwo = message({
    messageId: "email-2",
    body: `${emailOne.body} Second note, still about the example ledger.`,
  });
  const linkedin = message({
    messageId: "li-1",
    channel: "LinkedIn",
    subject: "Example note",
  });
  for (const item of [emailOne, emailTwo, linkedin]) {
    assert.equal(ledger.approveManual(item, ACTOR).allowed, true, item.messageId);
  }

  assert.equal(ledger.decideSend(emailOne, ACTOR).allowed, true);
  const secondEmail = ledger.decideSend(emailTwo, ACTOR);
  assert.equal(secondEmail.allowed, false);
  assert.equal(secondEmail.reason, "channel-cap");
  assert.equal(
    ledger.decideSend(message({ messageId: "email-3", body: `${emailOne.body} Third note.` }), ACTOR).reason,
    "approval-required",
  );
  const cappedAgain = ledger.decideSend(emailTwo, ACTOR);
  assert.equal(cappedAgain.reason, "channel-cap");
  assert.equal(ledger.decideSend(linkedin, ACTOR).allowed, true);
});

test("test_allowlist_mode_blocks_non_allowlisted_in_test", () => {
  const ledger = createLedger({
    runMode: "test",
    allowlist: "allowed.person@example.test",
    channelCaps: { Email: 3 },
  });
  const allowed = message({ recipient: "Allowed.Person@example.test" });
  const blocked = message({ messageId: "msg-2", recipient: "other.person@example.test" });

  assert.equal(ledger.approveManual(allowed, ACTOR).allowed, true);
  assert.equal(ledger.approveManual(blocked, ACTOR).reason, "allowlist");
  assert.equal(ledger.decideSend(blocked, ACTOR).reason, "allowlist");
  assert.equal(ledger.decideSend(allowed, ACTOR).allowed, true);

  const closed = createLedger({ runMode: "test", allowlist: " , ; ", channelCaps: { Email: 3 } });
  assert.equal(closed.approveManual(allowed, ACTOR).reason, "allowlist");
  assert.equal(closed.decideSend(allowed, ACTOR).reason, "allowlist");

  const live = approvalPolicyFromEnv(
    { ARIA_MODE: "live", ARIA_RECIPIENT_ALLOWLIST: "allowed.person@example.test" },
    "allowed.person@example.test",
  );
  assert.equal(live.ok, false);
  if (!live.ok) assert.equal(live.reason, "live-refused");
});

test("test_audit_log_records_every_decision", () => {
  const ledger = createLedger({ allowlist: RECIPIENT, channelCaps: { Email: 5 } });
  const original = message();
  const blocked = message({ messageId: "msg-blocked", recipient: "other.person@example.test" });
  const decisions = [
    ledger.approveManual(original, ACTOR),
    ledger.approveManual(blocked, ACTOR),
    ledger.decideSend(original, ACTOR),
    ledger.decideSend({ ...original, body: `${original.body} Edited.` }, ACTOR),
    ledger.enableAutomatic(CAMPAIGN, "Email", ACTOR),
    ledger.recordQualityCheck(original, { ...PASSING_QC, generic: true }, ACTOR),
    ledger.recordQualityCheck(message({ messageId: "msg-qc" }), PASSING_QC, ACTOR),
    ledger.setKillSwitch(true, ACTOR),
    ledger.decideSend(original, ACTOR),
  ];
  assert.equal(decisions.length, 9);

  const log = ledger.auditLog();
  assert.equal(log.length, decisions.length);
  assert.deepEqual(log.map((entry) => entry.seq), decisions.map((_, index) => index + 1));
  assert.deepEqual(
    log.map((entry) => entry.outcome),
    decisions.map((decision) => (decision.allowed ? "allowed" : "refused")),
  );
  assert.deepEqual(
    log.map((entry) => entry.reason),
    decisions.map((decision) => decision.reason),
  );
  assert.ok(log.some((entry) => entry.outcome === "allowed"));
  assert.ok(log.some((entry) => entry.outcome === "refused"));
  for (const entry of log) {
    assert.equal(entry.at, "2026-11-20T18:53:00.000Z");
    assert.equal(entry.actor, ACTOR);
    assert.ok(entry.kind);
    assert.ok(entry.reason);
    assert.equal(Object.isFrozen(entry), true);
  }

  const snapshot = ledger.auditLog();
  snapshot.pop();
  assert.equal(ledger.auditLog().length, decisions.length);

  const dumped = JSON.stringify(ledger.auditLog());
  assert.equal(dumped.includes(RECIPIENT), false);
  assert.equal(dumped.includes("other.person@example.test"), false);
  assert.equal(dumped.includes(original.body), false);
  assert.equal(dumped.includes(original.subject), false);
});
