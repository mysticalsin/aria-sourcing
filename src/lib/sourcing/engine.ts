/**
 * Aria sourcing engine — need in, scored shortlist out.
 * Contract: docs/sourcing-engine/DESIGN.md
 *
 * Product platforms (Calypso, Murex, …) are skills on a need, never people.
 * Display names are stripped before matching. Empty and name-only hits fail.
 */

import { extractPdfText } from "@/lib/sourcing/ocr";
import { isVssRecruitmentNeed, parseVssNeeds, vssToSourcingNeed } from "@/lib/sourcing/vss-need";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export const SHORTLIST_FLOOR = 60;
export const SHORTLIST_CAP = 20;

export const SKILLS_WEIGHT = 0.5;
export const CV_WEIGHT = 0.3;
export const LINKEDIN_WEIGHT = 0.2;

/** Capital-markets platforms and adjacent skills. Platforms are tools, not names. */
export const PLATFORM_SKILLS = [
  "Calypso",
  "Murex",
  "Summit",
  "Kondor",
  "Sophis",
  "Front Arena",
  "Bloomberg",
  "Reuters",
  "Fidessa",
  "Charles River",
  "Aladdin",
  "Trade Capture",
  "FO/BO",
  "SQL",
  "MySQL",
  "Linux",
  "Linux Server",
  "Python",
  "Shell",
  "Oracle",
  "Grafana",
  "Dynatrace",
  "Business Analysis",
  "Prime Brokerage",
  "Capital Markets",
  "Risk",
  "Pricing",
  "Settlement",
  "Collateral",
] as const;

export type NeedSource = "paste" | "email" | "upload";

export interface SourcingNeed {
  title: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  experienceSignals: string[];
  minYearsExperience: number | null;
  industry: string[];
  source: NeedSource;
  rawText: string;
}

export interface CandidateEvidence {
  id: string;
  name: string;
  skills: string[];
  cvText: string;
  linkedinText: string;
  yearsExperience: number | null;
  provenance: "fixture" | "live";
}

export type RejectReason = "name_only" | "empty" | "below_floor" | "no_skills_need";

export interface ScoreBreakdown {
  skills: number;
  cv: number;
  linkedin: number;
  composite: number;
  requiredHits: string[];
  cvHits: string[];
  linkedinHits: string[];
}

export interface ScoredRow {
  id: string;
  name: string;
  score: number;
  breakdown: ScoreBreakdown;
  provenance: "fixture" | "live";
  ineligible: boolean;
  reason: RejectReason | null;
}

export interface ShortlistResult {
  need: SourcingNeed;
  shortlist: ScoredRow[];
  rejected: ScoredRow[];
}

export type ParseNeedFailure =
  | { ok: false; code: "EMPTY_INPUT" | "OCR_REQUIRED" | "NOT_PDF" | "NO_SKILLS" }
  | { ok: true; need: SourcingNeed };

export const LIVE_PROVIDER_ENV: Record<string, readonly string[]> = {
  apollo: ["APOLLO_API_KEY"],
  sillage: ["SILLAGE_API_KEY"],
  seamless: ["SEAMLESS_API_KEY"],
  apify: ["APIFY_TOKEN", "APIFY_API_TOKEN"],
  github: ["GITHUB_TOKEN"],
};

export function configuredLiveProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(LIVE_PROVIDER_ENV)
    .filter(([, keys]) => keys.some((key) => Boolean(env[key]?.trim())))
    .map(([name]) => name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

export function stripNameTokens(text: string, name: string): string {
  let hay = (text ?? "").toLowerCase();
  for (const token of nameTokens(name)) {
    hay = hay.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "g"), " ");
  }
  return hay.replace(/\s+/g, " ").trim();
}

