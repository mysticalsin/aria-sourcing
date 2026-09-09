/* tests/campaign-go-live.mts — area: campaigns / anti-bot
 * Unit checks for evaluateCampaignGoLive checklist.
 * Run: tsx tests/campaign-go-live.mts
 */
import { evaluateCampaignGoLive, campaignBrowserSeats } from "../src/lib/campaign-go-live";
import { LINKEDIN_BROWSER_SEAT_DEFAULTS } from "../src/lib/send-pacing";
import { defaultSendWindow } from "../src/lib/fleet";
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

function liSeat(partial: Partial<AgentSeat> = {}): AgentSeat {
  return {
    id: "seat_java_vm_01",
    name: "Java · Agent 01",
    operatorEmail: "java@example.test",
    provider: "LinkedIn Browser Computer",
    status: "active",
    mode: "live",
    domainVerified: true,
    dailyLimit: LINKEDIN_BROWSER_SEAT_DEFAULTS.dailyLimit,
    warmup: true,
    warmupStartCap: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStartCap,
    warmupStepPerDay: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStepPerDay,
    warmupStartedAt: new Date().toISOString(),
    minGapMinutes: LINKEDIN_BROWSER_SEAT_DEFAULTS.minGapMinutes,
    sendWindow: defaultSendWindow(),
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "",
    computerId: "comp_java_01",
    linkedinDeliveryBackend: "browser-computer",
    assignedCampaignIds: ["camp_seed_backend"],
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

const campaignId = "camp_seed_backend";

ok(
  "campaignBrowserSeats finds attached LI browser seats",
  campaignBrowserSeats([liSeat()], campaignId).length === 1,
);

const dryOn = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: true, minScoreToContact: 80 },
  seats: [liSeat()],
  computers: [
    {
      computerId: "comp_java_01",
      seatId: "seat_java_vm_01",
      status: "ready",
      control: "bot",
      sessionHealthy: true,
    },
  ],
});
ok("not ready when dry-run on", dryOn.ready === false);
ok(
  "dry_run_off check fails",
  dryOn.checks.find((c) => c.id === "dry_run_off")?.ok === false,
);

const ready = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: false, minScoreToContact: 80 },
  seats: [liSeat()],
  computers: [
    {
      computerId: "comp_java_01",
      seatId: "seat_java_vm_01",
      status: "ready",
      control: "bot",
      sessionHealthy: true,
    },
  ],
  candidate: { matchScore: 88 },
});
ok("ready when all checks pass", ready.ready === true);

const help = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: false, minScoreToContact: 80 },
  seats: [liSeat()],
  computers: [
    {
      computerId: "comp_java_01",
      status: "help_requested",
      control: "bot",
      sessionHealthy: false,
    },
  ],
});
ok(
  "session_healthy fails on help_requested",
  help.checks.find((c) => c.id === "session_healthy")?.ok === false,
);

const human = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: false, minScoreToContact: 80 },
  seats: [liSeat()],
  computers: [
    {
      computerId: "comp_java_01",
      status: "ready",
      control: "human",
      sessionHealthy: true,
    },
  ],
});
ok(
  "seat_not_human_held fails while human has control",
  human.checks.find((c) => c.id === "seat_not_human_held")?.ok === false,
);

const low = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: false, minScoreToContact: 80 },
  seats: [liSeat()],
  computers: [
    {
      computerId: "comp_java_01",
      status: "ready",
      control: "bot",
      sessionHealthy: true,
    },
  ],
  candidate: { matchScore: 40 },
});
ok(
  "candidate_above_floor fails below floor",
  low.checks.find((c) => c.id === "candidate_above_floor")?.ok === false,
);

const none = evaluateCampaignGoLive({
  campaignId,
  settings: { dryRunMode: false, minScoreToContact: 80 },
  seats: [],
});
ok("browser_seat_attached fails with no seats", none.checks.find((c) => c.id === "browser_seat_attached")?.ok === false);

console.log(`campaign-go-live: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
