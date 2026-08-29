/* ============================================================================
   tests/whatsapp-inbound-autopilot.mts — source contract for WA inbound Autopilot queue
   ========================================================================== */

import { readFileSync } from "fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const inbound = readFileSync(new URL("../src/lib/whatsapp-inbound.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../src/app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");

ok("loads workspace Autopilot arming", /loadWorkspaceAutopilotArmed/.test(inbound));
ok("passes entitlement into decideAutopilot", /autopilotEnabled:\s*arm\.entitled/.test(inbound));
ok("mints autopilot_critics when eligible", /mint_autopilot_critics_approval/.test(inbound));
ok("queues eligible replies", /status:\s*"queued"/.test(inbound));
ok("still has blocked human-review fallback", /status:\s*"blocked"/.test(inbound));
ok("dispatches after queue", /dispatchDue/.test(inbound));
ok("webhook comment documents Autopilot exception", /Autopilot ON \+ Sequences/.test(webhook));

console.log(`RESULT whatsapp-inbound-autopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
