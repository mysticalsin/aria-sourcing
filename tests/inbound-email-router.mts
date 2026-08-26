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

console.log(`RESULT inbound-email-router: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
