import { recordVerifiedEvidence, type VerifiedEvidenceInput } from "@/lib/candidate-evidence";
import { withStage } from "@/lib/metrics";
import type { WorkspaceActions } from "@/lib/store/contracts";
import { makeActivity, recomputeMetrics, withActivity } from "@/lib/store/workspace-transitions";
import type {
  Candidate,
  CandidateNote,
  CandidateStage,
  ChatboxSubmission,
  ChatboxSubmissionStatus,
  InterviewKind,
  InterviewRecord,
  LeadSource,
  PrequalOutcome,
  PrequalRecord,
  StarRating,
  WorkspaceState,
} from "@/lib/types";
import { genId, isoDaysBefore } from "@/lib/utils";

export type PipelineActions = Pick<
  WorkspaceActions,
  | "setCandidateStage"
  | "setCandidatePhone"
  | "recordCandidateEvidence"
  | "addCandidateNote"
  | "setRejectionReason"
  | "setCandidateRating"
  | "setCandidateLeadSource"
  | "toggleVivier"
  | "savePrequal"
  | "setPrequalOutcome"
  | "addInterview"
  | "updateInterview"
  | "advanceChatboxSubmission"
  | "setChatboxSubmissionStatus"
  | "addChatboxSubmission"
>;

export interface PipelineActionDependencies {
  commit: (update: (state: WorkspaceState) => WorkspaceState) => boolean;
  commitPersisted: (update: (state: WorkspaceState) => WorkspaceState) => Promise<boolean>;
  workspaceEffectAllowed: () => boolean;
  sourcingMutationAllowed: () => boolean;
}

/** Candidate pipeline mutations. React-free; the workspace store supplies commit. */
export function createPipelineActions(deps: PipelineActionDependencies): PipelineActions {
  const commit = deps.commit;
  const commitPersisted = deps.commitPersisted;
  const workspaceEffectAllowed = deps.workspaceEffectAllowed;
  const sourcingMutationAllowed = deps.sourcingMutationAllowed;

  const setCandidateStage = (id: string, stage: CandidateStage) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        let next: WorkspaceState = {
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
      });

  const setCandidatePhone = (id: string, phone: string) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, phone: phone.trim() || undefined } : c)),
      }));

  const recordCandidateEvidence = async (id: string, input: VerifiedEvidenceInput) => {
    if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return { ok: false, error: "Contact editing requires sourcing permission." };
    let error: string | undefined;
    const saved = await commitPersisted((state) => {
      const result = recordVerifiedEvidence(state, id, input, new Date().toISOString(), genId("note"));
      if (!result.ok) { error = result.error; return state; }
      const candidate = state.candidates.find((c) => c.id === id)!;
      return withActivity(recomputeMetrics(result.state, candidate.campaignId), makeActivity({ type: "system", title: input.lawfulBasis ? "Candidate contact basis recorded" : "Candidate evidence recorded",
        notes: input.lawfulBasis ? `Operator selected ${input.lawfulBasis}; evidence is in the candidate notes. Message approval is still required.` : "Operator reviewed profile/contact facts. Contact permission and outreach approval are separate.",
        outcome: input.lawfulBasis ? "Explicit contact basis saved" : "Profile/contact facts saved",
        campaignId: candidate.campaignId, linkedEntityType: "candidate", linkedEntityId: id,
      }), candidate.campaignId);
    });
    return { ok: saved && !error, error: error ?? (!saved ? "Contact details were not saved. Reload the workspace and review." : undefined) };
  };

  const addCandidateNote = (candidateId: string, text: string) => {
      const clean = text.trim();
      if (!clean) return;
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        const note: CandidateNote = { id: genId("note"), text: clean, at: new Date().toISOString() };
        const next: WorkspaceState = {
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
    };

  const setRejectionReason = (candidateId: string, reason: string) => {
      const clean = reason.trim();
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === candidateId);
        if (!cand) return s;
        const next: WorkspaceState = {
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
    };

  /* ---- TAnIA actions (source, rating, #Vivier, prequal, interviews, chatbox) */

  const setCandidateRating = (id: string, rating: StarRating) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, starRating: rating } : c)),
      }));

  const setCandidateLeadSource = (id: string, leadSource: LeadSource) =>
      commit((s) => ({
        ...s,
        candidates: s.candidates.map((c) => (c.id === id ? { ...c, leadSource } : c)),
      }));

  const toggleVivier = (id: string) =>
      commit((s) => {
        const cand = s.candidates.find((c) => c.id === id);
        if (!cand) return s;
        const nowIn = !cand.vivier;
        const next: WorkspaceState = {
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
      });

  const savePrequal = (candidateId: string, patch: Partial<PrequalRecord>) =>
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
      }));

  const setPrequalOutcome = (candidateId: string, outcome: PrequalOutcome) =>
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
        let next: WorkspaceState = {
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
      });

  const addInterview = (candidateId: string, kind: InterviewKind, interviewer: string, scheduledFor: string | null) =>
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
        let next: WorkspaceState = {
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
      });

  const updateInterview = (candidateId: string, interviewId: string, patch: Partial<InterviewRecord>) =>
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
      }));

  const advanceChatboxSubmission = (id: string) =>
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
        let next: WorkspaceState = {
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
      });

  const setChatboxSubmissionStatus = (id: string, status: ChatboxSubmissionStatus) =>
      commit((s) => ({
        ...s,
        chatboxSubmissions: (s.chatboxSubmissions ?? []).map((x) =>
          x.id === id ? { ...x, status } : x,
        ),
      }));

  const addChatboxSubmission = (sub: ChatboxSubmission) =>
      commit((s) =>
        withActivity(
          { ...s, chatboxSubmissions: [sub, ...(s.chatboxSubmissions ?? [])] },
          makeActivity({
            type: "parse",
            title: `New application: ${sub.firstName} ${sub.lastName}`,
            notes: `Career-site chatbox (${sub.path === "A" ? "job application" : "open application"}) · score ${sub.score.total}/100.`,
            outcome: "Awaiting screener",
            campaignId: sub.campaignId,
            linkedEntityType: sub.campaignId ? "campaign" : null,
            linkedEntityId: sub.campaignId,
          }),
          sub.campaignId ?? null,
        ),
      );

  return {
    setCandidateStage,
    setCandidatePhone,
    recordCandidateEvidence,
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
  };
}
