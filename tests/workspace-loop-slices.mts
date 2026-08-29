/**
 * Contract pins for post-0074 workspace loop slices used by Autopilot crons.
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

const slices = readFileSync("src/lib/workspace-loop-slices.ts", "utf8");
const mig78 = readFileSync("supabase/migrations/0078_loop_outreach_slices_and_merge.sql", "utf8");
const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
const prep = readFileSync("src/app/api/cron/interview-prep-dispatch/route.ts", "utf8");
const auto = readFileSync("src/app/api/cron/autopilot-send-outreach/route.ts", "utf8");
const poll = readFileSync("src/app/api/cron/poll-provider-run/route.ts", "utf8");
const batch = readFileSync("src/app/api/cron/run-sourcing-batch/route.ts", "utf8");
const propose = readFileSync("src/app/api/cron/propose-calendar-book/route.ts", "utf8");
const confirm = readFileSync("src/app/api/cron/confirm-calendar-book/route.ts", "utf8");

ok("slices helper exports mergeOutreachMessageScheduled", /export async function mergeOutreachMessageScheduled/.test(slices));
ok("slices helper uses revision-only then merge_outreach_message", /merge_outreach_message/.test(slices) && /read_workspace_state_for_loop/.test(slices));
ok("0078 defines merge_outreach_message", /'merge_outreach_message'/.test(mig78));
ok("0078 defines outreach ready sweep RPC", /p_ready_sweep/.test(mig78));

for (const [name, src] of [
  ["generate-outreach-draft", draft],
  ["interview-prep-dispatch", prep],
  ["autopilot-send-outreach", auto],
  ["poll-provider-run", poll],
  ["run-sourcing-batch", batch],
  ["propose-calendar-book", propose],
  ["confirm-calendar-book", confirm],
] as const) {
  ok(
    `${name} does not expect full state blob from read_workspace_state_for_loop`,
    !(/read_workspace_state_for_loop[\s\S]{0,200}state\?/.test(src) || /body\.state\.campaigns/.test(src)),
  );
}

ok("draft uses campaign+candidate+skills slices", /loadCampaignForLoop/.test(draft) && /loadSkillsForLoop/.test(draft));
ok("prep uses booking slice", /loadBookingForLoop/.test(prep));
ok("autopilot persists Scheduled after sweep queue", /mergeOutreachMessageScheduled/.test(auto) && /persistScheduled/.test(auto));
ok("poll uses identity slice", /read_workspace_candidate_identities_for_loop/.test(poll));
ok("batch uses identity + scoring slices", /read_workspace_candidate_identities_for_loop/.test(batch) && /read_workspace_scoring_weights_for_loop/.test(batch));

console.log(`RESULT workspace-loop-slices: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
