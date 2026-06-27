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
  type ReplyClassification,
  type SourceResult,
} from "./mock-ai";
import { buildSeedState, STATE_VERSION } from "./seed";
import { computeCampaignMetrics, globalKpis, type GlobalKpis } from "./metrics";
import {
  checkOutreachApproval,
  type ApprovalResult,
} from "./rules";
import {
  testConnection,
  type ConnectionTestResult,
} from "./integrations";
import type {
  Activity,
  AgentSeat,
  AgentSkill,
  AllocationResult,
  Booking,
  Campaign,
  Candidate,
  CandidateStage,
  ClassifiedReply,
  HermesState,
  IntegrationStatus,
  JobAnalysis,
  OutreachChannel,
  OutreachLedgerEntry,
  OutreachMessage,
  OutreachTone,
  ReplyIntent,
  ScoringWeights,
  SkillKey,
  SkillUpdate,
  SourcePlatform,
  SuppressionEntry,
  SystemSettings,
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
  ) => SourceResult;

  // outreach
  generateOutreachFor: (
    candidateId: string,
    tone?: OutreachTone,
    channel?: OutreachChannel,
    seatId?: string,
  ) => OutreachMessage | null;
  updateOutreach: (messageId: string, patch: Partial<OutreachMessage>) => void;
  regenerateOutreach: (messageId: string, tone?: OutreachTone) => void;
  approveOutreach: (messageId: string) => ApprovalResult;
  rejectOutreach: (messageId: string) => void;

  // replies
  classifyAndStoreReply: (input: {
    text: string;
    candidateId?: string;
    campaignId?: string;
  }) => { reply: ClassifiedReply; classification: ReplyClassification };
  markReplyHandled: (replyId: string) => void;
  applyReplyAction: (replyId: string) => void;

  // bookings
  createBookingFor: (
    candidateId: string,
    opts?: { startTime?: string; interviewerName?: string },
  ) => { booking: Booking; prepEmail: string; confirmationEmail: string } | null;
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
  suppressCandidate: (id: string) => void;
  markDoNotContact: (id: string) => void;
  unsubscribeCandidate: (id: string) => void;
  anonymizeCandidate: (id: string) => void;
  exportCandidate: (id: string) => string;

  // settings + integrations
  updateSettings: (patch: Partial<SystemSettings>) => void;
  updateIntegration: (id: string, patch: Partial<IntegrationStatus>) => void;
  toggleIntegrationMode: (id: string) => void;
  testIntegration: (id: string) => ConnectionTestResult;

  // fleet — multi-seat coordination + anti-ban guardrails
  addSeat: (partial: Partial<AgentSeat> & { name: string; operatorEmail: string }) => AgentSeat;
  deployAgents: (
    n: number,
    opts?: { language?: string; namePrefix?: string },
  ) => { created: number; total: number; capped: boolean; max: number };
  updateSeat: (id: string, patch: Partial<AgentSeat>) => void;
  setSeatStatus: (id: string, status: AgentSeat["status"]) => void;
  connectSeatAccount: (id: string, account: string) => void;
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
  updateSkillContent: (key: SkillKey, content: string) => void;

  // confidentiality
  recordPiiReveal: (candidateId: string) => void;

  // misc
  logActivity: (a: Omit<Activity, "id" | "createdAt"> & { createdAt?: string }) => void;
  resetDemo: () => void;
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

