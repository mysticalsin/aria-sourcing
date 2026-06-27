import { DEFAULT_SCORING_WEIGHTS, scoreCandidate } from "./scoring";
import { dedupeCandidates, slaDueFor } from "./rules";
import { humanizeText } from "./humanizer";
import type {
  Booking,
  Campaign,
  CampaignMetrics,
  Candidate,
  ClassifiedReply,
  CompanyStage,
  GithubQuery,
  IntakeIntent,
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
import { FUNNEL_STAGES } from "./types";
import {
  campaignId as makeCampaignId,
  clamp,
  escapeRegExp,
  genId,
  initialsFrom,
  isoDaysAfter,
  makeRng,
  pick,
  pickN,
  round,
  slugify,
} from "./utils";

/* ============================================================================
   MOCK AI — deterministic stand-ins for the real Hermes pipeline.
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

const INTERVIEWERS = [
  { name: "Dana Whitfield", email: "dana.whitfield@hermes.example", role: "Engineering Manager" },
  { name: "Marcus Lindqvist", email: "marcus.lindqvist@hermes.example", role: "Staff Engineer" },
  { name: "Priya Nair", email: "priya.nair@hermes.example", role: "Director of Engineering" },
  { name: "Sofia Romano", email: "sofia.romano@hermes.example", role: "Principal Engineer" },
];

export function getInterviewers() {
  return INTERVIEWERS;
}

export function nextInterviewer(bookingCount: number) {
  return INTERVIEWERS[bookingCount % INTERVIEWERS.length];
}

/* ---- Skills dictionary for the parser ----------------------------------- */

const SKILL_DICTIONARY = [
  ...EXTRA_SKILLS,
  "Java", "C++", "Scala", "Elixir", "Ruby", "Swift", "Kotlin", "Next.js", "Vue", "Svelte",
  "TensorFlow", "PyTorch", "LangChain", "LLM", "RAG", "Vector DB", "Snowflake", "dbt", "Spark",
  "Airflow", "MongoDB", "MySQL", "RabbitMQ", "Nginx", "Linux", "REST", "OAuth", "SAML", "SOC2",
  "Figma", "Product Design", "Accessibility", "Design Systems", "Sales", "Negotiation", "CRM",
];

/* ============================================================================
   1. parseEmailAndJD
   ========================================================================== */

export const SAMPLE_INTAKE_EMAIL = `From: Daniela Brandt <daniela.brandt@northwind.example>
Subject: URGENT — backfill Senior Backend Engineer (Go), need pipeline ASAP

Hi Hermes,

One of our senior backend engineers just resigned and we need to backfill this
role critically — ideally someone in seat within 8 weeks. This is high priority.

We're hiring a Senior Backend Engineer, fully remote across the EU (CET-ish
overlap). Core stack is Go, Kubernetes, PostgreSQL and gRPC — they'll own
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

export interface ParsedIntake {
  sender: { name: string; email: string };
  intent: IntakeIntent;
  urgency: Urgency;
  jobAnalysis: JobAnalysis;
  validationWarnings: ValidationWarning[];
  clarificationDraft: string | null;
  confidence: Record<string, number>;
}

export function parseEmailAndJD(input: { email: string; jd?: string }): ParsedIntake {
  const text = `${input.email}\n${input.jd ?? ""}`;
  const lower = text.toLowerCase();

  // Sender extraction
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const fromLine = text.match(/from:\s*(.+)/i)?.[1] ?? "";
  const nameMatch =
    fromLine.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1] ??
    text.match(/(?:thanks|regards|best|cheers)[,\s]+\n?\s*([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1] ??
    "Hiring Manager";
  const senderEmail = emailMatch?.[0] ?? "unknown@company.example";

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
    text.match(/(?:hiring|looking for|need|seeking|backfill)\s+(?:a|an)?\s*([A-Z][\w/ +.-]{3,48}?(?:Engineer|Developer|Designer|Manager|Lead|Architect|Scientist|Analyst))/i)?.[1] ??
    text.match(/(?:role|position|title):\s*(.+)/i)?.[1] ??
    "Senior Software Engineer";
  const title = titleMatch.trim().replace(/\s+/g, " ");

  // Seniority
  let seniority: Seniority = "Senior";
  if (/principal/i.test(title)) seniority = "Principal";
  else if (/staff/i.test(title)) seniority = "Staff";
  else if (/lead/i.test(title)) seniority = "Lead";
  else if (/director|head of/i.test(title)) seniority = "Director";
  else if (/junior|graduate|entry/i.test(title)) seniority = "Junior";
  else if (/\bmid\b|intermediate/i.test(title)) seniority = "Mid";

  // Department (specific signals first; word-boundaries to avoid false hits like
  // "design and operate" or "service contracts")
  let department = "Engineering";
  if (/\b(devops|sre|platform engineer|infrastructure|kubernetes|distributed systems|backend)\b/i.test(text))
    department = "Platform";
  else if (/\b(data engineer|ml|machine learning|analytics|data scientist)\b/i.test(text)) department = "Data";
  else if (/\b(sales|account executive|revenue|sdr|bdr)\b/i.test(text)) department = "Sales";
  else if (/\b(product manager|product owner|head of product)\b/i.test(text)) department = "Product";
  else if (/\b(designer|product design|ux|ui|design systems)\b/i.test(text)) department = "Design";

  // Location type
  let locationType: JobAnalysis["locationType"] = "Hybrid";
  if (/fully remote|remote-first|100% remote|\bremote\b/i.test(text)) locationType = "Remote";
  else if (/on-?site|in office|in-person/i.test(text)) locationType = "On-site";

  // Regions
  const regions: string[] = [];
  for (const r of ["EU", "US", "UK", "APAC", "LATAM", "Europe", "Germany", "Remote"]) {
    if (new RegExp(`\\b${r}\\b`, "i").test(text)) regions.push(r === "Europe" ? "EU" : r);
  }
  if (regions.length === 0) regions.push("EU");

  // Timezone
  const tzMatch = text.match(/\b(CET|CEST|GMT|UTC|EST|PST|IST|SGT|BRT)\b/i)?.[1]?.toUpperCase() ?? "CET";

  // Salary
  const salaryNums = [...text.matchAll(/[€$£]?\s?(\d{2,3})\s?k\b/gi)].map((m) => parseInt(m[1], 10) * 1000);
  const salaryMin = salaryNums.length ? Math.min(...salaryNums) : null;
  const salaryMax = salaryNums.length ? Math.max(...salaryNums) : null;
  const currency = /£/.test(text) ? "GBP" : /\$/.test(text) ? "USD" : "EUR";

  // Years
  const yearsMatch = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)/gi)].map((m) => parseInt(m[1], 10));
  const minYearsExperience = yearsMatch.length ? Math.min(...yearsMatch) : null;
  const maxYearsExperience = yearsMatch.length ? Math.max(...yearsMatch) + 3 : null;

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
        : ["Series A", "Series B"];

  // Industry
  const industryExperience = INDUSTRIES.filter((i) => new RegExp(i.replace("/", ".?"), "i").test(text)).slice(0, 2);

  const validationWarnings: ValidationWarning[] = [];
  if (salaryMin == null)
    validationWarnings.push({ field: "salary", severity: "warning", message: "No salary range provided." });
  if (locationType === "Hybrid" && !/hybrid/i.test(text))
    validationWarnings.push({ field: "location", severity: "info", message: "Location type inferred (defaulted to Hybrid)." });
  if (requiredSkills.length < 3)
    validationWarnings.push({ field: "requiredSkills", severity: "critical", message: "Fewer than 3 required skills detected — JD may be vague." });
  if (minYearsExperience == null)
    validationWarnings.push({ field: "experience", severity: "warning", message: "No years-of-experience band specified." });

  const jobAnalysis: JobAnalysis = {
    title,
    department,
    seniority,
    employmentType: /\b(contractor|freelance|contract role|contract position|fixed[- ]term|day rate)\b/i.test(text)
      ? "Contract"
      : "Full-time",
    locationType,
    regions: Array.from(new Set(regions)),
    timezone: tzMatch,
    salaryMin,
    salaryMax,
    currency,
    equity,
    requiredSkills: requiredSkills.length ? requiredSkills : ["TypeScript", "Node.js", "PostgreSQL"],
    niceToHaveSkills,
    minYearsExperience,
    maxYearsExperience,
    education: /phd|master|bachelor|degree/i.test(text)
      ? (text.match(/phd|master'?s|bachelor'?s/i)?.[0] ?? "Degree preferred")
      : "No formal requirement",
    industryExperience,
    companyStageTarget,
    teamSize: text.match(/team of (\d+)/i)?.[0] ?? "6–10 engineers",
    reportingTo: text.match(/report(?:s|ing) to (?:the )?([A-Za-z ]+?)[.,\n]/i)?.[1]?.trim() ?? "Engineering Manager",
    urgency,
    validationWarnings,
  };

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
      location: locationType === "Remote" ? 0.9 : 0.7,
      seniority: 0.85,
    },
  };
}

function buildClarificationEmail(name: string, jd: JobAnalysis, warnings: ValidationWarning[]): string {
  const asks = warnings.map((w) => `• ${w.message}`).join("\n");
  return `Hi ${name.split(" ")[0]},

Thanks for the brief on the ${jd.title} role — happy to kick off sourcing right away. To target the right people and avoid wasted outreach, could you confirm a few details:

${asks}
• Confirmed budget band and whether equity is on the table
• Must-have vs. nice-to-have skills, if any flexibility

I'll spin up the campaign the moment these land. In the meantime I've drafted a provisional profile so we lose no time.

Best,
Hermes Sourcing`;
}

/* ============================================================================
   2. buildSourcingStrategy + createCampaign
   ========================================================================== */

export function buildSourcingStrategy(jd: JobAnalysis): SourcingStrategy {
  const topSkills = jd.requiredSkills.slice(0, 4);
  const githubQueries: GithubQuery[] = topSkills.slice(0, 3).map((skill, i) => ({
    label: `${skill} contributors`,
    query: `language:${skill.replace(/\s+/g, "")} location:${jd.regions[0] ?? "EU"} followers:>40 ${
      i === 0 ? "stars:>20" : "repos:>5"
    }`,
    estimatedResults: 120 + i * 60,
  }));

  const linkedinBoolean = `("${jd.title}" OR "${jd.seniority} ${jd.department}") AND (${topSkills
    .map((s) => `"${s}"`)
    .join(" OR ")}) AND (${jd.regions.map((r) => `"${r}"`).join(" OR ")}) NOT "recruiter"`;

  return {
    primaryPlatforms: jd.department === "Design" ? ["LinkedIn", "Talent Pool"] : ["GitHub", "LinkedIn"],
    secondaryPlatforms: ["Stack Overflow", "Referral"],
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
    targetStartDate: isoDaysAfter(45, new Date()),
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

export interface SourceResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
}

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
  const first = pick(FIRST_NAMES, rng);
  const last = pick(LAST_NAMES, rng);
  const name = `${first} ${last}`;
  const stage = pick(jd.companyStageTarget.length ? jd.companyStageTarget : (["Series B"] as CompanyStage[]), rng);
  const company = forceCompany ?? pick(COMPANIES_BY_STAGE[stage], rng);
  const loc = pick(LOCATIONS, rng);
  const handle = `${first}${last}`.toLowerCase();

  // Tech stack: most required + some nice + extras → realistic overlap
  const reqTake = Math.max(2, Math.ceil(jd.requiredSkills.length * (0.55 + rng() * 0.4)));
  const techStack = Array.from(
    new Set([
      ...pickN(jd.requiredSkills, reqTake, rng),
      ...pickN(jd.niceToHaveSkills, Math.floor(rng() * 2), rng),
      ...pickN(EXTRA_SKILLS, 2 + Math.floor(rng() * 3), rng),
    ]),
  );

  const baseYears =
    jd.minYearsExperience != null ? jd.minYearsExperience : jd.seniority === "Senior" ? 6 : 4;
  const yearsExperience = clamp(Math.round(baseYears + (rng() * 6 - 2)), 1, 22);

  const titlePrefix = pick(["Senior", "Staff", "Lead", ""], rng);
  const currentTitle = `${titlePrefix ? titlePrefix + " " : ""}${jd.department === "Design" ? "Product Designer" : "Software Engineer"}`.trim();

  return {
    id: genId("cand"),
    campaignId: campaign.id,
    name,
    email: `${handle}@${slugify(company)}.example`,
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
): GeneratedOutreach {
  const jd = campaign.jobAnalysis;
  const firstName = candidate.name.split(" ")[0];
  const topSkill = candidate.techStack[0] ?? jd.requiredSkills[0] ?? "your stack";
  const evidence = personalizationEvidence(candidate, jd);

  const valueHook =
    jd.department === "Design"
      ? "shaping the product surface end-to-end"
      : `owning ${jd.requiredSkills.slice(0, 2).join(" + ")} at the core of the platform`;

  const openers: Record<OutreachTone, string> = {
    "Casual Professional": `Hi ${firstName} — your work with ${topSkill} at ${candidate.currentCompany} stood out.`,
    Executive: `${firstName}, I'll be brief. Your ${topSkill} track record at ${candidate.currentCompany} maps closely to a mandate I'm running.`,
    Technical: `Hi ${firstName} — saw your ${topSkill} work (${candidate.recentActivity.replace(/\.$/, "")}). Technically, it lines up well with what we're building.`,
  };

  const close =
    sequenceStep > 1
      ? "Circling back once in case this slipped — no pressure either way. Worth a quick read?"
      : "Worth a 15-minute, no-strings call to see if it's interesting? I can work around your week.";

  const subject =
    sequenceStep > 1
      ? `Re: ${jd.title} — following up, ${firstName}`
      : tone === "Executive"
        ? `${jd.title} mandate — ${candidate.currentCompany} → next chapter`
        : `${jd.title} role that fits your ${topSkill} work`;

  const body = [
    openers[tone],
    "",
    `We're hiring a ${jd.title} (${jd.locationType}, ${jd.regions.join("/")}) and the shape of the role is about ${valueHook}. ${
      jd.equity ? "Meaningful equity is on the table." : ""
    }`.trim(),
    "",
    `Why you, specifically: ${evidence[0]}${evidence[1] ? ` And ${evidence[1].toLowerCase()}` : ""}.`,
    "",
    close,
    "",
    `${voice?.signature ?? "— Sent in dry-run by Hermes on behalf of the hiring team."} Reply STOP to opt out anytime.`,
  ].join("\n");

  // ALWAYS humanize — no AI slop ever.
  return {
    subject: humanizeText(subject),
    body: humanizeText(body),
    personalizationEvidence: evidence,
    channel,
  };
}

