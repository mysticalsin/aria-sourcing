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
  effectiveStageRank,
  withStage,
  firstInterviewElapsedHours,
} from "../src/lib/metrics";
import { FUNNEL_STAGES } from "../src/lib/types";
import type { Candidate, JobAnalysis, ScoringWeights } from "../src/lib/types";
import { historicalSeedState } from "./seed-fixtures.mts";

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

const state = historicalSeedState();

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

const baseScoringCandidate = cands[0] as Candidate;
const signalAwareJd: JobAnalysis = {
  ...jd,
  requiredSkills: ["typescript"],
  niceToHaveSkills: ["react"],
  minYearsExperience: 4,
  maxYearsExperience: 8,
  companyStageTarget: [],
  industryExperience: [],
  locationType: "Remote",
  regions: ["Canada"],
  timezone: "EST",
};
const signalCandidate: Candidate = {
  ...baseScoringCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: 6,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "EST",
  recentActivity: "",
};
const unknownExperienceCandidate: Candidate = { ...signalCandidate, yearsExperience: null };
const verifiedExperience = scoreCandidate(signalCandidate, signalAwareJd, DEFAULT_SCORING_WEIGHTS);
const unknownExperience = scoreCandidate(
  unknownExperienceCandidate,
  signalAwareJd,
  DEFAULT_SCORING_WEIGHTS,
);
ok(
  "signal-aware scoring: verified requested experience outranks unknown requested experience",
  verifiedExperience.score > unknownExperience.score,
);

