/* ============================================================================
   tests/rei-autopilot-send.mts — REI autopilot first-touch decision matrix
   ========================================================================== */

import {
  decideReiAutopilotSend,
  linkedInMayAutoDeliver,
} from "../src/lib/rei-autopilot-send";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const base = {
  sequencesArmed: true,
  criticsPassed: true,
  qualityStatus: "ready",
  hasLiveMailbox: true,
  hasLiveWhatsApp: true,
  heyReachConfigured: true,
  linkedInVendorConfigured: false,
} as const;

ok(
  "autopilot off → human review",
  decideReiAutopilotSend({ ...base, autopilotEnabled: false, channel: "Email" }).mode === "human_review",
);

ok(
  "autopilot on + email live → dispatch",
  decideReiAutopilotSend({ ...base, autopilotEnabled: true, channel: "Email" }).mode ===
    "autopilot_dispatch",
);

ok(
  "no mailbox → human review for email",
  decideReiAutopilotSend({
    ...base,
    autopilotEnabled: true,
    channel: "Email",
    hasLiveMailbox: false,
  }).mode === "human_review",
);

ok(
  "LinkedIn + HeyReach → dispatch",
  decideReiAutopilotSend({ ...base, autopilotEnabled: true, channel: "LinkedIn" }).mode ===
    "autopilot_dispatch",
);

const li = decideReiAutopilotSend({ ...base, autopilotEnabled: true, channel: "LinkedIn" });
ok("LinkedIn HeyReach may auto deliver", linkedInMayAutoDeliver(li));

ok(
  "LinkedIn without HeyReach/vendor → human review",
  decideReiAutopilotSend({
    ...base,
    autopilotEnabled: true,
    channel: "LinkedIn",
    heyReachConfigured: false,
    linkedInVendorConfigured: false,
  }).mode === "human_review",
);

ok(
  "critics blocked → human review",
  decideReiAutopilotSend({
    ...base,
    autopilotEnabled: true,
    channel: "Email",
    criticsPassed: false,
    qualityStatus: "blocked",
  }).mode === "human_review",
);

ok(
  "needs_review even with criticsPassed → human review",
  decideReiAutopilotSend({
    ...base,
    autopilotEnabled: true,
    channel: "Email",
    criticsPassed: true,
    qualityStatus: "needs_review",
  }).mode === "human_review",
);

ok(
  "SMS always human review",
  decideReiAutopilotSend({ ...base, autopilotEnabled: true, channel: "SMS" }).mode ===
    "human_review",
);

ok(
  "sequences disarmed → human review",
  decideReiAutopilotSend({
    ...base,
    autopilotEnabled: true,
    sequencesArmed: false,
    channel: "WhatsApp",
  }).mode === "human_review",
);

console.log(`RESULT rei-autopilot-send: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
