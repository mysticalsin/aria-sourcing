import { defaultIntegrations } from "../integrations";
import { buildSourcingStrategy, emptyMetrics } from "../mock-ai";
import { DEFAULT_SCORING_WEIGHTS } from "../scoring";
import { buildSeedState, defaultSettings, seedInterviewers, STATE_VERSION } from "../seed";
import { DEFAULT_STAR_THRESHOLDS, deriveLeadSource, deriveStarRating } from "../tania";
import type {
  Campaign,
  CampaignMetrics,
  CampaignStatus,
  Candidate,
  ComplianceFlags,
  HermesState,
  JobAnalysis,
  OutreachMessage,
  Urgency,
} from "../types";
import { demoStateAllowsCandidatePersistence } from "./demo-persistence";

const STORAGE_KEY = "hermes-sourcing:v1";

function withoutLegacyIntegrationAuthority(settings: HermesState["settings"]): HermesState["settings"] {
  const cleaned = { ...settings } as HermesState["settings"] & { databricks?: unknown; dust?: unknown };
  delete cleaned.databricks;
  delete cleaned.dust;
  return cleaned;
}

/**
 * Shell chrome (⌘K + Aria Command) maps every campaign on mount. Sparse holes
 * or proof campaigns missing `jobAnalysis`/`title` previously threw into
 * global-error and took the whole app down. Repair in place; drop garbage.
 */
function placeholderJobAnalysis(title: string, department: string): JobAnalysis {
  return {
    title,
    department,
    seniority: "Unspecified",
    employmentType: "Full-time",
    locationType: "Unspecified",
    regions: [],
    timezone: "",
    salaryMin: null,
    salaryMax: null,
    currency: "USD",
    equity: false,
    requiredSkills: [],
    niceToHaveSkills: [],
    minYearsExperience: null,
    maxYearsExperience: null,
    education: "",
    industryExperience: [],
    companyStageTarget: [],
    teamSize: "",
    reportingTo: "",
    urgency: "Standard",
    validationWarnings: [
      {
        field: "jobAnalysis",
        severity: "warning",
        message: "Campaign arrived without a complete job analysis; filled safe defaults.",
      },
    ],
  };
}

function repairMetrics(raw: unknown): CampaignMetrics {
  const base = emptyMetrics();
  if (!raw || typeof raw !== "object") return base;
  const m = raw as Partial<CampaignMetrics>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    sourced: num(m.sourced, base.sourced),
    contacted: num(m.contacted, base.contacted),
    replied: num(m.replied, base.replied),
    interested: num(m.interested, base.interested),
    booked: num(m.booked, base.booked),
    interviewed: num(m.interviewed, base.interviewed),
    offer: num(m.offer, base.offer),
    hired: num(m.hired, base.hired),
    notInterested: num(m.notInterested, base.notInterested),
    replyRate: num(m.replyRate, base.replyRate),
    avgMatchScore: num(m.avgMatchScore, base.avgMatchScore),
    timeToFirstInterviewHours:
      typeof m.timeToFirstInterviewHours === "number" && Number.isFinite(m.timeToFirstInterviewHours)
        ? m.timeToFirstInterviewHours
        : m.timeToFirstInterviewHours === null
          ? null
          : base.timeToFirstInterviewHours,
    emailsSentToday: num(m.emailsSentToday, base.emailsSentToday),
    linkedinSentToday: num(m.linkedinSentToday, base.linkedinSentToday),
  };
}

const VALID_STATUS = new Set<CampaignStatus>([
  "Intake",
  "Sourcing",
  "Outreach",
  "Interviewing",
  "Closing",
  "Filled",
  "Paused",
]);

const VALID_URGENCY = new Set<Urgency>(["Standard", "Urgent", "Critical"]);

