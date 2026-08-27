/* tests/tania.mts — area: tania
 * Tests src/lib/tania.ts (star rating, lead source, funnel mapping, chatbox
 * scoring, handoff) and the TAnIA seed layer in src/lib/seed.ts.
 * Run: tsx tests/tania.mts
 */
import {
  deriveStarRating,
  deriveLeadSource,
  starRatingScore,
  taniaStageForCandidate,
  candidateDisposition,
  isCandidate,
  computeChatboxScore,
  chatboxHandoff,
  prequalSlaHours,
  DEFAULT_STAR_THRESHOLDS,
  STAR_RATING_META,
  LEAD_SOURCE_META,
  TANIA_STAGE_META,
} from "../src/lib/tania";
import { buildSeedState, STATE_VERSION } from "../src/lib/seed";
import { historicalSeedState } from "./seed-fixtures.mts";
import type { Candidate, StarRating } from "../src/lib/types";
import { STAR_RATINGS, LEAD_SOURCES, TANIA_STAGES } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- deriveStarRating ---------------------------------------------------- */
ok("score 95 → TopGun", deriveStarRating(95) === "TopGun");
ok("score 88 → TopGun (boundary)", deriveStarRating(88) === "TopGun");
ok("score 87 → A", deriveStarRating(87) === "A");
ok("score 80 → A (boundary)", deriveStarRating(80) === "A");
ok("score 70 → B", deriveStarRating(70) === "B");
ok("score 65 → B (boundary)", deriveStarRating(65) === "B");
ok("score 55 → C", deriveStarRating(55) === "C");
ok("score 40 → D", deriveStarRating(40) === "D");
ok("score 0 → D", deriveStarRating(0) === "D");
ok("custom thresholds respected", deriveStarRating(75, { topGun: 70, a: 60, b: 50, c: 40 }) === "TopGun");

/* ---- starRatingScore ordinal --------------------------------------------- */
ok("TopGun outranks A", starRatingScore("TopGun") > starRatingScore("A"));
ok("A outranks B > C > D", starRatingScore("A") > starRatingScore("B") && starRatingScore("B") > starRatingScore("C") && starRatingScore("C") > starRatingScore("D"));

/* ---- every rating/source/stage has metadata ------------------------------ */
ok("all ratings have meta", STAR_RATINGS.every((r) => !!STAR_RATING_META[r]?.label));
ok("all sources have meta", LEAD_SOURCES.every((s) => !!LEAD_SOURCE_META[s]?.label));
ok("all stages have meta", TANIA_STAGES.every((s) => !!TANIA_STAGE_META[s]?.label));

/* ---- deriveLeadSource ---------------------------------------------------- */
ok("explicit leadSource wins", deriveLeadSource({ leadSource: "Applicant", sourcePlatform: "GitHub" }) === "Applicant");
ok("Referral platform → Referral", deriveLeadSource({ sourcePlatform: "Referral" } as Candidate) === "Referral");
ok("GitHub → Outbound", deriveLeadSource({ sourcePlatform: "GitHub" } as Candidate) === "Outbound");
ok("LinkedIn → Outbound", deriveLeadSource({ sourcePlatform: "LinkedIn" } as Candidate) === "Outbound");

/* ---- funnel mapping ------------------------------------------------------ */
ok("Sourced → Leads", taniaStageForCandidate({ stage: "Sourced" } as Candidate) === "Leads");
ok("Replied → Leads", taniaStageForCandidate({ stage: "Replied" } as Candidate) === "Leads");
ok("Interested → Candidates", taniaStageForCandidate({ stage: "Interested" } as Candidate) === "Candidates");
ok("Booked → Candidates", taniaStageForCandidate({ stage: "Booked" } as Candidate) === "Candidates");
ok("Offer → Offered", taniaStageForCandidate({ stage: "Offer" } as Candidate) === "Offered");
ok("Hired → Employees", taniaStageForCandidate({ stage: "Hired" } as Candidate) === "Employees");
ok("Rejected → null (off active board)", taniaStageForCandidate({ stage: "Rejected" } as Candidate) === null);
ok("isCandidate true for Interested", isCandidate({ stage: "Interested" } as Candidate));
ok("isCandidate false for Sourced", !isCandidate({ stage: "Sourced" } as Candidate));

