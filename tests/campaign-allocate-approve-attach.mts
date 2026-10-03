/**
 * N-agent allocate/approve must not fall back onto unattached desks.
 * Source contracts — allocate/approve live inside the Zustand provider.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

ok(
  "allocateOutreach never falls back to all activeSeats when campaign-scoped",
  !/seatPool\s*=\s*campaignSeats\.length\s*>\s*0\s*\?\s*campaignSeats\s*:\s*activeSeats/.test(store) &&
    /const seatPool = campaignSeats;/.test(store),
);

ok(
  "approve LinkedIn seat stamp uses seatAttachedToCampaign (not liLive.length===1)",
  /seatAttachedToCampaign\(x,\s*campaign\.id\)/.test(store) &&
    !/liLive\.length\s*===\s*1\s*\?\s*liLive\[0\]/.test(store) &&
    !/soleBrowser\s*\?\?\s*\(liLive/.test(store),
);

ok(
  "approve empty-seatId path filters isLinkedInAutomaticProvider + attach",
  /isLinkedInAutomaticProvider\(x\.provider\)\s*&&\s*seatAttachedToCampaign\(x,\s*campaign\.id\)/.test(
    store,
  ),
);

console.log(`RESULT campaign-allocate-approve-attach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
