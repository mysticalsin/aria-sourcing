/* Quick check: assigned_campaign_ids maps into AgentSeat.assignedCampaignIds */
import { agentSeatRowToSeat, type AgentSeatRow } from "../src/lib/fleet-seats";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Java · Agent 01",
  operator_email: "java.agent01@hermes.example",
  provider: "LinkedIn Browser Computer",
  status: "active",
  mode: "mock",
  domain_verified: true,
  daily_limit: 40,
  warmup: true,
  warmup_start_cap: 10,
  warmup_step_per_day: 4,
  warmup_started_at: new Date().toISOString(),
  min_gap_minutes: 12,
  persona: "",
  signature: "",
  connected_account: "",
  computer_id: "comp_java_01",
  linkedin_delivery_backend: "browser-computer",
  assigned_campaign_ids: ["camp_seed_backend", "camp_other"],
  created_at: new Date().toISOString(),
} satisfies AgentSeatRow;

const seat = agentSeatRowToSeat(row);
ok("maps assigned_campaign_ids", seat.assignedCampaignIds?.includes("camp_seed_backend") === true);
ok("preserves multi-campaign", seat.assignedCampaignIds?.length === 2);
ok("maps computer_id", seat.computerId === "comp_java_01");

const cleared = agentSeatRowToSeat(
  { ...row, computer_id: null },
  { ...seat, computerId: "comp_stale_hermes" },
);
ok("trusts null computer_id over stale Hermes", cleared.computerId === null);

const empty = agentSeatRowToSeat({ ...row, assigned_campaign_ids: null }, {
  ...seat,
  assignedCampaignIds: ["camp_fallback"],
});
ok("falls back to existing when DB null", empty.assignedCampaignIds?.[0] === "camp_fallback");

console.log(`RESULT fleet-seats-assign: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