function field(label: string, text: string): string {
  return text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

function uniqueSkills(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function dictionaryHits(text: string): string[] {
  return PLATFORM_SKILLS.filter((skill) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(skill)}([^a-z0-9]|$)`, "i").test(text),
  );
}

function inferTitle(text: string): string {
  return (
    text.match(/this need is now active\s*:?\s*(.+)/i)?.[1]?.trim() ||
    text.match(/(?:role|position|title|subject|need)\s*[:—-]\s*(.+)/i)?.[1]?.trim() ||
    text.match(/([A-Z][\w/ +.-]{3,60}?(?:Analyst|Consultant|Engineer|Developer|Manager|Lead))/i)?.[1]?.trim() ||
    "Trading platform role"
  );
}

function inferYears(text: string): number | null {
  const match = text.match(/minimum[\s]{0,6}(\d{1,2})[\s+]{0,6}years/i) ?? text.match(/(\d{1,2})\+?\s+years/i);
  return match ? parseInt(match[1] ?? "", 10) : null;
}

function inferSignals(text: string, skills: string[]): string[] {
  const phrases = [
    "trade capture",
    "trading platform",
    "front office",
    "back office",
    "fo/bo",
    "implementation",
    "capital markets",
    "settlement",
    "settlements",
    "collateral",
    "pricing",
    "production support",
    "trade life cycle",
    "trade lifecycle",
    "prime brokerage",
    "securities",
    "t+1",
    "business analysis",
  ].filter((phrase) => text.toLowerCase().includes(phrase));
  return uniqueSkills([...skills, ...phrases]);
}

export function parseNeedFromText(text: string, source: NeedSource): ParseNeedFailure {
  const raw = (text ?? "").trim().slice(0, 20_000);
  if (!raw) return { ok: false, code: "EMPTY_INPUT" };

  if (isVssRecruitmentNeed(raw)) {
    const vss = parseVssNeeds(raw);
    if (vss[0]) return { ok: true, need: vssToSourcingNeed(vss[0], source, raw) };
  }

  const skillsLine =
    field("Skills", raw) ||
    field("Required skills", raw) ||
    raw.match(/required skills?:\s*([^\n]+)/i)?.[1]?.trim() ||
    "";
  const niceLine = field("Nice to have", raw) || field("Nice-to-have", raw);
  const splitList = (line: string) =>
    line
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  const lineSkills = splitList(skillsLine);
  const requiredSkills = uniqueSkills(
    lineSkills.length ? lineSkills : dictionaryHits(skillsLine || raw.split(/nice to have/i)[0] || raw),
  ).slice(0, 12);
  if (requiredSkills.length === 0) return { ok: false, code: "NO_SKILLS" };

  const niceToHaveSkills = uniqueSkills([
    ...splitList(niceLine),
    ...PLATFORM_SKILLS.filter(
      (skill) =>
        !requiredSkills.some((r) => r.toLowerCase() === skill.toLowerCase()) &&
        new RegExp(`nice[^\\n]{0,40}${escapeRegExp(skill)}`, "i").test(raw),
    ),
  ]);

  const industry = /capital markets|trading|finance|bonds|equities/i.test(raw) ? ["Capital Markets"] : [];

  return {
    ok: true,
    need: {
      title: inferTitle(raw).slice(0, 200),
      requiredSkills,
      niceToHaveSkills,
      experienceSignals: inferSignals(raw, requiredSkills),
      minYearsExperience: inferYears(raw),
      industry,
      source,
      rawText: raw,
    },
  };
}

export function parseNeed(input: {
  jd?: string;
  email?: string;
  pdfBytes?: Uint8Array;
}): ParseNeedFailure {
  if (input.pdfBytes && input.pdfBytes.length > 0) {
    const extracted = extractPdfText(input.pdfBytes);
    if (!extracted.ok) return { ok: false, code: extracted.code };
    return parseNeedFromText(extracted.text, "upload");
  }
  const email = input.email?.trim() ?? "";
  const jd = input.jd?.trim() ?? "";
  const combined = `${email}\n${jd}`.trim();
  if (email && (isVssRecruitmentNeed(email) || isVssRecruitmentNeed(combined))) {
    return parseNeedFromText(combined || email, "email");
  }
  if (email && /this need is now|key required skills|^\s*recruiter\s*:/im.test(email)) {
    return parseNeedFromText(`${email}\n${jd}`, "email");
  }
  if (jd) return parseNeedFromText(jd, "paste");
  if (email) return parseNeedFromText(email, "email");
  return { ok: false, code: "EMPTY_INPUT" };
}

function neutralizeNegations(haystack: string, tokens: string[]): string {
  let out = haystack.toLowerCase();
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (!t) continue;
    out = out.replace(new RegExp(`\\bnot\\s+${escapeRegExp(t)}\\b`, "g"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function overlapHits(need: string[], haystack: string): string[] {
  const lower = neutralizeNegations(haystack, need);
  return need.filter((skill) => {
    const token = skill.toLowerCase();
    return token.length > 0 && lower.includes(token);
  });
}

function channelScore(hits: number, total: number): number {
  if (total <= 0) return 0;
  return clamp((hits / total) * 100, 0, 100);
}

function evidenceHaystack(candidate: CandidateEvidence): string {
  return `${candidate.skills.join(" ")} ${candidate.cvText} ${candidate.linkedinText}`;
}

export function isNameOnlyHit(need: SourcingNeed, candidate: CandidateEvidence): boolean {
  const required = need.requiredSkills;
  const nameSet = new Set(nameTokens(candidate.name));
  const requiredInName = required.filter((skill) => nameSet.has(skill.toLowerCase()));
  if (requiredInName.length === 0) return false;
  const stripped = neutralizeNegations(stripNameTokens(evidenceHaystack(candidate), candidate.name), required);
  const requiredInEvidence = overlapHits(required, stripped);
  return requiredInEvidence.length === 0;
}

export function isEmptyEvidence(candidate: CandidateEvidence): boolean {
  return (
    candidate.skills.every((s) => !s.trim()) &&
    !candidate.cvText.trim() &&
    !candidate.linkedinText.trim()
  );
}

export function scoreEvidence(need: SourcingNeed, candidate: CandidateEvidence): ScoredRow {
  if (isEmptyEvidence(candidate)) {
    return {
      id: candidate.id,
      name: candidate.name,
      score: 0,
      breakdown: {
        skills: 0,
        cv: 0,
        linkedin: 0,
        composite: 0,
        requiredHits: [],
        cvHits: [],
        linkedinHits: [],
      },
      provenance: candidate.provenance,
      ineligible: true,
      reason: "empty",
    };
  }

  if (isNameOnlyHit(need, candidate)) {
    return {
      id: candidate.id,
      name: candidate.name,
      score: 0,
      breakdown: {
        skills: 0,
        cv: 0,
        linkedin: 0,
        composite: 0,
        requiredHits: [],
        cvHits: [],
        linkedinHits: [],
      },
      provenance: candidate.provenance,
      ineligible: true,
      reason: "name_only",
    };
  }

  const skillHay = stripNameTokens(candidate.skills.join(" "), candidate.name);
  const cvHay = stripNameTokens(candidate.cvText, candidate.name);
  const liHay = stripNameTokens(candidate.linkedinText, candidate.name);

  const requiredHits = overlapHits(need.requiredSkills, skillHay);
  const niceHits = overlapHits(need.niceToHaveSkills, skillHay);
  const reqRatio = need.requiredSkills.length ? requiredHits.length / need.requiredSkills.length : 0;
  const niceRatio = need.niceToHaveSkills.length ? niceHits.length / need.niceToHaveSkills.length : 0;
  const skillsScore = clamp(reqRatio * 80 + niceRatio * 20, 0, 100);

  const cvHits = overlapHits(need.experienceSignals, cvHay);
  let cvScore = channelScore(cvHits.length, need.experienceSignals.length || 1);
  if (
    cvHits.length > 0 &&
    need.minYearsExperience != null &&
    candidate.yearsExperience != null &&
    candidate.yearsExperience >= need.minYearsExperience
  ) {
    cvScore = clamp(cvScore + 10, 0, 100);
  }
  if (cvHits.length === 0) cvScore = 0;

  const linkedinHits = overlapHits(need.experienceSignals, liHay);
  const linkedinScore = linkedinHits.length === 0 ? 0 : channelScore(linkedinHits.length, need.experienceSignals.length || 1);

  const composite = round(skillsScore * SKILLS_WEIGHT + cvScore * CV_WEIGHT + linkedinScore * LINKEDIN_WEIGHT);
  const below = composite < SHORTLIST_FLOOR;
  return {
    id: candidate.id,
    name: candidate.name,
    score: composite,
    breakdown: {
      skills: round(skillsScore),
      cv: round(cvScore),
      linkedin: round(linkedinScore),
      composite,
      requiredHits,
      cvHits,
      linkedinHits,
    },
    provenance: candidate.provenance,
    ineligible: below,
    reason: below ? "below_floor" : null,
  };
}

export function shortlistNeed(
  need: SourcingNeed,
  pool: CandidateEvidence[],
  cap = SHORTLIST_CAP,
): ShortlistResult {
  const limit = Math.min(Math.max(1, cap), SHORTLIST_CAP);
  const scored = pool.map((candidate) => scoreEvidence(need, candidate));
  const eligible = scored
    .filter((row) => !row.ineligible && row.score >= SHORTLIST_FLOOR)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    need,
    shortlist: eligible.slice(0, limit),
    rejected: scored.filter((row) => row.ineligible || row.score < SHORTLIST_FLOOR),
  };
}

export interface EngineRunInput {
  jd?: string;
  email?: string;
  pdfBytes?: Uint8Array;
  mode: "fixture" | "live";
  count?: number;
  pool?: CandidateEvidence[];
}

export type EngineRunResult =
  | { ok: true; result: ShortlistResult; mode: "fixture" | "live" }
  | {
      ok: false;
      code: "EMPTY_INPUT" | "OCR_REQUIRED" | "NOT_PDF" | "NO_SKILLS" | "PROVIDER_NOT_CONFIGURED";
      paths?: [string, string, string];
    };

const BLOCKED_PATHS = {
  OCR_REQUIRED: [
    "Re-export the PDF with a text layer, or paste the JD/CV text.",
    "Configure an OCR sensor and retry the upload.",
    "Use the fixture path to prove the matcher without a scanned file.",
  ] as [string, string, string],
  PROVIDER_NOT_CONFIGURED: [
    "Run mode=fixture to prove the matcher on recorded evidence.",
    "Add a live provider key (Apollo, Sillage, Seamless, Apify, or GitHub) in Settings.",
    "Paste the JD and score CVs Aria already holds — do not invent live people.",
  ] as [string, string, string],
};

export function runSourcingEngine(input: EngineRunInput): EngineRunResult {
  const parsed = parseNeed(input);
  if (!parsed.ok) {
    return parsed.code === "OCR_REQUIRED"
      ? { ok: false, code: parsed.code, paths: BLOCKED_PATHS.OCR_REQUIRED }
      : { ok: false, code: parsed.code };
  }

  if (input.mode === "live") {
    const pool = input.pool;
    if (!pool || pool.length === 0) {
      if (configuredLiveProviders().length === 0) {
        return { ok: false, code: "PROVIDER_NOT_CONFIGURED", paths: BLOCKED_PATHS.PROVIDER_NOT_CONFIGURED };
      }
      return { ok: false, code: "PROVIDER_NOT_CONFIGURED", paths: BLOCKED_PATHS.PROVIDER_NOT_CONFIGURED };
    }
    if (pool.some((row) => row.provenance !== "live")) {
      return { ok: false, code: "PROVIDER_NOT_CONFIGURED", paths: BLOCKED_PATHS.PROVIDER_NOT_CONFIGURED };
    }
    return { ok: true, result: shortlistNeed(parsed.need, pool, input.count ?? SHORTLIST_CAP), mode: "live" };
  }

  if (!input.pool || input.pool.length === 0) {
    return { ok: false, code: "PROVIDER_NOT_CONFIGURED", paths: BLOCKED_PATHS.PROVIDER_NOT_CONFIGURED };
  }
  return { ok: true, result: shortlistNeed(parsed.need, input.pool, input.count ?? SHORTLIST_CAP), mode: "fixture" };
}
