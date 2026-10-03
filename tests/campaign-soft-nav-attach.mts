/**
 * Soft-nav / go-live / agents panel must not paint foreign campaign VMs.
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

const mergeSrc = readFileSync(
  new URL("../src/lib/campaign-go-live.ts", import.meta.url),
  "utf8",
);
ok(
  "mergeDurableCampaignSeatsForGoLive does not append campaignId into assigned",
  !/assignedCampaignIds[\s\S]{0,200}campaignId,\s*\]/.test(mergeSrc) &&
    /Array\.isArray\(row\.assignedCampaignIds\) \? row\.assignedCampaignIds/.test(mergeSrc),
);

const checklist = readFileSync(
  new URL("../src/components/campaigns/campaign-go-live-checklist.tsx", import.meta.url),
  "utf8",
);
ok(
  "go-live checklist clears durableSeats on campaign change / poll fail / catch",
  /setDurableSeats\(undefined\)/.test(checklist) &&
    (checklist.match(/setDurableSeats\(undefined\)/g) ?? []).length >= 3,
);

const agents = readFileSync(
  new URL("../src/components/campaigns/campaign-agents-panel.tsx", import.meta.url),
  "utf8",
);
ok(
  "campaign agents health badges scoped to campaignSeats",
  /campaignComputers\.filter\(\(c\) => c\.sessionHealthy === true\)/.test(agents) &&
    /setComputers\(\[\]\)/.test(agents),
);

console.log(`RESULT campaign-soft-nav-attach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
