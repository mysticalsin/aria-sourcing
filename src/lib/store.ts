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
  classifyReply,
  generateOutreach,
  newOutreachMessage,
  type GeneratedOutreach,
  type ReplyClassification,
} from "./mock-ai";
import { preferredOutreachChannel } from "./outreach-channel";
import {
  mapSeamlessCandidates,
  type SourceResult,
} from "./sourcing/candidate-mappers";
import type { SillageProfile } from "./sourcing/sillage";
import type { SeamlessContact, SeamlessResearchContact } from "./sourcing/seamless";
import type { ApifyProfile, ApifyProfileSearchInput } from "./sourcing/apify";
import {
  buildOutreachPrompt,
  hermesAvailable,
  hermesGenerate,
  parseHermesOutreach,
} from "./ai/hermes";
import { resolveAiProvider } from "./ai/provider";
import {
  anonymizeHermesState,
  isCandidateErasureTombstone,
  preserveCandidateErasureTombstones,
} from "./candidate-privacy";
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
import {
  candidateFromSourcingAgentDto,
  sourcingAgentCampaignFingerprint,
} from "./sourcing/sourcing-agent-contract";
import { requestReviewedSourcing } from "./sourcing/sourcing-agent-client";
import { campaignAllowsLiveSourcing } from "./sourcing/campaign-lifecycle";
import { validateMcpBaseUrl } from "./mcp-auth-params";
import { findHeyReachMcpServer } from "./heyreach-mcp";
import {
  defaultLiveIntegrations,
  testConnection,
  type ConnectionTestResult,
} from "./integrations";
import { createBookingReportActions } from "./store/booking-report-actions";
import { createCampaignActions } from "./store/campaign-actions";
import { createSourcingActions } from "./store/sourcing-actions";
import { resolveInboundEmailIdentity } from "./store/inbound-identity";
import { loadState, normalizeHermesState } from "./store/migrations";
import { demoStateAllowsCandidatePersistence } from "./store/demo-persistence";
import { mapApifyCandidates, mapSillageCandidates, parseSillageIdentifier } from "./store/sourcing-helpers";
import { computeCoverage } from "./enrichment/merge";
import type {
  CandidateErasureObligation,
  CandidateErasureStatus,
  HermesActions,
  HermesContextValue,
  SourcingFeedbackReceipt,
  SourcingFeedbackVerdict,
} from "./store/contracts";
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
  CandidateLawfulBasis,
  LeadSource,
  PrequalOutcome,
  PrequalRecord,
  StarRating,
  DustAgentSummary,
  DustRegion,
  DustTask,
  EnrichableField,
  EnrichmentAttempt,
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
  SkillKey,
  SkillUpdate,
  SuppressionEntry,
  SystemSettings,
  ToolId,
  WinRecord,
  WeeklyReport,
} from "./types";
import { genId, isoDaysBefore } from "./utils";
import { createCampaign as buildCampaign } from "./mock-ai";
import { demoLoginEnabled, supabaseEnabled } from "./supabase/config";
import {
  loadRemoteAgentSeats,
  loadRemoteState,
  saveRemoteState,
  type RemoteStateVersion,
} from "./supabase/workspace";
import { applyAuthoritativeRole } from "./live-role-authority";
import {
  createFailedWorkspaceSave,
  retainPendingWorkspaceSave,
  runWorkspaceEffect as runWorkspaceEffectBoundary,
  settleWorkspaceSave,
  workspaceAllowsMutation,
  type PendingWorkspaceSave,
  type WorkspaceDependency,
  type WorkspaceEffectAttempt,
  type WorkspaceStatus,
} from "./workspace-status";
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
import { validateOutreachQuality } from "./outreach-quality-pipeline";
import { mantuEmailHtmlWrapper, mantuOutreachVoice } from "./mantu-brand";
import { parseCommand, campaignToAriaContext, type AriaPlan } from "./aria-command";
import { recordOutreachApproval, revokeOutreachApproval } from "./outreach-approval";
import { can } from "./rbac";
import {
  normalizeSuppressionValue,
  persistManualSuppression,
  type EnforcedSuppressionType,
} from "./manual-suppression";
import { linkedInGuardrailPrompt } from "./linkedin-policy";

export { defaultSlot, interviewerIsBusy, resolveBookingSlot } from "./store/booking-slot";
export { migrateToCurrentVersion, normalizeHermesState } from "./store/migrations";
export { appendWinRecord, deriveWinRecord, WIN_RECORD_LIMIT } from "./store/winlog-derive";
export type { HermesActions } from "./store/contracts";

const STORAGE_KEY = "hermes-sourcing:v1";
const ARIA_STRONG_RATINGS: readonly StarRating[] = ["TopGun", "A"];
const ARIA_PERFECT_RATING: StarRating = "TopGun";
const ARIA_STEP_CANDIDATE_CAP = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCING_FEEDBACK_PLATFORMS = new Set<SourcingFeedbackReceipt["platform"]>([
  "GitHub",
  "LinkedIn",
  "Stack Overflow",
  "Dribbble",
  "Behance",
]);

function parseSourcingFeedbackReceipts(value: unknown): SourcingFeedbackReceipt[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const receipts: SourcingFeedbackReceipt[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => key !== "receiptId" && key !== "platform" && key !== "candidateCount",
      ) ||
      typeof row.receiptId !== "string" ||
      !UUID_RE.test(row.receiptId) ||
      seen.has(row.receiptId) ||
      typeof row.platform !== "string" ||
      !SOURCING_FEEDBACK_PLATFORMS.has(row.platform as SourcingFeedbackReceipt["platform"]) ||
      typeof row.candidateCount !== "number" ||
      !Number.isSafeInteger(row.candidateCount) ||
      row.candidateCount < 0 ||
      row.candidateCount > 100
    ) {
      return null;
    }
    seen.add(row.receiptId);
    receipts.push({
      receiptId: row.receiptId,
      platform: row.platform as SourcingFeedbackReceipt["platform"],
      candidateCount: row.candidateCount,
    });
  }
  return receipts;
}

/** Core contact/richness fields enrichCandidate/enrichCampaign fill when the
 *  caller doesn't specify `want` explicitly (docs/superpowers/plans/
 *  2026-07-15-enrichment-orchestrator.md). */
const DEFAULT_ENRICH_FIELDS: EnrichableField[] = ["email", "phone", "skills", "experience", "headline"];
/** Generous per-workspace fallback spend cap (registry cost units, not real
 *  currency) used when `state.enrichmentBudgetUnits` hasn't been configured. */
const DEFAULT_ENRICHMENT_BUDGET_UNITS = 1000;
/** Concurrency cap enrichCampaign uses when the caller doesn't specify one. */
const DEFAULT_ENRICH_CONCURRENCY = 3;

const HermesContext = createContext<HermesContextValue | null>(null);
const UNSAVED_WORKSPACE_MESSAGE =
  "Your latest changes are still in this browser but are not saved to the shared workspace.";

function unavailableWorkspaceStatus(dependency: WorkspaceDependency): WorkspaceStatus {
  const messages: Record<WorkspaceDependency, string> = {
    auth: "We could not verify your session. Product data and actions are blocked until the connection recovers.",
    workspace: "We could not resolve your workspace or access level. Product data and actions are blocked.",
    state: "Workspace data is temporarily unavailable. No empty or demo data has been substituted.",
    agent_seats: "The authoritative agent roster is temporarily unavailable. Stale workspace seats are not shown.",
  };
  return { phase: "unavailable", mode: "live", dependency, message: messages[dependency] };
}

function makeActivity(
  activity: Omit<Activity, "id" | "createdAt"> & { createdAt?: string },
): Activity {
  return {
    id: genId("act"),
    createdAt: activity.createdAt ?? new Date().toISOString(),
    ...activity,
  };
}

function withActivity(
  state: HermesState,
  activity: Activity,
  campaignId: string | null,
): HermesState {
  const campaigns = campaignId
    ? state.campaigns.map((campaign) =>
        campaign.id === campaignId
          ? {
              ...campaign,
              activities: [activity, ...campaign.activities].slice(0, 80),
            }
          : campaign,
      )
    : state.campaigns;
  return {
    ...state,
    campaigns,
    activities: [activity, ...state.activities].slice(0, 300),
  };
}

function recomputeMetrics(state: HermesState, campaignId: string): HermesState {
  const candidates = state.candidates.filter(
    (candidate) => candidate.campaignId === campaignId,
  );
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  const firstInterviewHours = campaign
    ? firstInterviewElapsedHours(
        state.bookings.filter((booking) => booking.campaignId === campaignId),
        campaign.createdAt,
      )
    : null;
  return {
    ...state,
    campaigns: state.campaigns.map((item) =>
      item.id === campaignId
        ? {
            ...item,
            metrics: computeCampaignMetrics(
              candidates,
              item.metrics,
              firstInterviewHours,
              realFunnelFacts(state, {
                live: !state.settings.dryRunMode,
                campaignId,
              }),
            ),
          }
        : item,
    ),
  };
}

/* ============================================================================
   Provider
   ========================================================================== */

/** Live/enterprise tenants must never commit mock outreach as a successful draft. */
function refuseMockOutreachOnLiveTenant(live: boolean): boolean {
  return !live && supabaseEnabled && !demoLoginEnabled;
}

/** Enterprise Mantu loop: persona is always Mantu voice; seat may only refine signature. */
function enterpriseMantuVoice(seat?: Pick<AgentSeat, "signature"> | null): {
  persona: string;
  signature: string;
} {
  const mantuVoice = mantuOutreachVoice(seat?.signature);
  return {
    persona: mantuVoice.persona,
    signature: seat?.signature?.trim() ? seat.signature : mantuVoice.signature,
  };
}

