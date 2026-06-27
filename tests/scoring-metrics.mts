/* tests/scoring-metrics.mts — area: scoring
 * Tests src/lib/scoring.ts + src/lib/metrics.ts against real seed data.
 * Run: tsx tests/scoring-metrics.mts  (sandbox blocks runtime; assertions hand-verified).
 */
import {
  scoreCandidate,
  scoreDistribution,
  DEFAULT_SCORING_WEIGHTS,
} from "../src/lib/scoring";
import {
  computeCampaignMetrics,
  funnelForCandidates,
  candidatesForCampaign,
  stageRank,
  STAGE_RANK,
} from "../src/lib/metrics";
import { FUNNEL_STAGES } from "../src/lib/types";
import { buildSeedState } from "../src/lib/seed";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const state = buildSeedState();

/* ---- scoreCandidate ------------------------------------------------------ */
const campaign = state.campaigns[0];
ok("seed has a campaign with jobAnalysis", !!campaign && !!campaign.jobAnalysis);
const jd = campaign.jobAnalysis;
const cands = candidatesForCampaign(state, campaign.id);
ok("campaign has candidates", cands.length > 0);

let scoredCount = 0;
for (const c of cands) {
  let res: ReturnType<typeof scoreCandidate> | null = null;
  try {
    res = scoreCandidate(c, jd, DEFAULT_SCORING_WEIGHTS);
  } catch (e) {
    ok(`scoreCandidate(${c.id}) does not throw`, false);
    continue;
  }
  scoredCount++;
  ok(`score in [0,100] for ${c.id}`, res.score >= 0 && res.score <= 100);
  ok(`breakdown has 6 dimensions for ${c.id}`, res.breakdown.length === 6);

  let contribSum = 0;
  let allDimsOk = true;
  let allWeightsOk = true;
  for (const item of res.breakdown) {
    contribSum += item.contribution;
    if (!(item.score >= 0 && item.score <= 100)) allDimsOk = false;
    if (!(item.weight >= 0 && item.weight <= 1)) allWeightsOk = false;
  }
  ok(`each breakdown item score in [0,100] for ${c.id}`, allDimsOk);
  ok(`each breakdown weight in [0,1] for ${c.id}`, allWeightsOk);
  // contributions sum approx to composite score (±1 tolerance for rounding)
  ok(
    `breakdown contributions sum ≈ score (±1) for ${c.id}`,
    Math.abs(contribSum - res.score) <= 1,
  );
}
ok("scored at least one candidate", scoredCount >= 1);

// Default weights are a normalisable positive set.
const wSum = Object.values(DEFAULT_SCORING_WEIGHTS).reduce((a, b) => a + b, 0);
ok("default scoring weights sum > 0", wSum > 0);

/* ---- scoreDistribution --------------------------------------------------- */
const seedScores = cands.map((c) => c.matchScore);
const distSeed = scoreDistribution(seedScores);
ok("distribution returns 5 bands", distSeed.length === 5);
ok(
  "distribution buckets sum to input length (seed scores)",
  distSeed.reduce((a, b) => a + b.count, 0) === seedScores.length,
);

const customScores = [0, 12, 54, 55, 69, 70, 79, 80, 89, 90, 99, 100];
const distCustom = scoreDistribution(customScores);
ok(
  "distribution buckets sum to input length (custom scores incl. boundaries 55/70/80/90/100)",
  distCustom.reduce((a, b) => a + b.count, 0) === customScores.length,
);
ok(
  "empty input → all zero counts, sum 0",
  scoreDistribution([]).reduce((a, b) => a + b.count, 0) === 0,
);
// 100 must land in the 90+ band (upper bound is exclusive 101).
const ninetyPlus = distCustom.find((b) => b.band === "90+");
ok("score 100 counted in 90+ band", !!ninetyPlus && ninetyPlus.count >= 1);

/* ---- computeCampaignMetrics --------------------------------------------- */
const m = computeCampaignMetrics(cands);
ok("metrics.sourced === candidate count", m.sourced === cands.length);
ok("sourced >= contacted", m.sourced >= m.contacted);
ok("contacted >= replied", m.contacted >= m.replied);
ok("replied >= interested", m.replied >= m.interested);
ok("interested >= booked", m.interested >= m.booked);
ok("booked >= interviewed", m.booked >= m.interviewed);
ok("interviewed >= offer", m.interviewed >= m.offer);
ok("offer >= hired", m.offer >= m.hired);
ok("replyRate in [0,1]", m.replyRate >= 0 && m.replyRate <= 1);
ok(
  "replyRate matches replied/contacted",
  m.contacted === 0
    ? m.replyRate === 0
    : Math.abs(m.replyRate - m.replied / m.contacted) < 1e-9,
);
ok("avgMatchScore in [0,100]", m.avgMatchScore >= 0 && m.avgMatchScore <= 100);

// Empty campaign → safe zeros, no divide-by-zero.
const mEmpty = computeCampaignMetrics([]);
ok("empty metrics sourced 0", mEmpty.sourced === 0);
ok("empty metrics replyRate 0 (no div-by-zero)", mEmpty.replyRate === 0);

/* ---- funnelForCandidates ------------------------------------------------- */
const funnel = funnelForCandidates(cands);
ok("funnel has one point per FUNNEL_STAGE", funnel.length === FUNNEL_STAGES.length);
let monotonic = true;
for (let i = 1; i < funnel.length; i++) {
  if (funnel[i].count > funnel[i - 1].count) monotonic = false;
}
ok("funnel counts are monotonically non-increasing across stages", monotonic);
ok(
  "funnel stage labels match FUNNEL_STAGES order",
  funnel.every((p, i) => p.stage === FUNNEL_STAGES[i]),
);
ok(
  "first funnel point (Sourced) >= last funnel point (Hired)",
  funnel[0].count >= funnel[funnel.length - 1].count,
);
// Sourced funnel point should equal total (all candidates have rank >= 0).
ok("Sourced funnel count === candidate count", funnel[0].count === cands.length);

/* ---- stageRank ordering -------------------------------------------------- */
ok("Sourced < Contacted", stageRank("Sourced") < stageRank("Contacted"));
ok("Contacted < Replied", stageRank("Contacted") < stageRank("Replied"));
ok("Replied < Interested", stageRank("Replied") < stageRank("Interested"));
ok("Interested < Booked", stageRank("Interested") < stageRank("Booked"));
ok("Booked < Interviewed", stageRank("Booked") < stageRank("Interviewed"));
ok("Interviewed < Offer", stageRank("Interviewed") < stageRank("Offer"));
ok("Offer < Hired", stageRank("Offer") < stageRank("Hired"));
ok("Hired is the top rank (7)", STAGE_RANK["Hired"] === 7);
ok("unknown stage falls back to 0", stageRank("Totally Made Up") === 0);
// Terminal/negative stages map to the furthest point actually reached.
ok("Not Interested maps to Replied rank (2)", stageRank("Not Interested") === 2);
ok("Rejected maps to Contacted rank (1)", stageRank("Rejected") === 1);
ok("Suppressed maps to Contacted rank (1)", stageRank("Suppressed") === 1);

/* ---- summary ------------------------------------------------------------- */
console.log(`RESULT scoring: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
