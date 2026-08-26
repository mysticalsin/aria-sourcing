import { DEFAULT_SCORING_WEIGHTS, scoreCandidate } from "./scoring";
import { dedupeCandidates } from "./rules";
import { humanizeText } from "./humanizer";
import { mantuOutreachVoice, mantuEmailHtmlWrapper } from "./mantu-brand";
import { roleProfile } from "./roles";
import type { SourceResult } from "./sourcing/candidate-mappers";
import { detectLanguage, outreachStrings, REPLY_LEXICON } from "./i18n";
import { evaluateNeedReadiness } from "./needs/readiness";
import type {
  Booking,
  Campaign,
  CampaignMetrics,
  Candidate,
  ClassifiedReply,
  CompanyStage,
  GithubQuery,
  IntakeIntent,
  Interviewer,
  JobAnalysis,
  OutreachChannel,
  OutreachMessage,
  OutreachTone,
  ReplyIntent,
  ScoringWeights,
  Seniority,
  SkillUpdate,
  SourcePlatform,
  SourcingStrategy,
  SystemSettings,
  Urgency,
  ValidationWarning,
  WeeklyReport,
} from "./types";
import { OUTREACH_CHANNELS } from "./types";
import { effectiveStageRank, funnelForCandidates } from "./metrics";
import {
  campaignId as makeCampaignId,
  clamp,
  escapeRegExp,
  genId,
  ianaForAbbrev,
  initialsFrom,
  isoDaysAfter,
  makeRng,
  pick,
  pickN,
  round,
  slugify,
  titleCase,
} from "./utils";

export type { SourceResult } from "./sourcing/candidate-mappers";
export {
  mapApolloCandidates,
  mapGithubCandidates,
  mapSeamlessCandidates,
  mapWebSearchCandidates,
} from "./sourcing/candidate-mappers";

/** Parse experience floors like "8 years +", "5+ years", "minimum 6 years". */
export function extractMinYearsExperience(text: string): number | null {
  const patterns = [
    /\bminimum[\s]{0,6}(\d{1,2})[\s+]{0,6}years?\b/i,
    /\bat\s+least\s+(\d{1,2})\s*\+?\s*years?\b/i,
    /\b(\d{1,2})\s*\+\s*years?\b/i,
    /\b(\d{1,2})\s*years?\s*\+/i,
    /\b(\d{1,2})\s*-\s*\d{1,2}\s*years?\b/i,
    /\b(\d{1,2})\+?\s*years?\s+(?:of\s+)?(?:relevant\s+)?experience\b/i,
    /\b(\d{1,2})\s*(?:years?|yrs)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1];
    if (match) {
      const years = parseInt(match, 10);
      if (Number.isFinite(years) && years >= 0 && years <= 50) return years;
    }
  }
  return null;
}

export function seniorityFromTitle(title: string): Seniority {
  if (/principal/i.test(title)) return "Principal";
  if (/staff/i.test(title)) return "Staff";
  if (/lead/i.test(title)) return "Lead";
  if (/director|head of/i.test(title)) return "Director";
  if (/junior|graduate|entry/i.test(title)) return "Junior";
  if (/\bmid\b|intermediate/i.test(title)) return "Mid";
  if (/\bsenior\b/i.test(title)) return "Senior";
  return "Unspecified";
}

/** Map stated years-of-experience floors to seniority when the title is silent. */
export function seniorityFromYears(minYears: number | null): Seniority {
  if (minYears == null) return "Unspecified";
  if (minYears >= 8) return "Senior";
  if (minYears >= 5) return "Senior";
  if (minYears >= 3) return "Mid";
  if (minYears >= 1) return "Junior";
  return "Unspecified";
}

/* ============================================================================
   MOCK AI — deterministic stand-ins for the real Aria pipeline.
   Pure functions, synthetic data only. No network, no real model calls.
   ========================================================================== */

/* ---- Reference data ------------------------------------------------------ */

const FIRST_NAMES = [
  "Maya", "Diego", "Aisha", "Liam", "Priya", "Noah", "Sofia", "Kenji", "Amara", "Lucas",
  "Ingrid", "Tariq", "Elena", "Mateo", "Hana", "Oliver", "Zara", "Felix", "Nadia", "Arjun",
  "Clara", "Idris", "Yuki", "Marco", "Leila", "Sven", "Rosa", "Omar", "Freya", "Daniel",
  "Bianca", "Ravi", "Astrid", "Caleb", "Mina", "Theo", "Lena", "Hugo", "Sara", "Niko",
  "Camille", "Viktor", "Aria", "Joel", "Petra", "Sami", "Greta", "Ade", "Tomas", "Iris",
];

const LAST_NAMES = [
  "Okafor", "Reyes", "Khan", "Novak", "Patel", "Andersen", "Romano", "Tanaka", "Nwosu", "Silva",
  "Lindqvist", "Haddad", "Petrova", "Garcia", "Sato", "Whitfield", "Ahmadi", "Berg", "Costa", "Mehta",
  "Dubois", "Larsson", "Yamamoto", "Bianchi", "Hassan", "Mueller", "Fontaine", "Aziz", "Holm", "Cruz",
  "Ferraro", "Kapoor", "Sorensen", "Brennan", "Park", "Vargas", "Eriksson", "Bauer", "Moreau", "Lindqvist",
];

const COMPANIES_BY_STAGE: Record<CompanyStage, string[]> = {
  Seed: ["Loomctl", "Quantal", "Driftwave", "Nodemark", "Pacelab"],
  "Series A": ["Northwind Labs", "Vellum AI", "Cobalt Systems", "Hearthstack", "Tideglass"],
  "Series B": ["Brightloop", "Helix Data", "Forgepoint", "Latchkey", "Aurora Grid"],
  "Series C+": ["Meridian Cloud", "Sablefin", "Voltline", "Cartograph", "Hollweave"],
  Public: ["Cygnus Corp", "Atlas Digital", "Beacon Holdings", "Pillar Tech", "Vantage One"],
  Enterprise: ["Granite Industries", "Eastfield Group", "Lumen Manufacturing", "Crestmont", "Bayline"],
};

const LOCATIONS = [
  { city: "Berlin, DE", tz: "CET", region: "EU" },
  { city: "Lisbon, PT", tz: "WET", region: "EU" },
  { city: "Amsterdam, NL", tz: "CET", region: "EU" },
  { city: "London, UK", tz: "GMT", region: "UK" },
  { city: "Austin, US", tz: "CST", region: "US" },
  { city: "Toronto, CA", tz: "EST", region: "North America" },
  { city: "Bangalore, IN", tz: "IST", region: "APAC" },
  { city: "Singapore, SG", tz: "SGT", region: "APAC" },
  { city: "São Paulo, BR", tz: "BRT", region: "LATAM" },
  { city: "Warsaw, PL", tz: "CET", region: "EU" },
  { city: "Madrid, ES", tz: "CET", region: "EU" },
  { city: "Remote, EU", tz: "CET", region: "EU" },
];

const EXTRA_SKILLS = [
  "TypeScript", "Go", "Rust", "Python", "Kubernetes", "PostgreSQL", "GraphQL", "gRPC",
  "Kafka", "Redis", "AWS", "GCP", "Terraform", "React", "Node.js", "CI/CD", "Observability",
  "Distributed Systems", "Event Sourcing", "OpenTelemetry", "Docker", "Microservices",
];

const INDUSTRIES = ["Fintech", "Healthtech", "SaaS", "E-commerce", "Cybersecurity", "AI/ML", "Logistics", "Climate"];

const ACTIVITY_LINES = [
  "Shipped a major open-source release this week.",
  "Merged 14 PRs to a popular repo this month.",
  "Spoke at a regional engineering meetup recently.",
  "Maintains a well-starred library; active this week.",
  "Published a deep-dive on distributed systems recently.",
  "Quiet on public channels for the last year.",
  "Recently launched a side project; days ago.",
  "Contributes to standards working groups regularly.",
];

/* ---- Skills dictionary for the parser ----------------------------------- */

