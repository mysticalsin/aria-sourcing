import { defaultIntegrations } from "./integrations";
import {
  candidateConfirmationEmail,
  createBooking,
  generateOutreach,
  generateWeeklyReport,
  interviewerPrepEmail,
  sourceCandidates,
  buildSourcingStrategy,
} from "./mock-ai";
import { bookingInterviewTitle } from "./booking-status";
import { DEFAULT_SCORING_WEIGHTS } from "./scoring";
import { firstInterviewElapsedHours } from "./metrics";
import { slaDueFor } from "./rules";
import { defaultFleetSettings, defaultSendWindow } from "./fleet";
import { defaultSkills } from "./skills";
import type {
  Activity,
  AgentSeat,
  Booking,
  Campaign,
  CampaignMetrics,
  Candidate,
  ChatboxSubmission,
  ClassifiedReply,
  GuardrailConfig,
  HermesState,
  InterviewRecord,
  Interviewer,
  JobAnalysis,
  LeadSource,
  LlmProvider,
  OutreachLedgerEntry,
  OutreachMessage,
  PrequalRecord,
  ReplyIntent,
  SavedModel,
  StarRating,
  SuppressionEntry,
  SystemSettings,
  ToolDef,
  ToolId,
  WeeklyReport,
} from "./types";
import { LLM_PROVIDERS, TOOL_IDS } from "./types";
import {
  computeChatboxScore,
  DEFAULT_STAR_THRESHOLDS,
  deriveStarRating,
  isCandidate,
} from "./tania";
import { genId, isoDaysBefore, isoHoursBefore, round, SEED_NOW } from "./utils";

/* ============================================================================
   Seed builder — produces the initial synthetic world (client-side, once).
   ========================================================================== */

// STATE_VERSION 14 — registered interviewer roster (interviewers slice) replaces
// the hardcoded mock-ai INTERVIEWERS list; interviewers are now stored,
// admin-editable data instead of a fake fixed 4-person cast.
// STATE_VERSION 16 — roadmap integration cards must never keep older fabricated
// connected/lastSync state after the default seed became honest.
// STATE_VERSION 17 - Databricks execution authority moved out of the shared
// workspace JSON and into an admin-owned normalized database record.
// STATE_VERSION 19 — purge historical demo candidates/outreach/replies/bookings;
// fresh workspaces start Ready-to-source with zero candidates (E2E clean slate).
export const STATE_VERSION = 19;

/* ---- LLM config defaults ------------------------------------------------- */

const TOOL_META: Record<ToolId, { label: string; description: string }> = {
  web_search: { label: "Web search", description: "Search the public web for candidate research and signal." },
  browser: { label: "Browser", description: "Open and navigate web pages for deep research." },
  github_sourcing: { label: "GitHub sourcing", description: "Search GitHub profiles, repos, and contributions." },
  linkedin_sourcing: { label: "LinkedIn sourcing", description: "Search LinkedIn for candidate signals (read-only official API)." },
  enrichment: { label: "Enrichment", description: "Enrich candidate profiles with public data (Clearbit, Hunter, etc.)." },
  email_send: { label: "Email send", description: "Send outreach and follow-ups via the configured seat provider." },
  calendar: { label: "Calendar", description: "Create and manage interview calendar invites." },
  vision: { label: "Vision", description: "Analyse images and screenshots attached to candidate profiles." },
  image_gen: { label: "Image generation", description: "Generate avatars and visual assets for reports." },
  memory: { label: "Memory", description: "Persist learned facts about candidates and campaigns across runs." },
  skills: { label: "Skill execution", description: "Run the learned outreach, scoring, and sourcing skill playbooks." },
};

