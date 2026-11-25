// Scoring model 2 (2026-11-25, owner: "scores under 40 too often") and the
// Settings switch that turns the contact-floor block into a warning.
// Synthetic data only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateReview } from "../src/lib/candidate-review";
import { recordVerifiedEvidence } from "../src/lib/candidate-evidence";
import { checkOutreachApproval, contactFloorBlocks } from "../src/lib/rules";
import { DEFAULT_SCORING_WEIGHTS, SCORING_MODEL, UNKNOWN_SCORE, matchSkills, scoreCandidate, skillEvidenceComplete } from "../src/lib/scoring";
import { buildSeedState, STATE_VERSION } from "../src/lib/seed";
import { normalizeWorkspaceState } from "../src/lib/store/migrations";
import { deriveStarRating, DEFAULT_STAR_THRESHOLDS } from "../src/lib/tania";
import type { Candidate, JobAnalysis, OutreachMessage, WorkspaceState } from "../src/lib/types";

const seed = buildSeedState();
const seedCampaign = seed.campaigns[0]!;
const brief: JobAnalysis = {
  ...seedCampaign.jobAnalysis,
  requiredSkills: ["Python", "Django", "PostgreSQL", "React", "AWS", "Docker", "Kubernetes"],
  niceToHaveSkills: ["Go", "Terraform"],
  minYearsExperience: 5,
  maxYearsExperience: null,
  industryExperience: ["Fintech"],
  companyStageTarget: [],
  locationType: "Hybrid",
  location: "Paris",
  regions: ["France"],
  timezone: "",
};

/** A LinkedIn profile found by web search: a short snippet, little known. */
function webLead(overrides: Partial<Candidate> = {}): Candidate {
  return {
    ...seed.candidates[0]!,
    provenance: "live",
    sourcePlatform: "LinkedIn",
    techStack: [],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    location: "",
    timezone: "",
    recentActivity: "Found via web search.",
    enrichment: undefined,
    skillsCheckedAt: undefined,
    ...overrides,
  };
}

const score = (c: Candidate, jd: JobAnalysis = brief) => scoreCandidate(c, jd, DEFAULT_SCORING_WEIGHTS);
const dim = (c: Candidate, key: string, jd: JobAnalysis = brief) => score(c, jd).breakdown.find((item) => item.key === key)!;

test("a web profile we know little about sits in the middle, not under 40", () => {
  const blank = score(webLead());
  assert.equal(blank.score, UNKNOWN_SCORE, "nothing known: neutral");
  for (const key of ["skills", "experience", "industry", "location"]) {
    assert.equal(dim(webLead(), key).score, UNKNOWN_SCORE);
    assert.match(dim(webLead(), key).rationale, /unknown so far.*neutral \(50\)/);
  }
  const oneSkill = score(webLead({ techStack: ["Python"] }));
  assert.ok(oneSkill.score >= 50 && oneSkill.score < 70, `one skill seen: ${oneSkill.score}`);
});

test("seeing more of the brief's skills never lowers the score (the old model did)", () => {
  const seen = [[], ["Python"], ["Python", "Django"], ["Python", "Django", "PostgreSQL", "React"], brief.requiredSkills];
  const scores = seen.map((techStack) => score(webLead({ techStack })).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i]! >= scores[i - 1]!, `scores ${scores.join(" < ")}`);
  assert.match(dim(webLead({ techStack: ["Python"] }), "skills").rationale, /1\/7 required.*seen in the profile; the others are not shown yet/);
});

test("a skill missing from a checked profile counts as missing; from a snippet, as unknown", () => {
  const snippet = webLead({ techStack: ["Python", "Django"] });
  const checked = { ...snippet, skillsCheckedAt: "2026-11-25T09:00:00.000Z" };
  assert.equal(skillEvidenceComplete(snippet), false);
  assert.equal(skillEvidenceComplete(checked), true);
  assert.ok(score(checked).score < score(snippet).score, "a verified gap weighs more than an unknown");
  assert.match(dim(checked, "skills").rationale, /checked profile/);
  assert.equal(skillEvidenceComplete({ ...snippet, enrichment: { status: "enriched", fieldProvenance: { skills: { provider: "GitHub", at: "x" } }, attempts: [], coverage: [] } }), true);
});

