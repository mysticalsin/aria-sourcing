import type {
  Candidate,
  JobAnalysis,
  MatchBreakdownItem,
  ScoringWeights,
} from "./types";
import { clamp, round } from "./utils";

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  skills: 34,
  experience: 22,
  companyStage: 12,
  industry: 12,
  location: 10,
  activity: 10,
};

const DIMENSION_LABELS: Record<keyof ScoringWeights, string> = {
  skills: "Skills match",
  experience: "Experience fit",
  companyStage: "Company-stage fit",
  industry: "Industry overlap",
  location: "Location & timezone",
  activity: "Signal & activity",
};

const UNKNOWN_ANCHOR = 30;
const SCORE_DIMENSIONS: (keyof ScoringWeights)[] = [
  "skills",
  "experience",
  "companyStage",
  "industry",
  "location",
  "activity",
];
// Activity vocabulary — the SINGLE source of truth. scoreActivity picks a tier
// from these; ACTIVITY_SIGNAL_RE (used by the classifier to decide scored-vs-
// excluded) is DERIVED from their union so the two can never drift apart.
const ACTIVITY_HIGH_RE = /this week|days ago|active|shipped|merged|launched|speaking/;
const ACTIVITY_MED_RE = /this month|recently|published|maintains|contribut/;
const ACTIVITY_LOW_RE = /last year|inactive|dormant|quiet/;
const ACTIVITY_SIGNAL_RE = new RegExp(
  [ACTIVITY_HIGH_RE, ACTIVITY_MED_RE, ACTIVITY_LOW_RE].map((r) => r.source).join("|"),
);

// One rationale for every "role asked, candidate value missing" dimension.
const UNKNOWN_RATIONALE = "Requested but candidate value unknown - counted as unverified.";

type ApplicabilityState = "scored" | "not_applicable" | "unknown";

interface DimensionResult {
  score: number;
  rationale: string;
  state: ApplicabilityState;
}

function lower(arr: string[]): string[] {
  return arr.map((s) => s.toLowerCase().trim());
}

function overlapCount(a: string[], b: string[]): number {
  const setB = new Set(lower(b));
  return lower(a).filter((x) => setB.has(x)).length;
}

function locationMatchesRegion(location: string, region: string): boolean {
  if (region.trim().toLowerCase() === "global") return true;
  const loc = location.trim().toLowerCase();
  const reg = region.trim().toLowerCase();
  if (!loc || !reg) return false;
  const escaped = reg
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  if (escaped && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(loc)) {
    return true;
  }
  // City-level: "London" ↔ "London, UK" (GitHub profiles often omit country).
  const locCity = loc.split(",")[0]!.trim();
  const regCity = reg.split(",")[0]!.trim();
  return locCity.length > 2 && regCity.length > 2 && locCity === regCity;
}

/* ---- Individual dimension scorers (all return 0-100) --------------------- */

function titleOverlapRatio(candidateTitle: string, roleTitle: string): number {
  const stop = new Set(["and", "the", "for", "with", "from", "into", "software", "systems"]);
  const tokens = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9+.#]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !stop.has(t));
  const roleTokens = tokens(roleTitle);
  if (roleTokens.length === 0) return 0;
  const hay = candidateTitle.toLowerCase();
  const hits = roleTokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  }).length;
  return hits / roleTokens.length;
}

