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

function lower(arr: string[]): string[] {
  return arr.map((s) => s.toLowerCase().trim());
}

function overlapCount(a: string[], b: string[]): number {
  const setB = new Set(lower(b));
  return lower(a).filter((x) => setB.has(x)).length;
}

function locationMatchesRegion(location: string, region: string): boolean {
  if (region.trim().toLowerCase() === "global") return true;
  const escaped = region
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return Boolean(escaped) && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(location);
}

/* ---- Individual dimension scorers (all return 0-100) --------------------- */

function scoreSkills(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const req = jd.requiredSkills;
  const nice = jd.niceToHaveSkills;
  const reqHit = overlapCount(req, c.techStack);
  const niceHit = overlapCount(nice, c.techStack);
  const reqRatio = req.length ? reqHit / req.length : 0.7;
  const niceRatio = nice.length ? niceHit / nice.length : 0;
  const score = clamp(reqRatio * 82 + niceRatio * 18, 0, 100);
  return {
    score,
    rationale: `${reqHit}/${req.length || "—"} required, ${niceHit}/${
      nice.length || "—"
    } nice-to-have skills present.`,
  };
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
  else if (/this week|days ago|active|shipped|merged|launched|speaking/.test(txt)) score = 92;
  else if (/this month|recently|published|maintains|contribut/.test(txt)) score = 80;
  else if (/last year|inactive|dormant|quiet/.test(txt)) score = 45;
  return { score, rationale: c.recentActivity };
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
  const dims: Record<keyof ScoringWeights, { score: number; rationale: string }> = {
    skills: scoreSkills(candidate, jd),
    experience: scoreExperience(candidate, jd),
    companyStage: scoreCompanyStage(candidate, jd),
    industry: scoreIndustry(candidate, jd),
    location: scoreLocation(candidate, jd),
    activity: scoreActivity(candidate),
  };

  const totalWeight =
    weights.skills +
    weights.experience +
    weights.companyStage +
    weights.industry +
    weights.location +
    weights.activity || 1;

  const keys = Object.keys(dims) as (keyof ScoringWeights)[];
  let composite = 0;
  const breakdown: MatchBreakdownItem[] = keys.map((key) => {
    const norm = weights[key] / totalWeight;
    const contribution = dims[key].score * norm;
    composite += contribution;
    return {
      key,
      label: DIMENSION_LABELS[key],
      score: round(dims[key].score),
      weight: round(norm, 3),
      contribution: round(contribution, 1),
      rationale: dims[key].rationale,
    };
  });

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
