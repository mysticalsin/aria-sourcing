/* ============================================================================
   tests/stable-outreach-message-id.mts
   ========================================================================== */

import { stableOutreachMessageId } from "../src/lib/utils";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const a = stableOutreachMessageId({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  campaignId: "camp-1",
  candidateId: "cand-1",
  channel: "Email",
  sequenceStep: 1,
  trigger: "first_touch",
});
const b = stableOutreachMessageId({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  campaignId: "camp-1",
  candidateId: "cand-1",
  channel: "Email",
  sequenceStep: 1,
  trigger: "first_touch",
});
const c = stableOutreachMessageId({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  campaignId: "camp-1",
  candidateId: "cand-1",
  channel: "Email",
  sequenceStep: 2,
  trigger: "inbound_classify",
});

ok("deterministic", a === b);
ok("msg_ prefix", a.startsWith("msg_"));
ok("reply step differs from first-touch", a !== c);

console.log(`RESULT stable-outreach-message-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
