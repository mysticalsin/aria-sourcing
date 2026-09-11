import { agentActivity, floorRollup } from "../src/lib/floor";
import { pickResponderIndex, seatsToOfficeAgents } from "../src/lib/floor3d";
import { buildSeedState } from "../src/lib/seed";
import { SEED_NOW } from "../src/lib/utils";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const s = buildSeedState();
const seat = (id: string) => s.seats.find((x) => x.id === id)!;
// Pin "now" to the seed reference time so warmup-stage assertions stay deterministic
// and do not drift as the real calendar advances past SEED_NOW.
const NOW = SEED_NOW.getTime();

const maya = agentActivity(seat("seat_maya"), s, NOW);
ok("warmed active agent is working", ["sourcing", "outreach", "booking"].includes(maya.state));
ok("working agent has a label", maya.label.length > 0);
ok("working agent is busy (animates)", maya.busy === true);
ok("contacted count is a number", typeof maya.contacted === "number" && maya.contacted >= 0);

const aisha = agentActivity(seat("seat_aisha"), s, NOW); // warmup day ~5
ok("warming agent state = warming", aisha.state === "warming");

const lucas = agentActivity(seat("seat_lucas"), s, NOW); // bounce 0.068 > 5% → auto-pause
ok("high-bounce agent is paused", lucas.state === "paused");

// determinism: same inputs → same activity
const maya2 = agentActivity(seat("seat_maya"), s, NOW);
ok("activity is deterministic", maya.label === maya2.label && maya.detail === maya2.detail);

const roll = floorRollup(s.seats, s);
ok("rollup total = seat count", roll.total === s.seats.length);
ok("rollup buckets within total", roll.working + roll.warming + roll.paused <= roll.total);
ok("contactedToday = sum of sentToday", roll.contactedToday === s.seats.reduce((a, x) => a + x.sentToday, 0));
ok("at least one paused (lucas)", roll.paused >= 1);


// Assigned-campaign preference (not a hash lottery across the whole fleet).
{
  const clone = structuredClone(s);
  const mayaSeat = clone.seats.find((x) => x.id === "seat_maya")!;
  mayaSeat.assignedCampaignIds = ["camp_seed_design"];
  const act = agentActivity(mayaSeat, clone, NOW);
  const design = clone.campaigns.find((c) => c.id === "camp_seed_design")!;
  ok("assigned campaign title surfaces", act.detail === design.title);
}

{
  const e = {
    kind: "send" as const,
    candidateName: "Ada",
    campaignId: "camp_seed_backend",
    seatId: "seat_diego",
    at: NOW,
  };
  const ids = ["seat_maya", "seat_diego", "seat_aisha"];
  ok("pulse prefers event seatId", pickResponderIndex(e, ids.length, ids) === 1);
  ok(
    "pulse falls back without seatId",
    typeof pickResponderIndex({ ...e, seatId: undefined }, ids.length, ids) === "number",
  );
}

{
  const agents = seatsToOfficeAgents(s.seats, s);
  ok("office agents = seat count", agents.length === s.seats.length);
  const hinted = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "help_requested" }]]),
  );
  const maya = hinted.find((a) => a.id === "seat_maya")!;
  ok("help_requested overlays error", maya.status === "error");
  ok("help_requested subtitle", maya.subtitle === "Needs Take control");

  const healthy = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "ready", sessionHealthy: true }]]),
  ).find((a) => a.id === "seat_maya")!;
  ok("ready+healthy overlays working", healthy.status === "working");
  ok("ready+healthy subtitle", healthy.subtitle === "LinkedIn session healthy");

  const unverified = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "ready", sessionHealthy: null }]]),
  ).find((a) => a.id === "seat_maya")!;
  ok("ready+null overlays idle unverified", unverified.status === "idle");
  ok(
    "ready+null subtitle asks Take control",
    unverified.subtitle.includes("unverified"),
  );

  const liSeat = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (liSeat) {
    const missing = seatsToOfficeAgents(s.seats, s, new Map()).find((a) => a.id === liSeat.id)!;
    ok(
      "LinkedIn seat without VM row is idle",
      missing.status === "idle" && /Browser Computer|not on host/.test(missing.subtitle),
    );
  }
}

console.log(`RESULT floor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