const SKILL_DICTIONARY = [
  ...EXTRA_SKILLS,
  "Java", "C++", "Scala", "Elixir", "Ruby", "Swift", "Kotlin", "Next.js", "Vue", "Svelte",
  "TensorFlow", "PyTorch", "LangChain", "LLM", "RAG", "Vector DB", "Snowflake", "dbt", "Spark",
  "Airflow", "SQL", "MongoDB", "MySQL", "RabbitMQ", "Nginx", "Linux", "REST", "OAuth", "SAML", "SOC2",
  "Figma", "Product Design", "Product Management", "Roadmapping", "Accessibility", "Design Systems", "Sales", "Negotiation", "CRM",
];

/* ============================================================================
   1. parseEmailAndJD
   ========================================================================== */

export const SAMPLE_INTAKE_EMAIL = `From: Daniela Brandt <daniela.brandt@northwind.example>
Subject: URGENT: backfill Senior Backend Engineer (Go), need pipeline ASAP

Hi Aria,

One of our senior backend engineers just resigned and we need to backfill this
role critically, ideally someone in seat within 8 weeks. This is high priority.

We're hiring a full-time Senior Backend Engineer, fully remote across the EU (CET-ish
overlap). Core stack is Go, Kubernetes, PostgreSQL and gRPC: they'll own
distributed systems at the heart of the platform. Nice to have: Kafka,
OpenTelemetry, Terraform. We want 5+ years of experience, ideally from a
Series A or Series B company in fintech or SaaS. Budget is roughly €90k–€120k
plus meaningful equity. They'll report to the VP Engineering on a team of 8.

Can you get sourcing going right away?

Thanks,
Daniela Brandt
VP People, Northwind Labs`;

export const SAMPLE_INTAKE_JD = `Senior Backend Engineer (Remote, EU)

About the role:
- Design and operate Go services on Kubernetes handling high-throughput traffic.
- Own PostgreSQL data models and gRPC service contracts across the platform.
- Champion reliability, observability and clean distributed-systems design.

Requirements:
- 5+ years building production backend systems (Go strongly preferred).
- Deep PostgreSQL and gRPC experience; comfortable with Kubernetes.
- Nice to have: Kafka, OpenTelemetry, Terraform.

We offer €90k–€120k, meaningful equity, and a fully remote EU setup (CET).`;

/** A real Mantu/Amaris "need is now ACTIVE" recruitment email (structured format). */
export const SAMPLE_MANTU_EMAIL = `From: Noreply (Mantu) <noreply@mantu.example>
To: Amaris_RCM_PRO@amaris.com
Cc: AMACAN_Managers; AMACAN_Recruitment
Importance: High

Hello,
This need is now ACTIVE: Crédit Agricole - Murex Support
Type: Consulting
Category: Active
Status: Running
Client: LBCCAN
Manager: MARGIOTTA Lisa
Recruiter: JENDOUBI Maryem
Priority: 1 - Urgent and critical
Location: MONTREAL
Start date: 7/13/2026
Nb people: 1
Languages: English - Fluent, French - Fluent

Key required skills
- Strong understanding of financial markets, specifically US corporate bonds.
- MANDATORY: Prior experience working directly with Front Office traders in a high-pressure trading environment.
- MANDATORY: Good knowledge of Murex Front Office tools on MX.III (Pricing, Simulation, Market Data, standard reports). Strong knowledge of financial products (vanilla), including valuation principles and risk sensitivities.
- Strong communication, interpersonal, and stakeholder management skills.
- Minimum 5 years of relevant experience. Offshore experience is a plus.

Skills: Murex, Finance, Pricing, Pricing Analysis`;

export interface ParsedIntake {
  sender: { name: string; email: string };
  intent: IntakeIntent;
  urgency: Urgency;
  jobAnalysis: JobAnalysis;
  validationWarnings: ValidationWarning[];
  clarificationDraft: string | null;
  confidence: Record<string, number>;
  extractionMode: "evidence" | "cloud";
  providerWarning?: string;
  /** Optional enrichment from a locked Dust agent (task "jdAnalysis"). A sibling
   *  display field, never merged into jobAnalysis's typed fields — free text from
   *  an external agent shouldn't be able to corrupt the scoring/sourcing pipeline.
   *  Attached client-side, after the fact, by the intake page; absent unless a
   *  Dust agent is configured and locked for this task. */
  dustAnalysis?: { agentId: string; text: string } | null;
}

export function isMantuNeedEmail(text: string): boolean {
  return /this need is now|key required skills/i.test(text) || /^\s*recruiter\s*:/im.test(text);
}

/** Does an inbound mailbox message look like a hiring need / JD email (vs a
 *  candidate reply, newsletter, …)? Used by the intake "Scan inbox" flow to
 *  pick need emails out of a synced mailbox. Mantu "need is now ACTIVE" mails
 *  match on the body; otherwise only a conservative subject-line check — a
 *  false positive here would parse a random email into a job brief. */
export function isNeedEmail(subject: string, body: string): boolean {
  if (isMantuNeedEmail(body) || isMantuNeedEmail(subject)) return true;
  return /\b(job description|jd attached|new (role|position|need|vacancy|opening)|hiring request|backfill|open (position|need|role)|platform need|requisition)\b/i.test(
    subject,
  );
}

