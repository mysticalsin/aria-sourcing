/**
 * Structured parser for Mantu VSS-style Recruitment Need documents
 * (Summary / Recruitment Need Purpose / Project Information /
 * Candidate Requirement / Candidate Search Support).
 *
 * Handles plain-text paste, HTML-stripped email bodies, and OCR'd PDF text
 * when the caller already supplied text. Binary PDF/image OCR is documented
 * in the module footer — not stubbed here.
 */

import type { JobAnalysis, Seniority, Urgency } from "@/lib/types";

/** Full structured capture of a VSS Recruitment Need — nothing important discarded. */
export interface MantuNeedMeta {
  title: string;
  type: string;
  category: string;
  priority: string;
  reason: string;
  status: string;
  mainManager: string;
  secondaryManagers: string[];
  mainRecruiter: string;
  secondaryRecruiters: string[];
  companyEmployedBy: string;
  city: string;
  client: string;
  companyBillingTo: string;
  contractType: string;
  freelancer: string;
  startDate: string;
  numberOfPeople: string;
  remote: string;
  clientSector: string;
  projectType: string;
  projectDuration: string;
  profiles: string;
  skillsMust: string[];
  skillsNice: string[];
  languagesMust: string[];
  languagesNice: string[];
  levelOfExperience: string;
  /** Mission Description / Profile Synthesis body — preserve for sourcing. */
  missionDescription: string;
  targetSchool: string;
  idealProfileId: string;
  linkedinProfile: string;
  /** LinkedIn boolean / X-ray string when present. */
  booleanSearch: string;
  format: "vss" | "active-email";
}

export function emptyMantuNeedMeta(partial?: Partial<MantuNeedMeta>): MantuNeedMeta {
  return {
    title: "",
    type: "",
    category: "",
    priority: "",
    reason: "",
    status: "",
    mainManager: "",
    secondaryManagers: [],
    mainRecruiter: "",
    secondaryRecruiters: [],
    companyEmployedBy: "",
    city: "",
    client: "",
    companyBillingTo: "",
    contractType: "",
    freelancer: "",
    startDate: "",
    numberOfPeople: "",
    remote: "",
    clientSector: "",
    projectType: "",
    projectDuration: "",
    profiles: "",
    skillsMust: [],
    skillsNice: [],
    languagesMust: [],
    languagesNice: [],
    levelOfExperience: "",
    missionDescription: "",
    targetSchool: "",
    idealProfileId: "",
    linkedinProfile: "",
    booleanSearch: "",
    format: "vss",
    ...partial,
  };
}

/** True when the text looks like a VSS Recruitment Need page (vs ACTIVE email). */
export function isVssRecruitmentNeed(text: string): boolean {
  const t = text ?? "";
  const signals = [
    /recruitment\s+need\s+purpose/i,
    /candidate\s+requirement/i,
    /candidate\s+search\s+support/i,
    /skill\s*\(\s*must\s*\)/i,
    /main\s+manager\s*:/i,
    /profile\s+synthesis/i,
    /mission\s+description/i,
    /ideal\s+profile\s*id/i,
    /company\s+employed\s+by/i,
    /company\s+billing\s+to/i,
  ];
  let hits = 0;
  for (const re of signals) {
    if (re.test(t)) hits++;
  }
  return hits >= 2;
}

/**
 * Normalize pasted HTML / OCR noise into line-oriented plain text so
 * `Label: value` extractors still match.
 */
