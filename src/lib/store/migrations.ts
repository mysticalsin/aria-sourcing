import { defaultIntegrations } from "../integrations";
import { buildSourcingStrategy, emptyMetrics } from "../mock-ai";
import { DEFAULT_SCORING_WEIGHTS } from "../scoring";
import { buildSeedState, defaultSettings, seedInterviewers, STATE_VERSION } from "../seed";
import { DEFAULT_STAR_THRESHOLDS, deriveLeadSource, deriveStarRating } from "../tania";
import type {
  Booking,
  BookingStatus,
  Campaign,
  CampaignMetrics,
  CampaignStatus,
  Candidate,
  ClassifiedReply,
  ComplianceFlags,
  HermesState,
  JobAnalysis,
  OutreachChannel,
  OutreachMessage,
  ReplyIntent,
  SystemSettings,
  Urgency,
} from "../types";
import {
  BOOKING_STATUSES,
  OUTREACH_CHANNELS,
  REPLY_INTENTS,
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

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is string => typeof e === "string");
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
      experience: stringArray(c.experience),
      education: stringArray(c.education),
      languages: stringArray(c.languages),
      interviews: Array.isArray(c.interviews) ? c.interviews : [],
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
      personalizationEvidence: stringArray(m.personalizationEvidence),
      qualityReasons: Array.isArray(m.qualityReasons)
        ? stringArray(m.qualityReasons)
        : m.qualityReasons === undefined
          ? undefined
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

const VALID_REPLY_INTENT = new Set<string>(REPLY_INTENTS);
const VALID_OUTREACH_CHANNEL = new Set<string>(OUTREACH_CHANNELS);
const VALID_BOOKING_STATUS = new Set<string>(BOOKING_STATUSES);

/**
 * Sparse remote replies can omit string fields or land as holes in the array.
 * /replies maps over the list and reads `.intent` / `.body` — fill safe defaults.
 */
