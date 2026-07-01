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
  nextInterviewer,
  sourceCandidates,
  mapGithubCandidates,
  type GeneratedOutreach,
  type ReplyClassification,
  type SourceResult,
} from "./mock-ai";
import type { GithubUser } from "./sourcing/github";
import {
  buildOutreachPrompt,
  hermesAvailable,
  hermesGenerate,
  parseHermesOutreach,
} from "./ai/hermes";
import { resolveAiProvider } from "./ai/provider";
import { buildSeedState, defaultGuardrails, defaultLlmProviders, defaultSavedModels, defaultSettings, defaultTools, STATE_VERSION } from "./seed";
import { computeCampaignMetrics, globalKpis, type GlobalKpis } from "./metrics";
import {
  checkOutreachApproval,
  type ApprovalResult,
} from "./rules";
import { checkLinkedInPolicy, linkedInGuardrailPrompt } from "./linkedin-policy";
import { matchCandidateByEmail } from "./email-match";
import {
  testConnection,
  type ConnectionTestResult,
} from "./integrations";
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
  CandidateStage,
  ClassifiedReply,
  HermesState,
  IntegrationStatus,
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
  WeeklyReport,
} from "./types";
import { genId, isoDaysBefore } from "./utils";
import { createCampaign as buildCampaign } from "./mock-ai";
import { supabaseEnabled } from "./supabase/config";
import { loadRemoteState, saveRemoteState } from "./supabase/workspace";
import { allocateBatch, defaultSendWindow, fleetSummary, type FleetSummary } from "./fleet";
import {
  applyLearning,
  effectiveTone,
  effectiveWeights,
  getSkill,
  learnedParamsFor,
  proposeSkillUpdates,
} from "./skills";
import { stageRank } from "./metrics";

const STORAGE_KEY = "hermes-sourcing:v1";

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
  ) => Promise<SourceResult & { source: "github" | "mock" }>;

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
  regenerateOutreach: (messageId: string, tone?: OutreachTone) => void;
  approveOutreach: (messageId: string) => ApprovalResult;
  confirmManualSend: (messageId: string) => { ok: boolean; error?: string };
  /** The deliberate gated send for a live-approved email — calls the server send route. */
  sendApprovedOutreach: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectOutreach: (messageId: string) => void;

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
  applyReplyAction: (replyId: string) => void;

  // bookings
  createBookingFor: (
    candidateId: string,
    opts?: { startTime?: string; interviewerName?: string },
  ) => Promise<{ booking: Booking; prepEmail: string; confirmationEmail: string } | null>;
  updateBooking: (id: string, patch: Partial<Booking>) => void;

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
  suppressCandidate: (id: string) => void;
  markDoNotContact: (id: string) => void;
  unsubscribeCandidate: (id: string) => void;
  anonymizeCandidate: (id: string) => void;
  exportCandidate: (id: string) => string;

  // settings + integrations
  updateSettings: (patch: Partial<SystemSettings>) => void;
  updateIntegration: (id: string, patch: Partial<IntegrationStatus>) => void;
  toggleIntegrationMode: (id: string) => void;
  testIntegration: (id: string) => Promise<ConnectionTestResult>;

  // fleet — multi-seat coordination + anti-ban guardrails
  addSeat: (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => AgentSeat;
  deployAgents: (
    n: number,
    opts?: { language?: string; namePrefix?: string },
  ) => { created: number; total: number; capped: boolean; max: number };
  updateSeat: (id: string, patch: Partial<AgentSeat>) => void;
  setSeatStatus: (id: string, status: AgentSeat["status"]) => void;
  connectSeatAccount: (id: string, account: string) => void;
  disconnectSeatAccount: (id: string) => void;
  toggleSeatLive: (id: string) => { ok: boolean; reason: string };
  addSuppression: (entry: {
    type: SuppressionEntry["type"];
    value: string;
    reason: string;
    expiresAt?: string | null;
  }) => void;
  removeSuppression: (id: string) => void;
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
  removeApiKey: (id: string) => Promise<void>;
  setCurrentRole: (role: Role) => void;

  // guardrails & Aria
  updateAriaPrompt: (text: string) => void;
  addGuardrailRule: (text: string) => void;
  toggleGuardrailRule: (id: string) => void;
  removeGuardrailRule: (id: string) => void;
  askAria: (instruction: string) => { reply: string };

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
}

interface HermesContextValue {
  state: HermesState | null;
  hydrated: boolean;
  actions: HermesActions;
}

const HermesContext = createContext<HermesContextValue | null>(null);

/* ============================================================================
   Provider
   ========================================================================== */