function repairCampaigns(raw: unknown): Campaign[] {
  if (!Array.isArray(raw)) return [];
  const out: Campaign[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Campaign;
    if (typeof c.id !== "string" || !c.id.trim()) continue;
    const title =
      typeof c.title === "string" && c.title.trim() ? c.title.trim() : c.id;
    const department = typeof c.department === "string" ? c.department : "";
    const jd = c.jobAnalysis && typeof c.jobAnalysis === "object" ? c.jobAnalysis : null;
    const jobAnalysis: JobAnalysis = jd
      ? {
          ...placeholderJobAnalysis(title, department),
          ...jd,
          title:
            typeof jd.title === "string" && jd.title.trim() ? jd.title.trim() : title,
          department:
            typeof jd.department === "string" ? jd.department : department,
          regions: Array.isArray(jd.regions) ? jd.regions : [],
          industryExperience: Array.isArray(jd.industryExperience)
            ? jd.industryExperience
            : [],
          requiredSkills: Array.isArray(jd.requiredSkills) ? jd.requiredSkills : [],
          niceToHaveSkills: Array.isArray(jd.niceToHaveSkills) ? jd.niceToHaveSkills : [],
          companyStageTarget: Array.isArray(jd.companyStageTarget)
            ? jd.companyStageTarget
            : [],
          validationWarnings: Array.isArray(jd.validationWarnings)
            ? jd.validationWarnings
            : [],
        }
      : placeholderJobAnalysis(title, department);
    // Sparse remote/proof campaigns often omit metrics — CampaignCard + rules
    // read m.sourced etc. and previously threw into error.tsx ("Something broke").
    const metrics = repairMetrics(c.metrics);
    const status = VALID_STATUS.has(c.status) ? c.status : "Sourcing";
    const urgency = VALID_URGENCY.has(c.urgency) ? c.urgency : jobAnalysis.urgency;
    const scoringWeights =
      c.scoringWeights && typeof c.scoringWeights === "object"
        ? { ...DEFAULT_SCORING_WEIGHTS, ...c.scoringWeights }
        : { ...DEFAULT_SCORING_WEIGHTS };
    const sourcingStrategy =
      c.sourcingStrategy && typeof c.sourcingStrategy === "object"
        ? c.sourcingStrategy
        : buildSourcingStrategy(jobAnalysis);
    out.push({
      ...c,
      title,
      department,
      jobAnalysis,
      metrics,
      status,
      urgency,
      scoringWeights,
      sourcingStrategy,
      hiringManager: typeof c.hiringManager === "string" ? c.hiringManager : "",
      hiringManagerEmail: typeof c.hiringManagerEmail === "string" ? c.hiringManagerEmail : "",
      createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(0).toISOString(),
      targetStartDate: typeof c.targetStartDate === "string" ? c.targetStartDate : "",
      skillUpdates: Array.isArray(c.skillUpdates) ? c.skillUpdates : [],
      activities: Array.isArray(c.activities) ? c.activities : [],
    });
  }
  return out;
}

function emptyComplianceFlags(): ComplianceFlags {
  return {
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  };
}

/**
 * Sparse remote/proof candidates often omit `complianceFlags`. CandidateTable,
 * CandidateDrawer, and rules read `.doNotContact` and previously threw into
 * error.tsx ("Something broke") on /candidates.
 */
function repairComplianceFlags(raw: unknown): ComplianceFlags {
  const base = emptyComplianceFlags();
  if (!raw || typeof raw !== "object") return base;
  const f = raw as Partial<ComplianceFlags>;
  return {
    doNotContact: f.doNotContact === true,
    suppressed: f.suppressed === true,
    unsubscribed: f.unsubscribed === true,
    gdprExportRequested: f.gdprExportRequested === true,
    anonymized: f.anonymized === true,
    suppressedUntil:
      typeof f.suppressedUntil === "string"
        ? f.suppressedUntil
        : f.suppressedUntil === null
          ? null
          : base.suppressedUntil,
    ...(f.preSuppressionStage !== undefined
      ? { preSuppressionStage: f.preSuppressionStage ?? null }
      : {}),
  };
}

function repairCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Candidate;
    if (typeof c.id !== "string" || !c.id.trim()) continue;
    if (typeof c.campaignId !== "string" || !c.campaignId.trim()) continue;
    out.push({
      ...c,
      name: typeof c.name === "string" && c.name.trim() ? c.name : c.id,
      email: typeof c.email === "string" ? c.email : "",
      avatarInitials: typeof c.avatarInitials === "string" ? c.avatarInitials : "",
      currentTitle: typeof c.currentTitle === "string" ? c.currentTitle : "",
      currentCompany: typeof c.currentCompany === "string" ? c.currentCompany : "",
      location: typeof c.location === "string" ? c.location : "",
      timezone: typeof c.timezone === "string" ? c.timezone : "",
      linkedinUrl: typeof c.linkedinUrl === "string" ? c.linkedinUrl : "",
      githubUrl: typeof c.githubUrl === "string" ? c.githubUrl : "",
      sourcePlatform: c.sourcePlatform ?? "Manual",
      sourceQuery: typeof c.sourceQuery === "string" ? c.sourceQuery : "",
      matchScore: typeof c.matchScore === "number" && Number.isFinite(c.matchScore) ? c.matchScore : 0,
      matchBreakdown: Array.isArray(c.matchBreakdown) ? c.matchBreakdown : [],
      techStack: Array.isArray(c.techStack) ? c.techStack : [],
      yearsExperience:
        typeof c.yearsExperience === "number" && Number.isFinite(c.yearsExperience)
          ? c.yearsExperience
          : c.yearsExperience === null
            ? null
            : null,
      companyStageExperience: Array.isArray(c.companyStageExperience) ? c.companyStageExperience : [],
      industryExperience: Array.isArray(c.industryExperience) ? c.industryExperience : [],
      recentActivity: typeof c.recentActivity === "string" ? c.recentActivity : "",
      stage: c.stage ?? "Sourced",
      lastContactedAt: c.lastContactedAt ?? null,
      lastRepliedAt: c.lastRepliedAt ?? null,
      outreachHistory: Array.isArray(c.outreachHistory) ? c.outreachHistory : [],
      replyHistory: Array.isArray(c.replyHistory) ? c.replyHistory : [],
      booking: c.booking && typeof c.booking === "object" ? c.booking : null,
      notes: Array.isArray(c.notes) ? c.notes : [],
      complianceFlags: repairComplianceFlags(c.complianceFlags),
      createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Sparse remote outreach drafts often omit `personalizationEvidence`.
 * /outreach WhyThisPersonChip and OutreachMessageCard call `.find`/`.length`
 * and previously threw into error.tsx ("Something broke").
 */
function repairOutreach(raw: unknown): OutreachMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: OutreachMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as OutreachMessage;
    if (typeof m.id !== "string" || !m.id.trim()) continue;
    if (typeof m.candidateId !== "string" || !m.candidateId.trim()) continue;
    if (typeof m.campaignId !== "string" || !m.campaignId.trim()) continue;
    out.push({
      ...m,
      channel: m.channel ?? "Email",
      subject: typeof m.subject === "string" ? m.subject : "",
      body: typeof m.body === "string" ? m.body : "",
      tone: m.tone ?? "Casual Professional",
      personalizationEvidence: Array.isArray(m.personalizationEvidence)
        ? m.personalizationEvidence.filter((e): e is string => typeof e === "string")
        : [],
      status: m.status ?? "Draft",
      sequenceStep:
        typeof m.sequenceStep === "number" && Number.isFinite(m.sequenceStep) ? m.sequenceStep : 1,
      scheduledFor: m.scheduledFor ?? null,
      sentAt: m.sentAt ?? null,
      approvedBy: m.approvedBy ?? null,
      dryRun: m.dryRun === true,
      createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/** Fill in any fields added in recent STATE_VERSIONs without wiping existing data. */
export function migrateToCurrentVersion(parsed: HermesState): HermesState {
  const defs = defaultSettings();
  // STATE_VERSION 12 — the demo moved to Kimi (Kimi Code) via the server env key.
  // Blobs older than 12 have their model layer reset below so returning visitors
  // leave the previous Anthropic default (which would fall back to the mock).
  const preKimi = (parsed.version ?? 0) < 12;
  // STATE_VERSION 18 — wipe fake "connected" seeds on real cards (GitHub/Apify/Graph/SendGrid)
  // that never had a real credential attached.
  const preHonestIntegrations = (parsed.version ?? 0) < 18;
  const preCleanSlate = (parsed.version ?? 0) < 19;
  const starT = parsed.settings?.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  const FAKE_CONNECTED_IDS = new Set(["int_github", "int_apify", "int_graph_teams", "int_sendgrid"]);
  const clean = preCleanSlate ? buildSeedState() : null;
  return {
    ...(clean ?? parsed),
    version: STATE_VERSION,
    campaigns: preCleanSlate
      ? clean!.campaigns
      : repairCampaigns(parsed.campaigns),
    candidates: preCleanSlate
      ? []
      : repairCandidates(parsed.candidates).map((c) => ({
          ...c,
          leadSource: c.leadSource ?? deriveLeadSource(c),
          starRating: c.starRating ?? deriveStarRating(c.matchScore, starT),
        })),
    chatboxSubmissions: preCleanSlate ? [] : (parsed.chatboxSubmissions ?? []),
    outreach: preCleanSlate ? [] : repairOutreach(parsed.outreach),
    replies: preCleanSlate ? [] : (parsed.replies ?? []),
    bookings: preCleanSlate ? [] : (parsed.bookings ?? []),
    wins: preCleanSlate ? [] : (parsed.wins ?? []),
    reports: preCleanSlate ? [] : (parsed.reports ?? []),
    activities: preCleanSlate ? clean!.activities : (parsed.activities ?? []),
    ledger: preCleanSlate ? [] : (parsed.ledger ?? []),
    ingestedMessageIds: preCleanSlate ? [] : (parsed.ingestedMessageIds ?? []),
    activeCampaignId: preCleanSlate ? clean!.activeCampaignId : (parsed.activeCampaignId ?? null),
    // STATE_VERSION 16 — re-sync each stored integration's `real` flag against
    // the current seed. Roadmap placeholders (`real: false`) also lose any older
    // fabricated connected/lastSync state; real cards keep their usage history.
    // STATE_VERSION 18 — also reset known fake-connected real cards.
    integrations:
      parsed.integrations && parsed.integrations.length > 0
        ? parsed.integrations.map((i) => {
            const seed = defaultIntegrations().find((d) => d.id === i.id);
            if (!seed) return i;
            if (!seed.real) {
              return { ...i, real: false, status: "not_configured" as const, lastSync: null };
            }
            if (preHonestIntegrations && FAKE_CONNECTED_IDS.has(i.id) && i.mode === "mock") {
              return {
                ...i,
                real: true,
                status: seed.status,
                mode: seed.mode,
                lastSync: seed.lastSync,
                errors: seed.errors,
              };
            }
            return { ...i, real: true };
          })
        : defaultIntegrations(),
    apiKeys: parsed.apiKeys ?? [],
    currentRole: parsed.currentRole ?? "admin",
    skills: parsed.skills ?? [],
    suppression: parsed.suppression ?? [],
    // Inbound-email dedup ledger — initialise on upgrade so re-sync after an
    // upgrade can't double-create replies for already-ingested messages.
    // STATE_VERSION 9 — per-agent chat threads.
    chats: parsed.chats ?? [],
    // STATE_VERSION 10 — per-agent memory.
    memory: parsed.memory ?? [],
    // STATE_VERSION 11 — schedules.
    schedules: parsed.schedules ?? [],
    // STATE_VERSION 14 — registered interviewer roster, replacing the hardcoded
    // mock-ai INTERVIEWERS list. Falls back to that same seed roster (not an
    // empty array) so a returning visitor's existing bookings keep matching a
    // real name in the round-robin instead of silently losing their interviewers.
    interviewers: parsed.interviewers ?? seedInterviewers(),
    settings: {
      ...withoutLegacyIntegrationAuthority(parsed.settings),
      llmProviders: preKimi ? defs.llmProviders : (parsed.settings.llmProviders ?? defs.llmProviders),
      savedModels: preKimi ? defs.savedModels : (parsed.settings.savedModels ?? defs.savedModels),
      tools: parsed.settings.tools ?? defs.tools,
      mcpServers: parsed.settings.mcpServers ?? defs.mcpServers,
      webResearch: parsed.settings.webResearch ?? defs.webResearch,
      defaultModels: preKimi ? defs.defaultModels : (parsed.settings.defaultModels ?? defs.defaultModels),
      // STATE_VERSION 8 — live Aria runtime config.
      hermesLiveMode: parsed.settings.hermesLiveMode ?? defs.hermesLiveMode,
      hermesApiUrl: parsed.settings.hermesApiUrl ?? defs.hermesApiUrl,
      hermesApiKeyId: parsed.settings.hermesApiKeyId ?? defs.hermesApiKeyId,
      // D-2: guardrails and notifications fills.
      guardrails: parsed.settings.guardrails ?? defs.guardrails,
      notifications: parsed.settings.notifications ?? defs.notifications,
      // STATE_VERSION 13 — Mantu Star Rating thresholds.
      starRatingThresholds: parsed.settings.starRatingThresholds ?? defs.starRatingThresholds,
      // STATE_VERSION 11 — Aria management API URL.
      hermesWebUrl: parsed.settings.hermesWebUrl ?? defs.hermesWebUrl ?? "",
      heyreach: parsed.settings.heyreach ?? defs.heyreach,
    },
    seats: (parsed.seats ?? []).map((seat) => ({
      ...seat,
      providerId: seat.providerId,
      modelId: seat.modelId,
      toolIds: seat.toolIds,
    })),
  };
}

export function normalizeHermesState(parsed: HermesState): HermesState {
  if (parsed.version !== STATE_VERSION) return migrateToCurrentVersion(parsed);
  const settings = withoutLegacyIntegrationAuthority(parsed.settings);
  const starT = settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  return {
    ...parsed,
    wins: parsed.wins ?? [],
    campaigns: repairCampaigns(parsed.campaigns),
    candidates: repairCandidates(parsed.candidates).map((c) => ({
      ...c,
      leadSource: c.leadSource ?? deriveLeadSource(c),
      starRating: c.starRating ?? deriveStarRating(c.matchScore, starT),
    })),
    outreach: repairOutreach(parsed.outreach),
    settings: {
      ...settings,
      // Quality bar: never contact / accept below 80% unless operator raises further.
      minScoreToContact: Math.max(80, Number(settings.minScoreToContact) || 80),
    },
  };
}

export function loadState(): HermesState {
  if (typeof window === "undefined") return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HermesState;
      if (parsed && parsed.version === STATE_VERSION) {
        const normalized = normalizeHermesState(parsed);
        if (demoStateAllowsCandidatePersistence(normalized)) return normalized;
        window.localStorage.removeItem(STORAGE_KEY);
        return buildSeedState();
      }
      // Migrate ANY prior version rather than wiping all data — migrateToCurrentVersion
      // defensively defaults every field, so it can handle arbitrarily old blobs. Only
      // missing/corrupt/unparseable JSON or a non-numeric version falls through to reseed.
      if (parsed && typeof parsed.version === "number") {
        const normalized = normalizeHermesState(parsed);
        if (demoStateAllowsCandidatePersistence(normalized)) return normalized;
        window.localStorage.removeItem(STORAGE_KEY);
        return buildSeedState();
      }
    }
  } catch {
    /* corrupt → reseed */
  }
  return buildSeedState();
}