/** Structured parser for the Mantu/Amaris "need is now ACTIVE" recruitment email. */
export function parseMantuNeed(text: string): ParsedIntake {
  const field = (label: string): string =>
    text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";

  const title =
    text.match(/this need is now active\s*:?\s*(.+)/i)?.[1]?.trim() ||
    field("Subject") ||
    field("Need") ||
    "";

  const manager = field("Manager");
  const recruiter = field("Recruiter");
  const client = field("Client");
  const priority = field("Priority");
  const locationRaw = field("Location");
  const startRaw = field("Start date");
  const typeRaw = field("Type");

  const emailMatch = text.match(/[A-Za-z0-9._+-]{1,128}@[A-Za-z0-9-]{1,128}\.[A-Za-z0-9.-]{1,64}/);
  const senderName = manager || recruiter;
  const senderEmail = emailMatch?.[0] ?? "";

  // Priority / importance → urgency
  let urgency: Urgency = "Standard";
  if (/critical/i.test(priority) || /\b1\b/.test(priority) || /high importance|importance:\s*high/i.test(text))
    urgency = "Critical";
  else if (/urgent/i.test(priority) || /\b2\b/.test(priority)) urgency = "Urgent";

  const intent: IntakeIntent = urgency === "Critical" ? "Urgent Hire" : "New Role";

  // Skills — explicit "Skills:" line is authoritative; augment from profile block + dictionary.
  const skillsLine = field("Skills");
  const lineSkills = skillsLine
    ? skillsLine.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const profileSkills = extractProfileDescriptionSkills(text);
  const dictSkills = SKILL_DICTIONARY.filter((s) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(s)}([^a-z]|$)`, "i").test(text),
  );
  const requiredSkills = Array.from(new Set([...lineSkills, ...profileSkills, ...dictSkills])).slice(0, 8);

  const minYearsExperience = extractMinYearsExperience(text);

  let seniority: Seniority = seniorityFromTitle(title);
  if (seniority === "Unspecified") {
    seniority = seniorityFromYears(minYearsExperience);
  }

  const niceToHaveSkills: string[] = [];
  if (/offshore/i.test(text)) niceToHaveSkills.push("Offshore experience");

  // Location → region + timezone (best-effort)
  const loc = titleCase(locationRaw || "");
  const tz = text.match(/\b(CET|CEST|GMT|UTC|EST|PST|IST|SGT|BRT)\b/i)?.[1]?.toUpperCase() ?? "";
  const regions = loc ? [loc] : [];

  // Start date m/d/yyyy → ISO. Null when the need email doesn't state one —
  // createCampaign applies its own default rather than baking a guess in here.
  const d = startRaw ? new Date(startRaw) : null;
  const targetStartDate: string | null = d && !isNaN(d.getTime()) ? d.toISOString() : null;

  const industryExperience = /financial markets|bonds|trading|finance|murex|pricing/i.test(text)
    ? ["Fintech"]
    : /medical device|pharma|healthcare|fda|iso 13485/i.test(text)
      ? ["Healthtech"]
      : [];

  const jobAnalysis: JobAnalysis = {
    title,
    department: client.replace(/\s+Ltd\.?$/i, "").trim() || typeRaw,
    seniority,
    employmentType: /consulting|contract|contractor|freelance/i.test(typeRaw)
      ? "Contract"
      : /part[- ]time/i.test(typeRaw)
        ? "Part-time"
        : /full[- ]time|permanent/i.test(typeRaw)
          ? "Full-time"
          : "Unspecified",
    locationType: /remote/i.test(text)
      ? "Remote"
      : /hybrid/i.test(text)
        ? "Hybrid"
        : /on-?site|in office|in-person/i.test(text)
          ? "On-site"
          : // Mantu need emails always carry a city Location for consulting seats;
            // treat a stated city with no remote/hybrid cue as On-site so the
            // brief can authorize sourcing without a second confirmation step.
            loc
            ? "On-site"
            : "Unspecified",
    regions,
    timezone: tz,
    salaryMin: null,
    salaryMax: null,
    currency: /\bCAD\b|C\$/i.test(text) ? "CAD" : /\bUSD\b|\$/i.test(text) ? "USD" : "",
    equity: /equity|options|esop/i.test(text),
    requiredSkills,
    niceToHaveSkills,
    minYearsExperience,
    maxYearsExperience: null,
    education: "",
    industryExperience,
    companyStageTarget: /\bpublic\b/i.test(text)
      ? ["Public"]
      : /\benterprise\b/i.test(text)
        ? ["Enterprise"]
        : [],
    teamSize: "",
    reportingTo: "",
    urgency,
    language: detectLanguage(text),
    expectedStartDate: targetStartDate,
    validationWarnings: [],
  };

  const validationWarnings: ValidationWarning[] = [
    ...evaluateNeedReadiness(jobAnalysis).issues,
    { field: "salary", severity: "warning", message: "No salary/rate in the need email. Confirm the band." },
  ];
  if (!locationRaw) {
    validationWarnings.push({ field: "location", severity: "warning", message: "No location specified." });
  }
  if (requiredSkills.length > 0 && requiredSkills.length < 3) {
    validationWarnings.push({
      field: "requiredSkills",
      severity: "warning",
      message: "Fewer than 3 required skills were stated. Confirm whether the brief is complete.",
    });
  }
  jobAnalysis.validationWarnings = validationWarnings;

  const hasCritical = validationWarnings.some((w) => w.severity === "critical");
  return {
    sender: { name: senderName, email: senderEmail },
    intent,
    urgency,
    jobAnalysis,
    validationWarnings,
    clarificationDraft: hasCritical ? buildClarificationEmail(senderName, jobAnalysis, validationWarnings) : null,
    confidence: {
      title: 0.95,
      salary: 0.3,
      skills: skillsLine ? 0.95 : 0.7,
      location: locationRaw ? 0.92 : 0.5,
      seniority: 0.8,
    },
    extractionMode: "evidence",
  };
}

/** Hard cap on parser input — a JD email is never this long; prevents any
 *  pathological-input CPU blowup regardless of caller. */
const MAX_PARSE_CHARS = 20000;

const NON_LOCATION_VALUES = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "office",
  "the office",
  "python",
  "typescript",
  "javascript",
  "java",
  "go",
  "rust",
  "react",
  "node",
  "kubernetes",
]);

function normalizeParsedLocation(raw: string | undefined): string {
  if (!raw) return "";
  const value = raw
    .replace(/\s+/g, " ")
    .replace(/^(?:our|the|a|an)\s+/i, "")
    .replace(/\s+(?:with|must|who|that|to|for|joining|join|experience|team|department|office)\b.*$/i, "")
    .replace(/^[\s:,-]+|[\s.,;:!?)\]]+$/g, "")
    .trim();
  if (!value || value.length > 80 || !/[a-z]/i.test(value)) return "";
  if (NON_LOCATION_VALUES.has(value.toLowerCase())) return "";
  if (/^(?:strong|senior|staff|lead|principal|backend|frontend|full[- ]stack|software|data|platform)\b/i.test(value)) return "";
  return value
    .split(" ")
    .map((part) => (part === part.toLowerCase() ? part.replace(/^[a-z]/, (c) => c.toUpperCase()) : part))
    .join(" ");
}

function extractLocation(text: string): string {
  const patterns = [
    /\blocation\s*[:\-]\s*([A-Za-z][A-Za-z .,'/-]{1,80})/gi,
    /\bbased\s+in\s+([A-Za-z][A-Za-z .,'/-]{1,80})/gi,
    /\bteam\s+in\s+([A-Za-z][A-Za-z .,'/-]{1,80})/gi,
    /\bin\s+([A-Z][A-Za-z.'/-]*(?:\s+[A-Z][A-Za-z.'/-]*){0,3}(?:,\s*[A-Z][A-Za-z .'-]*)?)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const location = normalizeParsedLocation(match[1]);
      if (location) return location;
    }
  }
  return "";
}

export function parseEmailAndJD(input: { email: string; jd?: string }): ParsedIntake {
  const text = `${input.email}\n${input.jd ?? ""}`.slice(0, MAX_PARSE_CHARS);
  const lower = text.toLowerCase();

  // Structured Mantu/Amaris "need is now ACTIVE" email → dedicated parser.
  if (isMantuNeedEmail(text)) return parseMantuNeed(text);

  // Sender extraction
  const emailMatch = text.match(/[A-Za-z0-9._+-]{1,128}@[A-Za-z0-9-]{1,128}\.[A-Za-z0-9.-]{1,64}/);
  const fromLine = text.match(/from:\s*(.+)/i)?.[1] ?? "";
  const nameMatch =
    fromLine.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1] ??
    text.match(/(?:thanks|regards|best|cheers)[,\s]+\n?\s*([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1] ??
    "";
  const senderEmail = emailMatch?.[0] ?? "";

  // Intent
  let intent: IntakeIntent = "New Role";
  if (/backfill|replace|left the team|departure|resign/i.test(text)) intent = "Backfill";
  else if (/asap|urgent|immediately|yesterday|critical/i.test(text)) intent = "Urgent Hire";
  else if (/exploratory|pipeline|future|keep warm|no rush/i.test(text)) intent = "Exploratory";

  // Urgency
  let urgency: Urgency = "Standard";
  if (/\basap\b|immediately|yesterday/i.test(text)) urgency = "ASAP";
  else if (/critical|p0|blocking/i.test(text)) urgency = "Critical";
  else if (/urgent|high priority|priority/i.test(text)) urgency = "Urgent";
  else if (/this week|by friday|next few days/i.test(text)) urgency = "This Week";

  // Title
  const titleMatch =
    text.match(/(?:hiring|looking for|need|seeking|backfill)\s+(?:an?\s+)?([A-Z][\w/ +.-]{3,48}?(?:Engineer|Developer|Designer|Manager|Lead|Architect|Scientist|Analyst))/i)?.[1] ??
    text.match(/(?:role|position|title):\s*(.+)/i)?.[1] ??
    "";
  const title = titleMatch.trim().replace(/\s+/g, " ");

  // Seniority — title first, then years floors ("8 years +", "5+ years").
  let seniority: Seniority = seniorityFromTitle(title);

  // Department (specific signals first; word-boundaries to avoid false hits like
  // "design and operate" or "service contracts")
  let department = "";
  if (/\b(devops|sre|platform engineer|infrastructure|kubernetes|distributed systems|backend)\b/i.test(text))
    department = "Platform";
  else if (/\b(data engineer|ml|machine learning|analytics|data scientist)\b/i.test(text)) department = "Data";
  else if (/\b(sales|account executive|revenue|sdr|bdr)\b/i.test(text)) department = "Sales";
  else if (/\b(product manager|product owner|head of product)\b/i.test(text)) department = "Product";
  else if (/\b(designer|product design|ux|ui|design systems)\b/i.test(text)) department = "Design";

  // Location type
  let locationType: JobAnalysis["locationType"] = "Unspecified";
  if (/fully remote|remote-first|100% remote|\bremote\b/i.test(text)) locationType = "Remote";
  else if (/\bhybrid\b/i.test(text)) locationType = "Hybrid";
  else if (/on-?site|in office|in-person/i.test(text)) locationType = "On-site";

  // Regions
  const regions: string[] = [];
  for (const r of ["EU", "US", "UK", "APAC", "LATAM", "Europe", "Germany", "Canada", "Remote"]) {
    if (new RegExp(`\\b${r}\\b`, "i").test(text)) regions.push(r === "Europe" ? "EU" : r);
  }
  // Timezone
  const tzMatch = text.match(/\b(CET|CEST|GMT|UTC|EST|PST|IST|SGT|BRT)\b/i)?.[1]?.toUpperCase() ?? "";

  const location = extractLocation(text);

  // Salary
  const salaryNums = [...text.matchAll(/[€$£]?\s?(\d{2,3})\s?k\b/gi)].map((m) => parseInt(m[1], 10) * 1000);
  const salaryMin = salaryNums.length ? Math.min(...salaryNums) : null;
  const salaryMax = salaryNums.length ? Math.max(...salaryNums) : null;
  const currency = salaryNums.length > 0
    ? /£/.test(text)
      ? "GBP"
      : /\$/.test(text)
        ? "USD"
        : /€/.test(text)
          ? "EUR"
          : ""
    : "";

  // Years
  const yearsMatch = [...text.matchAll(/(\d{1,2})[\s+]{0,6}(?:years|yrs)/gi)].map((m) => parseInt(m[1], 10));
  const minYearsExperience =
    extractMinYearsExperience(text) ?? (yearsMatch.length ? Math.min(...yearsMatch) : null);
  const maxYearsExperience = yearsMatch.length > 1 ? Math.max(...yearsMatch) : null;
  if (seniority === "Unspecified") {
    seniority = seniorityFromYears(minYearsExperience);
  }

  // Skills
  const requiredSkills = SKILL_DICTIONARY.filter((s) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(s)}([^a-z]|$)`, "i").test(text),
  ).slice(0, 8);
  const niceToHaveSkills = SKILL_DICTIONARY.filter(
    (s) => !requiredSkills.includes(s) && new RegExp(`nice to have[^.]*${escapeRegExp(s)}`, "i").test(lower),
  ).slice(0, 4);

  // Equity / company stage
  const equity = /equity|options|esop|stock/i.test(text);
  const companyStageTarget: CompanyStage[] = /series\s*b/i.test(text)
    ? ["Series A", "Series B"]
    : /series\s*a/i.test(text)
      ? ["Seed", "Series A"]
      : /enterprise|public/i.test(text)
        ? ["Series C+", "Public"]
        : [];

  // Industry
  const industryExperience = INDUSTRIES.filter((i) => new RegExp(i.replace("/", ".?"), "i").test(text)).slice(0, 2);

  const jobAnalysis: JobAnalysis = {
    title,
    department,
    seniority,
    employmentType: /\b(contractor|freelance|contract role|contract position|fixed[- ]term|day rate)\b/i.test(text)
      ? "Contract"
      : /\bpart[- ]time\b/i.test(text)
        ? "Part-time"
        : /\bfull[- ]time\b|\bpermanent\b/i.test(text)
          ? "Full-time"
          : "Unspecified",
    locationType,
    ...(location ? { location } : {}),
    regions: Array.from(new Set(regions)),
    timezone: tzMatch,
    salaryMin,
    salaryMax,
    currency,
    equity,
    requiredSkills,
    niceToHaveSkills,
    minYearsExperience,
    maxYearsExperience,
    education: /phd|master|bachelor|degree/i.test(text)
      ? (text.match(/phd|master'?s|bachelor'?s/i)?.[0] ?? "Degree preferred")
      : "",
    industryExperience,
    companyStageTarget,
    teamSize: text.match(/team of (\d+)/i)?.[0] ?? "",
    reportingTo: text.match(/report(?:s|ing) to (?:the )?([A-Za-z ]+?)[.,\n]/i)?.[1]?.trim() ?? "",
    urgency,
    language: detectLanguage(text),
    validationWarnings: [],
  };

  const validationWarnings: ValidationWarning[] = [...evaluateNeedReadiness(jobAnalysis).issues];
  if (salaryMin == null) {
    validationWarnings.push({ field: "salary", severity: "warning", message: "No salary range provided." });
  }
  if (requiredSkills.length > 0 && requiredSkills.length < 3) {
    validationWarnings.push({
      field: "requiredSkills",
      severity: "warning",
      message: "Fewer than 3 required skills were stated. Confirm whether the brief is complete.",
    });
  }
  if (minYearsExperience == null) {
    validationWarnings.push({ field: "experience", severity: "warning", message: "No years-of-experience band specified." });
  }
  jobAnalysis.validationWarnings = validationWarnings;

  const hasCritical = validationWarnings.some((w) => w.severity === "critical") || salaryMin == null;
  const clarificationDraft = hasCritical ? buildClarificationEmail(nameMatch, jobAnalysis, validationWarnings) : null;

  return {
    sender: { name: nameMatch, email: senderEmail },
    intent,
    urgency,
    jobAnalysis,
    validationWarnings,
    clarificationDraft,
    confidence: {
      title: requiredSkills.length > 4 ? 0.92 : 0.74,
      salary: salaryMin != null ? 0.9 : 0.4,
      skills: clamp(0.55 + requiredSkills.length * 0.05, 0.5, 0.95),
      location: location ? 0.9 : locationType === "Remote" ? 0.9 : 0.7,
      seniority: seniority === "Unspecified" ? 0 : 0.85,
    },
    extractionMode: "evidence",
  };
}

