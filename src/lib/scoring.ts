import type {
  Candidate,
  JobAnalysis,
  MatchBreakdownItem,
  ScoringWeights,
} from "./types";
import { clamp, round } from "./utils";
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

/**
 * Default dimension weights. Skills dominate so must-have JD fit drives the
 * composite. Volume is never the limiter — score the full set, then
 * `selectTopKByMatchScore` (quality rank), not first-N from API order.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  skills: 40,
  experience: 20,
  companyStage: 8,
  industry: 14,
  location: 12,
  activity: 6,
};

/** Default batch size for Source next batch when callers omit an explicit count. */
export const DEFAULT_SOURCE_BATCH_TOP_K = 10;

const TITLE_FLOOR_WITHOUT_MUST = 68;
const SYNTHETIC_SCORE_FACTOR = 0.92;
const WEAK_RESUME_SKILLS_FACTOR = 0.78;

const DOMAIN_SIGNAL_PATTERNS: { tag: string; re: RegExp }[] = [
  { tag: "Calypso", re: /\bcalypso\b/i },
  { tag: "CIB", re: /\bcib\b|corporate\s+investment\s+bank/i },
  { tag: "settlements", re: /\bsettlements?\b|trade\s+settlement/i },
  { tag: "back office", re: /\bback[\s-]?office\b/i },
  { tag: "MOA", re: /\bmoa\b|middle[\s-]?office/i },
  { tag: "FO", re: /\bfront[\s-]?office\b/i },
  { tag: "derivatives", re: /\bderivatives?\b|rates\s+and\s+credit/i },
  { tag: "trade lifecycle", re: /\btrade\s+lifecycle\b/i },
  { tag: "capital markets", re: /\bcapital\s+markets?\b/i },
  { tag: "Business Analysis", re: /\bbusiness\s+analys(?:is|t)s?\b/i },
];

const LANGUAGE_NAME_BY_CODE: Record<string, string[]> = {
  en: ["english", "anglais", "en"],
  fr: ["french", "français", "francais", "fr"],
  de: ["german", "deutsch", "de"],
  es: ["spanish", "español", "espanol", "es"],
  ar: ["arabic", "arabe", "ar"],
  ja: ["japanese", "ja"],
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
const ACTIVITY_MED_RE =
  /this month|recently|published|maintains|contribut|\d+\s+public\s+repos|active github profile/;
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
  if (locationMatchesEuropeMacro(loc, reg)) return true;
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


/** Build the free-text corpus used for skill/domain/language matching. */
export function buildCandidateCorpus(c: Candidate): string {
  return [
    c.techStack.join(" "),
    c.currentTitle,
    c.currentCompany,
    c.recentActivity,
    c.profileText ?? "",
    ...(c.experience ?? []),
    ...(c.education ?? []),
    ...(c.languages ?? []),
    ...(c.domainTags ?? []),
    ...(c.notes ?? []).map((n) => n.text),
  ]
    .filter(Boolean)
    .join(" ");
}

function extractDomainTagsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const hits: string[] = [];
  for (const { tag, re } of DOMAIN_SIGNAL_PATTERNS) {
    if (re.test(text) && !hits.some((h) => h.toLowerCase() === tag.toLowerCase())) {
      hits.push(tag);
    }
  }
  return hits;
}