/** Fill in any fields added in recent STATE_VERSIONs without wiping existing data. */
export function migrateToCurrentVersion(parsed: HermesState): HermesState {
  const defs = defaultSettings();
  // STATE_VERSION 12 — the demo moved to Kimi (Kimi Code) via the server env key.
  // Blobs older than 12 have their model layer reset below so returning visitors
  // leave the previous Anthropic default (which would fall back to the mock).
  const preKimi = (parsed.version ?? 0) < 12;
  return {
    ...parsed,
    version: STATE_VERSION,
    // D-2: fill every required root field that may be absent in older blobs.
    campaigns: parsed.campaigns ?? [],
    candidates: parsed.candidates ?? [],
    outreach: parsed.outreach ?? [],
    replies: parsed.replies ?? [],
    bookings: parsed.bookings ?? [],
    reports: parsed.reports ?? [],
    integrations: parsed.integrations ?? [],
    activities: parsed.activities ?? [],
    activeCampaignId: parsed.activeCampaignId ?? null,
    apiKeys: parsed.apiKeys ?? [],
    currentRole: parsed.currentRole ?? "admin",
    skills: parsed.skills ?? [],
    suppression: parsed.suppression ?? [],
    ledger: parsed.ledger ?? [],
    // Inbound-email dedup ledger — initialise on upgrade so re-sync after an
    // upgrade can't double-create replies for already-ingested messages.
    ingestedMessageIds: parsed.ingestedMessageIds ?? [],
    // STATE_VERSION 9 — per-agent chat threads.
    chats: parsed.chats ?? [],
    // STATE_VERSION 10 — per-agent memory.
    memory: parsed.memory ?? [],
    // STATE_VERSION 11 — schedules.
    schedules: parsed.schedules ?? [],
    settings: {
      ...parsed.settings,
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
      // STATE_VERSION 11 — Aria management API URL.
      hermesWebUrl: parsed.settings.hermesWebUrl ?? defs.hermesWebUrl ?? "",
    },
    seats: (parsed.seats ?? []).map((seat) => ({
      ...seat,
      providerId: seat.providerId,
      modelId: seat.modelId,
      toolIds: seat.toolIds,
    })),
  };
}

function loadState(): HermesState {
  if (typeof window === "undefined") return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HermesState;
      if (parsed && parsed.version === STATE_VERSION) return parsed;
      // Migrate from a prior version rather than wiping all data.
      if (parsed && typeof parsed.version === "number" && parsed.version >= STATE_VERSION - 3) {
        return migrateToCurrentVersion(parsed);
      }
    }
  } catch {
    /* corrupt → reseed */
  }
  return buildSeedState();
}