function personalizationEvidence(candidate: Candidate, jd: JobAnalysis): string[] {
  const ev: string[] = [];
  const shared = candidate.techStack.filter((s) => jd.requiredSkills.includes(s));
  if (shared.length) ev.push(`You work across ${shared.slice(0, 3).join(", ")} — exactly our core stack`);
  ev.push(`${candidate.yearsExperience} yrs of depth, currently at ${candidate.currentCompany}`);
  if (candidate.recentActivity) ev.push(candidate.recentActivity.replace(/\.$/, ""));
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
    status: settings.humanApprovalGate ? "Needs Approval" : "Approved",
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

  if (/stop|unsubscribe|do not contact|remove me|how did you get|gdpr|leave me alone/i.test(t)) {
    intent = "NEGATIVE";
    confidence = 0.93;
    reasoning = "Opt-out / hostile language detected — must stop immediately and escalate.";
  } else if (/out of office|ooo|on leave|on vacation|annual leave|back on/i.test(t)) {
    intent = "OOO";
    confidence = 0.95;
    reasoning = "Auto-reply / absence language detected.";
  } else if (/(not interested|no thanks|happy where i am|not looking|not the right time|pass\b)/i.test(t)) {
    intent = "NOT_INTERESTED";
    confidence = 0.9;
    reasoning = "Explicit decline language detected.";
  } else if (/(refer|reach out to|you should talk to|my colleague|know someone|connect you with)/i.test(t)) {
    intent = "REFERRAL";
    confidence = 0.82;
    reasoning = "Candidate is pointing to someone else — referral path.";
  } else if (/(interested|yes|let's talk|sounds great|keen|love to|happy to chat|tell me when|book)/i.test(t)) {
    if (/(salary|comp|range|remote|relocat|visa|equity|stack|team|what (?:is|are)|how many|questions?)/i.test(t)) {
      intent = "QUALIFIED_INTEREST";
      confidence = 0.78;
      reasoning = "Positive signal with open questions — answer, then offer the calendar.";
    } else {
      intent = "INTERESTED";
      confidence = 0.9;
      reasoning = "Clear positive intent with a request to proceed.";
    }
  } else if (/(maybe|perhaps|not sure|depends|tell me more|what.s the role)/i.test(t)) {
    intent = "QUALIFIED_INTEREST";
    confidence = 0.72;
    reasoning = "Soft positive with hesitation — nurture and inform.";
  } else if (
    /(salary|comp|compensation|package|benefits|remote|relocat|visa|sponsor|equity|stack|team size|how many|what (?:is|are)|\?)/i.test(t)
  ) {
    // Role/comp questions with no decline → qualified interest (per reply_classification_skill).
    intent = "QUALIFIED_INTEREST";
    confidence = 0.72;
    reasoning = "Questions about comp/role without a decline — answer and append the calendar.";
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
  UNCLEAR: "Queue for human review — intent ambiguous.",
  NEGATIVE: "Stop all outreach immediately, add to do-not-contact, and escalate.",
};

function draftFor(intent: ReplyIntent, first: string): string {
  switch (intent) {
    case "INTERESTED":
      return `Brilliant, ${first} — thank you! Here's my calendar so you can grab whatever suits: {{cal_link}}. I'll send a Teams invite the moment you pick a slot. Looking forward to it.`;
    case "QUALIFIED_INTEREST":
      return `Great questions, ${first}. Quick answers: comp and remote policy are both flexible within band, and the team is small and senior. If it's easier to talk it through, here's my calendar: {{cal_link}}.`;
    case "NOT_INTERESTED":
      return `Completely understand, ${first} — thanks for the quick reply. I'll close this out and won't keep nudging. If the timing ever changes, you know where to find me. All the best.`;
    case "REFERRAL":
      return `Really appreciate that, ${first}! If you're happy to intro me, I'd be glad to reach out. Thank you for thinking of the right person.`;
    case "OOO":
      return `Thanks for the note — enjoy the time away, ${first}. I'll pause and circle back after you're settled back in.`;
    case "NEGATIVE":
      return `Understood, ${first}. I've removed you from all outreach and you won't hear from us again. Apologies for the intrusion.`;
    default:
      return `Thanks ${first} — just to make sure I read you right, would you like me to share more on the role, or is now not the moment?`;
  }
}

/* ============================================================================
   6. createBooking
   ========================================================================== */

export function createBooking(
  candidate: Candidate,
  campaign: Campaign,
  interviewer: { name: string; email: string; role: string },
  startTime: Date,
): Booking {
  const end = new Date(startTime.getTime() + 30 * 60000);
  const slug = `${slugify(candidate.name)}-${slugify(campaign.title)}`.slice(0, 40);
  return {
    id: genId("bk"),
    candidateId: candidate.id,
    campaignId: campaign.id,
    candidateName: candidate.name,
    role: campaign.title,
    startTime: startTime.toISOString(),
    endTime: end.toISOString(),
    timezone: candidate.timezone,
    interviewer: interviewer.name,
    interviewerEmail: interviewer.email,
    teamsLink: `https://teams.microsoft.com/l/meetup-join/hermes/${slug}-${Math.floor(startTime.getTime() / 100000) % 100000}`,
    calLink: `https://cal.com/hermes/${slug}`,
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
  return `Subject: Prep — ${b.candidateName} for ${b.role}

Hi ${b.interviewer.split(" ")[0]},

You're interviewing ${b.candidateName} (${candidate.currentTitle} @ ${candidate.currentCompany}) for ${b.role}.
Match score: ${candidate.matchScore}. Stack: ${candidate.techStack.slice(0, 5).join(", ")}.

Focus areas: ${candidate.matchBreakdown.slice(0, 2).map((x) => x.label).join(", ")}.
Teams link: ${b.teamsLink}

Agenda:
${b.agenda.map((a) => `- ${a}`).join("\n")}

— Hermes`;
}

export function candidateConfirmationEmail(b: Booking): string {
  return `Subject: Confirmed — your ${b.role} conversation

Hi ${b.candidateName.split(" ")[0]},

You're booked in. Details:
• When: ${new Date(b.startTime).toUTCString()} (${b.timezone})
• With: ${b.interviewer}
• Where: ${b.teamsLink}

No prep needed — just bring your questions. Reply here if you need to move it.

Looking forward,
Hermes (on behalf of the hiring team)`;
}

/* ============================================================================
   7. generateWeeklyReport + exportMarkdownReport
   ========================================================================== */

export function generateWeeklyReport(campaign: Campaign, candidates: Candidate[]): WeeklyReport {
  const inCampaign = candidates.filter((c) => c.campaignId === campaign.id);
  const stageCount = (s: string) => inCampaign.filter((c) => stageRank(c.stage) >= funnelRank(s)).length;

  const funnel = FUNNEL_STAGES.map((stage) => ({ stage, count: stageCount(stage) }));
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
    periodLabel: "Last 7 days",
    funnel,
    performance: {
      replyRate,
      interestRate,
      bookingRate,
      avgMatchScore: avg,
      timeToFirstInterviewHours: m.timeToFirstInterviewHours,
      costPerHire: 4200,
      bestChannel: replyRate > 0.18 ? "Email" : "LinkedIn",
      bestDay: "Tuesday",
      bestTime: "09:00–11:00 local",
    },
    insights: [
      `Reply rate is ${(replyRate * 100).toFixed(0)}% across ${m.contacted} contacted — ${
        replyRate > 0.18 ? "above" : "below"
      } the 18% benchmark.`,
      `Average match score of accepted candidates is ${avg}.`,
      `${m.interested} candidates expressed interest; ${m.booked} converted to booked interviews.`,
    ],
    winningPatterns: [
      "Messages that lead with a specific open-source reference reply ~2.1× more often.",
      "Tuesday 09:00–11:00 local sends outperform afternoon sends.",
      `${campaign.jobAnalysis.requiredSkills[0] ?? "Core-stack"} mentions in the subject line lift open intent.`,
    ],
    skillUpdates,
    attentionNeeded: buildAttention(campaign),
  };
}

function buildAttention(c: Campaign): string[] {
  const out: string[] = [];
  const m = c.metrics;
  if (m.sourced > m.contacted) out.push(`${m.sourced - m.contacted} sourced candidates have no outreach drafted.`);
  if (m.interested > m.booked) out.push(`${m.interested - m.booked} interested candidates are awaiting a booking.`);
  if (m.contacted && m.replied / m.contacted < 0.1) out.push("Reply rate under 10% — consider refreshing the outreach skill.");
  if (out.length === 0) out.push("No blockers — campaign is healthy.");
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

/* funnel/stage ranking so a candidate counts in every earlier funnel band */
const STAGE_ORDER = [
  "Sourced", "Contacted", "Replied", "Interested", "Booked", "Interviewed", "Offer", "Hired",
];
function stageRank(stage: string): number {
  const map: Record<string, number> = {
    Sourced: 0, Contacted: 1, Replied: 2, Interested: 3, Booked: 4, Interviewed: 5, Offer: 6, Hired: 7,
    "Not Interested": 2, Rejected: 2, Suppressed: 1,
  };
  return map[stage] ?? 0;
}
function funnelRank(stage: string): number {
  return STAGE_ORDER.indexOf(stage);
}

export function exportMarkdownReport(report: WeeklyReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const lines: string[] = [];
  lines.push(`# Weekly Sourcing Report — ${report.campaignTitle}`);
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
        : "—"
    }`,
  );
  lines.push(`- **Cost per hire (est.):** $${report.performance.costPerHire.toLocaleString()}`);
  lines.push(`- **Best channel:** ${report.performance.bestChannel}`);
  lines.push(`- **Best day / time:** ${report.performance.bestDay}, ${report.performance.bestTime}`);
  lines.push("");
  lines.push("## Winning patterns");
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
    lines.push(`### ${s.skill} — ${s.title}`);
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

export { STAGE_ORDER };