export function defaultLlmProviders(): LlmProvider[] {
  return LLM_PROVIDERS.map((kind) => ({
    id: `prov_${kind.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    kind,
    label: kind,
    // The public demo resolves its chat/agent models to a Kimi (Kimi Code) key held in
    // the server env, so Kimi is the enabled default provider; the rest activate once a
    // key is added in Settings → AI & Models.
    enabled: kind === "Kimi",
    isDefault: kind === "Kimi",
  }));
}

export function defaultSavedModels(): SavedModel[] {
  return [
    {
      // The demo's active model — Kimi Code, resolved to the server-env KIMI_API_KEY.
      id: "model_kimi_coding",
      providerId: "prov_kimi",
      modelName: "kimi-for-coding",
      label: "Kimi K2 (Code)",
      contextWindow: 256000,
      enabled: true,
      // No "sourcing": the sourcing agent requires tool-calling, which Kimi doesn't
      // support (runSourcingAgent in store.ts hard-rejects it). Leaving it out of
      // this list — and out of defaultModels.sourcing below — lets resolveAiProvider
      // fall through to its "no provider configured" path instead of a guaranteed failure.
      defaultForTask: ["outreach", "classification", "chat"],
    },
    {
      id: "model_claude_opus_4",
      providerId: "prov_anthropic",
      modelName: "claude-opus-4-5",
      label: "Claude Opus 4.5",
      contextWindow: 200000,
      enabled: true,
      defaultForTask: ["sourcing", "outreach"],
    },
    {
      id: "model_claude_sonnet_4",
      providerId: "prov_anthropic",
      modelName: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      contextWindow: 200000,
      enabled: true,
      defaultForTask: ["classification", "chat"],
    },
  ];
}

export function defaultTools(): ToolDef[] {
  return TOOL_IDS.map((id) => ({
    id,
    label: TOOL_META[id].label,
    description: TOOL_META[id].description,
    enabled: true,
  }));
}

export function defaultSettings(): SystemSettings {
  return {
    humanApprovalGate: true,
    dryRunMode: true,
    webResearch: true,
    minScoreToContact: 80,
    starRatingThresholds: { topGun: 88, a: 80, b: 65, c: 50 },
    slaMinutes: 15,
    operatorName: "Jordan Bryce",
    systemIdentity: "Aria Sourcing",
    rateLimits: {
      emailsPerDay: 15,
      linkedinPerDay: 20,
      followUpGapDays: 3,
      suppressionDays: 90,
    },
    compliance: {
      candidateRetentionDays: 180,
      jdRetentionDays: 365,
      emailContentRetentionDays: 365,
      crmAuditLogs: true,
      unsubscribeEnforcement: true,
      ccpaDoNotSell: true,
      gdprMode: true,
    },
    fleet: defaultFleetSettings(),
    confidentialityMode: true,
    defaultLanguage: "en",
    soundEnabled: false,
    guardrails: defaultGuardrails(),
    notifications: { slack: false, telegram: false, email: true },
    llmProviders: defaultLlmProviders(),
    savedModels: defaultSavedModels(),
    tools: defaultTools(),
    mcpServers: [],
    defaultModels: {
      // No sourcing default: Kimi can't run it (no tool-calling) and no other
      // provider is enabled out of the box, so resolveAiProvider correctly reports
      // "not configured" until an operator sets a tool-calling-capable provider.
      outreach: "model_kimi_coding",
      classification: "model_kimi_coding",
      chat: "model_kimi_coding",
    },
    hermesLiveMode: false,
    hermesApiUrl: "",
    hermesApiKeyId: "",
    memoryCapacity: 200,
    hermesWebUrl: "",
  };
}

export function defaultGuardrails(): GuardrailConfig {
  return {
    ariaPrompt:
      "You are Aria, the recruiting operations brain behind every Aria agent. " +
      "Each agent is an autonomous teammate that sources, qualifies, and reaches out to candidates on its own. " +
      "Lead with the candidate's recent, specific work; one genuine reason you're reaching out; a soft, low-pressure ask. " +
      "Be warm, concise, peer-to-peer. Never write AI slop. Respect every guardrail below without exception.",
    rules: [
      { id: genId("gr"), text: "Official APIs and authorized mailboxes only: never scrape, never automate LinkedIn DMs or logins. LinkedIn outreach uses assisted-manual copy/paste or an official LinkedIn Recruiter System Connect integration.", enabled: true, locked: true },
      { id: genId("gr"), text: "Human approval required before any real send; dry-run is the default.", enabled: true, locked: true },
      { id: genId("gr"), text: "Honor per-seat daily caps, warm-up ramps, send windows, and the shared suppression + de-dupe ledger: no one is contacted twice.", enabled: true, locked: true },
      { id: genId("gr"), text: "Candidate PII is purpose-limited to active outreach and masked everywhere else; every reveal is audited.", enabled: true, locked: true },
      { id: genId("gr"), text: "Always run the Humanizer: strip AI tells, em-dashes, and corporate filler before anything is shown or sent.", enabled: true, locked: true },
      { id: genId("gr"), text: "Personalize every first line with something specific to the candidate; no generic templates.", enabled: true, locked: false },
      { id: genId("gr"), text: "Keep first-touch messages under 120 words and end with a single, clear call to action.", enabled: true, locked: false },
      { id: genId("gr"), text: "If a reply is negative or asks to stop, suppress immediately and never re-contact.", enabled: true, locked: false },
    ],
  };
}

/* ---- Fleet seats + suppression ------------------------------------------- */

function seedSeats(): AgentSeat[] {
  const win = defaultSendWindow("CET");
  const base = {
    status: "active" as const,
    mode: "mock" as const,
    domainVerified: true,
    dailyLimit: 40,
    warmup: true,
    warmupStartCap: 12,
    warmupStepPerDay: 4,
    minGapMinutes: 12,
    sendWindow: win,
    lastSendAt: isoHoursBefore(2),
    persona:
      "Warm, concise, peer-to-peer recruiter. Lead with the candidate's most recent shipped work, one specific genuine compliment, then a soft 15-minute ask. No corporate fluff, no AI slop.",
    signature: "",
    connectedAccount: "",
    createdAt: isoDaysBefore(40),
  };
  return [
    {
      ...base,
      id: "seat_maya",
      name: "Aria · Maya R.",
      operatorEmail: "maya.rivera@hermes.example",
      provider: "Microsoft Graph",
      warmupStartedAt: isoDaysBefore(24),
      sentToday: 6,
      health: { sentTotal: 612, bounces: 9, complaints: 0, bounceRate: 0.015, complaintRate: 0 },
    },
    {
      ...base,
      id: "seat_diego",
      name: "Aria · Diego K.",
      operatorEmail: "diego.khan@hermes.example",
      provider: "Gmail API",
      warmupStartedAt: isoDaysBefore(30),
      sentToday: 3,
      health: { sentTotal: 540, bounces: 7, complaints: 0, bounceRate: 0.013, complaintRate: 0 },
    },
    {
      ...base,
      id: "seat_aisha",
      name: "Aria · Aisha N.",
      operatorEmail: "aisha.nwosu@hermes.example",
      provider: "Microsoft Graph",
      warmupStartedAt: isoDaysBefore(5), // still warming up
      sentToday: 2,
      health: { sentTotal: 96, bounces: 1, complaints: 0, bounceRate: 0.01, complaintRate: 0 },
    },
    {
      ...base,
      id: "seat_lucas",
      name: "Aria · Lucas P.",
      operatorEmail: "lucas.park@hermes.example",
      provider: "SendGrid",
      warmupStartedAt: isoDaysBefore(18),
      sentToday: 0,
      // Elevated bounce rate → auto-paused by the guardrail engine (demo).
      health: { sentTotal: 280, bounces: 19, complaints: 0, bounceRate: 0.068, complaintRate: 0 },
    },
  ];
}

function seedSuppression(): SuppressionEntry[] {
  return [
    { id: genId("supp"), type: "email", value: "do-not-contact@example.com", reason: "Do-not-contact request", source: "Operator", createdAt: isoDaysBefore(30), expiresAt: null },
    { id: genId("supp"), type: "domain", value: "competitor-excluded.example", reason: "Excluded company domain", source: "Policy", createdAt: isoDaysBefore(20), expiresAt: null },
    { id: genId("supp"), type: "email", value: "unsub@example.com", reason: "Unsubscribed", source: "Unsubscribe link", createdAt: isoDaysBefore(12), expiresAt: null },
  ];
}

/** The demo's starter interviewer roster (formerly mock-ai's hardcoded
 *  INTERVIEWERS list). Exported so store.ts can fall back to it when
 *  migrating a pre-STATE_VERSION-14 blob that predates the interviewers
 *  slice — real staff, once editable, replace these in Settings. */
export function seedInterviewers(): Interviewer[] {
  return [
    { id: "intv_dana", name: "Dana Whitfield", email: "dana.whitfield@hermes.example", role: "Engineering Manager", active: true },
    { id: "intv_marcus", name: "Marcus Lindqvist", email: "marcus.lindqvist@hermes.example", role: "Staff Engineer", active: true },
    { id: "intv_priya", name: "Priya Nair", email: "priya.nair@hermes.example", role: "Director of Engineering", active: true },
    { id: "intv_sofia", name: "Sofia Romano", email: "sofia.romano@hermes.example", role: "Principal Engineer", active: true },
  ];
}

/* ---- Hand-authored job analyses ----------------------------------------- */

function backendJob(): JobAnalysis {
  return {
    title: "Senior Backend Engineer",
    department: "Platform",
    seniority: "Senior",
    employmentType: "Full-time",
    locationType: "Remote",
    regions: ["EU"],
    timezone: "CET",
    salaryMin: 90000,
    salaryMax: 120000,
    currency: "EUR",
    equity: true,
    requiredSkills: ["Go", "Kubernetes", "PostgreSQL", "gRPC", "Distributed Systems"],
    niceToHaveSkills: ["Kafka", "OpenTelemetry", "Terraform"],
    minYearsExperience: 5,
    maxYearsExperience: 10,
    education: "No formal requirement",
    industryExperience: ["Fintech", "SaaS"],
    companyStageTarget: ["Series A", "Series B"],
    teamSize: "Team of 8 engineers",
    reportingTo: "VP Engineering",
    urgency: "ASAP",
    validationWarnings: [],
  };
}

function frontendJob(): JobAnalysis {
  return {
    title: "Staff Frontend Engineer",
    department: "Engineering",
    seniority: "Staff",
    employmentType: "Full-time",
    locationType: "Hybrid",
    regions: ["EU", "UK"],
    timezone: "CET",
    salaryMin: 95000,
    salaryMax: 130000,
    currency: "EUR",
    equity: true,
    requiredSkills: ["TypeScript", "React", "Next.js", "GraphQL", "Accessibility"],
    niceToHaveSkills: ["Design Systems", "Observability"],
    minYearsExperience: 7,
    maxYearsExperience: 12,
    education: "No formal requirement",
    industryExperience: ["SaaS", "E-commerce"],
    companyStageTarget: ["Series B", "Series C+"],
    teamSize: "Frontend guild of 12",
    reportingTo: "Director of Engineering",
    urgency: "Urgent",
    validationWarnings: [],
  };
}

function designerJob(): JobAnalysis {
  return {
    title: "Senior Product Designer",
    department: "Design",
    seniority: "Senior",
    employmentType: "Full-time",
    locationType: "Hybrid",
    regions: ["EU"],
    timezone: "CET",
    salaryMin: 70000,
    salaryMax: 95000,
    currency: "EUR",
    equity: false,
    requiredSkills: ["Figma", "Design Systems", "Product Design", "Accessibility"],
    niceToHaveSkills: ["Prototyping", "Design Tokens"],
    minYearsExperience: 4,
    maxYearsExperience: 8,
    education: "No formal requirement",
    industryExperience: ["SaaS", "Healthtech"],
    companyStageTarget: ["Series A", "Series B"],
    teamSize: "Design team of 5",
    reportingTo: "Head of Design",
    urgency: "This Week",
    validationWarnings: [
      { field: "salary", severity: "info", message: "Band confirmed; equity not offered for this role." },
    ],
  };
}

/* ---- Stage plans (sorted by score desc receive these in order) ----------- */

const RANK: Record<string, number> = {
  Sourced: 0, Contacted: 1, Replied: 2, Interested: 3, Booked: 4, Interviewed: 5, Offer: 6, Hired: 7,
  "Not Interested": 2, Rejected: 1, Suppressed: 1,
};

type Stage = Candidate["stage"];

interface CampaignSpec {
  id: string;
  job: JobAnalysis;
  hiringManager: string;
  hiringManagerEmail: string;
  status: Campaign["status"];
  count: number;
  stagePlan: Stage[]; // applied to score-desc-sorted candidates
}

const SPECS: CampaignSpec[] = [
  {
    id: "camp_seed_backend",
    job: backendJob(),
    hiringManager: "Daniela Brandt",
    hiringManagerEmail: "daniela.brandt@northwind.example",
    status: "Interviewing",
    count: 22,
    stagePlan: [
      "Interviewed", "Booked", "Booked", "Interested", "Interested", "Interested",
      "Replied", "Replied", "Replied", "Replied", "Contacted", "Contacted",
      "Contacted", "Contacted", "Contacted", "Sourced", "Sourced", "Sourced",
      "Sourced", "Sourced", "Sourced", "Not Interested",
    ],
  },
  {
    id: "camp_seed_frontend",
    job: frontendJob(),
    hiringManager: "Marcus Lindqvist",
    hiringManagerEmail: "marcus.lindqvist@brightloop.example",
    status: "Outreach",
    count: 18,
    stagePlan: [
      "Booked", "Interested", "Interested", "Replied", "Replied", "Replied",
      "Contacted", "Contacted", "Contacted", "Contacted", "Contacted", "Sourced",
      "Sourced", "Sourced", "Sourced", "Sourced", "Sourced", "Not Interested",
    ],
  },
  {
    id: "camp_seed_design",
    job: designerJob(),
    hiringManager: "Priya Nair",
    hiringManagerEmail: "priya.nair@helixdata.example",
    status: "Sourcing",
    count: 12,
    stagePlan: [
      "Booked", "Interested", "Replied", "Replied", "Contacted", "Contacted",
      "Contacted", "Sourced", "Sourced", "Sourced", "Sourced", "Sourced",
    ],
  },
];

/* ---- Sample reply bodies by intent --------------------------------------- */

const REPLY_BODIES: Record<ReplyIntent, string[]> = {
  INTERESTED: [
    "This sounds genuinely interesting. Yes, I'd love to learn more. When works for a quick call?",
    "Great timing, I'm open to a conversation. I can find a slot this week.",
  ],
  QUALIFIED_INTEREST: [
    "Potentially interested: what's the comp band and is it fully remote? Also how big is the team?",
    "Could be a fit. Tell me more about the tech stack and whether visa sponsorship is possible.",
  ],
  NOT_INTERESTED: [
    "Thanks for reaching out, but I'm happy where I am right now. Not looking to move.",
    "Appreciate it, but not the right time for me. Good luck with the search.",
  ],
  REFERRAL: ["Not for me, but you should talk to my colleague who's actively looking. Want an intro?"],
  OOO: ["I'm out of office until next Monday with limited access to email."],
  UNCLEAR: ["Hmm, maybe? Depends what you mean exactly."],
  NEGATIVE: ["Please stop contacting me and remove my details. How did you get my email?"],
};

function replyIntentForStage(stage: Stage): ReplyIntent {
  switch (stage) {
    case "Interested":
    case "Booked":
    case "Interviewed":
      return "INTERESTED";
    case "Replied":
      return "QUALIFIED_INTEREST";
    case "Not Interested":
      return "NOT_INTERESTED";
    default:
      return "UNCLEAR";
  }
}

/* ---- Activity helper ----------------------------------------------------- */

function act(
  type: Activity["type"],
  title: string,
  notes: string,
  outcome: string,
  campaignId: string | null,
  linked: { type: Activity["linkedEntityType"]; id: string } | null,
  createdAt: string,
): Activity {
  return {
    id: genId("act"),
    type,
    title,
    notes,
    outcome,
    campaignId,
    linkedEntityType: linked?.type ?? null,
    linkedEntityId: linked?.id ?? null,
    createdAt,
  };
}

/* ---- Main builder -------------------------------------------------------- */

/* ---- TAnIA seed layer ---------------------------------------------------- */

const REFERRERS = [
  "Amélie Rousseau",
  "Marco Bianchi",
  "Priya Nair",
  "Tom Kowalski",
  "Sofia Almeida",
];

const KNIGHT_M_NOTES = [
  "Inclusive language check passed: no gendered or age-coded terms.",
  "Salary transparency present; EU pay-directive aligned.",
  "Accessibility statement included; no exclusionary requirements.",
];

/** Five vacancy-specific screening questions (TAnIA §5, Q1–Q5). */
function screeningQuestionsFor(job: JobAnalysis): string[] {
  const loc = job.regions[0] ?? "the target region";
  const skill = job.requiredSkills[0] ?? "the core skill";
  const tool = job.requiredSkills[1] ?? job.requiredSkills[0] ?? "the primary tool";
  return [
    `This role requires ${job.locationType.toLowerCase()} presence in ${loc}. Is this compatible?`,
    "Do you require visa sponsorship to work in the target country?",
    `How experienced are you in ${skill}? (1–5)`,
    `How would you rate your ${tool} experience? (1–5)`,
    "Have you managed international stakeholders in this domain?",
  ];
}

/**
 * Layer TAnIA concepts onto the freshly-built candidate pool + campaigns:
 * lead source distribution, star ratings, #Vivier, prequal + interview records,
 * DNA, and Knight-M-checked job ads. Deterministic (index-keyed) so the demo
 * world is stable across reloads. Returns the seeded chatbox submissions.
 */
function seedTania(candidates: Candidate[], campaigns: Campaign[]): ChatboxSubmission[] {
  const t = DEFAULT_STAR_THRESHOLDS;

  candidates.forEach((c, i) => {
    // Lead-source distribution: 20% Applicant, 10% Referral, 70% Outbound.
    const mod = i % 10;
    const source: LeadSource = mod < 2 ? "Applicant" : mod === 2 ? "Referral" : "Outbound";
    c.leadSource = source;
    if (source === "Referral") c.referredBy = REFERRERS[i % REFERRERS.length];

    // Star rating derived from the existing match score.
    c.starRating = deriveStarRating(c.matchScore, t);

    // DNA — top skills + a captured signal, stored back for the talent pool.
    c.dna = [
      ...c.techStack.slice(0, 3),
      ...(c.yearsExperience == null ? [] : [`${c.yearsExperience}y experience`]),
    ];

    // #Vivier: strong profiles that dropped out are Silver Medalists, always pooled.
    // recontactAt is a PAST date for those already due to re-engage, future for the
    // rest (isoDaysBefore(n): positive n = n days ago, negative = n days ahead).
    const dropped = c.stage === "Rejected" || c.stage === "Not Interested";
    if (dropped && (c.starRating === "TopGun" || c.starRating === "A")) {
      c.vivier = true;
      c.silverMedalist = true;
      c.recontactAt = isoDaysBefore(12 + (i % 20)); // due now (12–32 days ago)
    } else if (source !== "Applicant" && dropped) {
      // Referrals & Outbound are always pooled on rejection (TAnIA §3).
      c.vivier = true;
      c.recontactAt = isoDaysBefore(-(20 + (i % 50))); // future re-contact window
    }

    // Prequal + interviews for anyone who became a Candidate (Stage II+).
    if (isCandidate(c)) {
      const prequal: PrequalRecord = {
        scheduledFor: isoDaysBefore(9 - (i % 4)),
        completedAt: isoDaysBefore(9 - (i % 4)),
        starRating: c.starRating,
        toneGuide: source === "Referral" ? "Warm, recognise the referral" : "Proactive, opportunity-led",
        questions: [
          { q: "Motivation for exploring a move now?", a: "Growth + scope; open to the right team.", kind: "text" },
          { q: "Compensation expectations aligned?", a: "Within band.", kind: "yesno" },
          { q: "Notice period / availability?", a: `${4 + (i % 8)} weeks`, kind: "text" },
          { q: "Core-skill depth", a: "", kind: "stars", stars: 4 + (i % 2) },
        ],
        outcome: "advance",
      };
      c.prequal = prequal;

      const interviews: InterviewRecord[] = [];
      const iw = (kind: InterviewRecord["kind"], daysAgo: number, outcome: InterviewRecord["outcome"], rating?: StarRating): InterviewRecord => ({
        id: genId("iv"),
        kind,
        scheduledFor: isoDaysBefore(daysAgo),
        interviewer: REFERRERS[(i + 1) % REFERRERS.length],
        outcome,
        starRating: rating,
        hmFeedback: outcome === "Completed" || outcome === "Advance" ? "Strong technical signal; good stakeholder posture." : undefined,
        hmFeedbackDueAt: outcome === "Scheduled" ? isoDaysBefore(-1) : null,
        notes: "",
        createdAt: isoDaysBefore(daysAgo + 1),
      });
      if (c.stage === "Booked") {
        interviews.push(iw("Intw1", -2, "Scheduled"));
      } else if (c.stage === "Interviewed") {
        interviews.push(iw("Intw1", 3, "Advance", c.starRating), iw("Intw2", -3, "Scheduled"));
      } else if (c.stage === "Offer" || c.stage === "Hired") {
        interviews.push(
          iw("Intw1", 12, "Advance", c.starRating),
          iw("Intw2", 8, "Advance", c.starRating),
          iw("Intw3", 4, "Completed", c.starRating),
        );
      }
      if (interviews.length) c.interviews = interviews;
    }
  });

  // Guarantee a compelling #Vivier for the demo: if too few dropped-out strong
  // profiles were pooled organically, take the highest-scored mid-funnel
  // candidates (never active winners) and mark them as Silver Medalists who chose
  // a competing offer — the ones that got away, kept warm for a future need.
  const RECONTACT_REASONS = [
    "Accepted a competing offer. Strong mutual fit, timing was off.",
    "Role filled by another candidate; excellent profile to re-engage.",
    "Paused their search; asked us to reconnect next quarter.",
  ];
  const medalists = candidates.filter((c) => c.silverMedalist);
  if (medalists.length < 4) {
    const eligible = candidates
      .filter((c) => !c.vivier && !["Hired", "Offer", "Booked", "Interviewed"].includes(c.stage))
      .sort((a, b) => b.matchScore - a.matchScore);
    for (let k = 0; medalists.length + k < 4 && k < eligible.length; k++) {
      const c = eligible[k];
      c.stage = "Rejected";
      c.vivier = true;
      c.silverMedalist = true;
      c.starRating = c.starRating === "TopGun" ? "TopGun" : "A"; // silver medalists are top talent
      c.rejectionReason = RECONTACT_REASONS[k % RECONTACT_REASONS.length];
      c.recontactAt = isoDaysBefore(8 + k * 6); // due now, staggered
    }
  }

  // Knight-M-checked job ads on every campaign (TAnIA Stage 0).
  campaigns.forEach((camp, ci) => {
    camp.jobAd = {
      content:
        `# ${camp.title}\n\n${camp.department} · ${camp.jobAnalysis.locationType} · ${camp.jobAnalysis.regions.join(", ")}\n\n` +
        `Mantu Group is hiring a ${camp.title.toLowerCase()} to join ${camp.hiringManager}'s team. ` +
        `You'll work on high-impact client problems with a senior, supportive consulting group.\n\n` +
        `**Must have:** ${camp.jobAnalysis.requiredSkills.slice(0, 4).join(", ")}.\n` +
        `**Nice to have:** ${camp.jobAnalysis.niceToHaveSkills.slice(0, 3).join(", ")}.`,
      screeningQuestions: screeningQuestionsFor(camp.jobAnalysis),
      knightM: {
        checked: true,
        passed: true,
        issues: [KNIGHT_M_NOTES[ci % KNIGHT_M_NOTES.length]],
        checkedAt: isoDaysBefore(17 - ci * 5),
      },
      status: camp.status === "Intake" ? "draft" : "published",
      updatedAt: isoDaysBefore(16 - ci * 5),
    };
  });

  // A handful of inbound chatbox applications awaiting handoff (TAnIA §5).
  return buildChatboxSubmissions(campaigns);
}