/** Exported so the live intake parser (src/lib/ai/intake.ts) can build the same
 *  clarification draft off a live-parsed JobAnalysis — kept in one place so the
 *  copy stays identical between the heuristic and live paths. */
export function buildClarificationEmail(name: string, jd: JobAnalysis, warnings: ValidationWarning[]): string {
  const asks = warnings.map((w) => `• ${w.message}`).join("\n");
  return `Hi ${name.split(" ")[0]},

Thanks for the brief on the ${jd.title} role. I'll kick off sourcing right away. To target the right people and avoid wasted outreach, could you confirm a few details:

${asks}
• Confirmed budget band and whether equity is on the table
• Must-have vs. nice-to-have skills, if any flexibility

I'll spin up the campaign the moment these land. In the meantime I've drafted a provisional profile so we lose no time.

Best,
Aria Sourcing`;
}

/* ============================================================================
   2. buildSourcingStrategy + createCampaign
   ========================================================================== */

// GitHub's `location:` qualifier is a literal free-text match against a user's
// self-reported profile location — it only works with real place names ("Germany",
// "London"). Continent/remote-status codes like "EU"/"APAC"/"Remote" essentially
// never appear verbatim in a profile, so including them zeroes out an otherwise
// good query. Only apply the qualifier for a region that's an actual place.
const NON_LOCATION_REGIONS = new Set(["EU", "APAC", "LATAM", "Remote", "Global"]);

/** Extract role-relevant phrases from Mantu "Profile description:" blocks. */
function extractProfileDescriptionSkills(text: string): string[] {
  const block =
    text.match(/profile description\s*:\s*([\s\S]*?)(?:\n\s*(?:skills|key required|rate)\s*:|\n\s*$)/i)?.[1] ??
    "";
  if (!block.trim()) return [];
  const found: string[] = [];
  const patterns: [RegExp, string][] = [
    [/system design(?:ing)?/i, "system design"],
    [/product development/i, "product development"],
    [/medical device/i, "medical device"],
    [/validation engineer/i, "validation engineering"],
    [/requirements?(?:\s+management)?/i, "requirements management"],
    [/\b(uml|sysml)\b/i, "UML"],
    [/architect/i, "systems architecture"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(block) && !found.includes(label)) found.push(label);
  }
  return found;
}

