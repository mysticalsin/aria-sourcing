/**
 * Compact Mantu VSS Recruitment Need parser.
 * Contract: docs/sourcing-engine/DESIGN.md
 *
 * Supports line-oriented (`Title\\nvalue`) and `Title: value`.
 * Multiple `Title` blocks in one paste become multiple needs.
 * Product platforms (Calypso, …) are skills, never people.
 */

import type {
  EmploymentType,
  JobAnalysis,
  LocationType,
  Seniority,
  Urgency,
} from "@/lib/types";
import type { NeedSource, SourcingNeed } from "@/lib/sourcing/need-types";

const VSS_SIGNALS = [
  /recruitment\s+need\s+purpose/i,
  /candidate\s+requirement/i,
  /candidate\s+search\s+support/i,
  /skill\s*\(\s*must\s*\)/i,
  /main\s+recruiter/i,
  /main\s+manager/i,
  /profile\s+synthesis/i,
  /mission\s+description/i,
  /company\s+employed\s+by/i,
  /company\s+billing\s+to/i,
  /ideal\s+profile\s*id/i,
];

const FIELD_LABELS: Record<string, string[]> = {
  title: ["title", "need title", "role title"],
  type: ["type"],
  priority: ["priority"],
  mainManager: ["main manager", "manager"],
  mainRecruiter: ["main recruiter", "recruiter"],
  companyEmployedBy: ["company employed by", "employed by"],
  city: ["city", "location"],
  client: ["client"],
  contractType: ["contract type"],
  startDate: ["start date", "starting date"],
  numberOfPeople: ["number of people", "nb people", "headcount"],
  remote: ["remote", "remote work", "work mode"],
  clientSector: ["client sector", "sector"],
  projectDuration: ["project duration", "duration"],
  profiles: ["profiles", "profile"],
  skillsMust: ["skill (must)", "skills (must)", "must have skills", "key required skills"],
  skillsNice: ["skill (nice to have)", "skills (nice to have)", "nice to have skills", "nice-to-have"],
  languagesMust: ["language (must)", "languages (must)"],
  languagesNice: ["language (nice to have)", "languages (nice to have)"],
  levelOfExperience: [
    "level of experience (in years)",
    "level of experience",
    "experience level",
    "experience",
    "seniority",
  ],
};

const STOP_LABELS = new Set(
  [
    ...Object.values(FIELD_LABELS).flat(),
    "summary",
    "recruitment need purpose",
    "project information",
    "candidate requirement",
    "candidate search support",
    "additional information of the candidate",
    "additional information of the need",
    "mission description",
    "profile synthesis",
    "profile requirement",
    "deadline shoot",
    "deadline qm",
    "category",
    "status",
    "reason",
    "secondary managers",
    "secondary recruiters",
    "company billing to",
    "freelancer",
    "project type",
    "target school",
    "ideal profile id",
    "linkedin profile",
    "boolean",
  ].map((s) => s.toLowerCase()),
);

const KNOWN_SKILL_PHRASES = [
  "linux server",
  "business analysis",
  "prime brokerage",
  "capital markets",
  "trade life cycle",
  "trade lifecycle",
  "application support",
];

const EXPERIENCE_PHRASES = [
  "production support",
  "trade life cycle",
  "trade lifecycle",
  "prime brokerage",
  "capital markets",
  "back office",
  "settlements",
  "settlement",
  "securities",
  "t+1",
  "business analysis",
  "calypso",
];