export function HermesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HermesState | null>(null);
  const stateRef = useRef<HermesState | null>(null);
  stateRef.current = state;
  const workspaceIdRef = useRef<string>("");
  // Optimistic-concurrency token: the workspace_state.updated_at we last loaded/saved.
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(false);
  // F-5: AbortControllers for in-flight sendChat requests, keyed by threadId.
  const chatAbortControllers = useRef<Map<string, AbortController>>(new Map());

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
          if (remote.state) {
            skipNextPersist.current = true; // don't re-save what we just loaded
            // D-1: run migration when the persisted version is behind current.
            setState(remote.state.version < STATE_VERSION ? migrateToCurrentVersion(remote.state) : remote.state);
          } else {
            const seeded = buildSeedState();
            setState(seeded);
            if (remote.workspaceId) {
              void saveRemoteState(remote.workspaceId, seeded, null).then((res) => {
                if (res.ok && res.updatedAt) remoteUpdatedAtRef.current = res.updatedAt;
              });
            }
          }
          return;
        }
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
              const migrated =
                latestState.version < STATE_VERSION ? migrateToCurrentVersion(latestState) : latestState;
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
              setState({ ...migrated, activities: [notice, ...migrated.activities].slice(0, 300) });
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
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota / private mode — ignore for demo */
      }
    }
  }, [state]);

  const commit = useCallback((fn: (s: HermesState) => HermesState) => {
    setState((prev) => {
      const base = prev ?? stateRef.current;
      if (!base) return prev;
      const next = fn(base);
      stateRef.current = next;
      return next;
    });
  }, []);

  const current = useCallback(() => stateRef.current ?? buildSeedState(), []);

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
    return {
      ...s,
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId
          ? { ...c, metrics: computeCampaignMetrics(cands, c.metrics) }
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
      commit((s) => ({
        ...s,
        campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })),
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
    ): Promise<SourceResult & { source: "github" | "mock" }> => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { accepted: [], skipped: [], source: "mock" };
      const platform: SourcePlatform =
        opts?.platform ?? (campaign.jobAnalysis.department === "Design" ? "LinkedIn" : "GitHub");
      const count = opts?.count ?? 6;
      const weights = effectiveWeights(campaign.scoringWeights, s.skills); // learned scoring

      let result: SourceResult = { accepted: [], skipped: [] };
      let source: "github" | "mock" = "mock";

      // Try REAL sourcing on GitHub first. The server resolves GITHUB_TOKEN and
      // answers `source: "mock"` when none is set, so this is fully functional in
      // demo mode and goes live the moment a token exists. When a token IS present
      // the real result is authoritative even at zero hits (no synthetic injection).
      // LinkedIn has no public search API, so it stays synthetic.
      if (platform === "GitHub") {
        const query =
          campaign.sourcingStrategy.githubQueries[0]?.query ??
          `language:${(campaign.jobAnalysis.requiredSkills[0] ?? "typescript").toLowerCase()}`;
        try {
          const res = await fetch("/api/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, count }),
          });
          const out = (await res.json().catch(() => null)) as
            | { ok?: boolean; source?: string; users?: GithubUser[] }
            | null;
          if (out?.ok && out.source === "github") {
            result =
              out.users && out.users.length > 0
                ? mapGithubCandidates(out.users, campaign, query, s.candidates, weights)
                : { accepted: [], skipped: [] };
            source = "github";
          }
        } catch {
          // network/route failure — fall through to synthetic below
        }
      }

      // Fallback: synthetic sourcing (demo, no token, LinkedIn, or route failure).
      if (source === "mock") {
        result = sourceCandidates(campaign, platform, count, s.candidates, s.candidates.length, weights);
      }

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
            title: `Sourced ${result.accepted.length} candidates`,
            notes: `${source === "github" ? "Live GitHub" : `${platform} synthetic`} batch. ${result.skipped.length} skipped by dedupe (${result.skipped
              .slice(0, 3)
              .map((x) => x.reason)
              .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
            outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped${source === "github" ? " (live)" : ""}`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      return { ...result, source };
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
            title: `Outreach drafted — ${candidate.name}`,
            notes: `${finalTone} ${channel} message generated with ${gen.personalizationEvidence.length} personalization points.`,
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
          tone: finalTone,
          channel,
          language: lang,
          persona: voice?.persona,
          signature: voice?.signature,
        });
        // F-2: prepend ariaPrompt when set so it shapes the live generation.
        const ariaPrompt = s.settings.guardrails?.ariaPrompt;
        const guardrails = [ariaPrompt, linkedInGuardrailPrompt()].filter(Boolean).join("\n\n");
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
              subject: parsed.subject,
              body: parsed.body,
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
            title: `Outreach drafted — ${candidate.name}`,
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

  const updateOutreach = useCallback(
    (messageId: string, patch: Partial<OutreachMessage>) =>
      commit((s) => ({
        ...s,
        outreach: s.outreach.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      })),
    [commit],
  );

  const regenerateOutreach = useCallback(
    (messageId: string, tone?: OutreachTone) => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      const candidate = msg && s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = msg && s.campaigns.find((c) => c.id === msg.campaignId);
      if (!msg || !candidate || !campaign) return;
      const nextTone = tone ?? msg.tone;
      const gen = generateOutreach(candidate, campaign, nextTone, msg.channel, msg.sequenceStep);
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
    (messageId: string): ApprovalResult => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      if (!msg) return { allowed: false, blockers: ["Message not found."], warnings: [] };
      const candidate = s.candidates.find((c) => c.id === msg.candidateId);
      const campaign = s.campaigns.find((c) => c.id === msg.campaignId);
      if (!candidate || !campaign)
        return { allowed: false, blockers: ["Linked candidate/campaign missing."], warnings: [] };

      const result = checkOutreachApproval({
        candidate,
        message: msg,
        settings: s.settings,
        emailsSentToday: campaign.metrics.emailsSentToday,
        linkedinSentToday: campaign.metrics.linkedinSentToday,
      });
      if (!result.allowed) return result;

      // Persist the human approval server-side so /api/outreach/send can verify it
      // (never-auto-send is enforced server-side, not only in the browser). Recording
      // an approval never sends anything. Fire-and-forget: if it fails, a later send
      // simply refuses with 403 — fail-safe.
      if (supabaseEnabled) {
        void fetch("/api/outreach/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, subject: msg.subject, body: msg.body }),
        }).catch(() => {});
      }

      const now = new Date().toISOString();
      // LinkedIn is assisted-manual: the system drafts the message but a human must
      // copy/paste it on the candidate's profile. Keep it out of the sent counter
      // and ledger until the operator confirms the manual send.
      const isLive = !s.settings.dryRunMode;
      const isLinkedInManual = msg.channel === "LinkedIn" && isLive;
      const isEmailLive = msg.channel === "Email" && isLive;
      // HYBRID send model: in LIVE mode an approval records approval and holds the
      // de-dupe slot (ledger 'claimed') but NEVER sends — an explicit sendApprovedOutreach()
      // actually delivers and only then flips to 'sent'. In dry-run/demo we simulate the
      // send so the showcase stays alive. This is the never-auto-send guarantee.
      const isPendingSend = isLinkedInManual || isEmailLive;
      const finalStatus: OutreachStatus = isLinkedInManual
        ? "Pending Manual Send"
        : isEmailLive
          ? "Approved"
          : "Scheduled";
      const finalLedgerStatus: LedgerStatus = isLinkedInManual
        ? "pending_manual"
        : isEmailLive
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
            : isEmailLive
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
            title: `Outreach approved — ${candidate.name}`,
            notes: isLinkedInManual
              ? "LinkedIn message approved, pending manual copy/paste by operator."
              : isEmailLive
                ? "Email approved, awaiting an explicit send."
                : `${msg.channel} message approved. ${prev.settings.dryRunMode ? "Dry-run, nothing sent." : "Live send."}`,
            outcome: isLinkedInManual
              ? "Pending Manual Send"
              : isEmailLive
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
            title: `LinkedIn message sent — ${candidate.name}`,
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
    async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
      const s = current();
      const msg = s.outreach.find((m) => m.id === messageId);
      if (!msg) return { ok: false, error: "Message not found." };
      if (msg.status !== "Approved") return { ok: false, error: "Only an approved message can be sent." };
      const candidate = s.candidates.find((c) => c.id === msg.candidateId);
      if (!candidate) return { ok: false, error: "Linked candidate missing." };
      // Resolve a live seat for the message's channel: a domain-verified mailbox for
      // Email, or a live WhatsApp / SMS sender for the phone channels.
      const channel = msg.channel;
      const seat =
        channel === "WhatsApp"
          ? s.seats.find((x) => x.status === "active" && x.mode === "live" && x.provider === "WhatsApp Cloud")
          : channel === "SMS"
            ? s.seats.find((x) => x.status === "active" && x.mode === "live" && x.provider === "Twilio SMS")
            : s.seats.find((x) => x.status === "active" && x.mode === "live" && x.domainVerified);
      if (!supabaseEnabled || !seat) {
        const need =
          channel === "WhatsApp"
            ? "live WhatsApp sender"
            : channel === "SMS"
              ? "live SMS sender"
              : "live, domain-verified mailbox";
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
      if (out.status !== "sent") {
        return { ok: false, error: out.detail ?? `Send did not complete (${out.status ?? "unknown"}).` };
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
    (messageId: string) =>
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
      }),
    [commit],
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
                    stage: c.stage === "Contacted" ? "Replied" : c.stage,
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
            title: `Reply classified${candidate ? ` — ${candidate.name}` : ""}`,
            notes: `Intent ${classification.intent} at ${(classification.confidence * 100).toFixed(0)}% confidence.`,
            outcome: classification.intent,
            campaignId,
            linkedEntityType: candidate ? "candidate" : null,
            linkedEntityId: candidate?.id ?? null,
          }),
          campaignId,
        );
      });
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

  const applyReplyAction = useCallback(
    (replyId: string) =>
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
                    stage: target,
                    complianceFlags:
                      reply.intent === "NEGATIVE"
                        ? { ...c.complianceFlags, doNotContact: true, suppressed: true }
                        : c.complianceFlags,
                  }
                : c,
            ),
          };
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
      }),
    [commit],
  );

  const createBookingFor = useCallback(
    async (candidateId: string, opts?: { startTime?: string; interviewerName?: string }) => {
      const s = current();
      const candidate = s.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && s.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      // Never book a candidate who opted out / is suppressed (compliance).
      const cf = candidate.complianceFlags;
      if (cf.doNotContact || cf.suppressed || cf.unsubscribed) return null;

      const all = getInterviewerByName(opts?.interviewerName) ?? nextInterviewer(s.bookings.length);
      const start = opts?.startTime ? new Date(opts.startTime) : defaultSlot();
      const booking = createBooking(candidate, campaign, all, start);
      const prep = interviewerPrepEmail(booking, candidate);
      const confirm = candidateConfirmationEmail(booking);

      commit((prev) => {
        let next: HermesState = {
          ...prev,
          bookings: [booking, ...prev.bookings],
          candidates: prev.candidates.map((c) =>
            c.id === candidate.id ? { ...c, stage: "Booked", booking } : c,
          ),
        };
        next = recomputeMetrics(next, campaign.id);
        next = withActivity(
          next,
          makeActivity({
            type: "booking",
            title: `Interview booked — ${candidate.name}`,
            notes: `${booking.interviewer}. Teams + Cal.com links generated. Stage → Booked.`,
            outcome: "Confirmed",
            campaignId: campaign.id,
            linkedEntityType: "booking",
            linkedEntityId: booking.id,
          }),
          campaign.id,
        );
        return next;
      });

      // Create a REAL calendar event when a live mailbox is connected, then reconcile
      // the booking's calLink to the real event URL. This never blocks the booking from
      // being recorded; demo mode or a mail-only connection keeps the synthetic link.
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
          const out = (await res.json().catch(() => null)) as { status?: string; link?: string | null } | null;
          if (out?.status === "created" && out.link) {
            const link = out.link;
            commit((prev) => ({
              ...prev,
              bookings: prev.bookings.map((b) => (b.id === booking.id ? { ...b, calLink: link } : b)),
              candidates: prev.candidates.map((c) =>
                c.id === candidate.id && c.booking?.id === booking.id
                  ? { ...c, booking: { ...c.booking, calLink: link } }
                  : c,
              ),
            }));
          }
        } catch {
          // calendar failure — keep the synthetic link
        }
      }

      return { booking, prepEmail: prep, confirmationEmail: confirm };
    },
    [commit, current],
  );

  const updateBooking = useCallback(
    (id: string, patch: Partial<Booking>) =>
      commit((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      })),
    [commit],
  );

  const generateReport = useCallback(
    (campaignId: string) => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return null;
      const report = generateWeeklyReport(campaign, s.candidates);
      commit((prev) => {
        let next: HermesState = {
          ...prev,
          reports: [report, ...prev.reports.filter((r) => r.campaignId !== campaignId)],
          campaigns: prev.campaigns.map((c) =>
            c.id === campaignId ? { ...c, skillUpdates: report.skillUpdates.map((x) => ({ ...x })) } : c,
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
          candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage } : c)),
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

  const complianceMutate = useCallback(
    (id: string, fn: (c: Candidate) => Candidate, label: string, outcome: string) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        if (!cand) return s;
        let next: HermesState = {
          ...s,
          candidates: s.candidates.map((c) => (c.id === id ? fn(c) : c)),
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
    (id: string) =>
      complianceMutate(
        id,
        (c) => ({
          ...c,
          stage: "Suppressed",
          complianceFlags: {
            ...c.complianceFlags,
            suppressed: true,
            suppressedUntil: isoDaysBefore(-90),
          },
        }),
        "Contact suppressed",
        "Suppressed",
      ),
    [complianceMutate],
  );

  const markDoNotContact = useCallback(
    (id: string) =>
      complianceMutate(
        id,
        (c) => ({
          ...c,
          stage: "Suppressed",
          complianceFlags: { ...c.complianceFlags, doNotContact: true, suppressed: true },
        }),
        "Marked do-not-contact",
        "Do-not-contact",
      ),
    [complianceMutate],
  );

  const unsubscribeCandidate = useCallback(
    (id: string) =>
      complianceMutate(
        id,
        (c) => ({ ...c, complianceFlags: { ...c.complianceFlags, unsubscribed: true } }),
        "Unsubscribe honored",
        "Unsubscribed",
      ),
    [complianceMutate],
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
            | { connected?: boolean; login?: string; reason?: string }
            | null;
          const latencyMs = Date.now() - t0;
          result = out?.connected
            ? { ok: true, latencyMs, message: `Connected to GitHub as ${out.login}.` }
            : {
                ok: false,
                latencyMs,
                message: out?.reason ?? "GitHub not connected. Set GITHUB_TOKEN to source real candidates.",
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
    (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => {
      const now = new Date().toISOString();
      const seat: AgentSeat = {
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
      commit((s) =>
        withActivity(
          { ...s, seats: [...s.seats, seat] },
          makeActivity({
            type: "system",
            title: `Aria agent added — ${seat.name}`,
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
      const s = current();
      const max = s.settings.fleet.maxAgents || 300;
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
    [commit, current],
  );

  const updateSeat = useCallback(
    (id: string, patch: Partial<AgentSeat>) =>
      commit((s) => ({ ...s, seats: s.seats.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
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
            title: `Agent ${status} — ${seat?.name ?? id}`,
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
    (id: string, account: string) =>
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
            title: `Mailbox connected — ${seat?.name ?? id}`,
            notes: `${account} connected via official API. Verify domain before live sends.`,
            outcome: "Connected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      }),
    [commit],
  );

  const disconnectSeatAccount = useCallback(
    (id: string) => {
      // Live mode: revoke + delete the server-side OAuth connection so the refresh
      // token is actually killed (fire-and-forget; local state updates immediately).
      if (supabaseEnabled) {
        void fetch("/api/email/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seatId: id }),
        }).catch(() => {});
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
            title: `Mailbox disconnected — ${seat?.name ?? id}`,
            notes: "OAuth email connection removed.",
            outcome: "Disconnected",
            campaignId: null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          null,
        );
      });
    },
    [commit],
  );

  const toggleSeatLive = useCallback(
    (id: string): { ok: boolean; reason: string } => {
      const s = current();
      const seat = s.seats.find((x) => x.id === id);
      if (!seat) return { ok: false, reason: "Seat not found." };
      if (seat.mode === "live") {
        commit((prev) => ({ ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "mock" } : x)) }));
        return { ok: true, reason: "Switched to dry-run (mock)." };
      }
      if (!seat.connectedAccount) return { ok: false, reason: "Connect a mailbox before going live." };
      if (!seat.domainVerified) return { ok: false, reason: "Verify the sending domain (SPF/DKIM/DMARC) first." };
      commit((prev) => {
        const next = { ...prev, seats: prev.seats.map((x) => (x.id === id ? { ...x, mode: "live" as const } : x)) };
        return withActivity(
          next,
          makeActivity({
            type: "system",
            title: `Agent set LIVE — ${seat.name}`,
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

  /* ---- Fleet: suppression ---------------------------------------------- */

  const addSuppression = useCallback(
    (entry: { type: SuppressionEntry["type"]; value: string; reason: string; expiresAt?: string | null }) =>
      commit((s) => {
        const e: SuppressionEntry = {
          id: genId("supp"),
          type: entry.type,
          value: entry.value.trim().toLowerCase(),
          reason: entry.reason,
          source: "Operator",
          createdAt: new Date().toISOString(),
          expiresAt: entry.expiresAt ?? null,
        };
        return withActivity(
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
        );
      }),
    [commit],
  );

  const removeSuppression = useCallback(
    (id: string) => commit((s) => ({ ...s, suppression: s.suppression.filter((x) => x.id !== id) })),
    [commit],
  );

  /* ---- Fleet: coordinated allocation (the anti-double-contact core) ----- */

  const allocateOutreach = useCallback(
    (opts?: { campaignId?: string; pool?: "ready" | "interested" }): AllocationResult => {
      const s = current();
      const poolKind = opts?.pool ?? "ready";
      const pool = s.candidates.filter((c) => {
        if (opts?.campaignId && c.campaignId !== opts.campaignId) return false;
        if (c.complianceFlags.doNotContact || c.complianceFlags.unsubscribed) return false;
        if (poolKind === "interested") return c.stage === "Interested";
        return c.matchScore >= s.settings.minScoreToContact && stageRank(c.stage) < 1;
      });
      const activeSeats = s.seats.filter((x) => x.status === "active");
      const result = allocateBatch(pool, activeSeats, s.ledger, s.suppression, s.settings.fleet, new Date());
      if (result.assignments.length === 0) return result;

      const now = new Date().toISOString();
      const byCand = new Map(s.candidates.map((c) => [c.id, c]));
      const perSeatCount = new Map<string, number>();
      const ledgerAdds: OutreachLedgerEntry[] = result.assignments.map((a) => {
        perSeatCount.set(a.seatId, (perSeatCount.get(a.seatId) ?? 0) + 1);
        const cand = byCand.get(a.candidateId);
        return {
          id: genId("led"),
          candidateId: a.candidateId,
          candidateEmail: cand?.email ?? "",
          seatId: a.seatId,
          campaignId: cand?.campaignId ?? "",
          channel: "Email",
          status: "sent", // dry-run send recorded in the ledger
          reason: null,
          at: now,
        };
      });
      const assignedIds = new Set(result.assignments.map((a) => a.candidateId));
      const affected = new Set(ledgerAdds.map((l) => l.campaignId));

      commit((prev) => {
        let next: HermesState = {
          ...prev,
          ledger: [...ledgerAdds, ...prev.ledger],
          seats: prev.seats.map((x) =>
            perSeatCount.has(x.id)
              ? { ...x, sentToday: x.sentToday + (perSeatCount.get(x.id) ?? 0), lastSendAt: now }
              : x,
          ),
          candidates: prev.candidates.map((c) =>
            assignedIds.has(c.id) && stageRank(c.stage) < 1
              ? { ...c, stage: "Contacted", lastContactedAt: now }
              : c,
          ),
        };
        affected.forEach((cid) => {
          if (cid) next = recomputeMetrics(next, cid);
        });
        next = withActivity(
          next,
          makeActivity({
            type: "outreach",
            title: `Fleet allocated ${result.assignments.length} contacts`,
            notes: `Distributed across ${perSeatCount.size} agents · ${result.skipped.length} skipped (suppression/dupe) · ${result.deferred.length} deferred (capacity). Dry-run.`,
            outcome: "Approved / Dry-run scheduled",
            campaignId: opts?.campaignId ?? null,
            linkedEntityType: null,
            linkedEntityId: null,
          }),
          opts?.campaignId ?? null,
        );
        return next;
      });
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
        ? s.campaigns.filter((c) => c.id === opts.campaignId)
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
            title: `Fleet sourcing — ${added.length} candidates`,
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
          title: `Learning run — ${proposals.length} proposals`,
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
            title: `Skill learned — ${key}`,
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
      const policy = checkLinkedInPolicy(content);
      if (!policy.ok) {
        return { ok: false, error: policy.reason };
      }
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
              title: `API key saved — ${input.name}`,
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
    async (id: string) => {
      // D-6: only commit the local removal when the server delete succeeded.
      try {
        const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) return;
      } catch {
        return; // network error — abort, don't remove locally
      }
      commit((prev) => ({ ...prev, apiKeys: prev.apiKeys.filter((x) => x.id !== id) }));
    },
    [commit],
  );

  const setCurrentRole = useCallback(
    (role: Role) =>
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
      ),
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

  // "Ask Aria" — in demo, captures the instruction as a new guardrail rule and
  // acknowledges. (Live mode would route this through the model with an API key.)
  const askAria = useCallback(
    (instruction: string): { reply: string } => {
      const clean = instruction.trim();
      if (!clean) return { reply: "Tell me what to change and I'll add it as a guardrail." };
      addGuardrailRule(clean);
      return {
        reply: `Done — added that as an active guardrail: "${clean}". Every agent will follow it on the next run. You can edit or remove it below anytime.`,
      };
    },
    [addGuardrailRule],
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
            title: `LLM provider added — ${provider.label}`,
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
      const server: McpServerConfig = { ...m, id: genId("mcp"), status: "untested" };
      commit((s) =>
        withActivity(
          { ...s, settings: { ...s.settings, mcpServers: [...(s.settings.mcpServers ?? []), server] } },
          makeActivity({
            type: "system",
            title: `MCP server added — ${server.name}`,
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
    (id: string, patch: Partial<McpServerConfig>) =>
      commit((s) => ({
        ...s,
        settings: {
          ...s.settings,
          mcpServers: (s.settings.mcpServers ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
        },
      })),
    [commit],
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
          body: JSON.stringify({ url: server.url, apiKeyId: server.apiKeyId }),
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
            title: `Model added — ${model.label}`,
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
      const guardrails = [ariaPrompt, linkedInGuardrailPrompt()].filter(Boolean).join("\n\n");
      const effectivePersona = guardrails ? `${guardrails}\n\n${personaBase}` : personaBase;
      // Full prompt has persona as a prefix (persona in prompt, never in the system field per S-3).
      const fullPrompt = `${effectivePersona}\n\n${conversationPrompt}`;

      // F-7: resolve the configured model for the chat task.
      const chatModelId = seat?.modelId ?? s.settings.defaultModels?.chat;
      const chatModelName = chatModelId
        ? (s.settings.savedModels ?? []).find((m) => m.id === chatModelId)?.modelName
        : undefined;

      // 3b. Cloud + MCP tools: when a cloud Anthropic provider is configured for chat and
      // the workspace has enabled MCP servers, route through the server-side tool-calling
      // loop so the agent can actually use those tools. Non-streaming (the loop completes
      // server-side); falls through to the streaming Aria path / mock on any miss.
      const chatAiCfg = resolveAiProvider(s.settings, "chat", {
        providerId: seat?.providerId,
        modelId: seat?.modelId,
      });
      const enabledMcp = (s.settings.mcpServers ?? [])
        .filter((m) => m.enabled)
        .map((m) => ({ url: m.url, ...(m.apiKeyId ? { apiKeyId: m.apiKeyId } : {}) }));
      const webResearch = s.settings.webResearch !== false;
      if (chatAiCfg && (enabledMcp.length || webResearch)) {
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
            }),
          });
          const data = (await res.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
          if (data?.ok && data.text) {
            updateChatMessage(threadId, assistantId, { content: data.text, pending: false });
            return;
          }
        } catch {
          /* fall through to the streaming Aria path / mock */
        }
      }

      // 4. Live mode: try the Aria proxy with streaming.
      if (hermesAvailable(s.settings)) {
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
                    updateChatMessage(threadId, assistantId, { content: accumulated, pending: true });
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
        } catch (err) {
          chatAbortControllers.current.delete(threadId);
          // F-5: if aborted, mark the bubble cancelled and do NOT fall through to mock.
          if (err instanceof Error && err.name === "AbortError") {
            updateChatMessage(threadId, assistantId, { content: "(cancelled)", pending: false });
            return;
          }
          /* any other streaming failure — fall through to mock */
        }
      }

      // 5. Mock reply (demo mode or any live failure).
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
            title: `Memory stored — ${kind}`,
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
            title: `Schedule created — ${entry.name}`,
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
      generateOutreachFor,
      generateOutreachLive,
      updateOutreach,
      regenerateOutreach,
      approveOutreach,
      confirmManualSend,
      sendApprovedOutreach,
      rejectOutreach,
      classifyAndStoreReply,
      markReplyHandled,
      applyReplyAction,
      createBookingFor,
      updateBooking,
      generateReport,
      setSkillUpdateStatus,
      setCandidateStage,
      setCandidatePhone,
      suppressCandidate,
      markDoNotContact,
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
      addProvider,
      updateProvider,
      removeProvider,
      setDefaultProvider,
      addMcpServer,
      updateMcpServer,
      removeMcpServer,
      testMcpServer,
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
    }),
    [
      setActiveCampaign, createCampaignFromAnalysis, updateCampaign, regenerateQueries,
      sourceNextBatch, generateOutreachFor, generateOutreachLive, updateOutreach, regenerateOutreach,
      approveOutreach, confirmManualSend, sendApprovedOutreach, rejectOutreach, classifyAndStoreReply, markReplyHandled,
      applyReplyAction, createBookingFor, updateBooking, generateReport,
      setSkillUpdateStatus, setCandidateStage, setCandidatePhone, suppressCandidate, markDoNotContact,
      unsubscribeCandidate, anonymizeCandidate, exportCandidate, updateSettings,
      updateIntegration, toggleIntegrationMode, testIntegration,
      addSeat, deployAgents, updateSeat, setSeatStatus, connectSeatAccount, disconnectSeatAccount, toggleSeatLive,
      addSuppression, removeSuppression, allocateOutreach, runFleetSourcing,
      runLearning, acceptSkillLearning, updateSkillContent, recordPiiReveal,
      saveApiKey, testApiKey, removeApiKey, setCurrentRole,
      updateAriaPrompt, addGuardrailRule, toggleGuardrailRule, removeGuardrailRule, askAria,
      addProvider, updateProvider, removeProvider, setDefaultProvider,
      addMcpServer, updateMcpServer, removeMcpServer, testMcpServer,
      addModel, updateModel, removeModel, setModelDefaultForTask,
      toggleTool,
      assignAgentProvider, assignAgentModel, assignAgentTools,
      logActivity, resetDemo,
      createChatThread, deleteChatThread, appendChatMessage, updateChatMessage, sendChat, cancelChat,
      addMemory, updateMemory, removeMemory, togglePinMemory,
      addSchedule, updateSchedule, removeSchedule, toggleSchedule,
    ],
  );

  const value = useMemo<HermesContextValue>(
    () => ({ state, hydrated: state !== null, actions }),
    [state, actions],
  );

  return React.createElement(HermesContext.Provider, { value }, children);
}

/* ---- private helpers ----------------------------------------------------- */

function defaultSlot(): Date {
  const d = new Date(Date.now() + 2 * 86_400_000);
  d.setHours(14, 0, 0, 0);
  return d;
}

function getInterviewerByName(name?: string) {
  if (!name) return null;
  return (
    [
      { name: "Dana Whitfield", email: "dana.whitfield@hermes.example", role: "Engineering Manager" },
      { name: "Marcus Lindqvist", email: "marcus.lindqvist@hermes.example", role: "Staff Engineer" },
      { name: "Priya Nair", email: "priya.nair@hermes.example", role: "Director of Engineering" },
      { name: "Sofia Romano", email: "sofia.romano@hermes.example", role: "Principal Engineer" },
    ].find((i) => i.name === name) ?? null
  );
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

const EMPTY: HermesState = {
  version: STATE_VERSION,
  campaigns: [],
  candidates: [],
  outreach: [],
  replies: [],
  bookings: [],
  reports: [],
  integrations: [],
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
  skills: [],
  apiKeys: [],
  currentRole: "admin",
  chats: [],
  memory: [],
  schedules: [],
  activeCampaignId: null,
};

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

export function useDashboardKpis(): GlobalKpis {
  return globalKpis(useStateOrEmpty());
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
