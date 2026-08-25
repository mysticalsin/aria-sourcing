import {
  decideInboundClassifyEnqueue,
  decideReplyDraftSuccessor,
  isPositiveReplyIntent,
} from "../src/lib/inbound-reply-trigger";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("skips when record not ok", decideInboundClassifyEnqueue({ ok: false }).enqueue === false);
ok(
  "skips duplicates (no token re-burn on provider retry)",
  decideInboundClassifyEnqueue({ ok: true, inbound_id: "inb-1", duplicate: true }).enqueue === false,
);
ok(
  "skips missing inbound id",
  decideInboundClassifyEnqueue({ ok: true, duplicate: false }).enqueue === false,
);

const enq = decideInboundClassifyEnqueue({
  ok: true,
  inbound_id: "inb-42",
  duplicate: false,
});
ok("enqueues classify for new inbound", enq.enqueue === true);
if (enq.enqueue) {
  ok("kind is inbound_classify", enq.kind === "inbound_classify");
  ok("idempotency is reply:<id>", enq.idempotencyKey === "reply:inb-42");
  ok("payload carries inboundId only", enq.payload.inboundId === "inb-42");
  ok("priority is high (80)", enq.priority === 80);
}

ok("INTERESTED is positive", isPositiveReplyIntent("INTERESTED"));
ok("QUALIFIED_INTEREST is positive", isPositiveReplyIntent("QUALIFIED_INTEREST"));
ok("OOO is not positive", !isPositiveReplyIntent("OOO"));

ok(
  "no draft without entitlement",
  decideReplyDraftSuccessor({
    intent: "INTERESTED",
    campaignId: "camp-1",
    candidateId: "cand-1",
  }) === null,
);
ok(
  "no draft without correlation",
  decideReplyDraftSuccessor({
    intent: "INTERESTED",
    entitledApproverId: "user-1",
  }) === null,
);

const draft = decideReplyDraftSuccessor({
  intent: "QUALIFIED_INTEREST",
  campaignId: "camp-1",
  candidateId: "cand-1",
  entitledApproverId: "user-1",
});
ok("draft successor for positive + entitled", draft !== null);
ok("draft kind draft_generate", draft?.kind === "draft_generate");
ok(
  "draft idempotency scoped to campaign+candidate",
  draft?.idempotencyKey === "draft:reply:camp-1:cand-1",
);
ok("approvalSource autopilot_reply", draft?.payload.approvalSource === "autopilot_reply");

console.log(`RESULT inbound-reply-trigger: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
