import { agentActivity, floorRollup } from "../src/lib/floor";
import { buildSeedState } from "../src/lib/seed";
import { SEED_NOW } from "../src/lib/utils";
import type { Candidate, OutreachMessage } from "../src/lib/types";

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
ok("warmed agent stands by when seed has no pending work", maya.state === "idle");
ok("standing-by label is honest", /Standing by/i.test(maya.label));
ok("idle agent is not busy", maya.busy === false);
ok("contacted count is a number", typeof maya.contacted === "number" && maya.contacted >= 0);

const aisha = agentActivity(seat("seat_aisha"), s, NOW); // warmup day ~5
ok("warming agent state = warming", aisha.state === "warming");

const lucas = agentActivity(seat("seat_lucas"), s, NOW); // bounce 0.068 > 5% → auto-pause
ok("high-bounce agent is paused", lucas.state === "paused");

// determinism: same inputs → same activity
const maya2 = agentActivity(seat("seat_maya"), s, NOW);
ok("activity is deterministic", maya.label === maya2.label && maya.detail === maya2.detail);

// Real pending outreach → busy outreach (never hash-fabricated busy work)
const campaign = s.campaigns.find((c) => c.status === "Sourcing")!;
const stubCand = {
  id: "cand_floor_test",
  campaignId: campaign.id,
  name: "Floor Test",
  stage: "Sourced",
} as Candidate;
const stubMsg = {
  id: "msg_floor_test",
  campaignId: campaign.id,
  candidateId: stubCand.id,
  status: "Needs Approval",
  channel: "Email",
  subject: "Hello",
  body: "Hi",
} as OutreachMessage;
const withWork = {
  ...s,
  candidates: [...s.candidates, stubCand],
  outreach: [...s.outreach, stubMsg],
};
const mayaBusy = agentActivity(seat("seat_maya"), withWork, NOW);
ok("pending approval drives outreach activity", mayaBusy.state === "outreach");
ok("pending approval is busy", mayaBusy.busy === true);
ok("outreach label mentions approval", /awaiting approval/i.test(mayaBusy.label));

const roll = floorRollup(s.seats, s);
ok("rollup total = seat count", roll.total === s.seats.length);
ok("rollup buckets within total", roll.working + roll.warming + roll.paused <= roll.total);
ok("contactedToday = sum of sentToday", roll.contactedToday === s.seats.reduce((a, x) => a + x.sentToday, 0));
ok("at least one paused (lucas)", roll.paused >= 1);

console.log(`RESULT floor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