function buildChatboxSubmissions(campaigns: Campaign[]): ChatboxSubmission[] {
  const specs: Array<{
    path: "A" | "B";
    first: string;
    last: string;
    campaignIdx: number;
    inputs: Parameters<typeof computeChatboxScore>[0];
    location: string;
    skills: string[];
    daysAgo: number;
    status: ChatboxSubmission["status"];
  }> = [
    { path: "A", first: "Giulia", last: "Ferraro", campaignIdx: 0, inputs: { mobility: "Yes", needsVisa: false, keyExpStars: 5, toolStars: 5, projectYes: true, hasContactPref: true }, location: "Milan, IT", skills: ["Java", "Spring Boot", "Kafka"], daysAgo: 0, status: "new" },
    { path: "A", first: "Daniel", last: "Okonkwo", campaignIdx: 0, inputs: { mobility: "Relocation required", needsVisa: true, keyExpStars: 4, toolStars: 3, projectYes: true, hasContactPref: true, outsideRegion: true }, location: "Lagos, NG", skills: ["Java", "Microservices"], daysAgo: 0, status: "new" },
    { path: "A", first: "Marta", last: "Nowak", campaignIdx: 1, inputs: { mobility: "Yes", needsVisa: false, keyExpStars: 4, toolStars: 4, projectYes: true, hasContactPref: true }, location: "Kraków, PL", skills: ["React", "TypeScript", "Next.js"], daysAgo: 1, status: "reviewed" },
    { path: "B", first: "Hassan", last: "El-Amin", campaignIdx: 1, inputs: { mobility: "Depends on the opportunity" as never, keyExpStars: 3, toolStars: 3, hasContactPref: false }, location: "Remote / EU", skills: ["Frontend", "Design systems"], daysAgo: 1, status: "new" },
    { path: "A", first: "Chloé", last: "Dubois", campaignIdx: 2, inputs: { mobility: "Yes", needsVisa: false, keyExpStars: 5, toolStars: 4, projectYes: true, hasContactPref: true }, location: "Paris, FR", skills: ["Figma", "Design systems", "Prototyping"], daysAgo: 2, status: "new" },
    { path: "A", first: "Ben", last: "Carter", campaignIdx: 2, inputs: { mobility: "No", needsVisa: false, keyExpStars: 2, toolStars: 2, projectYes: false, hasContactPref: false, outsideRegion: true }, location: "Austin, US", skills: ["UI"], daysAgo: 3, status: "new" },
  ];

  return specs.map((s) => {
    const camp = campaigns[s.campaignIdx] ?? campaigns[0];
    const score = computeChatboxScore(s.inputs);
    const rating = deriveStarRating(score.total, DEFAULT_STAR_THRESHOLDS);
    const first = s.first;
    const last = s.last;
    return {
      id: genId("cbx"),
      path: s.path,
      campaignId: camp?.id ?? null,
      roleTitle: camp?.title ?? "Spontaneous application",
      firstName: first,
      lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
      phone: "+00 000 000 000",
      cvFileName: `${first}_${last}_CV.pdf`,
      detected: { location: s.location, skills: s.skills },
      answers: [
        { question: "Mobility compatible?", answer: String(s.inputs.mobility ?? "—"), kind: "mobility" },
        { question: "Visa sponsorship required?", answer: s.inputs.needsVisa ? "Yes" : "No", kind: "visa" },
        { question: "Key experience", answer: `${s.inputs.keyExpStars ?? 0}/5`, kind: "keyexp", stars: s.inputs.keyExpStars },
        { question: "Tool / expertise", answer: `${s.inputs.toolStars ?? 0}/5`, kind: "toolexp", stars: s.inputs.toolStars },
        { question: "Managed international stakeholders?", answer: s.inputs.projectYes ? "Yes" : "No", kind: "project" },
      ],
      score,
      starRating: rating,
      contactPref: s.inputs.hasContactPref ? { time: "Morning", day: "Tuesday" } : undefined,
      status: s.status,
      createdAt: isoHoursBefore(s.daysAgo * 24 + 3),
    };
  });
}