export function normalizeIntakePlainText(raw: string): string {
  let text = raw ?? "";
  if (/<[a-zA-Z][^>]*>/.test(text)) {
    text = text
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
      .replace(/<\s*(?:p|div|tr|li|h[1-6])[^>]*>/gi, "\n")
      .replace(/<\/\s*td\s*>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const FIELD_ALIASES: Record<string, string[]> = {
  title: ["title", "need title", "role title", "position"],
  type: ["type"],
  category: ["category"],
  priority: ["priority"],
  reason: ["reason"],
  status: ["status"],
  mainManager: ["main manager", "manager"],
  secondaryManagers: ["secondary managers", "secondary manager"],
  mainRecruiter: ["main recruiter", "recruiter"],
  secondaryRecruiters: ["secondary recruiters", "secondary recruiter"],
  companyEmployedBy: ["company employed by", "employed by", "company"],
  city: ["city", "location"],
  client: ["client"],
  companyBillingTo: ["company billing to", "billing to", "billing company"],
  contractType: ["contract type"],
  freelancer: ["freelancer"],
  startDate: ["start date", "starting date"],
  numberOfPeople: ["number of people", "nb people", "headcount", "openings"],
  remote: ["remote", "remote work", "work mode", "location type"],
  clientSector: ["client sector", "sector", "industry"],
  projectType: ["project type"],
  projectDuration: ["project duration", "duration"],
  profiles: ["profiles", "profile"],
  skillsMust: ["skill (must)", "skills (must)", "must have skills", "key required skills"],
  skillsNice: ["skill (nice to have)", "skills (nice to have)", "nice to have skills", "nice-to-have"],
  languagesMust: ["language (must)", "languages (must)", "languages"],
  languagesNice: ["language (nice to have)", "languages (nice to have)"],
  levelOfExperience: ["level of experience", "experience level", "seniority"],
  targetSchool: ["target school", "target schools"],
  idealProfileId: ["ideal profile id", "ideal profile"],
  linkedinProfile: ["linkedin profile", "linkedin"],
  booleanSearch: ["boolean", "linkedin boolean", "boolean search"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitList(raw: string): string[] {
  return raw
    .split(/\n|;|\||(?<!\d),(?!\d)/)
    .map((s) => s.replace(/^[-•*]\s*/, "").trim())
    .filter((s) => s && !/^(n\/?a|none|-|—)$/i.test(s));
}

/** Extract a single labeled field — supports `Label: value` and `Label\nvalue`. */
export function extractLabeledField(text: string, labels: string[]): string {
  for (const label of labels) {
    const reLine = new RegExp(
      `^\\s*${escapeRegExp(label)}\\s*[:：]\\s*(.+?)\\s*$`,
      "im",
    );
    const m1 = text.match(reLine);
    if (m1?.[1]?.trim()) return m1[1].trim();

    const reBlock = new RegExp(
      `^\\s*${escapeRegExp(label)}\\s*[:：]?\\s*\\n+\\s*(.+?)\\s*(?=\\n\\s*[A-Za-z][^\\n]{0,60}\\s*[:：]|\\n\\n|$)`,
      "im",
    );
    const m2 = text.match(reBlock);
    if (m2?.[1]?.trim() && !/^(summary|recruitment need|project information|candidate)/i.test(m2[1])) {
      return m2[1].trim();
    }
  }
  return "";
}

function extractMultilineBlock(text: string, startLabels: string[], stopLabels: string[]): string {
  const start = startLabels.map(escapeRegExp).join("|");
  const stop = stopLabels.map(escapeRegExp).join("|");
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:${start})\\s*[:：]?\\s*\\n?([\\s\\S]*?)(?=(?:^|\\n)\\s*(?:${stop})\\s*[:：]?\\s*(?:\\n|$)|$)`,
    "i",
  );
  const m = text.match(re);
  return (m?.[1] ?? "").trim();
}

export function extractVssMissionDescription(text: string): string {
  const block = extractMultilineBlock(
    text,
    [
      "mission description",
      "profile synthesis",
      "profile description",
      "mission",
      "job description",
    ],
    [
      "candidate search support",
      "target school",
      "ideal profile",
      "linkedin profile",
      "boolean",
      "skill (must)",
      "skill (nice",
      "language (must)",
      "key required skills",
      "skills",
    ],
  );
  if (block.length > 20) return block;
  // Fallback: ACTIVE-email style profile description
  return (
    text.match(/profile description\s*:\s*([\s\S]*?)(?:\n\s*(?:skills|key required|rate|boolean)\s*:|\n\s*$)/i)?.[1]?.trim() ??
    ""
  );
}

export function parseVssRecruitmentNeed(raw: string): MantuNeedMeta {
  const text = normalizeIntakePlainText(raw);
  const field = (key: keyof typeof FIELD_ALIASES) =>
    extractLabeledField(text, FIELD_ALIASES[key]);

  const titleFromActive =
    text.match(/this need is now active\s*:?\s*(.+)/i)?.[1]?.trim() ?? "";

  const skillsMustRaw = field("skillsMust");
  const skillsNiceRaw = field("skillsNice");
  // Bullet block under "Key required skills"
  const keySkillsBlock =
    text.match(/key required skills\s*\n([\s\S]*?)(?=\n\s*(?:skills|skill\s*\(|language|rate|boolean)\s*:|\n\s*$)/i)?.[1] ??
    "";
  const skillsFromBullets = keySkillsBlock
    ? keySkillsBlock
        .split(/\n/)
        .map((l) => l.replace(/^[-•*]\s*/, "").replace(/^MANDATORY:\s*/i, "").trim())
        .filter((l) => l.length > 2 && l.length < 200)
    : [];

  const languagesMust = splitList(field("languagesMust"));
  const languagesNice = splitList(field("languagesNice"));

  const secondaryManagers = splitList(field("secondaryManagers"));
  const secondaryRecruiters = splitList(field("secondaryRecruiters"));

  const skillsMust = Array.from(
    new Set([...splitList(skillsMustRaw), ...skillsFromBullets.map((s) => s.split(/[,;]/)[0]!.trim()).filter(Boolean)]),
  );
  // Prefer short skill tokens from an explicit Skills: line when present
  const skillsLine = extractLabeledField(text, ["skills"]);
  if (skillsLine && skillsMust.length === 0) {
    skillsMust.push(...splitList(skillsLine));
  } else if (skillsLine) {
    for (const s of splitList(skillsLine)) {
      if (!skillsMust.some((x) => x.toLowerCase() === s.toLowerCase())) skillsMust.push(s);
    }
  }

  const missionDescription = extractVssMissionDescription(text);

  // Pull Calypso / product tokens from mission into must-skills if missing
  if (/calypso/i.test(text) && !skillsMust.some((s) => /calypso/i.test(s))) {
    skillsMust.unshift("Calypso");
  }

  return emptyMantuNeedMeta({
    title: field("title") || titleFromActive || field("profiles"),
    type: field("type"),
    category: field("category"),
    priority: field("priority"),
    reason: field("reason"),
    status: field("status"),
    mainManager: field("mainManager"),
    secondaryManagers,
    mainRecruiter: field("mainRecruiter"),
    secondaryRecruiters,
    companyEmployedBy: field("companyEmployedBy"),
    city: field("city"),
    client: field("client"),
    companyBillingTo: field("companyBillingTo"),
    contractType: field("contractType") || field("type"),
    freelancer: field("freelancer"),
    startDate: field("startDate"),
    numberOfPeople: field("numberOfPeople"),
    remote: field("remote"),
    clientSector: field("clientSector"),
    projectType: field("projectType"),
    projectDuration: field("projectDuration"),
    profiles: field("profiles"),
    skillsMust: skillsMust.slice(0, 24),
    skillsNice: splitList(skillsNiceRaw).slice(0, 16),
    languagesMust,
    languagesNice,
    levelOfExperience: field("levelOfExperience"),
    missionDescription: missionDescription.slice(0, 12_000),
    targetSchool: field("targetSchool"),
    idealProfileId: field("idealProfileId"),
    linkedinProfile: field("linkedinProfile"),
    booleanSearch: field("booleanSearch"),
    format: isVssRecruitmentNeed(text) ? "vss" : "active-email",
  });
}

export function urgencyFromMantuPriority(priority: string, text: string): Urgency {
  if (/critical/i.test(priority) || /\b1\b/.test(priority) || /high importance|importance:\s*high/i.test(text)) {
    return "Critical";
  }
  if (/urgent/i.test(priority) || /\b2\b/.test(priority)) return "Urgent";
  if (/asap/i.test(priority)) return "ASAP";
  return "Standard";
}

export function locationTypeFromRemote(remote: string, text: string, hasCity: boolean): JobAnalysis["locationType"] {
  const hay = `${remote}\n${text}`;
  if (/full\s*remote|fully\s*remote|\bremote\b/i.test(remote) && !/hybrid|on-?site/i.test(remote)) {
    return "Remote";
  }
  if (/hybrid/i.test(hay)) return "Hybrid";
  if (/on-?site|in office|in-person/i.test(hay)) return "On-site";
  if (/remote/i.test(hay) && !/hybrid/i.test(hay)) return "Remote";
  return hasCity ? "On-site" : "Unspecified";
}

export function employmentFromMantuType(type: string, contractType: string, text: string): JobAnalysis["employmentType"] {
  const hay = `${type} ${contractType} ${text}`;
  if (/consulting|contract|contractor|freelance/i.test(hay)) return "Contract";
  if (/part[- ]time/i.test(hay)) return "Part-time";
  if (/full[- ]time|permanent/i.test(hay)) return "Full-time";
  return "Unspecified";
}

export function seniorityFromLevel(level: string, title: string, minYears: number | null): Seniority {
  if (/principal/i.test(level) || /principal/i.test(title)) return "Principal";
  if (/staff/i.test(level) || /staff/i.test(title)) return "Staff";
  if (/lead/i.test(level) || /\blead\b/i.test(title)) return "Lead";
  if (/director|head of/i.test(level) || /director|head of/i.test(title)) return "Director";
  if (/junior|graduate|entry/i.test(level) || /junior|graduate|entry/i.test(title)) return "Junior";
  if (/\bmid\b|intermediate/i.test(level) || /\bmid\b|intermediate/i.test(title)) return "Mid";
  if (/\bsenior\b/i.test(level) || /\bsenior\b/i.test(title)) return "Senior";
  if (minYears != null) {
    if (minYears >= 5) return "Senior";
    if (minYears >= 3) return "Mid";
    if (minYears >= 1) return "Junior";
  }
  return "Unspecified";
}

export function parseStartDateIso(startRaw: string): string | null {
  if (!startRaw.trim()) return null;
  // Prefer dd/mm/yyyy (EU VSS) when the first number is > 12, or when both ≤12
  // still treat as EU for Mantu needs (Paris/London desks).
  const eu = startRaw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (eu) {
    const day = parseInt(eu[1], 10);
    const month = parseInt(eu[2], 10);
    const year = parseInt(eu[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(iso.getTime())) return iso.toISOString();
    }
  }
  // US m/d/yyyy with spelled months, ISO, etc.
  const d = new Date(startRaw);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

export function industryFromSector(sector: string, text: string): string[] {
  const hay = `${sector}\n${text}`;
  if (/bank|financ|capital market|trading|calypso|murex|asset manag/i.test(hay)) return ["Fintech"];
  if (/medical device|pharma|healthcare|fda|iso 13485/i.test(hay)) return ["Healthtech"];
  if (/insur/i.test(hay)) return ["Fintech"];
  if (sector.trim()) return [sector.trim()];
  return [];
}

/**
 * PDF / image OCR — not wired for binary attachments yet.
 *
 * To complete attachment OCR for production:
 * 1. Graph/webhook: download message attachments (PDF/PNG/JPEG) by message id.
 * 2. Prefer digital PDF text extract (pdf.js / unpdf) when the PDF has a text layer.
 * 3. Else: send page images to an LLM vision model via serverGenerateText/vault
 *    (workspace-scoped keys; never invent MICROSOFT secrets).
 * 4. Feed the resulting plain text into parseVssRecruitmentNeed / parseEmailAndJD.
 * 5. Keep plain-text + HTML-stripped paths (this module) as the always-on baseline.
 */

/** Abbreviated Calypso Application Support VSS fixture (Tony example shape). */
export const SAMPLE_VSS_CALYPSO_APP_SUPPORT = `Summary
Title: Calypso Application Support
Type: Consulting
Category: Active
Priority: Urgent
Reason: Opening Position
Status: Running

Recruitment Need Purpose
Main Manager: DUPONT Marie
Secondary Managers: MARTIN Luc
Main Recruiter: BERNARD Sophie
Secondary Recruiters: PETIT Hugo
Company Employed by: Amaris Consulting
City: Paris
Client: Societe Generale
Company Billing To: Amaris Consulting

Project Information
Contract Type: Consulting
Freelancer: No
Start Date: 15/09/2026
Number of people: 1
Remote: Hybrid
Client Sector: Banking
Project Type: Application Support
Project Duration: 12 months

Candidate Requirement
Profiles: Calypso Application Support
Skill (Must): Calypso, SQL, Unix, Front Office
Skill (Nice to have): Java, Python, Shell scripting
Language (Must): English - Fluent, French - Fluent
Language (Nice to have):
Level of Experience: Mid/Senior (5+ years)

Mission Description / Profile Synthesis:
Provide L2/L3 application support on Calypso for Front Office trading desks.
Troubleshoot trade lifecycle issues, market data, and overnight batch failures.
Partner with FO users and IT to stabilize production. Strong SQL and Unix required.

Candidate Search Support
Target School:
Ideal profile Id: CAL-APP-2026-01
LinkedIn Profile:
Boolean: ("Calypso") AND ("Application Support" OR "Production Support") AND (SQL OR Unix)
`;

/** Abbreviated Senior Calypso Business Analyst VSS fixture (Tony example shape). */
export const SAMPLE_VSS_CALYPSO_BA = `Summary
Title: Senior Calypso Business Analyst
Type: Consulting
Category: Active
Priority: 1 - Urgent and critical
Reason: Opening Position
Status: Running

Recruitment Need Purpose
Main Manager: LEFEVRE Antoine
Secondary Managers: MOREAU Claire; GARCIA Paul
Main Recruiter: ROUSSEAU Emma
Secondary Recruiters:
Company Employed by: Mantu
City: London
Client: HSBC
Company Billing To: Mantu

Project Information
Contract Type: Consulting
Freelancer: No
Start Date: 10/01/2026
Number of people: 2
Remote: On-site
Client Sector: Capital Markets
Project Type: Business Analysis
Project Duration: 18 months

Candidate Requirement
Profiles: Senior Calypso Business Analyst
Skill (Must): Calypso, Business Analysis, Derivatives, Trade Lifecycle
Skill (Nice to have): Murex, Agile, Jira
Language (Must): English - Fluent
Language (Nice to have): French - Intermediate
Level of Experience: Senior (8+ years)

Profile Synthesis:
Senior BA to gather FO requirements and configure Calypso workflows for rates
and credit derivatives. Own UAT, change requests, and stakeholder workshops.
Must demonstrate deep Calypso product knowledge and capital-markets BA delivery.

Candidate Search Support
Target School: Target schools - Finance / Engineering
Ideal profile Id: CAL-BA-2026-09
LinkedIn Profile: https://www.linkedin.com/in/example-calypso-ba
Boolean: ("Calypso") AND ("Business Analyst" OR "BA") AND (Derivatives OR "Trade Lifecycle")
`;