function loadState(): HermesState {
  if (typeof window === "undefined") return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HermesState;
      if (parsed && parsed.version === STATE_VERSION) return parsed;
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(false);

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
          if (remote.state) {
            skipNextPersist.current = true; // don't re-save what we just loaded
            setState(remote.state);
          } else {
            const seeded = buildSeedState();
            setState(seeded);
            if (remote.workspaceId) void saveRemoteState(remote.workspaceId, seeded);
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
        if (wid) void saveRemoteState(wid, snapshot);
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
    (campaignId: string, opts?: { platform?: SourcePlatform; count?: number }) => {
      const s = current();
      const campaign = s.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { accepted: [], skipped: [] };
      const platform: SourcePlatform =
        opts?.platform ?? (campaign.jobAnalysis.department === "Design" ? "LinkedIn" : "GitHub");
      const count = opts?.count ?? 6;
      const weights = effectiveWeights(campaign.scoringWeights, s.skills); // learned scoring
      const result = sourceCandidates(campaign, platform, count, s.candidates, s.candidates.length, weights);

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
            notes: `${platform} batch. ${result.skipped.length} skipped by dedupe (${result.skipped
              .slice(0, 3)
              .map((x) => x.reason)
              .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
            outcome: `${result.accepted.length} accepted · ${result.skipped.length} skipped`,
            campaignId,
            linkedEntityType: "campaign",
            linkedEntityId: campaignId,
          }),
          campaignId,
        );
        return next;
      });
      return result;
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

      const now = new Date().toISOString();
      commit((prev) => {
        const outreach = prev.outreach.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: "Scheduled" as const,
                approvedBy: prev.settings.operatorName,
                scheduledFor: now,
                sentAt: now,
                dryRun: prev.settings.dryRunMode,
              }
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
        // Write the authoritative ledger record so the fleet de-dupe sees this
        // manual contact too (single source of truth → no double-contact).
        const ledgerEntry: OutreachLedgerEntry = {
          id: genId("led"),
          candidateId: candidate.id,
          candidateEmail: candidate.email,
          seatId: "",
          campaignId: campaign.id,
          channel: msg.channel,
          status: "sent",
          reason: null,
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
                    emailsSentToday: c.metrics.emailsSentToday + (msg.channel === "Email" ? 1 : 0),
                    linkedinSentToday: c.metrics.linkedinSentToday + (msg.channel === "LinkedIn" ? 1 : 0),
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
            notes: `${msg.channel} message approved. ${prev.settings.dryRunMode ? "Dry-run — nothing sent." : "Live send."}`,
            outcome: "Approved / Dry-run scheduled",
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
    (input: { text: string; candidateId?: string; campaignId?: string }) => {
      const s = current();
      const candidate = input.candidateId
        ? s.candidates.find((c) => c.id === input.candidateId)
        : undefined;
      const campaignId = input.campaignId ?? candidate?.campaignId ?? s.activeCampaignId ?? s.campaigns[0]?.id ?? "";
      const classification = classifyReply(input.text, candidate?.name);
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
            ? new Date(Date.now() + s.settings.slaMinutes * 60000).toISOString()
            : null,
        receivedAt: new Date().toISOString(),
      };
      commit((prev) => {
        let next: HermesState = { ...prev, replies: [reply, ...prev.replies] };
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
    (candidateId: string, opts?: { startTime?: string; interviewerName?: string }) => {
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
    (id: string) => {
      const s = current();
      const integ = s.integrations.find((i) => i.id === id);
      const result = integ
        ? testConnection(integ)
        : { ok: false, latencyMs: 0, message: "Integration not found." };
      if (integ && result.ok) {
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
        signature: partial.signature ?? "— Hermes (dry-run on behalf of the hiring team)",
        language: partial.language ?? current().settings.defaultLanguage,
        connectedAccount: "",
        createdAt: now,
      };
      commit((s) =>
        withActivity(
          { ...s, seats: [...s.seats, seat] },
          makeActivity({
            type: "system",
            title: `Hermes agent added — ${seat.name}`,
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
          name: `${opts?.namePrefix ?? "Hermes Agent"} ${String(idx + 1).padStart(3, "0")}`,
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
          signature: "— Hermes (dry-run on behalf of the hiring team)",
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
            title: `Deployed ${newSeats.length} Hermes agents`,
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
            notes: `${account} connected via official API (mock). Verify domain before live sends.`,
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

  /* ---- Fleet: parallel sourcing (multiple Hermes agents) --------------- */

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
            notes: `${activeSeats.length} Hermes agents sourced in parallel across ${affected.size} campaign(s). ${totalSkipped} deduped.`,
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
    (key: SkillKey, content: string) =>
      commit((s) => ({
        ...s,
        skills: s.skills.map((sk) => (sk.key === key ? { ...sk, content, updatedAt: new Date().toISOString() } : sk)),
      })),
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

  const resetDemo = useCallback(() => {
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
      generateOutreachFor,
      updateOutreach,
      regenerateOutreach,
      approveOutreach,
      rejectOutreach,
      classifyAndStoreReply,
      markReplyHandled,
      applyReplyAction,
      createBookingFor,
      updateBooking,
      generateReport,
      setSkillUpdateStatus,
      setCandidateStage,
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
      toggleSeatLive,
      addSuppression,
      removeSuppression,
      allocateOutreach,
      runFleetSourcing,
      runLearning,
      acceptSkillLearning,
      updateSkillContent,
      recordPiiReveal,
      logActivity,
      resetDemo,
    }),
    [
      setActiveCampaign, createCampaignFromAnalysis, updateCampaign, regenerateQueries,
      sourceNextBatch, generateOutreachFor, updateOutreach, regenerateOutreach,
      approveOutreach, rejectOutreach, classifyAndStoreReply, markReplyHandled,
      applyReplyAction, createBookingFor, updateBooking, generateReport,
      setSkillUpdateStatus, setCandidateStage, suppressCandidate, markDoNotContact,
      unsubscribeCandidate, anonymizeCandidate, exportCandidate, updateSettings,
      updateIntegration, toggleIntegrationMode, testIntegration,
      addSeat, deployAgents, updateSeat, setSeatStatus, connectSeatAccount, toggleSeatLive,
      addSuppression, removeSuppression, allocateOutreach, runFleetSourcing,
      runLearning, acceptSkillLearning, updateSkillContent, recordPiiReveal,
      logActivity, resetDemo,
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
    minScoreToContact: 70,
    slaMinutes: 15,
    operatorName: "Operator",
    systemIdentity: "Hermes Sourcing",
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
    notifications: { slack: true, telegram: false, email: true },
  },
  seats: [],
  suppression: [],
  ledger: [],
  skills: [],
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
