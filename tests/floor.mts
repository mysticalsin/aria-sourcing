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

// Regression: /floor historically assembled a narrow stateLike WITHOUT outreach.
// Missing arrays must fail-soft (idle), not throw TypeError on .filter.
const partialLike = {
  campaigns: s.campaigns,
  candidates: s.candidates,
  ledger: s.ledger,
  seats: s.seats,
  settings: s.settings,
  // outreach intentionally omitted
} as unknown as typeof s;
let partialOk = false;
try {
  const a = agentActivity(seat("seat_maya"), partialLike, NOW);
  const r = floorRollup(s.seats, partialLike, NOW);
  partialOk = typeof a.state === "string" && typeof r.total === "number";
} catch {
  partialOk = false;
}
ok("partial stateLike without outreach does not throw", partialOk);

const emptyLike = {
  campaigns: undefined,
  candidates: undefined,
  outreach: undefined,
  ledger: undefined,
  settings: undefined,
} as unknown as typeof s;
let emptyOk = false;
try {
  const a = agentActivity(seat("seat_maya"), emptyLike, NOW);
  emptyOk = a.state === "idle" || a.state === "warming" || a.state === "paused";
} catch {
  emptyOk = false;
}
ok("undefined state slices fail-soft to idle/warming/paused", emptyOk);

console.log(`RESULT floor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
