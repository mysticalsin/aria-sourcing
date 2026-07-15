import type { AriaPlan } from "../aria-command";
import type { ConnectionTestResult } from "../integrations";
import type { ReplyClassification } from "../mock-ai";
import type { Recommendation } from "../recommendations";
import type { ApprovalResult } from "../rules";
import type { ApifyProfileSearchInput } from "../sourcing/apify";
import type { SourceResult } from "../sourcing/candidate-mappers";
import type { SourcingFeedbackReceiptDto } from "../sourcing/sourcing-agent-contract";
import type { WorkspaceStatus } from "../workspace-status";
import type {
  Activity,
  AgentSeat,
  AllocationResult,
  ApiKey,
  ApiKeyProvider,
  Booking,
  Campaign,
  CandidateStage,
  CandidateLawfulBasis,
  ChatboxSubmission,
  ChatboxSubmissionStatus,
  ChatMessage,
  ChatThread,
  ClassifiedReply,
  CronJob,
  DustAgentSummary,
  DustRegion,
  DustTask,
  EnrichableField,
  HermesState,
  IntegrationStatus,
  Interviewer,
  InterviewKind,
  InterviewRecord,
  JobAnalysis,
  LeadSource,
  LlmProvider,
  McpServerConfig,
  ModelTask,
  OutreachChannel,
  OutreachMessage,
  OutreachTone,
  PrequalOutcome,
  PrequalRecord,
  Role,
  SavedModel,
  SkillKey,
  SkillUpdate,
  SourcePlatform,
  StarRating,
  SuppressionEntry,
  SystemSettings,
  ToolId,
  WeeklyReport,
} from "../types";

export type CampaignUpdate = Partial<
  Pick<Campaign, "status" | "previousStatus" | "jobAnalysis" | "scoringWeights">
>;

export type BookingUpdate = Partial<
  Pick<Booking, "startTime" | "endTime" | "status">
>;

export type SourceNextBatchErrorSource =
  | "github"
  | "web"
  | "paused"
  | "unavailable"
  | "forbidden"
  | "not_found"
  | "invalid";

export type SourceNextBatchResult =
  | (SourceResult & {
      source: "github" | "web" | "mock";
      ok: true;
      mode?: "cloud" | "deterministic";
      feedbackReceipts?: SourcingFeedbackReceipt[];
    })
  | {
      ok: false;
      error: string;
      source: SourceNextBatchErrorSource;
      retryable?: "agent_framework_reconcile";
    };

export type CandidateIntakeResult =
  | { ok: true; added: number; skipped: number; skipReason?: string }
  | { ok: false; error: string };

export type CandidateErasureStatus =
  | "pending_provider"
  | "manual_required"
  | "retryable_failure"
  | "completed"
  | "blocked_legal_hold";

export type CandidateErasureObligation = {
  id: string;
  provider: string;
  status: CandidateErasureStatus;
  attemptCount: number;
};

export type CandidateAnonymizeResult =
  | {
      ok: true;
      completed: boolean;
      status: Exclude<CandidateErasureStatus, "blocked_legal_hold">;
      requestId?: string;
      scrubCounts: Record<string, number>;
      obligations: CandidateErasureObligation[];
      workspaceRefreshRequired: boolean;
    }
  | {
      ok: false;
      completed: false;
      error: string;
      status?: CandidateErasureStatus;
      requestId?: string;
    };

export type SourcingFeedbackReceipt = SourcingFeedbackReceiptDto;

export type SourcingFeedbackVerdict = "useful" | "dead_end" | "corrected";

export type ApolloEnrichmentErrorCode =
  | "APOLLO_TARGET_NOT_FOUND"
  | "APOLLO_ENRICHMENT_IN_PROGRESS"
  | "APOLLO_RECONCILIATION_REQUIRED"
  | "APOLLO_CONFIRMATION_INVALID"
  | "APOLLO_IDEMPOTENCY_CONFLICT"
  | "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION"
  | "APOLLO_QUOTA_EXCEEDED"
  | "APOLLO_NOT_CONFIGURED"
  | "APOLLO_AUTHORITY_UNAVAILABLE"
  | "APOLLO_RECEIPT_UNAVAILABLE"
  | "APOLLO_OUTCOME_UNKNOWN";

