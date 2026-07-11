"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  candidateConfirmationEmail,
  classifyReply,
  createBooking,
  generateOutreach,
  generateWeeklyReport,
  interviewerPrepEmail,
  newOutreachMessage,
  sourceCandidates,
  mapGithubCandidates,
  mapWebSearchCandidates,
  mapApolloCandidates,
  mapSeamlessCandidates,
  type GeneratedOutreach,
  type ReplyClassification,
  type SourceResult,
} from "./mock-ai";
import type { GithubUser } from "./sourcing/github";
import { ensureWebQueryScope, isWebSearchPlatform, type WebLead } from "./sourcing/web-leads";
import type { SillageProfile } from "./sourcing/sillage";
import type { ApolloPerson } from "./sourcing/apollo";
import type { SeamlessContact, SeamlessResearchContact } from "./sourcing/seamless";
import { roleProfile } from "./roles";
import {
  buildOutreachPrompt,
  hermesAvailable,
  hermesGenerate,
  parseHermesOutreach,
} from "./ai/hermes";
import { resolveAiProvider } from "./ai/provider";
import {
  candidateDisclosureContextForCampaignLike,
  detectInjection,
  validateCandidateBoundText,
} from "./agent-disclosure-policy";
import { emit } from "./agent-events";
import { buildSeedState, defaultGuardrails, defaultLlmProviders, defaultSavedModels, defaultTools, STATE_VERSION } from "./seed";
import {
  computeCampaignMetrics,
  firstInterviewElapsedHours,
  globalKpis,
  realFunnelFacts,
  type GlobalKpis,
} from "./metrics";
import { deriveRecommendations, deriveFollowUpsDue, type Recommendation, type FollowUpDueItem } from "./recommendations";
import { scoreCandidate } from "./scoring";
import { deriveStarRating } from "./tania";
import {
  checkOutreachApproval,
  dedupeCandidates,
  type ApprovalResult,
} from "./rules";
import { matchCandidateByEmail } from "./email-match";
import { validateMcpBaseUrl } from "./mcp-auth-params";
import {
  defaultLiveIntegrations,
  testConnection,
  type ConnectionTestResult,
} from "./integrations";
import { interviewerIsBusy, resolveBookingSlot } from "./store/booking-slot";
import { loadState, normalizeHermesState } from "./store/migrations";
import { baseWebQuery, mapSillageCandidates, parseSillageIdentifier } from "./store/sourcing-helpers";
import { appendWinRecord } from "./store/winlog-derive";
import type {
  Activity,
  AgentSeat,
  AgentSkill,
  AllocationResult,
  ApiKey,
  ApiKeyProvider,
  ChatMessage,
  ChatThread,
  CronJob,
  GuardrailRule,
  LlmProvider,
  McpServerConfig,
  MemoryEntry,
  MemoryKind,
  ModelTask,
  Role,
  Booking,
  Campaign,
  Candidate,
  CandidateNote,
  CandidateStage,
  ChatboxSubmission,
  ChatboxSubmissionStatus,
  ClassifiedReply,
  InterviewKind,
  InterviewRecord,
  LeadSource,
  PrequalOutcome,
  PrequalRecord,
  StarRating,
  DustAgentSummary,
  DustRegion,
  DustTask,
  HermesState,
  IntegrationStatus,
  Interviewer,
  JobAnalysis,
  LedgerStatus,
  OutreachChannel,
  OutreachLedgerEntry,
  OutreachMessage,
  OutreachStatus,
  OutreachTone,
  ReplyIntent,
  SavedModel,
  ScoringWeights,
  SkillKey,
  SkillUpdate,
  SourcePlatform,
  SuppressionEntry,
  SystemSettings,
  ToolId,
  WinRecord,
  WeeklyReport,
} from "./types";
import { genId, initialsFrom, isoDaysBefore } from "./utils";
import { createCampaign as buildCampaign } from "./mock-ai";
import { supabaseEnabled } from "./supabase/config";
import { loadRemoteAgentSeats, loadRemoteState, saveRemoteState } from "./supabase/workspace";
import { applyAuthoritativeRole } from "./live-role-authority";
import { allocateBatch, defaultSendWindow, fleetSummary, type FleetSummary } from "./fleet";
import { createFleetSeatOnServer, mergeAgentSeatRows, patchFleetSeatOnServer } from "./fleet-seats";
import {
  applyLearning,
  defaultSkills,
  effectiveTone,
  effectiveWeights,
  getSkill,
  learnedParamsFor,
  proposeSkillUpdates,
} from "./skills";
import { stageRank, withStage } from "./metrics";
import { humanizeText } from "./humanizer";
import { parseCommand, campaignToAriaContext, type AriaPlan } from "./aria-command";
import { recordOutreachApproval, revokeOutreachApproval } from "./outreach-approval";
import { can } from "./rbac";
import {
  normalizeSuppressionValue,
  persistManualSuppression,
  type EnforcedSuppressionType,
} from "./manual-suppression";

export { defaultSlot, interviewerIsBusy, resolveBookingSlot } from "./store/booking-slot";
export { migrateToCurrentVersion, normalizeHermesState } from "./store/migrations";
export { appendWinRecord, deriveWinRecord, WIN_RECORD_LIMIT } from "./store/winlog-derive";

const STORAGE_KEY = "hermes-sourcing:v1";
const ARIA_STRONG_RATINGS: readonly StarRating[] = ["TopGun", "A"];
const ARIA_PERFECT_RATING: StarRating = "TopGun";
const ARIA_STEP_CANDIDATE_CAP = 10;

/* ============================================================================
   Actions contract
   ========================================================================== */

export interface HermesActions {
  // campaigns
  setActiveCampaign: (id: string | null) => void;
  createCampaignFromAnalysis: (
    jd: JobAnalysis,
    meta: { hiringManager: string; hiringManagerEmail: string },
  ) => Campaign;
  updateCampaign: (id: string, patch: Partial<Campaign>) => void;
  regenerateQueries: (id: string) => void;