test("the recruiter's 'Verify the profile' form marks the skills as checked", () => {
  const state: WorkspaceState = {
    ...seed,
    campaigns: [{ ...seedCampaign, status: "Sourcing" }],
    candidates: [webLead({ id: "cand_v", campaignId: seedCampaign.id, techStack: ["Python"], stage: "Sourced", email: "", linkedinUrl: "", complianceFlags: { ...seed.candidates[0]!.complianceFlags, doNotContact: false, suppressed: false, unsubscribed: false, anonymized: false } })],
  };
  const result = recordVerifiedEvidence(state, "cand_v", { email: "", linkedinUrl: "", source: "Public LinkedIn profile", skills: ["Python"] }, "2026-11-25T10:00:00.000Z", "note_1");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.ok && result.state.candidates[0]!.skillsCheckedAt, "2026-11-25T10:00:00.000Z");
  const noSkills = recordVerifiedEvidence(state, "cand_v", { email: "a@example.com", linkedinUrl: "", source: "Public LinkedIn profile" }, "2026-11-25T10:00:00.000Z", "note_2");
  assert.ok(noSkills.ok);
  assert.equal(noSkills.ok && noSkills.state.candidates[0]!.skillsCheckedAt, undefined, "skills not reviewed, not marked");
});

test("skills match across spellings and aliases", () => {
  const { matched, unmatched } = matchSkills(
    ["ReactJS", "golang", "Postgres", "k8s", "python 3", "Node.js", "C#", "Amazon Web Services"],
    ["React", "Go", "PostgreSQL", "Kubernetes", "Python", "NodeJS", "csharp", "AWS", "Rust"],
  );
  assert.deepEqual(unmatched, ["Rust"]);
  assert.equal(matched.length, 8);
  assert.deepEqual(matchSkills(["Java"], ["JavaScript"]).matched, [], "Java is not JavaScript");
});

test("a brief with no nice-to-have no longer caps a full match at 82", () => {
  const full = { ...seed.candidates[0]!, techStack: ["Python", "Django"], provenance: "synthetic" as const };
  const jd = { ...brief, requiredSkills: ["Python", "Django"], niceToHaveSkills: [] };
  assert.equal(dim(full, "skills", jd).score, 100);
  const none = { ...brief, requiredSkills: [], niceToHaveSkills: [] };
  assert.equal(dim(full, "skills", none).weight, 0, "no skills in the brief: not scored");
});

test("location: not scored when the brief sets none, and accents do not matter", () => {
  const anywhere = { ...brief, locationType: "Hybrid" as const, location: "", regions: [], timezone: "" };
  const lead = webLead({ location: "Lyon, France" });
  assert.equal(dim(lead, "location", anywhere).weight, 0);
  assert.match(dim(lead, "location", anywhere).rationale, /No location in the brief/);
  const montreal = { ...brief, location: "Montreal", regions: ["Canada"] };
  assert.ok(dim(webLead({ location: "Montréal, Québec" }), "location", montreal).score >= 90);
});

test("a verified mismatch still scores low", () => {
  const junior = webLead({ techStack: brief.requiredSkills, yearsExperience: 1, location: "Sydney, Australia", skillsCheckedAt: "x" });
  assert.ok(dim(junior, "experience").score < 30);
  assert.ok(dim(junior, "location").score < 50);
  assert.ok(score(junior).score < score(webLead({ techStack: brief.requiredSkills, yearsExperience: 7, location: "Paris, France", skillsCheckedAt: "x" })).score);
});