export interface HermesActions {
  // campaigns
  setActiveCampaign: (id: string | null) => void;
  createCampaignFromAnalysis: (
    jd: JobAnalysis,
    meta: { hiringManager: string; hiringManagerEmail: string },
  ) => Campaign | null;
  updateCampaign: (id: string, patch: CampaignUpdate) => boolean;
  regenerateQueries: (id: string) => boolean;

  // sourcing
  sourceNextBatch: (
    campaignId: string,
    opts?: {
      platform?: SourcePlatform;
      count?: number;
      agentFramework?: { runId: string; capabilityToken: string; query: string };
    },
  ) => Promise<SourceNextBatchResult>;
  /** Searches real provider results and drafts for human review. Cloud mode uses
   * a tool-capable model; deterministic mode executes persisted GitHub queries
   * directly and never presents itself as an LLM run. */
  runSourcingAgent: (
    campaignId: string,
    count?: number,
  ) => Promise<{
    ok: boolean;
    added: number;
    mode?: "cloud" | "deterministic";
    feedbackReceipts?: SourcingFeedbackReceipt[];
    error?: string;
  }>;
  recordSourcingFeedback: (
    receiptId: string,
    verdict: SourcingFeedbackVerdict,
  ) => Promise<boolean>;
  listPendingSourcingFeedback: (
    campaignId: string,
  ) => Promise<SourcingFeedbackReceipt[] | null>;
  /** Manual intake: resolve one real GitHub user by exact login (via /api/source)
   *  and add them to the campaign — same scoring + dedupe pipeline as
   *  sourceNextBatch, just for a person the operator already has in mind
   *  instead of a search. Never drafts or sends outreach. */
  addCandidateFromGithub: (
    campaignId: string,
    username: string,
  ) => Promise<CandidateIntakeResult>;
  /** Manual intake, zero network: builds a Candidate only from operator-entered
   *  fields, with explicit Manual provenance and unknown facts left unknown.
   *  Never drafts or sends outreach. */
  addCandidateManual: (
    campaignId: string,
    input: {
      name: string;
      title?: string;
      skills?: string[];
      profileUrl?: string;
      email?: string;
      location?: string;
      notes?: string;
      lawfulBasis: CandidateLawfulBasis;
    },
  ) => Promise<CandidateIntakeResult>;
  /** Sillage Account Mapping (third real sourcing channel): resolves a company
   *  (domain or LinkedIn URL) into real enriched employee profiles. Enrichment is
   *  async — this kicks off the job server-side and returns a requestId to poll
   *  with checkSillageMapping. Requires a stored Sillage key (Settings). */
  startSillageMapping: (
    campaignId: string,
    identifier: string,
  ) => Promise<{ ok: true; requestId: string } | { ok: false; error: string }>;
  /** Polls one Sillage mapping job. While processing: {ok:true, status:"processing"}.
   *  On completion: maps + scores + dedupes the real profiles exactly like
   *  sourceNextBatch, commits the accepted candidates, logs an activity entry, and
   *  updates campaign metrics. Never backfills a failed/empty result with synthetic
   *  profiles. */
  checkSillageMapping: (
    campaignId: string,
    requestId: string,
  ) => Promise<
    | { ok: true; status: "processing" }
    | { ok: true; status: "completed"; added: number; company: string }
    | { ok: false; error: string }
  >;
  /** Real Apollo.io search (fourth real sourcing channel) — free, synchronous,
   *  no mock fallback: Apollo is a real channel, so an unconfigured key
   *  surfaces honestly as "not_configured" rather than synthesizing fake
   *  candidates. Requires a stored Apollo key (Settings). */
  sourceFromApollo: (
    campaignId: string,
    filters: {
      titles?: string[];
      seniorities?: string[];
      locations?: string[];
      organizationDomains?: string[];
      keywords?: string;
      count?: number;
    },
  ) => Promise<SourceResult & { source: "apollo" | "not_configured" | "error"; error?: string }>;
  /** Creates a short-lived, server-bound confirmation for one Apollo email
   *  reveal. This performs no provider call and must precede the human modal. */
  prepareApolloEnrichment: (
    candidateId: string,
  ) => Promise<
    | { ok: true; confirmationNonce: string; expiresAt: string }
    | { ok: false; error: string; code?: ApolloEnrichmentErrorCode }
  >;
  /** Commits one previously prepared Apollo email reveal. The server owns the
   *  provider id, idempotency, quota, replay, and ambiguity boundaries. */
  enrichApolloCandidate: (
    candidateId: string,
    confirmationNonce: string,
  ) => Promise<
    | { ok: true; revealed: boolean; detail: string }
    | { ok: false; revealed: false; detail: string; code?: ApolloEnrichmentErrorCode }
  >;
  /** Real Seamless.AI search (fifth real sourcing channel) — synchronous, no
   *  mock fallback. Requires a stored Seamless key (Settings). */
  sourceFromSeamless: (
    campaignId: string,
    filters: {
      jobTitles?: string[];
      seniorities?: string[];
      departments?: string[];
      industries?: string[];
      countries?: string[];
      states?: string[];
      companyNames?: string[];
      companyDomains?: string[];
      count?: number;
    },
  ) => Promise<SourceResult & { source: "seamless" | "not_configured" | "error"; error?: string }>;
  /** Explicit, confirmed, single-candidate Seamless contact reveal. Async
   *  (research → poll) — kicks off the job and returns a requestId to poll
   *  with checkSeamlessResearch. Never call this for a whole batch. */
  startSeamlessResearch: (
    candidateId: string,
  ) => Promise<{ ok: true; requestId: string } | { ok: false; error: string }>;
  /** Polls one Seamless research job. On completion, patches the candidate's
   *  email/phone in place (same PII convention as enrichApolloCandidate) and
   *  never fabricates contact info on failure. */
  checkSeamlessResearch: (
    candidateId: string,
    requestId: string,
  ) => Promise<
    | { ok: true; status: "processing" }
    | { ok: true; status: "completed"; revealed: boolean }
    | { ok: false; error: string }
  >;
  /** Real Apify search (harvestapi/linkedin-profile-search — sixth real
   *  sourcing channel): third-party public LinkedIn profile data, not a
   *  first-party scrape (see sourcing/apify.ts). Enrichment is async — this
   *  kicks off the actor run server-side and returns a runId + datasetId to
   *  poll with checkApifyRun. Requires a stored Apify key (Settings). */
  startApifyRun: (
    campaignId: string,
    criteria: ApifyProfileSearchInput,
  ) => Promise<{ ok: true; runId: string; datasetId: string } | { ok: false; error: string }>;
  /** Polls one Apify actor run. While processing: {ok:true, status:"processing"}.
   *  On completion: maps + scores + dedupes the real profiles exactly like
   *  checkSillageMapping, commits the accepted candidates, logs an activity
   *  entry, and updates campaign metrics. Never backfills a failed/empty
   *  result with synthetic profiles. */
  checkApifyRun: (
    campaignId: string,
    runId: string,
    datasetId: string,
    query: string,
  ) => Promise<
    | { ok: true; status: "processing" }
    | { ok: true; status: "completed"; added: number }
    | { ok: false; error: string }
  >;
  /** Unified cross-provider enrichment orchestrator (docs/superpowers/plans/
   *  2026-07-15-enrichment-orchestrator.md) — a candidate discovered by ANY
   *  provider can be enriched by every OTHER configured provider (Apify
   *  dev_fusion, Apollo, Seamless, Sillage). Calls /api/source/enrich, which
   *  runs the cost-ordered waterfall server-side, then merges the returned
   *  patch (email/phone/headline/location/company/skills/enrichment/
   *  externalIds/matchScore) into the candidate and logs one Activity
   *  summarizing which provider filled what. Respects
   *  `state.enrichmentBudgetUnits` (generous default when unset); a
   *  provider-by-provider spend ledger is appended to
   *  `state.enrichmentLedger` regardless of whether data was found. Defaults
   *  `want` to the core contact/richness fields. Never throws — network/
   *  server failures come back as `{ok:false}` with a `detail`. */
  enrichCandidate: (
    candidateId: string,
    opts?: { want?: EnrichableField[] },
  ) => Promise<{ ok: boolean; filled: EnrichableField[]; spend: number; detail: string }>;
  /** Batch variant of enrichCandidate — runs the waterfall for every candidate
   *  in a campaign not yet covered for `want`, with a concurrency cap
   *  (default 3) sharing the same workspace enrichment budget. Stops
   *  dispatching new candidates once the shared budget is exhausted
   *  (candidates already in flight still complete); logs one summary
   *  Activity for the whole batch rather than one per candidate. */
  enrichCampaign: (
    campaignId: string,
    opts?: { want?: EnrichableField[]; concurrency?: number },
  ) => Promise<{ ok: boolean; total: number; done: number; filled: number; spend: number; error?: string }>;