export interface VssNeed {
  title: string;
  type: string;
  priority: string;
  mainManager: string;
  mainRecruiter: string;
  companyEmployedBy: string;
  city: string;
  client: string;
  contractType: string;
  startDate: string;
  numberOfPeople: string;
  remote: string;
  clientSector: string;
  projectDuration: string;
  profiles: string;
  skillsMust: string[];
  skillsNice: string[];
  languagesMust: string[];
  languagesNice: string[];
  levelOfExperience: string;
  missionDescription: string;
  rawBlock: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeVssText(raw: string): string {
  return (raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isVssRecruitmentNeed(text: string): boolean {
  const t = text ?? "";
  let hits = 0;
  for (const re of VSS_SIGNALS) {
    if (re.test(t)) hits++;
  }
  return hits >= 2;
}

function normalizeLabel(line: string): string {
  return line.trim().toLowerCase().replace(/[:：]\s*$/, "");
}

function isStopLabel(line: string): boolean {
  const t = normalizeLabel(line);
  if (!t || t.length > 80) return false;
  if (STOP_LABELS.has(t)) return true;
  return [...STOP_LABELS].some((label) => t === label || t.startsWith(`${label} (`));
}

function nextValue(lines: string[], start: number): string {
  for (let i = start; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (!t) continue;
    if (isStopLabel(t)) return "";
    return t;
  }
  return "";
}

function extractField(block: string, labels: string[]): string {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    for (const label of labels) {
      const colon = trimmed.match(new RegExp(`^${escapeRegExp(label)}\\s*[:：]\\s*(.*)$`, "i"));
      if (colon) {
        const inline = (colon[1] ?? "").trim();
        if (inline && !isStopLabel(inline)) return inline;
        return nextValue(lines, i + 1);
      }
      if (new RegExp(`^${escapeRegExp(label)}\\s*$`, "i").test(trimmed)) {
        return nextValue(lines, i + 1);
      }
    }
  }
  return "";
}

function extractMission(block: string): string {
  const lines = block.split("\n");
  const startRe = /^(mission description|profile synthesis)\b/i;
  const stopRe =
    /^(candidate search support|target school|ideal profile|additional information|linkedin profile|boolean)\b/i;
  const start = lines.findIndex((line) => startRe.test(line.trim()));
  if (start < 0) return "";
  const header = (lines[start] ?? "").replace(/^[^:：]*[:：]\s*/, "").trim();
  const out: string[] = [];
  if (header && !startRe.test(header) && header.length > 4) out.push(header);
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (stopRe.test(trimmed)) break;
    if (isStopLabel(trimmed) && !/profile synthesis|mission description/i.test(trimmed)) break;
    out.push(lines[i] ?? "");
  }
  return out.join("\n").trim();
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

function titlePhrase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function protectPhrases(raw: string): { text: string; phrases: string[] } {
  let text = raw;
  const phrases: string[] = [];
  const ordered = [...KNOWN_SKILL_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    text = text.replace(new RegExp(phrase.replace(/\s+/g, "\\s+"), "ig"), () => {
      phrases.push(
        phrase === "trade lifecycle" ? "Trade Lifecycle" : titlePhrase(phrase),
      );
      return ` {{P${phrases.length - 1}}} `;
    });
  }
  return { text, phrases };
}

function splitSkills(raw: string): string[] {
  if (!raw.trim()) return [];
  const parts = raw
    .split(/\n|;|\||(?<!\d),(?!\d)/)
    .map((s) => s.replace(/^[-•*]\s*/, "").trim())
    .filter((s) => s && !/^(n\/?a|none|-|—)$/i.test(s) && !isStopLabel(s));

  const GENERIC = new Set(["server", "servers", "client", "support", "system", "systems"]);
  const PROSE =
    /\b(of|the|and|a|an|with|in|on|for|to|or|including|understanding|experience|working|knowledge)\b/i;
  const out: string[] = [];

  for (const part of parts) {
    const protectedPart = protectPhrases(part);
    const restored = (token: string) =>
      token
        .replace(/\{\{P(\d+)\}\}/g, (_, i: string) => protectedPart.phrases[Number(i)] ?? "")
        .replace(/[.,]+$/g, "")
        .trim();
    const toks = protectedPart.text.split(/\s+/).filter(Boolean);
    // VSS Skill (Must) is a space-separated token list. Split blobs of 3+
    // tokens that are not English prose — one chip "Linux Python Shell …"
    // is zero recall. Keep two-word skill names (Distributed Systems).
    const shouldTokenize =
      toks.length >= 3 &&
      !PROSE.test(protectedPart.text) &&
      toks.every((t) => t.length <= 32 || /\{\{P\d+\}\}/.test(t));

    if (shouldTokenize) {
      for (const tok of toks) {
        const skill = restored(tok);
        if (skill.length > 1 && !GENERIC.has(skill.toLowerCase()) && !isStopLabel(skill)) {
          out.push(skill);
        }
      }
    } else if (part) {
      out.push(restored(protectedPart.text).replace(/\s+/g, " "));
    }
  }

  return uniqueSkills(
    out.flatMap((skill) => {
      if (/^calypso\s+business\s+analysis$/i.test(skill)) return ["Calypso", "Business Analysis"];
      return [skill];
    }),
  );
}

/** JobAnalysis / query boundary: never persist an unsplit must-have line. */
export function tokenizeMustHaveSkills(input: string | string[] | undefined): string[] {
  const parts = Array.isArray(input) ? input : input ? [input] : [];
  return uniqueSkills(parts.flatMap((part) => splitSkills(part))).slice(0, 16);
}

function experienceSignals(need: Pick<VssNeed, "skillsMust" | "missionDescription" | "title">): string[] {
  const hay = `${need.title}\n${need.missionDescription}\n${need.skillsMust.join(" ")}`.toLowerCase();
  const phrases = EXPERIENCE_PHRASES.filter((phrase) => hay.includes(phrase));
  const platforms = need.skillsMust.filter((s) =>
    /calypso|murex|mysql|business analysis|grafana|dynatrace/i.test(s),
  );
  return uniqueSkills([...phrases, ...platforms]);
}

export function urgencyFromVssPriority(priority: string): Urgency {
  if (/not\s+critical/i.test(priority)) {
    return /urgent/i.test(priority) ? "Urgent" : "Standard";
  }
  if (/critical/i.test(priority) || /\b1\b/.test(priority)) return "Critical";
  if (/urgent/i.test(priority) || /\b2\b/.test(priority)) return "Urgent";
  if (/asap/i.test(priority)) return "ASAP";
  return "Standard";
}

export function locationTypeFromRemote(remote: string, text: string): LocationType {
  if (/partial(?:ly)?\s+remote|possible\s+partial(?:ly)?\s+remote|hybrid/i.test(remote)) {
    return "Hybrid";
  }
  if (/full(?:y)?\s*remote/i.test(remote)) return "Remote";
  if (/\bremote\b/i.test(remote) && !/hybrid|on-?site|partial/i.test(remote)) return "Remote";
  if (/hybrid/i.test(`${remote}\n${text}`)) return "Hybrid";
  if (/on-?site|in office|in-person/i.test(`${remote}\n${text}`)) return "On-site";
  return "Unspecified";
}

export function employmentFromVss(type: string, contractType: string): EmploymentType {
  const hay = `${type} ${contractType}`;
  if (/consulting|contract|contractor|freelance/i.test(hay)) return "Contract";
  if (/part[- ]time/i.test(hay)) return "Part-time";
  if (/full[- ]time|permanent|\bcdi\b/i.test(hay)) return "Full-time";
  return "Unspecified";
}

export function yearBandFromLevel(level: string): { min: number | null; max: number | null } {
  const fromTo = level.match(/from\s+(\d{1,2})\s+to\s+(\d{1,2})/i);
  if (fromTo) return { min: Number(fromTo[1]), max: Number(fromTo[2]) };
  const paren = level.match(/\((\d{1,2})\s*[-–]\s*(\d{1,2})\s*years?\)/i);
  if (paren) return { min: Number(paren[1]), max: Number(paren[2]) };
  const range = level.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*years/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = level.match(/(\d{1,2})\s*\+\s*years/i);
  if (plus) return { min: Number(plus[1]), max: null };
  return { min: null, max: null };
}

export function seniorityFromVss(level: string, title: string, minYears: number | null): Seniority {
  const hay = `${level} ${title}`;
  if (/principal/i.test(hay)) return "Principal";
  if (/\bstaff\b/i.test(hay)) return "Staff";
  if (/\blead\b/i.test(hay)) return "Lead";
  if (/director|head of/i.test(hay)) return "Director";
  if (/junior|graduate|entry/i.test(hay)) return "Junior";
  if (/\bmid(?:dle)?\b|intermediate/i.test(hay)) return "Mid";
  if (/\bsenior\b/i.test(hay)) return "Senior";
  if (minYears != null) {
    if (minYears >= 7) return "Senior";
    if (minYears >= 4) return "Mid";
    if (minYears >= 1) return "Junior";
  }
  return "Unspecified";
}

export function parseStartDateIso(startRaw: string): string | null {
  const eu = startRaw.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (eu) {
    const day = Number(eu[1]);
    const month = Number(eu[2]);
    const year = Number(eu[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(iso.getTime())) return iso.toISOString();
    }
  }
  const d = new Date(startRaw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function recoverExperienceLine(block: string): string {
  const labeled = extractField(block, FIELD_LABELS.levelOfExperience ?? []);
  if (labeled) return labeled;
  const middle = block.match(
    /\bMiddle\b[^\n]{0,48}?(\d{1,2})\s*(?:to|[-–])\s*(\d{1,2})\s*years?/i,
  );
  return middle?.[0]?.trim() ?? "";
}

function recoverCity(block: string, labeled: string): string {
  if (labeled.trim()) return labeled.trim();
  return block.match(/\bMontr[eé]al\b/i)?.[0] ?? "";
}

function recoverLanguagesMust(block: string, labeled: string): string[] {
  if (labeled.trim()) {
    return labeled.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  const fluent = block.match(/\b(English|French|Anglais|Fran[cç]ais)\b[^\n]{0,24}(Fluent|Native|Bilingual)/i);
  return fluent?.[1] ? [fluent[0].trim()] : [];
}

function parseOneBlock(block: string): VssNeed {
  const field = (key: keyof typeof FIELD_LABELS) => extractField(block, FIELD_LABELS[key] ?? []);
  const title = field("title") || field("profiles");
  const mission = extractMission(block);
  const hay = `${title}\n${mission}\n${block}`;
  const skillsMust = tokenizeMustHaveSkills(field("skillsMust"));
  if (/calypso/i.test(hay) && !skillsMust.some((s) => /calypso/i.test(s))) {
    skillsMust.unshift("Calypso");
  }
  return {
    title,
    type: field("type"),
    priority: field("priority"),
    mainManager: field("mainManager"),
    mainRecruiter: field("mainRecruiter"),
    companyEmployedBy: field("companyEmployedBy"),
    city: recoverCity(block, field("city")),
    client: field("client"),
    contractType: field("contractType"),
    startDate: field("startDate"),
    numberOfPeople: field("numberOfPeople"),
    remote: field("remote"),
    clientSector: field("clientSector"),
    projectDuration: field("projectDuration"),
    profiles: field("profiles"),
    skillsMust: uniqueSkills(skillsMust).slice(0, 16),
    skillsNice: tokenizeMustHaveSkills(field("skillsNice")).slice(0, 12),
    languagesMust: recoverLanguagesMust(block, field("languagesMust")),
    languagesNice: field("languagesNice")
      ? field("languagesNice").split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [],
    levelOfExperience: recoverExperienceLine(block),
    missionDescription: mission.slice(0, 12_000),
    rawBlock: block,
  };
}

export function splitVssBlocks(text: string): string[] {
  const normalized = normalizeVssText(text);
  const chunks = normalized
    .split(/(?=^Title\b)/im)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length <= 1) return [normalized];
  const [head, ...rest] = chunks;
  if (head && !/^Title\b/im.test(head) && rest[0]) {
    rest[0] = `${head}\n${rest[0]}`;
    return rest.filter((chunk) => /^Title\b/im.test(chunk) || /skill\s*\(\s*must\s*\)/i.test(chunk));
  }
  return chunks.filter((chunk) => /^Title\b/im.test(chunk) || /skill\s*\(\s*must\s*\)/i.test(chunk));
}

export function parseVssNeeds(raw: string): VssNeed[] {
  const text = normalizeVssText(raw);
  if (!isVssRecruitmentNeed(text)) return [];
  return splitVssBlocks(text)
    .map(parseOneBlock)
    .filter((need) => need.title.trim().length >= 2 && need.skillsMust.length > 0);
}

export function vssToSourcingNeed(need: VssNeed, source: NeedSource, rawText: string): SourcingNeed {
  const years = yearBandFromLevel(need.levelOfExperience);
  const industry = /bank|financ|capital market|trading|calypso/i.test(
    `${need.clientSector}\n${need.missionDescription}\n${need.title}`,
  )
    ? ["Capital Markets"]
    : [];
  return {
    title: need.title.slice(0, 200),
    requiredSkills: need.skillsMust,
    niceToHaveSkills: need.skillsNice,
    experienceSignals: experienceSignals(need),
    minYearsExperience: years.min,
    industry,
    source,
    rawText: rawText.slice(0, 20_000),
  };
}

export function vssToJobAnalysis(need: VssNeed): JobAnalysis {
  const years = yearBandFromLevel(need.levelOfExperience);
  const fallbackYears = years.min == null ? yearBandFromLevel(need.rawBlock) : years;
  const minYears = years.min ?? fallbackYears.min;
  const maxYears = years.max ?? fallbackYears.max;
  const urgency = urgencyFromVssPriority(need.priority);
  const loc = need.city.trim();
  const language = /french|français/i.test(need.languagesMust[0] ?? "")
    ? "fr"
    : /english|anglais/i.test(need.languagesMust[0] ?? "")
      ? "en"
      : "en";
  return {
    title: need.title,
    department: need.profiles || need.type || need.client,
    seniority: seniorityFromVss(need.levelOfExperience || need.rawBlock, need.title, minYears),
    employmentType: employmentFromVss(need.type, need.contractType),
    locationType: locationTypeFromRemote(need.remote, need.rawBlock),
    ...(loc ? { location: loc } : {}),
    regions: loc ? [loc] : /canada/i.test(need.client) ? ["Canada"] : [],
    timezone: "",
    salaryMin: null,
    salaryMax: null,
    currency: /canada|montreal|amacan/i.test(`${need.city} ${need.client} ${need.companyEmployedBy}`)
      ? "CAD"
      : "",
    equity: false,
    requiredSkills: tokenizeMustHaveSkills(need.skillsMust),
    niceToHaveSkills: tokenizeMustHaveSkills(need.skillsNice),
    minYearsExperience: minYears,
    maxYearsExperience: maxYears,
    education: "",
    industryExperience: /bank|financ|capital market|trading|calypso/i.test(
      `${need.clientSector}\n${need.missionDescription}`,
    )
      ? ["Fintech"]
      : [],
    companyStageTarget: [],
    teamSize: need.numberOfPeople ? `${need.numberOfPeople} opening${need.numberOfPeople === "1" ? "" : "s"}` : "",
    reportingTo: need.mainManager,
    urgency,
    language,
    expectedStartDate: parseStartDateIso(need.startDate),
    validationWarnings: [],
  };
}