export function buildHistoricalDemoSeedState(): HermesState {
  const settings = defaultSettings();
  const now = Date.now();

  const campaigns: Campaign[] = [];
  const allCandidates: Candidate[] = [];
  const outreach: OutreachMessage[] = [];
  const replies: ClassifiedReply[] = [];
  const bookings: Booking[] = [];
  const reports: WeeklyReport[] = [];
  const activities: Activity[] = [];
  const seats = seedSeats();
  const suppression = seedSuppression();
  const interviewers = seedInterviewers();
  const ledger: OutreachLedgerEntry[] = [];

  let bookingCounter = 0;
  let ledgerSeatRR = 0;

  SPECS.forEach((spec, specIndex) => {
    const campaign: Campaign = {
      id: spec.id,
      title: spec.job.title,
      department: spec.job.department,
      urgency: spec.job.urgency,
      status: spec.status,
      hiringManager: spec.hiringManager,
      hiringManagerEmail: spec.hiringManagerEmail,
      createdAt: isoDaysBefore(18 - specIndex * 5),
      targetStartDate: new Date(SEED_NOW.getTime() + 40 * 86_400_000).toISOString(),
      jobAnalysis: spec.job,
      sourcingStrategy: buildSourcingStrategy(spec.job),
      scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
      metrics: {
        sourced: 0, contacted: 0, replied: 0, interested: 0, booked: 0, interviewed: 0,
        offer: 0, hired: 0, notInterested: 0, replyRate: 0, avgMatchScore: 0,
        timeToFirstInterviewHours: null, emailsSentToday: 0, linkedinSentToday: 0,
      },
      skillUpdates: [],
      activities: [],
    };

    // Source candidates deterministically (fixed id → stable rng).
    const platform = spec.job.department === "Design" ? "LinkedIn" : "GitHub";
    const { accepted } = sourceCandidates(campaign, platform, spec.count, allCandidates, specIndex + 1);
    // Sort by score desc, then apply the stage plan.
    accepted.sort((a, b) => b.matchScore - a.matchScore);

    const campaignActivities: Activity[] = [];
    campaignActivities.push(
      act("parse", "Job description parsed", `Parsed brief for ${campaign.title} from ${spec.hiringManager}.`, `${spec.job.requiredSkills.length} required skills extracted`, campaign.id, null, isoDaysBefore(18 - specIndex * 5)),
      act("campaign", "Campaign created", `Created campaign ${campaign.id}.`, "Sourcing strategy generated", campaign.id, { type: "campaign", id: campaign.id }, isoDaysBefore(18 - specIndex * 5)),
      act("sourcing", `Sourced ${accepted.length} candidates`, `Batch via ${platform}. Dedupe rules applied.`, `${accepted.length} accepted`, campaign.id, null, isoDaysBefore(16 - specIndex * 4)),
    );

    accepted.forEach((cand, i) => {
      const stage: Stage = spec.stagePlan[i] ?? "Sourced";
      cand.stage = stage;
      const rank = RANK[stage] ?? 0;

      // Outreach
      if (stage === "Sourced") {
        // Draft awaiting approval → populates the approval queue
        const gen = generateOutreach(cand, campaign, "Casual Professional", "Email", 1);
        const msg: OutreachMessage = {
          id: genId("msg"), candidateId: cand.id, campaignId: campaign.id, channel: "Email",
          subject: gen.subject, body: gen.body, tone: "Casual Professional",
          personalizationEvidence: gen.personalizationEvidence, status: "Needs Approval",
          sequenceStep: 1, scheduledFor: null, sentAt: null, approvedBy: null,
          dryRun: true, createdAt: isoHoursBefore(6 + i),
        };
        outreach.push(msg);
      } else {
        // Dry-run history — Approved without simulated send (aligns with stampSimulatedSend).
        const tone = i % 3 === 0 ? "Technical" : i % 3 === 1 ? "Executive" : "Casual Professional";
        const channel = i % 4 === 0 ? "LinkedIn" : "Email";
        const gen = generateOutreach(cand, campaign, tone, channel, 1);
        const approvedAt = isoDaysBefore(10 - specIndex * 2 - (i % 4));
        const msg: OutreachMessage = {
          id: genId("msg"), candidateId: cand.id, campaignId: campaign.id, channel,
          subject: gen.subject, body: gen.body, tone, personalizationEvidence: gen.personalizationEvidence,
          status: "Approved", sequenceStep: 1, scheduledFor: null, sentAt: null,
          approvedBy: settings.operatorName, dryRun: true, createdAt: isoDaysBefore(11 - specIndex * 2 - (i % 4)),
        };
        outreach.push(msg);
        cand.lastContactedAt = approvedAt;
        cand.outreachHistory.push({ messageId: msg.id, channel, subject: gen.subject, status: "Approved", at: approvedAt });
      }

      // Replies
      if (rank >= RANK.Replied) {
        const intent = replyIntentForStage(stage);
        const body = REPLY_BODIES[intent][i % REPLY_BODIES[intent].length];
        const receivedAt = isoDaysBefore(8 - specIndex * 2 - (i % 3));
        const channel = cand.outreachHistory[0]?.channel ?? "Email";
        // Leave a couple of hot replies unhandled to drive the SLA console.
        const isHot = intent === "INTERESTED" && stage === "Interested";
        const handled = !isHot;
        const reply: ClassifiedReply = {
          id: genId("rep"), candidateId: cand.id, campaignId: campaign.id, channel, body,
          intent, confidence: intent === "INTERESTED" ? 0.9 : intent === "QUALIFIED_INTEREST" ? 0.77 : intent === "NOT_INTERESTED" ? 0.9 : 0.6,
          reasoning: intent === "INTERESTED" ? "Clear positive intent." : intent === "QUALIFIED_INTEREST" ? "Positive with open questions." : "Explicit decline.",
          suggestedAction: intent === "INTERESTED" ? "Send booking link (15-min SLA)." : intent === "QUALIFIED_INTEREST" ? "Answer questions + append calendar link." : "Gracious close + suppression timer.",
          draftResponse: "",
          handled,
          slaDueAt: isHot ? new Date(now + (5 + (i % 3) * 3) * 60000).toISOString() : slaDueFor(intent, receivedAt, settings.slaMinutes),
          receivedAt,
        };
        replies.push(reply);
        cand.replyHistory.push({ id: reply.id, intent, confidence: reply.confidence, excerpt: body.slice(0, 90), at: receivedAt });
      }

      // Bookings
      if (rank >= RANK.Booked) {
        const interviewer = interviewers[bookingCounter++ % interviewers.length];
        const isPast = stage === "Interviewed";
        const start = new Date(now + (isPast ? -1 : 1 + (i % 3)) * 86_400_000 + 14 * 3_600_000);
        const booking = createBooking(cand, campaign, interviewer, start);
        // Demo seed has no live Graph seat — never stamp Confirmed without a meeting URL.
        booking.status = isPast ? "Completed" : "Proposed";
        bookings.push(booking);
        cand.booking = booking;
        campaignActivities.push(
          act(
            "booking",
            bookingInterviewTitle(booking, cand.name),
            `${interviewer.name} (${interviewer.role}). ${
              booking.teamsLink || booking.calLink
                ? "Teams/calendar link present."
                : "Local slot only — needs calendar / confirmLive for Teams."
            }`,
            booking.status,
            campaign.id,
            { type: "booking", id: booking.id },
            booking.createdAt,
          ),
        );
      }

      // Per-candidate activities for richer timeline (a subset)
      if (rank >= RANK.Contacted && i < 8) {
        campaignActivities.push(
          act("outreach", `Outreach scheduled: ${cand.name}`, `${cand.outreachHistory[0]?.channel ?? "Email"} drafted and approved.`, "Approved / Queued for send", campaign.id, { type: "candidate", id: cand.id }, cand.lastContactedAt ?? isoDaysBefore(9)),
        );
      }
      if (rank >= RANK.Replied && i < 8) {
        campaignActivities.push(
          act("reply", `Reply classified: ${cand.name}`, `Intent ${replyIntentForStage(stage)}.`, replyIntentForStage(stage), campaign.id, { type: "candidate", id: cand.id }, isoDaysBefore(7 - (i % 3))),
        );
      }

      allCandidates.push(cand);
    });

    // Compute metrics from final stages — do not fabricate daily send counters
    // (dry-run Approved history is not a real send).
    campaign.metrics = computeMetrics(accepted);
    campaign.metrics.emailsSentToday = 0;
    campaign.metrics.linkedinSentToday = 0;
    // Real elapsed time from campaign creation to the first scheduled interview
    // (never fabricated — shares firstInterviewElapsedHours with the live
    // computation in store.ts, see metrics.ts).
    campaign.metrics.timeToFirstInterviewHours = firstInterviewElapsedHours(
      bookings.filter((b) => b.campaignId === campaign.id),
      campaign.createdAt,
    );

    // Weekly report + skill updates
    const report = generateWeeklyReport(campaign, allCandidates, outreach);
    reports.push(report);
    campaign.skillUpdates = report.skillUpdates.map((s) => ({ ...s }));
    campaignActivities.push(
      act("learning", "Weekly report generated", `Funnel + performance summarised. ${report.skillUpdates.length} skill updates proposed.`, "Report ready", campaign.id, { type: "report", id: report.id }, isoHoursBefore(20 + specIndex * 2)),
    );

    campaign.activities = campaignActivities.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    activities.push(...campaignActivities);
    campaigns.push(campaign);
  });

  activities.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // Authoritative outreach ledger: already-contacted candidates. Dry-run
  // Approved-only rows use claimed (not sent) so fleet de-dupe does not look like delivery.
  for (const cand of allCandidates) {
    if (!cand.lastContactedAt) continue;
    const seat = seats[ledgerSeatRR % seats.length];
    ledgerSeatRR += 1;
    const lastOutreach = outreach.find((m) => m.candidateId === cand.id && m.approvedBy);
    const ledgerStatus =
      lastOutreach && lastOutreach.dryRun === true && !lastOutreach.sentAt
        ? ("claimed" as const)
        : ("sent" as const);
    ledger.push({
      id: genId("led"),
      candidateId: cand.id,
      candidateEmail: cand.email,
      seatId: seat.id,
      campaignId: cand.campaignId,
      channel: cand.outreachHistory[0]?.channel ?? "Email",
      status: ledgerStatus,
      reason: ledgerStatus === "claimed" ? "Dry-run approval — nothing sent." : null,
      at: cand.lastContactedAt,
    });
  }

  // Layer the TAnIA concepts (source, star rating, #Vivier, prequal, interviews,
  // Knight M job ads) onto the pool and produce the inbound chatbox queue.
  const chatboxSubmissions = seedTania(allCandidates, campaigns);

  return {
    version: STATE_VERSION,
    campaigns,
    candidates: allCandidates,
    outreach,
    replies,
    bookings,
    wins: [],
    interviewers,
    reports,
    integrations: defaultIntegrations(),
    activities,
    settings,
    seats,
    suppression,
    ledger,
    chatboxSubmissions,
    skills: defaultSkills(),
    apiKeys: [
      {
        id: genId("key"),
        name: "Anthropic (primary)",
        provider: "Anthropic",
        last4: "a1b2",
        status: "valid",
        lastTestedAt: isoHoursBefore(5),
        createdBy: "Jordan Bryce",
        createdAt: isoDaysBefore(12),
      },
    ],
    currentRole: "admin",
    chats: [],
    memory: [],
    schedules: [],
    activeCampaignId: campaigns[0]?.id ?? null,
    ingestedMessageIds: [],
  };
}

