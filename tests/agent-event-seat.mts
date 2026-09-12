/**
 * Floor FX seat attribution helpers — N Browser Computer desks must not
 * inherit campaign-level source/reply pulses without a real owning seatId.
 */
import {
  soleCampaignBrowserSeatId,
  latestOutreachSeatId,
} from "../src/lib/agent-event-seat";
import type { AgentSeat, OutreachMessage } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const baseSeat = {
  status: "active" as const,
  provider: "LinkedIn Browser Computer" as const,
  assignedCampaignIds: [] as string[],
};

{
  const seats = [
    { ...baseSeat, id: "seat_a" },
    { ...baseSeat, id: "seat_b", provider: "Email" as const },
  ] as unknown as AgentSeat[];
  ok(
    "sole LI Browser Computer seat attributes source",
    soleCampaignBrowserSeatId(seats, "camp_1") === "seat_a",
  );
}

{
  const seats = [
    { ...baseSeat, id: "seat_a", assignedCampaignIds: ["camp_1"] },
    { ...baseSeat, id: "seat_b", assignedCampaignIds: ["camp_1"] },
  ] as unknown as AgentSeat[];
  ok(
    "N LI seats on campaign omit source seatId (no hash bleed)",
    soleCampaignBrowserSeatId(seats, "camp_1") === undefined,
  );
}

{
  const seats = [
    { ...baseSeat, id: "seat_a", assignedCampaignIds: ["camp_other"] },
  ] as unknown as AgentSeat[];
  ok(
    "LI seat assigned only elsewhere does not claim this campaign",
    soleCampaignBrowserSeatId(seats, "camp_1") === undefined,
  );
}

{
  const outreach = [
    { candidateId: "c1", seatId: "seat_old" },
    { candidateId: "c1", seatId: "seat_new" },
    { candidateId: "c2", seatId: "seat_x" },
  ] as unknown as OutreachMessage[];
  ok(
    "latest outreach seat wins for reply attribution",
    latestOutreachSeatId(outreach, "c1") === "seat_new",
  );
  ok(
    "unknown candidate yields no reply seatId",
    latestOutreachSeatId(outreach, "missing") === undefined,
  );
}

console.log(`RESULT agent-event-seat: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
