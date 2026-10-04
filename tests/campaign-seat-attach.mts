/* Seat ↔ campaign attach for N Browser Computer isolation */
import {
  isBrowserComputerSeat,
  seatAttachedToCampaign,
} from "../src/lib/campaign-seat-attach";
import type { AgentSeat } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const bc = {
  provider: "LinkedIn Browser Computer",
  assignedCampaignIds: [] as string[],
} as Pick<AgentSeat, "provider" | "linkedinDeliveryBackend" | "assignedCampaignIds">;

ok("empty BC is browser seat", isBrowserComputerSeat(bc));
ok("empty BC not attached", seatAttachedToCampaign(bc, "camp_1") === false);
ok(
  "BC with campaign attached",
  seatAttachedToCampaign({ ...bc, assignedCampaignIds: ["camp_1"] }, "camp_1") === true,
);
ok(
  "BC attached elsewhere not this campaign",
  seatAttachedToCampaign({ ...bc, assignedCampaignIds: ["camp_other"] }, "camp_1") === false,
);

const email = {
  provider: "Microsoft Graph",
  assignedCampaignIds: [] as string[],
} as Pick<AgentSeat, "provider" | "linkedinDeliveryBackend" | "assignedCampaignIds">;
ok("empty email is shared pool", seatAttachedToCampaign(email, "camp_1") === true);
ok(
  "email assigned elsewhere excluded",
  seatAttachedToCampaign({ ...email, assignedCampaignIds: ["camp_other"] }, "camp_1") === false,
);

const backendOnly = {
  provider: "SendGrid" as const,
  linkedinDeliveryBackend: "browser-computer" as const,
  assignedCampaignIds: [] as string[],
};
ok("backend browser-computer empty not attached", seatAttachedToCampaign(backendOnly, "camp_1") === false);

console.log(`RESULT campaign-seat-attach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
