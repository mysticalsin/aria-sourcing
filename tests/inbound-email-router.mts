import assert from "node:assert/strict";
import { routeInboundEmail } from "../src/lib/inbound-email-router";
import { decideInboundClassifyEnqueue } from "../src/lib/inbound-reply-trigger";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "classify enqueue unchanged for replies",
  decideInboundClassifyEnqueue({ ok: true, inbound_id: "x", duplicate: false }).enqueue === true,
);

ok(
  "mantu need email routes to requisition_parse",
  routeInboundEmail({
    record: { ok: true, inbound_id: "need-1", duplicate: false },
    from: "noreply@mantu.example",
    subject: "This need is now ACTIVE: Engineer",
    body: "Role: Engineer\nLocation: Paris\nSkills: Java",
    mailbox: "talent@mantu.com",
  }).route === "hiring_need" &&
    routeInboundEmail({
      record: { ok: true, inbound_id: "need-1", duplicate: false },
      from: "noreply@mantu.example",
      subject: "This need is now ACTIVE: Engineer",
      body: "Role: Engineer\nLocation: Paris\nSkills: Java",
      mailbox: "talent@mantu.com",
    }).route === "hiring_need",
);

ok(
  "body-only hiring request routes to hiring_need",
  routeInboundEmail({
    record: { ok: true, inbound_id: "need-body", duplicate: false },
    from: "hm@acme.example",
    subject: "FW: please review",
    body: "Please open a hiring request for a Backend Engineer in Lyon.",
    mailbox: "talent@mantu.com",
  }).route === "hiring_need",
);

ok(
  "ambiguous non-reply non-need stays idle (route none)",
  routeInboundEmail({
    record: { ok: true, inbound_id: "noise-1", duplicate: false },
    from: "news@vendor.example",
    subject: "Weekly product digest",
    body: "Here is your newsletter for the week.",
    mailbox: "talent@mantu.com",
  }).route === "none",
);

ok(
  "In-Reply-To without need keywords routes to reply_classify",
  routeInboundEmail({
    record: { ok: true, inbound_id: "reply-1", duplicate: false },
    from: "candidate@example.com",
    subject: "Thanks for reaching out",
    body: "Happy to chat next week.",
    mailbox: "talent@mantu.com",
    inReplyTo: "<msg-1@aria>",
  }).route === "reply_classify",
);

console.log(`RESULT inbound-email-router: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