function repairReplies(raw: unknown): ClassifiedReply[] {
  if (!Array.isArray(raw)) return [];
  const out: ClassifiedReply[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as ClassifiedReply;
    if (typeof r.id !== "string" || !r.id.trim()) continue;
    if (typeof r.candidateId !== "string" || !r.candidateId.trim()) continue;
    if (typeof r.campaignId !== "string" || !r.campaignId.trim()) continue;
    const intent = VALID_REPLY_INTENT.has(r.intent) ? r.intent : ("UNCLEAR" as ReplyIntent);
    const channel = VALID_OUTREACH_CHANNEL.has(r.channel)
      ? r.channel
      : ("Email" as OutreachChannel);
    out.push({
      ...r,
      channel,
      body: typeof r.body === "string" ? r.body : "",
      intent,
      confidence:
        typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : 0,
      reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
      suggestedAction: typeof r.suggestedAction === "string" ? r.suggestedAction : "",
      draftResponse: typeof r.draftResponse === "string" ? r.draftResponse : "",
      handled: r.handled === true,
      slaDueAt: typeof r.slaDueAt === "string" ? r.slaDueAt : null,
      receivedAt: typeof r.receivedAt === "string" ? r.receivedAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Sparse bookings often omit `agenda` (string[]). BookingCalendar and prep
 * emails call `.slice`/`.map` and previously threw into error.tsx.
 */
function repairBookings(raw: unknown): Booking[] {
  if (!Array.isArray(raw)) return [];
  const out: Booking[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Booking;
    if (typeof b.id !== "string" || !b.id.trim()) continue;
    if (typeof b.candidateId !== "string" || !b.candidateId.trim()) continue;
    if (typeof b.campaignId !== "string" || !b.campaignId.trim()) continue;
    const status = VALID_BOOKING_STATUS.has(b.status)
      ? b.status
      : ("Proposed" as BookingStatus);
    out.push({
      ...b,
      candidateName: typeof b.candidateName === "string" ? b.candidateName : "",
      role: typeof b.role === "string" ? b.role : "",
      startTime: typeof b.startTime === "string" ? b.startTime : new Date(0).toISOString(),
      endTime: typeof b.endTime === "string" ? b.endTime : new Date(0).toISOString(),
      timezone: typeof b.timezone === "string" ? b.timezone : "UTC",
      interviewer: typeof b.interviewer === "string" ? b.interviewer : "",
      interviewerEmail: typeof b.interviewerEmail === "string" ? b.interviewerEmail : "",
      teamsLink: typeof b.teamsLink === "string" ? b.teamsLink : "",
      calLink: typeof b.calLink === "string" ? b.calLink : "",
      status,
      agenda: stringArray(b.agenda),
      createdAt: typeof b.createdAt === "string" ? b.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

function asObjectArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

/**
 * Settings toggles and arrays are read unbound on /settings (notifications.*,
 * tools.map, mcpServers.map, llmProviders). Sparse remote settings must never
 * throw — merge onto defaults.
 */
function repairSettings(raw: unknown): SystemSettings {
  const defs = defaultSettings();
  if (!raw || typeof raw !== "object") return defs;
  const s = raw as Partial<SystemSettings> & Record<string, unknown>;
  const notificationsRaw =
    s.notifications && typeof s.notifications === "object"
      ? (s.notifications as Partial<SystemSettings["notifications"]>)
      : null;
  const guardrailsRaw =
    s.guardrails && typeof s.guardrails === "object"
      ? (s.guardrails as Partial<SystemSettings["guardrails"]>)
      : null;
  const base = withoutLegacyIntegrationAuthority({
    ...defs,
    ...(s as SystemSettings),
  });
  return {
    ...base,
    humanApprovalGate: s.humanApprovalGate !== false,
    dryRunMode: s.dryRunMode !== false,
    minScoreToContact: Math.max(
      80,
      typeof s.minScoreToContact === "number" && Number.isFinite(s.minScoreToContact)
        ? s.minScoreToContact
        : defs.minScoreToContact,
    ),
    slaMinutes:
      typeof s.slaMinutes === "number" && Number.isFinite(s.slaMinutes)
        ? s.slaMinutes
        : defs.slaMinutes,
    operatorName: typeof s.operatorName === "string" ? s.operatorName : defs.operatorName,
    systemIdentity:
      typeof s.systemIdentity === "string" ? s.systemIdentity : defs.systemIdentity,
    rateLimits:
      s.rateLimits && typeof s.rateLimits === "object"
        ? { ...defs.rateLimits, ...s.rateLimits }
        : defs.rateLimits,
    compliance:
      s.compliance && typeof s.compliance === "object"
        ? { ...defs.compliance, ...s.compliance }
        : defs.compliance,
    fleet: s.fleet && typeof s.fleet === "object" ? { ...defs.fleet, ...s.fleet } : defs.fleet,
    confidentialityMode: s.confidentialityMode === true,
    defaultLanguage:
      typeof s.defaultLanguage === "string" ? s.defaultLanguage : defs.defaultLanguage,
    soundEnabled: s.soundEnabled === true,
    guardrails: {
      ...defs.guardrails,
      ...(guardrailsRaw ?? {}),
      ariaPrompt:
        typeof guardrailsRaw?.ariaPrompt === "string"
          ? guardrailsRaw.ariaPrompt
          : defs.guardrails.ariaPrompt,
      rules: Array.isArray(guardrailsRaw?.rules) ? guardrailsRaw!.rules : defs.guardrails.rules,
    },
    notifications: {
      slack: notificationsRaw?.slack === true,
      telegram: notificationsRaw?.telegram === true,
      email: notificationsRaw?.email !== false,
    },
    llmProviders: Array.isArray(s.llmProviders) ? s.llmProviders : defs.llmProviders,
    savedModels: Array.isArray(s.savedModels) ? s.savedModels : defs.savedModels,
    tools: Array.isArray(s.tools) ? s.tools : defs.tools,
    mcpServers: Array.isArray(s.mcpServers) ? s.mcpServers : defs.mcpServers,
    webResearch: s.webResearch ?? defs.webResearch,
    defaultModels: s.defaultModels ?? defs.defaultModels,
    hermesLiveMode: s.hermesLiveMode === true,
    hermesApiUrl: typeof s.hermesApiUrl === "string" ? s.hermesApiUrl : defs.hermesApiUrl,
    hermesApiKeyId:
      typeof s.hermesApiKeyId === "string" ? s.hermesApiKeyId : defs.hermesApiKeyId,
    hermesWebUrl: typeof s.hermesWebUrl === "string" ? s.hermesWebUrl : defs.hermesWebUrl ?? "",
    heyreach: s.heyreach ?? defs.heyreach,
    starRatingThresholds: s.starRatingThresholds ?? defs.starRatingThresholds,
  };
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
  const settingsSource = parsed.settings ?? defs;
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
    chatboxSubmissions: preCleanSlate
      ? []
      : (asObjectArray(parsed.chatboxSubmissions) as unknown as HermesState["chatboxSubmissions"]),
    outreach: preCleanSlate ? [] : repairOutreach(parsed.outreach),
    replies: preCleanSlate ? [] : repairReplies(parsed.replies),
    bookings: preCleanSlate ? [] : repairBookings(parsed.bookings),
    wins: preCleanSlate ? [] : (asObjectArray(parsed.wins) as unknown as HermesState["wins"]),
    reports: preCleanSlate ? [] : (asObjectArray(parsed.reports) as unknown as HermesState["reports"]),
    activities: preCleanSlate
      ? clean!.activities
      : (asObjectArray(parsed.activities) as unknown as HermesState["activities"]),
    ledger: preCleanSlate ? [] : (asObjectArray(parsed.ledger) as unknown as HermesState["ledger"]),
    ingestedMessageIds: preCleanSlate
      ? []
      : Array.isArray(parsed.ingestedMessageIds)
        ? parsed.ingestedMessageIds.filter((id): id is string => typeof id === "string")
        : [],
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
    apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
    currentRole: parsed.currentRole ?? "admin",
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    suppression: Array.isArray(parsed.suppression) ? parsed.suppression : [],
    chats: Array.isArray(parsed.chats) ? parsed.chats : [],
    memory: Array.isArray(parsed.memory) ? parsed.memory : [],
    schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
    interviewers:
      Array.isArray(parsed.interviewers) && parsed.interviewers.length > 0
        ? parsed.interviewers
        : seedInterviewers(),
    settings: repairSettings({
      ...settingsSource,
      llmProviders: preKimi ? defs.llmProviders : (settingsSource.llmProviders ?? defs.llmProviders),
      savedModels: preKimi ? defs.savedModels : (settingsSource.savedModels ?? defs.savedModels),
      tools: settingsSource.tools ?? defs.tools,
      mcpServers: settingsSource.mcpServers ?? defs.mcpServers,
      webResearch: settingsSource.webResearch ?? defs.webResearch,
      defaultModels: preKimi
        ? defs.defaultModels
        : (settingsSource.defaultModels ?? defs.defaultModels),
      hermesLiveMode: settingsSource.hermesLiveMode ?? defs.hermesLiveMode,
      hermesApiUrl: settingsSource.hermesApiUrl ?? defs.hermesApiUrl,
      hermesApiKeyId: settingsSource.hermesApiKeyId ?? defs.hermesApiKeyId,
      guardrails: settingsSource.guardrails ?? defs.guardrails,
      notifications: settingsSource.notifications ?? defs.notifications,
      starRatingThresholds: settingsSource.starRatingThresholds ?? defs.starRatingThresholds,
      hermesWebUrl: settingsSource.hermesWebUrl ?? defs.hermesWebUrl ?? "",
      heyreach: settingsSource.heyreach ?? defs.heyreach,
    }),
    seats: (Array.isArray(parsed.seats) ? parsed.seats : []).map((seat) => ({
      ...seat,
      providerId: seat.providerId,
      modelId: seat.modelId,
      toolIds: Array.isArray(seat.toolIds) ? seat.toolIds : [],
    })),
  };
}

export function normalizeHermesState(parsed: HermesState): HermesState {
  if (parsed.version !== STATE_VERSION) return migrateToCurrentVersion(parsed);
  const settings = repairSettings(parsed.settings);
  const starT = settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  return {
    ...parsed,
    wins: Array.isArray(parsed.wins) ? (asObjectArray(parsed.wins) as unknown as HermesState["wins"]) : [],
    campaigns: repairCampaigns(parsed.campaigns),
    candidates: repairCandidates(parsed.candidates).map((c) => ({
      ...c,
      leadSource: c.leadSource ?? deriveLeadSource(c),
      starRating: c.starRating ?? deriveStarRating(c.matchScore, starT),
    })),
    outreach: repairOutreach(parsed.outreach),
    replies: repairReplies(parsed.replies),
    bookings: repairBookings(parsed.bookings),
    activities: Array.isArray(parsed.activities)
      ? (asObjectArray(parsed.activities) as unknown as HermesState["activities"])
      : [],
    ledger: Array.isArray(parsed.ledger)
      ? (asObjectArray(parsed.ledger) as unknown as HermesState["ledger"])
      : [],
    reports: Array.isArray(parsed.reports)
      ? (asObjectArray(parsed.reports) as unknown as HermesState["reports"])
      : [],
    chatboxSubmissions: Array.isArray(parsed.chatboxSubmissions)
      ? (asObjectArray(parsed.chatboxSubmissions) as unknown as HermesState["chatboxSubmissions"])
      : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    suppression: Array.isArray(parsed.suppression) ? parsed.suppression : [],
    chats: Array.isArray(parsed.chats) ? parsed.chats : [],
    memory: Array.isArray(parsed.memory) ? parsed.memory : [],
    schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
    apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
    seats: Array.isArray(parsed.seats) ? parsed.seats : [],
    interviewers:
      Array.isArray(parsed.interviewers) && parsed.interviewers.length > 0
        ? parsed.interviewers
        : seedInterviewers(),
    integrations: Array.isArray(parsed.integrations) ? parsed.integrations : defaultIntegrations(),
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
