/**
 * Hard gates for mandatory JobAnalysis criteria.
 *
 * Soft dampening alone is not enough: missing a must-have skill, a required
 * language (when verifiable), an impossible geo, or a known seniority miss
 * must keep a candidate out of the quality shortlist / top-K.
 *
 * Intentionally does NOT import from scoring.ts (avoids circular deps —
 * scoring calls evaluateHardGates after composing the soft score).
 */
import {
  candidateIsFarFromEurope,
  jobAnalysisIsEuropeFocused,
} from "@/lib/geo-europe";
import type { Candidate, JobAnalysis, MatchEvidence } from "@/lib/types";

export type { MatchEvidence };

export interface HardGateResult {
  pass: boolean;
  reasons: string[];
  evidence: MatchEvidence;
}

const LANGUAGE_NAME_BY_CODE: Record<string, string[]> = {
  en: ["english", "anglais", "en"],
  fr: ["french", "français", "francais", "fr"],
  de: ["german", "deutsch", "de"],
  es: ["spanish", "español", "espanol", "es"],
  ar: ["arabic", "arabe", "ar"],
  ja: ["japanese", "ja"],
};

function buildCorpus(c: Candidate): string {
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

function skillMentioned(skill: string, corpus: string): boolean {
  const hay = corpus.toLowerCase();
  const needle = skill.toLowerCase().trim();
  if (!needle || !hay) return false;
  if (hay.includes(needle)) return true;
  const acronyms = [...needle.matchAll(/\(([a-z0-9+.#]{2,})\)/gi)].map((m) => m[1]!.toLowerCase());
  if (
    acronyms.some((acronym) =>
      new RegExp(`(?:^|[^a-z0-9])${acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(hay),
    )
  ) {
    return true;
  }
  const stop = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "into",
    "software",
    "systems",
    "management",
    "regulations",
  ]);
  const tokens = needle
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9+.#]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !stop.has(t));
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  });
  return hits.length >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function languageMentioned(
  lang: string,
  corpus: string,
  languages: string[] | undefined,
): boolean {
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

/** Detect Open to Work / actively looking signals on a candidate. */
export function candidateOpenToWorkSignal(
  candidate: Pick<Candidate, "openToWork" | "recentActivity" | "profileText" | "notes">,
): boolean {
  if (candidate.openToWork === true) return true;
  const hay = [
    candidate.recentActivity ?? "",
    candidate.profileText ?? "",
    ...(candidate.notes ?? []).map((n) => n.text),
  ]
    .join(" ")
    .toLowerCase();
  return /open\s+to\s+work|actively\s+looking|seeking\s+(new\s+)?opportunit|available\s+(for|to)\s+(work|opportunit)|#opentowork/i.test(
    hay,
  );
}

function mustHaveHitsMisses(
  candidate: Candidate,
  jd: JobAnalysis,
): { hits: string[]; misses: string[] } {
  const corpus = buildCorpus(candidate);
  const hits: string[] = [];
  const misses: string[] = [];
  for (const skill of jd.requiredSkills ?? []) {
    if (skillMentioned(skill, corpus)) hits.push(skill);
    else misses.push(skill);
  }
  return { hits, misses };
}

function languageHitsMisses(
  candidate: Candidate,
  jd: JobAnalysis,
): { hits: string[]; misses: string[]; verifiable: boolean } {
  const required = (jd.requiredLanguages ?? []).map((l) => l.trim()).filter(Boolean);
  if (required.length === 0) return { hits: [], misses: [], verifiable: false };
  const corpus = buildCorpus(candidate);
  const hits = required.filter((lang) => languageMentioned(lang, corpus, candidate.languages));
  const misses = required.filter((lang) => !hits.includes(lang));
  const verifiable =
    (candidate.languages?.length ?? 0) > 0 ||
    hits.length > 0 ||
    corpus.replace(/\s+/g, " ").trim().length >= 120;
  return { hits, misses, verifiable };
}

function geoHardPass(candidate: Candidate, jd: JobAnalysis): boolean {
  const hasLoc = Boolean(candidate.location?.trim() || candidate.timezone?.trim());
  if (!hasLoc) return true;
  if (jobAnalysisIsEuropeFocused(jd) && candidateIsFarFromEurope(candidate)) {
    return false;
  }
  return true;
}

function seniorityHardPass(candidate: Candidate, jd: JobAnalysis): boolean | null {
  const yrs = candidate.yearsExperience;
  if (yrs == null) return null;
  const min = jd.minYearsExperience;
  const max = jd.maxYearsExperience;
  if (min == null && max == null) return null;
  if (min != null && yrs < min) return false;
  if (max != null && yrs > max) return false;
  return true;
}

function buildSummary(evidence: Omit<MatchEvidence, "summary">): string {
  if (!evidence.hardGatePass) {
    return `Hard reject: ${evidence.hardGateReasons.join("; ")}`;
  }
  const mustTotal = evidence.mustHaveHits.length + evidence.mustHaveMisses.length;
  const must =
    mustTotal === 0
      ? "no must-have list"
      : `${evidence.mustHaveHits.length}/${mustTotal} must-haves (${evidence.mustHaveHits.slice(0, 3).join(", ") || "none"})`;
  const langTotal = evidence.languageHits.length + evidence.languageMisses.length;
  const lang =
    langTotal === 0
      ? "no language requirement"
      : `languages ${evidence.languageHits.join(", ") || "none"}`;
  const otw = evidence.openToWork ? "; Open to Work" : "";
  const senior =
    evidence.seniorityPass === null
      ? ""
      : evidence.seniorityPass
        ? "; seniority in band"
        : "; seniority out of band";
  return `Fit: ${must}; ${lang}; geo ${evidence.geoPass ? "ok" : "fail"}${senior}${otw}.`;
}

/** Evaluate mandatory gates + structured match evidence for a candidate vs JD. */
export function evaluateHardGates(candidate: Candidate, jd: JobAnalysis): HardGateResult {
  const { hits: mustHaveHits, misses: mustHaveMisses } = mustHaveHitsMisses(candidate, jd);
  const {
    hits: languageHits,
    misses: languageMisses,
    verifiable: langVerifiable,
  } = languageHitsMisses(candidate, jd);
  const geoPass = geoHardPass(candidate, jd);
  const seniorityPass = seniorityHardPass(candidate, jd);
  const openToWork = candidateOpenToWorkSignal(candidate);

  const reasons: string[] = [];
  if (mustHaveMisses.length > 0) {
    reasons.push(`Missing must-have: ${mustHaveMisses.slice(0, 4).join(", ")}`);
  }
  if (langVerifiable && languageMisses.length > 0) {
    reasons.push(`Missing required language: ${languageMisses.join(", ")}`);
  }
  if (!geoPass) {
    reasons.push(`Impossible geo for this need (${candidate.location || candidate.timezone})`);
  }
  if (seniorityPass === false) {
    const band =
      jd.minYearsExperience != null && jd.maxYearsExperience != null
        ? `${jd.minYearsExperience}–${jd.maxYearsExperience}`
        : jd.minYearsExperience != null
          ? `≥${jd.minYearsExperience}`
          : `≤${jd.maxYearsExperience}`;
    reasons.push(`Years ${candidate.yearsExperience} outside seniority band ${band}`);
  }

  const hardGatePass = reasons.length === 0;
  const evidenceBase = {
    mustHaveHits,
    mustHaveMisses,
    languageHits,
    languageMisses,
    geoPass,
    seniorityPass,
    openToWork,
    hardGatePass,
    hardGateReasons: reasons,
  };
  const evidence: MatchEvidence = {
    ...evidenceBase,
    summary: buildSummary(evidenceBase),
  };
  return { pass: hardGatePass, reasons, evidence };
}

/** True when candidate clears every hard gate for this JD. */
export function passesHardGates(candidate: Candidate, jd: JobAnalysis): boolean {
  return evaluateHardGates(candidate, jd).pass;
}
