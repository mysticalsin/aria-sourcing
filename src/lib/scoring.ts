import type {
  Candidate,
  JobAnalysis,
  MatchBreakdownItem,
  ScoringWeights,
} from "./types";
import { clamp, round } from "./utils";
import { skillsObservedIn } from "./sourcing/skill-evidence";
import {
  candidateIsFarFromEurope,
  candidateMatchesEurope,
  jobAnalysisIsEuropeFocused,
  locationMatchesEuropeMacro,
} from "./geo-europe";

export {
  candidateIsFarFromEurope,
  candidateMatchesEurope,
  europeSourcingLocationHints,
  jobAnalysisIsEuropeFocused,
} from "./geo-europe";

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

/**
 * Scoring model version. Candidates scored by an older model are rescored when
 * the workspace loads (store/migrations.ts). Model 2 (2026-11-25): a criterion
 * the profile does not show yet counts as neutral (50) instead of a near-fail
 * (30), and a skill not seen in a public snippet is unknown, not missing.
 */
export const SCORING_MODEL = 2;

/** A requested criterion the profile does not show yet: neither a match nor a
 *  mismatch. A verified mismatch scores low on its own. */
export const UNKNOWN_SCORE = 50;
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
const UNKNOWN_RATIONALE = `Requested, unknown so far (not shown in the profile): counts as neutral (${UNKNOWN_SCORE}) until verified.`;

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

/** Lower case without accents: "Montréal" matches "Montreal". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

function locationMatchesRegion(location: string, region: string): boolean {
  if (fold(region) === "global") return true;
  const loc = fold(location);
  const reg = fold(region);
  if (!loc || !reg) return false;
  if (locationMatchesEuropeMacro(loc, reg)) return true;
  const escaped = reg
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return Boolean(escaped) && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(loc);
}

/* ---- Skills ------------------------------------------------------------------ */

const SKILL_ALIASES: Record<string, string> = {
  golang: "go",
  postgres: "postgresql",
  psql: "postgresql",
  k8s: "kubernetes",
  js: "javascript",
  ecmascript: "javascript",
  ts: "typescript",
  csharp: "c#",
  dotnet: ".net",
  net: ".net",
  aws: "amazonwebservices",
  gcp: "googlecloud",
  googlecloudplatform: "googlecloud",
  ml: "machinelearning",
  ai: "artificialintelligence",
};