/** Keyword query for site:linkedin.com web search (Tavily/DDG). */
export function buildLinkedInKeywords(jd: JobAnalysis): string {
  const title = jd.title.trim();
  const region = jd.regions.find((r) => r.trim() && !NON_LOCATION_REGIONS.has(r))?.trim() ?? "";
  const industry = jd.industryExperience[0]?.trim() ?? "";
  const skillKeywords = jd.requiredSkills.slice(0, 3).map((skill) => {
    const lower = skill.toLowerCase();
    if (/medical device/i.test(lower)) return "medical device";
    if (/fda/i.test(lower)) return "FDA";
    if (/quality systems/i.test(lower)) return "quality systems";
    if (/mttf|mean time to failure/i.test(lower)) return "reliability engineering";
    if (/system design/i.test(lower)) return "system design";
    const short = skill.split(/[,;/]/)[0]?.trim() ?? skill;
    return short.split(/\s+/).slice(0, 3).join(" ");
  });
  return [title, jd.seniority !== "Unspecified" ? jd.seniority : "", ...skillKeywords, region, industry]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 256);
}

/**
 * Deep LinkedIn search variants — title aliases, skills, location, industry —
 * so the sourcing agent can cast a wide net and keep only 80%+ fits.
 */
export function roleTitleSearchAliases(title: string): string[] {
  const t = title.trim();
  if (!t) return [];
  const aliases = new Set<string>([t, `"${t}"`]);
  if (/system designer/i.test(t)) {
    for (const a of [
      "Systems Designer",
      "System Architect",
      "Systems Architect",
      "Systems Engineer",
      "System Design Engineer",
      "Systems Design Engineer",
      "Product Development Engineer",
      "R&D System Designer",
      "Medical Device System Designer",
      "Senior System Designer",
      "Senior Systems Designer",
    ]) {
      aliases.add(a);
      aliases.add(`"${a}"`);
    }
  }
  if (/murex/i.test(t)) {
    for (const a of ["Murex Consultant", "Murex Support", "Front Office Support"]) aliases.add(a);
  }
  return [...aliases];
}