function scoreSkills(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const req = jd.requiredSkills;
  const nice = jd.niceToHaveSkills;
  // LinkedIn/web leads often leave techStack sparse — also match against title,
  // company, and activity snippet so public-profile text can authorize contact.
  const corpus = [c.techStack.join(" "), c.currentTitle, c.currentCompany, c.recentActivity]
    .filter(Boolean)
    .join(" ");
  const reqHit = req.filter((skill) => skillMentionedInText(skill, corpus)).length;
  const niceHit = nice.filter((skill) => skillMentionedInText(skill, corpus)).length;
  const reqRatio = req.length ? reqHit / req.length : 0.7;
  const niceRatio = nice.length ? niceHit / nice.length : 0;
  let score = clamp(reqRatio * 82 + niceRatio * 18, 0, 100);
  const titleOverlap = titleOverlapRatio(c.currentTitle, jd.title);
  // Public headlines often encode role fit more than a sparse tech list.
  if (titleOverlap >= 0.5 && reqHit >= 1) score = Math.max(score, 82);
  if (titleOverlap >= 0.6) score = Math.max(score, 86);
  if (titleOverlap >= 0.9 && reqHit >= 1) score = Math.max(score, 92);
  return {
    score,
    rationale: `${reqHit}/${req.length || "—"} required, ${niceHit}/${
      nice.length || "—"
    } nice-to-have skills present${
      titleOverlap >= 0.5 ? `; title aligns with ${jd.title}` : ""
    }.`,
  };
}