/** One spelling per skill: "React.js", "ReactJS" and "react" are the same. */
function canonicalSkill(skill: string): string {
  let compact = fold(skill).replace(/[^a-z0-9+#]/g, "");
  if (compact.length >= 5 && compact.endsWith("js")) compact = compact.slice(0, -2);
  return SKILL_ALIASES[compact] ?? compact;
}

/** Which of `wanted` (as written in the brief) the candidate's skills cover:
 *  same skill under another spelling, or every word of the brief's phrase
 *  in one of the candidate's skills ("Python" in "Python 3"). */
export function matchSkills(have: readonly string[], wanted: readonly string[]): { matched: string[]; unmatched: string[] } {
  const canonical = new Set(have.map(canonicalSkill).filter(Boolean));
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const skill of wanted) {
    const hit = canonical.has(canonicalSkill(skill)) || have.some((item) => skillsObservedIn(item, [skill]).length > 0);
    (hit ? matched : unmatched).push(skill);
  }
  return { matched, unmatched };
}

/**
 * Whether the candidate's skill list is complete enough that a brief skill
 * absent from it is missing, not merely unshown: a recruiter checked the
 * skills ("Verify the profile"), an enrichment provider supplied them, or it is
 * a full demo profile. A search snippet or a short bio is never complete.
 */
export function skillEvidenceComplete(c: Candidate): boolean {
  return Boolean(c.skillsCheckedAt) || Boolean(c.enrichment?.fieldProvenance?.skills) || c.provenance === "synthetic" || c.provenance === undefined;
}

function scoreSkills(c: Candidate, jd: JobAnalysis): DimensionResult {
  const req = jd.requiredSkills;
  const nice = jd.niceToHaveSkills;
  if (req.length === 0 && nice.length === 0) {
    return { score: 0, rationale: "No skills in the brief.", state: "not_applicable" };
  }
  const complete = skillEvidenceComplete(c);
  const r = matchSkills(c.techStack, req);
  const n = matchSkills(c.techStack, nice);
  // An unseen skill: missing on a complete profile, unknown on a partial one.
  const unseen = complete ? 0 : UNKNOWN_SCORE;
  const part = (hit: number, total: number) => (total ? (hit * 100 + (total - hit) * unseen) / total : null);
  const reqPart = part(r.matched.length, req.length);
  const nicePart = part(n.matched.length, nice.length);
  const score = reqPart !== null && nicePart !== null ? reqPart * 0.85 + nicePart * 0.15 : (reqPart ?? nicePart ?? 0);
  const counts = `${r.matched.length}/${req.length || "—"} required, ${n.matched.length}/${nice.length || "—"} nice-to-have skills`;
  if (!complete && c.techStack.length === 0) {
    return { score: UNKNOWN_SCORE, rationale: UNKNOWN_RATIONALE, state: "unknown" };
  }
  return {
    score: clamp(score, 0, 100),
    rationale: complete
      ? `${counts} (checked profile).`
      : `${counts} seen in the profile; the others are not shown yet and count as neutral (${UNKNOWN_SCORE}).`,
    state: "scored",
  };
}

/* ---- Other dimensions (all return 0-100) ------------------------------------ */

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

/** The brief says where the person should be (a place, regions, a timezone,
 *  or a Europe focus). Without that, location is not scored. */
function roleHasLocation(jd: JobAnalysis): boolean {
  return jd.regions.length > 0 || Boolean(jd.location?.trim()) || Boolean(jd.timezone?.trim()) || jobAnalysisIsEuropeFocused(jd);
}

function scoreLocation(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  if (!c.location.trim() && !c.timezone.trim()) {
    return { score: 50, rationale: "Location and timezone not provided." };
  }
  const europeFocus = jobAnalysisIsEuropeFocused(jd);
  const europeHit = candidateMatchesEurope(c);
  const farFromEurope = europeFocus && candidateIsFarFromEurope(c);

  if (jd.locationType === "Remote") {
    const timezoneAligned =
      Boolean(c.timezone) &&
      Boolean(jd.timezone) &&
      (c.timezone.includes(jd.timezone) || jd.timezone.includes(c.timezone));
    const regionAligned =
      Boolean(c.location) &&
      jd.regions.some((region) => locationMatchesRegion(c.location, region));
    // Europe/EMEA focus: remote-ok must still prefer EU timezones.
    if (europeFocus) {
      if (timezoneAligned || europeHit || regionAligned) {
        return {
          score: timezoneAligned ? 97 : europeHit ? 94 : 90,
          rationale: timezoneAligned
            ? `Remote Europe/EMEA role: timezone ${c.timezone} overlaps CET/UK hours.`
            : europeHit
              ? `Remote Europe/EMEA role: Europe-based candidate (${c.location || c.timezone}).`
              : `Remote Europe/EMEA role: location ${c.location} matches a target region.`,
        };
      }
      if (farFromEurope) {
        return {
          score: 32,
          rationale: `Remote Europe/EMEA role: ${c.location || c.timezone} is outside European working hours.`,
        };
      }
      return {
        score: 58,
        rationale: "Remote Europe/EMEA role: European timezone/location not confirmed.",
      };
    }
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
  const inRegion =
    jd.regions.some((region) => locationMatchesRegion(c.location, region)) ||
    (jd.location ? locationMatchesRegion(c.location, jd.location) : false);
  if (europeFocus) {
    if (inRegion || europeHit) {
      return {
        score: inRegion ? 94 : 90,
        rationale: inRegion
          ? `Based in ${c.location}, within Europe/EMEA ${jd.locationType} range.`
          : `Europe signal present (${c.location || c.timezone}) for Europe-focused role.`,
      };
    }
    if (farFromEurope) {
      return {
        score: 28,
        rationale: `Based in ${c.location || c.timezone}, outside Europe/EMEA catchment.`,
      };
    }
    return {
      score: 48,
      rationale: `Based in ${c.location || "unknown"}, Europe/EMEA catchment not confirmed.`,
    };
  }
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
  const locationRequested = roleHasLocation(jd);
  const candidateHasLocation = Boolean(candidate.location.trim() || candidate.timezone.trim());

  return {
    skills,
    experience: {
      ...experience,
      state: !roleRequestsExperience
        ? "not_applicable"
        : candidate.yearsExperience != null
          ? "scored"
          : "unknown",
      rationale: !roleRequestsExperience
        ? "Not requested by this role."
        : candidate.yearsExperience != null
          ? experience.rationale
          : UNKNOWN_RATIONALE,
    },
    companyStage: {
      ...companyStage,
      state:
        jd.companyStageTarget.length === 0
          ? "not_applicable"
          : candidate.companyStageExperience.length > 0
            ? "scored"
            : "unknown",
      rationale:
        jd.companyStageTarget.length === 0
          ? "Not requested by this role."
          : candidate.companyStageExperience.length > 0
            ? companyStage.rationale
            : UNKNOWN_RATIONALE,
    },
    industry: {
      ...industry,
      state:
        jd.industryExperience.length === 0
          ? "not_applicable"
          : candidate.industryExperience.length > 0
            ? "scored"
            : "unknown",
      rationale:
        jd.industryExperience.length === 0
          ? "Not requested by this role."
          : candidate.industryExperience.length > 0
            ? industry.rationale
            : UNKNOWN_RATIONALE,
    },
    location: {
      ...location,
      state: !locationRequested ? "not_applicable" : candidateHasLocation ? "scored" : "unknown",
      rationale: !locationRequested
        ? "No location in the brief."
        : candidateHasLocation
          ? location.rationale
          : UNKNOWN_RATIONALE,
    },
    activity: {
      ...activity,
      state: hasActivitySignal ? "scored" : "not_applicable",
      rationale: hasActivitySignal ? activity.rationale : "Not requested by this role.",
    },
  };
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
    const effectiveScore = dim.state === "unknown" ? UNKNOWN_SCORE : dim.score;
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
