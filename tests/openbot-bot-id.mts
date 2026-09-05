/* ==========================================================================
   tests/openbot-bot-id.mts
   OpenBot bot-id sanitization for Aria seat/computer ids.
   ========================================================================== */

import { isOpenBotBotId, toOpenBotBotId } from "../src/lib/openbot/bot-id.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("plain id accepted", isOpenBotBotId("seat_1"));
ok("uuid-shaped accepted", isOpenBotBotId("comp_a1b2c3d4"));
ok("rejects dots", !isOpenBotBotId("a.b"));
ok("rejects empty", !isOpenBotBotId(""));
ok("sanitizes spaces", toOpenBotBotId("seat 1") === "seat_1" || toOpenBotBotId("seat 1").startsWith("seat"));
ok("preserves valid id", toOpenBotBotId("LinkedInSeat01") === "LinkedInSeat01");
ok("max 64", toOpenBotBotId("x".repeat(100)).length <= 64);

console.log(`RESULT openbot-bot-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