test("stored candidates scored by the old model are rescored when the workspace loads", () => {
  assert.equal(SCORING_MODEL, 2);
  assert.equal(STATE_VERSION, 22);
  const campaign = { ...seedCampaign, jobAnalysis: brief };
  const old = webLead({ id: "cand_old", campaignId: campaign.id, techStack: ["Python"], matchScore: 22, matchBreakdown: [], starRating: deriveStarRating(22, DEFAULT_STAR_THRESHOLDS) });
  const manualStar = { ...old, id: "cand_star", starRating: "A" as const };
  const orphan = webLead({ id: "cand_orphan", campaignId: "camp_gone", matchScore: 22 });
  const loaded = normalizeWorkspaceState({ ...seed, version: 21, campaigns: [campaign], candidates: [old, manualStar, orphan] });
  const [rescored, kept, untouched] = loaded.candidates;
  assert.equal(loaded.version, 22);
  assert.equal(rescored!.matchScore, score(old).score);
  assert.ok(rescored!.matchScore > 40);
  assert.equal(rescored!.starRating, deriveStarRating(rescored!.matchScore, DEFAULT_STAR_THRESHOLDS), "a derived rating follows the new score");
  assert.equal(kept!.starRating, "A", "a rating set by hand is kept");
  assert.equal(untouched!.matchScore, 22, "no campaign, nothing to score against");
  const tombstone = { ...old, id: "cand_erased", complianceFlags: { ...old.complianceFlags, anonymized: true }, leadSource: undefined, starRating: undefined };
  const withTombstone = normalizeWorkspaceState({ ...seed, version: 21, campaigns: [campaign], candidates: [tombstone] });
  assert.equal(withTombstone.candidates[0], tombstone, "an erasure tombstone is never rewritten (the database refuses a changed one)");
  const again = normalizeWorkspaceState(loaded);
  assert.equal(again.candidates[0]!.matchScore, rescored!.matchScore, "current version: not rescored again");
});

const message = (candidateId: string): OutreachMessage => ({
  ...(seed.outreach[0] ?? ({} as OutreachMessage)),
  id: "msg_floor",
  candidateId,
  personalizationEvidence: ["Recent talk on Django"],
});

test("Settings can turn the contact-floor block into a warning", () => {
  const candidate = { ...seed.candidates[0]!, matchScore: 55 };
  const on = { ...seed.settings, minScoreToContact: 70 };
  const off = { ...on, enforceMinScoreToContact: false };
  assert.equal(contactFloorBlocks(on), true, "absent means on");
  assert.equal(contactFloorBlocks(off), false);

  const blocked = checkOutreachApproval({ candidate, message: message(candidate.id), settings: on } as Parameters<typeof checkOutreachApproval>[0]);
  assert.ok(blocked.blockers.some((b) => /below the 70 contact floor/.test(b)));
  assert.equal(blocked.checks?.find((c) => c.rule === "Match score")?.status, "block");

  const warned = checkOutreachApproval({ candidate, message: message(candidate.id), settings: off } as Parameters<typeof checkOutreachApproval>[0]);
  assert.ok(!warned.blockers.some((b) => /contact floor/.test(b)), "no longer a blocker");
  assert.ok(warned.warnings.some((w) => /below 70; the contact floor is off in Settings/.test(w)));
  assert.equal(warned.checks?.find((c) => c.rule === "Match score")?.status, "warn");
});

test("with the floor off, a low score alone no longer asks to verify fit", () => {
  const campaign = { ...seedCampaign, status: "Sourcing" as const };
  const fit = { ...seed.candidates[0]!, campaignId: campaign.id, matchScore: 55, techStack: campaign.jobAnalysis.requiredSkills, yearsExperience: 7, stage: "Sourced" as const };
  assert.equal(candidateReview(fit, campaign, { minScoreToContact: 70 }).key, "fit");
  assert.notEqual(candidateReview(fit, campaign, { minScoreToContact: 70, enforceMinScoreToContact: false }).key, "fit");
});