function computeMetrics(cands: Candidate[]): CampaignMetrics {
  const rank = (s: string) => RANK[s] ?? 0;
  const sourced = cands.length;
  const contacted = cands.filter((c) => rank(c.stage) >= RANK.Contacted || c.stage === "Not Interested").length;
  const replied = cands.filter((c) => rank(c.stage) >= RANK.Replied || c.stage === "Not Interested").length;
  const interested = cands.filter((c) => rank(c.stage) >= RANK.Interested && c.stage !== "Not Interested").length;
  const booked = cands.filter((c) => rank(c.stage) >= RANK.Booked).length;
  const interviewed = cands.filter((c) => c.stage === "Interviewed" || c.stage === "Offer" || c.stage === "Hired").length;
  const notInterested = cands.filter((c) => c.stage === "Not Interested").length;
  const scores = cands.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return {
    sourced, contacted, replied, interested, booked, interviewed,
    offer: 0, hired: 0, notInterested,
    replyRate: contacted ? replied / contacted : 0,
    avgMatchScore: avg,
    timeToFirstInterviewHours: null,
    emailsSentToday: 0, linkedinSentToday: 0,
  };
}

/* Re-export for any consumer that wants to regenerate emails on demand. */
export { interviewerPrepEmail, candidateConfirmationEmail };

