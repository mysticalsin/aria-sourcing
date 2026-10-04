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

ok(
  "approve with seatId also requires seatAttachedToCampaign",
  /LinkedIn seat is not attached to this campaign/.test(store) &&
    /seatAttachedToCampaign\(stamped,\s*campaign\.id\)/.test(store),
);

ok(
  "unscoped allocate draft loop skips seats not attached to candidate campaign",
  /if \(seat && !seatAttachedToCampaign\(seat, campaign\.id\)\) continue;/.test(store),
);

ok(
  "generateOutreachFor refuses foreign/unattached resolvedSeatId",
  /resolvedSeatId && \(!seat \|\| !seatAttachedToCampaign\(seat, campaign\.id\)\)/.test(store) &&
    /const generateOutreachFor = useCallback[\s\S]*?resolvedSeatId && \(!seat \|\| !seatAttachedToCampaign\(seat, campaign\.id\)\)/.test(
      store,
    ),
);

ok(
  "generateOutreachLive refuses foreign/unattached resolvedSeatId",
  /const generateOutreachLive = useCallback[\s\S]*?resolvedSeatId && \(!seat \|\| !seatAttachedToCampaign\(seat, campaign\.id\)\)/.test(
    store,
  ),
);

ok(
  "Aria draft verb uses allocateOutreach (N>1 safe)",
  /step\.verb === "draft"[\s\S]*?allocateOutreach\(\{\s*campaignId\s*\}\)/.test(store),
);

ok(
  "draftFollowUpFor refuses foreign/unattached resolvedSeatId",
  /const draftFollowUpFor = useCallback[\s\S]*?resolvedSeatId && \(!seat \|\| !seatAttachedToCampaign\(seat, campaign\.id\)\)/.test(
    store,
  ),
);

ok(
  "draftRecontactFor refuses foreign/unattached resolvedSeatId",
  /const draftRecontactFor = useCallback[\s\S]*?resolvedSeatId && \(!seat \|\| !seatAttachedToCampaign\(seat, campaign\.id\)\)/.test(
    store,
  ),
);

ok(
  "draftReplyResponse gates prior seat with seatAttachedToCampaign",
  /const draftReplyResponse[\s\S]*?seatAttachedToCampaign\(x,\s*campaign\.id\)/.test(store),
);

ok(
  "confirmManualSend requires seatAttachedToCampaign for Vendor/Assisted",
  /const confirmManualSend = useCallback[\s\S]*?seatAttachedToCampaign\(linkedInSeat,\s*campaign\.id\)/.test(
    store,
  ),
);

console.log(`RESULT campaign-allocate-approve-attach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
