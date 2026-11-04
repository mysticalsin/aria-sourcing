/* tests/pipeline.mts — area: pipeline
 * Tests src/lib/pipeline.ts (stage columns, per-campaign rows, ordering,
 * totals) against the seed.
 * Run: tsx tests/pipeline.mts
 */
import {
  buildPipelineRows,
  campaignIsClosed,
  pipelineStageFor,
  PIPELINE_STAGES,
  stageTotals,
} from "../src/lib/pipeline";
import { buildSeedState } from "../src/lib/seed";
import { CANDIDATE_STAGES, type Campaign, type Candidate } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- columns ------------------------------------------------------------- */
ok("every candidate stage is in exactly one column", CANDIDATE_STAGES.every((s) => PIPELINE_STAGES.filter((p) => p.stages.includes(s)).length === 1));
ok("Booked and Interviewed share Interview", pipelineStageFor("Booked") === "interview" && pipelineStageFor("Interviewed") === "interview");
ok("rejections land in Out", pipelineStageFor("Rejected") === "out" && pipelineStageFor("Not Interested") === "out" && pipelineStageFor("Suppressed") === "out");

/* ---- rows ---------------------------------------------------------------- */
const seed = buildSeedState();
const camp = (id: string, status: Campaign["status"]): Campaign => ({ ...seed.campaigns[0], id, status });
const cand = (id: string, campaignId: string, stage: Candidate["stage"], matchScore = 70): Candidate => ({
  ...seed.candidates[0],
  id,
  campaignId,
  stage,
  matchScore,
});
const rows = buildPipelineRows(
  [camp("filled", "Filled"), camp("small", "Sourcing"), camp("big", "Outreach")],
  [
    cand("a", "big", "Sourced", 60),
    cand("b", "big", "Sourced", 90),
    cand("c", "big", "Booked"),
    cand("d", "big", "Rejected"),
    cand("e", "small", "Contacted"),
    cand("f", "filled", "Hired"),
    cand("g", "filled", "Interviewed"),
    cand("h", "filled", "Offer"),
  ],
);
ok("open campaigns first, most in progress on top", rows.map((r) => r.campaign.id).join() === "big,small,filled");
ok("in progress excludes Out", rows[0].inProgress === 3 && rows[0].total === 4);
ok("bucket sorted by match", rows[0].buckets.sourced.map((c) => c.id).join() === "b,a");
ok("Filled and Paused count as closed", campaignIsClosed({ status: "Filled" }) && campaignIsClosed({ status: "Paused" }) && !campaignIsClosed({ status: "Intake" }));
const totals = stageTotals(rows);
ok("totals add up per column", totals.sourced === 2 && totals.interview === 2 && totals.out === 1 && totals.hired === 1);

/* ---- seed ---------------------------------------------------------------- */
const seeded = buildPipelineRows(seed.campaigns, seed.candidates);
const seededTotal = Object.values(stageTotals(seeded)).reduce((n, v) => n + v, 0);
const known = new Set(seed.campaigns.map((c) => c.id));
ok("every seed candidate of a known campaign is counted once", seededTotal === seed.candidates.filter((c) => known.has(c.campaignId)).length);

console.log(`\npipeline.mts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