// Live LinkedIn/SERP leads: sparse structured fields must not pin the composite
// at UNKNOWN_ANCHOR — title + location evidence should clear the contact floor.
const liveLinkedInJd: JobAnalysis = {
  ...jd,
  title: "System Designer",
  requiredSkills: ["UML", "SysML", "Architecture", "Requirements"],
  niceToHaveSkills: ["Doors"],
  minYearsExperience: 8,
  maxYearsExperience: null,
  companyStageTarget: ["Public"],
  industryExperience: ["Consulting"],
  locationType: "On-site",
  regions: ["Montreal", "Canada"],
  timezone: "",
};
const liveLinkedInCandidate: Candidate = {
  ...baseScoringCandidate,
  provenance: "live",
  sourcePlatform: "LinkedIn",
  currentTitle: "System Designer at Acme",
  currentCompany: "Acme",
  techStack: ["UML", "Architecture"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  location: "Montreal",
  timezone: "",
  recentActivity: "System Designer in Montreal with UML experience.",
};
const liveLinkedInScore = scoreCandidate(
  liveLinkedInCandidate,
  liveLinkedInJd,
  DEFAULT_SCORING_WEIGHTS,
);
ok(
  "live LinkedIn title+location evidence clears contact floor (80)",
  liveLinkedInScore.score >= 80,
);
const liveExp = liveLinkedInScore.breakdown.find((item) => item.key === "experience");
ok(
  "live LinkedIn missing years is channel N/A (not unknown-30)",
  liveExp?.weight === 0 && /not available from this source/i.test(liveExp?.rationale ?? ""),
);
const manualUnknownYears = scoreCandidate(
  { ...liveLinkedInCandidate, provenance: "manual", sourcePlatform: "Manual" },
  liveLinkedInJd,
  DEFAULT_SCORING_WEIGHTS,
);
const manualExp = manualUnknownYears.breakdown.find((item) => item.key === "experience");
ok(
  "manual missing years stays unknown-30 (operator could have entered it)",
  manualExp?.score === 30 && /unknown/i.test(manualExp?.rationale ?? ""),
);

const thinHighSkill = scoreCandidate(
  {
    ...signalCandidate,
    yearsExperience: null,
    location: "",
    timezone: "",
  },
  signalAwareJd,
  DEFAULT_SCORING_WEIGHTS,
);
ok(
  "signal-aware scoring: skills-only-high candidate stays below MIN_SCORE_FLOOR 80",
  thinHighSkill.score < 80,
);

const broadVerified = scoreCandidate(
  {
    ...signalCandidate,
    techStack: ["typescript"],
    yearsExperience: 6,
    location: "Toronto, Canada",
    timezone: "EST",
  },
  signalAwareJd,
  DEFAULT_SCORING_WEIGHTS,
);
ok(
  "signal-aware scoring: thin high-skill candidate does not outrank broad verified candidate",
  thinHighSkill.score < broadVerified.score,
);

const skillsOnlyJd: JobAnalysis = {
  ...signalAwareJd,
  requiredSkills: ["typescript", "react", "node", "postgres"],
  niceToHaveSkills: ["next"],
  minYearsExperience: null,
  maxYearsExperience: null,
  companyStageTarget: [],
  industryExperience: [],
  regions: ["EU"],
  timezone: "CET",
};
const skillsOnly = scoreCandidate(
  {
    ...signalCandidate,
    techStack: ["typescript", "react", "node", "next"],
    yearsExperience: null,
    location: "Toronto, Canada",
    timezone: "",
  },
  skillsOnlyJd,
  { ...DEFAULT_SCORING_WEIGHTS, location: 0, activity: 0 },
);
const skillsOnlySkillScore = skillsOnly.breakdown.find((item) => item.key === "skills")?.score;
ok(
  "signal-aware scoring: role requests only skills -> composite equals skills score",
  skillsOnly.score === skillsOnlySkillScore,
);

const finiteZeroedScoredDims = scoreCandidate(
  signalCandidate,
  signalAwareJd,
  { ...DEFAULT_SCORING_WEIGHTS, skills: 0, experience: 0, location: 0 },
);
ok(
  "signal-aware scoring: custom weights zeroing scored dims keep composite finite",
  Number.isFinite(finiteZeroedScoredDims.score) &&
    finiteZeroedScoredDims.score >= 0 &&
    finiteZeroedScoredDims.score <= 100,
);

for (const unsafeWeight of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
  const unsafeWeights = { ...DEFAULT_SCORING_WEIGHTS, skills: unsafeWeight } as ScoringWeights;
  const unsafeResult = scoreCandidate(signalCandidate, signalAwareJd, unsafeWeights);
  ok(
    `signal-aware scoring: non-finite/negative skills weight ${String(unsafeWeight)} stays finite`,
    Number.isFinite(unsafeResult.score) &&
      unsafeResult.breakdown.every(
        (item) => Number.isFinite(item.weight) && item.weight >= 0 && item.weight <= 1,
      ),
  );
}

const degenerateZeroApplicable = scoreCandidate(
  {
    ...signalCandidate,
    yearsExperience: null,
    location: "",
    timezone: "",
  },
  signalAwareJd,
  {
    skills: 0,
    experience: 0,
    companyStage: 10,
    industry: 10,
    location: 0,
    activity: 10,
  },
);
ok(
  "signal-aware scoring: zero applicable effective weight gives composite 0 and contribution sum 0",
  degenerateZeroApplicable.score === 0 &&
    degenerateZeroApplicable.breakdown.reduce((sum, item) => sum + item.contribution, 0) === 0,
);

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

/* ---- withStage / maxStageRank high-water-mark (regression for P1) -------- */
// withStage is the single helper every store.ts stage-mutation site
// (setCandidateStage, createBookingFor, updateBooking, complianceMutate,
// applyReplyAction) must go through so a later regression to a terminal
// stage never erases an earlier positive high-water mark.
type BareCandidate = Pick<Candidate, "stage" | "maxStageRank">;

const fresh: BareCandidate = { stage: "Sourced", maxStageRank: undefined };
const afterInterested = withStage(fresh, "Interested");
ok("withStage: Sourced -> Interested sets maxStageRank to 3", afterInterested.maxStageRank === 3);
ok("withStage: stage updated to Interested", afterInterested.stage === "Interested");

// Exact P1 failure scenario: a candidate reaches "Interviewed" purely via the
// booking flow (createBookingFor -> updateBooking), which never calls
// setCandidateStage, then gets suppressed via a negative reply / manual DNC.
// Before the fix, maxStageRank stayed at whatever setCandidateStage last set
// it to (or 0), so effectiveStageRank() under-reported the true progress.
const booked = withStage(fresh, "Booked"); // createBookingFor
ok("withStage: Sourced -> Booked sets maxStageRank to 4", booked.maxStageRank === 4);
const interviewed = withStage(booked, "Interviewed"); // updateBooking (Booked -> Interviewed)
ok("withStage: Booked -> Interviewed sets maxStageRank to 5", interviewed.maxStageRank === 5);
const suppressedAfterInterview = withStage(interviewed, "Suppressed"); // suppressCandidate / markDoNotContact / applyReplyAction
ok(
  "withStage: Interviewed -> Suppressed preserves maxStageRank at 5 (does not regress to 1)",
  suppressedAfterInterview.maxStageRank === 5,
);
ok(
  "effectiveStageRank returns 5 for a suppressed-after-interviewed candidate, not 3 or 1",
  effectiveStageRank({ ...suppressedAfterInterview } as Candidate) === 5,
);

// A candidate suppressed with no prior progress should not gain a phantom
// high-water mark beyond what Suppressed itself ranks.
const neverProgressed: BareCandidate = { stage: "Sourced", maxStageRank: 0 };
const suppressedEarly = withStage(neverProgressed, "Suppressed");
ok(
  "withStage: Sourced -> Suppressed with no prior progress caps at Suppressed rank (1)",
  suppressedEarly.maxStageRank === 1,
);

/* ---- firstInterviewElapsedHours (regression for P2) ---------------------- */
// Must use each booking's scheduled `startTime`, not `createdAt`, and must be
// the single formula shared by store.ts (live) and seed.ts (seeded) so both
// report the same KPI meaning for an equivalent booking lag.
const campaignCreatedAt = "2026-01-01T00:00:00.000Z";

ok(
  "firstInterviewElapsedHours: no bookings -> null",
  firstInterviewElapsedHours([], campaignCreatedAt) === null,
);

ok(
  "firstInterviewElapsedHours: single booking 10h after createdAt -> 10",
  firstInterviewElapsedHours(
    [{ startTime: "2026-01-01T10:00:00.000Z" }],
    campaignCreatedAt,
  ) === 10,
);

ok(
  "firstInterviewElapsedHours: picks the earliest startTime among multiple bookings",
  firstInterviewElapsedHours(
    [
      { startTime: "2026-01-03T00:00:00.000Z" },
      { startTime: "2026-01-01T05:00:00.000Z" },
      { startTime: "2026-01-02T00:00:00.000Z" },
    ],
    campaignCreatedAt,
  ) === 5,
);

ok(
  "firstInterviewElapsedHours: startTime before createdAt clamps to 0, never negative",
  firstInterviewElapsedHours(
    [{ startTime: "2025-12-31T00:00:00.000Z" }],
    campaignCreatedAt,
  ) === 0,
);

/* ---- summary ------------------------------------------------------------- */
console.log(`RESULT scoring: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
