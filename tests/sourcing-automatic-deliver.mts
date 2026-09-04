/* ==========================================================================
   tests/sourcing-automatic-deliver.mts
   Shortlist → allocateBatch → automatic LinkedIn seat preference.
   ========================================================================== */

import {
  planShortlistAutomaticDeliver,
  preferLinkedInAutomaticSeats,
} from "../src/lib/sourcing-automatic-deliver";
import { defaultFleetSettings } from "../src/lib/fleet";
import type { AgentSeat, Candidate } from "../src/lib/types";
import { isLinkedInAutomaticProvider } from "../src/lib/linkedin-channel";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("vendor is automatic provider", isLinkedInAutomaticProvider("LinkedIn Vendor API"));
ok(
  "browser computer is automatic provider",
  isLinkedInAutomaticProvider("LinkedIn Browser Computer"),
);
ok(
  "assisted manual is not automatic",
  isLinkedInAutomaticProvider("LinkedIn Assisted Manual") === false,
);

function seat(partial: Partial<AgentSeat> & Pick<AgentSeat, "id" | "provider">): AgentSeat {
  return {
    name: partial.name ?? partial.id,
    operatorEmail: "op@example.com",
    status: "active",
    mode: "live",
    domainVerified: true,
    dailyLimit: 20,
    warmup: false,
    warmupStartCap: 5,
    warmupStepPerDay: 2,
    warmupStartedAt: new Date().toISOString(),
    minGapMinutes: 10,
    sendWindow: { startHour: 8, endHour: 18, timezone: "UTC", days: [1, 2, 3, 4, 5] },
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "x",
    createdAt: new Date().toISOString(),
    ...partial,
  } as AgentSeat;
}

const emailSeat = seat({ id: "email", provider: "Microsoft Graph", name: "Email" });
const liSeat = seat({ id: "li", provider: "LinkedIn Browser Computer", name: "LI" });
const ordered = preferLinkedInAutomaticSeats([emailSeat, liSeat], {
  linkedinUrl: "https://linkedin.com/in/a",
});
ok("prefer puts LinkedIn automatic seat first", ordered[0]?.id === "li");

const cand = {
  id: "c1",
  campaignId: "camp",
  name: "Ada",
  email: "ada@example.com",
  avatarInitials: "A",
  currentTitle: "BA",
  currentCompany: "X",
  location: "Montreal",
  timezone: "America/Toronto",
  linkedinUrl: "https://linkedin.com/in/ada",
  githubUrl: "",
  matchScore: 90,
  stage: "New",
  skills: [],
  complianceFlags: { doNotContact: false, unsubscribed: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Candidate;

const plan = planShortlistAutomaticDeliver({
  pool: [cand],
  seats: [emailSeat, liSeat],
  ledger: [],
  suppression: [],
  fleet: defaultFleetSettings(),
  deliveryMode: "automatic",
});
ok(
  "automatic plan routes to LinkedIn computer",
  plan.automaticLinkedIn.some((a) => a.seatId === "li") ||
    plan.allocation.assignments.some((a) => a.seatId === "li"),
);
ok("deliveryModeAutomatic true", plan.deliveryModeAutomatic === true);

const manual = planShortlistAutomaticDeliver({
  pool: [cand],
  seats: [liSeat],
  ledger: [],
  suppression: [],
  fleet: defaultFleetSettings(),
  deliveryMode: "manual",
});
ok("manual mode keeps automaticLinkedIn empty", manual.automaticLinkedIn.length === 0);

console.log(`RESULT sourcing-automatic-deliver: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