/* ---- disposition --------------------------------------------------------- */
ok("Rejected + vivier → pooled", candidateDisposition({ stage: "Rejected", vivier: true } as Candidate) === "pooled");
ok("Rejected no vivier → rejected", candidateDisposition({ stage: "Rejected" } as Candidate) === "rejected");
ok("Interested → active", candidateDisposition({ stage: "Interested" } as Candidate) === "active");

/* ---- prequal SLA --------------------------------------------------------- */
ok("TopGun prequal SLA 24h", prequalSlaHours("TopGun") === 24);
ok("A prequal SLA 24h", prequalSlaHours("A") === 24);
ok("B prequal SLA 48h", prequalSlaHours("B") === 48);
ok("C prequal SLA null (reject)", prequalSlaHours("C") === null);
ok("D prequal SLA null (reject)", prequalSlaHours("D") === null);

/* ---- computeChatboxScore ------------------------------------------------- */
const perfect = computeChatboxScore({ mobility: "Yes", needsVisa: false, keyExpStars: 5, toolStars: 5, projectYes: true, hasContactPref: true });
ok("perfect chatbox scores 100", perfect.total === 100);
ok("perfect breakdown sums to total", perfect.location + perfect.visa + perfect.keySkill + perfect.project + perfect.availability === perfect.total);
const weak = computeChatboxScore({ mobility: "No", needsVisa: true, keyExpStars: 1, toolStars: 1, projectYes: false, hasContactPref: false, outsideRegion: true });
ok("weak chatbox scores low", weak.total < 45);
ok("visa penalty applies", computeChatboxScore({ mobility: "Yes", needsVisa: true, keyExpStars: 5, toolStars: 5, projectYes: true, hasContactPref: true }).visa < 20);
ok("score never exceeds 100", perfect.total <= 100);
ok("score never negative", weak.total >= 0);

/* ---- chatboxHandoff routing --------------------------------------------- */
ok("TopGun handoff instant", chatboxHandoff("TopGun").action === "instant");
ok("A handoff instant", chatboxHandoff("A").action === "instant");
ok("B handoff digest", chatboxHandoff("B").action === "digest");
ok("C handoff reject", chatboxHandoff("C").action === "reject");
ok("D handoff reject", chatboxHandoff("D").action === "reject");

/* ---- seed layer ---------------------------------------------------------- */
const state = historicalSeedState();
ok("seed state version matches STATE_VERSION", state.version === STATE_VERSION);
ok("every candidate has a leadSource", state.candidates.every((c) => !!c.leadSource));
ok("every candidate has a starRating", state.candidates.every((c) => !!c.starRating));
ok("seed has all three lead sources represented", LEAD_SOURCES.every((s) => state.candidates.some((c) => c.leadSource === s)));
ok("referrals carry a referredBy", state.candidates.filter((c) => c.leadSource === "Referral").every((c) => !!c.referredBy));
ok("star rating matches derived from score", state.candidates.every((c) => c.starRating === deriveStarRating(c.matchScore, state.settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS)));
ok("candidates (Stage II+) have a prequal record", state.candidates.filter((c) => isCandidate(c)).every((c) => !!c.prequal));
ok("chatbox submissions seeded", (state.chatboxSubmissions?.length ?? 0) >= 4);
ok("chatbox submissions carry a valid score+rating", (state.chatboxSubmissions ?? []).every((s) => s.score.total >= 0 && s.score.total <= 100 && (STAR_RATINGS as readonly StarRating[]).includes(s.starRating)));
ok("chatbox rating matches its score", (state.chatboxSubmissions ?? []).every((s) => s.starRating === deriveStarRating(s.score.total, DEFAULT_STAR_THRESHOLDS)));
ok("every campaign has a Knight-M-checked job ad", state.campaigns.every((c) => c.jobAd?.knightM?.checked === true));
ok("job ads carry 5 screening questions", state.campaigns.every((c) => (c.jobAd?.screeningQuestions.length ?? 0) === 5));
ok("some candidates are pooled in #Vivier", state.candidates.some((c) => c.vivier));
ok("silver medalists are TopGun/A", state.candidates.filter((c) => c.silverMedalist).every((c) => c.starRating === "TopGun" || c.starRating === "A"));

console.log(`\ntania.mts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
