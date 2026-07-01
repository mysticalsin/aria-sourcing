/* ============================================================================
   ARIA SOURCING — domain types
   Single source of truth for the data model. Every module imports from here.
   ========================================================================== */

/* ---- Enums (as string unions for ergonomic JSON persistence) ------------- */

export const CANDIDATE_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Interested",
  "Booked",
  "Interviewed",
  "Offer",
  "Hired",
  "Not Interested",
  "Rejected",
  "Suppressed",
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** The ordered funnel the dashboard / reports visualise. */
export const FUNNEL_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Interested",
  "Booked",
  "Interviewed",
  "Hired",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const REPLY_INTENTS = [
  "INTERESTED",
  "QUALIFIED_INTEREST",
  "NOT_INTERESTED",
  "REFERRAL",
  "OOO",
  "UNCLEAR",
  "NEGATIVE",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const URGENCY_LEVELS = [
  "ASAP",
  "Critical",
  "Urgent",
  "This Week",
  "Standard",
] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const CAMPAIGN_STATUSES = [
  "Intake",
  "Sourcing",
  "Outreach",
  "Interviewing",
  "Closing",
  "Filled",
  "Paused",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const INTAKE_INTENTS = [
  "New Role",
  "Backfill",
  "Urgent Hire",
  "Exploratory",
] as const;
export type IntakeIntent = (typeof INTAKE_INTENTS)[number];

export const OUTREACH_CHANNELS = ["Email", "LinkedIn", "WhatsApp", "SMS"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_TONES = [
  "Casual Professional",
  "Executive",
  "Technical",
] as const;
export type OutreachTone = (typeof OUTREACH_TONES)[number];

export const OUTREACH_STATUSES = [
  "Draft",
  "Needs Approval",
  "Approved",
  "Pending Manual Send",
  "Scheduled",
  "Rejected",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "parse",
  "campaign",
  "score",
  "sourcing",
  "outreach",
  "reply",
  "booking",
  "learning",
  "compliance",
  "system",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const SENIORITY_LEVELS = [
  "Junior",
  "Mid",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Director",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export const COMPANY_STAGES = [
  "Seed",
  "Series A",
  "Series B",
  "Series C+",
  "Public",
  "Enterprise",
] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const SOURCE_PLATFORMS = [
  "GitHub",
  "LinkedIn",
  "Stack Overflow",
  "Referral",
  "Talent Pool",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const BOOKING_STATUSES = [
  "Proposed",
  "Confirmed",
  "Completed",
  "Cancelled",
  "No Show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const INTEGRATION_MODES = ["mock", "live"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const INTEGRATION_HEALTH = [
  "connected",
  "degraded",
  "error",
  "not_configured",
] as const;
export type IntegrationHealth = (typeof INTEGRATION_HEALTH)[number];

/* ---- Job analysis -------------------------------------------------------- */

export interface JobAnalysis {
  title: string;
  department: string;
  seniority: Seniority;
  employmentType: "Full-time" | "Contract" | "Part-time";
  locationType: "Remote" | "Hybrid" | "On-site";
  regions: string[];
  timezone: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  equity: boolean;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  education: string;
  industryExperience: string[];
  companyStageTarget: CompanyStage[];
  teamSize: string;
  reportingTo: string;
  urgency: Urgency;
  /** Detected language of the need (ISO code, e.g. "en", "fr"). */
  language?: string;
  validationWarnings: ValidationWarning[];
}

export interface ValidationWarning {
  field: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

/* ---- Sourcing strategy --------------------------------------------------- */

export interface SourcingStrategy {
  primaryPlatforms: SourcePlatform[];
  secondaryPlatforms: SourcePlatform[];
  githubQueries: GithubQuery[];
  linkedinBoolean: string;
  stackOverflowTags: string[];
  geoTargets: string[];
  excludedCompanies: string[];
  targetCompanyStages: CompanyStage[];
}

export interface GithubQuery {
  label: string;
  query: string;
  estimatedResults: number;
}

/* ---- Scoring ------------------------------------------------------------- */

export interface ScoringWeights {
  skills: number;
  experience: number;
  companyStage: number;
  industry: number;
  location: number;
  activity: number;
}

export interface MatchBreakdownItem {
  key: keyof ScoringWeights;
  label: string;
  score: number; // 0-100 dimension score
  weight: number; // 0-1 normalised weight
  contribution: number; // weighted points contributed to composite
  rationale: string;
}

/* ---- Candidate ----------------------------------------------------------- */

export interface OutreachHistoryEntry {
  messageId: string;
  channel: OutreachChannel;
  subject: string;
  status: OutreachStatus;
  at: string;
}

export interface ReplyHistoryEntry {
  id: string;
  intent: ReplyIntent;
  confidence: number;
  excerpt: string;
  at: string;
}

export interface ComplianceFlags {
  doNotContact: boolean;
  suppressed: boolean;
  unsubscribed: boolean;
  gdprExportRequested: boolean;
  anonymized: boolean;
  suppressedUntil: string | null;
}

export interface Candidate {
  id: string;
  campaignId: string;
  name: string;
  email: string;
  /** E.164 phone (e.g. +14155552671) for WhatsApp / SMS outreach. Often empty
   *  until enriched; sourced profiles rarely expose one. */
  phone?: string;
  avatarInitials: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  timezone: string;
  linkedinUrl: string;
  githubUrl: string;
  sourcePlatform: SourcePlatform;
  sourceQuery: string;
  matchScore: number;
  matchBreakdown: MatchBreakdownItem[];
  techStack: string[];
  yearsExperience: number;
  companyStageExperience: CompanyStage[];
  industryExperience: string[];
  recentActivity: string;
  stage: CandidateStage;
  lastContactedAt: string | null;
  outreachHistory: OutreachHistoryEntry[];
  replyHistory: ReplyHistoryEntry[];
  booking: Booking | null;
  complianceFlags: ComplianceFlags;
  createdAt: string;
}

/* ---- Outreach ------------------------------------------------------------ */

export interface OutreachMessage {
  id: string;
  candidateId: string;
  campaignId: string;
  channel: OutreachChannel;
  subject: string;
  body: string;
  tone: OutreachTone;
  personalizationEvidence: string[];
  status: OutreachStatus;
  sequenceStep: number;
  scheduledFor: string | null;
  sentAt: string | null;
  approvedBy: string | null;
  dryRun: boolean;
  createdAt: string;
}

/* ---- Replies ------------------------------------------------------------- */

export interface ClassifiedReply {
  id: string;
  candidateId: string;
  campaignId: string;
  channel: OutreachChannel;
  body: string;
  intent: ReplyIntent;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
  draftResponse: string;
  handled: boolean;
  slaDueAt: string | null;
  receivedAt: string;
  /** Inbound-email metadata (set when auto-ingested from a mailbox; absent for manual entry). */
  fromAddress?: string;
  messageId?: string;
  inboxThreadId?: string;
  externalReceivedAt?: string; // ISO timestamp from the email provider
}

/* ---- Bookings ------------------------------------------------------------ */

export interface Booking {
  id: string;
  candidateId: string;
  campaignId: string;
  candidateName: string;
  role: string;
  startTime: string;
  endTime: string;
  timezone: string;
  interviewer: string;
  interviewerEmail: string;
  teamsLink: string;
  calLink: string;
  status: BookingStatus;
  agenda: string[];
  createdAt: string;
}

/* ---- Activity ------------------------------------------------------------ */

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  notes: string;
  outcome: string;
  campaignId: string | null;
  linkedEntityType: "candidate" | "campaign" | "outreach" | "reply" | "booking" | "report" | "skill" | null;
  linkedEntityId: string | null;
  createdAt: string;
}

/* ---- Skill refinement ---------------------------------------------------- */

export type SkillKey =
  | "outreach_skill"
  | "sourcing_skill"
  | "scoring_skill"
  | "reply_classification_skill";

export interface SkillUpdate {
  id: string;
  skill: SkillKey;
  title: string;
  rationale: string;
  before: string;
  after: string;
  impact: string;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

/** Tunable parameters a learned skill controls — accepting an update mutates these
 *  and the change actually feeds back into the agent's behavior. */
export interface AgentSkillParams {
  preferredTone?: OutreachTone;
  leadWithArtifact?: boolean;
  weights?: Partial<ScoringWeights>;
  qualifiedInterestFloor?: number; // reply-classification threshold
  preferredPlatforms?: SourcePlatform[];
}

export interface SkillVersionEntry {
  version: number;
  summary: string;
  at: string;
}

/** A persistent, versioned Aria skill (the `*.md` the agent edits as it learns). */
export interface AgentSkill {
  key: SkillKey;
  filename: string;
  title: string;
  description: string;
  content: string; // the skill body (markdown)
  version: number;
  params: AgentSkillParams;
  metrics: { applied: number; outcomeSignal: number }; // outcomeSignal: learned win-rate delta
  updatedAt: string;
  history: SkillVersionEntry[];
}

/* ---- Campaign ------------------------------------------------------------ */

export interface CampaignMetrics {
  sourced: number;
  contacted: number;
  replied: number;
  interested: number;
  booked: number;
  interviewed: number;
  offer: number;
  hired: number;
  notInterested: number;
  replyRate: number; // 0-1
  avgMatchScore: number;
  timeToFirstInterviewHours: number | null;
  emailsSentToday: number;
  linkedinSentToday: number;
}

export interface Campaign {
  id: string;
  title: string;
  department: string;
  urgency: Urgency;
  status: CampaignStatus;
  hiringManager: string;
  hiringManagerEmail: string;
  createdAt: string;
  targetStartDate: string;
  jobAnalysis: JobAnalysis;
  sourcingStrategy: SourcingStrategy;
  scoringWeights: ScoringWeights;
  metrics: CampaignMetrics;
  skillUpdates: SkillUpdate[];
  activities: Activity[];
}

/* ---- Weekly report ------------------------------------------------------- */

export interface FunnelPoint {
  stage: FunnelStage;
  count: number;
}

export interface WeeklyReport {
  id: string;
  campaignId: string;
  campaignTitle: string;
  generatedAt: string;
  periodLabel: string;
  funnel: FunnelPoint[];
  performance: {
    replyRate: number;
    interestRate: number;
    bookingRate: number;
    avgMatchScore: number;
    timeToFirstInterviewHours: number | null;
    costPerHire: number;
    bestChannel: OutreachChannel;
    bestDay: string;
    bestTime: string;
  };
  insights: string[];
  winningPatterns: string[];
  skillUpdates: SkillUpdate[];
  attentionNeeded: string[];
}

/* ---- Integrations -------------------------------------------------------- */

export interface IntegrationStatus {
  id: string;
  name: string;
  category: "Inbox" | "Sourcing" | "Enrichment" | "CRM" | "Calendar" | "Comms" | "Infra";
  description: string;
  status: IntegrationHealth;
  mode: IntegrationMode;
  lastSync: string | null;
  errors: string[];
  /** Email or identifier of the linked mailbox account (OAuth or SMTP). Empty = not set. */
  connectedAccount?: string;
}

/* ---- Settings ------------------------------------------------------------ */

export interface RateLimits {
  emailsPerDay: number;
  linkedinPerDay: number;
  followUpGapDays: number;
  suppressionDays: number;
}

export interface ComplianceSettings {
  candidateRetentionDays: number;
  jdRetentionDays: number;
  emailContentRetentionDays: number;
  crmAuditLogs: boolean;
  unsubscribeEnforcement: boolean;
  ccpaDoNotSell: boolean;
  gdprMode: boolean;
}

/* ---- Guardrails & Aria (the agent's editable brain) ---------------------- */

export interface GuardrailRule {
  id: string;
  text: string;
  enabled: boolean;
  /** Locked safety rails ("so we don't get banned") — cannot be disabled or removed. */
  locked?: boolean;
}

export interface GuardrailConfig {
  /** Aria's master system prompt — every agent inherits it as their base brain. */
  ariaPrompt: string;
  /** Editable behavior rules injected into every agent. Locked ones are non-negotiable. */
  rules: GuardrailRule[];
}

export interface SystemSettings {
  humanApprovalGate: boolean;
  dryRunMode: boolean;
  minScoreToContact: number;
  slaMinutes: number;
  operatorName: string;
  systemIdentity: string;
  rateLimits: RateLimits;
  compliance: ComplianceSettings;
  fleet: FleetSettings;
  /** When on, candidate PII is masked everywhere except an active outreach context,
   *  and any reveal is written to the audit trail (purpose limitation). */
  confidentialityMode: boolean;
  /** Default language Aria composes outreach in (ISO code). */
  defaultLanguage: string;
  /** Operations-floor sound effects. OFF by default. */
  soundEnabled: boolean;
  /** Editable guardrails + Aria's master prompt — the adjustable brain of every agent. */
  guardrails: GuardrailConfig;
  notifications: {
    slack: boolean;
    telegram: boolean;
    email: boolean;
  };
  /** Configured LLM provider connections for the sourcing fleet. */
  llmProviders: LlmProvider[];
  /** Saved models the fleet can use (references a provider by id). */
  savedModels: SavedModel[];
  /** Per-capability tool registry — toggles apply to every agent by default. */
  tools: ToolDef[];
  /** Registered MCP (Model Context Protocol) servers — extra tool sources the fleet
   *  can connect to. The raw auth token lives in the key vault, referenced by id. */
  mcpServers: McpServerConfig[];
  /** Give agents the built-in, read-only web-research tools (web_search / fetch_page /
   *  rss) in chat. Compliant by design: honest bot UA, no login/stealth, SSRF-guarded.
   *  Only active when a cloud LLM provider is configured for the chat task. */
  webResearch?: boolean;
  /** Default model per task type (SavedModel.id). */
  defaultModels?: Partial<Record<ModelTask, string>>;
  /** When on, outreach drafting routes through the live Aria agent runtime
   *  (with a mock fallback). Off by default — the safe default for this build. */
  hermesLiveMode: boolean;
  /** Base URL of the hermes-agent aiohttp server (e.g. http://127.0.0.1:8642). */
  hermesApiUrl?: string;
  /** References an ApiKey.id (provider "Aria Agent") holding the bearer token. */
  hermesApiKeyId?: string;
  /** Maximum number of memory entries stored across all agents. */
  memoryCapacity?: number;
  /** Base URL of the hermes-agent web_server / management API (e.g. http://127.0.0.1:8643).
   *  Distinct from hermesApiUrl which is the OpenAI-compat generation endpoint. */
  hermesWebUrl?: string;
}

/* ---- Outreach fleet (multi-seat coordination + anti-ban guardrails) ------- */

export const SEAT_PROVIDERS = [
  "Microsoft Graph",
  "Gmail API",
  "SendGrid",
  "Resend",
  "WhatsApp Cloud",
  "Twilio SMS",
] as const;
export type SeatProvider = (typeof SEAT_PROVIDERS)[number];

export const SEAT_STATUSES = ["active", "paused", "disabled"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export interface SendWindow {
  startHour: number; // 0-23, local to timezone
  endHour: number; // 0-23
  timezone: string;
  days: number[]; // 0=Sun .. 6=Sat
}

export interface SeatHealth {
  sentTotal: number;
  bounces: number;
  complaints: number;
  bounceRate: number; // 0-1
  complaintRate: number; // 0-1
}

/**
 * An AgentSeat is ONE real, authorized sending identity (a mailbox the operator
 * owns) connected through an OFFICIAL provider API. Seats coordinate to share
 * load WITHOUT exceeding any single account's published limits — this is
 * team coordination, never rate-limit evasion. No scraping, no LinkedIn
 * automation, no synthetic identities.
 */
export interface AgentSeat {
  id: string;
  name: string; // operator / persona label
  operatorEmail: string; // the authorized sending mailbox
  provider: SeatProvider;
  status: SeatStatus;
  mode: IntegrationMode; // mock (default) | live
  domainVerified: boolean; // SPF/DKIM/DMARC — required before live sends
  dailyLimit: number; // conservative cap at/below the provider's official limit
  warmup: boolean;
  warmupStartCap: number;
  warmupStepPerDay: number;
  warmupStartedAt: string;
  minGapMinutes: number; // human-paced spacing (with jitter)
  sendWindow: SendWindow;
  sentToday: number;
  lastSendAt: string | null;
  health: SeatHealth;
  /** Editable per-agent prompt — the voice/instructions this Aria agent writes with. */
  persona: string;
  signature: string;
  /** Optional custom robot colour (any CSS hex, e.g. "#3B82F6"). When set it
   *  overrides the auto-assigned floor palette so new agents can use any colour. */
  color?: string;
  /** Language this agent writes outreach in (ISO code). */
  language?: string;
  /** Connected email account label (official API). Empty = not connected. */
  connectedAccount: string;
  createdAt: string;
  /** LlmProvider.id assigned to this agent (overrides workspace default). */
  providerId?: string;
  /** SavedModel.id assigned to this agent. */
  modelId?: string;
  /** Tool IDs enabled for this agent (overrides workspace defaults when set). */
  toolIds?: ToolId[];
}

export const SUPPRESSION_TYPES = ["email", "domain", "linkedin"] as const;
export type SuppressionType = (typeof SUPPRESSION_TYPES)[number];

export interface SuppressionEntry {
  id: string;
  type: SuppressionType;
  value: string;
  reason: string;
  source: string;
  createdAt: string;
  expiresAt: string | null; // null = permanent (e.g. do-not-contact)
}

export const LEDGER_STATUSES = [
  "claimed",
  "pending_manual",
  "sent",
  "bounced",
  "complained",
  "skipped",
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Authoritative append-only record of every contact attempt across all seats. */
export interface OutreachLedgerEntry {
  id: string;
  candidateId: string;
  candidateEmail: string;
  seatId: string;
  campaignId: string;
  channel: OutreachChannel;
  status: LedgerStatus;
  reason: string | null;
  at: string;
}

export interface FleetSettings {
  recontactWindowDays: number; // global re-contact suppression window (default 90)
  bounceRatePauseThreshold: number; // auto-pause a seat above this (e.g. 0.05)
  complaintRatePauseThreshold: number; // e.g. 0.001
  enforceBusinessHours: boolean;
  jitter: boolean;
  globalDailyCap: number | null; // optional org-wide ceiling across all seats
  maxAgents: number; // hard ceiling on deployable agents (e.g. 300)
}

export interface AllocationAssignment {
  seatId: string;
  seatName: string;
  candidateId: string;
  candidateName: string;
}

export interface AllocationSkip {
  candidateId: string;
  candidateName: string;
  reason: string;
}

export interface AllocationResult {
  assignments: AllocationAssignment[];
  deferred: AllocationSkip[]; // no seat capacity right now
  skipped: AllocationSkip[]; // suppressed / duplicate / recently contacted
  fleetCapacityRemaining: number;
}

/* ---- Roles / access control ---------------------------------------------- */

export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/* ---- API keys / secrets -------------------------------------------------- */

export const API_KEY_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "Google",
  "xAI",
  "Groq",
  "OpenRouter",
  "Mistral",
  "Kimi (Moonshot)",
  "Resend",
  "SendGrid",
  "Aria Agent",
  "Custom",
] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/* ---- LLM providers (the fleet's model layer) ----------------------------- */

export const LLM_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "OpenRouter",
  "Google",
  "xAI",
  "Groq",
  "Mistral",
  "Local/Custom",
] as const;
export type LlmProviderKind = (typeof LLM_PROVIDERS)[number];

export interface LlmProvider {
  id: string;
  /** Which hosted provider this connects to. */
  kind: LlmProviderKind;
  label: string;
  /** Override the provider's default base URL (e.g. proxy or local endpoint). */
  baseUrl?: string;
  /** References an ApiKey.id — the raw secret never lives in provider state. */
  apiKeyId?: string;
  enabled: boolean;
  isDefault?: boolean;
}

export type ModelTask = "sourcing" | "outreach" | "classification" | "chat";

export interface SavedModel {
  id: string;
  providerId: string;
  modelName: string;
  label: string;
  contextWindow?: number;
  enabled: boolean;
  defaultForTask?: ModelTask[];
}

export const TOOL_IDS = [
  "web_search",
  "browser",
  "github_sourcing",
  "linkedin_sourcing",
  "enrichment",
  "email_send",
  "calendar",
  "vision",
  "image_gen",
  "memory",
  "skills",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolDef {
  id: ToolId;
  label: string;
  description: string;
  enabled: boolean;
}

export type McpServerStatus = "untested" | "connected" | "error";

/** A registered Model Context Protocol server — an external source of tools the fleet
 *  can call. Mirrors LlmProvider: the auth token lives in the key vault by id, never
 *  inline. */
export interface McpServerConfig {
  id: string;
  name: string;
  /** The MCP server's HTTP(S) endpoint (streamable-HTTP / SSE transport). */
  url: string;
  /** References an ApiKey.id for the Bearer token; the raw secret never lives here. */
  apiKeyId?: string;
  enabled: boolean;
  status: McpServerStatus;
  lastTestedAt?: string;
  /** Tools the server exposed on the last successful connection test. */
  toolCount?: number;
  /** Names of those tools (for display), captured on the last successful test. */
  toolNames?: string[];
}

/** Stored metadata only — the secret value never lives in client state. */
export interface ApiKey {
  id: string;
  name: string;
  provider: ApiKeyProvider;
  last4: string;
  status: "untested" | "valid" | "invalid";
  lastTestedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export const EMAIL_CONNECTION_PROVIDERS = ["Gmail API", "Microsoft Graph"] as const;
export type EmailConnectionProvider = (typeof EMAIL_CONNECTION_PROVIDERS)[number];

/** Server-side OAuth connection for an email sending seat.
 *  Secrets are stored in Postgres and never returned to the browser. */
export interface EmailConnection {
  id: string;
  seatId: string;
  provider: EmailConnectionProvider;
  accountEmail: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string;
  connectedAt: string;
  updatedAt: string;
}

/* ---- Memory -------------------------------------------------------------- */

export const MEMORY_KINDS = ["fact", "preference", "instruction", "episodic"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryEntry {
  id: string;
  seatId: string;
  kind: MemoryKind;
  content: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ---- Chat ---------------------------------------------------------------- */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  pending?: boolean;
}

export interface ChatThread {
  id: string;
  seatId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/* ---- Schedules (local CRUD, demo posture — no live cron yet) ------------ */

export const CRON_CADENCES = ["daily", "weekly", "monthly"] as const;
export type CronCadence = (typeof CRON_CADENCES)[number];

export interface CronJob {
  id: string;
  name: string;
  cadence: CronCadence;
  /** Time of day in HH:MM format (local timezone), optional. */
  timeOfDay?: string;
  task: "sourcing" | "outreach" | "report";
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

/* ---- Root persisted state ------------------------------------------------ */

export interface HermesState {
  version: number;
  campaigns: Campaign[];
  candidates: Candidate[];
  outreach: OutreachMessage[];
  replies: ClassifiedReply[];
  bookings: Booking[];
  reports: WeeklyReport[];
  integrations: IntegrationStatus[];
  activities: Activity[];
  settings: SystemSettings;
  seats: AgentSeat[];
  suppression: SuppressionEntry[];
  ledger: OutreachLedgerEntry[];
  skills: AgentSkill[];
  apiKeys: ApiKey[];
  currentRole: Role;
  chats: ChatThread[];
  memory: MemoryEntry[];
  /** Scheduled automation jobs. Demo posture — UI only, no live cron. */
  schedules: CronJob[];
  activeCampaignId: string | null;
  /** Dedup ledger of provider message ids already ingested (inbound email tracking). */
  ingestedMessageIds?: string[];
}