function skillMentionedInText(skill: string, corpus: string): boolean {
  const hay = corpus.toLowerCase();
  const needle = skill.toLowerCase().trim();
  if (!needle || !hay) return false;
  if (hay.includes(needle)) return true;
  // Parenthetical acronyms (e.g. "Mean Time to Failure (MTTF)") are high-signal aliases.
  const acronyms = [...needle.matchAll(/\(([a-z0-9+.#]{2,})\)/gi)].map((m) => m[1]!.toLowerCase());
  if (acronyms.some((acronym) => new RegExp(`(?:^|[^a-z0-9])${acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(hay))) {
    return true;
  }
  const stop = new Set(["and", "the", "for", "with", "from", "into", "software", "systems", "management", "regulations"]);
  const tokens = needle
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9+.#]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !stop.has(t));
  if (tokens.length === 0) return acronyms.length > 0 ? false : false;
  const hits = tokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  });
  return hits.length >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function scoreExperience(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const yrs = c.yearsExperience;
  if (yrs == null) {
    return { score: 50, rationale: "Experience not provided." };
  }
  const min = jd.minYearsExperience;
  const max = jd.maxYearsExperience;
  let score: number;
  let rationale: string;
  if (min == null && max == null) {
    score = 75;
    rationale = `${yrs} yrs experience (no explicit band).`;
  } else if (min != null && yrs < min) {
    const gap = min - yrs;
    score = clamp(72 - gap * 16, 8, 72);
    rationale = `${yrs} yrs, ${gap} below the ${min}-yr minimum.`;
  } else if (max != null && yrs > max) {
    const over = yrs - max;
    score = clamp(90 - over * 7, 55, 90);
    rationale = `${yrs} yrs, ${over} above the ${max}-yr ceiling (possible over-level).`;
  } else {
    score = 94;
    rationale = `${yrs} yrs lands inside the target band.`;
  }
  return { score, rationale };
}

function scoreCompanyStage(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const target = jd.companyStageTarget.map(String);
  if (target.length === 0) return { score: 70, rationale: "No stage target set." };
  if (c.companyStageExperience.length === 0) {
    return { score: 50, rationale: "Company-stage experience not provided." };
  }
  const hit = overlapCount(c.companyStageExperience.map(String), target);
  const score = clamp(40 + (hit / target.length) * 60, 30, 100);
  return {
    score,
    rationale: hit
      ? `Worked at ${hit} of the ${target.length} target stages.`
      : `No direct experience at target stages (${target.join(", ")}).`,
  };
}

function scoreIndustry(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const target = jd.industryExperience;
  if (target.length === 0) return { score: 72, rationale: "No industry preference set." };
  if (c.industryExperience.length === 0) {
    return { score: 50, rationale: "Industry experience not provided." };
  }
  const hit = overlapCount(c.industryExperience, target);
  const score = clamp(45 + (hit / target.length) * 55, 35, 100);
  return {
    score,
    rationale: hit
      ? `Shares ${hit} target industry vertical${hit === 1 ? "" : "s"}.`
      : `Adjacent industries only.`,
  };
}

function scoreLocation(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  if (!c.location.trim() && !c.timezone.trim()) {
    return { score: 50, rationale: "Location and timezone not provided." };
  }
  if (jd.locationType === "Remote") {
    const timezoneAligned =
      Boolean(c.timezone) &&
      Boolean(jd.timezone) &&
      (c.timezone.includes(jd.timezone) || jd.timezone.includes(c.timezone));
    const regionAligned =
      Boolean(c.location) &&
      jd.regions.some((region) => locationMatchesRegion(c.location, region));
    const score = timezoneAligned ? 96 : regionAligned ? 90 : 80;
    return {
      score,
      rationale: timezoneAligned
        ? `Remote role: timezone ${c.timezone} overlaps working hours.`
        : regionAligned
          ? `Remote role: location ${c.location} matches a target region.`
          : "Remote role: working-hours overlap not confirmed.",
    };
  }
  const inRegion = jd.regions.some((region) => locationMatchesRegion(c.location, region));
  const score = inRegion ? 92 : 48;
  return {
    score,
    rationale: inRegion
      ? `Based in ${c.location}, within ${jd.locationType} range.`
      : `Based in ${c.location}, outside ${jd.locationType} catchment.`,
  };
}

function scoreActivity(c: Candidate): { score: number; rationale: string } {
  const txt = c.recentActivity.toLowerCase();
  let score = 62;
  if (/no activity signal/.test(txt)) score = 50;
  else if (ACTIVITY_HIGH_RE.test(txt)) score = 92;
  else if (ACTIVITY_MED_RE.test(txt)) score = 80;
  else if (ACTIVITY_LOW_RE.test(txt)) score = 45;
  return { score, rationale: c.recentActivity };
}

function effectiveWeight(weights: ScoringWeights, dim: keyof ScoringWeights): number {
  return Number.isFinite(weights[dim]) ? Math.max(0, weights[dim]) : 0;
}

function classifyDimensions(candidate: Candidate, jd: JobAnalysis): Record<keyof ScoringWeights, DimensionResult> {
  const skills = scoreSkills(candidate, jd);
  const experience = scoreExperience(candidate, jd);
  const companyStage = scoreCompanyStage(candidate, jd);
  const industry = scoreIndustry(candidate, jd);
  const location = scoreLocation(candidate, jd);
  const activity = scoreActivity(candidate);
  const roleRequestsExperience = jd.minYearsExperience != null || jd.maxYearsExperience != null;
  const hasActivitySignal = ACTIVITY_SIGNAL_RE.test(candidate.recentActivity.toLowerCase());

  // Live SERP/vendor leads often omit years/stage/industry as structured fields.
  // Treat those gaps as channel-unavailable (N/A) rather than unverified-unknown,
  // so title/location/skill evidence can still clear the contact floor.
  const liveSparse = candidate.provenance === "live";
  const skillsEvidence =
    candidate.techStack.length > 0 ||
    reqHitFromCorpus(candidate, jd) > 0 ||
    titleOverlapRatio(candidate.currentTitle, jd.title) >= 0.5;

  return {
    skills: {
      ...skills,
      state: skillsEvidence ? "scored" : "unknown",
      rationale: skillsEvidence ? skills.rationale : UNKNOWN_RATIONALE,
    },
    experience: {
      ...experience,
      state: !roleRequestsExperience
        ? "not_applicable"
        : candidate.yearsExperience != null
          ? "scored"
          : liveSparse
            ? "not_applicable"
            : "unknown",
      rationale: !roleRequestsExperience
        ? "Not requested by this role."
        : candidate.yearsExperience != null
          ? experience.rationale
          : liveSparse
            ? "Not available from this source."
            : UNKNOWN_RATIONALE,
    },
    companyStage: {
      ...companyStage,
      state:
        jd.companyStageTarget.length === 0
          ? "not_applicable"
          : candidate.companyStageExperience.length > 0
            ? "scored"
            : liveSparse
              ? "not_applicable"
              : "unknown",
      rationale:
        jd.companyStageTarget.length === 0
          ? "Not requested by this role."
          : candidate.companyStageExperience.length > 0
            ? companyStage.rationale
            : liveSparse
              ? "Not available from this source."
              : UNKNOWN_RATIONALE,
    },
    industry: {
      ...industry,
      state:
        jd.industryExperience.length === 0
          ? "not_applicable"
          : candidate.industryExperience.length > 0
            ? "scored"
            : liveSparse
              ? "not_applicable"
              : "unknown",
      rationale:
        jd.industryExperience.length === 0
          ? "Not requested by this role."
          : candidate.industryExperience.length > 0
            ? industry.rationale
            : liveSparse
              ? "Not available from this source."
              : UNKNOWN_RATIONALE,
    },
    location: {
      ...location,
      state:
        candidate.location.trim() || candidate.timezone.trim()
          ? "scored"
          : liveSparse
            ? "not_applicable"
            : "unknown",
      rationale:
        candidate.location.trim() || candidate.timezone.trim()
          ? location.rationale
          : liveSparse
            ? "Not available from this source."
            : UNKNOWN_RATIONALE,
    },
    activity: {
      ...activity,
      state: hasActivitySignal ? "scored" : "not_applicable",
      rationale: hasActivitySignal ? activity.rationale : "Not requested by this role.",
    },
  };
}

function reqHitFromCorpus(candidate: Candidate, jd: JobAnalysis): number {
  const corpus = [
    candidate.techStack.join(" "),
    candidate.currentTitle,
    candidate.currentCompany,
    candidate.recentActivity,
  ]
    .filter(Boolean)
    .join(" ");
  return jd.requiredSkills.filter((skill) => skillMentionedInText(skill, corpus)).length;
}

/* ---- Composite ----------------------------------------------------------- */

export interface ScoreResult {
  score: number;
  breakdown: MatchBreakdownItem[];
}

export function scoreCandidate(
  candidate: Candidate,
  jd: JobAnalysis,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): ScoreResult {
  const dims = classifyDimensions(candidate, jd);
  const applicable = SCORE_DIMENSIONS.filter((key) => dims[key].state !== "not_applicable");
  const denom = applicable.reduce((sum, key) => sum + effectiveWeight(weights, key), 0);

  const breakdown: MatchBreakdownItem[] = SCORE_DIMENSIONS.map((key) => {
    const dim = dims[key];
    const excluded = dim.state === "not_applicable" || denom === 0;
    const weight = excluded ? 0 : effectiveWeight(weights, key) / denom;
    const effectiveScore = dim.state === "unknown" ? UNKNOWN_ANCHOR : dim.score;
    const displayScore = excluded ? dim.score : effectiveScore;
    const contribution = excluded ? 0 : effectiveScore * weight;
    return {
      key,
      label: DIMENSION_LABELS[key],
      score: round(clamp(displayScore, 0, 100)),
      weight: round(weight, 3),
      contribution: round(contribution, 1),
      rationale: dim.rationale,
    };
  });
  const composite = breakdown.reduce((sum, item) => sum + item.contribution, 0);

  return { score: round(clamp(composite, 0, 100)), breakdown };
}

/** Distribution buckets for a match-score histogram. */
export function scoreDistribution(scores: number[]): { band: string; count: number }[] {
  const bands = [
    { band: "<55", min: 0, max: 55 },
    { band: "55–69", min: 55, max: 70 },
    { band: "70–79", min: 70, max: 80 },
    { band: "80–89", min: 80, max: 90 },
    { band: "90+", min: 90, max: 101 },
  ];
  return bands.map((b) => ({
    band: b.band,
    count: scores.filter((s) => s >= b.min && s < b.max).length,
  }));
}