  // outreach
  generateOutreachFor: (
    candidateId: string,
    tone?: OutreachTone,
    channel?: OutreachChannel,
    seatId?: string,
  ) => OutreachMessage | null;
  /** Live variant: drafts via the Aria runtime when live mode is configured,
   *  else falls back to the deterministic mock. Commits exactly like
   *  generateOutreachFor — status is still set by the human approval gate. */
  generateOutreachLive: (
    candidateId: string,
    tone?: OutreachTone,
    channel?: OutreachChannel,
    seatId?: string,
  ) => Promise<OutreachMessage | null>;
  updateOutreach: (messageId: string, patch: Partial<OutreachMessage>) => void;
  /** Live variant: regenerates via the Aria runtime when live mode is configured
   *  (same three-layer fallback as generateOutreachLive), else the deterministic
   *  mock. Status is still set by the human approval gate — never auto-sent. */
  regenerateOutreach: (messageId: string, tone?: OutreachTone) => Promise<void>;
  approveOutreach: (messageId: string) => Promise<ApprovalResult>;
  confirmManualSend: (messageId: string) => { ok: boolean; error?: string };
  /** The deliberate gated send for a live-approved email — calls the server send route. */
  sendApprovedOutreach: (messageId: string) => Promise<{ ok: boolean; error?: string; queued?: boolean }>;
  rejectOutreach: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Drafts the next sequence-step follow-up for a candidate who has gone quiet
   *  past the configured gap (see deriveFollowUpsDue). Lands in the approval
   *  queue exactly like generateOutreachFor — never sends. Returns null when
   *  the candidate isn't actually due (already replied, too recent, or already
   *  has a pending draft). */
  draftFollowUpFor: (candidateId: string, tone?: OutreachTone, seatId?: string) => Promise<OutreachMessage | null>;
  /** Draft a #Vivier re-contact for a pooled (Rejected/Not Interested) candidate,
   *  bypassing the follow-up stage gate. Returns the Draft (still needs approval). */
  draftRecontactFor: (candidateId: string, tone?: OutreachTone, seatId?: string) => Promise<OutreachMessage | null>;

  // replies
  classifyAndStoreReply: (input: {
    text: string;
    candidateId?: string;
    campaignId?: string;
    fromAddress?: string;
    messageId?: string;
    inboxThreadId?: string;
    externalReceivedAt?: string;
  }) => Promise<{ reply: ClassifiedReply; classification: ReplyClassification }>;
  markReplyHandled: (replyId: string) => void;
  applyReplyAction: (replyId: string) => Promise<{ ok: boolean; error?: string; warning?: string }>;
  /** Turns a reply's suggested draftResponse into a real OutreachMessage in the
   *  approval queue (never sends directly). Carries the reply's inboxThreadId
   *  for threading when present. Returns null when the reply/candidate can't
   *  be resolved or there's no draft text to send. */
  draftReplyResponse: (replyId: string) => OutreachMessage | null;

  // bookings
  createBookingFor: (
    candidateId: string,
    opts?: { startTime?: string; interviewerName?: string },
  ) => Promise<
    | { ok: true; booking: Booking; prepEmail: string; confirmationEmail: string }
    | { ok: false; error: string }
  >;
  updateBooking: (
    id: string,
    patch: BookingUpdate,
  ) => { ok: true } | { ok: false; error: string };

  // reports + learning
  generateReport: (campaignId: string) => WeeklyReport | null;
  setSkillUpdateStatus: (
    campaignId: string,
    skillId: string,
    status: SkillUpdate["status"],
  ) => boolean;

  // candidates / compliance
  setCandidateStage: (id: string, stage: CandidateStage) => void;
  setCandidatePhone: (id: string, phone: string) => void;
  /** Appends a free-text recruiter note (newest first). Audit-worthy — writes
   *  an Activity, not just a UI notification. No-ops on blank text. */
  addCandidateNote: (candidateId: string, text: string) => void;
  /** Records/edits why a candidate was rejected. Independent of the stage
   *  control — call it alongside setCandidateStage("Rejected", ...), never
   *  instead of it. Clearing the reason (empty string) is not audit-logged. */
  setRejectionReason: (candidateId: string, reason: string) => void;
  /* ---- TAnIA: star rating, lead source, #Vivier, prequal, interviews ---- */
  /** Manual override of the Mantu Star Rating (TopGun/A/B/C/D). */
  setCandidateRating: (id: string, rating: StarRating) => void;
  /** Reclassify a candidate's lead source (Applicant/Referral/Outbound). */
  setCandidateLeadSource: (id: string, leadSource: LeadSource) => void;
  /** Add/remove a candidate from #Vivier (talent pool); auto-flags Silver Medalist. */
  toggleVivier: (id: string) => void;
  /** Patch the prequal record (schedule, questions, tone guide). */
  savePrequal: (candidateId: string, patch: Partial<PrequalRecord>) => void;
  /** Record the prequal decision. "advance" promotes a LEAD to a CANDIDATE. */
  setPrequalOutcome: (candidateId: string, outcome: PrequalOutcome) => void;
  /** Schedule an interview round (Intw1/2/3/QM); books an Interested lead. */
  addInterview: (candidateId: string, kind: InterviewKind, interviewer: string, scheduledFor: string | null) => void;
  /** Patch an interview record (outcome, HM feedback, rating). */
  updateInterview: (candidateId: string, interviewId: string, patch: Partial<InterviewRecord>) => void;
  /** Hand a scored chatbox application off to the Applicant Screener — creates a Candidate. */
  advanceChatboxSubmission: (id: string) => void;
  /** Set a chatbox submission's review status. */
  setChatboxSubmissionStatus: (id: string, status: ChatboxSubmissionStatus) => void;
  /** Append a new chatbox submission (used by the public careers chatbox). */
  addChatboxSubmission: (sub: ChatboxSubmission) => void;
  suppressCandidate: (id: string) => void;
  markDoNotContact: (id: string) => void;
  /** Undoes suppressCandidate/markDoNotContact — clears the suppressed/doNotContact
   *  flags and restores `stage` to whatever it was right before suppression. */
  restoreCandidateContact: (id: string) => void;
  unsubscribeCandidate: (id: string) => void;
  anonymizeCandidate: (id: string) => Promise<CandidateAnonymizeResult>;
  exportCandidate: (id: string) => string;

  // settings + integrations
  updateSettings: (patch: Partial<SystemSettings>) => void;
  updateIntegration: (id: string, patch: Partial<IntegrationStatus>) => void;
  toggleIntegrationMode: (id: string) => void;
  testIntegration: (id: string) => Promise<ConnectionTestResult>;

  // fleet — multi-seat coordination + anti-ban guardrails
  addSeat: (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => Promise<AgentSeat | null>;
  /** Seeds synthetic seats only when Supabase is disabled. Live workspaces use addSeat. */
  deployAgents: (
    n: number,
    opts?: { language?: string; namePrefix?: string },
  ) => { created: number; total: number; capped: boolean; max: number };
  updateSeat: (id: string, patch: Partial<AgentSeat>) => void;
  setSeatStatus: (id: string, status: AgentSeat["status"]) => void;
  connectSeatAccount: (id: string, account: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectSeatAccount: (id: string) => Promise<{ ok: boolean; error?: string; dryRun?: boolean }>;
  toggleSeatLive: (id: string) => Promise<{ ok: boolean; reason: string }>;
  verifySeatDomain: (id: string) => Promise<{ ok: boolean; verified?: boolean; error?: string }>;
  addSuppression: (entry: {
    type: SuppressionEntry["type"];
    value: string;
    reason: string;
    expiresAt?: string | null;
  }) => Promise<{ ok: boolean; entry?: SuppressionEntry; error?: string }>;
  removeSuppression: (id: string) => Promise<{ ok: boolean; error?: string }>;
  allocateOutreach: (opts?: { campaignId?: string; pool?: "ready" | "interested" }) => AllocationResult;

  // skills — learning loop
  runLearning: () => SkillUpdate[];
  acceptSkillLearning: (key: SkillKey) => void;
  updateSkillContent: (key: SkillKey, content: string) => { ok: boolean; error?: string };

  // confidentiality
  recordPiiReveal: (candidateId: string) => void;

  // API keys + access control
  saveApiKey: (input: {
    name: string;
    provider: ApiKeyProvider;
    value: string;
  }) => Promise<{ ok: boolean; key?: ApiKey; demo?: boolean; error?: string }>;
  testApiKey: (id: string) => Promise<{ ok: boolean; valid: boolean; detail: string }>;
  removeApiKey: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setCurrentRole: (role: Role) => void;

  // guardrails & Aria
  updateAriaPrompt: (text: string) => void;
  addGuardrailRule: (text: string) => void;
  toggleGuardrailRule: (id: string) => void;
  removeGuardrailRule: (id: string) => void;
  askAria: (instruction: string) => { reply: string };
  /** Aria Command — sequences the real store actions behind a previewed,
   *  step-by-step plan (see src/lib/aria-command.ts + command-console.tsx).
   *  `onStep` fires "running" then "done"/"failed" (with a real result count)
   *  for each step in order. Never sends: every draft it creates lands in the
   *  same Draft/Needs-Approval queue as every other drafting path, still
   *  gated by the human approval gate — this only composes existing actions. */
  runAriaPlan: (
    plan: AriaPlan,
    onStep?: (
      i: number,
      status: "running" | "done" | "failed",
      result?: { count?: number; detail?: string },
    ) => void,
  ) => Promise<void>;

  // LLM providers
  addProvider: (p: Omit<LlmProvider, "id">) => LlmProvider;
  updateProvider: (id: string, patch: Partial<LlmProvider>) => void;
  removeProvider: (id: string) => void;
  setDefaultProvider: (id: string) => void;

  // MCP servers (external tool sources)
  addMcpServer: (m: Omit<McpServerConfig, "id" | "status">) => McpServerConfig;
  updateMcpServer: (id: string, patch: Partial<McpServerConfig>) => void;
  removeMcpServer: (id: string) => void;
  testMcpServer: (id: string) => Promise<{ ok: boolean; toolCount?: number; error?: string }>;

  // Dust (dust.tt) agent-platform integration
  testDustConnection: (
    workspaceId: string,
    apiKey: string,
    region?: DustRegion,
  ) => Promise<{ ok: boolean; agents?: DustAgentSummary[]; error?: string }>;
  connectDust: (workspaceId: string, apiKey: string, region?: DustRegion) => Promise<{ ok: boolean; error?: string }>;
  updateDustAgentLock: (task: DustTask, agentSId: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectDust: () => Promise<{ ok: boolean; error?: string }>;
  runDustTask: (task: DustTask, message: string) => Promise<{ ok: boolean; text?: string; agentId?: string; error?: string }>;

  // Saved models
  addModel: (m: Omit<SavedModel, "id">) => SavedModel;
  updateModel: (id: string, patch: Partial<SavedModel>) => void;
  removeModel: (id: string) => void;
  setModelDefaultForTask: (id: string, task: ModelTask) => void;

  // Tools
  toggleTool: (toolId: ToolId) => void;

  // Per-agent LLM assignment
  assignAgentProvider: (seatId: string, providerId: string) => void;
  assignAgentModel: (seatId: string, modelId: string) => void;
  assignAgentTools: (seatId: string, toolIds: ToolId[]) => void;

  // misc
  logActivity: (a: Omit<Activity, "id" | "createdAt"> & { createdAt?: string }) => void;
  resetDemo: () => void;

  // chat
  createChatThread: (seatId: string) => ChatThread;
  deleteChatThread: (id: string) => void;
  /** Empty a thread's message history in place (keeps the thread/id). */
  clearChatThread: (id: string) => void;
  appendChatMessage: (threadId: string, msg: ChatMessage) => void;
  updateChatMessage: (threadId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  sendChat: (threadId: string, text: string) => Promise<void>;
  /** Abort an in-flight sendChat for the given thread (call on unmount / thread delete). */
  cancelChat: (threadId: string) => void;

  // schedules
  addSchedule: (job: Omit<CronJob, "id" | "createdAt" | "lastRunAt">) => CronJob;
  updateSchedule: (id: string, patch: Partial<Omit<CronJob, "id" | "createdAt">>) => void;
  removeSchedule: (id: string) => void;
  toggleSchedule: (id: string) => void;

  // interviewers (real registered staff — replaces the old hardcoded mock roster)
  addInterviewer: (input: { name: string; email: string; role?: string }) => Interviewer;
  updateInterviewer: (id: string, patch: Partial<Omit<Interviewer, "id">>) => void;
  removeInterviewer: (id: string) => void;
}
export interface HermesContextValue {
  state: HermesState | null;
  hydrated: boolean;
  workspaceStatus: WorkspaceStatus;
  retryWorkspace: () => Promise<void>;
  retrySave: () => Promise<void>;
  actions: HermesActions;
  /** Computed once per state change (not per consumer) — the TopBar bell and
   *  the dashboard AttentionPanel both read this instead of independently
   *  re-running deriveRecommendations on every render. */
  recommendations: Recommendation[];
}