function emptyMetrics(): CampaignMetrics {
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

/** E2E-ready job analysis (matches e2e-workflow-test.sh intake). */
export function e2eReadyJob(): JobAnalysis {
  return {
    title: "Senior TypeScript Engineer",
    department: "Engineering",
    seniority: "Senior",
    employmentType: "Full-time",
    locationType: "Hybrid",
    regions: ["London", "UK"],
    timezone: "Europe/London",
    salaryMin: 90000,
    salaryMax: 120000,
    currency: "GBP",
    equity: false,
    requiredSkills: ["TypeScript", "React", "Node.js", "GraphQL", "PostgreSQL"],
    niceToHaveSkills: ["Next.js", "AWS"],
    minYearsExperience: 5,
    maxYearsExperience: 12,
    education: "No formal requirement",
    industryExperience: ["SaaS", "Consulting"],
    companyStageTarget: ["Series B"],
    teamSize: "Platform team of 10",
    reportingTo: "Engineering Manager",
    urgency: "Urgent",
    validationWarnings: [],
    language: "en",
  };
}

function buildReadyCampaign(
  id: string,
  job: JobAnalysis,
  hiringManager: string,
  hiringManagerEmail: string,
): Campaign {
  return {
    id,
    title: job.title,
    department: job.department,
    urgency: job.urgency,
    status: "Sourcing",
    hiringManager,
    hiringManagerEmail,
    createdAt: isoDaysBefore(1),
    targetStartDate: new Date(SEED_NOW.getTime() + 40 * 86_400_000).toISOString(),
    jobAnalysis: job,
    sourcingStrategy: buildSourcingStrategy(job),
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    metrics: emptyMetrics(),
    skillUpdates: [],
    activities: [
      act(
        "campaign",
        "Campaign ready for sourcing",
        `${job.title} — brief reviewed, awaiting first batch.`,
        "Ready",
        id,
        { type: "campaign", id },
        isoHoursBefore(2),
      ),
    ],
  };
}

/**
 * Default seed — clean slate with zero historical candidates.
 * Campaigns are in Sourcing (brief reviewed); webhook + agent fill the pipeline.
 */
export function buildSeedState(): HermesState {
  const settings = defaultSettings();
  const campaigns = [
    buildReadyCampaign(
      "camp-e2e",
      e2eReadyJob(),
      "Priya Nair",
      "priya.nair@acme.io",
    ),
    buildReadyCampaign(
      "camp_seed_backend",
      backendJob(),
      "Daniela Brandt",
      "daniela.brandt@northwind.example",
    ),
    buildReadyCampaign(
      "camp_seed_frontend",
      frontendJob(),
      "Marcus Lindqvist",
      "marcus.lindqvist@brightloop.example",
    ),
  ];

  return {
    version: STATE_VERSION,
    campaigns,
    candidates: [],
    outreach: [],
    replies: [],
    bookings: [],
    wins: [],
    interviewers: seedInterviewers(),
    reports: [],
    integrations: defaultIntegrations(),
    activities: campaigns.flatMap((c) => c.activities),
    settings,
    seats: seedSeats(),
    suppression: seedSuppression(),
    ledger: [],
    chatboxSubmissions: [],
    skills: defaultSkills(),
    apiKeys: [
      {
        id: genId("key"),
        name: "Anthropic (primary)",
        provider: "Anthropic",
        last4: "a1b2",
        status: "valid",
        lastTestedAt: isoHoursBefore(5),
        createdBy: "Jordan Bryce",
        createdAt: isoDaysBefore(12),
      },
    ],
    currentRole: "admin",
    chats: [],
    memory: [],
    schedules: [],
    activeCampaignId: campaigns[0]?.id ?? null,
    ingestedMessageIds: [],
  };
}