export function buildLinkedInQueryVariants(jd: JobAnalysis, max = 12): string[] {
  const title = jd.title.trim();
  if (!title) return [];
  const region = jd.regions.find((r) => r.trim() && !NON_LOCATION_REGIONS.has(r))?.trim() ?? "";
  const industry = jd.industryExperience[0]?.trim() ?? "";
  const seniority = jd.seniority !== "Unspecified" ? jd.seniority : "";
  const skills = jd.requiredSkills.slice(0, 5).map((skill) => {
    const lower = skill.toLowerCase();
    if (/medical device/i.test(lower)) return "medical device";
    if (/fda/i.test(lower)) return "FDA";
    if (/mttf|mean time to failure/i.test(lower)) return "MTTF";
    if (/system design/i.test(lower)) return "system design";
    if (/quality systems/i.test(lower)) return "quality systems";
    const acronym = skill.match(/\(([A-Za-z0-9+.#]{2,})\)/)?.[1];
    if (acronym) return acronym;
    return (skill.split(/[,;/]/)[0]?.trim() ?? skill).split(/\s+/).slice(0, 3).join(" ");
  });

  const titleAliases = roleTitleSearchAliases(title);
  const geos = Array.from(
    new Set(
      [region, region && /montreal/i.test(region) ? "Quebec" : "", region ? "Canada" : "", "Montreal"]
        .filter(Boolean)
        .map((g) => String(g)),
    ),
  );
  const variants: string[] = [buildLinkedInKeywords(jd)];
  for (const alias of titleAliases.slice(0, 6)) {
    for (const geo of geos.slice(0, 2)) {
      variants.push([seniority, alias, geo].filter(Boolean).join(" "));
      variants.push([alias, skills[0], geo].filter(Boolean).join(" "));
    }
    variants.push([alias, industry || "medical device", geos[0] || region].filter(Boolean).join(" "));
  }
  if (skills[1]) variants.push([titleAliases[0], skills[1], geos[0] || region || industry].filter(Boolean).join(" "));
  if (skills[2]) variants.push([titleAliases[0], skills[2], geos[0] || region].filter(Boolean).join(" "));

  return Array.from(
    new Set(
      variants
        .map((q) => q.replace(/\s+/g, " ").trim().slice(0, 256))
        .filter((q) => q.length >= 3),
    ),
  ).slice(0, max);
}

export function buildSourcingStrategy(jd: JobAnalysis): SourcingStrategy {
  const topSkills = jd.requiredSkills.slice(0, 4);
  const region = jd.regions[0];
  const locationQualifier = region && !NON_LOCATION_REGIONS.has(region) ? ` location:${region}` : "";
  // Note: only user-search qualifiers are valid here (language:, location:,
  // followers:, repos:, created:). Repo qualifiers like `stars:` silently zero
  // out the whole query on /search/users.
  const githubQueries: GithubQuery[] = topSkills.slice(0, 3).map((skill, i) => ({
    label: `${skill} contributors`,
    query: `language:${skill.replace(/\s+/g, "")}${locationQualifier} followers:>40 ${
      i === 0 ? "repos:>10" : "repos:>5"
    }`,
    estimatedResults: 120 + i * 60,
  }));

  const linkedinBoolean = buildLinkedInKeywords(jd);

  const profile = roleProfile(jd);
  return {
    // Platform mix adapts to the role family (code roles → GitHub-led; everything
    // else → professional networks first).
    primaryPlatforms: profile.platforms.slice(0, 2),
    secondaryPlatforms: profile.platforms.slice(2).length ? profile.platforms.slice(2) : ["Referral"],
    githubQueries,
    linkedinBoolean,
    stackOverflowTags: topSkills.map((s) => s.toLowerCase().replace(/\s+/g, "-")),
    geoTargets: jd.regions,
    excludedCompanies: ["Granite Industries", "Eastfield Group"],
    targetCompanyStages: jd.companyStageTarget,
  };
}

export function emptyMetrics(): CampaignMetrics {
  return {
    sourced: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    booked: 0,
    interviewed: 0,
    offer: 0,
    hired: 0,
    notInterested: 0,
    replyRate: 0,
    avgMatchScore: 0,
    timeToFirstInterviewHours: null,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  };
}

export function createCampaign(
  jd: JobAnalysis,
  meta: { hiringManager: string; hiringManagerEmail: string },
): Campaign {
  const id = makeCampaignId(jd.title);
  return {
    id,
    title: jd.title,
    department: jd.department,
    urgency: jd.urgency,
    status: "Sourcing",
    hiringManager: meta.hiringManager,
    hiringManagerEmail: meta.hiringManagerEmail,
    createdAt: new Date().toISOString(),
    targetStartDate: jd.expectedStartDate ?? isoDaysAfter(45, new Date()),
    jobAnalysis: jd,
    sourcingStrategy: buildSourcingStrategy(jd),
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    metrics: emptyMetrics(),
    skillUpdates: [],
    activities: [],
  };
}

/* ============================================================================
   3. sourceCandidates
   ========================================================================== */

export function sourceCandidates(
  campaign: Campaign,
  platform: SourcePlatform,
  count: number,
  existing: Candidate[],
  batchSeed = 0,
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const rng = makeRng(
    campaign.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) + existing.length * 7 + batchSeed * 31,
  );

  // Generate a few extra so dedupe has something to skip (demonstrates Rule 5).
  const raw: Candidate[] = [];
  for (let i = 0; i < count + 3; i++) {
    raw.push(synthCandidate(campaign, platform, rng, i));
  }

  // Inject a guaranteed duplicate + an excluded-company hit when possible.
  if (existing.length > 0) {
    const dup = { ...existing[Math.floor(rng() * existing.length)] };
    raw.splice(1, 0, { ...dup, id: genId("cand"), campaignId: campaign.id });
  }
  if (campaign.sourcingStrategy.excludedCompanies.length > 0) {
    raw.splice(2, 0, synthCandidate(campaign, platform, rng, 99, campaign.sourcingStrategy.excludedCompanies[0]));
  }

  const { accepted, skipped } = dedupeCandidates(raw, existing, {
    excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
  });

  // Score + trim to requested count
  const scored = accepted.slice(0, count).map((c) => {
    const { score, breakdown } = scoreCandidate(c, jd, weights);
    return { ...c, matchScore: score, matchBreakdown: breakdown };
  });

  return { accepted: scored, skipped };
}

function synthCandidate(
  campaign: Campaign,
  platform: SourcePlatform,
  rng: () => number,
  i: number,
  forceCompany?: string,
): Candidate {
  const jd = campaign.jobAnalysis;
  const profile = roleProfile(jd); // role-agnostic: titles/companies/skills match the need
  const first = pick(FIRST_NAMES, rng);
  const last = pick(LAST_NAMES, rng);
  const name = `${first} ${last}`;
  const stage = pick(jd.companyStageTarget.length ? jd.companyStageTarget : (["Series B"] as CompanyStage[]), rng);
  const company = forceCompany ?? pick(profile.companies, rng);
  const loc = pick(LOCATIONS, rng);
  const handle = `${first}${last}`.toLowerCase();

  // Skills: most required + some nice; tech "extras" only for code roles so a
  // finance/sales candidate isn't handed Kubernetes.
  const reqTake = Math.max(2, Math.ceil(jd.requiredSkills.length * (0.55 + rng() * 0.4)));
  const extras = profile.queryStyle === "github" ? pickN(EXTRA_SKILLS, 2 + Math.floor(rng() * 3), rng) : [];
  const techStack = Array.from(
    new Set([
      ...pickN(jd.requiredSkills, reqTake, rng),
      ...pickN(jd.niceToHaveSkills, Math.floor(rng() * 2), rng),
      ...extras,
    ]),
  );

  const baseYears =
    jd.minYearsExperience != null ? jd.minYearsExperience : jd.seniority === "Senior" ? 6 : 4;
  const yearsExperience = clamp(Math.round(baseYears + (rng() * 6 - 2)), 1, 22);

  const currentTitle = pick(profile.titles, rng);

  return {
    id: genId("cand"),
    campaignId: campaign.id,
    name,
    email: `${handle}@${slugify(company)}.example`,
    // Synthetic demo phone so the WhatsApp/SMS channels are demonstrable; real sourced
    // candidates (e.g. GitHub) have no phone until enriched.
    phone: `+1415${Math.floor(rng() * 9_000_000 + 1_000_000)}`,
    avatarInitials: initialsFrom(name),
    currentTitle,
    currentCompany: company,
    location: loc.city,
    timezone: loc.tz,
    linkedinUrl: `https://www.linkedin.com/in/${handle}-${Math.floor(rng() * 9000 + 1000)}`,
    githubUrl: platform === "GitHub" ? `https://github.com/${handle}` : "",
    sourcePlatform: platform,
    sourceQuery:
      platform === "GitHub"
        ? campaign.sourcingStrategy.githubQueries[i % Math.max(1, campaign.sourcingStrategy.githubQueries.length)]?.query ?? "language:typescript"
        : campaign.sourcingStrategy.linkedinBoolean.slice(0, 80) + "…",
    matchScore: 0,
    matchBreakdown: [],
    techStack,
    yearsExperience,
    companyStageExperience: Array.from(new Set([stage, pick(jd.companyStageTarget.length ? jd.companyStageTarget : [stage], rng)])),
    industryExperience: pickN(jd.industryExperience.length ? jd.industryExperience : INDUSTRIES, 1 + Math.floor(rng() * 2), rng),
    recentActivity: pick(ACTIVITY_LINES, rng),
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    provenance: "synthetic",
  };
}

/* ============================================================================
   4. generateOutreach
   ========================================================================== */

export interface GeneratedOutreach {
  subject: string;
  body: string;
  personalizationEvidence: string[];
  channel: OutreachChannel;
}

export function generateOutreach(
  candidate: Candidate,
  campaign: Campaign,
  tone: OutreachTone,
  channel: OutreachChannel = "Email",
  sequenceStep = 1,
  voice?: { persona?: string; signature?: string },
  language?: string,
): GeneratedOutreach {
  const jd = campaign.jobAnalysis;
  const firstName = candidate.name.split(" ")[0];
  const topSkill = sharedRequiredSkills(candidate, jd)[0]?.trim() || null;
  const evidence = personalizationEvidence(candidate, jd);

  // Compose in the need's language (or the requested one); English is the fallback.
  const lang = language ?? jd.language ?? "en";
  const L = outreachStrings(lang);
  const mantuVoice = mantuOutreachVoice(voice?.signature);
  const effectiveVoice = voice?.persona?.trim() ? voice : mantuVoice;
  const greeting = topSkill
    ? L.greeting(firstName, topSkill, candidate.currentCompany)
    : L.salutation(firstName);

  const subject = sequenceStep > 1
    ? L.subjectFollow(jd.title, firstName)
    : topSkill
      ? L.subjectNew(jd.title, topSkill)
      : L.subjectGeneric(jd.title);

  const emailBody = [
    greeting,
    "",
    `${L.roleLine(jd.title, jd.locationType, jd.regions.join("/"))}${jd.equity ? " " + L.equity : ""}`,
    ...(evidence.length ? ["", L.whyYou(evidence[0], evidence[1])] : []),
    "",
    sequenceStep > 1 ? L.ctaFollow : L.cta,
    // No auto-appended footer: a recruiter's own sign-off is added only when set;
    // no default "Sent by Aria" line and no opt-out boilerplate.
    ...(effectiveVoice?.signature && effectiveVoice.signature.trim() ? ["", effectiveVoice.signature.trim()] : []),
  ].join("\n");

  // WhatsApp / SMS are short-form: one tight message, no long role/why blocks and no
  // subject line in the body (the channel adapters deliver the body only).
  const phoneBody = [
    greeting,
    sequenceStep > 1 ? L.ctaFollow : L.cta,
    ...(effectiveVoice?.signature && effectiveVoice.signature.trim() ? [effectiveVoice.signature.trim()] : []),
  ]
    .filter(Boolean)
    .join(" ");

  const body = channel === "WhatsApp" || channel === "SMS" ? phoneBody : emailBody;

  // ALWAYS humanize — no AI slop ever.
  return {
    subject: humanizeText(subject),
    body: humanizeText(body),
    personalizationEvidence: evidence,
    channel,
  };
}

function sharedRequiredSkills(candidate: Candidate, jd: JobAnalysis): string[] {
  const required = new Set(jd.requiredSkills.map((skill) => skill.trim().toLowerCase()));
  return candidate.techStack.filter((skill) => required.has(skill.trim().toLowerCase()));
}

function personalizationEvidence(candidate: Candidate, jd: JobAnalysis): string[] {
  const ev: string[] = [];
  const shared = sharedRequiredSkills(candidate, jd);
  if (shared.length) ev.push(`You work across ${shared.slice(0, 3).join(", ")}, exactly our core stack`);
  if (candidate.yearsExperience != null) {
    ev.push(
      `${candidate.yearsExperience} yrs of depth${candidate.currentCompany ? `, currently at ${candidate.currentCompany}` : ""}`,
    );
  }
  if (candidate.recentActivity && !/no activity signal/i.test(candidate.recentActivity)) {
    ev.push(candidate.recentActivity.replace(/\.$/, ""));
  }
  if (candidate.companyStageExperience.length)
    ev.push(`Experience at ${candidate.companyStageExperience.join(" / ")} stage companies`);
  return ev.slice(0, 3);
}

export function newOutreachMessage(
  candidate: Candidate,
  campaign: Campaign,
  gen: GeneratedOutreach,
  tone: OutreachTone,
  settings: SystemSettings,
  sequenceStep = 1,
): OutreachMessage {
  return {
    id: genId("msg"),
    candidateId: candidate.id,
    campaignId: campaign.id,
    channel: gen.channel,
    subject: gen.subject,
    body: gen.body,
    tone,
    personalizationEvidence: gen.personalizationEvidence,
    // Browser settings never grant delivery authority. Every generated message
    // starts in named human review; channel-specific handling begins only after
    // the approval is durably recorded.
    status: "Needs Approval",
    sequenceStep,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: settings.dryRunMode,
    createdAt: new Date().toISOString(),
  };
}

/* ============================================================================
   5. classifyReply
   ========================================================================== */

export interface ReplyClassification {
  intent: ReplyIntent;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
  draftResponse: string;
}

export function classifyReply(replyText: string, candidateName = "there"): ReplyClassification {
  const t = replyText.toLowerCase();
  const first = candidateName.split(" ")[0];
  let intent: ReplyIntent = "UNCLEAR";
  let confidence = 0.6;
  let reasoning = "No strong signal detected; routing to human review.";

  // Multilingual intent detection (EN/FR/ES/DE/PT/IT/NL via the merged lexicon).
  if (REPLY_LEXICON.negative.test(t)) {
    intent = "NEGATIVE";
    confidence = 0.93;
    reasoning = "Opt-out / hostile language detected: must stop immediately and escalate.";
  } else if (REPLY_LEXICON.ooo.test(t)) {
    intent = "OOO";
    confidence = 0.95;
    reasoning = "Auto-reply / absence language detected.";
  } else if (REPLY_LEXICON.notInterested.test(t)) {
    intent = "NOT_INTERESTED";
    confidence = 0.9;
    reasoning = "Explicit decline language detected.";
  } else if (REPLY_LEXICON.referral.test(t)) {
    intent = "REFERRAL";
    confidence = 0.82;
    reasoning = "Candidate is pointing to someone else (referral path).";
  } else if (REPLY_LEXICON.interested.test(t)) {
    if (REPLY_LEXICON.qualified.test(t)) {
      intent = "QUALIFIED_INTEREST";
      confidence = 0.78;
      reasoning = "Positive signal with open questions: answer, then offer the calendar.";
    } else {
      intent = "INTERESTED";
      confidence = 0.9;
      reasoning = "Clear positive intent with a request to proceed.";
    }
  } else if (/(maybe|perhaps|not sure|depends|tell me more|what.s the role|peut-être|quizás|vielleicht)/i.test(t)) {
    intent = "QUALIFIED_INTEREST";
    confidence = 0.72;
    reasoning = "Soft positive with hesitation: nurture and inform.";
  } else if (REPLY_LEXICON.qualified.test(t)) {
    // Role/comp questions with no decline → qualified interest (per reply_classification_skill).
    intent = "QUALIFIED_INTEREST";
    confidence = 0.72;
    reasoning = "Questions about comp/role without a decline: answer and append the calendar.";
  }

  return {
    intent,
    confidence,
    reasoning,
    suggestedAction: SUGGESTED_ACTION[intent],
    draftResponse: humanizeText(draftFor(intent, first)),
  };
}

const SUGGESTED_ACTION: Record<ReplyIntent, string> = {
  INTERESTED: "Send booking link immediately (15-min SLA) and update stage to Interested.",
  QUALIFIED_INTEREST: "Answer their questions, append the calendar link, keep nurturing.",
  NOT_INTERESTED: "Send a gracious close and start the suppression timer.",
  REFERRAL: "Thank them and create the referred candidate as a new lead.",
  OOO: "Pause the sequence until their return date.",
  UNCLEAR: "Queue for human review: intent ambiguous.",
  NEGATIVE: "Stop all outreach immediately, add to do-not-contact, and escalate.",
};

function draftFor(intent: ReplyIntent, first: string): string {
  switch (intent) {
    case "INTERESTED":
      return `Brilliant, ${first}! Thank you. Here's my calendar so you can grab whatever suits: {{cal_link}}. I'll send a Teams invite the moment you pick a slot. Looking forward to it.`;
    case "QUALIFIED_INTEREST":
      return `Great questions, ${first}. Quick answers: comp and remote policy are both flexible within band, and the team is small and senior. If it's easier to talk it through, here's my calendar: {{cal_link}}.`;
    case "NOT_INTERESTED":
      return `Completely understand, ${first}. Thanks for the quick reply. I'll close this out and won't keep nudging. If the timing ever changes, you know where to find me. All the best.`;
    case "REFERRAL":
      return `Really appreciate that, ${first}! If you can intro me, I'd be glad to reach out. Thank you for thinking of the right person.`;
    case "OOO":
      return `Thanks for the note. Enjoy the time away, ${first}. I'll pause and circle back after you're settled back in.`;
    case "NEGATIVE":
      return `Understood, ${first}. I've removed you from all outreach and you won't hear from us again. Apologies for the intrusion.`;
    default:
      return `Thanks, ${first}. Just to make sure I read you right: would you like me to share more on the role, or is now not the moment?`;
  }
}

/* ============================================================================
   6. createBooking
   ========================================================================== */

export function createBooking(
  candidate: Candidate,
  campaign: Campaign,
  // Null when the interviewer roster is empty (see resolveBookingSlot in
  // store.ts) — an honest gap rather than a fabricated name.
  interviewer: Interviewer | null,
  startTime: Date,
): Booking {
  const end = new Date(startTime.getTime() + 30 * 60000);
  return {
    id: genId("bk"),
    candidateId: candidate.id,
    campaignId: campaign.id,
    candidateName: candidate.name,
    role: campaign.title,
    startTime: startTime.toISOString(),
    endTime: end.toISOString(),
    timezone: candidate.timezone,
    interviewer: interviewer?.name ?? "",
    interviewerEmail: interviewer?.email ?? "",
    // Real meeting URLs are issued by the calendar provider (Microsoft Graph / Cal.com) at
    // live-send time. Until that integration is connected, leave these empty rather than
    // fabricate links that 404 — the calendar UI renders an "on live send" state.
    teamsLink: "",
    calLink: "",
    status: "Confirmed",
    agenda: [
      "Intro & role context (5 min)",
      "Background & recent work (10 min)",
      "Technical deep-dive (10 min)",
      "Candidate questions (5 min)",
    ],
    createdAt: new Date().toISOString(),
  };
}

export function interviewerPrepEmail(b: Booking, candidate: Candidate): string {
  // No interviewer assigned yet (empty roster) — greet generically rather
  // than produce "Hi ,".
  const firstName = b.interviewer ? b.interviewer.split(" ")[0] : "there";
  return `Subject: Interview prep: ${b.candidateName} for ${b.role}

Hi ${firstName},

You're interviewing ${b.candidateName} (${candidate.currentTitle} @ ${candidate.currentCompany}) for ${b.role}.
Match score: ${candidate.matchScore}. Stack: ${candidate.techStack.slice(0, 5).join(", ")}.

Focus areas: ${candidate.matchBreakdown.slice(0, 2).map((x) => x.label).join(", ")}.
Calendar link: ${b.teamsLink || b.calLink || "To be confirmed"}

Agenda:
${b.agenda.map((a) => `- ${a}`).join("\n")}

Aria`;
}

export function candidateConfirmationEmail(b: Booking): string {
  const when = new Date(b.startTime).toLocaleString("en-US", {
    timeZone: ianaForAbbrev(b.timezone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `Subject: Confirmed: your ${b.role} conversation

Hi ${b.candidateName.split(" ")[0]},

You're booked in. Details:
• When: ${when}
• With: ${b.interviewer || "Interviewer to be confirmed"}
• Where: ${b.teamsLink || b.calLink || "To be confirmed"}

No prep needed, just bring your questions. Reply here if you need to move it.

Looking forward to it.`;
}

/* ============================================================================
   7. generateWeeklyReport + exportMarkdownReport
   ========================================================================== */

export function generateWeeklyReport(
  campaign: Campaign,
  candidates: Candidate[],
  messages: OutreachMessage[],
): WeeklyReport {
  const inCampaign = candidates.filter((c) => c.campaignId === campaign.id);
  // Canonical funnel snapshot — reuses the same effectiveStageRank-based
  // high-water-mark logic as the dashboard/reports (metrics.ts), so a
  // candidate who reached Interviewed and later regressed to Rejected still
  // counts at Interviewed here too, instead of a locally-drifted rank map.
  const funnel = funnelForCandidates(inCampaign);
  const m = campaign.metrics;
  const scores = inCampaign.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const replyRate = m.contacted ? m.replied / m.contacted : 0;
  const interestRate = m.replied ? m.interested / m.replied : 0;
  const bookingRate = m.interested ? m.booked / m.interested : 0;

  const skillUpdates = proposeSkillUpdates(campaign, { replyRate, interestRate, avg });

  return {
    id: genId("rep"),
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    generatedAt: new Date().toISOString(),
    // The funnel below counts every candidate ever attached to the campaign
    // (no activity-date filter exists), so it's a cumulative snapshot, not a
    // trailing week — label it honestly rather than implying a week-over-week
    // comparison the data can't actually support.
    periodLabel: "All-time (since campaign start)",
    funnel,
    performance: {
      replyRate,
      interestRate,
      bookingRate,
      avgMatchScore: avg,
      timeToFirstInterviewHours: m.timeToFirstInterviewHours,
      // Fixed industry-reference figures below (costPerHire, bestDay, bestTime) —
      // no hire-cost or send-time-vs-outcome data exists in this app to compute
      // them from. Listed in illustrativeFields so every consumer labels them
      // as illustrative instead of presenting them as this campaign's real numbers.
      costPerHire: 4200,
      bestChannel: computeBestChannel(inCampaign, messages.filter((msg) => msg.campaignId === campaign.id)),
      bestDay: "Tuesday",
      bestTime: "09:00–11:00 local",
    },
    insights: [
      `Reply rate is ${(replyRate * 100).toFixed(0)}% across ${m.contacted} contacted, ${
        replyRate > 0.18 ? "above" : "below"
      } the 18% benchmark.`,
      `Average match score of accepted candidates is ${avg}.`,
      `${m.interested} candidates expressed interest; ${m.booked} converted to booked interviews.`,
    ],
    // Generic sourcing-industry patterns, not measured from this campaign's own
    // messages/replies (see computeBestChannel above for the one metric here
    // that IS derived from real data). Also listed in illustrativeFields.
    winningPatterns: [
      "Messages that lead with a specific open-source reference reply ~2.1× more often.",
      "Tuesday 09:00–11:00 local sends outperform afternoon sends.",
      `${campaign.jobAnalysis.requiredSkills[0] ?? "Core-stack"} mentions in the subject line lift open intent.`,
    ],
    skillUpdates,
    attentionNeeded: buildAttention(campaign),
    illustrativeFields: ["performance.costPerHire", "performance.bestDay", "performance.bestTime", "winningPatterns"],
  };
}

/** Real per-channel reply rate from actual outreach messages, instead of a fixed
 *  Email/LinkedIn split on the overall reply rate that could never surface
 *  WhatsApp or SMS even when they genuinely outperform. Each candidate's
 *  earliest outreach message decides which channel "gets credit" for a later
 *  reply; a channel only competes once it has actually been used. */
function computeBestChannel(inCampaign: Candidate[], campaignMessages: OutreachMessage[]): OutreachChannel {
  const firstChannelByCandidate = new Map<string, OutreachChannel>();
  for (const msg of [...campaignMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!firstChannelByCandidate.has(msg.candidateId)) firstChannelByCandidate.set(msg.candidateId, msg.channel);
  }

  let best: OutreachChannel = "Email";
  let bestRate = -1;
  for (const channel of OUTREACH_CHANNELS) {
    const contacted = inCampaign.filter((c) => firstChannelByCandidate.get(c.id) === channel);
    if (!contacted.length) continue;
    const replied = contacted.filter((c) => effectiveStageRank(c) >= 2).length;
    const rate = replied / contacted.length;
    if (rate > bestRate) {
      bestRate = rate;
      best = channel;
    }
  }
  return best;
}

function buildAttention(c: Campaign): string[] {
  const out: string[] = [];
  const m = c.metrics;
  if (m.sourced > m.contacted) out.push(`${m.sourced - m.contacted} sourced candidates have no outreach drafted.`);
  if (m.interested > m.booked) out.push(`${m.interested - m.booked} interested candidates are awaiting a booking.`);
  if (m.contacted && m.replied / m.contacted < 0.1) out.push("Reply rate under 10%. Consider refreshing the outreach skill.");
  if (out.length === 0) out.push("No blockers. Campaign is healthy.");
  return out;
}

function proposeSkillUpdates(
  campaign: Campaign,
  stats: { replyRate: number; interestRate: number; avg: number },
): SkillUpdate[] {
  const now = new Date().toISOString();
  const updates: SkillUpdate[] = [
    {
      id: genId("skill"),
      skill: "outreach_skill",
      title: "Lead with the candidate's most recent shipped work",
      rationale: `Top-replying messages this week opened with a concrete artifact. Reply rate ${(stats.replyRate * 100).toFixed(0)}%.`,
      before: "Open with the role and company context.",
      after: "Open with the candidate's most recent public artifact, then the role.",
      impact: "+18% projected reply rate",
      status: "proposed",
      createdAt: now,
    },
    {
      id: genId("skill"),
      skill: "scoring_skill",
      title: "Down-weight company-stage when skills match is ≥ 90",
      rationale: "High-skill candidates from off-target stages still convert well.",
      before: "Company-stage weight fixed at 12%.",
      after: "Reduce company-stage weight to 8% when skills score ≥ 90.",
      impact: "Better recall on strong engineers",
      status: "proposed",
      createdAt: now,
    },
    {
      id: genId("skill"),
      skill: "reply_classification_skill",
      title: "Treat salary-only questions as QUALIFIED_INTEREST",
      rationale: "Salary-first replies were under-classified as UNCLEAR.",
      before: "Salary questions without 'interested' → UNCLEAR.",
      after: "Salary/comp questions → QUALIFIED_INTEREST at 0.75 confidence.",
      impact: "Fewer hot leads lost to manual review",
      status: "proposed",
      createdAt: now,
    },
  ];
  return updates;
}

export function exportMarkdownReport(report: WeeklyReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const illustrative = (path: string) => (report.illustrativeFields.includes(path) ? " _(illustrative)_" : "");
  const lines: string[] = [];
  lines.push(`# Weekly Sourcing Report: ${report.campaignTitle}`);
  lines.push("");
  lines.push(`_Generated ${new Date(report.generatedAt).toUTCString()} · ${report.periodLabel}_`);
  lines.push("");
  lines.push("## Funnel");
  lines.push("");
  lines.push("| Stage | Count |");
  lines.push("| --- | ---: |");
  report.funnel.forEach((f) => lines.push(`| ${f.stage} | ${f.count} |`));
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push(`- **Reply rate:** ${pct(report.performance.replyRate)}`);
  lines.push(`- **Interest rate:** ${pct(report.performance.interestRate)}`);
  lines.push(`- **Booking rate:** ${pct(report.performance.bookingRate)}`);
  lines.push(`- **Avg match score:** ${report.performance.avgMatchScore}`);
  lines.push(
    `- **Time to first interview:** ${
      report.performance.timeToFirstInterviewHours != null
        ? `${report.performance.timeToFirstInterviewHours}h`
        : "N/A"
    }`,
  );
  lines.push(
    `- **Cost per hire:** $${report.performance.costPerHire.toLocaleString()}${illustrative("performance.costPerHire")}`,
  );
  lines.push(`- **Best channel:** ${report.performance.bestChannel}`);
  lines.push(
    `- **Best day / time:** ${report.performance.bestDay}, ${report.performance.bestTime}${illustrative("performance.bestDay")}`,
  );
  lines.push("");
  lines.push(`## Winning patterns${illustrative("winningPatterns")}`);
  lines.push("");
  report.winningPatterns.forEach((p) => lines.push(`- ${p}`));
  lines.push("");
  lines.push("## Attention needed");
  lines.push("");
  report.attentionNeeded.forEach((a) => lines.push(`- ${a}`));
  lines.push("");
  lines.push("## Proposed skill updates");
  lines.push("");
  report.skillUpdates.forEach((s) => {
    lines.push(`### ${s.skill}: ${s.title}`);
    lines.push(`- _Rationale:_ ${s.rationale}`);
    lines.push(`- _Before:_ ${s.before}`);
    lines.push(`- _After:_ ${s.after}`);
    lines.push(`- _Impact:_ ${s.impact}`);
    lines.push("");
  });
  lines.push("---");
  lines.push("_Hermes Sourcing · dry-run mode · synthetic data._");
  return lines.join("\n");
}