function jdDomainTargets(jd: JobAnalysis): string[] {
  const fromMission = extractDomainTagsFromText(
    [jd.missionDescription ?? "", jd.title, jd.education, ...(jd.requiredSkills ?? [])].join(" "),
  );
  const out: string[] = [];
  for (const tag of [...jd.industryExperience, ...fromMission]) {
    if (!out.some((h) => h.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

function candidateDomainTags(c: Candidate, corpus: string): string[] {
  const out: string[] = [];
  for (const tag of [...(c.domainTags ?? []), ...extractDomainTagsFromText(corpus)]) {
    if (!out.some((h) => h.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** Languages the role requires. Only explicit `requiredLanguages` count. */
export function jdRequiredLanguages(jd: JobAnalysis): string[] {
  if (jd.requiredLanguages && jd.requiredLanguages.length > 0) {
    return jd.requiredLanguages.map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

function languageMentioned(lang: string, corpus: string, languages: string[] | undefined): boolean {
  const needle = lang.toLowerCase().trim();
  if (!needle) return false;
  if ((languages ?? []).some((l) => l.toLowerCase().includes(needle) || needle.includes(l.toLowerCase()))) {
    return true;
  }
  const codeEntry = Object.entries(LANGUAGE_NAME_BY_CODE).find(
    ([code, names]) => code === needle || names.includes(needle),
  );
  const aliases = codeEntry ? [codeEntry[0], ...codeEntry[1]] : [needle];
  const hay = corpus.toLowerCase();
  return aliases.some((alias) => {
    if (alias.length < 2) return false;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  });
}

function isWeakOrGenericResume(c: Candidate, corpus: string, reqHit: number): boolean {
  const trimmed = corpus.replace(/\s+/g, " ").trim();
  if (trimmed.length < 40 && c.techStack.length <= 1 && reqHit <= 1) return true;
  if (
    /seeking (new )?opportunit|open to work|professional with experience|results[\s-]driven|motivated individual/i.test(
      trimmed,
    ) &&
    reqHit <= 1
  ) {
    return true;
  }
  return false;
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
  const corpus = buildCandidateCorpus(c);
  const reqHits = req.filter((skill) => skillMentionedInText(skill, corpus));
  const niceHits = nice.filter((skill) => skillMentionedInText(skill, corpus));
  const reqHit = reqHits.length;
  const niceHit = niceHits.length;
  const reqRatio = req.length ? reqHit / req.length : 0.7;
  const niceRatio = nice.length ? niceHit / nice.length : 0;
  // Must-haves dominate (92/8). Missing most required skills cannot clear via nice-to-haves.
  let score = clamp(reqRatio * 92 + niceRatio * 8, 0, 100);
  if (req.length > 0 && reqHit === 0) score = Math.min(score, 28);
  else if (req.length > 0 && reqRatio < 0.5) score = Math.min(score, 55);

  const titleOverlap = titleOverlapRatio(c.currentTitle, jd.title);
  const allowStrongTitleFloor = reqHit >= Math.max(1, Math.ceil((req.length || 1) * 0.4));
  if (c.provenance !== "synthetic") {
    if (titleOverlap >= 0.5 && allowStrongTitleFloor) score = Math.max(score, 82);
    else if (titleOverlap >= 0.5 && reqHit >= 1) score = Math.max(score, TITLE_FLOOR_WITHOUT_MUST);
    if (titleOverlap >= 0.6 && allowStrongTitleFloor) score = Math.max(score, 86);
    if (titleOverlap >= 0.9 && allowStrongTitleFloor) score = Math.max(score, 92);
  }
  if (c.sourcePlatform === "GitHub" && c.provenance !== "synthetic" && reqHit >= 1) {
    score = Math.max(score, 82);
    if (reqHit >= 2) score = Math.max(score, 86);
    if (reqHit >= 3) score = Math.max(score, 90);
  }

  if (isWeakOrGenericResume(c, corpus, reqHit)) {
    score = round(score * WEAK_RESUME_SKILLS_FACTOR);
  }

  const missingMust = req.filter((s) => !reqHits.includes(s));
  const mustPart =
    req.length === 0
      ? "no must-have list on JD"
      : `${reqHit}/${req.length} must-have (${reqHits.slice(0, 4).join(", ") || "none"}${
          reqHits.length > 4 ? "…" : ""
        })`;
  const missPart =
    missingMust.length > 0
      ? `; missing must-have: ${missingMust.slice(0, 3).join(", ")}${missingMust.length > 3 ? "…" : ""}`
      : "";
  const nicePart = `${niceHit}/${nice.length || "—"} nice-to-have`;
  const titlePart = titleOverlap >= 0.5 ? `; title aligns with ${jd.title}` : "";

  return {
    score,
    rationale: `${mustPart}; ${nicePart}${missPart}${titlePart}.`,
  };
}

export function skillMentionedInText(skill: string, corpus: string): boolean {
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
    return { score: 50, rationale: "Experience not provided — years never fabricated." };
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
    const bandMin = min ?? yrs;
    const bandMax = max ?? min ?? yrs;
    const mid = (bandMin + bandMax) / 2;
    const dist = Math.abs(yrs - mid);
    const span = Math.max(1, bandMax - bandMin);
    score = clamp(98 - (dist / span) * 10, 88, 98);
    rationale = `${yrs} yrs lands inside the target band${
      min != null && max != null ? ` (${min}–${max})` : min != null ? ` (≥${min})` : ""
    }.`;
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
  const domainTargets = jdDomainTargets(jd);
  const corpus = buildCandidateCorpus(c);
  const candDomains = candidateDomainTags(c, corpus);
  const domainHit = domainTargets.filter((t) =>
    candDomains.some((d) => d.toLowerCase() === t.toLowerCase()) ||
    skillMentionedInText(t, corpus),
  );

  if (target.length === 0 && domainTargets.length === 0) {
    return { score: 72, rationale: "No industry/domain preference set." };
  }

  const structuredHit =
    target.length === 0 || c.industryExperience.length === 0
      ? 0
      : overlapCount(c.industryExperience, target);
  const structuredRatio = target.length ? structuredHit / target.length : 0;
  const domainRatio = domainTargets.length ? domainHit.length / domainTargets.length : 0;

  let score: number;
  if (target.length === 0) {
    score = clamp(42 + domainRatio * 58, 35, 100);
  } else if (c.industryExperience.length === 0 && domainHit.length === 0) {
    score = 50;
  } else {
    score = clamp(40 + structuredRatio * 35 + domainRatio * 25, 35, 100);
  }

  const parts: string[] = [];
  if (structuredHit > 0) {
    parts.push(`Shares ${structuredHit} target industry vertical${structuredHit === 1 ? "" : "s"}`);
  } else if (target.length > 0 && c.industryExperience.length > 0) {
    parts.push("Adjacent industries only");
  } else if (target.length > 0 && c.industryExperience.length === 0) {
    parts.push("Industry experience not provided");
  }
  if (domainHit.length > 0) {
    parts.push(
      `domain signals: ${domainHit.slice(0, 4).join(", ")}${domainHit.length > 4 ? "…" : ""}`,
    );
  } else if (domainTargets.length > 0) {
    parts.push(`no domain hits among ${domainTargets.slice(0, 3).join(", ")}`);
  }

  return {
    score,
    rationale: `${parts.join("; ") || "No industry/domain evidence"}.`,
  };
}

function scoreLocation(c: Candidate, jd: JobAnalysis): { score: number; rationale: string } {
  const requiredLangs = jdRequiredLanguages(jd);
  const corpus = buildCandidateCorpus(c);
  let langScore: number | null = null;
  let langRationale = "";
  if (requiredLangs.length > 0) {
    const langHits = requiredLangs.filter((lang) =>
      languageMentioned(lang, corpus, c.languages),
    );
    const langRatio = langHits.length / requiredLangs.length;
    if (langHits.length === 0 && !(c.languages?.length) && corpus.trim().length < 80) {
      langScore = 55;
      langRationale = `Language (${requiredLangs.join(", ")}) unverified on thin profile`;
    } else if (langHits.length === 0) {
      langScore = 38;
      langRationale = `Missing required language fluency: ${requiredLangs.join(", ")}`;
    } else {
      langScore = clamp(70 + langRatio * 30, 70, 100);
      langRationale = `Language fluency: ${langHits.join(", ")} (${langHits.length}/${requiredLangs.length} required)`;
    }
  }

  const hasGeo = Boolean(c.location.trim() || c.timezone.trim());
  if (!hasGeo && langScore == null) {
    return { score: 50, rationale: "Location and timezone not provided." };
  }

  let geoScore: number;
  let geoRationale: string;
  const europeFocus = jobAnalysisIsEuropeFocused(jd);
  const europeHit = candidateMatchesEurope(c);
  const farFromEurope = europeFocus && candidateIsFarFromEurope(c);
  const montrealTarget =
    jd.regions.some((r) => /montreal|montréal/i.test(r)) ||
    /montreal|montréal/i.test(jd.location ?? "");
  const montrealHit = /montreal|montréal/i.test(c.location);

  if (!hasGeo) {
    geoScore = 50;
    geoRationale = "Location not provided";
  } else if (jd.locationType === "Remote") {
    const timezoneAligned =
      Boolean(c.timezone) &&
      Boolean(jd.timezone) &&
      (c.timezone.includes(jd.timezone) || jd.timezone.includes(c.timezone));
    const regionAligned =
      Boolean(c.location) &&
      jd.regions.some((region) => locationMatchesRegion(c.location, region));
    // Europe/EMEA focus: remote-ok / international must still prefer EU timezones.
    // Far Americas/Asia get a hard dampen so geo moves ranking, not soft noise.
    if (europeFocus) {
      if (timezoneAligned || europeHit || regionAligned) {
        geoScore = timezoneAligned ? 97 : europeHit ? 94 : 90;
        geoRationale = timezoneAligned
          ? `Remote Europe/EMEA role: timezone ${c.timezone} overlaps CET/UK hours`
          : europeHit
            ? `Remote Europe/EMEA role: Europe-based candidate (${c.location || c.timezone})`
            : `Remote Europe/EMEA role: location ${c.location} matches a target region`;
      } else if (farFromEurope) {
        geoScore = 32;
        geoRationale = `Remote Europe/EMEA role: ${c.location || c.timezone} is outside European working hours`;
      } else {
        geoScore = 58;
        geoRationale =
          "Remote Europe/EMEA role: European timezone/location not confirmed";
      }
    } else {
      geoScore = timezoneAligned
        ? 96
        : regionAligned
          ? 90
          : montrealTarget && montrealHit
            ? 92
            : 80;
      geoRationale = timezoneAligned
        ? `Remote role: timezone ${c.timezone} overlaps working hours`
        : regionAligned
          ? `Remote role: location ${c.location} matches a target region`
          : montrealTarget && montrealHit
            ? `Remote role: Montreal signal present (${c.location})`
            : "Remote role: working-hours overlap not confirmed";
    }
  } else {
    const inRegion =
      jd.regions.some((region) => locationMatchesRegion(c.location, region)) ||
      (jd.location ? locationMatchesRegion(c.location, jd.location) : false);
    if (europeFocus) {
      if (inRegion || europeHit) {
        geoScore = inRegion ? 94 : 90;
        geoRationale = inRegion
          ? `Based in ${c.location}, within Europe/EMEA ${jd.locationType} range`
          : `Europe signal present (${c.location || c.timezone}) for Europe-focused role`;
      } else if (farFromEurope) {
        geoScore = 28;
        geoRationale = `Based in ${c.location || c.timezone}, outside Europe/EMEA catchment`;
      } else {
        geoScore = 48;
        geoRationale = `Based in ${c.location || "unknown"}, Europe/EMEA catchment not confirmed`;
      }
    } else {
      geoScore = inRegion ? 92 : montrealTarget && montrealHit ? 90 : 48;
      geoRationale = inRegion
        ? `Based in ${c.location}, within ${jd.locationType} range`
        : montrealTarget && montrealHit
          ? `Montreal signal present (${c.location}) for target geography`
          : `Based in ${c.location || "unknown"}, outside ${jd.locationType} catchment`;
    }
  }

  if (langScore == null) {
    return { score: geoScore, rationale: `${geoRationale}.` };
  }
  const score = round(geoScore * 0.55 + langScore * 0.45);
  return {
    score: clamp(score, 0, 100),
    rationale: `${geoRationale}; ${langRationale}.`,
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
  const corpus = buildCandidateCorpus(candidate);
  const skillsEvidence =
    candidate.techStack.length > 0 ||
    reqHitFromCorpus(candidate, jd) > 0 ||
    titleOverlapRatio(candidate.currentTitle, jd.title) >= 0.5 ||
    Boolean(candidate.profileText?.trim());
  const industryEvidence =
    candidate.industryExperience.length > 0 ||
    candidateDomainTags(candidate, corpus).length > 0 ||
    (jdDomainTargets(jd).length > 0 &&
      jdDomainTargets(jd).some((t) => skillMentionedInText(t, corpus)));

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
        jd.industryExperience.length === 0 && jdDomainTargets(jd).length === 0
          ? "not_applicable"
          : industryEvidence
            ? "scored"
            : liveSparse
              ? "not_applicable"
              : "unknown",
      rationale:
        jd.industryExperience.length === 0 && jdDomainTargets(jd).length === 0
          ? "Not requested by this role."
          : industryEvidence
            ? industry.rationale
            : liveSparse
              ? "Not available from this source."
              : UNKNOWN_RATIONALE,
    },
    location: {
      ...location,
      state:
        candidate.location.trim() ||
        candidate.timezone.trim() ||
        jdRequiredLanguages(jd).length > 0
          ? "scored"
          : liveSparse
            ? "not_applicable"
            : "unknown",
      rationale:
        candidate.location.trim() ||
        candidate.timezone.trim() ||
        jdRequiredLanguages(jd).length > 0
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
  const corpus = buildCandidateCorpus(candidate);
  return jd.requiredSkills.filter((skill) => skillMentionedInText(skill, corpus)).length;
}

/** Must-have skill hit count — used as a ranking tie-breaker. */
export function requiredSkillHitCount(candidate: Candidate, jd: JobAnalysis): number {
  return reqHitFromCorpus(candidate, jd);
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
  let composite = breakdown.reduce((sum, item) => sum + item.contribution, 0);

  if (candidate.provenance === "synthetic") {
    // Dampen scored dimensions (display + contribution) so a skills-only
    // composite still equals the skills dimension score.
    for (const item of breakdown) {
      if (item.weight > 0) {
        item.score = round(clamp(item.score * SYNTHETIC_SCORE_FACTOR, 0, 100));
        item.contribution = round(item.score * item.weight, 1);
      }
    }
    composite = breakdown.reduce((sum, item) => sum + item.contribution, 0);
    const skillsItem = breakdown.find((b) => b.key === "skills");
    if (skillsItem) {
      skillsItem.rationale = `${skillsItem.rationale.replace(/\.$/, "")}; synthetic provenance dampened.`;
    }
  }

  return { score: round(clamp(composite, 0, 100)), breakdown };
}


export type RankableCandidate = Pick<
  Candidate,
  | "id"
  | "name"
  | "matchScore"
  | "techStack"
  | "yearsExperience"
  | "provenance"
  | "profileText"
  | "domainTags"
  | "languages"
  | "recentActivity"
  | "currentTitle"
  | "currentCompany"
  | "notes"
  | "experience"
  | "education"
>;

/**
 * Stable ordering: highest matchScore first, then denser must-have evidence,
 * verified years, live provenance, then id. Never trust API order.
 */
export function compareCandidatesByScore(
  a: RankableCandidate,
  b: RankableCandidate,
  jd?: JobAnalysis,
): number {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  if (jd) {
    const aHits = requiredSkillHitCount(a as Candidate, jd);
    const bHits = requiredSkillHitCount(b as Candidate, jd);
    if (bHits !== aHits) return bHits - aHits;
  }
  const aYears = a.yearsExperience != null ? 1 : 0;
  const bYears = b.yearsExperience != null ? 1 : 0;
  if (bYears !== aYears) return bYears - aYears;
  const provenanceRank = (prov: RankableCandidate["provenance"]) =>
    prov === "live" ? 3 : prov === "manual" ? 2 : prov === "synthetic" ? 0 : 1;
  const pDiff = provenanceRank(b.provenance) - provenanceRank(a.provenance);
  if (pDiff !== 0) return pDiff;
  return a.id.localeCompare(b.id);
}

export function rankScoredCandidates<T extends RankableCandidate>(
  candidates: T[],
  jd?: JobAnalysis,
): T[] {
  return [...candidates].sort((a, b) => compareCandidatesByScore(a, b, jd));
}

/**
 * Select the best `topK` after quality ranking.
 * **Volume is not the limiter** — always score/rank the full set, then take top-K.
 */
export function selectTopKByMatchScore<T extends RankableCandidate>(
  candidates: T[],
  topK: number = DEFAULT_SOURCE_BATCH_TOP_K,
  jd?: JobAnalysis,
): T[] {
  const k = Number.isFinite(topK) ? Math.max(0, Math.floor(topK)) : DEFAULT_SOURCE_BATCH_TOP_K;
  return rankScoredCandidates(candidates, jd).slice(0, k);
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