/**
 * Shared live-generation attempt for follow-up / re-contact drafts — the same
 * three-layer path generateOutreachLive/regenerateOutreach use (a cloud
 * provider or hermes live mode configured -> hermesGenerate -> parse ->
 * humanize). Returns the mock unchanged (live: false) on any failure at any
 * layer; live tenants must refuse committing that mock (see
 * refuseMockOutreachOnLiveTenant).
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
  runEffect: <T>(effect: () => T) => WorkspaceEffectAttempt<T>;
}): Promise<{ gen: GeneratedOutreach; live: boolean }> {
  const { settings, candidate, campaign, tone, channel, voice, lang, mockGen, seat, touchNote, runEffect } = opts;
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

  const attempt = runEffect(() => hermesGenerate(genInput));
  if (!attempt.allowed) return { gen: mockGen, live: false };
  const result = await attempt.value;
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
  const [workspaceStatus, setWorkspaceStatusState] = useState<WorkspaceStatus>({
    phase: "loading",
    mode: supabaseEnabled ? "live" : "demo",
  });
  const workspaceStatusRef = useRef<WorkspaceStatus>(workspaceStatus);
  const setWorkspaceStatus = useCallback((next: WorkspaceStatus) => {
    workspaceStatusRef.current = next;
    setWorkspaceStatusState(next);
  }, []);
  const workspaceIdRef = useRef<string>("");
  // Optimistic-concurrency token: the workspace_state.updated_at we last loaded/saved.
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const liveRoleRef = useRef<Role>("viewer");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrationGeneration = useRef(0);
  const queuedRemoteSnapshot = useRef<HermesState | null>(null);
  const pendingRemoteSave = useRef<PendingWorkspaceSave<HermesState> | null>(null);
  const remoteSaveInFlight = useRef(false);
  const authoritativeCommitInFlight = useRef(false);
  const remoteSaveOperation = useRef<symbol | null>(null);
  const drainRemoteSaveQueueRef = useRef<() => void>(() => undefined);
  // DEMO mode only: latest state snapshot awaiting a debounced localStorage write,
  // so flushLocalSave() can write it immediately on unmount / tab close.
  const pendingLocalSave = useRef<HermesState | null>(null);
  const skipNextPersist = useRef(false);
  const skipPersistSnapshot = useRef<HermesState | null>(null);
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
        if (demoStateAllowsCandidatePersistence(pending)) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
        }
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

  useEffect(() => {
    if (workspaceStatus.phase !== "ready") {
      for (const controller of chatAbortControllers.current.values()) controller.abort();
      chatAbortControllers.current.clear();
    }
  }, [workspaceStatus.phase]);

  const hydrateWorkspace = useCallback(async () => {
    const generation = ++hydrationGeneration.current;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    queuedRemoteSnapshot.current = null;
    pendingRemoteSave.current = null;
    remoteSaveOperation.current = null;
    remoteSaveInFlight.current = false;
    authoritativeCommitInFlight.current = false;
    skipNextPersist.current = false;
    skipPersistSnapshot.current = null;
    setWorkspaceStatus({ phase: "loading", mode: supabaseEnabled ? "live" : "demo" });

    if (!supabaseEnabled) {
      const demoState = loadState();
      if (generation !== hydrationGeneration.current) return;
      stateRef.current = demoState;
      setState(demoState);
      setWorkspaceStatus({ phase: "ready", mode: "demo" });
      return;
    }

    workspaceIdRef.current = "";
    remoteUpdatedAtRef.current = null;
    liveRoleRef.current = "viewer";
    stateRef.current = null;
    setState(null);

    try {
      const remote = await loadRemoteState();
      if (generation !== hydrationGeneration.current) return;
      if (remote.status === "signed_out") {
        setWorkspaceStatus({ phase: "signed_out", mode: "live" });
        return;
      }
      if (remote.status === "unavailable") {
        setWorkspaceStatus(unavailableWorkspaceStatus(remote.dependency));
        return;
      }

      workspaceIdRef.current = remote.workspaceId;
      remoteUpdatedAtRef.current = remote.updatedAt;
      liveRoleRef.current = remote.role;

      const serverSeats = await loadRemoteAgentSeats();
      if (generation !== hydrationGeneration.current) return;
      if (serverSeats.status === "unavailable") {
        setWorkspaceStatus(unavailableWorkspaceStatus("agent_seats"));
        return;
      }

      const base = remote.state ? normalizeHermesState(remote.state) : buildLiveEmptyState();
      const liveState = {
        ...base,
        seats: mergeAgentSeatRows(base.seats, serverSeats.seats),
      };
      const next = applyAuthoritativeRole(liveState, remote.role);
      if (remote.state) {
        skipNextPersist.current = true;
        skipPersistSnapshot.current = next;
      }
      stateRef.current = next;
      setState(next);
      setWorkspaceStatus({ phase: "ready", mode: "live" });
    } catch (error) {
      console.warn("workspace hydration failed:", error);
      if (generation !== hydrationGeneration.current) return;
      stateRef.current = null;
      setState(null);
      setWorkspaceStatus(unavailableWorkspaceStatus("state"));
    }
  }, [setWorkspaceStatus]);

  // Hydrate once on mount. Retry uses the same authoritative path, so recovery
  // cannot accidentally switch to local/demo state.
  useEffect(() => {
    void hydrateWorkspace();
    return () => {
      hydrationGeneration.current += 1;
      if (supabaseEnabled && saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [hydrateWorkspace]);

  const prepareRemoteConflict = useCallback(async (latest: RemoteStateVersion) => {
    if (!latest.state || !latest.updatedAt) return null;
    const serverSeats = await loadRemoteAgentSeats();
    if (serverSeats.status === "unavailable") return null;

    const base = normalizeHermesState(latest.state);
    const liveState = {
      ...base,
      seats: mergeAgentSeatRows(base.seats, serverSeats.seats),
    };
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
    const next = applyAuthoritativeRole(
      { ...liveState, activities: [notice, ...liveState.activities].slice(0, 300) },
      liveRoleRef.current,
    );
    return { latest, next };
  }, []);

  const applyRemoteConflict = useCallback((prepared: {
    latest: RemoteStateVersion;
    next: HermesState;
  }) => {
    remoteUpdatedAtRef.current = prepared.latest.updatedAt;
    skipNextPersist.current = true;
    skipPersistSnapshot.current = prepared.next;
    stateRef.current = prepared.next;
    setState(prepared.next);
    setWorkspaceStatus({ phase: "ready", mode: "live" });
  }, [setWorkspaceStatus]);

  const persistPendingSave = useCallback(async (
    pending: PendingWorkspaceSave<HermesState>,
  ) => settleWorkspaceSave({
    generation: pending.generation,
    currentGeneration: () => hydrationGeneration.current,
    save: () => saveRemoteState(
      pending.workspaceId,
      pending.snapshot,
      pending.expectedUpdatedAt,
    ),
    prepareConflict: prepareRemoteConflict,
    applySaved: (result) => {
      if (result.updatedAt) remoteUpdatedAtRef.current = result.updatedAt;
      setWorkspaceStatus({ phase: "ready", mode: "live" });
    },
    applyConflict: applyRemoteConflict,
  }), [applyRemoteConflict, prepareRemoteConflict, setWorkspaceStatus]);

  const markRemoteSaveFailed = useCallback((
    pending: PendingWorkspaceSave<HermesState>,
    snapshot: HermesState = pending.snapshot,
  ) => {
    if (pending.generation !== hydrationGeneration.current) return;
    const retained = retainPendingWorkspaceSave(
      pending,
      snapshot,
      remoteUpdatedAtRef.current,
    );
    const failed = createFailedWorkspaceSave(
      retained,
      UNSAVED_WORKSPACE_MESSAGE,
    );
    pendingRemoteSave.current = failed.pending;
    setWorkspaceStatus(failed.status);
  }, [setWorkspaceStatus]);

  const drainRemoteSaveQueue = useCallback(() => {
    if (remoteSaveInFlight.current || !workspaceAllowsMutation(workspaceStatusRef.current)) return;
    const snapshot = queuedRemoteSnapshot.current;
    const workspaceId = workspaceIdRef.current;
    if (!snapshot) return;
    if (!workspaceId) {
      queuedRemoteSnapshot.current = null;
      setWorkspaceStatus(unavailableWorkspaceStatus("workspace"));
      return;
    }

    queuedRemoteSnapshot.current = null;
    const pending: PendingWorkspaceSave<HermesState> = {
      workspaceId,
      snapshot,
      expectedUpdatedAt: remoteUpdatedAtRef.current,
      generation: hydrationGeneration.current,
    };
    pendingRemoteSave.current = pending;
    const operation = Symbol("workspace-save");
    remoteSaveOperation.current = operation;
    remoteSaveInFlight.current = true;

    void persistPendingSave(pending).then((outcome) => {
      if (remoteSaveOperation.current !== operation) return;
      remoteSaveOperation.current = null;
      remoteSaveInFlight.current = false;
      if (outcome === "stale") return;
      if (outcome === "conflict") {
        queuedRemoteSnapshot.current = null;
        pendingRemoteSave.current = null;
        return;
      }
      if (outcome === "failed") {
        const newestSnapshot = queuedRemoteSnapshot.current ?? pending.snapshot;
        queuedRemoteSnapshot.current = null;
        markRemoteSaveFailed(pending, newestSnapshot);
        return;
      }

      if (pendingRemoteSave.current === pending) pendingRemoteSave.current = null;
      if (queuedRemoteSnapshot.current) drainRemoteSaveQueueRef.current();
    }).catch(() => {
      if (remoteSaveOperation.current !== operation) return;
      remoteSaveOperation.current = null;
      remoteSaveInFlight.current = false;
      const newestSnapshot = queuedRemoteSnapshot.current ?? pending.snapshot;
      queuedRemoteSnapshot.current = null;
      markRemoteSaveFailed(pending, newestSnapshot);
    });
  }, [markRemoteSaveFailed, persistPendingSave, setWorkspaceStatus]);
  drainRemoteSaveQueueRef.current = drainRemoteSaveQueue;

  const flushWorkspaceSave = useCallback(async (): Promise<boolean> => {
    if (!supabaseEnabled) return true;
    if (!workspaceAllowsMutation(workspaceStatusRef.current)) return false;
    const workspaceId = workspaceIdRef.current;
    const snapshot = stateRef.current;
    if (!workspaceId || !snapshot) return false;

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    queuedRemoteSnapshot.current = null;

    for (let attempt = 0; attempt < 40 && remoteSaveInFlight.current; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (remoteSaveInFlight.current) return false;

    const pending: PendingWorkspaceSave<HermesState> = {
      workspaceId,
      snapshot,
      expectedUpdatedAt: remoteUpdatedAtRef.current,
      generation: hydrationGeneration.current,
    };
    const operation = Symbol("workspace-save-flush");
    remoteSaveOperation.current = operation;
    remoteSaveInFlight.current = true;
    try {
      const outcome = await persistPendingSave(pending);
      if (remoteSaveOperation.current !== operation) return false;
      if (outcome === "saved") {
        skipNextPersist.current = true;
        skipPersistSnapshot.current = snapshot;
        pendingRemoteSave.current = null;
        queuedRemoteSnapshot.current = null;
        return true;
      }
      return outcome === "conflict";
    } catch {
      return false;
    } finally {
      if (remoteSaveOperation.current === operation) {
        remoteSaveOperation.current = null;
        remoteSaveInFlight.current = false;
      }
    }
  }, [persistPendingSave]);

  const retrySave = useCallback(async () => {
    const pending = pendingRemoteSave.current;
    if (!pending || remoteSaveInFlight.current) return;
    const operation = Symbol("workspace-save-retry");
    remoteSaveOperation.current = operation;
    remoteSaveInFlight.current = true;
    try {
      const outcome = await persistPendingSave(pending);
      if (remoteSaveOperation.current !== operation || outcome === "stale") return;
      if (outcome === "saved") {
        skipNextPersist.current = true;
        skipPersistSnapshot.current = pending.snapshot;
        stateRef.current = pending.snapshot;
        setState(pending.snapshot);
        pendingRemoteSave.current = null;
        queuedRemoteSnapshot.current = null;
        return;
      }
      if (outcome === "conflict") {
        pendingRemoteSave.current = null;
        queuedRemoteSnapshot.current = null;
        return;
      }
      const newestSnapshot = queuedRemoteSnapshot.current ?? pending.snapshot;
      queuedRemoteSnapshot.current = null;
      markRemoteSaveFailed(pending, newestSnapshot);
    } catch {
      const newestSnapshot = queuedRemoteSnapshot.current ?? pending.snapshot;
      queuedRemoteSnapshot.current = null;
      markRemoteSaveFailed(pending, newestSnapshot);
    } finally {
      if (remoteSaveOperation.current === operation) {
        remoteSaveOperation.current = null;
        remoteSaveInFlight.current = false;
      }
    }
  }, [markRemoteSaveFailed, persistPendingSave]);

  // Persist on change (debounced upsert in LIVE mode, synchronous in DEMO mode).
  useEffect(() => {
    if (!state) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      const persisted = skipPersistSnapshot.current;
      skipPersistSnapshot.current = null;
      if (persisted === state) return;
    }
    if (supabaseEnabled) {
      if (!workspaceAllowsMutation(workspaceStatusRef.current)) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      queuedRemoteSnapshot.current = state;
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        drainRemoteSaveQueueRef.current();
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
    if (
      authoritativeCommitInFlight.current ||
      !workspaceAllowsMutation(workspaceStatusRef.current)
    ) return false;
    const base = stateRef.current;
    if (!base) return false;
    const next = preserveCandidateErasureTombstones(base, fn(base));
    if (!supabaseEnabled && !demoStateAllowsCandidatePersistence(next)) return false;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const commitPersisted = useCallback(async (
    fn: (current: HermesState) => HermesState,
  ): Promise<boolean> => {
    if (
      authoritativeCommitInFlight.current ||
      remoteSaveInFlight.current ||
      !workspaceAllowsMutation(workspaceStatusRef.current)
    ) return false;
    const base = stateRef.current;
    if (!base) return false;
    const next = preserveCandidateErasureTombstones(base, fn(base));
    if (next === base) return true;
    if (!supabaseEnabled && !demoStateAllowsCandidatePersistence(next)) return false;

    if (!supabaseEnabled) {
      stateRef.current = next;
      setState(next);
      return true;
    }

    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return false;
    const generation = hydrationGeneration.current;
    const pending: PendingWorkspaceSave<HermesState> = {
      workspaceId,
      snapshot: next,
      expectedUpdatedAt: remoteUpdatedAtRef.current,
      generation,
    };
    const operation = Symbol("workspace-authoritative-commit");
    authoritativeCommitInFlight.current = true;
    remoteSaveInFlight.current = true;
    remoteSaveOperation.current = operation;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    queuedRemoteSnapshot.current = null;

    try {
      const outcome = await settleWorkspaceSave({
        generation,
        currentGeneration: () => hydrationGeneration.current,
        save: () => saveRemoteState(
          workspaceId,
          next,
          remoteUpdatedAtRef.current,
        ),
        prepareConflict: prepareRemoteConflict,
        applySaved: (result) => {
          if (remoteSaveOperation.current !== operation) {
            throw new Error("authoritative workspace commit superseded");
          }
          if (result.updatedAt) remoteUpdatedAtRef.current = result.updatedAt;
          pendingRemoteSave.current = null;
          skipNextPersist.current = true;
          skipPersistSnapshot.current = next;
          stateRef.current = next;
          setState(next);
          setWorkspaceStatus({ phase: "ready", mode: "live" });
        },
        applyConflict: applyRemoteConflict,
      });
      if (outcome === "failed") {
        markRemoteSaveFailed(pending, next);
        return false;
      }
      return outcome === "saved";
    } catch {
      markRemoteSaveFailed(pending, next);
      return false;
    } finally {
      if (remoteSaveOperation.current === operation) {
        remoteSaveOperation.current = null;
        remoteSaveInFlight.current = false;
      }
      authoritativeCommitInFlight.current = false;
    }
  // Module-level capability is immutable for the lifetime of this client bundle,
  // but React Compiler needs it named to preserve this callback's memoization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRemoteConflict, markRemoteSaveFailed, prepareRemoteConflict, setWorkspaceStatus, supabaseEnabled]);

  const current = useCallback(
    () => stateRef.current ?? (supabaseEnabled ? buildLiveEmptyState() : buildSeedState()),
    // See commitPersisted: this build-time capability cannot change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabaseEnabled],
  );

  const workspaceEffectAllowed = useCallback(
    () =>
      !authoritativeCommitInFlight.current &&
      workspaceAllowsMutation(workspaceStatusRef.current),
    [],
  );

  const bookingMutationAllowed = useCallback(() => {
    const role = supabaseEnabled
      ? liveRoleRef.current
      : stateRef.current?.currentRole;
    return role != null && can(role, "book");
  }, []);

  const learningMutationAllowed = useCallback(() => {
    const role = supabaseEnabled
      ? liveRoleRef.current
      : stateRef.current?.currentRole;
    return role != null && can(role, "skills");
  }, []);

  const sourcingMutationAllowed = useCallback(() => {
    const role = supabaseEnabled
      ? liveRoleRef.current
      : stateRef.current?.currentRole;
    return role != null && can(role, "source");
  }, []);

  const syntheticSourcingAllowed = useCallback(() => !supabaseEnabled, []);

  const candidatePersistenceAllowed = useCallback(
    (provenance: NonNullable<Candidate["provenance"]>) =>
      supabaseEnabled || provenance === "synthetic",
    [],
  );

  const campaignMutationAllowed = useCallback(
    () => workspaceEffectAllowed() && sourcingMutationAllowed(),
    [sourcingMutationAllowed, workspaceEffectAllowed],
  );

  const runWorkspaceEffect = useCallback(
    <T,>(effect: () => T) => runWorkspaceEffectBoundary(workspaceStatusRef.current, effect),
    [],
  );

  const workspaceFetch = useCallback<typeof fetch>(
    (input, init) => {
      const attempt = runWorkspaceEffect(() => fetch(input, init));
      return attempt.allowed
        ? attempt.value
        : Promise.reject(new Error("Workspace unavailable. Retry the workspace before running this action."));
    },
    [runWorkspaceEffect],
  );

  /* ---- actions ---------------------------------------------------------- */

  const {
    setActiveCampaign,
    createCampaignFromAnalysis,
    updateCampaign,
    regenerateQueries,
  } = useMemo(
    () =>
      createCampaignActions({
        commit,
        buildCampaign,
        makeActivity,
        withActivity,
        recomputeMetrics,
        effectiveWeights,
        scoreCandidate,
        campaignMutationAllowed,
        currentState: () => stateRef.current,
      }),
    [commit, campaignMutationAllowed],
  );

  const {
    sourceNextBatch,
    addCandidateFromGithub,
    addCandidateManual,
    sourceFromApollo,
    prepareApolloEnrichment,
    enrichApolloCandidate,
  } = useMemo(
    () =>
      createSourcingActions({
        commit,
        commitPersisted,
        flushWorkspaceSave,
        currentState: () => stateRef.current,
        sourcingMutationAllowed,
        workspaceEffectAllowed,
        syntheticSourcingAllowed,
        candidatePersistenceAllowed,
        workspaceFetch,
        makeActivity,
        withActivity,
        recomputeMetrics,
        effectiveWeights,
        emitSource: emit,
      }),
    [
      commit,
      commitPersisted,
      flushWorkspaceSave,
      sourcingMutationAllowed,
      syntheticSourcingAllowed,
      candidatePersistenceAllowed,
      workspaceEffectAllowed,
      workspaceFetch,
    ],
  );

  const logActivity = useCallback(
    (a: Omit<Activity, "id" | "createdAt"> & { createdAt?: string }) =>
      commit((s) => withActivity(s, makeActivity(a), a.campaignId ?? null)),
    [commit],
  );

  const startSillageMapping = useCallback(
    async (
      campaignId: string,
      identifier: string,
    ): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "Sillage candidate sourcing requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };
      const trimmed = identifier.trim();
      if (!trimmed) return { ok: false, error: "Enter a company domain or LinkedIn URL." };

      let res: Response;
      try {
        res = await workspaceFetch("/api/source/sillage/start", {
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
    [candidatePersistenceAllowed, current, workspaceEffectAllowed, workspaceFetch],
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
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "Sillage candidate sourcing requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };

      let res: Response;
      try {
        res = await workspaceFetch(`/api/source/sillage/status?requestId=${encodeURIComponent(requestId)}`);
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
    [candidatePersistenceAllowed, commit, current, workspaceEffectAllowed, workspaceFetch],
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
      if (!candidatePersistenceAllowed("live")) {
        return {
          accepted: [],
          skipped: [],
          source: "error",
          error: "Seamless candidate sourcing requires a live workspace.",
        };
      }
      if (!workspaceEffectAllowed()) {
        return { accepted: [], skipped: [], source: "error", error: "Workspace unavailable. Retry before sourcing." };
      }
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
        const res = await workspaceFetch("/api/source/seamless/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, ...filters, count }),
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
    [candidatePersistenceAllowed, commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const startSeamlessResearch = useCallback(
    async (candidateId: string): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "Seamless enrichment requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before enrichment." };
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };
      if (cand.sourcePlatform !== "Seamless" || !cand.sourceExternalId) {
        return { ok: false, error: "Not a Seamless-sourced candidate." };
      }
      let res: Response;
      try {
        res = await workspaceFetch("/api/source/seamless/research", {
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
    [candidatePersistenceAllowed, current, workspaceEffectAllowed, workspaceFetch],
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
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "Seamless enrichment requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before enrichment." };
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };

      let res: Response;
      try {
        res = await workspaceFetch(`/api/source/seamless/research-status?requestId=${encodeURIComponent(requestId)}`);
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
    [candidatePersistenceAllowed, commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const startApifyRun = useCallback(
    async (
      campaignId: string,
      criteria: ApifyProfileSearchInput,
    ): Promise<{ ok: true; runId: string; datasetId: string } | { ok: false; error: string }> => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "LinkedIn profile search requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };

      let res: Response;
      try {
        res = await workspaceFetch("/api/source/apify/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, ...criteria }),
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching LinkedIn profile search." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; runId?: string; datasetId?: string; error?: string }
        | null;
      if (!out?.ok || !out.runId || !out.datasetId) {
        return { ok: false, error: out?.error ?? "LinkedIn profile search failed to start." };
      }
      return { ok: true, runId: out.runId, datasetId: out.datasetId };
    },
    [candidatePersistenceAllowed, current, workspaceEffectAllowed, workspaceFetch],
  );

  const checkApifyRun = useCallback(
    async (
      campaignId: string,
      runId: string,
      datasetId: string,
      query: string,
    ): Promise<
      | { ok: true; status: "processing" }
      | { ok: true; status: "completed"; added: number }
      | { ok: false; error: string }
    > => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, error: "LinkedIn profile search requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, error: "Campaign not found." };

      let res: Response;
      try {
        res = await workspaceFetch(
          `/api/source/apify/status?runId=${encodeURIComponent(runId)}&datasetId=${encodeURIComponent(datasetId)}`,
        );
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error reaching LinkedIn profile search." };
      }
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: string; error?: string; profiles?: ApifyProfile[] }
        | null;
      if (!out?.ok) return { ok: false, error: out?.error ?? "LinkedIn profile search status check failed." };
      if (out.status === "processing") return { ok: true, status: "processing" };
      if (out.status !== "completed") return { ok: false, error: out.error ?? "LinkedIn profile search did not complete." };

      const weights = effectiveWeights(campaign.scoringWeights, s.skills);
      const { accepted, skipped } = mapApifyCandidates(out.profiles ?? [], campaign, query, s.candidates, weights);

      commit((prev) => {
        let next: HermesState = { ...prev, candidates: [...accepted, ...prev.candidates] };
        next = recomputeMetrics(next, campaignId);
        next = withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Sourced ${accepted.length} candidates via LinkedIn profile search: ${query}`,
            notes: `Live LinkedIn profile batch. ${skipped.length} skipped by dedupe (${skipped
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
      return { ok: true, status: "completed", added: accepted.length };
    },
    [candidatePersistenceAllowed, commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const enrichCandidate = useCallback(
    async (
      candidateId: string,
      opts?: { want?: EnrichableField[] },
    ): Promise<{ ok: boolean; filled: EnrichableField[]; spend: number; detail: string }> => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, filled: [], spend: 0, detail: "Enrichment requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) {
        return { ok: false, filled: [], spend: 0, detail: "Workspace unavailable. Retry before enrichment." };
      }
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, filled: [], spend: 0, detail: "Candidate not found." };

      const want = opts?.want ?? DEFAULT_ENRICH_FIELDS;
      const budgetCap = s.enrichmentBudgetUnits ?? DEFAULT_ENRICHMENT_BUDGET_UNITS;
      const alreadySpent = (s.enrichmentLedger ?? []).reduce((sum, e) => sum + e.units, 0);
      const budgetRemaining = Math.max(0, budgetCap - alreadySpent);

      let res: Response;
      try {
        res = await workspaceFetch("/api/source/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidate: cand, want, budgetRemaining }),
        });
      } catch (err) {
        return {
          ok: false,
          filled: [],
          spend: 0,
          detail: err instanceof Error ? err.message : "Network error reaching the enrichment service.",
        };
      }
      const out = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            patch?: Partial<
              Pick<
                Candidate,
                | "email"
                | "phone"
                | "currentTitle"
                | "location"
                | "currentCompany"
                | "techStack"
                | "externalIds"
                | "matchScore"
                | "matchBreakdown"
                | "enrichment"
              >
            >;
            attempts?: EnrichmentAttempt[];
            spend?: number;
            error?: string;
          }
        | null;
      if (!out?.ok || !out.patch) {
        return { ok: false, filled: [], spend: 0, detail: out?.error ?? "Enrichment failed." };
      }

      const patch = out.patch;
      const attempts = out.attempts ?? [];
      const spend = out.spend ?? 0;
      const filled = Array.from(new Set(attempts.flatMap((a) => a.fieldsFilled)));
      const byProvider = attempts
        .filter((a) => a.fieldsFilled.length > 0)
        .map((a) => `${a.provider}: ${a.fieldsFilled.join(", ")}`);
      // One ledger entry per provider CALL this run, whether or not it found
      // data (costUnits may be 0) — the audit trail behind
      // state.enrichmentBudgetUnits (see HermesState.enrichmentLedger).
      const ledgerEntries = attempts.map((a) => ({ provider: a.provider, candidateId, units: a.costUnits, at: a.at }));

      commit((prev) => {
        const next: HermesState = {
          ...prev,
          candidates: prev.candidates.map((c) => (c.id === candidateId ? { ...c, ...patch } : c)),
          enrichmentLedger: ledgerEntries.length
            ? [...(prev.enrichmentLedger ?? []), ...ledgerEntries]
            : prev.enrichmentLedger,
        };
        return withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Enriched: ${cand.name}`,
            notes: byProvider.length
              ? `${byProvider.join("; ")}.`
              : "No configured provider had new data for this candidate.",
            outcome: filled.length
              ? `${filled.length} field(s) filled (${spend} unit(s) spent)`
              : `No new data (${spend} unit(s) spent)`,
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: cand.id,
          }),
          cand.campaignId,
        );
      });

      return { ok: true, filled, spend, detail: byProvider.join("; ") || "No new data found." };
    },
    [candidatePersistenceAllowed, commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const enrichCampaign = useCallback(
    async (
      campaignId: string,
      opts?: { want?: EnrichableField[]; concurrency?: number },
    ): Promise<{ ok: boolean; total: number; done: number; filled: number; spend: number; error?: string }> => {
      if (!candidatePersistenceAllowed("live")) {
        return { ok: false, total: 0, done: 0, filled: 0, spend: 0, error: "Enrichment requires a live workspace." };
      }
      if (!workspaceEffectAllowed()) {
        return { ok: false, total: 0, done: 0, filled: 0, spend: 0, error: "Workspace unavailable. Retry before enrichment." };
      }
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, total: 0, done: 0, filled: 0, spend: 0, error: "Campaign not found." };

      const want = opts?.want ?? DEFAULT_ENRICH_FIELDS;
      const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_ENRICH_CONCURRENCY);
      const targets = s.candidates.filter(
        (c) => c.campaignId === campaignId && !want.every((field) => computeCoverage(c).includes(field)),
      );
      if (targets.length === 0) return { ok: true, total: 0, done: 0, filled: 0, spend: 0 };

      let done = 0;
      let filledTotal = 0;
      let spendTotal = 0;
      let stoppedForBudget = false;
      let cursor = 0;

      const worker = async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= targets.length) return;
          const liveState = current();
          const budgetCap = liveState.enrichmentBudgetUnits ?? DEFAULT_ENRICHMENT_BUDGET_UNITS;
          const alreadySpent = (liveState.enrichmentLedger ?? []).reduce((sum, e) => sum + e.units, 0);
          if (alreadySpent >= budgetCap) {
            stoppedForBudget = true;
            return;
          }
          const result = await enrichCandidate(targets[idx].id, { want });
          done += 1;
          if (result.ok) {
            filledTotal += result.filled.length;
            spendTotal += result.spend;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

      commit((prev) =>
        withActivity(
          prev,
          makeActivity({
            type: "sourcing",
            title: `Batch enrichment: ${campaign.jobAnalysis.title}`,
            notes: stoppedForBudget
              ? `Stopped early — enrichment budget exhausted after ${done}/${targets.length} candidate(s).`
              : `Ran the enrichment waterfall for ${done}/${targets.length} candidate(s) missing ${want.join(", ")}.`,
            outcome: `${filledTotal} field(s) filled across ${done} candidate(s), ${spendTotal} unit(s) spent`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        ),
      );

      return { ok: true, total: targets.length, done, filled: filledTotal, spend: spendTotal };
    },
    [candidatePersistenceAllowed, commit, current, enrichCandidate, workspaceEffectAllowed],
  );

  const runSourcingAgent = useCallback(
    async (
      campaignId: string,
      count = 5,
    ): Promise<{
      ok: boolean;
      added: number;
      mode?: "cloud" | "deterministic";
      feedbackReceipts?: SourcingFeedbackReceipt[];
      error?: string;
    }> => {
      if (!candidatePersistenceAllowed("live")) {
        return {
          ok: false,
          added: 0,
          error: "The live sourcing agent requires a live workspace.",
        };
      }
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) {
        return { ok: false, added: 0, error: "Workspace unavailable. Retry before running the sourcing agent." };
      }
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { ok: false, added: 0, error: "Campaign not found." };
      if (!campaignAllowsLiveSourcing(campaign.status)) {
        return { ok: false, added: 0, error: "Campaign is not active for sourcing." };
      }
      const requestedCount = Math.min(Math.max(Math.trunc(count) || 5, 1), 8);
      const reviewed = await requestReviewedSourcing(
        workspaceFetch,
        campaignId,
        requestedCount,
      );
      if (!reviewed.ok) {
        return { ok: false, added: 0, error: reviewed.error };
      }
      const out = reviewed.value;
      const executionMode = out.mode;
      const received = out.candidates;
      const feedbackReceipts = out.feedbackReceipts;
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) {
        return { ok: false, added: 0, error: "Sourcing authority changed during the operation." };
      }

      let authorized = false;
      let added = 0;
      let drafted = 0;
      const persisted = await commitPersisted((prev) => {
        if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return prev;
        const latestCampaign = prev.campaigns.find((item) => item.id === campaignId);
        if (!latestCampaign || !campaignAllowsLiveSourcing(latestCampaign.status)) {
          return prev;
        }
        if (sourcingAgentCampaignFingerprint(latestCampaign) !== out.campaignFingerprint) {
          return prev;
        }
        authorized = true;
        const weights = effectiveWeights(latestCampaign.scoringWeights, prev.skills);
        const finalTone = effectiveTone(prev.skills);
        const candidates = received
          .filter((dto) => {
            if (!dto.draftSubject && !dto.draftBody) return true;
            if (!dto.draftSubject || !dto.draftBody) return false;
            const forbidden = [
              latestCampaign.jobAnalysis.department,
              latestCampaign.jobAnalysis.teamSize,
              latestCampaign.jobAnalysis.reportingTo,
              latestCampaign.jobAnalysis.currency,
            ];
            return (
              validateCandidateBoundText(dto.draftSubject, {
                salaryMin: latestCampaign.jobAnalysis.salaryMin,
                salaryMax: latestCampaign.jobAnalysis.salaryMax,
                forbidden,
              }).safe &&
              validateCandidateBoundText(dto.draftBody, {
                salaryMin: latestCampaign.jobAnalysis.salaryMin,
                salaryMax: latestCampaign.jobAnalysis.salaryMax,
                forbidden,
              }).safe
            );
          })
          .map((dto) => {
            const candidate = candidateFromSourcingAgentDto(dto);
            const scored = scoreCandidate(candidate, latestCampaign.jobAnalysis, weights);
            return { dto, candidate: { ...candidate, matchScore: scored.score, matchBreakdown: scored.breakdown } };
          });
        const unique = dedupeCandidates(
          candidates.map((item) => item.candidate),
          prev.candidates,
          { excludedCompanies: latestCampaign.sourcingStrategy.excludedCompanies },
        ).accepted;
        if (unique.length === 0) return prev;
        const dtoById = new Map(candidates.map((item) => [item.candidate.id, item.dto]));
        const messages = unique.map((candidate) => {
          const dto = dtoById.get(candidate.id)!;
          const voice = enterpriseMantuVoice();
          const generated = dto.draftSubject && dto.draftBody
            ? {
                subject: dto.draftSubject,
                body: dto.draftBody,
                personalizationEvidence: candidate.recentActivity ? [candidate.recentActivity] : [],
                channel: "Email" as const,
              }
            : generateOutreach(
                candidate,
                latestCampaign,
                finalTone,
                "Email",
                1,
                voice,
                latestCampaign.jobAnalysis.language ?? prev.settings.defaultLanguage,
              );
          const quality = validateOutreachQuality({
            subject: generated.subject,
            body: generated.body,
            channel: "Email",
          });
          const gated = {
            ...generated,
            subject: quality.text.subject,
            body: quality.text.body,
          };
          const msg = newOutreachMessage(
            candidate,
            latestCampaign,
            gated,
            finalTone,
            prev.settings,
          );
          if (quality.status === "blocked") {
            msg.status = "Needs Approval";
            msg.qualityStatus = "blocked";
          } else {
            msg.qualityStatus = quality.status;
          }
          msg.qualityScore = quality.aggregateScore;
          msg.htmlBody = mantuEmailHtmlWrapper(gated.body);
          return msg;
        });
        added = unique.length;
        drafted = messages.length;
        let next: HermesState = {
          ...prev,
          candidates: [...unique, ...prev.candidates],
          outreach: [...messages, ...prev.outreach],
        };
        next = recomputeMetrics(next, campaignId);
        return withActivity(
          next,
          makeActivity({
            type: "sourcing",
            title: `Sourcing agent found ${unique.length} candidates`,
            notes:
              executionMode === "cloud"
                ? `${messages.length} drafted for human review after a cloud tool-calling pass.`
                : `${messages.length} drafted for human review after direct GitHub search. No cloud model ran.`,
            outcome: `${unique.length} added, ${messages.length} drafted`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
      });
      if (!persisted || !authorized) {
        return { ok: false, added: 0, error: "The sourcing result could not be saved. Retry safely." };
      }
      if (added > 0) emit({ kind: "source", campaignId, count: added });
      return {
        ok: true,
        added,
        mode: executionMode,
        feedbackReceipts,
        ...(drafted === 0 && added > 0 ? { error: "Candidates were saved without drafts." } : {}),
      };
    },
    [candidatePersistenceAllowed, commitPersisted, current, sourcingMutationAllowed, workspaceEffectAllowed, workspaceFetch],
  );

  const recordSourcingFeedback = useCallback(
    async (receiptId: string, verdict: SourcingFeedbackVerdict): Promise<boolean> => {
      if (
        !workspaceEffectAllowed() ||
        !sourcingMutationAllowed() ||
        !UUID_RE.test(receiptId) ||
        (verdict !== "useful" && verdict !== "dead_end" && verdict !== "corrected")
      ) {
        return false;
      }
      const operationId = crypto.randomUUID();
      let response: Response;
      try {
        response = await workspaceFetch("/api/sourcing-learning/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationId,
            "X-Request-Id": operationId,
          },
          body: JSON.stringify({ receiptId, verdict }),
        });
      } catch {
        return false;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.split(";", 1)[0]?.trim() !== "application/json") return false;
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return Boolean(
        response.ok &&
          body?.ok === true &&
          body.receiptId === receiptId &&
          body.verdict === verdict,
      );
    },
    [sourcingMutationAllowed, workspaceEffectAllowed, workspaceFetch],
  );

  const listPendingSourcingFeedback = useCallback(
    async (campaignId: string): Promise<SourcingFeedbackReceipt[] | null> => {
      if (
        !workspaceEffectAllowed() ||
        !sourcingMutationAllowed() ||
        !campaignId ||
        campaignId.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(campaignId)
      ) {
        return null;
      }
      let response: Response;
      try {
        response = await workspaceFetch(
          `/api/sourcing-learning/feedback?campaignId=${encodeURIComponent(campaignId)}`,
          { headers: { "X-Request-Id": crypto.randomUUID() } },
        );
      } catch {
        return null;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || contentType.split(";", 1)[0]?.trim() !== "application/json") return null;
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (body?.ok !== true || !Array.isArray(body.receipts)) return null;
      if (body.receipts.length === 0) return [];
      return parseSourcingFeedbackReceipts(body.receipts);
    },
    [sourcingMutationAllowed, workspaceEffectAllowed, workspaceFetch],
  );

  const generateOutreachFor = useCallback(
    (candidateId: string, tone?: OutreachTone, channel?: OutreachChannel, seatId?: string) => {
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      // Live/enterprise tenants must use generateOutreachLive — never commit mock here.
      if (refuseMockOutreachOnLiveTenant(false)) return null;
      const resolvedChannel = channel ?? preferredOutreachChannel(candidate);
      const finalTone = tone ?? effectiveTone(s.skills); // learned default tone
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = seat ? { persona: seat.persona, signature: seat.signature } : undefined;
      // Compose in the seat's language, else the need's, else the workspace default.
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      const gen = generateOutreach(candidate, campaign, finalTone, resolvedChannel, 1, voice, lang);
      const msg = newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1);
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Outreach drafted: ${candidate.name}`,
            notes: `${finalTone} ${resolvedChannel} message generated with ${gen.personalizationEvidence.length} personalization points.`,
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
    async (candidateId: string, tone?: OutreachTone, channel?: OutreachChannel, seatId?: string) => {
      if (!workspaceEffectAllowed()) return null;
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const resolvedChannel = channel ?? preferredOutreachChannel(candidate);
      const finalTone = tone ?? effectiveTone(s.skills);
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = enterpriseMantuVoice(seat);
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;

      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, resolvedChannel, 1, voice, lang);

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
          channel: resolvedChannel,
          language: lang,
          persona: voice?.persona,
          signature: voice?.signature,
        });
        // F-2: prepend ariaPrompt when set so it shapes the live generation.
        const ariaPrompt = s.settings.guardrails?.ariaPrompt;
        const liGuard = resolvedChannel === "LinkedIn" ? linkedInGuardrailPrompt() : "";
        const guardrails = [ariaPrompt, liGuard].filter(Boolean).join("\n\n");
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
        const attempt = runWorkspaceEffect(() => hermesGenerate(outreachGenInput));
        if (!attempt.allowed) return null;
        const result = await attempt.value;
        if (result.ok && result.text) {
          // Layer 3: an unparseable reply keeps the mock draft.
          const parsed = parseHermesOutreach(result.text, resolvedChannel, mockGen.subject);
          if (parsed) {
            gen = {
              // ALWAYS humanize live copy too — the mock path already does this
              // (see generateOutreach), so the "no AI slop, ever" guarantee holds
              // regardless of which provider produced the draft.
              subject: humanizeText(parsed.subject),
              body: humanizeText(parsed.body),
              // Reuse the mock's evidence — same shape, deterministic, audit-friendly.
              personalizationEvidence: mockGen.personalizationEvidence,
              channel: resolvedChannel,
            };
            live = true;
          }
        }
      }

      if (refuseMockOutreachOnLiveTenant(live)) return null;

      if (!workspaceEffectAllowed()) return null;

      const quality = validateOutreachQuality({
        subject: gen.subject,
        body: gen.body,
        channel: resolvedChannel,
      });
      gen = {
        ...gen,
        subject: quality.text.subject,
        body: quality.text.body,
      };

      const msg = newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1);
      if (quality.status === "blocked") {
        msg.status = "Needs Approval";
        msg.qualityStatus = "blocked";
      } else {
        msg.qualityStatus = quality.status;
      }
      msg.qualityScore = quality.aggregateScore;
      if (resolvedChannel === "Email") {
        msg.htmlBody = mantuEmailHtmlWrapper(gen.body);
      }

      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        const qualityNote =
          quality.status === "ready"
            ? `Quality ${quality.aggregateScore}/100.`
            : `Quality ${quality.status} (${quality.aggregateScore}/100): ${quality.stages.flatMap((st) => st.reasons).join(", ") || "review"}.`;
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Outreach drafted: ${candidate.name}`,
            notes: `${finalTone} ${resolvedChannel} message ${live ? "drafted by Aria (live)" : "generated"} with ${gen.personalizationEvidence.length} personalization points. ${qualityNote}`,
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
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
  );

  // Task 1 — follow-up sequences. Reuses the exact same draft-creation path as
  // generateOutreachFor (generateOutreach + newOutreachMessage), just with the
  // next sequenceStep so the copy switches to its "follow-up" flavor. This is a
  // derived due-queue, not a background job: it only fires when explicitly
  // called (from the recommendations queue / outreach page), and it only ever
  // creates a Draft that still has to clear the human approval gate.
  const draftFollowUpFor = useCallback(
    async (candidateId: string, tone?: OutreachTone, seatId?: string) => {
      if (!workspaceEffectAllowed()) return null;
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
      const voice = enterpriseMantuVoice(seat);
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      // Keep following up on whichever channel the candidate was originally reached on.
      const channel: OutreachChannel = candidate.outreachHistory[0]?.channel ?? "Email";
      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, channel, due.nextSequenceStep, voice, lang);
      // Live attempt — same three-layer fallback as generateOutreachLive, so a
      // follow-up touch isn't silently downgraded to canned copy at scale.
      const { gen: liveGen, live } = await attemptLiveFollowUpGen({
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
        runEffect: runWorkspaceEffect,
      });
      if (refuseMockOutreachOnLiveTenant(live)) return null;
      if (!workspaceEffectAllowed()) return null;
      const quality = validateOutreachQuality({
        subject: liveGen.subject,
        body: liveGen.body,
        channel,
      });
      const gen = {
        ...liveGen,
        subject: quality.text.subject,
        body: quality.text.body,
      };
      const msg = {
        ...newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, due.nextSequenceStep),
        createdAt: draftedAt,
      };
      if (quality.status === "blocked") {
        msg.status = "Needs Approval";
        msg.qualityStatus = "blocked";
      } else {
        msg.qualityStatus = quality.status;
      }
      msg.qualityScore = quality.aggregateScore;
      if (channel === "Email") {
        msg.htmlBody = mantuEmailHtmlWrapper(gen.body);
      }
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Follow-up drafted: ${candidate.name}`,
            notes: `Sequence step ${due.nextSequenceStep} · ${Math.floor(due.daysSinceContact)}d of silence since last contact${live ? " (Aria live)" : ""}. Quality ${quality.status} (${quality.aggregateScore}/100).`,
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
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
  );

  // #Vivier re-contact. Unlike draftFollowUpFor (which is gated to candidates
  // still in the "Contacted but silent" sequence), a pooled candidate is by
  // definition Rejected / Not Interested, so this drafts a fresh re-engagement
  // outreach regardless of stage. Still only a Draft behind the approval gate.
  const draftRecontactFor = useCallback(
    async (candidateId: string, tone?: OutreachTone, seatId?: string) => {
      if (!workspaceEffectAllowed()) return null;
      const s = current();
      // Same createdAt-before-await fix as draftFollowUpFor — see comment there.
      const draftedAt = new Date().toISOString();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      const finalTone = tone ?? effectiveTone(s.skills);
      const seat = seatId ? s.seats.find((x) => x.id === seatId) : undefined;
      const voice = enterpriseMantuVoice(seat);
      const lang = seat?.language ?? campaign.jobAnalysis.language ?? s.settings.defaultLanguage;
      const channel: OutreachChannel = candidate.outreachHistory[0]?.channel ?? "Email";
      // Mock is the canonical fallback (and the source of personalization evidence).
      const mockGen = generateOutreach(candidate, campaign, finalTone, channel, 1, voice, lang);
      // Live attempt — same three-layer fallback as generateOutreachLive, so a
      // #Vivier re-contact isn't silently downgraded to canned copy either.
      const { gen: liveGen, live } = await attemptLiveFollowUpGen({
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
        runEffect: runWorkspaceEffect,
      });
      if (refuseMockOutreachOnLiveTenant(live)) return null;
      if (!workspaceEffectAllowed()) return null;
      const quality = validateOutreachQuality({
        subject: liveGen.subject,
        body: liveGen.body,
        channel,
      });
      const gen = {
        ...liveGen,
        subject: quality.text.subject,
        body: quality.text.body,
      };
      const msg = { ...newOutreachMessage(candidate, campaign, gen, finalTone, s.settings, 1), createdAt: draftedAt };
      if (quality.status === "blocked") {
        msg.status = "Needs Approval";
        msg.qualityStatus = "blocked";
      } else {
        msg.qualityStatus = quality.status;
      }
      msg.qualityScore = quality.aggregateScore;
      if (channel === "Email") {
        msg.htmlBody = mantuEmailHtmlWrapper(gen.body);
      }
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Re-contact drafted: ${candidate.name}`,
            notes: `#Vivier re-engagement${candidate.silverMedalist ? " (Silver Medalist)" : ""}. Quality ${quality.status} (${quality.aggregateScore}/100). Awaiting approval${live ? " (Aria live)" : ""}.`,
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
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) return;
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      const candidate = msg && s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = msg && s.campaigns.find((c) => c.id === msg.campaignId);
      if (!msg || !candidate || !campaign) return;
      const nextTone = tone ?? msg.tone;
      const voice = enterpriseMantuVoice();

      // Mock is the canonical fallback (and the source of personalization evidence) —
      // same shape as before this went live.
      const mockGen = generateOutreach(candidate, campaign, nextTone, msg.channel, msg.sequenceStep, voice);

      // Live attempt — the exact same three-layer fallback as generateOutreachLive:
      // Layer 1 only fires when a cloud provider or hermes live mode is configured;
      // Layer 2 keeps the mock on a non-ok result; Layer 3 keeps the mock on an
      // unparseable reply. A failed/unconfigured live call always keeps the mock draft.
      let gen: GeneratedOutreach = mockGen;
      let live = false;
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
          persona: voice.persona,
        });
        const ariaPrompt = s.settings.guardrails?.ariaPrompt;
        const liGuard = msg.channel === "LinkedIn" ? linkedInGuardrailPrompt() : "";
        const composed = [ariaPrompt, liGuard].filter(Boolean).join("\n\n");
        const prompt = composed ? `${composed}\n\n${basePrompt}` : basePrompt;

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

        const attempt = runWorkspaceEffect(() => hermesGenerate(regenGenInput));
        if (!attempt.allowed) return;
        const result = await attempt.value;
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
            live = true;
          }
        }
      }

      if (refuseMockOutreachOnLiveTenant(live)) return;
      if (!workspaceEffectAllowed()) return;
      const quality = validateOutreachQuality({
        subject: gen.subject,
        body: gen.body,
        channel: msg.channel,
      });
      gen = {
        ...gen,
        subject: quality.text.subject,
        body: quality.text.body,
      };
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
                qualityStatus: quality.status === "blocked" ? "blocked" : quality.status,
                qualityScore: quality.aggregateScore,
                ...(msg.channel === "Email" ? { htmlBody: mantuEmailHtmlWrapper(gen.body) } : {}),
              }
            : m,
        ),
      }));
    },
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
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

      if (!workspaceEffectAllowed()) return approvalBlocked("Workspace unavailable. Retry before approving outreach.");
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
          const persisted = await recordOutreachApproval({ messageId, ...approvalSnapshot }, workspaceFetch);
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
            // The approval POST already succeeded. Its idempotent rollback must
            // remain available if hydration changes readiness before revalidation.
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const confirmManualSend = useCallback(
    async (messageId: string): Promise<{ ok: boolean; error?: string; dryRun?: boolean }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before confirming." };
      }
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      if (!msg) return { ok: false, error: "Message not found." };
      if (msg.channel !== "LinkedIn") return { ok: false, error: "Manual send confirmation is only for LinkedIn messages." };
      if (msg.status !== "Pending Manual Send") return { ok: false, error: "Message is not awaiting manual send." };
      const candidate = s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = s.campaigns.find((c) => c.id === msg.campaignId);
      if (!candidate || !campaign) return { ok: false, error: "Linked candidate/campaign missing." };
      const profile = (candidate.linkedinUrl ?? "").trim();
      if (!profile) return { ok: false, error: "Candidate has no LinkedIn profile URL." };

      const linkedInSeat =
        s.seats.find(
          (seat) =>
            seat.status === "active" &&
            (seat.provider === "LinkedIn Assisted Manual" || seat.provider === "LinkedIn Vendor API") &&
            seat.mode === "live",
        ) ??
        s.seats.find(
          (seat) =>
            seat.provider === "LinkedIn Assisted Manual" || seat.provider === "LinkedIn Vendor API",
        );

      if (supabaseEnabled) {
        if (!linkedInSeat) {
          return {
            ok: false,
            error: "Connect a LinkedIn seat in Settings → Integrations before confirming sends.",
          };
        }
        try {
          const res = await workspaceFetch("/api/outreach/confirm-manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId,
              candidateId: candidate.id,
              candidateProfileUrl: profile,
              campaignId: campaign.id,
              seatId: linkedInSeat.id,
            }),
          });
          const out = (await res.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
            status?: string;
            detail?: string;
            synced?: boolean;
          } | null;
          if (!out?.ok) {
            return { ok: false, error: out?.error ?? `Confirm failed (${res.status}).` };
          }
          if (out.status === "dry-run") {
            return { ok: true, dryRun: true, error: out.detail };
          }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Network error confirming LinkedIn send.",
          };
        }
      }

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
          seatId: linkedInSeat?.id ?? "",
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  // The deliberate, gated SEND for a live-approved email. Calls the server send route
  // (which re-verifies auth, the live seat, domain, suppression, AND the recorded human
  // approval) and only flips the local record to sent on a real "sent" response. This is
  // the one place a real email leaves; it never fires automatically.
  const sendApprovedOutreach = useCallback(
    async (messageId: string): Promise<{ ok: boolean; error?: string; queued?: boolean }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before sending outreach." };
      }
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
        const res = await workspaceFetch("/api/outreach/send", {
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const rejectOutreach = useCallback(
    async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before changing outreach." };
      }
      const currentState = current();
      const currentMessage = currentState.outreach.find((m) => m.id === messageId);
      if (!currentMessage) return { ok: false, error: "Message not found." };
      if (supabaseEnabled) {
        const revoked = await revokeOutreachApproval(messageId, workspaceFetch);
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
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
      if (!workspaceEffectAllowed()) {
        throw new Error("Workspace unavailable. Retry before classifying replies.");
      }
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

      // IDENTITY: replies route by provider context (the inbox thread id) and the
      // canonical conversation, never by whichever campaign happens to be active.
      // A prior reply or outbound draft on the same provider thread names the
      // candidate; otherwise only an UNAMBIGUOUS address match may auto-assign.
      // Ambiguous or unmatched replies keep candidateId "" and land unassigned in
      // the Replies stream — durable triage, never silent auto-assignment.
      let resolvedCandidateId = input.candidateId;
      let threadCampaignId: string | undefined;
      let ambiguousSender = false;
      if (!resolvedCandidateId) {
        const identity = resolveInboundEmailIdentity({
          candidates: s.candidates,
          replies: s.replies,
          outreach: s.outreach,
          fromAddress: input.fromAddress,
          inboxThreadId: input.inboxThreadId,
        });
        if (identity.status === "matched") {
          resolvedCandidateId = identity.candidateId;
          threadCampaignId = identity.campaignId;
        } else if (identity.status === "ambiguous") {
          ambiguousSender = true;
        }
      }

      const candidate = resolvedCandidateId
        ? s.candidates.find((c) => c.id === resolvedCandidateId)
        : undefined;
      // Auto-ingested mail that did not match stays campaignId "" — never
      // attributed to the active campaign or an arbitrary first campaign.
      const campaignId = input.campaignId ?? candidate?.campaignId ?? threadCampaignId ?? "";

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
          const attempt = runWorkspaceEffect(() => hermesGenerate(classifyInput));
          if (!attempt.allowed) throw new Error("Workspace unavailable. Retry before classifying replies.");
          const result = await attempt.value;
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
      if (ambiguousSender) {
        classification = {
          ...classification,
          suggestedAction: "Queue for human review: sender matches multiple candidates.",
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
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before changing suppression." };
      }
      if (!value.trim()) return { ok: true };
      try {
        const response = await workspaceFetch("/api/compliance/suppress", {
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
    [workspaceEffectAllowed, workspaceFetch],
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
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before applying reply actions." };
      }
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
        const revoked = await Promise.all(
          approvalIds.map((messageId) => revokeOutreachApproval(messageId, workspaceFetch)),
        );
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
    [commit, current, persistSuppressionToServer, workspaceEffectAllowed, workspaceFetch],
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
      const quality = validateOutreachQuality({
        subject: gen.subject,
        body: gen.body,
        channel: reply.channel,
      });
      const gated = {
        ...gen,
        subject: quality.text.subject,
        body: quality.text.body,
      };
      const priorMaxStep = s.outreach
        .filter((m) => m.candidateId === candidate.id)
        .reduce((max, m) => Math.max(max, m.sequenceStep), 0);
      const msg: OutreachMessage = {
        ...newOutreachMessage(candidate, campaign, gated, finalTone, s.settings, priorMaxStep + 1),
        ...(reply.inboxThreadId ? { inboxThreadId: reply.inboxThreadId } : {}),
      };
      if (quality.status === "blocked") {
        msg.status = "Needs Approval";
        msg.qualityStatus = "blocked";
      } else {
        msg.qualityStatus = quality.status;
      }
      msg.qualityScore = quality.aggregateScore;
      if (reply.channel === "Email") {
        msg.htmlBody = mantuEmailHtmlWrapper(gated.body);
      }
      commit((prev) => {
        const next = { ...prev, outreach: [msg, ...prev.outreach] };
        return withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Reply drafted: ${candidate.name}`,
            notes: `${msg.channel} response drafted from the classified reply. Quality ${quality.status} (${quality.aggregateScore}/100). Awaiting approval before anything sends.`,
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

  const {
    createBookingFor,
    updateBooking,
    generateReport,
    setSkillUpdateStatus,
  } = useMemo(
    () =>
      createBookingReportActions({
        commit,
        currentState: () => stateRef.current,
        workspaceEffectAllowed,
        bookingMutationAllowed,
        learningMutationAllowed,
        workspaceFetch,
        liveCalendarEnabled: supabaseEnabled,
        makeActivity,
        withActivity,
        recomputeMetrics,
        emitBooking: emit,
      }),
    [
      commit,
      bookingMutationAllowed,
      learningMutationAllowed,
      workspaceEffectAllowed,
      workspaceFetch,
    ],
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
        // Do NOT invent Booked here — stage advances only via createBookingFor
        // (live Outlook/Teams event + joinUrl). addInterview only records a round.
        const nextStage: CandidateStage = cand.stage;
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
            title: `${kind} round noted: ${cand.name}`,
            notes: `Interviewer: ${interviewer}. Calendar/Teams booking is separate.`,
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
          yearsExperience: null,
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
        if (isCandidateErasureTombstone(cand)) return s;
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
      if (!cand || isCandidateErasureTombstone(cand)) return;
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
      syncCandidateSuppressionToServer(cand, "Restored", "DELETE");
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

  const anonymizeCandidate = useCallback(async (id: string) => {
    if (!workspaceEffectAllowed()) {
      return {
        ok: false as const,
        completed: false as const,
        error: "Workspace unavailable. Retry before anonymizing.",
      };
    }
    const candidate = current().candidates.find((item) => item.id === id);
    if (!candidate) {
      return { ok: false as const, completed: false as const, error: "Candidate not found." };
    }

    const role = supabaseEnabled ? liveRoleRef.current : current().currentRole;
    if (!role || !can(role, "compliance")) {
      return {
        ok: false as const,
        completed: false as const,
        error: "You do not have permission to anonymize candidates.",
      };
    }
    if (!supabaseEnabled) {
      const changed = commit((state) => {
        const exact = state.candidates.find((item) => item.id === id);
        if (!exact) return state;
        return recomputeMetrics(anonymizeHermesState(state, id), exact.campaignId);
      });
      if (!changed) {
        return {
          ok: false as const,
          completed: false as const,
          error: "The local demo record could not be anonymized.",
        };
      }
      return {
        ok: true as const,
        completed: true,
        status: "completed" as const,
        scrubCounts: { browser_demo_state: 1 },
        obligations: [],
        workspaceRefreshRequired: false,
      };
    }
    if (role !== "admin") {
      return {
        ok: false as const,
        completed: false as const,
        error: "Administrator permission is required for candidate erasure.",
      };
    }

    let response: Response;
    let body: unknown;
    try {
      response = await workspaceFetch("/api/admin/candidates/erasure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ campaignId: candidate.campaignId, candidateId: candidate.id }),
      });
      body = await response.json().catch(() => null);
    } catch {
      return {
        ok: false as const,
        completed: false as const,
        error: "Could not reach the candidate erasure service.",
      };
    }
    const receipt = body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    const requestId = typeof receipt?.requestId === "string" ? receipt.requestId : undefined;
    if (!response.ok && response.status !== 202) {
      const code = typeof receipt?.code === "string" ? receipt.code : "";
      const blocked = code === "candidate_erasure_blocked_legal_hold";
      return {
        ok: false as const,
        completed: false as const,
        status: blocked ? "blocked_legal_hold" as const : undefined,
        requestId,
        error: blocked
          ? "Erasure blocked by legal hold. No candidate data was changed."
          : code === "candidate_erasure_obligation_limit_exceeded"
            ? "Candidate erasure requires manual handling because more than 100 provider records are linked. No candidate data was changed."
          : code === "candidate_not_found"
            ? "The candidate was not found in this workspace."
            : code === "insufficient_permissions"
              ? "Administrator permission is required for candidate erasure."
              : "Candidate erasure is unavailable. No completion was recorded.",
      };
    }
    const status = receipt?.status;
    const acceptedStatus = status === "completed"
      || status === "manual_required"
      || status === "pending_provider"
      || status === "retryable_failure";
    if (
      receipt?.ok !== true
      || receipt.campaignId !== candidate.campaignId
      || receipt.candidateId !== candidate.id
      || !acceptedStatus
      || typeof receipt.completed !== "boolean"
      || (status === "completed") !== receipt.completed
      || !Array.isArray(receipt.obligations)
      || !receipt.obligations.every((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
        const obligation = item as Record<string, unknown>;
        return typeof obligation.id === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(obligation.id)
          && typeof obligation.provider === "string"
          && obligation.provider.length >= 1
          && obligation.provider.length <= 64
          && [
            "pending_provider",
            "manual_required",
            "retryable_failure",
            "completed",
          ].includes(String(obligation.status))
          && Number.isInteger(obligation.attemptCount)
          && Number(obligation.attemptCount) >= 0
          && Number(obligation.attemptCount) <= 100;
      })
      || receipt.scrubCounts === null
      || typeof receipt.scrubCounts !== "object"
      || Array.isArray(receipt.scrubCounts)
    ) {
      return {
        ok: false as const,
        completed: false as const,
        error: "Candidate erasure returned an invalid authority receipt.",
      };
    }

    const erasureStatus = status as Exclude<CandidateErasureStatus, "blocked_legal_hold">;
    const maskedState = recomputeMetrics(
      anonymizeHermesState(current(), candidate.id),
      candidate.campaignId,
    );
    stateRef.current = maskedState;
    setState(maskedState);
    try {
      await hydrateWorkspace();
    } catch {
      // The server erasure receipt remains authoritative. Keep the local
      // tombstone masked and require a later workspace refresh.
    }
    return {
      ok: true as const,
      completed: receipt.completed,
      status: erasureStatus,
      requestId,
      scrubCounts: receipt.scrubCounts as Record<string, number>,
      obligations: receipt.obligations as CandidateErasureObligation[],
      workspaceRefreshRequired: workspaceStatusRef.current.phase !== "ready",
    };
  }, [commit, current, hydrateWorkspace, workspaceEffectAllowed, workspaceFetch]);

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
      if (!workspaceEffectAllowed()) {
        return { ok: false, latencyMs: 0, message: "Workspace unavailable. Retry before testing integrations." };
      }
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
          const res = await workspaceFetch("/api/source", { method: "GET" });
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
      } else if (integ.id === "int_outlook" || integ.id === "int_gmail" || integ.id === "int_graph_teams") {
        const t0 = Date.now();
        try {
          const listRes = await workspaceFetch("/api/email/connections", { method: "GET" });
          const list = (await listRes.json().catch(() => null)) as {
            ok?: boolean;
            connections?: { seatId: string; provider: string }[];
            seats?: { provider: string; mode?: string; status?: string; connectedAccount?: string | null }[];
            error?: string;
          } | null;
          const wantProvider = integ.id === "int_gmail" ? "Gmail API" : "Microsoft Graph";
          const match = list?.connections?.find((c) => c.provider === wantProvider);
          if (!match) {
            result = {
              ok: false,
              latencyMs: Date.now() - t0,
              message: `${integ.name}: not connected. Use Connect Outlook on Settings → Integrations.`,
            };
          } else if (integ.id === "int_graph_teams") {
            const liveSeat = (list?.seats ?? []).some(
              (s) =>
                s.provider === "Microsoft Graph" &&
                s.mode === "live" &&
                (s.status === "active" || !s.status) &&
                Boolean(s.connectedAccount?.trim()),
            );
            if (!liveSeat) {
              result = {
                ok: false,
                latencyMs: Date.now() - t0,
                message:
                  "Microsoft Graph / Teams: mailbox connected but seat is not live. Reconnect Outlook so OAuth promotes mode=live.",
              };
            } else {
              const testRes = await workspaceFetch("/api/email/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ seatId: match.seatId }),
              });
              const out = (await testRes.json().catch(() => null)) as {
                ok?: boolean;
                message?: string;
                error?: string;
                latencyMs?: number;
              } | null;
              result = {
                ok: Boolean(out?.ok),
                latencyMs: out?.latencyMs ?? Date.now() - t0,
                message: out?.ok
                  ? `${out.message ?? "Graph OK"} · live seat + webhook ready for Teams confirmLive books.`
                  : out?.message ?? out?.error ?? `${integ.name}: validation failed.`,
              };
            }
          } else {
            const testRes = await workspaceFetch("/api/email/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ seatId: match.seatId }),
            });
            const out = (await testRes.json().catch(() => null)) as {
              ok?: boolean;
              message?: string;
              error?: string;
              latencyMs?: number;
            } | null;
            result = {
              ok: Boolean(out?.ok),
              latencyMs: out?.latencyMs ?? Date.now() - t0,
              message: out?.message ?? out?.error ?? `${integ.name}: validation failed.`,
            };
          }
        } catch {
          result = { ok: false, latencyMs: Date.now() - t0, message: `${integ.name}: probe failed (network).` };
        }
      } else if (integ.id === "int_heyreach") {
        const t0 = Date.now();
        const server = findHeyReachMcpServer(s.settings.mcpServers);
        if (!server) {
          result = {
            ok: false,
            latencyMs: Date.now() - t0,
            message: "HeyReach MCP: not connected. Use Connect HeyReach MCP on Settings → Integrations.",
          };
        } else {
          try {
            const testRes = await workspaceFetch("/api/mcp/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: server.url,
                apiKeyId: server.apiKeyId,
                authStyle: server.authStyle,
                authQueryParam: server.authQueryParam,
              }),
            });
            const out = (await testRes.json().catch(() => null)) as {
              ok?: boolean;
              toolCount?: number;
              error?: string;
            } | null;
            result = {
              ok: Boolean(out?.ok),
              latencyMs: Date.now() - t0,
              message: out?.ok
                ? `HeyReach MCP connected (${out.toolCount ?? server.toolCount ?? 0} tools).`
                : out?.error ?? "HeyReach MCP validation failed.",
            };
          } catch {
            result = { ok: false, latencyMs: Date.now() - t0, message: "HeyReach MCP probe failed (network)." };
          }
        }
      } else if (integ.id === "int_linkedin_rsc") {
        const t0 = Date.now();
        try {
          const listRes = await workspaceFetch("/api/linkedin/connections", { method: "GET" });
          const list = (await listRes.json().catch(() => null)) as {
            seats?: { id: string; mode: string }[];
          } | null;
          const live = list?.seats?.find((s) => s.mode === "live");
          if (!live) {
            result = {
              ok: false,
              latencyMs: Date.now() - t0,
              message: "LinkedIn: not connected. Use Connect my LinkedIn on Settings → Integrations.",
            };
          } else {
            const testRes = await workspaceFetch("/api/linkedin/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ seatId: live.id }),
            });
            const out = (await testRes.json().catch(() => null)) as {
              ok?: boolean;
              message?: string;
              error?: string;
              latencyMs?: number;
            } | null;
            result = {
              ok: Boolean(out?.ok),
              latencyMs: out?.latencyMs ?? Date.now() - t0,
              message: out?.message ?? out?.error ?? "LinkedIn validation failed.",
            };
          }
        } catch {
          result = { ok: false, latencyMs: Date.now() - t0, message: "LinkedIn probe failed (network)." };
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  /* ---- Fleet: seats ----------------------------------------------------- */

  const addSeat = useCallback(
    async (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => {
      if (!workspaceEffectAllowed()) return null;
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
        const attempt = runWorkspaceEffect(() => createFleetSeatOnServer(draft));
        if (!attempt.allowed) return null;
        const created = await attempt.value;
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
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
  );

  // Demo-only fleet seeding. Live workspaces require one real operator mailbox
  // per normalized seat and use addSeat's server-persisted authority path.
  const deployAgents = useCallback(
    (n: number, opts?: { language?: string; namePrefix?: string }) => {
      const s = stateRef.current;
      if (!s) return { created: 0, total: 0, capped: false, max: 0 };
      const max = s.settings.fleet.maxAgents || 300;
      if (supabaseEnabled) {
        return { created: 0, total: s.seats.length, capped: false, max };
      }
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
            title: `Generated ${newSeats.length} demo agents`,
            notes: `Synthetic demo fleet now ${s.seats.length + newSeats.length}/${max}; no mailbox or live sender was provisioned.`,
            outcome: `${newSeats.length} demo agents generated`,
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
      if (!workspaceEffectAllowed()) return;
      if (supabaseEnabled && (patch.operatorEmail !== undefined || patch.mode !== undefined)) {
        const attempt = runWorkspaceEffect(() =>
          patchFleetSeatOnServer(id, { operatorEmail: patch.operatorEmail, mode: patch.mode }),
        );
        if (!attempt.allowed) return;
        void attempt.value;
      }
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    },
    [commit, runWorkspaceEffect, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) return { ok: false, error: "Workspace unavailable. Retry before connecting." };
      if (supabaseEnabled) {
        const attempt = runWorkspaceEffect(() => patchFleetSeatOnServer(id, { operatorEmail: account }));
        if (!attempt.allowed) return { ok: false, error: "Workspace unavailable. Retry before connecting." };
        const synced = await attempt.value;
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
    [commit, runWorkspaceEffect, workspaceEffectAllowed],
  );

  const disconnectSeatAccount = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string; dryRun?: boolean }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before disconnecting." };
      }
      // Live mode: revoke + delete the server-side OAuth connection so the refresh
      // token is actually killed. Awaited — the seat is only marked disconnected
      // locally once the server confirms the connection is actually gone, so a
      // failed revoke can't leave a false "disconnected" assurance while the
      // server still holds a live token.
      if (supabaseEnabled) {
        try {
          const res = await workspaceFetch("/api/email/disconnect", {
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
    [commit, workspaceEffectAllowed, workspaceFetch],
  );

  const toggleSeatLive = useCallback(
    async (id: string): Promise<{ ok: boolean; reason: string }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, reason: "Workspace unavailable. Retry before changing seat mode." };
      }
      const s = current();
      const seat = s.seats.find((x) => x.id === id);
      if (!seat) return { ok: false, reason: "Seat not found." };
      if (seat.mode === "live") {
        if (supabaseEnabled) {
          const attempt = runWorkspaceEffect(() => patchFleetSeatOnServer(id, { mode: "mock" }));
          if (!attempt.allowed) return { ok: false, reason: "Workspace unavailable. Retry before changing seat mode." };
          const synced = await attempt.value;
          if (!synced.ok) return { ok: false, reason: synced.error };
        }
        commit((prev) => ({ ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "mock" } : x)) }));
        return { ok: true, reason: "Switched to dry-run (mock)." };
      }
      const isLinkedIn =
        seat.provider === "LinkedIn Assisted Manual" || seat.provider === "LinkedIn Vendor API";
      if (!isLinkedIn) {
        if (!seat.connectedAccount) return { ok: false, reason: "Connect a mailbox before going live." };
        if (!seat.domainVerified) return { ok: false, reason: "Verify the sending domain (SPF/DKIM/DMARC) first." };
      } else if (seat.provider === "LinkedIn Vendor API") {
        // Vendor seat may go live without mailbox; keys are env-side. Assisted-manual never needs SPF.
      } else if (!seat.connectedAccount?.trim()) {
        // Soft: allow live with empty label — Settings connect stamps connectedAccount.
      }
      if (supabaseEnabled) {
        const attempt = runWorkspaceEffect(() =>
          patchFleetSeatOnServer(id, { mode: "live", operatorEmail: seat.operatorEmail }),
        );
        if (!attempt.allowed) return { ok: false, reason: "Workspace unavailable. Retry before changing seat mode." };
        const synced = await attempt.value;
        if (!synced.ok) return { ok: false, reason: synced.error };
      }
      commit((prev) => {
        const next = { ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "live" as const } : x)) };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Agent set LIVE: ${seat.name}`,
            notes: isLinkedIn
              ? "LinkedIn seat live for assisted-manual or vendor messaging (no mailbox SPF required)."
              : "Seat will send via the official provider API within guardrails.",
            outcome: "Live",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
      return {
        ok: true,
        reason: isLinkedIn
          ? "LinkedIn seat is live. Drafts still need approval; assisted-manual requires Confirm after you send."
          : "Seat is live. Sends still require approval + guardrails.",
      };
    },
    [commit, current, runWorkspaceEffect, workspaceEffectAllowed],
  );

  const verifySeatDomain = useCallback(
    async (id: string): Promise<{ ok: boolean; verified?: boolean; error?: string }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before verifying the domain." };
      }
      const s = current();
      const seat = s.seats.find((x) => x.id === id);
      if (!seat) return { ok: false, error: "Seat not found." };
      const domain = seat.operatorEmail.split("@")[1] ?? "";
      if (!domain) return { ok: false, error: "Connect a mailbox before verifying its domain." };
      try {
        const res = await workspaceFetch("/api/outreach/verify-domain", {
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  /* ---- Fleet: suppression ---------------------------------------------- */

  const addSuppression = useCallback(
    async (entry: { type: SuppressionEntry["type"]; value: string; reason: string; expiresAt?: string | null }) => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before changing suppression." };
      }
      const normalized = normalizeSuppressionValue(
        entry.type as EnforcedSuppressionType,
        entry.value,
      );
      if (!normalized) return { ok: false, error: "Enter a valid suppression value." };
      if (supabaseEnabled) {
        const persisted = await persistManualSuppression(
          {
            type: entry.type as EnforcedSuppressionType,
            value: normalized,
            reason: entry.reason,
            expiresAt: entry.expiresAt,
          },
          "POST",
          workspaceFetch,
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
    [commit, workspaceEffectAllowed, workspaceFetch],
  );

  const removeSuppression = useCallback(
    async (id: string) => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before changing suppression." };
      }
      const entry = stateRef.current?.suppression.find((item) => item.id === id);
      if (!entry) return { ok: false, error: "Suppression not found." };
      if (supabaseEnabled) {
        const persisted = await persistManualSuppression(
          {
            type: entry.type as EnforcedSuppressionType,
            value: entry.value,
            reason: entry.reason,
            expiresAt: entry.expiresAt,
          },
          "DELETE",
          workspaceFetch,
        );
        if (!persisted.ok) return persisted;
      }
      commit((s) => ({ ...s, suppression: s.suppression.filter((item) => item.id !== id) }));
      return { ok: true };
    },
    [commit, workspaceEffectAllowed, workspaceFetch],
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

      // Live tenants must draft via generateOutreachLive — never fleet-commit mock copy.
      if (refuseMockOutreachOnLiveTenant(false)) {
        return {
          ...result,
          assignments: [],
          skipped: [
            ...result.skipped,
            ...result.assignments.map((a) => ({
              candidateId: a.candidateId,
              candidateName: byCand.get(a.candidateId)?.name ?? a.candidateId,
              reason: "Live tenant requires LLM outreach; mock fleet allocate disabled",
            })),
          ],
        };
      }

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

  const recordCandidateLawfulBasis = useCallback(
    (candidateId: string, basis: CandidateLawfulBasis): { ok: true } | { ok: false; error: string } => {
      if (basis !== "consent" && basis !== "legitimate_interest") {
        return { ok: false, error: "Select consent or legitimate interest." };
      }
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };
      if (cand.complianceFlags.anonymized) {
        return { ok: false, error: "Cannot record lawful basis on an anonymized candidate." };
      }
      const now = new Date().toISOString();
      const basisLabel = basis === "consent" ? "Consent" : "Legitimate interest";
      commit((prev) => {
        const next: HermesState = {
          ...prev,
          candidates: prev.candidates.map((c) =>
            c.id === candidateId
              ? {
                  ...c,
                  lawfulBasis: basis,
                  lawfulBasisRecordedAt: now,
                  lawfulBasisSource: "operator_selection" as const,
                }
              : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "compliance",
            title: `Lawful basis recorded: ${cand.name}`,
            notes: `Operator selected ${basisLabel}. Illustrative compliance record only; not a legal determination.`,
            outcome: "Recorded",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      });
      return { ok: true };
    },
    [commit, current],
  );

  const endorseCandidateFit = useCallback(
    (candidateId: string): { ok: true } | { ok: false; error: string } => {
      const s = current();
      const cand = s.candidates.find((c) => c.id === candidateId);
      if (!cand) return { ok: false, error: "Candidate not found." };
      if (cand.complianceFlags.anonymized) {
        return { ok: false, error: "Cannot endorse fit on an anonymized candidate." };
      }
      const floor = s.settings.minScoreToContact;
      if (cand.matchScore >= floor) {
        return { ok: false, error: `Match score ${cand.matchScore} already meets the ${floor} contact floor.` };
      }
      const now = new Date().toISOString();
      commit((prev) => {
        const next: HermesState = {
          ...prev,
          candidates: prev.candidates.map((c) =>
            c.id === candidateId
              ? {
                  ...c,
                  fitEndorsedAt: now,
                  fitEndorsedSource: "operator_selection" as const,
                }
              : c,
          ),
        };
        return withActivity(
          next,
          makeActivity({
            type: "compliance",
            title: `Role fit endorsed: ${cand.name}`,
            notes: `Operator endorsed outreach despite match score ${cand.matchScore} (floor ${floor}). Score unchanged; approval shows a warning.`,
            outcome: "Endorsed",
            campaignId: cand.campaignId,
            linkedEntityType: "candidate",
            linkedEntityId: candidateId,
          }),
          cand.campaignId,
        );
      });
      return { ok: true };
    },
    [commit, current],
  );

  /* ---- API keys (secret stored server-side; never in client state) ------ */

  const saveApiKey = useCallback(
    async (input: { name: string; provider: ApiKeyProvider; value: string }) => {
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before saving credentials." };
      }
      try {
        const res = await workspaceFetch("/api/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const json = await res.json();
        if (!json.ok) return { ok: false as const, error: json.error ?? "Save failed." };
        const status: ApiKey["status"] =
          json.status === "valid" || json.valid === true
            ? "valid"
            : json.status === "invalid" || json.valid === false
              ? "invalid"
              : "untested";
        const key: ApiKey = {
          // D-5: use the server-assigned id so client and server agree on the key id.
          id: json.id ?? genId("key"),
          name: input.name,
          provider: input.provider,
          last4: json.last4 ?? "••••",
          status,
          lastTestedAt: status === "untested" ? null : new Date().toISOString(),
          createdBy: current().settings.operatorName,
          createdAt: new Date().toISOString(),
        };
        commit((prev) =>
          withActivity(
            { ...prev, apiKeys: [key, ...prev.apiKeys] },
            makeActivity({
              type: "system",
              title: `API key saved: ${input.name}`,
              notes: `${input.provider} key stored (••••${key.last4})${json.demo ? " · demo session" : " · backend"}${
                status === "valid" ? " · verified" : status === "invalid" ? " · verify failed" : ""
              }.`,
              outcome: "Saved",
              campaignId: null,
              linkedEntityType: null,
              linkedEntityId: null,
            }),
            null,
          ),
        );
        return {
          ok: true as const,
          key,
          demo: !!json.demo,
          valid: status === "valid",
          detail: typeof json.detail === "string" ? json.detail : undefined,
        };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Network error." };
      }
    },
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const testApiKey = useCallback(
    async (id: string) => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, valid: false, detail: "Workspace unavailable. Retry before testing credentials." };
      }
      const k = current().apiKeys.find((x) => x.id === id);
      try {
        const res = await workspaceFetch("/api/keys/test", {
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  const removeApiKey = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before removing credentials." };
      }
      // D-6: only commit the local removal when the server delete succeeded.
      try {
        const res = await workspaceFetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
    [commit, workspaceEffectAllowed, workspaceFetch],
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
            const res = await sourceNextBatch(campaignId, {
              platform: syntheticSourcingAllowed() ? "Talent Pool" : undefined,
              count: step.count ?? 10,
            });
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
    [current, sourceNextBatch, syntheticSourcingAllowed, generateOutreachLive, draftFollowUpFor, createBookingFor, toggleVivier, generateReport],
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
      if (!workspaceEffectAllowed()) {
        throw new Error("Workspace unavailable. Retry before adding an LLM provider.");
      }
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
    [commit, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) {
        throw new Error("Workspace unavailable. Retry before adding an MCP server.");
      }
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
    [commit, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) {
        return { ok: false, error: "Workspace unavailable. Retry before testing MCP servers." };
      }
      const s = current();
      const server = (s.settings.mcpServers ?? []).find((m) => m.id === id);
      if (!server) return { ok: false, error: "MCP server not found." };
      let out: { ok?: boolean; toolCount?: number; toolNames?: string[]; serverName?: string; error?: string };
      try {
        const res = await workspaceFetch("/api/mcp/test", {
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
    [commit, current, workspaceEffectAllowed, workspaceFetch],
  );

  /* ---- Dust (dust.tt) agent-platform integration ------------------------- */

  /** Test a just-entered workspace id + API key (POST /api/dust/test) without
   *  persisting anything — used by the Settings Connect/Reconnect flow before
   *  the key is saved to the vault. */
  const testDustConnection = useCallback(
    async (workspaceId: string, apiKey: string, region: DustRegion = "us") => {
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before testing Dust." };
      }
      try {
        const res = await workspaceFetch("/api/dust/test", {
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
    [workspaceEffectAllowed, workspaceFetch],
  );

  /** Full Connect flow: live-test the credentials, store and mark the key valid,
   * then write the non-secret configuration through the normalized admin-owned
   * Dust authority route. workspace_state is never an execution authority. */
  const connectDust = useCallback(
    async (workspaceId: string, apiKey: string, region: DustRegion = "us") => {
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before connecting Dust." };
      }
      const test = await testDustConnection(workspaceId, apiKey, region);
      if (!test.ok) return { ok: false as const, error: test.error };
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before connecting Dust." };
      }
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
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before connecting Dust." };
      }
      let configured: { ok?: boolean; error?: string };
      try {
        const response = await workspaceFetch("/api/integrations/dust/config", {
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
    [testDustConnection, saveApiKey, testApiKey, commit, workspaceEffectAllowed, workspaceFetch],
  );

  const updateDustAgentLock = useCallback(
    async (task: DustTask, agentSId: string) => {
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before changing Dust authority." };
      }
      try {
        const response = await workspaceFetch("/api/integrations/dust/config", {
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
    [workspaceEffectAllowed, workspaceFetch],
  );

  const disconnectDust = useCallback(
    async () => {
      if (!workspaceEffectAllowed()) {
        return { ok: false as const, error: "Workspace unavailable. Retry before disconnecting Dust." };
      }
      try {
        const response = await workspaceFetch("/api/integrations/dust/config", { method: "DELETE" });
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
    [commit, workspaceEffectAllowed, workspaceFetch],
  );

  /** Run one locked Dust agent turn. The server resolves workspace, credential,
   * and task lock from normalized authority; this call sends only task + text. */
  const runDustTask = useCallback(async (task: DustTask, message: string) => {
    if (!workspaceEffectAllowed()) {
      return { ok: false as const, error: "Workspace unavailable. Retry before running Dust." };
    }
    try {
      const res = await workspaceFetch("/api/dust/run", {
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
  }, [workspaceEffectAllowed, workspaceFetch]);

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
      if (!workspaceEffectAllowed()) {
        throw new Error("Workspace unavailable. Retry before adding a model.");
      }
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
    [commit, workspaceEffectAllowed],
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
      if (!workspaceEffectAllowed()) return;
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
        const toolLoopController = new AbortController();
        chatAbortControllers.current.set(threadId, toolLoopController);
        try {
          const res = await workspaceFetch("/api/hermes/chat", {
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
            signal: toolLoopController.signal,
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
          if (err instanceof Error && err.name === "AbortError") {
            updateChatMessage(threadId, assistantId, { content: "(cancelled)", pending: false });
            return;
          }
          // Genuine failure — recorded, not swallowed. Still let the streaming Aria
          // path below have a chance before surfacing it.
          liveError = err instanceof Error ? err.message : "Network error contacting the chat tool loop.";
        } finally {
          if (chatAbortControllers.current.get(threadId) === toolLoopController) {
            chatAbortControllers.current.delete(threadId);
          }
        }
      }

      // 4. Live mode: try the Aria proxy with streaming.
      if (hermesAvailable(s.settings)) {
        attemptedLive = true;
        // F-5: create an AbortController so the caller can cancel mid-stream.
        const controller = new AbortController();
        chatAbortControllers.current.set(threadId, controller);
        try {
          const res = await workspaceFetch("/api/hermes/chat", {
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
    [current, appendChatMessage, updateChatMessage, workspaceEffectAllowed, workspaceFetch],
  );

  // F-5: cancel an in-flight sendChat stream (call on component unmount or thread delete).
  const cancelChat = useCallback(
    (threadId: string) => {
      chatAbortControllers.current.get(threadId)?.abort();
      chatAbortControllers.current.delete(threadId);
    },
    [],
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
    if (supabaseEnabled || !workspaceAllowsMutation(workspaceStatusRef.current)) return;
    const fresh = buildSeedState();
    stateRef.current = fresh;
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
      prepareApolloEnrichment,
      enrichApolloCandidate,
      sourceFromSeamless,
      startSeamlessResearch,
      checkSeamlessResearch,
      startApifyRun,
      checkApifyRun,
      enrichCandidate,
      enrichCampaign,
      runSourcingAgent,
      recordSourcingFeedback,
      listPendingSourcingFeedback,
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
      runLearning,
      acceptSkillLearning,
      updateSkillContent,
      recordPiiReveal,
      recordCandidateLawfulBasis,
      endorseCandidateFit,
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
      flushWorkspaceSave,
      createChatThread,
      deleteChatThread,
      clearChatThread,
      appendChatMessage,
      updateChatMessage,
      sendChat,
      cancelChat,
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
      sourceNextBatch, addCandidateFromGithub, addCandidateManual, startSillageMapping, checkSillageMapping, sourceFromApollo, prepareApolloEnrichment, enrichApolloCandidate, sourceFromSeamless, startSeamlessResearch, checkSeamlessResearch, startApifyRun, checkApifyRun, enrichCandidate, enrichCampaign, runSourcingAgent, recordSourcingFeedback, listPendingSourcingFeedback, generateOutreachFor, generateOutreachLive, updateOutreach, regenerateOutreach,
      approveOutreach, confirmManualSend, sendApprovedOutreach, rejectOutreach, draftFollowUpFor, draftRecontactFor, classifyAndStoreReply, markReplyHandled,
      applyReplyAction, draftReplyResponse, createBookingFor, updateBooking, generateReport,
      setSkillUpdateStatus, setCandidateStage, setCandidatePhone, addCandidateNote, setRejectionReason,
      setCandidateRating, setCandidateLeadSource, toggleVivier, savePrequal, setPrequalOutcome, addInterview, updateInterview,
      advanceChatboxSubmission, setChatboxSubmissionStatus, addChatboxSubmission,
      suppressCandidate, markDoNotContact, restoreCandidateContact,
      unsubscribeCandidate, anonymizeCandidate, exportCandidate, updateSettings,
      updateIntegration, toggleIntegrationMode, testIntegration,
      addSeat, deployAgents, updateSeat, setSeatStatus, connectSeatAccount, disconnectSeatAccount, toggleSeatLive, verifySeatDomain,
      addSuppression, removeSuppression, allocateOutreach,
      runLearning, acceptSkillLearning, updateSkillContent, recordPiiReveal, recordCandidateLawfulBasis, endorseCandidateFit,
      saveApiKey, testApiKey, removeApiKey, setCurrentRole,
      updateAriaPrompt, addGuardrailRule, toggleGuardrailRule, removeGuardrailRule, askAria, runAriaPlan,
      addProvider, updateProvider, removeProvider, setDefaultProvider,
      addMcpServer, updateMcpServer, removeMcpServer, testMcpServer,
      testDustConnection, connectDust, updateDustAgentLock, disconnectDust, runDustTask,
      addModel, updateModel, removeModel, setModelDefaultForTask,
      toggleTool,
      assignAgentProvider, assignAgentModel, assignAgentTools,
      logActivity, resetDemo, flushWorkspaceSave,
      createChatThread, deleteChatThread, clearChatThread, appendChatMessage, updateChatMessage, sendChat, cancelChat,
      addSchedule, updateSchedule, removeSchedule, toggleSchedule,
      addInterviewer, updateInterviewer, removeInterviewer,
    ],
  );

  const recommendations = useMemo(
    () => (state ? deriveRecommendations(state) : []),
    [state],
  );

  const value = useMemo<HermesContextValue>(
    () => ({
      state,
      hydrated: workspaceStatus.phase === "ready" && state !== null,
      workspaceStatus,
      retryWorkspace: hydrateWorkspace,
      retrySave,
      flushWorkspaceSave,
      actions,
      recommendations,
    }),
    [state, workspaceStatus, hydrateWorkspace, retrySave, flushWorkspaceSave, actions, recommendations],
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
      minScoreToContact: 80,
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