  // sourcing
  sourceNextBatch: (
    campaignId: string,
    opts?: { platform?: SourcePlatform; count?: number },
  ) => Promise<
    | (SourceResult & { source: "github" | "web" | "mock"; ok: true })
    | { ok: false; error: string; source: "github" | "web" | "paused" }
  >;
  /** One tool-calling agent pass: searches real candidates, scores them, and
   *  drafts outreach for the best matches in a single loop (/api/sourcing-agent),
   *  instead of sourceNextBatch + generateOutreachLive called one at a time.
   *  Requires a cloud provider configured for the "sourcing" task (Anthropic or
   *  an OpenAI-compatible provider — hermes/Kimi don't support tool-calling). */
  runSourcingAgent: (campaignId: string, count?: number) => Promise<{ ok: boolean; added: number; error?: string }>;
  /** Manual intake: resolve one real GitHub user by exact login (via /api/source)
   *  and add them to the campaign — same scoring + dedupe pipeline as
   *  sourceNextBatch, just for a person the operator already has in mind
   *  instead of a search. Never drafts or sends outreach. */
  addCandidateFromGithub: (
    campaignId: string,
    username: string,
  ) => Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }>;
  /** Manual intake, zero network: builds a real Candidate straight from
   *  operator-entered fields (no search, no scraping) and scores it with the
   *  same scoring/dedupe pipeline as every other sourcing path. Labeled
   *  sourcePlatform "Referral" — an honest existing value, not a fabricated
   *  live source. Never drafts or sends outreach. */
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
    },
  ) => { ok: true; added: number; skipped: number } | { ok: false; error: string };
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
  /** Explicit, confirmed, single-candidate Apollo enrichment (costs 1 Apollo
   *  credit on a match, 0 if not found). Never call this for a whole batch. */
  enrichApolloCandidate: (
    candidateId: string,
  ) => Promise<{ ok: boolean; revealed: boolean; detail: string }>;
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
    patch: Partial<Booking>,
  ) => { ok: true } | { ok: false; error: string };

  // reports + learning
  generateReport: (campaignId: string) => WeeklyReport | null;
  setSkillUpdateStatus: (
    campaignId: string,
    skillId: string,
    status: SkillUpdate["status"],
  ) => void;

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
  anonymizeCandidate: (id: string) => void;
  exportCandidate: (id: string) => string;

  // settings + integrations
  updateSettings: (patch: Partial<SystemSettings>) => void;
  updateIntegration: (id: string, patch: Partial<IntegrationStatus>) => void;
  toggleIntegrationMode: (id: string) => void;
  testIntegration: (id: string) => Promise<ConnectionTestResult>;

  // fleet — multi-seat coordination + anti-ban guardrails
  addSeat: (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => Promise<AgentSeat | null>;
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
  runFleetSourcing: (opts?: { campaignId?: string; perAgent?: number }) => {
    sourced: number;
    skipped: number;
    perSeat: { seatName: string; campaignTitle: string; sourced: number }[];
  };

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

  // memory
  addMemory: (seatId: string, kind: MemoryKind, content: string) => MemoryEntry;
  updateMemory: (id: string, patch: Partial<Pick<MemoryEntry, "kind" | "content" | "pinned">>) => void;
  removeMemory: (id: string) => void;
  togglePinMemory: (id: string) => void;

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

interface HermesContextValue {
  state: HermesState | null;
  hydrated: boolean;
  actions: HermesActions;
  /** Computed once per state change (not per consumer) — the TopBar bell and
   *  the dashboard AttentionPanel both read this instead of independently
   *  re-running deriveRecommendations on every render. */
  recommendations: Recommendation[];
}

const HermesContext = createContext<HermesContextValue | null>(null);

/* ============================================================================
   Provider
   ========================================================================== */

function githubLocationQualifier(location: string | undefined, query: string): string {
  if (!location?.trim() || /(?:^|\s)location:/i.test(query)) return "";
  const city = location.split(",")[0]?.trim();
  return city ? ` location:"${city}"` : "";
}

/**
 * Shared live-generation attempt for follow-up / re-contact drafts — the same
 * three-layer fallback generateOutreachLive/regenerateOutreach already use (a
 * cloud provider or hermes live mode configured -> hermesGenerate -> parse ->
 * humanize). Without this, draftFollowUpFor/draftRecontactFor always fell
 * straight to the mock template, so every follow-up touch for a candidate was
 * byte-identical copy. Returns the mock unchanged (live: false) on any
 * failure at any layer — a follow-up draft always lands regardless.
 */
async function attemptLiveFollowUpGen(opts: {
  settings: SystemSettings;
  candidate: Candidate;
  campaign: Campaign;
  tone: OutreachTone;
  channel: OutreachChannel;
  voice?: { persona?: string; signature?: string };
  lang: string;
  mockGen: GeneratedOutreach;
  seat?: AgentSeat;
  touchNote: string;
}): Promise<{ gen: GeneratedOutreach; live: boolean }> {
  const { settings, candidate, campaign, tone, channel, voice, lang, mockGen, seat, touchNote } = opts;
  const aiCfg = resolveAiProvider(settings, "outreach", {
    providerId: seat?.providerId,
    modelId: seat?.modelId,
  });
  if (!aiCfg && !(settings.hermesLiveMode && hermesAvailable(settings))) {
    return { gen: mockGen, live: false };
  }

  const basePrompt = buildOutreachPrompt({
    candidateName: candidate.name,
    candidateTitle: candidate.currentTitle,
    candidateCompany: candidate.currentCompany,
    techStack: candidate.techStack,
    recentActivity: candidate.recentActivity,
    yearsExperience: candidate.yearsExperience,
    roleTitle: campaign.jobAnalysis.title,
    locationType: campaign.jobAnalysis.locationType,
    regions: campaign.jobAnalysis.regions,
    requiredSkills: campaign.jobAnalysis.requiredSkills,
    roleContext: candidateDisclosureContextForCampaignLike(campaign),
    tone,
    channel,
    language: lang,
    persona: voice?.persona,
    signature: voice?.signature,
  });
  const ariaPrompt = settings.guardrails?.ariaPrompt;
  const guardrails = [ariaPrompt, touchNote].filter(Boolean).join("\n\n");
  const prompt = guardrails ? `${guardrails}\n\n${basePrompt}` : basePrompt;

  let genInput: Parameters<typeof hermesGenerate>[0];
  if (aiCfg) {
    genInput = { task: "outreach", prompt, provider: aiCfg.provider, model: aiCfg.model, apiKeyId: aiCfg.apiKeyId };
  } else {
    const outreachModelId = seat?.modelId ?? settings.defaultModels?.outreach;
    genInput = {
      task: "outreach",
      prompt,
      hermesApiUrl: settings.hermesApiUrl,
      hermesApiKeyId: settings.hermesApiKeyId,
    };
    if (outreachModelId) {
      const modelName = (settings.savedModels ?? []).find((m) => m.id === outreachModelId)?.modelName;
      if (modelName) genInput.model = modelName;
    }
  }

  const result = await hermesGenerate(genInput);
  if (result.ok && result.text) {
    const parsed = parseHermesOutreach(result.text, channel, mockGen.subject);
    if (parsed) {
      return {
        gen: {
          subject: humanizeText(parsed.subject),
          body: humanizeText(parsed.body),
          personalizationEvidence: mockGen.personalizationEvidence,
          channel,
        },
        live: true,
      };
    }
  }
  return { gen: mockGen, live: false };
}

export function HermesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HermesState | null>(null);
  const stateRef = useRef<HermesState | null>(null);
  stateRef.current = state;
  const workspaceIdRef = useRef<string>("");
  // Optimistic-concurrency token: the workspace_state.updated_at we last loaded/saved.
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const liveRoleRef = useRef<Role>("viewer");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // DEMO mode only: latest state snapshot awaiting a debounced localStorage write,
  // so flushLocalSave() can write it immediately on unmount / tab close.
  const pendingLocalSave = useRef<HermesState | null>(null);
  const skipNextPersist = useRef(false);
  // F-5: AbortControllers for in-flight sendChat requests, keyed by threadId.
  const chatAbortControllers = useRef<Map<string, AbortController>>(new Map());
  // Approval persistence is authoritative in live mode. Keep a per-draft lock
  // so a double-click cannot create a second ledger entry while the request is
  // in flight.
  const pendingOutreachApprovals = useRef<Set<string>>(new Set());

  // Flush a pending debounced DEMO-mode localStorage write immediately. Called on
  // provider unmount and on `beforeunload` so debouncing the persist effect (below)
  // never drops the last edit made just before navigation / tab close.
  const flushLocalSave = useCallback(() => {
    if (supabaseEnabled) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingLocalSave.current;
    if (pending) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
      } catch {
        /* quota / private mode — ignore for demo */
      }
      pendingLocalSave.current = null;
    }
  }, []);

  useEffect(() => {
    if (supabaseEnabled) return;
    window.addEventListener("beforeunload", flushLocalSave);
    return () => {
      window.removeEventListener("beforeunload", flushLocalSave);
      flushLocalSave();
    };
  }, [flushLocalSave]);

  // Hydrate once on mount.
  // LIVE mode → load the shared workspace document from Supabase (seed if empty).
  // DEMO mode → load from localStorage (no login, fully client-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabaseEnabled) {
        const remote = await loadRemoteState();
        if (cancelled) return;
        if (remote) {
          workspaceIdRef.current = remote.workspaceId;
          remoteUpdatedAtRef.current = remote.updatedAt;
          liveRoleRef.current = remote.role;
          if (remote.state) {
            skipNextPersist.current = true; // don't re-save what we just loaded
            // D-1: run migration when the persisted version is behind current.
            const loaded = normalizeHermesState(remote.state);
            const serverSeats = await loadRemoteAgentSeats();
            const liveState = serverSeats ? { ...loaded, seats: mergeAgentSeatRows(loaded.seats, serverSeats) } : loaded;
            setState(applyAuthoritativeRole(liveState, remote.role));
          } else {
            const seededBase = buildLiveEmptyState();
            const serverSeats = await loadRemoteAgentSeats();
            const seeded = applyAuthoritativeRole(
              serverSeats ? { ...seededBase, seats: mergeAgentSeatRows(seededBase.seats, serverSeats) } : seededBase,
              remote.role,
            );
            setState(seeded);
            if (remote.workspaceId) {
              void saveRemoteState(remote.workspaceId, seeded, null).then((res) => {
                if (res.ok && res.updatedAt) remoteUpdatedAtRef.current = res.updatedAt;
              });
            }
          }
          return;
        }
        // A live auth-null/error path must never fall through to localStorage,
        // whose demo seed is admin. Keep the shell read-only until auth recovers.
        setState(applyAuthoritativeRole(buildLiveEmptyState(), "viewer"));
        return;
      }
      setState(loadState());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (debounced upsert in LIVE mode, synchronous in DEMO mode).
  useEffect(() => {
    if (!state) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    if (supabaseEnabled) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const wid = workspaceIdRef.current;
      const snapshot = state;
      saveTimer.current = setTimeout(() => {
        if (!wid) return;
        void (async () => {
          const res = await saveRemoteState(wid, snapshot, remoteUpdatedAtRef.current);
          if (res.ok) {
            if (res.updatedAt) remoteUpdatedAtRef.current = res.updatedAt;
          } else if (res.conflict && res.latest) {
            // A teammate saved since we loaded. Reload their latest so nothing is
            // silently clobbered; record it in the activity log so the operator
            // knows their last unsaved edit was dropped and can reapply it.
            remoteUpdatedAtRef.current = res.latest.updatedAt;
            const latestState = res.latest.state;
            if (latestState) {
              skipNextPersist.current = true;
              const migrated = normalizeHermesState(latestState);
              const serverSeats = await loadRemoteAgentSeats();
              const liveState = serverSeats ? { ...migrated, seats: mergeAgentSeatRows(migrated.seats, serverSeats) } : migrated;
              const notice: Activity = {
                id: genId("act"),
                type: "system",
                title: "Workspace reloaded from your team",
                notes:
                  "A teammate saved a change at the same moment, so the latest shared version was loaded. Reapply your last edit if it is missing.",
                outcome: "Reloaded",
                campaignId: null,
                linkedEntityType: null,
                linkedEntityId: null,
                createdAt: new Date().toISOString(),
              };
              setState(applyAuthoritativeRole(
                { ...liveState, activities: [notice, ...liveState.activities].slice(0, 300) },
                liveRoleRef.current,
              ));
            }
          } else {
            // Non-conflict save failure (network / quota). Retry once shortly so a blip
            // on the last edit before the user stops typing doesn't silently lose the
            // write (the debounce otherwise only re-saves on the next state change).
            setTimeout(() => {
              void saveRemoteState(wid, snapshot, remoteUpdatedAtRef.current).then((r) => {
                if (r.ok && r.updatedAt) remoteUpdatedAtRef.current = r.updatedAt;
              });
            }, 2500);
          }
        })();
      }, 600);
    } else {
      // Debounced like the Supabase branch above (same 600ms interval / saveTimer ref)
      // instead of writing to localStorage synchronously on every state change.
      pendingLocalSave.current = state;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        flushLocalSave();
      }, 600);
    }
  }, [state, flushLocalSave]);

  const commit = useCallback((fn: (s: HermesState) => HermesState) => {
    setState((prev) => {
      const base = prev ?? stateRef.current;
      if (!base) return prev;
      const next = fn(base);
      stateRef.current = next;
      return next;
    });
  }, []);

  const current = useCallback(
    () => stateRef.current ?? (supabaseEnabled ? buildLiveEmptyState() : buildSeedState()),
    [],
  );

  /* ---- helpers ---------------------------------------------------------- */

  const makeActivity = (
    a: Omit<Activity, "id" | "createdAt"> & { createdAt?: string },
  ): Activity => ({
    id: genId("act"),
    createdAt: a.createdAt ?? new Date().toISOString(),
    ...a,
  });

  const withActivity = (s: HermesState, a: Activity, campaignId: string | null): HermesState => {
    const campaigns = campaignId
      ? s.campaigns.map((c) =>
          c.id === campaignId
            ? { ...c, activities: [a, ...c.activities].slice(0, 80) }
            : c,
        )
      : s.campaigns;
    return { ...s, campaigns, activities: [a, ...s.activities].slice(0, 300) };
  };

  const recomputeMetrics = (s: HermesState, campaignId: string): HermesState => {
    const cands = s.candidates.filter((c) => c.campaignId === campaignId);
    const campaign = s.campaigns.find((c) => c.id === campaignId);
    // Elapsed time from campaign creation to the first *scheduled* interview
    // (shared with seed.ts via firstInterviewElapsedHours so live and seeded
    // campaigns report the same KPI meaning — see metrics.ts).
    const firstInterviewHours = campaign
      ? firstInterviewElapsedHours(
          s.bookings.filter((b) => b.campaignId === campaignId),
          campaign.createdAt,
        )
      : null;
    return {
      ...s,
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              metrics: computeCampaignMetrics(
                cands,
                c.metrics,
                firstInterviewHours,
                realFunnelFacts(s, { live: !s.settings.dryRunMode, campaignId }),
              ),
            }
          : c,
      ),
    };
  };

  /* ---- actions ---------------------------------------------------------- */

  const setActiveCampaign = useCallback(
    (id: string | null) => commit((s) => ({ ...s, activeCampaignId: id })),
    [commit],
  );

  const logActivity = useCallback(
    (a: Omit<Activity, "id" | "createdAt"> & { createdAt?: string }) =>
      commit((s) => withActivity(s, makeActivity(a), a.campaignId ?? null)),
    [commit],
  );

  const createCampaignFromAnalysis = useCallback(
    (jd: JobAnalysis, meta: { hiringManager: string; hiringManagerEmail: string }) => {
      const campaign = buildCampaign(jd, meta);
      commit((s) => {
        let next: HermesState = {
          ...s,
          campaigns: [campaign, ...s.campaigns],
          activeCampaignId: campaign.id,
        };
        next = withActivity(
          next,
          makeActivity({
            type: "campaign",
            title: "Campaign created",
            notes: `Created “${campaign.title}” from parsed intake.`,
            outcome: "Sourcing strategy generated",
            campaignId: campaign.id,
            linkedEntityType: "campaign",
            linkedEntityId: campaign.id,
          }),
          campaign.id,
        );
        return next;
      });
      return campaign;
    },
    [commit],
  );

  const updateCampaign = useCallback(
    (id: string, patch: Partial<Campaign>) =>
      commit((s) => {
        const existing = s.campaigns.find((c) => c.id === id);
        if (!existing) return s;
        const merged: Campaign = { ...existing, ...patch };
        let next: HermesState = {
          ...s,
          campaigns: s.campaigns.map((c) => (c.id === id ? merged : c)),
        };

        // Reactive re-score: editing the JD or scoring weights silently re-ranks
        // existing candidates (via the recommendation queue's match-score input)
        // instead of leaving them frozen at their original sourcing-time score.
        // Adaptive, not autonomous -- it reacts to a human's own edit here; it
        // never touches anything already approved/sent/booked, and never sends.
        if (patch.jobAnalysis || patch.scoringWeights) {
          const weights = effectiveWeights(merged.scoringWeights, s.skills);
          const affected = next.candidates.filter((c) => c.campaignId === id);
          next = {
            ...next,
            candidates: next.candidates.map((c) => {
              if (c.campaignId !== id) return c;
              const { score, breakdown } = scoreCandidate(c, merged.jobAnalysis, weights);
              return { ...c, matchScore: score, matchBreakdown: breakdown };
            }),
          };
          next = recomputeMetrics(next, id);
          if (affected.length > 0) {
            next = withActivity(
              next,
              makeActivity({
                type: "score",
                title: "Candidates re-scored",
                notes: `${affected.length} candidate${affected.length === 1 ? "" : "s"} re-scored after the JD/weights update.`,
                outcome: "Priority queue updated",
                campaignId: id,
                linkedEntityType: "campaign",
                linkedEntityId: id,
              }),
              id,
            );
          }
        }

        return next;
      }),
    [commit],
  );

  const regenerateQueries = useCallback(
    (id: string) =>
      commit((s) => {
        const campaign = s.campaigns.find((c) => c.id === id);
        if (!campaign) return s;
        const extra = {
          label: `Adjacent: ${campaign.jobAnalysis.requiredSkills[1] ?? "stack"} maintainers`,
          query: `language:${(campaign.jobAnalysis.requiredSkills[1] ?? "go").replace(/\s+/g, "")} sort:updated location:${campaign.jobAnalysis.regions[0] ?? "EU"} forks:>5`,
          estimatedResults: 80 + Math.round((campaign.metrics.sourced + 1) * 3.5),
        };
        const next = {
          ...s,
          campaigns: s.campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  sourcingStrategy: {
                    ...c.sourcingStrategy,
                    githubQueries: [...c.sourcingStrategy.githubQueries, extra],
                  },
                }
              : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: "Generated additional query",
            notes: extra.query,
            outcome: `~${extra.estimatedResults} estimated results`,
            campaignId: id,
            linkedEntityType: "campaign",
            linkedEntityId: id,
          }),
          id,
        );
      }),
    [commit],
  );

  const sourceNextBatch = useCallback(
    async (
      campaignId: string,
      opts?: { platform?: SourcePlatform; count?: number },
    ): Promise<
      | (SourceResult & { source: "github" | "web" | "mock"; ok: true })
      | { ok: false; error: string; source: "github" | "web" | "paused" }
    > => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { accepted: [], skipped: [], source: "mock", ok: true };
      if (campaign.status === "Paused") {
        return { ok: false, error: "Campaign is paused.", source: "paused" };
      }
      const platform: SourcePlatform = opts?.platform ?? roleProfile(campaign.jobAnalysis).platforms[0];
      const count = opts?.count ?? 6;
      const weights = effectiveWeights(campaign.scoringWeights, s.skills); // learned scoring

      let result: SourceResult = { accepted: [], skipped: [] };
      let source: "github" | "web" | "mock" = "mock";

      // Try REAL sourcing first, on whichever backend the platform actually has:
      // GitHub via its Search API, everything else with a real presence (LinkedIn,
      // Stack Overflow, Dribbble, Behance) via site:-scoped web search. Both run
      // keyless by default. Once a real attempt runs, its result is authoritative
      // even at zero hits — no synthetic backfill. A failed real attempt is a
      // genuine error, surfaced to the caller — never silently backfilled with
      // synthetic profiles. Talent Pool / Referral are internal-pipeline concepts
      // with no external source, so they stay synthetic (demo mode).
      if (platform === "GitHub") {
        const baseQuery =
          campaign.sourcingStrategy.githubQueries[0]?.query ??
          `language:${(campaign.jobAnalysis.requiredSkills[0] ?? "typescript").toLowerCase()}`;
        const query = `${baseQuery}${githubLocationQualifier(campaign.jobAnalysis.location, baseQuery)}`;
        try {
          const res = await fetch("/api/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, count, platform }),
          });
          const out = (await res.json().catch(() => null)) as
            | { ok?: boolean; source?: string; users?: GithubUser[]; error?: string }
            | null;
          if (out?.ok && out.source === "github") {
            result =
              out.users && out.users.length > 0
                ? mapGithubCandidates(out.users, campaign, query, s.candidates, weights)
                : { accepted: [], skipped: [] };
            source = "github";
          } else {
            return { ok: false, error: out?.error ?? "GitHub sourcing failed.", source: "github" };
          }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Network error reaching GitHub sourcing.",
            source: "github",
          };
        }
      } else if (isWebSearchPlatform(platform)) {
        const query = ensureWebQueryScope(platform, baseWebQuery(campaign, platform));
        try {
          const res = await fetch("/api/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, count, platform }),
          });
          const out = (await res.json().catch(() => null)) as
            | { ok?: boolean; source?: string; leads?: WebLead[]; error?: string }
            | null;
          if (out?.ok && out.source === "web") {
            result =
              out.leads && out.leads.length > 0
                ? mapWebSearchCandidates(out.leads, campaign, query, platform, s.candidates, weights)
                : { accepted: [], skipped: [] };
            source = "web";
          } else {
            return { ok: false, error: out?.error ?? "Web sourcing failed.", source: "web" };
          }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Network error reaching web sourcing.",
            source: "web",
          };
        }
      } else {
        // Referral / Talent Pool: internal-pipeline concepts, no external source to
        // search — synthetic by design, not a fallback from a failed live attempt.
        result = sourceCandidates(campaign, platform, count, s.candidates, s.candidates.length, weights);
      }

      commit((prev) => {
        let next: HermesState = {
          ...prev,
          candidates: [...result.accepted, ...prev.candidates],
        };
        next = recomputeMetrics(next, campaignId);
        const liveLabel = source === "github" ? "Live GitHub" : source === "web" ? `Live ${platform} search` : `${platform} synthetic`;
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Sourced ${result.accepted.length} candidates`,
            notes: `${liveLabel} batch. ${result.skipped.length} skipped by dedupe (${result.skipped
              .slice(0, 3)
              .map((x) => x.reason)
              .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
            outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped${source !== "mock" ? " (live)" : ""}`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      emit({ kind: "source", campaignId, count: result.accepted.length });
      return { ...result, source, ok: true };
    },
    [commit, current],
  );

  const addCandidateFromGithub = useCallback(
    async (
      campaignId: string,
      username: string,
    ): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };
      const login = username.trim();
      if (!login) return { ok: false, error: "GitHub username is required." };
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);

      let res: Response;
      try {
        res = await fetch("/api/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: login, platform: "GitHub", count: 1 }),
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching GitHub." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; source?: string; users?: GithubUser[]; error?: string }
        | null;
      if (!out?.ok || out.source !== "github") {
        return { ok: false, error: out?.error ?? "GitHub lookup failed." };
      }
      const users = out.users ?? [];
      if (users.length === 0) return { ok: false, error: "GitHub user not found." };

      const { accepted, skipped } = mapGithubCandidates(users, campaign, `@${login}`, s.candidates, weights);

      commit((prev) => {
        let next: HermesState = { ...prev, candidates: [...accepted, ...prev.candidates] };
        next = recomputeMetrics(next, campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: accepted.length ? `Added @${login} from GitHub` : `@${login} already in pipeline`,
            notes: accepted.length
              ? "Manually added a specific GitHub profile (not a search)."
              : `Skipped by dedupe (${skipped[0]?.reason ?? "duplicate"}).`,
            outcome: accepted.length ? "1 accepted" : "0 accepted, 1 skipped",
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      emit({ kind: "source", campaignId, count: accepted.length });
      return { ok: true, added: accepted.length, skipped: skipped.length };
    },
    [commit, current],
  );

  const addCandidateManual = useCallback(
    (
      campaignId: string,
      input: {
        name: string;
        title?: string;
        skills?: string[];
        profileUrl?: string;
        email?: string;
        location?: string;
        notes?: string;
      },
    ): { ok: true; added: number; skipped: number } | { ok: false; error: string } => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Name is required." };

      const jd = campaign.jobAnalysis;
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const noteText = input.notes?.trim();

      // Same construction as mapGithubCandidates/mapWebSearchCandidates: a real
      // profile, honestly blank wherever the operator didn't supply a value —
      // no fabricated company/timezone/tenure. sourcePlatform "Referral" is the
      // least-invasive existing SourcePlatform value for a hand-entered lead;
      // sourceUrl is the same generic "canonical URL, no dedicated field" slot
      // mapWebSearchCandidates uses.
      const raw: Candidate = {
        id: genId("cand"),
        campaignId,
        name,
        email: input.email?.trim() ?? "",
        avatarInitials: initialsFrom(name),
        currentTitle: input.title?.trim() || jd.title,
        currentCompany: "",
        location: input.location?.trim() ?? "",
        timezone: "",
        linkedinUrl: "",
        githubUrl: "",
        sourceUrl: input.profileUrl?.trim() || undefined,
        sourcePlatform: "Referral",
        sourceQuery: "Manually added by operator",
        matchScore: 0,
        matchBreakdown: [],
        techStack: Array.from(new Set((input.skills ?? []).map((sk) => sk.trim()).filter(Boolean))),
        yearsExperience: jd.minYearsExperience ?? (jd.seniority === "Senior" ? 6 : 4),
        companyStageExperience: [],
        industryExperience: [],
        recentActivity: "Manually added, no activity signal available.",
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
        provenance: "live",
        notes: noteText ? [{ id: genId("note"), text: noteText, at: new Date().toISOString() }] : undefined,
      };

      const { accepted, skipped } = dedupeCandidates([raw], s.candidates, {
        excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
      });
      const scored = accepted.map((cand) => {
        const { score, breakdown } = scoreCandidate(cand, jd, weights);
        return { ...cand, matchScore: score, matchBreakdown: breakdown };
      });

      commit((prev) => {
        let next: HermesState = { ...prev, candidates: [...scored, ...prev.candidates] };
        next = recomputeMetrics(next, campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: scored.length ? `Added ${name} manually` : `${name} already in pipeline`,
            notes: scored.length
              ? "Manually entered candidate, no external search involved."
              : `Skipped by dedupe (${skipped[0]?.reason ?? "duplicate"}).`,
            outcome: scored.length ? "1 accepted" : "0 accepted, 1 skipped",
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      if (scored.length > 0) emit({ kind: "source", campaignId, count: scored.length });
      return { ok: true, added: scored.length, skipped: skipped.length };
    },
    [commit, current],
  );

  const startSillageMapping = useCallback(
    async (
      campaignId: string,
      identifier: string,
    ): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };
      const trimmed = identifier.trim();
      if (!trimmed) return { ok: false, error: "Enter a company domain or LinkedIn URL." };

      let res: Response;
      try {
        res = await fetch("/api/source/sillage/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, ...parseSillageIdentifier(trimmed) }),
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching Sillage." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; requestId?: string; error?: string }
        | null;
      if (!out?.ok || !out.requestId) {
        return { ok: false, error: out?.error ?? "Sillage enrichment failed to start." };
      }
      return { ok: true, requestId: out.requestId };
    },
    [current],
  );

  const checkSillageMapping = useCallback(
    async (
      campaignId: string,
      requestId: string,
    ): Promise<
      | { ok: true; status: "processing" }
      | { ok: true; status: "completed"; added: number; company: string }
      | { ok: false; error: string }
    > => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };

      let res: Response;
      try {
        res = await fetch(`/api/source/sillage/status?requestId=${encodeURIComponent(requestId)}`);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching Sillage." };
      }
      const out = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            status?: string;
            error?: string;
            company?: { name?: string };
            profiles?: SillageProfile[];
          }
        | null;
      if (!out?.ok) return { ok: false, error: out?.error ?? "Sillage status check failed." };
      if (out.status === "processing") return { ok: true, status: "processing" };
      if (out.status !== "completed") return { ok: false, error: out.error ?? "Sillage enrichment did not complete." };

      const companyLabel = out.company?.name || "this company";
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const { accepted, skipped } = mapSillageCandidates(
        out.profiles ?? [],
        campaign,
        companyLabel,
        s.candidates,
        weights,
      );

      commit((prev) => {
        let next: HermesState = { ...prev, candidates: [...accepted, ...prev.candidates] };
        next = recomputeMetrics(next, campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Sourced ${accepted.length} candidates via Sillage account mapping: ${companyLabel}`,
            notes: `Live Sillage batch. ${skipped.length} skipped by dedupe (${skipped
              .slice(0, 3)
              .map((x) => x.reason)
              .join(", ")}${skipped.length > 3 ? "…" : ""}).`,
            outcome: `${accepted.length} accepted, ${skipped.length} skipped (live)`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      if (accepted.length > 0) emit({ kind: "source", campaignId, count: accepted.length });
      return { ok: true, status: "completed", added: accepted.length, company: companyLabel };
    },
    [commit, current],
  );

  const sourceFromApollo = useCallback(
    async (
      campaignId: string,
      filters: {
        titles?: string[];
        seniorities?: string[];
        locations?: string[];
        organizationDomains?: string[];
        keywords?: string;
        count?: number;
      },
    ): Promise<SourceResult & { source: "apollo" | "not_configured" | "error"; error?: string }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { accepted: [], skipped: [], source: "error", error: "Campaign not found." };
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const count = filters.count ?? 10;
      const queryLabel =
        [
          filters.titles?.length ? `titles:${filters.titles.join("|")}` : null,
          filters.seniorities?.length ? `seniority:${filters.seniorities.join("|")}` : null,
          filters.locations?.length ? `loc:${filters.locations.join("|")}` : null,
          filters.organizationDomains?.length ? `domains:${filters.organizationDomains.join("|")}` : null,
          filters.keywords ? `kw:${filters.keywords}` : null,
        ]
          .filter(Boolean)
          .join(" ") || "Apollo search";

      let result: SourceResult = { accepted: [], skipped: [] };
      let source: "apollo" | "not_configured" | "error" = "error";
      let error: string | undefined;

      try {
        const res = await fetch("/api/source/apollo/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filters, count }),
        });
        const out = (await res.json().catch(() => null)) as
          | { ok?: boolean; source?: string; people?: ApolloPerson[]; error?: string }
          | null;
        if (out?.ok && out.source === "apollo") {
          result =
            out.people && out.people.length > 0
              ? mapApolloCandidates(out.people, campaign, queryLabel, s.candidates, weights)
              : { accepted: [], skipped: [] };
          source = "apollo";
        } else if (out?.source === "not_configured") {
          source = "not_configured";
          error = out.error ?? "Add an Apollo key in Settings to source real candidates.";
        } else {
          source = "error";
          error = out?.error ?? "Apollo search failed.";
        }
      } catch (e) {
        source = "error";
        error = e instanceof Error ? e.message : "Network error.";
      }

      if (result.accepted.length > 0) {
        commit((prev) => {
          let next: HermesState = {
            ...prev,
            candidates: [...result.accepted, ...prev.candidates],
          };
          next = recomputeMetrics(next, campaignId);
          next = withActivity(
            next,
            makeActivity({
              type: "sourcing",
              title: `Sourced ${result.accepted.length} candidates via Apollo`,
              notes: `Live Apollo batch. ${result.skipped.length} skipped by dedupe (${result.skipped
                .slice(0, 3)
                .map((x) => x.reason)
                .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
              outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped (live)`,
              campaignId,
              linkedEntityType: "campaign",
              linkedEntityId: campaignId,
            }),
            campaignId,
          );
          return next;
        });
        emit({ kind: "source", campaignId, count: result.accepted.length });
      }
      return { ...result, source, error };
    },
    [commit, current],
  );

  const enrichApolloCandidate = useCallback(
    async (candidateId: string): Promise<{ ok: boolean; revealed: boolean; detail: string }> => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, revealed: false, detail: "Candidate not found." };
      if (cand.sourcePlatform !== "Apollo" || !cand.sourceExternalId) {
        return { ok: false, revealed: false, detail: "Not an Apollo-sourced candidate." };
      }
      try {
        const res = await fetch("/api/source/apollo/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apolloId: cand.sourceExternalId }),
        });
        const out = (await res.json().catch(() => null)) as
          | { ok?: boolean; source?: string; email?: string; phone?: string; error?: string; detail?: string }
          | null;
        if (!out?.ok || (out.source !== "apollo" && out.source !== "not_configured")) {
          return { ok: false, revealed: false, detail: out?.error ?? "Apollo enrichment failed." };
        }
        if (out.source === "not_configured") {
          return { ok: false, revealed: false, detail: out.error ?? "No Apollo key configured." };
        }
        const email = out.email ?? "";
        const phone = out.phone ?? "";
        if (!email && !phone) {
          return { ok: true, revealed: false, detail: out.detail ?? "No contact details found (0 credits charged)." };
        }
        commit((prev) => {
          const next: HermesState = {
            ...prev,
            candidates: prev.candidates.map((c) =>
              c.id === candidateId ? { ...c, email: email || c.email, phone: phone || c.phone } : c,
            ),
          };
          return withActivity(
            next,
            makeActivity({
              type: "sourcing",
              title: `Enriched via Apollo: ${cand.name}`,
              notes: "Revealed contact details via Apollo (1 credit).",
              outcome: email && phone ? "Email + phone revealed" : email ? "Email revealed" : "Phone revealed",
              campaignId: cand.campaignId,
              linkedEntityType: "candidate",
              linkedEntityId: cand.id,
            }),
            cand.campaignId,
          );
        });
        return { ok: true, revealed: true, detail: "Contact details revealed." };
      } catch (e) {
        return { ok: false, revealed: false, detail: e instanceof Error ? e.message : "Network error." };
      }
    },
    [commit, current],
  );

  const sourceFromSeamless = useCallback(
    async (
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
    ): Promise<SourceResult & { source: "seamless" | "not_configured" | "error"; error?: string }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { accepted: [], skipped: [], source: "error", error: "Campaign not found." };
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const count = filters.count ?? 25;
      const queryLabel =
        [
          filters.jobTitles?.length ? `titles:${filters.jobTitles.join("|")}` : null,
          filters.seniorities?.length ? `seniority:${filters.seniorities.join("|")}` : null,
          filters.departments?.length ? `dept:${filters.departments.join("|")}` : null,
          filters.industries?.length ? `industry:${filters.industries.join("|")}` : null,
          filters.countries?.length ? `country:${filters.countries.join("|")}` : null,
          filters.companyNames?.length ? `company:${filters.companyNames.join("|")}` : null,
          filters.companyDomains?.length ? `domains:${filters.companyDomains.join("|")}` : null,
        ]
          .filter(Boolean)
          .join(" ") || "Seamless search";

      let result: SourceResult = { accepted: [], skipped: [] };
      let source: "seamless" | "not_configured" | "error" = "error";
      let error: string | undefined;

      try {
        const res = await fetch("/api/source/seamless/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filters, count }),
        });
        const out = (await res.json().catch(() => null)) as
          | { ok?: boolean; source?: string; contacts?: SeamlessContact[]; error?: string }
          | null;
        if (out?.ok && out.source === "seamless") {
          result =
            out.contacts && out.contacts.length > 0
              ? mapSeamlessCandidates(out.contacts, campaign, queryLabel, s.candidates, weights)
              : { accepted: [], skipped: [] };
          source = "seamless";
        } else if (out?.source === "not_configured") {
          source = "not_configured";
          error = out.error ?? "Add a Seamless key in Settings to source real candidates.";
        } else {
          source = "error";
          error = out?.error ?? "Seamless search failed.";
        }
      } catch (e) {
        source = "error";
        error = e instanceof Error ? e.message : "Network error.";
      }

      if (result.accepted.length > 0) {
        commit((prev) => {
          let next: HermesState = {
            ...prev,
            candidates: [...result.accepted, ...prev.candidates],
          };
          next = recomputeMetrics(next, campaignId);
          next = withActivity(
            next,
            makeActivity({
              type: "sourcing",
              title: `Sourced ${result.accepted.length} candidates via Seamless`,
              notes: `Live Seamless batch. ${result.skipped.length} skipped by dedupe (${result.skipped
                .slice(0, 3)
                .map((x) => x.reason)
                .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
              outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped (live)`,
              campaignId,
              linkedEntityType: "campaign",
              linkedEntityId: campaignId,
            }),
            campaignId,
          );
          return next;
        });
        emit({ kind: "source", campaignId, count: result.accepted.length });
      }
      return { ...result, source, error };
    },
    [commit, current],
  );

  const startSeamlessResearch = useCallback(
    async (candidateId: string): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };
      if (cand.sourcePlatform !== "Seamless" || !cand.sourceExternalId) {
        return { ok: false, error: "Not a Seamless-sourced candidate." };
      }
      let res: Response;
      try {
        res = await fetch("/api/source/seamless/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchResultId: cand.sourceExternalId }),
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching Seamless." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; requestId?: string; error?: string }
        | null;
      if (!out?.ok || !out.requestId) {
        return { ok: false, error: out?.error ?? "Seamless research failed to start." };
      }
      return { ok: true, requestId: out.requestId };
    },
    [current],
  );

  const checkSeamlessResearch = useCallback(
    async (
      candidateId: string,
      requestId: string,
    ): Promise<
      | { ok: true; status: "processing" }
      | { ok: true; status: "completed"; revealed: boolean }
      | { ok: false; error: string }
    > => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };

      let res: Response;
      try {
        res = await fetch(`/api/source/seamless/research-status?requestId=${encodeURIComponent(requestId)}`);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching Seamless." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: string; error?: string; contact?: SeamlessResearchContact }
        | null;
      if (!out?.ok) {
        if (out?.status === "processing") return { ok: true, status: "processing" };
        return { ok: false, error: out?.error ?? "Seamless research failed." };
      }
      if (out.status === "processing") return { ok: true, status: "processing" };
      if (out.status !== "completed") return { ok: false, error: out.error ?? "Seamless research did not complete." };

      const email = out.contact?.email ?? "";
      const phone = out.contact?.phone ?? "";
      if (!email && !phone) {
        commit((prev) =>
          withActivity(
            prev,
            makeActivity({
              type: "sourcing",
              title: `No contact found via Seamless: ${cand.name}`,
              notes: "Research completed but returned no email or phone.",
              outcome: "0 contact fields revealed",
              campaignId: cand.campaignId,
              linkedEntityType: "candidate",
              linkedEntityId: cand.id,
            }),
            cand.campaignId,
          ),
        );
        return { ok: true, status: "completed", revealed: false };
      }

      commit((prev) => {
        const next: HermesState = {
          ...prev,
          candidates: prev.candidates.map((c) =>
            c.id === candidateId ? { ...c, email: email || c.email, phone: phone || c.phone } : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Enriched via Seamless: ${cand.name}`,
            notes: "Revealed contact details via Seamless.",
            outcome: email && phone ? "Email + phone revealed" : email ? "Email revealed" : "Phone revealed",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: cand.id,
          }),
          cand.campaignId,
        );
      });
      return { ok: true, status: "completed", revealed: true };
    },
    [commit, current],
  );

  const runSourcingAgent = useCallback(
    async (campaignId: string, count = 5): Promise<{ ok: boolean; added: number; error?: string }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, added: 0, error: "Campaign not found." };
      if (campaign.status === "Paused") {
        return { ok: false, added: 0, error: "Campaign is paused." };
      }
      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const finalTone = effectiveTone(s.skills);

      const aiCfg = resolveAiProvider(s.settings, "sourcing");
      if (!aiCfg) {
        return { ok: false, added: 0, error: "No cloud LLM provider configured for sourcing. Add one in Settings." };
      }
      if (aiCfg.provider === "kimi") {
        return {
          ok: false,
          added: 0,
          error: "Kimi doesn't support tool-calling. Configure a different provider (Anthropic/OpenAI/Groq/xAI/Mistral) for the sourcing task.",
        };
      }

      type AgentCandidate = Candidate & { draftSubject?: string; draftBody?: string };
      let out: { ok?: boolean; candidates?: AgentCandidate[]; reason?: string } | null = null;
      try {
        const res = await fetch("/api/sourcing-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign: { ...campaign, scoringWeights: weights },
            existing: s.candidates.filter((c) => c.campaignId === campaignId),
            count,
            provider: aiCfg.provider,
            apiKeyId: aiCfg.apiKeyId,
            model: aiCfg.model,
          }),
        });
        out = await res.json().catch(() => null);
      } catch (err) {
        return { ok: false, added: 0, error: err instanceof Error ? err.message : "Network error." };
      }

      if (!out?.ok || !out.candidates?.length) {
        return { ok: false, added: 0, error: out?.reason ?? "The agent found no real candidates." };
      }

      const cleanCandidates: Candidate[] = [];
      const messages: OutreachMessage[] = [];
      for (const raw of out.candidates) {
        const { draftSubject, draftBody, ...clean } = raw;
        const candidate = clean as Candidate;
        cleanCandidates.push(candidate);
        if (draftSubject && draftBody) {
          messages.push(
            newOutreachMessage(
              candidate,
              campaign,
              {
                subject: draftSubject,
                body: draftBody,
                personalizationEvidence: candidate.recentActivity ? [candidate.recentActivity] : [],
                channel: "Email",
              },
              finalTone,
              s.settings,
            ),
          );
        }
      }

      commit((prev) => {
        let next: HermesState = {
          ...prev,
          candidates: [...cleanCandidates, ...prev.candidates],
          outreach: [...messages, ...prev.outreach],
        };
        next = recomputeMetrics(next, campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Sourcing agent found ${cleanCandidates.length} candidates`,
            notes: `${messages.length} drafted for outreach in one tool-calling pass (live).`,
            outcome: `${cleanCandidates.length} added, ${messages.length} drafted`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });

      return { ok: true, added: cleanCandidates.length };
    },
    [commit, current],
  );

  const generateOutreachFor = useCallback(
    (candidateId: string, tone?: OutreachTone, channel: OutreachChannel = "Email", seatId?: string) => {
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const finalTone = tone ?? effectiveTone(s.skills); // learned default tone
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
      // Compose in the seat's language, else the need's, else the workspace default.
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      const gen = generateOutreach(candidate, campaign, finalTone, channel, 1, voice, lang);
      const msg = newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1);
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Outreach drafted: ${candidate.name}`,
            notes: `${finalTone} ${channel} message generated with ${gen.personalizationEvidence.length} personalization points.`,
            outcome: msg.status,
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
      });
      emit({ kind: "allocate", candidateName: candidate.name, campaignId: campaign.id });
      return msg;
    },
    [commit, current],
  );

  // Live outreach drafting. When live mode is configured, ask the Aria runtime
  // to compose the subject+body; on ANY failure (live mode off, runtime
  // unavailable, request error, or an unparseable reply) it falls back to the
  // exact same mock used by generateOutreachFor. The committed message's status
  // is still decided by the human approval gate — never auto-sent.
  const generateOutreachLive = useCallback(
    async (candidateId: string, tone?: OutreachTone, channel: OutreachChannel = "Email", seatId?: string) => {
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const finalTone = tone ?? effectiveTone(s.skills);
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;

      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, channel, 1, voice, lang);

      // Resolve cloud provider config (seat override → workspace defaults).
      const aiCfg = resolveAiProvider(s.settings, "outreach", {
        providerId: seat?.providerId,
        modelId: seat?.modelId,
      });

      // Layer 1: attempt live when a cloud provider is configured OR hermes live mode is on.
      let gen: GeneratedOutreach = mockGen;
      let live = false;
      if (aiCfg || (s.settings.hermesLiveMode && hermesAvailable(s.settings))) {
        const basePrompt = buildOutreachPrompt({
          candidateName: candidate.name,
          candidateTitle: candidate.currentTitle,
          candidateCompany: candidate.currentCompany,
          techStack: candidate.techStack,
          recentActivity: candidate.recentActivity,
          yearsExperience: candidate.yearsExperience,
          roleTitle: campaign.jobAnalysis.title,
          locationType: campaign.jobAnalysis.locationType,
          regions: campaign.jobAnalysis.regions,
          requiredSkills: campaign.jobAnalysis.requiredSkills,
          roleContext: candidateDisclosureContextForCampaignLike(campaign),
          tone: finalTone,
          channel,
          language: lang,
          persona: voice?.persona,
          signature: voice?.signature,
        });
        // F-2: prepend ariaPrompt when set so it shapes the live generation.
        const ariaPrompt = s.settings.guardrails?.ariaPrompt;
        const guardrails = ariaPrompt || "";
        const prompt = guardrails ? `${guardrails}\n\n${basePrompt}` : basePrompt;

        // Build input: cloud path when aiCfg resolved, hermes path otherwise.
        let outreachGenInput: Parameters<typeof hermesGenerate>[0];
        if (aiCfg) {
          outreachGenInput = {
            task: "outreach",
            prompt,
            provider: aiCfg.provider,
            model: aiCfg.model,
            apiKeyId: aiCfg.apiKeyId,
          };
        } else {
          // F-7: resolve the configured model for outreach (seat override → task default).
          const outreachModelId = seat?.modelId ?? s.settings.defaultModels?.outreach;
          outreachGenInput = {
            task: "outreach",
            prompt,
            hermesApiUrl: s.settings.hermesApiUrl,
            hermesApiKeyId: s.settings.hermesApiKeyId,
          };
          if (outreachModelId) {
            const modelName = (s.settings.savedModels ?? []).find((m) => m.id === outreachModelId)?.modelName;
            if (modelName) outreachGenInput.model = modelName;
          }
        }

        // Layer 2: a non-ok result keeps the mock draft.
        const result = await hermesGenerate(outreachGenInput);
        if (result.ok && result.text) {
          // Layer 3: an unparseable reply keeps the mock draft.
          const parsed = parseHermesOutreach(result.text, channel, mockGen.subject);
          if (parsed) {
            gen = {
              // ALWAYS humanize live copy too — the mock path already does this
              // (see generateOutreach), so the "no AI slop, ever" guarantee holds
              // regardless of which provider produced the draft.
              subject: humanizeText(parsed.subject),
              body: humanizeText(parsed.body),
              // Reuse the mock's evidence — same shape, deterministic, audit-friendly.
              personalizationEvidence: mockGen.personalizationEvidence,
              channel,
            };
            live = true;
          }
        }
      }

      const msg = newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1);
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Outreach drafted: ${candidate.name}`,
            notes: `${finalTone} ${channel} message ${live ? "drafted by Aria (live)" : "generated"} with ${gen.personalizationEvidence.length} personalization points.`,
            outcome: msg.status,
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
      });
      return msg;
    },
    [commit, current],
  );

  // Task 1 — follow-up sequences. Reuses the exact same draft-creation path as
  // generateOutreachFor (generateOutreach + newOutreachMessage), just with the
  // next sequenceStep so the copy switches to its "follow-up" flavor. This is a
  // derived due-queue, not a background job: it only fires when explicitly
  // called (from the recommendations queue / outreach page), and it only ever
  // creates a Draft that still has to clear the human approval gate.
  const draftFollowUpFor = useCallback(
    async (candidateId: string, tone?: OutreachTone, seatId?: string) => {
      const s = current();
      // Captured before the live-gen await below so the stale-draft blocker in
      // checkOutreachApproval (candidate.lastRepliedAt > message.createdAt) still
      // catches a reply that lands during the network round-trip — createdAt must
      // reflect when we started drafting, not when the await happened to resolve.
      const draftedAt = new Date().toISOString();
      const due = deriveFollowUpsDue(s).find((d) => d.candidateId === candidateId);
      if (!due) return null;
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const finalTone = tone ?? effectiveTone(s.skills);
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      // Keep following up on whichever channel the candidate was originally reached on.
      const channel: OutreachChannel = candidate.outreachHistory[0]?.channel ?? "Email";
      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, channel, due.nextSequenceStep, voice, lang);
      // Live attempt — same three-layer fallback as generateOutreachLive, so a
      // follow-up touch isn't silently downgraded to canned copy at scale.
      const { gen, live } = await attemptLiveFollowUpGen({
        settings: s.settings,
        candidate,
        campaign,
        tone: finalTone,
        channel,
        voice,
        lang,
        mockGen,
        seat,
        touchNote: `This is follow-up touch #${due.nextSequenceStep} after ${Math.floor(due.daysSinceContact)}d of silence since the last message — vary the angle/urgency from a first touch, keep it short, no guilt-tripping.`,
      });
      const msg = {
        ...newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, due.nextSequenceStep),
        createdAt: draftedAt,
      };
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Follow-up drafted: ${candidate.name}`,
            notes: `Sequence step ${due.nextSequenceStep} · ${Math.floor(due.daysSinceContact)}d of silence since last contact${live ? " (Aria live)" : ""}.`,
            outcome: msg.status,
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
      });
      return msg;
    },
    [commit, current],
  );

  // #Vivier re-contact. Unlike draftFollowUpFor (which is gated to candidates
  // still in the "Contacted but silent" sequence), a pooled candidate is by
  // definition Rejected / Not Interested, so this drafts a fresh re-engagement
  // outreach regardless of stage. Still only a Draft behind the approval gate.
  const draftRecontactFor = useCallback(
    async (candidateId: string, tone?: OutreachTone, seatId?: string) => {
      const s = current();
      // Same createdAt-before-await fix as draftFollowUpFor — see comment there.
      const draftedAt = new Date().toISOString();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const finalTone = tone ?? effectiveTone(s.skills);
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      const channel: OutreachChannel = candidate.outreachHistory[0]?.channel ?? "Email";
      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, channel, 1, voice, lang);
      // Live attempt — same three-layer fallback as generateOutreachLive, so a
      // #Vivier re-contact isn't silently downgraded to canned copy either.
      const { gen, live } = await attemptLiveFollowUpGen({
        settings: s.settings,
        candidate,
        campaign,
        tone: finalTone,
        channel,
        voice,
        lang,
        mockGen,
        seat,
        touchNote: `This is a #Vivier re-engagement of a previously ${candidate.stage} candidate${candidate.silverMedalist ? " (Silver Medalist)" : ""} — acknowledge the gap briefly, lead with what's different now, no guilt-tripping.`,
      });
      const msg = { ...newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1), createdAt: draftedAt };
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Re-contact drafted: ${candidate.name}`,
            notes: `#Vivier re-engagement${candidate.silverMedalist ? " (Silver Medalist)" : ""}. Awaiting approval${live ? " (Aria live)" : ""}.`,
            outcome: msg.status,
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
      });
      return msg;
    },
    [commit, current],
  );

  const updateOutreach = useCallback(
    (messageId: string, patch: Partial<OutreachMessage>) =>
      commit((s) => ({
        ...s,
        outreach: s.outreach.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      })),
    [commit],
  );

  const regenerateOutreach = useCallback(
    async (messageId: string, tone?: OutreachTone) => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      const candidate = msg && s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = msg && s.campaigns.find((c) => c.id === msg.campaignId);
      if (!msg || !candidate || !campaign) return;
      const nextTone = tone ?? msg.tone;

      // Mock is the canonical fallback (and the source of personalization evidence) —
      // same shape as before this went live.
      const mockGen = generateOutreach(candidate, campaign, nextTone, msg.channel, msg.sequenceStep);

      // Live attempt — the exact same three-layer fallback as generateOutreachLive:
      // Layer 1 only fires when a cloud provider or hermes live mode is configured;
      // Layer 2 keeps the mock on a non-ok result; Layer 3 keeps the mock on an
      // unparseable reply. A failed/unconfigured live call always keeps the mock draft.
      let gen: GeneratedOutreach = mockGen;
      const aiCfg = resolveAiProvider(s.settings, "outreach");
      if (aiCfg || (s.settings.hermesLiveMode && hermesAvailable(s.settings))) {
        const lang = campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
        const basePrompt = buildOutreachPrompt({
          candidateName: candidate.name,
          candidateTitle: candidate.currentTitle,
          candidateCompany: candidate.currentCompany,
          techStack: candidate.techStack,
          recentActivity: candidate.recentActivity,
          yearsExperience: candidate.yearsExperience,
          roleTitle: campaign.jobAnalysis.title,
          locationType: campaign.jobAnalysis.locationType,
          regions: campaign.jobAnalysis.regions,
          requiredSkills: campaign.jobAnalysis.requiredSkills,
          roleContext: candidateDisclosureContextForCampaignLike(campaign),
          tone: nextTone,
          channel: msg.channel,
          language: lang,
        });
        const ariaPrompt = s.settings.guardrails?.ariaPrompt;
        const prompt = ariaPrompt ? `${ariaPrompt}\n\n${basePrompt}` : basePrompt;

        let regenGenInput: Parameters<typeof hermesGenerate>[0];
        if (aiCfg) {
          regenGenInput = {
            task: "outreach",
            prompt,
            provider: aiCfg.provider,
            model: aiCfg.model,
            apiKeyId: aiCfg.apiKeyId,
          };
        } else {
          const outreachModelId = s.settings.defaultModels?.outreach;
          regenGenInput = {
            task: "outreach",
            prompt,
            hermesApiUrl: s.settings.hermesApiUrl,
            hermesApiKeyId: s.settings.hermesApiKeyId,
          };
          if (outreachModelId) {
            const modelName = (s.settings.savedModels ?? []).find((m) => m.id === outreachModelId)?.modelName;
            if (modelName) regenGenInput.model = modelName;
          }
        }

        const result = await hermesGenerate(regenGenInput);
        if (result.ok && result.text) {
          const parsed = parseHermesOutreach(result.text, msg.channel, mockGen.subject);
          if (parsed) {
            gen = {
              // ALWAYS humanize live copy too — see generateOutreachLive.
              subject: humanizeText(parsed.subject),
              body: humanizeText(parsed.body),
              personalizationEvidence: mockGen.personalizationEvidence,
              channel: msg.channel,
            };
          }
        }
      }

      commit((prev) => ({
        ...prev,
        outreach: prev.outreach.map((m) =>
          m.id === messageId
            ? {
                ...m,
                tone: nextTone,
                subject: gen.subject,
                body: gen.body,
                personalizationEvidence: gen.personalizationEvidence,
                status: prev.settings.humanApprovalGate ? "Needs Approval" : m.status,
              }
            : m,
        ),
      }));
    },
    [commit, current],
  );

  const approveOutreach = useCallback(
    async (messageId: string): Promise<ApprovalResult> => {
      const approvalBlocked = (blocker: string): ApprovalResult => ({
        allowed: false,
        blockers: [blocker],
        warnings: [],
      });
      const recipientFor = (message: OutreachMessage, candidate: Candidate) =>
        message.channel === "WhatsApp" || message.channel === "SMS"
          ? candidate.phone ?? ""
          : message.channel === "LinkedIn"
            ? candidate.linkedinUrl ?? ""
            : candidate.email;
      const isActionable = (message: OutreachMessage) =>
        message.status === "Needs Approval" || message.status === "Draft";

      let s = current();
      const initialMessage = s.outreach.find((m) => m.id === messageId);
      if (!initialMessage) return approvalBlocked("Message not found.");
      if (!isActionable(initialMessage)) return approvalBlocked("Message is no longer awaiting approval.");
      let msg: OutreachMessage = initialMessage;
      let candidate = s.candidates.find((c) => c.id === msg.candidateId);
      let campaign = s.campaigns.find((c) => c.id === msg.campaignId);
      if (!candidate || !campaign) return approvalBlocked("Linked candidate/campaign missing.");

      let result = checkOutreachApproval({
        candidate,
        message: msg,
        settings: s.settings,
        emailsSentToday: campaign.metrics.emailsSentToday,
        linkedinSentToday: campaign.metrics.linkedinSentToday,
      });
      if (!result.allowed) return result;

      const approvalSnapshot = {
        candidateId: candidate.id,
        channel: msg.channel,
        recipient: recipientFor(msg, candidate),
        subject: msg.subject,
        body: msg.body,
      };

      // Persist the exact human approval before any local status/ledger change.
      // A double-click, failed request, stale edit, or concurrent rejection leaves
      // the draft pending rather than presenting an approval the server cannot use.
      if (supabaseEnabled) {
        if (pendingOutreachApprovals.current.has(messageId)) {
          return approvalBlocked("Approval is already being recorded.");
        }
        pendingOutreachApprovals.current.add(messageId);
        try {
          const persisted = await recordOutreachApproval({ messageId, ...approvalSnapshot });
          if (!persisted.ok) return approvalBlocked(persisted.error);
          if (persisted.dryRun) {
            return {
              ...result,
              dryRun: true,
              warnings: [
                ...result.warnings,
                persisted.detail ?? "Public demo: approval was simulated and the draft remains pending.",
              ],
            };
          }
          const revokeStaleApproval = async (blocker: string): Promise<ApprovalResult> => {
            const revoked = await revokeOutreachApproval(messageId);
            return revoked.ok
              ? approvalBlocked(blocker)
              : approvalBlocked(`${blocker} The stale server approval could not be revoked.`);
          };

          s = current();
          const refreshedMessage = s.outreach.find((m) => m.id === messageId);
          if (!refreshedMessage) return revokeStaleApproval("Message was removed while approval was being recorded.");
          if (!isActionable(refreshedMessage)) return revokeStaleApproval("Message is no longer awaiting approval.");
          const refreshedCandidate = s.candidates.find((c) => c.id === refreshedMessage.candidateId);
          const refreshedCampaign = s.campaigns.find((c) => c.id === refreshedMessage.campaignId);
          if (!refreshedCandidate || !refreshedCampaign) return revokeStaleApproval("Linked candidate/campaign missing.");
          msg = refreshedMessage;
          candidate = refreshedCandidate;
          campaign = refreshedCampaign;

          const refreshedRecipient = recipientFor(msg, candidate);
          if (
            msg.candidateId !== approvalSnapshot.candidateId ||
            msg.channel !== approvalSnapshot.channel ||
            refreshedRecipient !== approvalSnapshot.recipient ||
            msg.subject !== approvalSnapshot.subject ||
            msg.body !== approvalSnapshot.body
          ) {
            return revokeStaleApproval("Draft changed while approval was being recorded. Review and approve the current copy again.");
          }

          result = checkOutreachApproval({
            candidate,
            message: msg,
            settings: s.settings,
            emailsSentToday: campaign.metrics.emailsSentToday,
            linkedinSentToday: campaign.metrics.linkedinSentToday,
          });
          if (!result.allowed) {
            return revokeStaleApproval(result.blockers[0] ?? "Approval conditions changed while the server record was being created.");
          }
        } finally {
          pendingOutreachApprovals.current.delete(messageId);
        }
      }

      const now = new Date().toISOString();
      // LinkedIn is assisted-manual: the system drafts the message but a human must
      // copy/paste it on the candidate's profile. Keep it out of the sent counter
      // and ledger until the operator confirms the manual send.
      const isLive = !s.settings.dryRunMode;
      const isLinkedInManual = msg.channel === "LinkedIn" && isLive;
      // Email, WhatsApp, and SMS all have a real live provider wired up in
      // sendApprovedOutreach() (domain-verified mailbox, WhatsApp Cloud, Twilio SMS).
      // None of them may be delivered on approval alone.
      const isLiveSendChannel =
        (msg.channel === "Email" || msg.channel === "WhatsApp" || msg.channel === "SMS") && isLive;
      // HYBRID send model: in LIVE mode an approval records approval and holds the
      // de-dupe slot (ledger 'claimed') but NEVER sends — an explicit sendApprovedOutreach()
      // actually delivers and only then flips to 'sent'. In dry-run/demo we simulate the
      // send so the showcase stays alive. This is the never-auto-send guarantee.
      const isPendingSend = isLinkedInManual || isLiveSendChannel;
      const finalStatus: OutreachStatus = isLinkedInManual
        ? "Pending Manual Send"
        : isLiveSendChannel
          ? "Approved"
          : "Scheduled";
      const finalLedgerStatus: LedgerStatus = isLinkedInManual
        ? "pending_manual"
        : isLiveSendChannel
          ? "claimed"
          : "sent";
      commit((prev) => {
        const outreach = prev.outreach.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: finalStatus,
                approvedBy: prev.settings.operatorName,
                scheduledFor: isPendingSend ? null : now,
                sentAt: isPendingSend ? null : now,
                dryRun: prev.settings.dryRunMode,
              }
            : m,
        );
        const candidates = prev.candidates.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                stage: isPendingSend
                  ? c.stage
                  : (["Sourced"].includes(c.stage) ? "Contacted" : c.stage) as CandidateStage,
                // Always stamp the contact time — a LinkedIn manual contact still
                // claims the candidate, so the de-dupe re-contact window (fleet.ts,
                // rules.ts) must see it to block a second touch.
                lastContactedAt: now,
                outreachHistory: [
                  { messageId, channel: msg.channel, subject: msg.subject, status: finalStatus, at: now },
                  ...c.outreachHistory,
                ],
              }
            : c,
        );
        // Write the authoritative ledger record so the fleet de-dupe sees this
        // manual contact too (single source of truth → no double-contact).
        const ledgerEntry: OutreachLedgerEntry = {
          id: genId("led"),
          candidateId: candidate.id,
          candidateEmail: candidate.email,
          seatId: "",
          campaignId: campaign.id,
          channel: msg.channel,
          status: finalLedgerStatus,
          reason: isLinkedInManual
            ? "Awaiting operator manual send on LinkedIn."
            : isLiveSendChannel
              ? "Approved, awaiting an explicit send."
              : null,
          at: now,
        };
        let next: HermesState = { ...prev, outreach, candidates, ledger: [ledgerEntry, ...prev.ledger] };
        // bump today counter then recompute (counter preserved by computeCampaignMetrics)
        next = {
          ...next,
          campaigns: next.campaigns.map((c) =>
            c.id === campaign.id
              ? {
                  ...c,
                  metrics: {
                    ...c.metrics,
                    emailsSentToday: c.metrics.emailsSentToday + (msg.channel === "Email" && !isPendingSend ? 1 : 0),
                    linkedinSentToday: c.metrics.linkedinSentToday + (isLinkedInManual ? 0 : msg.channel === "LinkedIn" ? 1 : 0),
                  },
                }
              : c,
          ),
        };
        next = recomputeMetrics(next, campaign.id);
        next = withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Outreach approved: ${candidate.name}`,
            notes: isLinkedInManual
              ? "LinkedIn message approved, pending manual copy/paste by operator."
              : isLiveSendChannel
                ? `${msg.channel} approved, awaiting an explicit send.`
                : `${msg.channel} message approved. ${prev.settings.dryRunMode ? "Dry-run, nothing sent." : "Live send."}`,
            outcome: isLinkedInManual
              ? "Pending Manual Send"
              : isLiveSendChannel
                ? "Approved, pending send"
                : "Approved / Dry-run scheduled",
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
        return next;
      });
      emit({ kind: "send", candidateName: candidate.name, campaignId: campaign.id });
      return result;
    },
    [commit, current],
  );

  const confirmManualSend = useCallback(
    (messageId: string): { ok: boolean; error?: string } => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      if (!msg) return { ok: false, error: "Message not found." };
      if (msg.channel !== "LinkedIn") return { ok: false, error: "Manual send confirmation is only for LinkedIn messages." };
      if (msg.status !== "Pending Manual Send") return { ok: false, error: "Message is not awaiting manual send." };
      const candidate = s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = s.campaigns.find((c) => c.id === msg.campaignId);
      if (!candidate || !campaign) return { ok: false, error: "Linked candidate/campaign missing." };

      const now = new Date().toISOString();
      commit((prev) => {
        const outreach = prev.outreach.map((m) =>
          m.id === messageId
            ? { ...m, status: "Scheduled" as const, scheduledFor: now, sentAt: now }
            : m,
        );
        const candidates = prev.candidates.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                stage: (["Sourced"].includes(c.stage) ? "Contacted" : c.stage) as CandidateStage,
                lastContactedAt: now,
                outreachHistory: [
                  { messageId, channel: msg.channel, subject: msg.subject, status: "Scheduled" as const, at: now },
                  ...c.outreachHistory,
                ],
              }
            : c,
        );
        const ledgerEntry: OutreachLedgerEntry = {
          id: genId("led"),
          candidateId: candidate.id,
          candidateEmail: candidate.email,
          seatId: "",
          campaignId: campaign.id,
          channel: msg.channel,
          status: "sent",
          reason: "Operator confirmed manual send on LinkedIn.",
          at: now,
        };
        let next: HermesState = { ...prev, outreach, candidates, ledger: [ledgerEntry, ...prev.ledger] };
        next = {
          ...next,
          campaigns: next.campaigns.map((c) =>
            c.id === campaign.id
              ? {
                  ...c,
                  metrics: {
                    ...c.metrics,
                    linkedinSentToday: c.metrics.linkedinSentToday + 1,
                  },
                }
              : c,
          ),
        };
        next = recomputeMetrics(next, campaign.id);
        next = withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `LinkedIn message sent: ${candidate.name}`,
            notes: "Operator confirmed the message was manually copied and sent on LinkedIn.",
            outcome: "Scheduled",
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
        return next;
      });
      return { ok: true };
    },
    [commit, current],
  );

  // The deliberate, gated SEND for a live-approved email. Calls the server send route
  // (which re-verifies auth, the live seat, domain, suppression, AND the recorded human
  // approval) and only flips the local record to sent on a real "sent" response. This is
  // the one place a real email leaves; it never fires automatically.
  const sendApprovedOutreach = useCallback(
    async (messageId: string): Promise<{ ok: boolean; error?: string; queued?: boolean }> => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      if (!msg) return { ok: false, error: "Message not found." };
      if (msg.status !== "Approved") return { ok: false, error: "Only an approved message can be sent." };
      const candidate = s.candidates.find((c) => c.id === msg.candidateId);
      if (!candidate) return { ok: false, error: "Linked candidate missing." };
      // Resolve a live seat for the message's channel: a live mailbox for Email
      // (domain verification is checked — and persisted — server-side on send,
      // not pre-filtered here, since that's the only place it can ever become
      // true), or a live WhatsApp / SMS sender for the phone channels.
      const channel = msg.channel;
      const seat =
        channel === "WhatsApp"
          ? s.seats.find((x) => x.status === "active" && x.mode === "live" && x.provider === "WhatsApp Cloud")
          : channel === "SMS"
            ? s.seats.find((x) => x.status === "active" && x.mode === "live" && x.provider === "Twilio SMS")
            : s.seats.find((x) => x.status === "active" && x.mode === "live");
      if (!supabaseEnabled || !seat) {
        const need =
          channel === "WhatsApp"
            ? "live WhatsApp sender"
            : channel === "SMS"
              ? "live SMS sender"
              : "live mailbox";
        return { ok: false, error: `No ${need} connected. Connect one in the Fleet first.` };
      }
      if ((channel === "WhatsApp" || channel === "SMS") && !candidate.phone) {
        return { ok: false, error: "No phone number on file for this candidate. Enrich it before a phone send." };
      }
      let out: { status?: string; detail?: string };
      try {
        const res = await fetch("/api/outreach/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId,
            seatId: seat.id,
            candidateId: candidate.id,
            candidateEmail: candidate.email,
            campaignId: msg.campaignId,
            subject: msg.subject,
            body: msg.body,
            channel,
            phone: candidate.phone,
            confirmLive: true,
          }),
        });
        out = (await res.json().catch(() => ({ status: "error", detail: "Bad response from the send endpoint." }))) as {
          status?: string;
          detail?: string;
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
      }
      const deliveryQueued = channel === "WhatsApp" && out.status === "queued";
      if (out.status !== "sent" && !deliveryQueued) {
        return { ok: false, error: out.detail ?? `Send did not complete (${out.status ?? "unknown"}).` };
      }
      if (deliveryQueued) {
        const now = new Date().toISOString();
        commit((prev) => {
          const outreach = prev.outreach.map((m) =>
            m.id === messageId
              ? { ...m, status: "Scheduled" as OutreachStatus, scheduledFor: now, sentAt: null }
              : m,
          );
          return withActivity(
            { ...prev, outreach },
            makeActivity({
              type: "outreach",
              title: `WhatsApp delivery queued for ${candidate.name}`,
              notes: "ARIA will re-check consent, do-not-contact status, the reply window, and the approval before delivery.",
              outcome: "Queued for policy check",
              campaignId: msg.campaignId,
              linkedEntityType: "candidate",
              linkedEntityId: candidate.id,
            }),
            msg.campaignId,
          );
        });
        return { ok: true, queued: true };
      }
      // Delivered. Flip the local record to sent (Scheduled + sentAt) and count it.
      const now = new Date().toISOString();
      commit((prev) => {
        const outreach = prev.outreach.map((m) =>
          m.id === messageId ? { ...m, status: "Scheduled" as OutreachStatus, sentAt: now } : m,
        );
        const ledger = prev.ledger.map((l) =>
          l.candidateId === candidate.id && l.status === "claimed"
            ? { ...l, status: "sent" as LedgerStatus, seatId: seat.id, at: now }
            : l,
        );
        const candidates = prev.candidates.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                stage: (["Sourced"].includes(c.stage) ? "Contacted" : c.stage) as CandidateStage,
                lastContactedAt: now,
                outreachHistory: [
                  { messageId, channel: msg.channel, subject: msg.subject, status: "Scheduled" as OutreachStatus, at: now },
                  ...c.outreachHistory,
                ],
              }
            : c,
        );
        let next: HermesState = { ...prev, outreach, ledger, candidates };
        next = {
          ...next,
          campaigns: next.campaigns.map((c) =>
            c.id === msg.campaignId
              ? { ...c, metrics: { ...c.metrics, emailsSentToday: c.metrics.emailsSentToday + (msg.channel === "Email" ? 1 : 0) } }
              : c,
          ),
        };
        next = recomputeMetrics(next, msg.campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `${channel} sent to ${candidate.name}`,
            notes: channel === "Email"
              ? `Live email delivered via ${seat.operatorEmail}.`
              : `Live ${channel} delivered to ${candidate.phone ?? "the candidate"}.`,
            outcome: "Sent",
            campaignId: msg.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          msg.campaignId,
        );
        return next;
      });
      return { ok: true };
    },
    [commit, current],
  );

  const rejectOutreach = useCallback(
    async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
      const currentState = current();
      const currentMessage = currentState.outreach.find((m) => m.id === messageId);
      if (!currentMessage) return { ok: false, error: "Message not found." };
      if (supabaseEnabled) {
        const revoked = await revokeOutreachApproval(messageId);
        if (!revoked.ok) return { ok: false, error: revoked.error };
      }
      commit((s) => {
        const msg = s.outreach.find((m) => m.id === messageId);
        const next = {
          ...s,
          outreach: s.outreach.map((m) =>
            m.id === messageId ? { ...m, status: "Rejected" as const } : m,
          ),
        };
        if (!msg) return next;
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: "Outreach rejected",
            notes: "Operator rejected the generated message.",
            outcome: "Rejected",
            campaignId: msg.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: msg.candidateId,
          }),
          msg.campaignId,
        );
      });
      return { ok: true };
    },
    [commit, current],
  );

  const classifyAndStoreReply = useCallback(
    async (input: {
      text: string;
      candidateId?: string;
      campaignId?: string;
      fromAddress?: string;
      messageId?: string;
      inboxThreadId?: string;
      externalReceivedAt?: string;
    }) => {
      const s = current();

      // DEDUP: never create a second reply for a messageId already ingested. Return the
      // existing reply, or a benign stand-in if it was since deleted — so a re-sync of the
      // same message can't double-ingest or re-append the id. (Always returns here.)
      // Dedup is durable, not just the bounded ledger: an old messageId can fall out of
      // the capped ingestedMessageIds, so also treat it as ingested if a reply with that
      // messageId still exists. Prevents duplicate ClassifiedReply rows on re-sync.
      if (
        input.messageId &&
        (s.ingestedMessageIds?.includes(input.messageId) ||
          s.replies.some((r) => r.messageId === input.messageId))
      ) {
        const existing = s.replies.find((r) => r.messageId === input.messageId);
        const c = existing
          ? {
              intent: existing.intent,
              confidence: existing.confidence,
              reasoning: existing.reasoning,
              suggestedAction: existing.suggestedAction,
              draftResponse: existing.draftResponse,
            }
          : classifyReply(input.text);
        return {
          reply: existing ?? {
            id: genId("rep"),
            candidateId: "",
            campaignId: input.campaignId ?? "",
            channel: "Email",
            body: input.text,
            intent: c.intent,
            confidence: c.confidence,
            reasoning: c.reasoning,
            suggestedAction: c.suggestedAction,
            draftResponse: c.draftResponse,
            handled: true,
            slaDueAt: null,
            receivedAt: input.externalReceivedAt ?? new Date().toISOString(),
            messageId: input.messageId,
          },
          classification: c,
        };
      }

      // AUTO-MATCH: resolve candidate from fromAddress when no candidateId given. Prefer a
      // candidate in the active campaign, else any candidate with that email (the address is
      // the identity). Avoids both missing a match in another campaign and arbitrarily
      // linking across campaigns when there is no active campaign.
      let resolvedCandidateId = input.candidateId;
      if (!resolvedCandidateId && input.fromAddress) {
        const scopeId = input.campaignId ?? s.activeCampaignId ?? undefined;
        const matched =
          matchCandidateByEmail(s.candidates, input.fromAddress, scopeId) ??
          matchCandidateByEmail(s.candidates, input.fromAddress);
        if (matched) resolvedCandidateId = matched.id;
      }

      const candidate = resolvedCandidateId
        ? s.candidates.find((c) => c.id === resolvedCandidateId)
        : undefined;
      const campaignId = input.campaignId ?? candidate?.campaignId ?? s.activeCampaignId ?? s.campaigns[0]?.id ?? "";

      // F-1: route through live provider when available; mock is the fallback on any failure.
      let classification = classifyReply(input.text, candidate?.name);
      const classifyAiCfg = resolveAiProvider(s.settings, "classification", { providerId: undefined });
      if (classifyAiCfg || hermesAvailable(s.settings)) {
        try {
          const classifyInput: Parameters<typeof hermesGenerate>[0] = classifyAiCfg
            ? {
                task: "classify",
                prompt: input.text,
                provider: classifyAiCfg.provider,
                model: classifyAiCfg.model,
                apiKeyId: classifyAiCfg.apiKeyId,
              }
            : {
                task: "classify",
                prompt: input.text,
                hermesApiUrl: s.settings.hermesApiUrl,
                hermesApiKeyId: s.settings.hermesApiKeyId,
              };
          const result = await hermesGenerate(classifyInput);
          if (result.ok && result.text) {
            const parsed = JSON.parse(result.text) as ReplyClassification;
            if (
              parsed.intent &&
              typeof parsed.confidence === "number" &&
              parsed.reasoning
            ) {
              classification = {
                ...classification,
                intent: parsed.intent,
                confidence: parsed.confidence,
                reasoning: parsed.reasoning,
                ...(parsed.suggestedAction ? { suggestedAction: parsed.suggestedAction } : {}),
                ...(parsed.draftResponse ? { draftResponse: parsed.draftResponse } : {}),
              };
            }
          }
        } catch {
          // fall back to mock classification already assigned above
        }
      }
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      const inboundInjection = detectInjection(input.text);
      if (classification.draftResponse) {
        const disclosure = validateCandidateBoundText(classification.draftResponse, {
          salaryMin: campaign?.jobAnalysis.salaryMin ?? null,
          salaryMax: campaign?.jobAnalysis.salaryMax ?? null,
          forbidden: campaign
            ? [
                campaign.jobAnalysis.department,
                campaign.jobAnalysis.teamSize,
                campaign.jobAnalysis.reportingTo,
                campaign.jobAnalysis.currency,
              ]
            : [],
        });
        const injection = detectInjection(classification.draftResponse);
        if (!disclosure.safe || injection.flagged || inboundInjection.flagged) {
          classification = {
            ...classification,
            suggestedAction: `Queue for human review: ${disclosure.reason ?? "injection-suspected"}.`,
            draftResponse: "Thanks for the reply. A recruiter will review and follow up.",
          };
        }
      } else if (inboundInjection.flagged) {
        classification = {
          ...classification,
          suggestedAction: "Queue for human review: injection-suspected.",
        };
      }
      const receivedAt = input.externalReceivedAt ?? new Date().toISOString();
      const reply: ClassifiedReply = {
        id: genId("rep"),
        candidateId: candidate?.id ?? "",
        campaignId,
        channel: "Email",
        body: input.text,
        intent: classification.intent,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        suggestedAction: classification.suggestedAction,
        draftResponse: classification.draftResponse,
        handled: false,
        slaDueAt:
          ["INTERESTED", "QUALIFIED_INTEREST"].includes(classification.intent)
            ? new Date(new Date(receivedAt).getTime() + s.settings.slaMinutes * 60000).toISOString()
            : null,
        receivedAt,
        ...(input.fromAddress ? { fromAddress: input.fromAddress } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.inboxThreadId ? { inboxThreadId: input.inboxThreadId } : {}),
        ...(input.externalReceivedAt ? { externalReceivedAt: input.externalReceivedAt } : {}),
      };
      commit((prev) => {
        let next: HermesState = {
          ...prev,
          replies: [reply, ...prev.replies],
          // Bound the dedup ledger (most recent 5000) and never store a duplicate id, so it
          // can't grow unbounded or double-count on re-sync.
          ingestedMessageIds: input.messageId
            ? [
                ...(prev.ingestedMessageIds ?? []).filter((id) => id !== input.messageId),
                input.messageId,
              ].slice(-5000)
            : prev.ingestedMessageIds ?? [],
        };
        if (candidate) {
          next = {
            ...next,
            candidates: next.candidates.map((c) =>
              c.id === candidate.id
                ? {
                    ...c,
                    // OOO is a pause signal, not a real reply — leave the stage as
                    // Contacted so deriveFollowUpsDue keeps nominating this candidate
                    // once the silence gap elapses again (see deriveFollowUpsDue).
                    stage: c.stage === "Contacted" && reply.intent !== "OOO" ? "Replied" : c.stage,
                    lastRepliedAt: reply.receivedAt,
                    replyHistory: [
                      { id: reply.id, intent: reply.intent, confidence: reply.confidence, excerpt: input.text.slice(0, 90), at: reply.receivedAt },
                      ...c.replyHistory,
                    ],
                  }
                : c,
            ),
          };
          next = recomputeMetrics(next, candidate.campaignId);
        }
        return withActivity(
          next,
          makeActivity({
            type: "reply",
            title: `Reply classified${candidate ? `: ${candidate.name}` : ""}`,
            notes: `Intent ${classification.intent} at ${(classification.confidence * 100).toFixed(0)}% confidence.`,
            outcome: classification.intent,
            campaignId,
            linkedEntityType: candidate ? "candidate" : null,
            linkedEntityId: candidate?.id ?? null,
          }),
          campaignId,
        );
      });
      emit({ kind: "reply", candidateName: candidate?.name, campaignId });
      return { reply, classification };
    },
    [commit, current],
  );

  const markReplyHandled = useCallback(
    (replyId: string) =>
      commit((s) => ({
        ...s,
        replies: s.replies.map((r) => (r.id === replyId ? { ...r, handled: true } : r)),
      })),
    [commit],
  );

  /**
   * Sync a compliance action into the real, server-enforced suppression_list
   * table (/api/compliance/suppress) so the send route actually blocks this
   * recipient, not just the local view. Fire-and-forget: the local flag (set by
   * complianceMutate, or the NEGATIVE-reply branch of applyReplyAction below)
   * is the source of truth for this app's own UI regardless of whether the
   * network sync lands; a failure just gets a follow-up activity note so it
   * isn't silently lost.
   *
   * `method: "DELETE"` reverses this (used by restoreCandidateContact) — same
   * endpoint, same auth/RLS posture, removes the row instead of upserting it.
   *
   * Declared above applyReplyAction (rather than alongside complianceMutate /
   * suppressCandidate further down) purely so applyReplyAction's useCallback
   * dependency array can reference it without a temporal-dead-zone error.
   */
  const persistSuppressionToServer = useCallback(
    async (
      type: "email" | "phone",
      value: string,
      reason: string,
      method: "POST" | "DELETE" = "POST",
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!value.trim()) return { ok: true };
      try {
        const response = await fetch("/api/compliance/suppress", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, value, reason }),
        });
        const out = (await response.json().catch(() => null)) as
          | { ok?: boolean; synced?: boolean; detail?: string; error?: string }
          | null;
        if (!response.ok || !out?.ok || out.synced === false) {
          return { ok: false, error: out?.detail ?? out?.error ?? "The server did not confirm the enforcement update." };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error updating the enforcement list." };
      }
    },
    [],
  );

  const syncSuppressionToServer = useCallback(
    (
      email: string,
      reason: string,
      campaignId: string,
      candidateId: string,
      method: "POST" | "DELETE" = "POST",
      type: "email" | "phone" = "email",
    ) => {
      if (!email) return;
      void persistSuppressionToServer(type, email, reason, method)
        .then((result) => {
          if (!result.ok) {
            const detail = result.error ?? "The server did not confirm the enforcement update.";
            commit((prev) =>
              withActivity(
                prev,
                makeActivity({
                  type: "compliance",
                  title:
                    method === "DELETE"
                      ? "Restore not synced to enforcement list"
                      : "Suppression not synced to enforcement list",
                  notes: detail,
                  outcome: "Local only",
                  campaignId,
                  linkedEntityType: "candidate",
                  linkedEntityId: candidateId,
                }),
                campaignId,
              ),
            );
          }
        });
    },
    [commit, persistSuppressionToServer],
  );

  const syncCandidateSuppressionToServer = useCallback(
    (candidate: Candidate, reason: string, method: "POST" | "DELETE" = "POST") => {
      syncSuppressionToServer(candidate.email, reason, candidate.campaignId, candidate.id, method);
      if (candidate.phone?.trim()) {
        syncSuppressionToServer(candidate.phone, reason, candidate.campaignId, candidate.id, method, "phone");
      }
    },
    [syncSuppressionToServer],
  );

  const applyReplyAction = useCallback(
    async (replyId: string): Promise<{ ok: boolean; error?: string; warning?: string }> => {
      const initial = current();
      const reply0 = initial.replies.find((r) => r.id === replyId);
      if (!reply0) return { ok: false, error: "Reply not found." };
      const candidate0 = reply0?.candidateId
        ? initial.candidates.find((c) => c.id === reply0.candidateId)
        : undefined;
      let warning: string | undefined;

      // A negative reply is a server-side safety event. Persist every reachable
      // recipient channel and revoke any existing approval before the browser
      // presents the candidate as suppressed. This prevents a stale direct send
      // or queued WhatsApp row from escaping the newly recorded DNC state.
      if (reply0.intent === "NEGATIVE" && candidate0 && supabaseEnabled) {
        const targets = [
          ...(candidate0.email.trim() ? [{ type: "email" as const, value: candidate0.email }] : []),
          ...(candidate0.phone?.trim() ? [{ type: "phone" as const, value: candidate0.phone }] : []),
        ];
        for (const target of targets) {
          const persisted = await persistSuppressionToServer(
            target.type,
            target.value,
            "Negative reply, auto-suppressed",
          );
          if (!persisted.ok) return { ok: false, error: persisted.error ?? "Could not record the candidate suppression." };
        }
        const approvalIds = initial.outreach
          .filter((message) => message.candidateId === candidate0.id)
          .map((message) => message.id);
        const revoked = await Promise.all(approvalIds.map((messageId) => revokeOutreachApproval(messageId)));
        if (revoked.some((result) => !result.ok)) {
          warning = "The candidate is suppressed for future contact, but a message already in delivery could not be cancelled.";
        }
      }

      commit((s) => {
        const reply = s.replies.find((r) => r.id === replyId);
        if (!reply) return s;
        const stageFor: Record<ReplyIntent, CandidateStage | null> = {
          INTERESTED: "Interested",
          QUALIFIED_INTEREST: "Interested",
          NOT_INTERESTED: "Not Interested",
          REFERRAL: null,
          OOO: null,
          UNCLEAR: null,
          NEGATIVE: "Suppressed",
        };
        const target = stageFor[reply.intent];
        let next: HermesState = {
          ...s,
          replies: s.replies.map((r) => (r.id === replyId ? { ...r, handled: true } : r)),
        };
        if (reply.candidateId && target) {
          next = {
            ...next,
            candidates: next.candidates.map((c) =>
              c.id === reply.candidateId
                ? {
                    ...c,
                    ...withStage(c, target),
                    complianceFlags:
                      reply.intent === "NEGATIVE"
                        ? {
                            ...c.complianceFlags,
                            doNotContact: true,
                            suppressed: true,
                            // Mirror suppressCandidate/markDoNotContact so the
                            // "Undo — restore contact" button in the drawer can
                            // restore the real prior stage instead of falling
                            // back to the hardcoded default.
                            preSuppressionStage:
                              c.stage === "Suppressed"
                                ? c.complianceFlags.preSuppressionStage ?? null
                                : c.stage,
                          }
                        : c.complianceFlags,
                  }
                : c,
            ),
          };
          if (reply.intent === "NEGATIVE") {
            // The candidate said stop — nothing already sitting in the approval
            // queue (or already approved, pre-send) may go out for them. Reject
            // it in the same commit so nothing is left pending a stale send.
            next = {
              ...next,
              outreach: next.outreach.map((m) =>
                m.candidateId === reply.candidateId &&
                (m.status === "Needs Approval" ||
                  m.status === "Approved" ||
                  m.status === "Pending Manual Send" ||
                  (m.status === "Scheduled" && !m.sentAt))
                  ? { ...m, status: "Rejected" as OutreachStatus }
                  : m,
              ),
            };
          }
          next = recomputeMetrics(next, reply.campaignId);
        }
        return withActivity(
          next,
          makeActivity({
            type: "reply",
            title: "Reply action applied",
            notes: `${reply.intent} → ${target ?? "no stage change"}.`,
            outcome: target ?? "handled",
            campaignId: reply.campaignId,
            linkedEntityType: reply.candidateId ? "candidate" : null,
            linkedEntityId: reply.candidateId || null,
          }),
          reply.campaignId,
        );
      });

      return warning ? { ok: true, warning } : { ok: true };
    },
    [commit, current, persistSuppressionToServer],
  );

  // Task 2 — turn a classified reply's suggested draft into a real outreach
  // draft instead of leaving copy-to-clipboard as the only affordance. Builds
  // the message the same way every other draft is built (newOutreachMessage),
  // so it lands in "Needs Approval" and has to clear the same approve -> send
  // gate; this function only ever adds to state.outreach, it never sends.
  const draftReplyResponse = useCallback(
    (replyId: string): OutreachMessage | null => {
      const s = current();
      const reply = s.replies.find((r) => r.id === replyId);
      if (!reply || !reply.candidateId || !reply.draftResponse.trim()) return null;
      const candidate = s.candidates.find((c) => c.id === reply.candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;

      const finalTone = effectiveTone(s.skills);
      const priorSubject = candidate.outreachHistory[0]?.subject;
      const trimmedBody = reply.body.trim();
      const excerpt = trimmedBody.length > 100 ? `${trimmedBody.slice(0, 100)}…` : trimmedBody;
      const gen: GeneratedOutreach = {
        subject: priorSubject ? `Re: ${priorSubject}` : `Re: ${campaign.jobAnalysis.title}`,
        body: reply.draftResponse,
        personalizationEvidence: [`Replying to their message: "${excerpt}"`],
        channel: reply.channel,
      };
      const priorMaxStep = s.outreach
        .filter((m) => m.candidateId === candidate.id)
        .reduce((max, m) => Math.max(max, m.sequenceStep), 0);
      const msg: OutreachMessage = {
        ...newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, priorMaxStep + 1),
        ...(reply.inboxThreadId ? { inboxThreadId: reply.inboxThreadId } : {}),
      };
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Reply drafted: ${candidate.name}`,
            notes: `${msg.channel} response drafted from the classified reply. Awaiting approval before anything sends.`,
            outcome: msg.status,
            campaignId: campaign.id,
            linkedEntityType: "candidate",
            linkedEntityId: candidate.id,
          }),
          campaign.id,
        );
      });
      return msg;
    },
    [commit, current],
  );

  const createBookingFor = useCallback(
    async (
      candidateId: string,
      opts?: { startTime?: string; interviewerName?: string },
    ): Promise<
      | { ok: true; booking: Booking; prepEmail: string; confirmationEmail: string }
      | { ok: false; error: string }
    > => {
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return { ok: false, error: "Candidate or campaign not found." };
      // Never book a candidate who opted out / is suppressed (compliance).
      const cf = candidate.complianceFlags;
      if (cf.doNotContact || cf.suppressed || cf.unsubscribed) {
        return { ok: false, error: "Candidate has opted out or is suppressed. Cannot book." };
      }

      const activeInterviewers = s.interviewers.filter((iv) => iv.active);
      const slot = resolveBookingSlot(s.bookings, activeInterviewers, s.bookings.length, opts);
      if ("error" in slot) return { ok: false, error: slot.error };
      const booking = createBooking(candidate, campaign, slot.interviewer, slot.start);
      const prep = interviewerPrepEmail(booking, candidate);
      const confirm = candidateConfirmationEmail(booking);

      // Create a REAL calendar event FIRST when a live mailbox is connected — a
      // failed remote call must not produce a "Booked" candidate carrying a fake
      // calendar link. Demo mode / no live seat skips this and commits immediately
      // below with the synthetic link, exactly as before.
      const seat = s.seats.find(
        (x) =>
          x.status === "active" &&
          x.mode === "live" &&
          (x.provider === "Gmail API" || x.provider === "Microsoft Graph"),
      );
      if (supabaseEnabled && seat) {
        try {
          const res = await fetch("/api/calendar/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              seatId: seat.id,
              candidateName: booking.candidateName,
              candidateEmail: candidate.email || undefined,
              role: booking.role,
              startTime: booking.startTime,
              endTime: booking.endTime,
              timezone: booking.timezone,
              interviewerEmail: booking.interviewerEmail || undefined,
              agenda: booking.agenda,
              confirmLive: true,
            }),
          });
          const out = (await res.json().catch(() => null)) as
            | { status?: string; link?: string | null; detail?: string }
            | null;
          if (!res.ok) {
            return { ok: false, error: out?.detail ?? `Calendar request failed (${res.status}).` };
          }
          if (out?.status === "created" && out.link) {
            booking.calLink = out.link;
          }
          // status "dry-run" / "skipped" (mail-only connection, seat not live, etc.)
          // is documented graceful degradation, not a failure — keep the synthetic link.
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Calendar service unreachable.",
          };
        }
      }

      commit((prev) => {
        const candidates = prev.candidates.map((c) =>
          c.id === candidate.id
            ? { ...c, ...withStage(c, "Booked"), booking }
            : c,
        );
        const bookedCandidate = candidates.find((c) => c.id === candidate.id) ?? candidate;
        let next: HermesState = {
          ...prev,
          bookings: [booking, ...prev.bookings],
          candidates,
        };
        next = appendWinRecord(next, bookedCandidate, campaign, booking);
        next = recomputeMetrics(next, campaign.id);
        next = withActivity(
          next,
          makeActivity({
            type: "booking",
            title: `Interview booked: ${candidate.name}`,
            notes: `${booking.interviewer || "No interviewer assigned yet"}. Teams + Cal.com links generated. Stage → Booked.`,
            outcome: "Confirmed",
            campaignId: campaign.id,
            linkedEntityType: "booking",
            linkedEntityId: booking.id,
          }),
          campaign.id,
        );
        return next;
      });

      emit({ kind: "book", candidateName: candidate.name, campaignId: campaign.id });
      return { ok: true, booking, prepEmail: prep, confirmationEmail: confirm };
    },
    [commit, current],
  );

  const updateBooking = useCallback(
    (id: string, patch: Partial<Booking>): { ok: true } | { ok: false; error: string } => {
      // Rescheduling to a new time is the one patch shape that can create a
      // fresh double-booking (status-only patches like "Completed"/"Cancelled"
      // never move a slot) — guard it before committing.
      if (patch.startTime || patch.endTime) {
        const s = current();
        const booking = s.bookings.find((b) => b.id === id);
        if (!booking) return { ok: false, error: "Booking not found." };
        const start = new Date(patch.startTime ?? booking.startTime);
        const end = new Date(patch.endTime ?? booking.endTime);
        // No interviewer assigned (empty roster at booking time) — nothing to
        // conflict-check; an empty interviewerEmail must never collide with
        // another interviewer-less booking's empty string.
        if (booking.interviewerEmail && interviewerIsBusy(s.bookings, booking.interviewerEmail, start, end, booking.id)) {
          return { ok: false, error: `${booking.interviewer} is already booked at that time.` };
        }
      }
      commit((s) => {
        const booking = s.bookings.find((b) => b.id === id);
        let next: HermesState = {
          ...s,
          bookings: s.bookings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        };
        // Completing an interview naturally advances the candidate past "Booked" --
        // only when they're still sitting there, so this never fights a stage the
        // human already set manually (Interviewed/Offer/Hired/Rejected/...).
        if (booking && patch.status === "Completed") {
          const cand = next.candidates.find((c) => c.id === booking.candidateId);
          if (cand?.stage === "Booked") {
            next = {
              ...next,
              candidates: next.candidates.map((c) =>
                c.id === booking.candidateId
                  ? { ...c, ...withStage(c, "Interviewed") }
                  : c,
              ),
            };
            next = recomputeMetrics(next, booking.campaignId);
          }
        }
        return next;
      });
      return { ok: true };
    },
    [commit, current],
  );

  const generateReport = useCallback(
    (campaignId: string) => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return null;
      const report = generateWeeklyReport(campaign, s.candidates, s.outreach);
      commit((prev) => {
        let next: HermesState = {
          ...prev,
          reports: [report, ...prev.reports.filter((r) => r.campaignId !== campaignId)],
          campaigns: prev.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  // Append newly proposed updates only — overwriting here discarded any
                  // Accept/Reject decision the recruiter already made on a prior report
                  // (proposeSkillUpdates re-proposes the same fixed titles every run).
                  skillUpdates: [
                    ...c.skillUpdates,
                    ...report.skillUpdates
                      .filter((nu) => !c.skillUpdates.some((ex) => ex.title === nu.title))
                      .map((x) => ({ ...x })),
                  ],
                }
              : c,
          ),
        };
        next = withActivity(
          next,
          makeActivity({
            type: "learning",
            title: "Weekly report generated",
            notes: `${report.skillUpdates.length} skill updates proposed.`,
            outcome: "Report ready",
            campaignId,
            linkedEntityType: "report",
            linkedEntityId: report.id,
          }),
          campaignId,
        );
        return next;
      });
      return report;
    },
    [commit, current],
  );

  const setSkillUpdateStatus = useCallback(
    (campaignId: string, skillId: string, status: SkillUpdate["status"]) =>
      commit((s) => {
        const next: HermesState = {
          ...s,
          campaigns: s.campaigns.map((c) =>
            c.id === campaignId
              ? { ...c, skillUpdates: c.skillUpdates.map((u) => (u.id === skillId ? { ...u, status } : u)) }
              : c,
          ),
          reports: s.reports.map((r) =>
            r.campaignId === campaignId
              ? { ...r, skillUpdates: r.skillUpdates.map((u) => (u.id === skillId ? { ...u, status } : u)) }
              : r,
          ),
        };
        const skill = s.campaigns
          .find((c) => c.id === campaignId)
          ?.skillUpdates.find((u) => u.id === skillId);
        return withActivity(
          next,
          makeActivity({
            type: "learning",
            title: `Skill update ${status}`,
            notes: skill ? `${skill.skill}: ${skill.title}` : skillId,
            outcome: status,
            campaignId,
            linkedEntityType: "skill",
            linkedEntityId: skillId,
          }),
          campaignId,
        );
      }),
    [commit],
  );

  /* ---- candidate compliance -------------------------------------------- */

  const setCandidateStage = useCallback(
    (id: string, stage: CandidateStage) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        let next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === id
              ? // Track the historical high-water-mark rank so a later regression
                // (e.g. Rejected after Interviewed) doesn't undercount how far the
                // candidate actually progressed in funnel/KPI aggregation.
                { ...c, ...withStage(c, stage) }
              : c,
          ),
        };
        if (cand) next = recomputeMetrics(next, cand.campaignId);
        return next;
      }),
    [commit],
  );

  const setCandidatePhone = useCallback(
    (id: string, phone: string) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, phone: phone.trim() || undefined } : c)),
      })),
    [commit],
  );

  const addCandidateNote = useCallback(
    (candidateId: string, text: string) => {
      const clean = text.trim();
      if (!clean) return;
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        const note: CandidateNote = { id: genId("note"), text: clean, at: new Date().toISOString() };
        const next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === candidateId ? { ...c, notes: [note, ...(c.notes ?? [])] } : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Note added: ${cand.name}`,
            notes: clean,
            outcome: "Recruiter note",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      });
    },
    [commit],
  );

  const setRejectionReason = useCallback(
    (candidateId: string, reason: string) => {
      const clean = reason.trim();
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        const next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === candidateId ? { ...c, rejectionReason: clean || undefined } : c,
          ),
        };
        // Clearing the reason is a local edit, not an event worth an audit entry.
        if (!clean) return next;
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Rejection reason recorded: ${cand.name}`,
            notes: clean,
            outcome: "Rejected",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      });
    },
    [commit],
  );

  /* ---- TAnIA actions (source, rating, #Vivier, prequal, interviews, chatbox) */

  const setCandidateRating = useCallback(
    (id: string, rating: StarRating) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, starRating: rating } : c)),
      })),
    [commit],
  );

  const setCandidateLeadSource = useCallback(
    (id: string, leadSource: LeadSource) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, leadSource } : c)),
      })),
    [commit],
  );

  const toggleVivier = useCallback(
    (id: string) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        if (!cand) return s;
        const nowIn = !cand.vivier;
        const next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === id
              ? {
                  ...c,
                  vivier: nowIn,
                  silverMedalist:
                    nowIn && (c.starRating === "TopGun" || c.starRating === "A") ? true : c.silverMedalist,
                  recontactAt: nowIn ? c.recontactAt ?? isoDaysBefore(-90) : c.recontactAt,
                }
              : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `${nowIn ? "Added to" : "Removed from"} #Vivier: ${cand.name}`,
            notes: nowIn ? "Talent pool, kept warm for future needs." : "Removed from talent pool.",
            outcome: nowIn ? "Pooled" : "Unpooled",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: id,
          }),
          cand.campaignId,
        );
      }),
    [commit],
  );

  const savePrequal = useCallback(
    (candidateId: string, patch: Partial<PrequalRecord>) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => {
          if (c.id !== candidateId) return c;
          const base: PrequalRecord = c.prequal ?? {
            scheduledFor: null,
            completedAt: null,
            questions: [],
            outcome: "pending",
          };
          return { ...c, prequal: { ...base, ...patch } };
        }),
      })),
    [commit],
  );

  const setPrequalOutcome = useCallback(
    (candidateId: string, outcome: PrequalOutcome) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        // Advancing a prequal is the LEAD -> CANDIDATE promotion (TAnIA §5/§7).
        const promote = outcome === "advance" && ["Sourced", "Contacted", "Replied"].includes(cand.stage);
        const nextStage: CandidateStage = promote
          ? "Interested"
          : outcome === "reject"
            ? "Rejected"
            : cand.stage;
        const base: PrequalRecord = cand.prequal ?? {
          scheduledFor: null,
          completedAt: null,
          questions: [],
          outcome: "pending",
        };
        let next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === candidateId
              ? {
                  ...c,
                  // A "reject" outcome sets stage: "Rejected" regardless of how
                  // far the candidate had progressed (e.g. re-prequalling an
                  // already-Interviewed candidate) — withStage keeps the
                  // high-water mark so effectiveStageRank() doesn't under-report.
                  ...withStage(c, nextStage),
                  prequal: {
                    ...base,
                    outcome,
                    completedAt: base.completedAt ?? new Date().toISOString(),
                    starRating: base.starRating ?? c.starRating,
                  },
                  vivier: outcome === "reject" ? true : c.vivier,
                }
              : c,
          ),
        };
        next = recomputeMetrics(next, cand.campaignId);
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Prequal ${outcome}: ${cand.name}`,
            notes: promote
              ? "Lead promoted to Candidate."
              : outcome === "reject"
                ? "Declined at prequal; added to #Vivier."
                : "Held for review.",
            outcome: outcome === "advance" ? "Advance to Intw1" : outcome === "hold" ? "Hold" : "Reject",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      }),
    [commit],
  );

  const addInterview = useCallback(
    (candidateId: string, kind: InterviewKind, interviewer: string, scheduledFor: string | null) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        const rec: InterviewRecord = {
          id: genId("iv"),
          kind,
          scheduledFor,
          interviewer,
          outcome: "Scheduled",
          hmFeedbackDueAt: null,
          createdAt: new Date().toISOString(),
        };
        // Booking the first interview moves an Interested lead into the interview flow.
        const nextStage: CandidateStage = cand.stage === "Interested" ? "Booked" : cand.stage;
        let next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) =>
            c.id === candidateId
              ? { ...c, ...withStage(c, nextStage), interviews: [...(c.interviews ?? []), rec] }
              : c,
          ),
        };
        next = recomputeMetrics(next, cand.campaignId);
        return withActivity(
          next,
          makeActivity({
            type: "booking",
            title: `${kind} scheduled: ${cand.name}`,
            notes: `Interviewer: ${interviewer}.`,
            outcome: "Scheduled",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      }),
    [commit],
  );

  const updateInterview = useCallback(
    (candidateId: string, interviewId: string, patch: Partial<InterviewRecord>) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) =>
          c.id === candidateId
            ? {
                ...c,
                interviews: (c.interviews ?? []).map((iv) =>
                  iv.id === interviewId ? { ...iv, ...patch } : iv,
                ),
              }
            : c,
        ),
      })),
    [commit],
  );

  const advanceChatboxSubmission = useCallback(
    (id: string) =>
      commit((s) => {
        const sub = (s.chatboxSubmissions ?? []).find((x) => x.id === id);
        if (!sub) return s;
        const campaignId = sub.campaignId ?? s.activeCampaignId ?? s.campaigns[0]?.id ?? "";
        const initials = `${sub.firstName[0] ?? ""}${sub.lastName[0] ?? ""}`.toUpperCase();
        const cand: Candidate = {
          id: genId("cand"),
          campaignId,
          name: `${sub.firstName} ${sub.lastName}`.trim(),
          email: sub.email,
          phone: sub.phone,
          avatarInitials: initials,
          currentTitle: sub.roleTitle,
          currentCompany: "—",
          location: sub.detected.location ?? "—",
          timezone: "—",
          linkedinUrl: "",
          githubUrl: "",
          sourcePlatform: "Referral", // closest base enum; leadSource is authoritative
          sourceQuery: `Chatbox Path ${sub.path}`,
          matchScore: sub.score.total,
          matchBreakdown: [],
          techStack: sub.detected.skills ?? [],
          yearsExperience: 0,
          companyStageExperience: [],
          industryExperience: [],
          recentActivity: `Applied via career-site chatbox (Path ${sub.path}).`,
          stage: "Replied",
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
          provenance: "live",
          leadSource: "Applicant",
          starRating: sub.starRating,
          dna: sub.detected.skills ?? [],
        };
        let next: HermesState = {
          ...s,
          candidates: [cand, ...s.candidates],
          chatboxSubmissions: (s.chatboxSubmissions ?? []).map((x) =>
            x.id === id ? { ...x, status: "advanced", handoffCandidateId: cand.id } : x,
          ),
        };
        if (campaignId) next = recomputeMetrics(next, campaignId);
        return withActivity(
          next,
          makeActivity({
            type: "parse",
            title: `Applicant handed off: ${cand.name}`,
            notes: `Chatbox score ${sub.score.total}/100 · ${sub.starRating}. Screener created a candidate record.`,
            outcome: "Handoff to Applicant Screener",
            campaignId: campaignId || null,
            linkedEntityType: "candidate",
            linkedEntityId: cand.id,
          }),
          campaignId || null,
        );
      }),
    [commit],
  );

  const setChatboxSubmissionStatus = useCallback(
    (id: string, status: ChatboxSubmissionStatus) =>
      commit((s) => ({
        ...s,
        chatboxSubmissions: (s.chatboxSubmissions ?? []).map((x) =>
          x.id === id ? { ...x, status } : x,
        ),
      })),
    [commit],
  );

  const addChatboxSubmission = useCallback(
    (sub: ChatboxSubmission) =>
      commit((s) =>
        withActivity(
          { ...s, chatboxSubmissions: [sub, ...(s.chatboxSubmissions ?? [])] },
          makeActivity({
            type: "parse",
            title: `New application: ${sub.firstName} ${sub.lastName}`,
            notes: `Career-site chatbox (Path ${sub.path}) · score ${sub.score.total}/100 · ${sub.starRating}.`,
            outcome: "Awaiting screener",
            campaignId: sub.campaignId,
            linkedEntityType: sub.campaignId ? "campaign" : null,
            linkedEntityId: sub.campaignId,
          }),
          sub.campaignId ?? null,
        ),
      ),
    [commit],
  );

  const complianceMutate = useCallback(
    (id: string, fn: (c: Candidate) => Candidate, label: string, outcome: string) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        if (!cand) return s;
        let next: HermesState = {
          ...s,
          // Any complianceMutate caller may change `stage` (e.g. suppressCandidate,
          // markDoNotContact both set stage: "Suppressed"); always fold the result
          // into the high-water-mark rank so a later regression can't undercount
          // how far the candidate actually progressed in funnel/KPI aggregation.
          candidates: s.candidates.map((c) => {
            if (c.id !== id) return c;
            const updated = fn(c);
            return { ...updated, ...withStage(c, updated.stage) };
          }),
        };
        next = recomputeMetrics(next, cand.campaignId);
        return withActivity(
          next,
          makeActivity({
            type: "compliance",
            title: label,
            notes: `${cand.name} (${cand.email}).`,
            outcome,
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: id,
          }),
          cand.campaignId,
        );
      }),
    [commit],
  );

  const suppressCandidate = useCallback(
    (id: string) => {
      const cand = current().candidates.find((c) => c.id === id);
      complianceMutate(
        id,
        (c) => ({
          ...c,
          stage: "Suppressed",
          complianceFlags: {
            ...c.complianceFlags,
            suppressed: true,
            suppressedUntil: isoDaysBefore(-90),
            // Preserve the real stage from before the FIRST suppression so a
            // later suppress/DNC toggle (or a restore) doesn't clobber it with
            // "Suppressed" itself.
            preSuppressionStage:
              c.stage === "Suppressed" ? c.complianceFlags.preSuppressionStage ?? null : c.stage,
          },
        }),
        "Contact suppressed",
        "Suppressed",
      );
      if (cand) syncCandidateSuppressionToServer(cand, "Suppressed");
    },
    [complianceMutate, current, syncCandidateSuppressionToServer],
  );

  const markDoNotContact = useCallback(
    (id: string) => {
      const cand = current().candidates.find((c) => c.id === id);
      complianceMutate(
        id,
        (c) => ({
          ...c,
          stage: "Suppressed",
          complianceFlags: {
            ...c.complianceFlags,
            doNotContact: true,
            suppressed: true,
            preSuppressionStage:
              c.stage === "Suppressed" ? c.complianceFlags.preSuppressionStage ?? null : c.stage,
          },
        }),
        "Marked do-not-contact",
        "Do-not-contact",
      );
      if (cand) syncCandidateSuppressionToServer(cand, "Do-not-contact");
    },
    [complianceMutate, current, syncCandidateSuppressionToServer],
  );

  const restoreCandidateContact = useCallback(
    (id: string) => {
      const cand = current().candidates.find((c) => c.id === id);
      complianceMutate(
        id,
        (c) => ({
          ...c,
          stage: c.complianceFlags.preSuppressionStage ?? "Sourced",
          complianceFlags: {
            ...c.complianceFlags,
            suppressed: false,
            doNotContact: false,
            suppressedUntil: null,
            preSuppressionStage: null,
          },
        }),
        "Contact restored",
        "Restored",
      );
      // Mirror suppressCandidate/markDoNotContact: also remove the candidate
      // from the real, server-enforced suppression_list so the outreach send
      // route stops blocking them, not just the local view.
      if (cand) syncCandidateSuppressionToServer(cand, "Restored", "DELETE");
    },
    [complianceMutate, current, syncCandidateSuppressionToServer],
  );

  const unsubscribeCandidate = useCallback(
    (id: string) => {
      const cand = current().candidates.find((c) => c.id === id);
      complianceMutate(
        id,
        (c) => ({ ...c, complianceFlags: { ...c.complianceFlags, unsubscribed: true } }),
        "Unsubscribe honored",
        "Unsubscribed",
      );
      if (cand) syncCandidateSuppressionToServer(cand, "Unsubscribed");
    },
    [complianceMutate, current, syncCandidateSuppressionToServer],
  );

  const anonymizeCandidate = useCallback(
    (id: string) =>
      complianceMutate(
        id,
        (c) => ({
          ...c,
          name: "Anonymized Candidate",
          email: `anon-${c.id.slice(-6)}@redacted.example`,
          avatarInitials: "—",
          linkedinUrl: "",
          githubUrl: "",
          currentCompany: "Redacted",
          complianceFlags: { ...c.complianceFlags, anonymized: true },
        }),
        "Candidate anonymized",
        "Anonymized",
      ),
    [complianceMutate],
  );

  const exportCandidate = useCallback(
    (id: string) => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === id);
      if (!cand) return "{}";
      complianceMutate(
        id,
        (c) => ({ ...c, complianceFlags: { ...c.complianceFlags, gdprExportRequested: true } }),
        "GDPR data export",
        "Exported",
      );
      return JSON.stringify(cand, null, 2);
    },
    [complianceMutate, current],
  );

  /* ---- settings + integrations ----------------------------------------- */

  const updateSettings = useCallback(
    (patch: Partial<SystemSettings>) =>
      commit((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    [commit],
  );

  const updateIntegration = useCallback(
    (id: string, patch: Partial<IntegrationStatus>) =>
      commit((s) => ({
        ...s,
        integrations: s.integrations.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      })),
    [commit],
  );

  const toggleIntegrationMode = useCallback(
    (id: string) =>
      commit((s) => {
        const next = {
          ...s,
          integrations: s.integrations.map((i) =>
            i.id === id ? { ...i, mode: i.mode === "mock" ? ("live" as const) : ("mock" as const) } : i,
          ),
        };
        const integ = s.integrations.find((i) => i.id === id);
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: "Integration mode changed",
            notes: `${integ?.name ?? id} → ${integ?.mode === "mock" ? "live" : "mock"}.`,
            outcome: integ?.mode === "mock" ? "live" : "mock",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      }),
    [commit],
  );

  const testIntegration = useCallback(
    async (id: string): Promise<ConnectionTestResult> => {
      const s = current();
      const integ = s.integrations.find((i) => i.id === id);
      if (!integ) return { ok: false, latencyMs: 0, message: "Integration not found." };

      let result: ConnectionTestResult;
      // GitHub sourcing has a real backend — actually probe it (GET /user via the
      // server token) instead of echoing a stored status. Other integrations have no
      // server probe in this build, so they report their honest last-known status.
      if (integ.id === "int_github") {
        const t0 = Date.now();
        try {
          const res = await fetch("/api/source", { method: "GET" });
          const out = (await res.json().catch(() => null)) as
            | { connected?: boolean; login?: string | null; anonymous?: boolean; reason?: string }
            | null;
          const latencyMs = Date.now() - t0;
          result = out?.connected
            ? {
                ok: true,
                latencyMs,
                message: out.anonymous
                  ? "Sourcing GitHub anonymously (60 req/hour). Add GITHUB_TOKEN for a higher ceiling."
                  : `Connected to GitHub as ${out.login}.`,
              }
            : {
                ok: false,
                latencyMs,
                message: out?.reason ?? "GitHub unreachable.",
              };
        } catch {
          result = { ok: false, latencyMs: Date.now() - t0, message: "GitHub probe failed (network)." };
        }
      } else {
        result = testConnection(integ);
      }

      if (result.ok) {
        commit((prev) => ({
          ...prev,
          integrations: prev.integrations.map((i) =>
            i.id === id ? { ...i, lastSync: new Date().toISOString() } : i,
          ),
        }));
      }
      return result;
    },
    [commit, current],
  );

  /* ---- Fleet: seats ----------------------------------------------------- */

  const addSeat = useCallback(
    async (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => {
      const authorizedState = stateRef.current;
      if (!authorizedState || !can(authorizedState.currentRole, "manage_fleet")) return null;
      const now = new Date().toISOString();
      const draft: AgentSeat = {
        id: genId("seat"),
        name: partial.name,
        operatorEmail: partial.operatorEmail,
        provider: partial.provider ?? "Microsoft Graph",
        status: "active",
        mode: "mock",
        domainVerified: false,
        dailyLimit: partial.dailyLimit ?? 40,
        warmup: partial.warmup ?? true,
        warmupStartCap: partial.warmupStartCap ?? 10,
        warmupStepPerDay: partial.warmupStepPerDay ?? 4,
        warmupStartedAt: now,
        minGapMinutes: partial.minGapMinutes ?? 12,
        sendWindow: partial.sendWindow ?? defaultSendWindow(),
        sentToday: 0,
        lastSendAt: null,
        health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
        persona:
          partial.persona ??
          "Warm, concise, peer-to-peer recruiter. Lead with the candidate's recent work, one genuine specific compliment, soft 15-minute ask. No corporate fluff, no AI slop.",
        signature: partial.signature ?? "",
        language: partial.language ?? current().settings.defaultLanguage,
        connectedAccount: "",
        createdAt: now,
      };
      let seat = draft;
      if (supabaseEnabled) {
        const created = await createFleetSeatOnServer(draft);
        if (!created.ok) return null;
        seat = created.seat;
      }
      commit((s) =>
        withActivity(
          { ...s, seats: [...s.seats, seat] },
          makeActivity({
            type: "system",
            title: `Aria agent added: ${seat.name}`,
            notes: `${seat.provider} seat created in mock mode.`,
            outcome: "Seat created",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return seat;
    },
    [commit, current],
  );

  // Bulk-deploy up to maxAgents coordinated agents. Each is a distinct seat that
  // still obeys every guardrail (official-API only, per-account caps, warm-up,
  // suppression, shared de-dupe) — scale, not rate-limit evasion.
  const deployAgents = useCallback(
    (n: number, opts?: { language?: string; namePrefix?: string }) => {
      const s = stateRef.current;
      if (!s) return { created: 0, total: 0, capped: false, max: 0 };
      const max = s.settings.fleet.maxAgents || 300;
      if (!can(s.currentRole, "manage_fleet")) {
        return { created: 0, total: s.seats.length, capped: false, max };
      }
      const room = Math.max(0, max - s.seats.length);
      const toCreate = Math.min(Math.max(0, Math.floor(n)), room);
      if (toCreate === 0) return { created: 0, total: s.seats.length, capped: room === 0, max };
      const providers = ["Microsoft Graph", "Gmail API", "SendGrid", "Resend"] as const;
      const now = new Date().toISOString();
      const base = s.seats.length;
      const newSeats: AgentSeat[] = Array.from({ length: toCreate }, (_, i) => {
        const idx = base + i;
        return {
          id: genId("seat"),
          name: `${opts?.namePrefix ?? "Aria Agent"} ${String(idx + 1).padStart(3, "0")}`,
          operatorEmail: `agent${idx + 1}@hermes.example`,
          provider: providers[idx % providers.length],
          status: "active",
          mode: "mock",
          domainVerified: false,
          dailyLimit: 40,
          warmup: true,
          warmupStartCap: 10,
          warmupStepPerDay: 4,
          warmupStartedAt: now,
          minGapMinutes: 12,
          sendWindow: defaultSendWindow(),
          sentToday: 0,
          lastSendAt: null,
          health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
          persona: "Warm, concise, peer-to-peer recruiter. Lead with the candidate's recent work, one genuine compliment, soft 15-minute ask. No AI slop.",
          signature: "",
          language: opts?.language ?? s.settings.defaultLanguage,
          connectedAccount: "",
          createdAt: now,
        };
      });
      commit((prev) =>
        withActivity(
          { ...prev, seats: [...prev.seats, ...newSeats] },
          makeActivity({
            type: "system",
            title: `Deployed ${newSeats.length} Aria agents`,
            notes: `Fleet now ${s.seats.length + newSeats.length}/${max} agents (mock, dry-run; each within official limits).`,
            outcome: `${newSeats.length} deployed`,
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return { created: newSeats.length, total: s.seats.length + newSeats.length, capped: toCreate < Math.floor(n), max };
    },
    [commit],
  );

  const updateSeat = useCallback(
    (id: string, patch: Partial<AgentSeat>) => {
      if (supabaseEnabled && (patch.operatorEmail !== undefined || patch.mode !== undefined)) {
        void patchFleetSeatOnServer(id, { operatorEmail: patch.operatorEmail, mode: patch.mode });
      }
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    },
    [commit],
  );

  const setSeatStatus = useCallback(
    (id: string, status: AgentSeat["status"]) =>
      commit((s) => {
        const seat = s.seats.find((x) => x.id === id);
        const next = { ...s, seats: s.seats.map((x) => (x.id === id ? { ...x, status } : x)) };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Agent ${status}: ${seat?.name ?? id}`,
            notes: `Seat status set to ${status}.`,
            outcome: status,
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      }),
    [commit],
  );

  const connectSeatAccount = useCallback(
    async (id: string, account: string) => {
      if (supabaseEnabled) {
        const synced = await patchFleetSeatOnServer(id, { operatorEmail: account });
        if (!synced.ok) return synced;
      }
      commit((s) => {
        const next = {
          ...s,
          seats: s.seats.map((x) => (x.id === id ? { ...x, connectedAccount: account, operatorEmail: account || x.operatorEmail } : x)),
        };
        const seat = s.seats.find((x) => x.id === id);
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Mailbox connected: ${seat?.name ?? id}`,
            notes: `${account} connected via official API. Verify domain before live sends.`,
            outcome: "Connected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
      return { ok: true };
    },
    [commit],
  );

  const disconnectSeatAccount = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string; dryRun?: boolean }> => {
      // Live mode: revoke + delete the server-side OAuth connection so the refresh
      // token is actually killed. Awaited — the seat is only marked disconnected
      // locally once the server confirms the connection is actually gone, so a
      // failed revoke can't leave a false "disconnected" assurance while the
      // server still holds a live token.
      if (supabaseEnabled) {
        try {
          const res = await fetch("/api/email/disconnect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ seatId: id }),
          });
          const out = (await res.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
            status?: string;
            changed?: boolean;
            detail?: string;
          } | null;
          if (!out?.ok) {
            return { ok: false, error: out?.error ?? `Disconnect failed (${res.status}).` };
          }
          if (out.status === "dry-run" && out.changed === false) {
            return { ok: true, dryRun: true, error: out.detail ?? "Public demo: mailbox connection was not changed." };
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Network error disconnecting mailbox." };
        }
      }
      commit((s) => {
        const seat = s.seats.find((x) => x.id === id);
        const next = {
          ...s,
          seats: s.seats.map((x) => (x.id === id ? { ...x, connectedAccount: "" } : x)),
        };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Mailbox disconnected: ${seat?.name ?? id}`,
            notes: "OAuth email connection removed.",
            outcome: "Disconnected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
      return { ok: true };
    },
    [commit],
  );

  const toggleSeatLive = useCallback(
    async (id: string): Promise<{ ok: boolean; reason: string }> => {
      const s = current();
      const seat = s.seats.find((x) => x.id === id);
      if (!seat) return { ok: false, reason: "Seat not found." };
      if (seat.mode === "live") {
        if (supabaseEnabled) {
          const synced = await patchFleetSeatOnServer(id, { mode: "mock" });
          if (!synced.ok) return { ok: false, reason: synced.error };
        }
        commit((prev) => ({ ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "mock" } : x)) }));
        return { ok: true, reason: "Switched to dry-run (mock)." };
      }
      if (!seat.connectedAccount) return { ok: false, reason: "Connect a mailbox before going live." };
      if (!seat.domainVerified) return { ok: false, reason: "Verify the sending domain (SPF/DKIM/DMARC) first." };
      if (supabaseEnabled) {
        const synced = await patchFleetSeatOnServer(id, { mode: "live", operatorEmail: seat.operatorEmail });
        if (!synced.ok) return { ok: false, reason: synced.error };
      }
      commit((prev) => {
        const next = { ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "live" as const } : x)) };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Agent set LIVE: ${seat.name}`,
            notes: "Seat will send via the official provider API within guardrails.",
            outcome: "Live",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
      return { ok: true, reason: "Seat is live. Sends still require approval + guardrails." };
    },
    [commit, current],
  );

  const verifySeatDomain = useCallback(
    async (id: string): Promise<{ ok: boolean; verified?: boolean; error?: string }> => {
      const s = current();
      const seat = s.seats.find((x) => x.id === id);
      if (!seat) return { ok: false, error: "Seat not found." };
      const domain = seat.operatorEmail.split("@")[1] ?? "";
      if (!domain) return { ok: false, error: "Connect a mailbox before verifying its domain." };
      try {
        const res = await fetch("/api/outreach/verify-domain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seatId: id, domain }),
        });
        const out = (await res.json().catch(() => null)) as { ok?: boolean; verified?: boolean; error?: string } | null;
        if (!out?.ok) {
          return { ok: false, error: out?.error ?? `Verification failed (${res.status}).` };
        }
        if (out.verified) {
          commit((prev) => {
            const next = { ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, domainVerified: true } : x)) };
            return withActivity(
              next,
              makeActivity({
                type: "system",
                title: `Domain verified: ${seat.name}`,
                notes: `${domain} has valid SPF/DKIM/DMARC records.`,
                outcome: "Verified",
                campaignId: null,
                linkedEntityType: null,
                linkedEntityId: null,
              }),
              null,
            );
          });
        }
        return { ok: true, verified: !!out.verified };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error verifying domain." };
      }
    },
    [commit, current],
  );

  /* ---- Fleet: suppression ---------------------------------------------- */

  const addSuppression = useCallback(
    async (entry: { type: SuppressionEntry["type"]; value: string; reason: string; expiresAt?: string | null }) => {
      if (supabaseEnabled && entry.type === "linkedin") {
        return { ok: false, error: "LinkedIn is assisted-manual and has no server-enforced suppression channel." };
      }
      const normalized = entry.type === "linkedin"
        ? entry.value.trim().toLowerCase()
        : normalizeSuppressionValue(entry.type as EnforcedSuppressionType, entry.value);
      if (!normalized) return { ok: false, error: "Enter a valid suppression value." };
      if (supabaseEnabled) {
        const persisted = await persistManualSuppression(
          { ...entry, type: entry.type as EnforcedSuppressionType, value: normalized },
          "POST",
        );
        if (!persisted.ok) return persisted;
      }
      const e: SuppressionEntry = {
        id: genId("supp"),
        type: entry.type,
        value: normalized,
        reason: entry.reason,
        source: "Operator",
        createdAt: new Date().toISOString(),
        expiresAt: entry.expiresAt ?? null,
      };
      commit((s) => withActivity(
        { ...s, suppression: [e, ...s.suppression] },
        makeActivity({
          type: "compliance",
          title: "Suppression added",
          notes: `${e.type}: ${e.value} (${e.reason}).`,
          outcome: "Suppressed",
          campaignId: null,
          linkedEntityType: null,
          linkedEntityId: null,
        }),
        null,
      ));
      return { ok: true, entry: e };
    },
    [commit],
  );

  const removeSuppression = useCallback(
    async (id: string) => {
      const entry = stateRef.current?.suppression.find((item) => item.id === id);
      if (!entry) return { ok: false, error: "Suppression not found." };
      if (supabaseEnabled && entry.type !== "linkedin") {
        const persisted = await persistManualSuppression(
          {
            type: entry.type as EnforcedSuppressionType,
            value: entry.value,
            reason: entry.reason,
            expiresAt: entry.expiresAt,
          },
          "DELETE",
        );
        if (!persisted.ok) return persisted;
      }
      commit((s) => ({ ...s, suppression: s.suppression.filter((item) => item.id !== id) }));
      return { ok: true };
    },
    [commit],
  );

  /* ---- Fleet: coordinated allocation (the anti-double-contact core) ----- */

  // Task 3 — Fleet is a bulk-DRAFTING engine, not a bulk-send engine. Planning
  // (allocateBatch, in fleet.ts) is untouched and still decides who goes to
  // which seat, respecting suppression, the ledger, and daily caps. What this
  // action does with that plan changed: it used to mark candidates "Contacted",
  // stamp lastContactedAt, and write a "sent" ledger entry WITHOUT any approval
  // — a real bypass of the human approval gate that also corrupted the 90-day
  // re-contact dedupe (recontact windows are read from the ledger/lastContactedAt,
  // and both were being written as if a real send had already happened). Now it
  // only ever creates Draft OutreachMessages via the exact same path as a single
  // generateOutreachFor call; stage, lastContactedAt, and the ledger are untouched
  // here and are written exactly once, by approveOutreach, when a human approves
  // each message individually.
  const allocateOutreach = useCallback(
    (opts?: { campaignId?: string; pool?: "ready" | "interested" }): AllocationResult => {
      const s = current();
      const poolKind = opts?.pool ?? "ready";
      const pool = s.candidates.filter((c) => {
        if (opts?.campaignId && c.campaignId !== opts.campaignId) return false;
        if (c.complianceFlags.doNotContact || c.complianceFlags.unsubscribed) return false;
        // Don't re-draft someone who already has an un-actioned draft sitting in
        // the approval queue — without the old eager ledger claim, this is what
        // keeps a repeat allocation run from piling up duplicate drafts.
        if (s.outreach.some((m) => m.candidateId === c.id && m.status === "Needs Approval")) return false;
        if (poolKind === "interested") return c.stage === "Interested";
        return c.matchScore >= s.settings.minScoreToContact && stageRank(c.stage) < 1;
      });
      const activeSeats = s.seats.filter((x) => x.status === "active");
      const result = allocateBatch(pool, activeSeats, s.ledger, s.suppression, s.settings.fleet, new Date());
      if (result.assignments.length === 0) return result;

      const byCand = new Map(s.candidates.map((c) => [c.id, c]));
      const byCampaign = new Map(s.campaigns.map((c) => [c.id, c]));
      const bySeat = new Map(s.seats.map((x) => [x.id, x]));
      const finalTone = effectiveTone(s.skills);

      const drafted: OutreachMessage[] = [];
      for (const a of result.assignments) {
        const candidate = byCand.get(a.candidateId);
        const campaign = candidate && byCampaign.get(candidate.campaignId);
        if (!candidate || !campaign) continue;
        const seat = bySeat.get(a.seatId);
        const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
        const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
        const gen = generateOutreach(candidate, campaign, finalTone, "Email", 1, voice, lang);
        drafted.push(newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1));
      }
      if (drafted.length === 0) return result;

      const affectedCampaigns = new Set(drafted.map((m) => m.campaignId));
      const seatIds = new Set(result.assignments.map((a) => a.seatId));

      commit((prev) => {
        let next: HermesState = { ...prev, outreach: [...drafted, ...prev.outreach] };
        affectedCampaigns.forEach((cid) => {
          if (cid) next = recomputeMetrics(next, cid);
        });
        next = withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Fleet drafted ${drafted.length} outreach messages`,
            notes: `Distributed across ${seatIds.size} agents · ${result.skipped.length} skipped (suppression/dupe) · ${result.deferred.length} deferred (capacity). Every draft awaits human approval. Nothing sent.`,
            outcome: "Drafted / awaiting approval",
            campaignId: opts?.campaignId ?? null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          opts?.campaignId ?? null,
        );
        return next;
      });
      emit({ kind: "allocate", count: drafted.length, campaignId: opts?.campaignId });
      return result;
    },
    [commit, current],
  );

  /* ---- Fleet: parallel sourcing (multiple Aria agents) --------------- */

  const runFleetSourcing = useCallback(
    (opts?: { campaignId?: string; perAgent?: number }) => {
      const s = current();
      const activeSeats = s.seats.filter((x) => x.status === "active");
      const workCampaigns = opts?.campaignId
        ? s.campaigns.filter((c) => c.id === opts.campaignId && c.status !== "Paused")
        : s.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
      if (activeSeats.length === 0 || workCampaigns.length === 0)
        return { sourced: 0, skipped: 0, perSeat: [] as { seatName: string; campaignTitle: string; sourced: number }[] };

      const perAgent = opts?.perAgent ?? 4;
      let acc = [...s.candidates];
      const added: Candidate[] = [];
      const perSeat: { seatName: string; campaignTitle: string; sourced: number }[] = [];
      let totalSkipped = 0;
      const affected = new Set<string>();

      activeSeats.forEach((seat, i) => {
        const campaign = workCampaigns[i % workCampaigns.length];
        const platform: SourcePlatform = campaign.jobAnalysis.department === "Design" ? "LinkedIn" : "GitHub";
        const weights = effectiveWeights(campaign.scoringWeights, s.skills);
        const res = sourceCandidates(campaign, platform, perAgent, acc, acc.length + i * 13, weights);
        acc = [...res.accepted, ...acc];
        added.push(...res.accepted);
        totalSkipped += res.skipped.length;
        affected.add(campaign.id);
        perSeat.push({ seatName: seat.name, campaignTitle: campaign.title, sourced: res.accepted.length });
      });

      commit((prev) => {
        let next: HermesState = { ...prev, candidates: [...added, ...prev.candidates] };
        affected.forEach((cid) => (next = recomputeMetrics(next, cid)));
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Fleet sourcing: ${added.length} candidates`,
            notes: `${activeSeats.length} Aria agents sourced in parallel across ${affected.size} campaign(s). ${totalSkipped} deduped.`,
            outcome: `${added.length} added`,
            campaignId: opts?.campaignId ?? null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          opts?.campaignId ?? null,
        );
        return next;
      });
      return { sourced: added.length, skipped: totalSkipped, perSeat };
    },
    [commit, current],
  );

  /* ---- Skills: learning loop ------------------------------------------- */

  const runLearning = useCallback(() => {
    const s = current();
    const proposals = proposeSkillUpdates(s);
    commit((prev) => {
      const cid = prev.activeCampaignId ?? prev.campaigns[0]?.id ?? null;
      let next = prev;
      if (cid) {
        next = {
          ...next,
          campaigns: next.campaigns.map((c) =>
            c.id === cid ? { ...c, skillUpdates: [...proposals, ...c.skillUpdates] } : c,
          ),
        };
      }
      return withActivity(
        next,
        makeActivity({
          type: "learning",
          title: `Learning run: ${proposals.length} proposals`,
          notes: "Analyzed sourcing outcomes: tone conversion, score-dimension signal, reply mix.",
          outcome: `${proposals.length} proposals`,
          campaignId: cid,
          linkedEntityType: null,
          linkedEntityId: null,
        }),
        cid,
      );
    });
    return proposals;
  }, [commit, current]);

  const acceptSkillLearning = useCallback(
    (key: SkillKey) => {
      const s = current();
      const skill = getSkill(s.skills, key);
      if (!skill) return;
      const patch = learnedParamsFor(key, s);
      const summary =
        key === "outreach_skill"
          ? `Adopt ${patch.preferredTone} as the default tone`
          : key === "scoring_skill"
            ? `Re-weight scoring from observed conversions`
            : key === "reply_classification_skill"
              ? `Tune qualified-interest floor to ${patch.qualifiedInterestFloor}`
              : `Refine sourcing query strategy`;
      commit((prev) => {
        const next = {
          ...prev,
          skills: prev.skills.map((sk) => (sk.key === key ? applyLearning(sk, patch, summary) : sk)),
        };
        return withActivity(
          next,
          makeActivity({
            type: "learning",
            title: `Skill learned: ${key}`,
            notes: `${summary}. Now feeds future ${key.replace("_skill", "")}.`,
            outcome: `v${skill.version + 1}`,
            campaignId: null,
            linkedEntityType: "skill",
            linkedEntityId: key,
          }),
          null,
        );
      });
    },
    [commit, current],
  );

  const updateSkillContent = useCallback(
    (key: SkillKey, content: string): { ok: boolean; error?: string } => {
      commit((s) => ({
        ...s,
        skills: s.skills.map((sk) => (sk.key === key ? { ...sk, content, updatedAt: new Date().toISOString() } : sk)),
      }));
      return { ok: true };
    },
    [commit],
  );

  /* ---- Confidentiality: audited PII reveal ----------------------------- */

  const recordPiiReveal = useCallback(
    (candidateId: string) => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return;
      commit((prev) =>
        withActivity(
          prev,
          makeActivity({
            type: "compliance",
            title: "Candidate PII revealed",
            notes: `Contact details viewed for ${cand.name}. Purpose: outreach.`,
            outcome: "Access logged",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        ),
      );
    },
    [commit, current],
  );

  /* ---- API keys (secret stored server-side; never in client state) ------ */

  const saveApiKey = useCallback(
    async (input: { name: string; provider: ApiKeyProvider; value: string }) => {
      try {
        const res = await fetch("/api/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const json = await res.json();
        if (!json.ok) return { ok: false as const, error: json.error ?? "Save failed." };
        const key: ApiKey = {
          // D-5: use the server-assigned id so client and server agree on the key id.
          id: json.id ?? genId("key"),
          name: input.name,
          provider: input.provider,
          last4: json.last4 ?? "••••",
          status: "untested",
          lastTestedAt: null,
          createdBy: current().settings.operatorName,
          createdAt: new Date().toISOString(),
        };
        commit((prev) =>
          withActivity(
            { ...prev, apiKeys: [key, ...prev.apiKeys] },
            makeActivity({
              type: "system",
              title: `API key saved: ${input.name}`,
              notes: `${input.provider} key stored (••••${key.last4})${json.demo ? " · demo session" : " · backend"}.`,
              outcome: "Saved",
              campaignId: null,
              linkedEntityType: null,
              linkedEntityId: null,
            }),
            null,
          ),
        );
        return { ok: true as const, key, demo: !!json.demo };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Network error." };
      }
    },
    [commit, current],
  );

  const testApiKey = useCallback(
    async (id: string) => {
      const k = current().apiKeys.find((x) => x.id === id);
      try {
        const res = await fetch("/api/keys/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, provider: k?.provider }),
        });
        const json = await res.json();
        const valid = !!(json.ok && json.valid);
        commit((prev) => ({
          ...prev,
          apiKeys: prev.apiKeys.map((x) =>
            x.id === id ? { ...x, status: valid ? "valid" : "invalid", lastTestedAt: new Date().toISOString() } : x,
          ),
        }));
        return { ok: !!json.ok, valid, detail: json.detail ?? json.error ?? "" };
      } catch (e) {
        return { ok: false, valid: false, detail: e instanceof Error ? e.message : "Network error." };
      }
    },
    [commit, current],
  );

  const removeApiKey = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      // D-6: only commit the local removal when the server delete succeeded.
      try {
        const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: body?.error ?? `Delete failed (${res.status}).` };
        }
      } catch (err) {
        // network error — abort, don't remove locally
        return { ok: false, error: err instanceof Error ? err.message : "Network error." };
      }
      commit((prev) => ({ ...prev, apiKeys: prev.apiKeys.filter((x) => x.id !== id) }));
      return { ok: true };
    },
    [commit],
  );

  const setCurrentRole = useCallback(
    (role: Role) => {
      // Live authority comes only from profiles.role. This action exists solely
      // for the explicitly labelled backend-free demo preview.
      if (supabaseEnabled) return;
      commit((prev) =>
        withActivity(
          { ...prev, currentRole: role },
          makeActivity({
            type: "system",
            title: `Access level set to ${role}`,
            notes: "Operator role changed.",
            outcome: role,
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
    },
    [commit],
  );

  /* ---- Guardrails & Aria (the editable agent brain) --------------------- */

  const patchGuardrails = useCallback(
    (patch: Partial<HermesState["settings"]["guardrails"]>, activity?: string) =>
      commit((prev) => {
        const next = { ...prev, settings: { ...prev.settings, guardrails: { ...prev.settings.guardrails, ...patch } } };
        return activity
          ? withActivity(
              next,
              makeActivity({ type: "system", title: activity, notes: "Guardrails updated.", outcome: "Saved", campaignId: null, linkedEntityType: null, linkedEntityId: null }),
              null,
            )
          : next;
      }),
    [commit],
  );

  const updateAriaPrompt = useCallback(
    (text: string) => patchGuardrails({ ariaPrompt: text }, "Aria's master prompt updated"),
    [patchGuardrails],
  );

  const addGuardrailRule = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const rule: GuardrailRule = { id: genId("gr"), text: clean, enabled: true, locked: false };
      commit((prev) =>
        withActivity(
          { ...prev, settings: { ...prev.settings, guardrails: { ...prev.settings.guardrails, rules: [...prev.settings.guardrails.rules, rule] } } },
          makeActivity({ type: "system", title: "Guardrail added", notes: clean, outcome: "Added", campaignId: null, linkedEntityType: null, linkedEntityId: null }),
          null,
        ),
      );
    },
    [commit],
  );

  const toggleGuardrailRule = useCallback(
    (id: string) =>
      commit((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          guardrails: {
            ...prev.settings.guardrails,
            rules: prev.settings.guardrails.rules.map((r) => (r.id === id && !r.locked ? { ...r, enabled: !r.enabled } : r)),
          },
        },
      })),
    [commit],
  );

  const removeGuardrailRule = useCallback(
    (id: string) =>
      commit((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          guardrails: { ...prev.settings.guardrails, rules: prev.settings.guardrails.rules.filter((r) => r.id === id ? r.locked === true : true) },
        },
      })),
    [commit],
  );

  /* ---- Aria Command: parse → preview → execute ------------------------- */

  // "the strong ones" / "anyone perfect" reuse the Mantu Star Rating already
  // computed for every candidate (tania.ts) rather than inventing a new
  // scoring concept just for this feature.
  /**
   * Aria Command — executes a previewed `AriaPlan` step by step, calling
   * `onStep` before and after each one so the console can tick it green (or
   * red) with a real result count. Every step composes EXISTING store
   * actions unchanged (sourceNextBatch, generateOutreachLive,
   * draftFollowUpFor, createBookingFor, toggleVivier, generateReport) — none
   * of them is a send path, so outreach always lands in the same
   * Draft/Needs-Approval queue the human approval gate already governs (see
   * newOutreachMessage in mock-ai.ts). A step with no matched campaign fails
   * cleanly instead of guessing one into existence: a one-line instruction
   * carries too little information to safely fabricate a whole new JD, so
   * the operator picks an existing campaign from Campaigns first.
   */
  const runAriaPlan = useCallback(
    async (
      plan: AriaPlan,
      onStep?: (
        i: number,
        status: "running" | "done" | "failed",
        result?: { count?: number; detail?: string },
      ) => void,
    ): Promise<void> => {
      const campaignId = plan.matchedCampaignId;

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        onStep?.(i, "running");
        try {
          if (!campaignId) {
            onStep?.(i, "failed", {
              detail: "No matching campaign for this instruction. Pick one from Campaigns first.",
            });
            continue;
          }

          if (step.verb === "source") {
            const res = await sourceNextBatch(campaignId, { platform: "Talent Pool", count: step.count ?? 10 });
            if (res.ok) {
              onStep?.(i, "done", {
                count: res.accepted.length,
                detail: `${res.accepted.length} sourced, ${res.skipped.length} skipped`,
              });
            } else {
              onStep?.(i, "failed", { detail: res.error });
            }
            continue;
          }

          if (step.verb === "draft") {
            const s = current();
            const targets = s.candidates
              .filter((c) => c.campaignId === campaignId)
              .filter(
                (c) => !c.complianceFlags.doNotContact && !c.complianceFlags.suppressed && !c.complianceFlags.unsubscribed,
              )
              .filter((c) => stageRank(c.stage) < 1)
              .filter((c) => ARIA_STRONG_RATINGS.includes(c.starRating ?? deriveStarRating(c.matchScore)))
              .filter((c) => !s.outreach.some((m) => m.candidateId === c.id && m.status === "Needs Approval"))
              .slice(0, ARIA_STEP_CANDIDATE_CAP);
            let count = 0;
            for (const cand of targets) {
              const msg = await generateOutreachLive(cand.id);
              if (msg) count += 1;
            }
            onStep?.(i, "done", {
              count,
              detail: `${count} outreach draft${count === 1 ? "" : "s"} queued for approval`,
            });
            continue;
          }

          if (step.verb === "follow-up") {
            const s = current();
            const due = deriveFollowUpsDue(s)
              .filter((d) => s.candidates.find((c) => c.id === d.candidateId)?.campaignId === campaignId)
              .slice(0, ARIA_STEP_CANDIDATE_CAP);
            let count = 0;
            for (const d of due) {
              const msg = await draftFollowUpFor(d.candidateId);
              if (msg) count += 1;
            }
            onStep?.(i, "done", {
              count,
              detail: `${count} follow-up draft${count === 1 ? "" : "s"} queued for approval`,
            });
            continue;
          }

          if (step.verb === "book") {
            const s = current();
            const targets = s.candidates
              .filter((c) => c.campaignId === campaignId && c.stage === "Interested")
              .filter((c) => (c.starRating ?? deriveStarRating(c.matchScore)) === ARIA_PERFECT_RATING)
              .filter(
                (c) => !c.complianceFlags.doNotContact && !c.complianceFlags.suppressed && !c.complianceFlags.unsubscribed,
              )
              .slice(0, ARIA_STEP_CANDIDATE_CAP);
            let count = 0;
            let lastError: string | undefined;
            for (const cand of targets) {
              const res = await createBookingFor(cand.id);
              if (res.ok) count += 1;
              else lastError = res.error;
            }
            if (count > 0 || targets.length === 0) {
              onStep?.(i, "done", {
                count,
                detail:
                  targets.length === 0
                    ? "No TopGun candidates at Interested stage to book."
                    : `${count} interview${count === 1 ? "" : "s"} booked`,
              });
            } else {
              onStep?.(i, "failed", { detail: lastError ?? "Booking failed." });
            }
            continue;
          }

          if (step.verb === "pool") {
            const s = current();
            const targets = s.candidates
              .filter((c) => c.campaignId === campaignId && !c.vivier)
              .filter((c) => c.stage === "Not Interested" || c.stage === "Rejected")
              .filter((c) => (c.starRating ?? deriveStarRating(c.matchScore)) !== "D")
              .slice(0, ARIA_STEP_CANDIDATE_CAP);
            targets.forEach((c) => toggleVivier(c.id));
            onStep?.(i, "done", {
              count: targets.length,
              detail: `${targets.length} candidate${targets.length === 1 ? "" : "s"} added to #Vivier`,
            });
            continue;
          }

          if (step.verb === "report") {
            const report = generateReport(campaignId);
            onStep?.(
              i,
              report ? "done" : "failed",
              report
                ? { count: 1, detail: `Weekly report generated (${report.periodLabel})` }
                : { detail: "Could not generate a report for this campaign." },
            );
            continue;
          }

          onStep?.(i, "failed", { detail: "Unrecognized step." });
        } catch (err) {
          onStep?.(i, "failed", { detail: err instanceof Error ? err.message : "Unexpected error." });
        }
      }
    },
    [current, sourceNextBatch, generateOutreachLive, draftFollowUpFor, createBookingFor, toggleVivier, generateReport],
  );

  // "Ask Aria" — first tries to parse the instruction as an Aria Command (see
  // aria-command.ts). When it resolves into a real plan, Aria only DESCRIBES
  // what it would do here — actually running it goes through runAriaPlan /
  // the Aria Command console, never from this stub. When nothing actionable
  // parses (e.g. a policy statement like "never contact anyone at our
  // current clients"), falls back to the original behavior: captures the
  // instruction as a new guardrail rule. (Live mode would route this through
  // the model with an API key.)
  const askAria = useCallback(
    (instruction: string): { reply: string } => {
      const clean = instruction.trim();
      if (!clean) {
        return { reply: "Tell me what to change, or ask me to source/draft/book something, and I'll take it from there." };
      }

      const s = current();
      const plan = parseCommand(clean, { campaigns: s.campaigns.map(campaignToAriaContext) });
      if (plan.steps.length > 0) {
        return {
          reply: `Here's what I'd do: ${plan.summary} Open Aria Command to review the plan and run it. Nothing executes from here.`,
        };
      }

      addGuardrailRule(clean);
      return {
        reply: `Done. Added that as an active guardrail: "${clean}". Every agent will follow it on the next run. You can edit or remove it below anytime.`,
      };
    },
    [addGuardrailRule, current],
  );

  /* ---- LLM providers ---------------------------------------------------- */

  const addProvider = useCallback(
    (p: Omit<LlmProvider, "id">): LlmProvider => {
      const provider: LlmProvider = { ...p, id: genId("prov") };
      commit((s) =>
        withActivity(
          { ...s, settings: { ...s.settings, llmProviders: [...(s.settings.llmProviders ?? []), provider] } },
          makeActivity({
            type: "system",
            title: `LLM provider added: ${provider.label}`,
            notes: `${provider.kind} provider configured.`,
            outcome: "Added",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return provider;
    },
    [commit],
  );

  const updateProvider = useCallback(
    (id: string, patch: Partial<LlmProvider>) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          llmProviders: (s.settings.llmProviders ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
        },
      })),
    [commit],
  );

  const removeProvider = useCallback(
    (id: string) =>
      commit((s) => {
        // D-3: cascade — drop savedModels, clear seat providerId, promote new default.
        const removedProvider = (s.settings.llmProviders ?? []).find((p) => p.id === id);
        const remaining = (s.settings.llmProviders ?? []).filter((p) => p.id !== id);
        let updatedProviders = remaining;
        if (removedProvider?.isDefault) {
          const firstEnabled = remaining.find((p) => p.enabled);
          if (firstEnabled) {
            updatedProviders = remaining.map((p) => ({ ...p, isDefault: p.id === firstEnabled.id }));
          }
        }
        return withActivity(
          {
            ...s,
            settings: {
              ...s.settings,
              llmProviders: updatedProviders,
              // Drop every saved model that belonged to the removed provider.
              savedModels: (s.settings.savedModels ?? []).filter((m) => m.providerId !== id),
            },
            // Clear providerId on any seat that referenced the removed provider.
            seats: s.seats.map((seat) =>
              seat.providerId === id ? { ...seat, providerId: undefined } : seat,
            ),
          },
          makeActivity({
            type: "system",
            title: "LLM provider removed",
            notes: `Provider ${id} removed.`,
            outcome: "Removed",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      }),
    [commit],
  );

  const addMcpServer = useCallback(
    (m: Omit<McpServerConfig, "id" | "status">): McpServerConfig => {
      const guard = validateMcpBaseUrl(m.url);
      if (!guard.ok) throw new Error(guard.error);
      const server: McpServerConfig = { ...m, id: genId("mcp"), status: "untested" };
      commit((s) =>
        withActivity(
          { ...s, settings: { ...s.settings, mcpServers: [...(s.settings.mcpServers ?? []), server] } },
          makeActivity({
            type: "system",
            title: `MCP server added: ${server.name}`,
            notes: `Tool source ${server.url} registered.`,
            outcome: "Added",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return server;
    },
    [commit],
  );

  const updateMcpServer = useCallback(
    (id: string, patch: Partial<McpServerConfig>) => {
      const existing = (current().settings.mcpServers ?? []).find((m) => m.id === id);
      const nextUrl = patch.url ?? existing?.url;
      if (nextUrl) {
        const guard = validateMcpBaseUrl(nextUrl);
        if (!guard.ok) throw new Error(guard.error);
      }
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          mcpServers: (s.settings.mcpServers ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
        },
      }));
    },
    [commit, current],
  );

  const removeMcpServer = useCallback(
    (id: string) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          mcpServers: (s.settings.mcpServers ?? []).filter((m) => m.id !== id),
        },
      })),
    [commit],
  );

  /** Probe a registered MCP server (the /api/mcp/test route runs the MCP `initialize`
   *  handshake) and record the result on the server config. */
  const testMcpServer = useCallback(
    async (id: string): Promise<{ ok: boolean; toolCount?: number; error?: string }> => {
      const s = current();
      const server = (s.settings.mcpServers ?? []).find((m) => m.id === id);
      if (!server) return { ok: false, error: "MCP server not found." };
      let out: { ok?: boolean; toolCount?: number; toolNames?: string[]; serverName?: string; error?: string };
      try {
        const res = await fetch("/api/mcp/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: server.url,
            apiKeyId: server.apiKeyId,
            authStyle: server.authStyle,
            authQueryParam: server.authQueryParam,
          }),
        });
        out = (await res.json().catch(() => ({ ok: false, error: "Bad response from MCP test." }))) as typeof out;
      } catch (err) {
        out = { ok: false, error: err instanceof Error ? err.message : "MCP test failed." };
      }
      const now = new Date().toISOString();
      commit((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          mcpServers: (prev.settings.mcpServers ?? []).map((m) =>
            m.id === id
              ? {
                  ...m,
                  status: out.ok ? "connected" : "error",
                  lastTestedAt: now,
                  toolCount: out.ok ? out.toolCount : m.toolCount,
                  toolNames: out.ok ? out.toolNames : m.toolNames,
                }
              : m,
          ),
        },
      }));
      return { ok: !!out.ok, toolCount: out.toolCount, error: out.error };
    },
    [commit, current],
  );

  /* ---- Dust (dust.tt) agent-platform integration ------------------------- */

  /** Test a just-entered workspace id + API key (POST /api/dust/test) without
   *  persisting anything — used by the Settings Connect/Reconnect flow before
   *  the key is saved to the vault. */
  const testDustConnection = useCallback(
    async (workspaceId: string, apiKey: string, region: DustRegion = "us") => {
      try {
        const res = await fetch("/api/dust/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, apiKey, region }),
        });
        const json = (await res.json().catch(() => ({ ok: false, error: "Bad response from Dust." }))) as {
          ok?: boolean;
          agents?: DustAgentSummary[];
          error?: string;
        };
        if (json.ok) return { ok: true as const, agents: json.agents ?? [] };
        return { ok: false as const, error: json.error ?? "Could not connect to Dust." };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Network error." };
      }
    },
    [],
  );

  /** Full Connect flow: live-test the credentials, store and mark the key valid,
   * then write the non-secret configuration through the normalized admin-owned
   * Dust authority route. workspace_state is never an execution authority. */
  const connectDust = useCallback(
    async (workspaceId: string, apiKey: string, region: DustRegion = "us") => {
      const test = await testDustConnection(workspaceId, apiKey, region);
      if (!test.ok) return { ok: false as const, error: test.error };
      const agents = test.agents ?? [];
      const saved = await saveApiKey({ name: "Dust", provider: "Dust", value: apiKey });
      if (!saved.ok || !saved.key) {
        return { ok: false as const, error: saved.error ?? "Could not save the Dust API key." };
      }
      const apiKeyId = saved.key.id;
      const verified = await testApiKey(apiKeyId);
      if (!verified.ok || !verified.valid) {
        return { ok: false as const, error: verified.detail || "Could not verify the stored Dust API key." };
      }
      let configured: { ok?: boolean; error?: string };
      try {
        const response = await fetch("/api/integrations/dust/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, region, apiKeyId, agents }),
        });
        configured = (await response.json().catch(() => ({ ok: false, error: "Bad response from the server." }))) as {
          ok?: boolean;
          error?: string;
        };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Network error." };
      }
      if (!configured.ok) {
        return { ok: false as const, error: configured.error ?? "Could not save the Dust configuration." };
      }
      commit((prev) => {
        return withActivity(
          {
            ...prev,
            settings: { ...prev.settings, dust: undefined },
          },
          makeActivity({
            type: "system",
            title: "Dust connected",
            notes: `Workspace ${workspaceId} linked · ${agents.length} agent${agents.length === 1 ? "" : "s"} available.`,
            outcome: "Connected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
      return { ok: true as const };
    },
    [testDustConnection, saveApiKey, testApiKey, commit],
  );

  const updateDustAgentLock = useCallback(
    async (task: DustTask, agentSId: string) => {
      try {
        const response = await fetch("/api/integrations/dust/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, agentSId }),
        });
        const body = (await response.json().catch(() => ({ ok: false, error: "Bad response from the server." }))) as {
          ok?: boolean;
          error?: string;
        };
        return body.ok
          ? { ok: true as const }
          : { ok: false as const, error: body.error ?? "Could not save the Dust agent lock." };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Network error." };
      }
    },
    [],
  );

  const disconnectDust = useCallback(
    async () => {
      try {
        const response = await fetch("/api/integrations/dust/config", { method: "DELETE" });
        const body = (await response.json().catch(() => ({ ok: false, error: "Bad response from the server." }))) as {
          ok?: boolean;
          error?: string;
        };
        if (!body.ok) return { ok: false as const, error: body.error ?? "Could not disconnect Dust." };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Network error." };
      }
      commit((prev) =>
        withActivity(
          { ...prev, settings: { ...prev.settings, dust: undefined } },
          makeActivity({
            type: "system",
            title: "Dust disconnected",
            notes: "Workspace unlinked. The vault key was left in place. Remove it from Access & Keys if no longer needed.",
            outcome: "Disconnected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return { ok: true as const };
    },
    [commit],
  );

  /** Run one locked Dust agent turn. The server resolves workspace, credential,
   * and task lock from normalized authority; this call sends only task + text. */
  const runDustTask = useCallback(async (task: DustTask, message: string) => {
    try {
      const res = await fetch("/api/dust/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, message }),
      });
      const json = (await res.json().catch(() => ({ ok: false, error: "Bad response from Dust." }))) as {
        ok?: boolean;
        text?: string;
        agentId?: string;
        error?: string;
      };
      if (json.ok) return { ok: true as const, text: json.text ?? "", agentId: json.agentId };
      return { ok: false as const, error: json.error ?? "Dust run failed." };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Network error." };
    }
  }, []);

  const setDefaultProvider = useCallback(
    (id: string) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          llmProviders: (s.settings.llmProviders ?? []).map((p) => ({ ...p, isDefault: p.id === id })),
        },
      })),
    [commit],
  );

  /* ---- Saved models ------------------------------------------------------ */

  const addModel = useCallback(
    (m: Omit<SavedModel, "id">): SavedModel => {
      const model: SavedModel = { ...m, id: genId("model") };
      commit((s) =>
        withActivity(
          { ...s, settings: { ...s.settings, savedModels: [...(s.settings.savedModels ?? []), model] } },
          makeActivity({
            type: "system",
            title: `Model added: ${model.label}`,
            notes: `${model.modelName} registered under provider ${model.providerId}.`,
            outcome: "Added",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return model;
    },
    [commit],
  );

  const updateModel = useCallback(
    (id: string, patch: Partial<SavedModel>) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          savedModels: (s.settings.savedModels ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
        },
      })),
    [commit],
  );

  const removeModel = useCallback(
    (id: string) =>
      commit((s) => {
        // D-4: cascade — prune defaultModels entries and clear seat modelId references.
        const defaultModels = { ...(s.settings.defaultModels ?? {}) };
        (Object.keys(defaultModels) as Array<keyof typeof defaultModels>).forEach((task) => {
          if (defaultModels[task] === id) delete defaultModels[task];
        });
        return withActivity(
          {
            ...s,
            settings: {
              ...s.settings,
              savedModels: (s.settings.savedModels ?? []).filter((m) => m.id !== id),
              defaultModels,
            },
            // Null modelId on any seat that referenced the removed model.
            seats: s.seats.map((seat) =>
              seat.modelId === id ? { ...seat, modelId: undefined } : seat,
            ),
          },
          makeActivity({
            type: "system",
            title: "Model removed",
            notes: `Model ${id} removed from registry.`,
            outcome: "Removed",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      }),
    [commit],
  );

  const setModelDefaultForTask = useCallback(
    (id: string, task: ModelTask) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          // Remove this task from any other model first, then assign it here.
          savedModels: (s.settings.savedModels ?? []).map((m) => ({
            ...m,
            defaultForTask: m.id === id
              ? [...new Set([...(m.defaultForTask ?? []), task])]
              : (m.defaultForTask ?? []).filter((t) => t !== task),
          })),
          defaultModels: { ...(s.settings.defaultModels ?? {}), [task]: id },
        },
      })),
    [commit],
  );

  /* ---- Tools ------------------------------------------------------------- */

  const toggleTool = useCallback(
    (toolId: ToolId) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          tools: (s.settings.tools ?? []).map((t) => (t.id === toolId ? { ...t, enabled: !t.enabled } : t)),
        },
      })),
    [commit],
  );

  /* ---- Per-agent LLM assignment ----------------------------------------- */

  const assignAgentProvider = useCallback(
    (seatId: string, providerId: string) =>
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === seatId ? { ...x, providerId } : x)) })),
    [commit],
  );

  const assignAgentModel = useCallback(
    (seatId: string, modelId: string) =>
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === seatId ? { ...x, modelId } : x)) })),
    [commit],
  );

  const assignAgentTools = useCallback(
    (seatId: string, toolIds: ToolId[]) =>
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === seatId ? { ...x, toolIds } : x)) })),
    [commit],
  );

  /* ---- Chat ---------------------------------------------------------------- */

  const createChatThread = useCallback(
    (seatId: string): ChatThread => {
      const s = current();
      const seat = s.seats.find((x) => x.id === seatId);
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id: genId("chat"),
        seatId,
        title: `Chat with ${seat?.name ?? seatId}`,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      commit((prev) => ({ ...prev, chats: [thread, ...prev.chats] }));
      return thread;
    },
    [commit, current],
  );

  const deleteChatThread = useCallback(
    (id: string) => commit((s) => ({ ...s, chats: s.chats.filter((t) => t.id !== id) })),
    [commit],
  );

  /** Empty a thread's message history in place (keeps the thread/id). Used by the
   *  chat composer's /clear command. */
  const clearChatThread = useCallback(
    (id: string) =>
      commit((s) => ({
        ...s,
        chats: s.chats.map((t) =>
          t.id === id ? { ...t, messages: [], updatedAt: new Date().toISOString() } : t,
        ),
      })),
    [commit],
  );

  const appendChatMessage = useCallback(
    (threadId: string, msg: ChatMessage) =>
      commit((s) => ({
        ...s,
        chats: s.chats.map((t) =>
          t.id === threadId
            ? { ...t, messages: [...t.messages, msg], updatedAt: new Date().toISOString() }
            : t,
        ),
      })),
    [commit],
  );

  const updateChatMessage = useCallback(
    (threadId: string, msgId: string, patch: Partial<ChatMessage>) =>
      commit((s) => ({
        ...s,
        chats: s.chats.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: t.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      })),
    [commit],
  );

  const sendChat = useCallback(
    async (threadId: string, text: string) => {
      const s = current();
      const thread = s.chats.find((t) => t.id === threadId);
      if (!thread) return;
      const seat = s.seats.find((x) => x.id === thread.seatId);
      const now = new Date().toISOString();

      // 1. Append user message immediately.
      const userMsg: ChatMessage = { id: genId("cmsg"), role: "user", content: text, at: now };
      appendChatMessage(threadId, userMsg);

      // 2. Append a pending assistant bubble.
      const assistantId = genId("cmsg");
      appendChatMessage(threadId, {
        id: assistantId,
        role: "assistant",
        content: "",
        at: new Date().toISOString(),
        pending: true,
      });

      // 3. Build conversation context (stateRef is current after appendChatMessage calls).
      const latestThread = current().chats.find((t) => t.id === threadId);
      const history = (latestThread?.messages ?? [])
        .filter((m) => !m.pending && m.id !== assistantId && m.role !== "system")
        .map((m) => `${m.role === "user" ? "User" : "Aria"}: ${m.content}`)
        .join("\n");
      const conversationPrompt = history ? `${history}\nAria:` : "Aria:";

      // S-3 / F-2: compose ariaPrompt + seat persona into the prompt (NOT the system field).
      const ariaPrompt = s.settings.guardrails?.ariaPrompt;
      const personaBase = seat?.persona
        ? `${seat.persona}\n\nAria guardrail: text generation only — never auto-send outreach.`
        : "You are Aria, the recruiting operations brain. Be warm, concise, and practical. Text generation only — never auto-send outreach.";
      const guardrails = ariaPrompt || "";
      const effectivePersona = guardrails ? `${guardrails}\n\n${personaBase}` : personaBase;
      // Full prompt has persona as a prefix (persona in prompt, never in the system field per S-3).
      const fullPrompt = `${effectivePersona}\n\n${conversationPrompt}`;

      // F-7: resolve the configured model for the chat task.
      const chatModelId = seat?.modelId ?? s.settings.defaultModels?.chat;
      const chatModelName = chatModelId
        ? (s.settings.savedModels ?? []).find((m) => m.id === chatModelId)?.modelName
        : undefined;

      // Track whether ANY live path was actually attempted below. The mock/"[Demo]"
      // reply is only legitimate when nothing was attempted (pure demo, no live
      // runtime configured at all). A live attempt that fails must surface as a
      // real error, never a fabricated normal-looking answer.
      let attemptedLive = false;
      let liveError: string | null = null;

      // 3b. Cloud + MCP tools: when a cloud Anthropic provider is configured for chat and
      // the workspace has enabled MCP servers, route through the server-side tool-calling
      // loop so the agent can actually use those tools. Non-streaming (the loop completes
      // server-side); falls through to the streaming Aria path on any miss, and only ends
      // in the mock if that path is also unavailable/fails.
      const chatAiCfg = resolveAiProvider(s.settings, "chat", {
        providerId: seat?.providerId,
        modelId: seat?.modelId,
      });
      const enabledMcp = (s.settings.mcpServers ?? [])
        .filter((m) => m.enabled)
        .map((m) => ({
          url: m.url,
          ...(m.apiKeyId ? { apiKeyId: m.apiKeyId } : {}),
          ...(m.authStyle ? { authStyle: m.authStyle } : {}),
          ...(m.authQueryParam ? { authQueryParam: m.authQueryParam } : {}),
        }));
      const webResearch = s.settings.webResearch !== false;
      // Active campaign context: lets chat call the compliant search_candidates tool
      // (route.ts) so a recruiter can source candidates without leaving the conversation.
      const activeCampaign = s.campaigns.find((c) => c.id === s.activeCampaignId) ?? s.campaigns[0];
      const existingForCampaign = activeCampaign
        ? s.candidates.filter((c) => c.campaignId === activeCampaign.id)
        : [];
      if (chatAiCfg && (enabledMcp.length || webResearch || activeCampaign)) {
        attemptedLive = true;
        try {
          const res = await fetch("/api/hermes/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task: "chat",
              prompt: fullPrompt,
              provider: chatAiCfg.provider,
              ...(chatAiCfg.model && { model: chatAiCfg.model }),
              ...(chatAiCfg.apiKeyId && { apiKeyId: chatAiCfg.apiKeyId }),
              mcpServers: enabledMcp,
              webResearch,
              ...(activeCampaign && { campaign: activeCampaign, existing: existingForCampaign }),
            }),
          });
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; text?: string; reason?: string }
            | null;
          if (data?.ok && data.text) {
            updateChatMessage(threadId, assistantId, { content: data.text, pending: false });
            return;
          }
          liveError = data?.reason ?? `Chat tool loop failed (${res.status}).`;
        } catch (err) {
          // Genuine failure — recorded, not swallowed. Still let the streaming Aria
          // path below have a chance before surfacing it.
          liveError = err instanceof Error ? err.message : "Network error contacting the chat tool loop.";
        }
      }

      // 4. Live mode: try the Aria proxy with streaming.
      if (hermesAvailable(s.settings)) {
        attemptedLive = true;
        // F-5: create an AbortController so the caller can cancel mid-stream.
        const controller = new AbortController();
        chatAbortControllers.current.set(threadId, controller);
        try {
          const res = await fetch("/api/hermes/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task: "chat",
              // S-3: persona goes in the prompt, NOT as a separate system field.
              prompt: fullPrompt,
              stream: true,
              ...(chatModelName && { model: chatModelName }),
              hermesApiUrl: s.settings.hermesApiUrl,
              hermesApiKeyId: s.settings.hermesApiKeyId,
            }),
            signal: controller.signal,
          });
          if (res.ok && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";
            let leftover = ""; // F-6: carry partial SSE lines across chunk boundaries
            // Throttle intermediate store commits to ~every 75ms: `accumulated` still
            // gathers every delta unconditionally, so the final flush after the loop
            // (and the abort/error paths below) always sees the complete text — only the
            // frequency of mid-stream repaints changes, never what the user ends up seeing.
            let lastFlushAt = 0;
            const STREAM_FLUSH_INTERVAL_MS = 75;
            outer: while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const rawChunk = leftover + decoder.decode(value, { stream: true });
              const lines = rawChunk.split("\n");
              leftover = lines.pop() ?? ""; // last element may be an incomplete line
              for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const raw = line.slice(5).trim();
                if (raw === "[DONE]") break outer;
                try {
                  const parsed = JSON.parse(raw) as {
                    choices?: { delta?: { content?: string } }[];
                  };
                  const delta = parsed.choices?.[0]?.delta?.content ?? "";
                  if (delta) {
                    accumulated += delta;
                    const nowMs = Date.now();
                    if (nowMs - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
                      lastFlushAt = nowMs;
                      updateChatMessage(threadId, assistantId, { content: accumulated, pending: true });
                    }
                  }
                } catch {
                  /* malformed SSE chunk — continue */
                }
              }
            }
            chatAbortControllers.current.delete(threadId);
            updateChatMessage(threadId, assistantId, {
              content: accumulated || "(no response)",
              pending: false,
            });
            return;
          }
          liveError = `Aria runtime returned ${res.status}.`;
        } catch (err) {
          chatAbortControllers.current.delete(threadId);
          // F-5: if aborted, mark the bubble cancelled and do NOT fall through to mock.
          if (err instanceof Error && err.name === "AbortError") {
            updateChatMessage(threadId, assistantId, { content: "(cancelled)", pending: false });
            return;
          }
          liveError = err instanceof Error ? err.message : "Streaming error contacting the Aria runtime.";
        }
      }

      // 5. A live runtime was configured and attempted, but every path failed —
      // surface a genuine error bubble. Never fabricate a normal-looking reply here.
      if (attemptedLive) {
        updateChatMessage(threadId, assistantId, {
          content: liveError ?? "Aria couldn't reach the live model. Try again in a moment.",
          pending: false,
          error: true,
        });
        return;
      }

      // 6. Mock reply — only reached when no live runtime is configured at all.
      const seatName = seat?.name ?? "Aria";
      await new Promise<void>((r) => setTimeout(r, 350));
      updateChatMessage(threadId, assistantId, {
        content: `[Demo] Hi from ${seatName}! I'm your Aria agent. Ask me about campaigns, candidates, or outreach strategy. To enable live AI replies, connect the Aria runtime in Settings → Aria Agent.`,
        pending: false,
      });
    },
    [current, appendChatMessage, updateChatMessage],
  );

  // F-5: cancel an in-flight sendChat stream (call on component unmount or thread delete).
  const cancelChat = useCallback(
    (threadId: string) => {
      chatAbortControllers.current.get(threadId)?.abort();
      chatAbortControllers.current.delete(threadId);
    },
    [],
  );

  /* ---- Memory -------------------------------------------------------------- */

  const addMemory = useCallback(
    (seatId: string, kind: MemoryKind, content: string): MemoryEntry => {
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id: genId("mem"),
        seatId,
        kind,
        content: content.trim(),
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      commit((s) =>
        withActivity(
          { ...s, memory: [entry, ...s.memory] },
          makeActivity({
            type: "system",
            title: `Memory stored: ${kind}`,
            notes: content.trim().slice(0, 80),
            outcome: "Stored",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return entry;
    },
    [commit],
  );

  const updateMemory = useCallback(
    (id: string, patch: Partial<Pick<MemoryEntry, "kind" | "content" | "pinned">>) =>
      commit((s) => ({
        ...s,
        memory: s.memory.map((m) =>
          m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m,
        ),
      })),
    [commit],
  );

  const removeMemory = useCallback(
    (id: string) =>
      commit((s) => ({ ...s, memory: s.memory.filter((m) => m.id !== id) })),
    [commit],
  );

  const togglePinMemory = useCallback(
    (id: string) =>
      commit((s) => ({
        ...s,
        memory: s.memory.map((m) =>
          m.id === id ? { ...m, pinned: !m.pinned, updatedAt: new Date().toISOString() } : m,
        ),
      })),
    [commit],
  );

  /* ---- Schedules ----------------------------------------------------------- */

  const addSchedule = useCallback(
    (job: Omit<CronJob, "id" | "createdAt" | "lastRunAt">): CronJob => {
      const now = new Date().toISOString();
      const entry: CronJob = {
        ...job,
        id: genId("sched"),
        lastRunAt: null,
        createdAt: now,
      };
      commit((s) =>
        withActivity(
          { ...s, schedules: [entry, ...s.schedules] },
          makeActivity({
            type: "system",
            title: `Schedule created: ${entry.name}`,
            notes: `${entry.cadence} ${entry.task} job added.`,
            outcome: "Created",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return entry;
    },
    [commit],
  );

  const updateSchedule = useCallback(
    (id: string, patch: Partial<Omit<CronJob, "id" | "createdAt">>) =>
      commit((s) => ({
        ...s,
        schedules: s.schedules.map((j) => (j.id === id ? { ...j, ...patch } : j)),
      })),
    [commit],
  );

  const removeSchedule = useCallback(
    (id: string) =>
      commit((s) =>
        withActivity(
          { ...s, schedules: s.schedules.filter((j) => j.id !== id) },
          makeActivity({
            type: "system",
            title: "Schedule removed",
            notes: `Job ${id} deleted.`,
            outcome: "Removed",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      ),
    [commit],
  );

  const toggleSchedule = useCallback(
    (id: string) =>
      commit((s) => ({
        ...s,
        schedules: s.schedules.map((j) => (j.id === id ? { ...j, enabled: !j.enabled } : j)),
      })),
    [commit],
  );

  /* ---- Interviewers ---------------------------------------------------------
     Real registered staff, admin-managed (see interviewer-panel.tsx). Bookings
     denormalize name/email as plain strings, so editing/removing an interviewer
     here never rewrites history — see resolveBookingSlot below. */

  const addInterviewer = useCallback(
    (input: { name: string; email: string; role?: string }): Interviewer => {
      const entry: Interviewer = {
        id: genId("intv"),
        name: input.name,
        email: input.email,
        role: input.role,
        active: true,
      };
      commit((s) =>
        withActivity(
          { ...s, interviewers: [entry, ...s.interviewers] },
          makeActivity({
            type: "system",
            title: `Interviewer added: ${entry.name}`,
            notes: entry.role ? `${entry.role}. Available for round-robin booking.` : "Available for round-robin booking.",
            outcome: "Created",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      );
      return entry;
    },
    [commit],
  );

  const updateInterviewer = useCallback(
    (id: string, patch: Partial<Omit<Interviewer, "id">>) =>
      commit((s) => ({
        ...s,
        interviewers: s.interviewers.map((iv) => (iv.id === id ? { ...iv, ...patch } : iv)),
      })),
    [commit],
  );

  const removeInterviewer = useCallback(
    (id: string) =>
      commit((s) =>
        withActivity(
          { ...s, interviewers: s.interviewers.filter((iv) => iv.id !== id) },
          makeActivity({
            type: "system",
            title: "Interviewer removed",
            notes: `Interviewer ${id} deleted from the roster.`,
            outcome: "Removed",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        ),
      ),
    [commit],
  );

  const resetDemo = useCallback(() => {
    const fresh = buildSeedState();
    stateRef.current = fresh;
    // In LIVE mode, do NOT auto-persist the reset — that would wipe the SHARED
    // workspace for every member. Reset only the local view; reload re-hydrates.
    if (supabaseEnabled) skipNextPersist.current = true;
    setState(fresh);
  }, []);

  const actions: HermesActions = useMemo(
    () => ({
      setActiveCampaign,
      createCampaignFromAnalysis,
      updateCampaign,
      regenerateQueries,
      sourceNextBatch,
      addCandidateFromGithub,
      addCandidateManual,
      startSillageMapping,
      checkSillageMapping,
      sourceFromApollo,
      enrichApolloCandidate,
      sourceFromSeamless,
      startSeamlessResearch,
      checkSeamlessResearch,
      runSourcingAgent,
      generateOutreachFor,
      generateOutreachLive,
      updateOutreach,
      regenerateOutreach,
      approveOutreach,
      confirmManualSend,
      sendApprovedOutreach,
      rejectOutreach,
      draftFollowUpFor,
      draftRecontactFor,
      classifyAndStoreReply,
      markReplyHandled,
      applyReplyAction,
      draftReplyResponse,
      createBookingFor,
      updateBooking,
      generateReport,
      setSkillUpdateStatus,
      setCandidateStage,
      setCandidatePhone,
      addCandidateNote,
      setRejectionReason,
      setCandidateRating,
      setCandidateLeadSource,
      toggleVivier,
      savePrequal,
      setPrequalOutcome,
      addInterview,
      updateInterview,
      advanceChatboxSubmission,
      setChatboxSubmissionStatus,
      addChatboxSubmission,
      suppressCandidate,
      markDoNotContact,
      restoreCandidateContact,
      unsubscribeCandidate,
      anonymizeCandidate,
      exportCandidate,
      updateSettings,
      updateIntegration,
      toggleIntegrationMode,
      testIntegration,
      addSeat,
      deployAgents,
      updateSeat,
      setSeatStatus,
      connectSeatAccount,
      disconnectSeatAccount,
      toggleSeatLive,
      verifySeatDomain,
      addSuppression,
      removeSuppression,
      allocateOutreach,
      runFleetSourcing,
      runLearning,
      acceptSkillLearning,
      updateSkillContent,
      recordPiiReveal,
      saveApiKey,
      testApiKey,
      removeApiKey,
      setCurrentRole,
      updateAriaPrompt,
      addGuardrailRule,
      toggleGuardrailRule,
      removeGuardrailRule,
      askAria,
      runAriaPlan,
      addProvider,
      updateProvider,
      removeProvider,
      setDefaultProvider,
      addMcpServer,
      updateMcpServer,
      removeMcpServer,
      testMcpServer,
      testDustConnection,
      connectDust,
      updateDustAgentLock,
      disconnectDust,
      runDustTask,
      addModel,
      updateModel,
      removeModel,
      setModelDefaultForTask,
      toggleTool,
      assignAgentProvider,
      assignAgentModel,
      assignAgentTools,
      logActivity,
      resetDemo,
      createChatThread,
      deleteChatThread,
      clearChatThread,
      appendChatMessage,
      updateChatMessage,
      sendChat,
      cancelChat,
      addMemory,
      updateMemory,
      removeMemory,
      togglePinMemory,
      addSchedule,
      updateSchedule,
      removeSchedule,
      toggleSchedule,
      addInterviewer,
      updateInterviewer,
      removeInterviewer,
    }),
    [
      setActiveCampaign, createCampaignFromAnalysis, updateCampaign, regenerateQueries,
      sourceNextBatch, addCandidateFromGithub, addCandidateManual, startSillageMapping, checkSillageMapping, sourceFromApollo, enrichApolloCandidate, sourceFromSeamless, startSeamlessResearch, checkSeamlessResearch, runSourcingAgent, generateOutreachFor, generateOutreachLive, updateOutreach, regenerateOutreach,
      approveOutreach, confirmManualSend, sendApprovedOutreach, rejectOutreach, draftFollowUpFor, draftRecontactFor, classifyAndStoreReply, markReplyHandled,
      applyReplyAction, draftReplyResponse, createBookingFor, updateBooking, generateReport,
      setSkillUpdateStatus, setCandidateStage, setCandidatePhone, addCandidateNote, setRejectionReason,
      setCandidateRating, setCandidateLeadSource, toggleVivier, savePrequal, setPrequalOutcome, addInterview, updateInterview,
      advanceChatboxSubmission, setChatboxSubmissionStatus, addChatboxSubmission,
      suppressCandidate, markDoNotContact, restoreCandidateContact,
      unsubscribeCandidate, anonymizeCandidate, exportCandidate, updateSettings,
      updateIntegration, toggleIntegrationMode, testIntegration,
      addSeat, deployAgents, updateSeat, setSeatStatus, connectSeatAccount, disconnectSeatAccount, toggleSeatLive, verifySeatDomain,
      addSuppression, removeSuppression, allocateOutreach, runFleetSourcing,
      runLearning, acceptSkillLearning, updateSkillContent, recordPiiReveal,
      saveApiKey, testApiKey, removeApiKey, setCurrentRole,
      updateAriaPrompt, addGuardrailRule, toggleGuardrailRule, removeGuardrailRule, askAria, runAriaPlan,
      addProvider, updateProvider, removeProvider, setDefaultProvider,
      addMcpServer, updateMcpServer, removeMcpServer, testMcpServer,
      testDustConnection, connectDust, updateDustAgentLock, disconnectDust, runDustTask,
      addModel, updateModel, removeModel, setModelDefaultForTask,
      toggleTool,
      assignAgentProvider, assignAgentModel, assignAgentTools,
      logActivity, resetDemo,
      createChatThread, deleteChatThread, clearChatThread, appendChatMessage, updateChatMessage, sendChat, cancelChat,
      addMemory, updateMemory, removeMemory, togglePinMemory,
      addSchedule, updateSchedule, removeSchedule, toggleSchedule,
      addInterviewer, updateInterviewer, removeInterviewer,
    ],
  );

  const recommendations = useMemo(
    () => (state ? deriveRecommendations(state) : []),
    [state],
  );

  const value = useMemo<HermesContextValue>(
    () => ({ state, hydrated: state !== null, actions, recommendations }),
    [state, actions, recommendations],
  );

  return React.createElement(HermesContext.Provider, { value }, children);
}

/* ============================================================================
   Hooks
   ========================================================================== */

export function useHermes(): HermesContextValue {
  const ctx = useContext(HermesContext);
  if (!ctx) throw new Error("useHermes must be used within <HermesProvider>.");
  return ctx;
}

export function useHydrated(): boolean {
  return useHermes().hydrated;
}

export function useActions(): HermesActions {
  return useHermes().actions;
}

function buildLiveEmptyState(): HermesState {
  return {
    version: STATE_VERSION,
    campaigns: [],
    candidates: [],
    outreach: [],
    replies: [],
    bookings: [],
    wins: [],
    interviewers: [],
    reports: [],
    integrations: defaultLiveIntegrations(),
    activities: [],
    settings: {
      humanApprovalGate: true,
      dryRunMode: true,
      webResearch: true,
      minScoreToContact: 70,
      slaMinutes: 15,
      operatorName: "Operator",
      systemIdentity: "Aria Sourcing",
      rateLimits: { emailsPerDay: 15, linkedinPerDay: 20, followUpGapDays: 3, suppressionDays: 90 },
      compliance: {
        candidateRetentionDays: 180, jdRetentionDays: 365, emailContentRetentionDays: 365,
        crmAuditLogs: true, unsubscribeEnforcement: true, ccpaDoNotSell: true, gdprMode: true,
      },
      fleet: {
        recontactWindowDays: 90, bounceRatePauseThreshold: 0.05, complaintRatePauseThreshold: 0.001,
        enforceBusinessHours: true, jitter: true, globalDailyCap: null, maxAgents: 300,
      },
      confidentialityMode: true,
      defaultLanguage: "en",
      soundEnabled: false,
      guardrails: defaultGuardrails(),
      notifications: { slack: true, telegram: false, email: true },
      llmProviders: defaultLlmProviders(),
      savedModels: defaultSavedModels(),
      tools: defaultTools(),
      mcpServers: [],
      defaultModels: {},
      hermesLiveMode: false,
      hermesApiUrl: "",
      hermesApiKeyId: "",
      hermesWebUrl: "",
    },
    seats: [],
    suppression: [],
    ledger: [],
    skills: defaultSkills(),
    apiKeys: [],
    currentRole: "viewer",
    chats: [],
    memory: [],
    schedules: [],
    activeCampaignId: null,
  };
}

const EMPTY: HermesState = buildLiveEmptyState();

function useStateOrEmpty(): HermesState {
  return useHermes().state ?? EMPTY;
}

export function useSettings(): SystemSettings {
  return useStateOrEmpty().settings;
}

export function useCampaigns(): Campaign[] {
  return useStateOrEmpty().campaigns;
}

export function useCampaign(id: string | null | undefined): Campaign | undefined {
  const s = useStateOrEmpty();
  return id ? s.campaigns.find((c) => c.id === id) : undefined;
}

export function useActiveCampaign(): Campaign | undefined {
  const s = useStateOrEmpty();
  return s.campaigns.find((c) => c.id === s.activeCampaignId) ?? s.campaigns[0];
}

export function useActiveCampaignId(): string | null {
  return useStateOrEmpty().activeCampaignId;
}

export function useCandidates(): Candidate[] {
  return useStateOrEmpty().candidates;
}

export function useCampaignCandidates(campaignId: string | null | undefined): Candidate[] {
  const s = useStateOrEmpty();
  return campaignId ? s.candidates.filter((c) => c.campaignId === campaignId) : [];
}

export function useCandidate(id: string | null | undefined): Candidate | undefined {
  const s = useStateOrEmpty();
  return id ? s.candidates.find((c) => c.id === id) : undefined;
}

/** Scored chatbox applications awaiting recruiter handoff (TAnIA §5). */
export function useChatboxSubmissions(): ChatboxSubmission[] {
  return useStateOrEmpty().chatboxSubmissions ?? [];
}

/** Candidates in #Vivier (the talent pool), newest first. */
export function useVivier(): Candidate[] {
  return useStateOrEmpty().candidates.filter((c) => c.vivier);
}

export function useOutreach(): OutreachMessage[] {
  return useStateOrEmpty().outreach;
}

export function useCampaignOutreach(campaignId: string | null | undefined): OutreachMessage[] {
  const s = useStateOrEmpty();
  return campaignId ? s.outreach.filter((m) => m.campaignId === campaignId) : [];
}

export function usePendingApprovals(): OutreachMessage[] {
  return useStateOrEmpty().outreach.filter((m) => m.status === "Needs Approval");
}

export function useReplies(): ClassifiedReply[] {
  return useStateOrEmpty().replies;
}

export function useBookings(): Booking[] {
  return useStateOrEmpty().bookings;
}

export function useWins(): WinRecord[] {
  return useStateOrEmpty().wins;
}

export function useInterviewers(): Interviewer[] {
  return useStateOrEmpty().interviewers;
}

export function useReports(): WeeklyReport[] {
  return useStateOrEmpty().reports;
}

export function useReportForCampaign(campaignId: string | null | undefined): WeeklyReport | undefined {
  const s = useStateOrEmpty();
  return campaignId ? s.reports.find((r) => r.campaignId === campaignId) : undefined;
}

export function useIntegrations(): IntegrationStatus[] {
  return useStateOrEmpty().integrations;
}

export function useActivities(): Activity[] {
  return useStateOrEmpty().activities;
}

/** One event in an entity's merged timeline — see useEntityTimeline. */
export type TimelineEvent =
  | { kind: "activity"; id: string; at: string; activity: Activity }
  | { kind: "outreach"; id: string; at: string; message: OutreachMessage }
  | { kind: "reply"; id: string; at: string; reply: ClassifiedReply };

/**
 * Decision Replay read model (workstream 4.2) — groups useActivities() by
 * linkedEntityId and merges in the entity's outreach + replies so a full
 * sourced→scored→drafted→approved→replied→booked chain can be replayed from
 * one call. Purely additive: no new persisted fields, no change to
 * withActivity/makeActivity semantics, no existing selector touched.
 *
 * Booking activities are logged against the *booking's* id, not the
 * candidate's (see createBookingFor's withActivity call), so for
 * linkedEntityType "candidate" this also pulls in any booking activity whose
 * booking.candidateId matches — otherwise the "booked" step would silently
 * vanish from a candidate's replay. Outreach messages and replies are only
 * merged for "candidate" (the only entity type they key off today); other
 * linkedEntityType calls (e.g. "campaign") return just the matched activities.
 */
export function useEntityTimeline(
  linkedEntityType: Activity["linkedEntityType"],
  linkedEntityId: string | null | undefined,
): TimelineEvent[] {
  const s = useStateOrEmpty();
  return useMemo(() => {
    if (!linkedEntityType || !linkedEntityId) return [];

    const directActivities = s.activities.filter(
      (a) => a.linkedEntityType === linkedEntityType && a.linkedEntityId === linkedEntityId,
    );
    const bookingActivities =
      linkedEntityType === "candidate"
        ? s.activities.filter(
            (a) =>
              a.linkedEntityType === "booking" &&
              s.bookings.some((b) => b.id === a.linkedEntityId && b.candidateId === linkedEntityId),
          )
        : [];
    const activityEvents: TimelineEvent[] = [...directActivities, ...bookingActivities].map((activity) => ({
      kind: "activity",
      id: activity.id,
      at: activity.createdAt,
      activity,
    }));

    const outreachEvents: TimelineEvent[] =
      linkedEntityType === "candidate"
        ? s.outreach
            .filter((m) => m.candidateId === linkedEntityId)
            .map((message) => ({ kind: "outreach", id: message.id, at: message.createdAt, message }))
        : [];

    const replyEvents: TimelineEvent[] =
      linkedEntityType === "candidate"
        ? s.replies
            .filter((r) => r.candidateId === linkedEntityId)
            .map((reply) => ({ kind: "reply", id: reply.id, at: reply.receivedAt, reply }))
        : [];

    return [...activityEvents, ...outreachEvents, ...replyEvents].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
  }, [s.activities, s.outreach, s.replies, s.bookings, linkedEntityType, linkedEntityId]);
}

export function useDashboardKpis(): GlobalKpis {
  const { campaigns, candidates, outreach, replies, bookings, settings } = useStateOrEmpty();
  // Keyed on the individual slices globalKpis() reads, not the whole state
  // object, so a commit that only touches e.g. replies doesn't force a
  // recompute when campaigns/candidates/outreach are unchanged.
  return useMemo(
    () => globalKpis({ campaigns, candidates, outreach, replies, bookings, settings }),
    [campaigns, candidates, outreach, replies, bookings, settings],
  );
}

/** Single prioritized recommendation queue -- see recommendations.ts for the ranking rationale.
 *  Computed once per state change in <HermesProvider> (not per caller) so the TopBar bell and
 *  the dashboard AttentionPanel share one derivation instead of running it twice. */
export function useRecommendations(): Recommendation[] {
  return useHermes().recommendations;
}

/** Candidates whose follow-up is due (Task 1) -- see deriveFollowUpsDue in recommendations.ts. */
export function useFollowUpsDue(): FollowUpDueItem[] {
  return deriveFollowUpsDue(useStateOrEmpty());
}

export function useSeats(): AgentSeat[] {
  return useStateOrEmpty().seats;
}

export function useSuppression(): SuppressionEntry[] {
  return useStateOrEmpty().suppression;
}

export function useLedger(): OutreachLedgerEntry[] {
  return useStateOrEmpty().ledger;
}

export function useSkills(): AgentSkill[] {
  return useStateOrEmpty().skills;
}

export function useSkill(key: SkillKey): AgentSkill | undefined {
  return useStateOrEmpty().skills.find((s) => s.key === key);
}

export function useFleetSummary(): FleetSummary {
  const s = useStateOrEmpty();
  return fleetSummary(s.seats, s.settings.fleet);
}

export function useApiKeys(): ApiKey[] {
  return useStateOrEmpty().apiKeys;
}

export function useRole(): Role {
  return useStateOrEmpty().currentRole;
}

export function useGuardrails() {
  return useStateOrEmpty().settings.guardrails;
}

export function useLlmProviders() {
  return useStateOrEmpty().settings.llmProviders ?? [];
}

export function useMcpServers() {
  return useStateOrEmpty().settings.mcpServers ?? [];
}

export function useDustSettings() {
  return useStateOrEmpty().settings.dust;
}

export function useSavedModels() {
  return useStateOrEmpty().settings.savedModels ?? [];
}

export function useTools() {
  return useStateOrEmpty().settings.tools ?? [];
}

export function useDefaultModels() {
  return useStateOrEmpty().settings.defaultModels ?? {};
}

export function useChats() {
  return useStateOrEmpty().chats;
}

export function useChatThread(id: string | null | undefined) {
  const s = useStateOrEmpty();
  return id ? s.chats.find((t) => t.id === id) : undefined;
}

export function useMemory(seatId?: string): MemoryEntry[] {
  const s = useStateOrEmpty();
  if (!seatId) return s.memory;
  return s.memory.filter((m) => m.seatId === seatId);
}

export function useSchedules(): CronJob[] {
  return useStateOrEmpty().schedules;
}
