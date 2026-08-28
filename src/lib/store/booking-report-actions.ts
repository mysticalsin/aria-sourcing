import {
  candidateConfirmationEmail,
  createBooking,
  generateWeeklyReport,
  interviewerPrepEmail,
} from "../mock-ai";
import { mantuFirstInterviewAgenda } from "../mantu-brand";
import { isTeamsMeetingJoinUrl } from "../calendar";
import { bookingCalendarSummary, bookingInterviewTitle } from "../booking-status";
import { withStage } from "../metrics";
import {
  applyLearning,
  getSkill,
  learnedParamsFor,
} from "../skills";
import { BOOKING_STATUSES } from "../types";
import type {
  Activity,
  Booking,
  Campaign,
  Candidate,
  HermesState,
  Interviewer,
  SkillUpdate,
} from "../types";
import { interviewerIsBusy, resolveBookingSlot } from "./booking-slot";
import type { BookingUpdate, HermesActions } from "./contracts";
import { appendWinRecord } from "./winlog-derive";

export type BookingReportActions = Pick<
  HermesActions,
  | "createBookingFor"
  | "updateBooking"
  | "generateReport"
  | "setSkillUpdateStatus"
>;

export type BookingReportActivityDraft = Omit<Activity, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface BookingReportActionDependencies {
  commit: (update: (state: HermesState) => HermesState) => boolean;
  currentState: () => HermesState | null;
  workspaceEffectAllowed: () => boolean;
  bookingMutationAllowed: () => boolean;
  learningMutationAllowed: () => boolean;
  workspaceFetch: typeof fetch;
  liveCalendarEnabled: boolean;
  makeActivity: (activity: BookingReportActivityDraft) => Activity;
  withActivity: (
    state: HermesState,
    activity: Activity,
    campaignId: string | null,
  ) => HermesState;
  recomputeMetrics: (state: HermesState, campaignId: string) => HermesState;
  emitBooking: (event: {
    kind: "book";
    candidateName: string;
    campaignId: string;
  }) => void;
  enqueueInterviewPrep?: (input: {
    bookingId: string;
    candidateId: string;
    campaignId: string;
    providerEventCreated: boolean;
  }) => Promise<{ queued: boolean }>;
}

function learningSummary(
  state: HermesState,
  update: SkillUpdate,
): {
  patch: ReturnType<typeof learnedParamsFor>;
  summary: string;
} {
  const patch = learnedParamsFor(update.skill, state);
  const summary =
    update.skill === "outreach_skill"
      ? `Adopt ${patch.preferredTone} as the default tone`
      : update.skill === "scoring_skill"
        ? "Re-weight scoring from observed conversions"
        : update.skill === "reply_classification_skill"
          ? `Tune qualified-interest floor to ${patch.qualifiedInterestFloor}`
          : "Refine sourcing query strategy";
  return { patch, summary };
}

function bookingPatch(value: BookingUpdate): BookingUpdate | null {
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "startTime" && key !== "endTime" && key !== "status")
  ) {
    return null;
  }

  const safe: BookingUpdate = {};
  if (Object.hasOwn(value, "status")) {
    if (!BOOKING_STATUSES.includes(value.status as Booking["status"])) return null;
    safe.status = value.status;
  }
  if (Object.hasOwn(value, "startTime")) {
    if (typeof value.startTime !== "string") return null;
    safe.startTime = value.startTime;
  }
  if (Object.hasOwn(value, "endTime")) {
    if (typeof value.endTime !== "string") return null;
    safe.endTime = value.endTime;
  }
  return safe;
}

function bookingStatusTransitionAllowed(
  from: Booking["status"],
  to: Booking["status"],
): boolean {
  if (from === "Proposed") return to === "Confirmed" || to === "Cancelled";
  if (from === "Confirmed") {
    return to === "Completed" || to === "Cancelled" || to === "No Show";
  }
  return false;
}

function candidateCannotBeBooked(state: HermesState, candidateId: string): string | null {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  const campaign = candidate && state.campaigns.find((item) => item.id === candidate.campaignId);
  if (!candidate || !campaign) return "Candidate or campaign not found.";
  const flags = candidate.complianceFlags;
  if (flags.doNotContact || flags.suppressed || flags.unsubscribed || flags.anonymized) {
    return "Candidate has opted out or is suppressed. Cannot book.";
  }
  const activeStatuses = new Set<Booking["status"]>(["Proposed", "Confirmed"]);
  if (
    (candidate.booking && activeStatuses.has(candidate.booking.status)) ||
    state.bookings.some(
      (booking) =>
        booking.candidateId === candidateId && activeStatuses.has(booking.status),
    )
  ) {
    return "Candidate already has an active booking.";
  }
  return null;
}

interface BookingCommandFingerprint {
  candidateId: string;
  campaignId: string;
  candidateName: string;
  candidateEmail: string;
  candidateTimezone: string;
  candidateStage: Candidate["stage"];
  campaignTitle: string;
  interviewerId: string | null;
  interviewerName: string;
  interviewerEmail: string;
  startTime: string;
  endTime: string;
}

function bookingCommandFingerprint(
  candidate: Candidate,
  campaign: Campaign,
  interviewer: Interviewer | null,
  booking: Booking,
): BookingCommandFingerprint {
  return {
    candidateId: candidate.id,
    campaignId: campaign.id,
    candidateName: candidate.name,
    candidateEmail: candidate.email,
    candidateTimezone: candidate.timezone,
    candidateStage: candidate.stage,
    campaignTitle: campaign.title,
    interviewerId: interviewer?.id ?? null,
    interviewerName: interviewer?.name ?? "",
    interviewerEmail: interviewer?.email ?? "",
    startTime: booking.startTime,
    endTime: booking.endTime,
  };
}

function bookingCommandInvalid(
  state: HermesState,
  fingerprint: BookingCommandFingerprint,
): string | null {
  const blocked = candidateCannotBeBooked(state, fingerprint.candidateId);
  if (blocked) return blocked;

  const candidate = state.candidates.find((item) => item.id === fingerprint.candidateId);
  const campaign = state.campaigns.find((item) => item.id === fingerprint.campaignId);
  if (
    !candidate ||
    !campaign ||
    candidate.campaignId !== fingerprint.campaignId ||
    candidate.name !== fingerprint.candidateName ||
    candidate.email !== fingerprint.candidateEmail ||
    candidate.timezone !== fingerprint.candidateTimezone ||
    candidate.stage !== fingerprint.candidateStage ||
    campaign.title !== fingerprint.campaignTitle
  ) {
    return "Candidate or campaign changed while the booking was being created.";
  }

  if (fingerprint.interviewerId) {
    const interviewer = state.interviewers.find(
      (item) => item.id === fingerprint.interviewerId,
    );
    if (
      !interviewer?.active ||
      interviewer.name !== fingerprint.interviewerName ||
      interviewer.email !== fingerprint.interviewerEmail
    ) {
      return "Selected interviewer changed or is no longer active.";
    }
    const start = new Date(fingerprint.startTime);
    const end = new Date(fingerprint.endTime);
    if (interviewerIsBusy(state.bookings, interviewer.email, start, end)) {
      return `${interviewer.name} is already booked at that time.`;
    }
  }

  return null;
}

export function createBookingReportActions({
  commit,
  currentState,
  workspaceEffectAllowed,
  bookingMutationAllowed,
  learningMutationAllowed,
  workspaceFetch,
  liveCalendarEnabled,
  makeActivity,
  withActivity,
  recomputeMetrics,
  emitBooking,
  enqueueInterviewPrep,
}: BookingReportActionDependencies): BookingReportActions {
  const createBookingFor: BookingReportActions["createBookingFor"] = async (
    candidateId,
    opts,
  ) => {
    if (!bookingMutationAllowed() || !workspaceEffectAllowed()) {
      return { ok: false, error: "Workspace unavailable. Retry before creating a booking." };
    }
    const state = currentState();
    if (!state) return { ok: false, error: "Workspace unavailable. Retry before creating a booking." };
    const blocked = candidateCannotBeBooked(state, candidateId);
    if (blocked) return { ok: false, error: blocked };
    const candidate = state.candidates.find((item) => item.id === candidateId);
    const campaign = candidate && state.campaigns.find((item) => item.id === candidate.campaignId);
    if (!candidate || !campaign) return { ok: false, error: "Candidate or campaign not found." };

    const activeInterviewers = state.interviewers.filter((item) => item.active);
    const slot = resolveBookingSlot(
      state.bookings,
      activeInterviewers,
      state.bookings.length,
      opts,
    );
    if ("error" in slot) return { ok: false, error: slot.error };
    const proposalAgenda = candidate.interviewProposal?.agenda?.filter(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
    const agenda =
      proposalAgenda && proposalAgenda.length > 0
        ? proposalAgenda
        : mantuFirstInterviewAgenda(campaign.title);
    const booking = createBooking(candidate, campaign, slot.interviewer, slot.start, {
      agenda,
    });
    const fingerprint = bookingCommandFingerprint(
      candidate,
      campaign,
      slot.interviewer,
      booking,
    );

    const seat = state.seats.find(
      (item) =>
        item.status === "active" &&
        item.mode === "live" &&
        (item.provider === "Gmail API" || item.provider === "Microsoft Graph"),
    );
    let providerEventCreated = false;
    if (liveCalendarEnabled) {
      if (!seat) {
        return {
          ok: false,
          error: "Connect a live Gmail or Microsoft Graph calendar seat before confirming a booking.",
        };
      }
      try {
        const response = await workspaceFetch("/api/calendar/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seatId: seat.id,
            // The booking's own id is a stable per-attempt identifier: it never
            // changes across a network-level retry of this exact fetch, so it
            // doubles as the server's calendar-booking idempotency key.
            requestId: booking.id,
            candidateId: candidate.id,
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
        const body = (await response.json().catch(() => null)) as
          | {
              status?: unknown;
              link?: unknown;
              eventId?: unknown;
              detail?: unknown;
            }
          | null;
        if (!response.ok) {
          return {
            ok: false,
            error:
              response.status >= 500
                ? "Calendar request outcome is unknown. Reconciliation is required; do not retry."
                : typeof body?.detail === "string"
                ? body.detail
                : `Calendar request failed (${response.status}).`,
          };
        }
        if (body?.status === "skipped") {
          return {
            ok: false,
            error:
              "Calendar request outcome is unknown. Reconciliation is required; do not retry.",
          };
        }
        if (body?.status === "dry-run") {
          return {
            ok: false,
            error:
              typeof body.detail === "string"
                ? body.detail
                : "Calendar event was not created.",
          };
        }
        if (body?.status !== "created") {
          return {
            ok: false,
            error:
              "Calendar service returned an invalid response. Reconciliation is required; do not retry.",
          };
        }
        providerEventCreated = true;
        const eventId =
          typeof body.eventId === "string" &&
          body.eventId.trim().length > 0 &&
          body.eventId.length <= 512
            ? body.eventId
            : null;
        if (!eventId) {
          return {
            ok: false,
            error:
              "Calendar event may exist, but no provider receipt was returned. Reconciliation is required; do not retry.",
          };
        }
        if (seat.provider === "Microsoft Graph") {
          if (typeof body.link !== "string" || !isTeamsMeetingJoinUrl(body.link)) {
            return {
              ok: false,
              error:
                "Teams join URL missing after Graph create. Reconciliation is required; do not retry.",
            };
          }
          booking.teamsLink = body.link;
        } else if (body.link != null) {
          if (typeof body.link !== "string") {
            return {
              ok: false,
              error:
                "Calendar event may exist, but its link was invalid. Reconciliation is required; do not retry.",
            };
          }
          try {
            const link = new URL(body.link);
            if (link.protocol !== "https:") throw new Error("Calendar links must use HTTPS.");
            booking.calLink = body.link;
          } catch {
            return {
              ok: false,
              error:
                "Calendar event may exist, but its link was invalid. Reconciliation is required; do not retry.",
            };
          }
        }
        booking.calendarSync = {
          status: "created",
          seatId: seat.id,
          provider: seat.provider === "Gmail API" ? "Gmail API" : "Microsoft Graph",
          eventId,
        };
      } catch {
        return {
          ok: false,
          error:
            "Calendar request outcome is unknown. Reconciliation is required; do not retry.",
        };
      }
    }

    const latest = currentState();
    const latestBlocked = latest
      ? bookingCommandInvalid(latest, fingerprint)
      : "Workspace unavailable.";
    if (!bookingMutationAllowed() || !workspaceEffectAllowed() || latestBlocked) {
      return {
        ok: false,
        error: providerEventCreated
          ? "Calendar event may exist, but booking authority changed. Reconciliation is required; do not retry."
          : latestBlocked ?? "Workspace unavailable. Retry before creating a booking.",
      };
    }

    let applied = false;
    const committed = commit((current) => {
      if (
        !bookingMutationAllowed() ||
        !workspaceEffectAllowed() ||
        bookingCommandInvalid(current, fingerprint)
      ) {
        return current;
      }
      const liveCandidate = current.candidates.find((item) => item.id === candidateId);
      const liveCampaign = liveCandidate && current.campaigns.find((item) => item.id === liveCandidate.campaignId);
      if (!liveCandidate || !liveCampaign) return current;
      applied = true;
      const candidates = current.candidates.map((item) =>
        item.id === candidateId
          ? { ...item, ...withStage(item, "Booked"), booking, interviewProposal: null }
          : item,
      );
      const bookedCandidate = candidates.find((item) => item.id === candidateId) ?? liveCandidate;
      let next: HermesState = {
        ...current,
        bookings: [booking, ...current.bookings],
        candidates,
      };
      next = appendWinRecord(next, bookedCandidate, liveCampaign, booking);
      next = recomputeMetrics(next, liveCampaign.id);
      return withActivity(
        next,
        makeActivity({
          type: "booking",
          title: bookingInterviewTitle(booking, liveCandidate.name),
          notes: `${booking.interviewer || "No interviewer assigned yet"}. ${bookingCalendarSummary(booking)} Stage → Booked.`,
          outcome: "Confirmed",
          campaignId: liveCampaign.id,
          linkedEntityType: "booking",
          linkedEntityId: booking.id,
        }),
        liveCampaign.id,
      );
    });

    if (!committed || !applied) {
      return {
        ok: false,
        error: providerEventCreated
          ? "Calendar event may exist, but the booking was not saved. Reconciliation is required; do not retry."
          : "Booking could not be saved. Refresh and retry.",
      };
    }
    const prepEmail = interviewerPrepEmail(booking, candidate);
    const confirmationEmail = candidateConfirmationEmail(booking);
    emitBooking({ kind: "book", candidateName: candidate.name, campaignId: campaign.id });
    let prepQueued = false;
    if (providerEventCreated && enqueueInterviewPrep) {
      try {
        const enq = await enqueueInterviewPrep({
          bookingId: booking.id,
          candidateId: candidate.id,
          campaignId: campaign.id,
          providerEventCreated: true,
        });
        prepQueued = enq.queued;
      } catch {
        prepQueued = false;
      }
    }
    return { ok: true, booking, prepEmail, confirmationEmail, prepQueued };
  };

  const updateBooking: BookingReportActions["updateBooking"] = (id, patch) => {
    if (!bookingMutationAllowed() || !workspaceEffectAllowed()) {
      return { ok: false, error: "You do not have permission to update bookings." };
    }
    const state = currentState();
    const booking = state?.bookings.find((item) => item.id === id);
    if (!state || !booking) return { ok: false, error: "Booking not found." };
    const safePatch = bookingPatch(patch);
    if (!safePatch) return { ok: false, error: "Booking update is invalid." };
    const providerLinked = Boolean(
      booking.calendarSync || booking.calLink || booking.teamsLink,
    );
    if (
      providerLinked &&
      (Object.hasOwn(safePatch, "startTime") ||
        Object.hasOwn(safePatch, "endTime") ||
        safePatch.status === "Cancelled")
    ) {
      return {
        ok: false,
        error: "Calendar provider synchronization is required before changing this invite.",
      };
    }
    if (
      safePatch.status &&
      !bookingStatusTransitionAllowed(booking.status, safePatch.status)
    ) {
      return { ok: false, error: "Booking status transition is invalid." };
    }

    if (Object.hasOwn(safePatch, "startTime") || Object.hasOwn(safePatch, "endTime")) {
      if (booking.status !== "Proposed" && booking.status !== "Confirmed") {
        return { ok: false, error: "Completed or cancelled bookings cannot be rescheduled." };
      }
      const start = new Date(safePatch.startTime ?? booking.startTime);
      const end = new Date(safePatch.endTime ?? booking.endTime);
      if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        start.getTime() <= Date.now() ||
        end.getTime() <= start.getTime()
      ) {
        return { ok: false, error: "Booking time range is invalid." };
      }
      if (
        booking.interviewerEmail &&
        interviewerIsBusy(state.bookings, booking.interviewerEmail, start, end, booking.id)
      ) {
        return { ok: false, error: `${booking.interviewer} is already booked at that time.` };
      }
    }

    let updated = false;
    const committed = commit((current) => {
      const liveBooking = current.bookings.find((item) => item.id === id);
      if (!liveBooking) return current;
      updated = true;
      let next: HermesState = {
        ...current,
        bookings: current.bookings.map((item) =>
          item.id === id ? { ...item, ...safePatch } : item,
        ),
        candidates: current.candidates.map((candidate) =>
          candidate.id === liveBooking.candidateId && candidate.booking?.id === id
            ? { ...candidate, booking: { ...candidate.booking, ...safePatch } }
            : candidate,
        ),
      };
      if (safePatch.status === "Completed") {
        const candidate = next.candidates.find((item) => item.id === liveBooking.candidateId);
        if (candidate?.stage === "Booked") {
          next = {
            ...next,
            candidates: next.candidates.map((item) =>
              item.id === liveBooking.candidateId
                ? { ...item, ...withStage(item, "Interviewed") }
                : item,
            ),
          };
          next = recomputeMetrics(next, liveBooking.campaignId);
        }
      }
      return withActivity(
        next,
        makeActivity({
          type: "booking",
          title: safePatch.status
            ? `Interview marked ${safePatch.status}`
            : "Interview rescheduled",
          notes: safePatch.status
            ? `${liveBooking.candidateName} interview status changed from ${liveBooking.status} to ${safePatch.status}.`
            : `${liveBooking.candidateName} interview moved to ${safePatch.startTime ?? liveBooking.startTime}.`,
          outcome: safePatch.status ?? "Rescheduled",
          campaignId: liveBooking.campaignId,
          linkedEntityType: "booking",
          linkedEntityId: liveBooking.id,
        }),
        liveBooking.campaignId,
      );
    });
    return committed && updated
      ? { ok: true }
      : { ok: false, error: "Booking could not be saved. Refresh and retry." };
  };

  const generateReport: BookingReportActions["generateReport"] = (campaignId) => {
    if (!learningMutationAllowed() || !workspaceEffectAllowed()) return null;
    const state = currentState();
    const campaign = state?.campaigns.find((item) => item.id === campaignId);
    if (!state || !campaign) return null;
    const generated = generateWeeklyReport(campaign, state.candidates, state.outreach);
    let persistedReport: typeof generated | null = null;
    let applied = false;
    const committed = commit((current) => {
      const liveCampaign = current.campaigns.find((item) => item.id === campaignId);
      if (!liveCampaign) return current;
      const existingByKey = new Map(
        liveCampaign.skillUpdates.map((item) => [`${item.skill}\u0000${item.title}`, item]),
      );
      let addedCount = 0;
      const canonicalUpdates = generated.skillUpdates.map((item) => {
        const existing = existingByKey.get(`${item.skill}\u0000${item.title}`);
        if (existing) return { ...item, id: existing.id, status: existing.status };
        addedCount += 1;
        return { ...item };
      });
      persistedReport = {
        ...generated,
        campaignTitle: liveCampaign.title,
        skillUpdates: canonicalUpdates,
      };
      applied = true;
      let next: HermesState = {
        ...current,
        reports: [
          persistedReport,
          ...current.reports.filter((item) => item.campaignId !== campaignId),
        ],
        campaigns: current.campaigns.map((item) =>
          item.id === campaignId
            ? {
                ...item,
                skillUpdates: [
                  ...item.skillUpdates,
                  ...canonicalUpdates.filter(
                    (candidate) =>
                      !item.skillUpdates.some((existing) => existing.id === candidate.id),
                  ),
                ],
              }
            : item,
        ),
      };
      next = withActivity(
        next,
        makeActivity({
          type: "learning",
          title: "Weekly report generated",
          notes: `${addedCount} skill updates proposed.`,
          outcome: "Report ready",
          campaignId,
          linkedEntityType: "report",
          linkedEntityId: generated.id,
        }),
        campaignId,
      );
      return next;
    });
    return committed && applied ? persistedReport : null;
  };

  const setSkillUpdateStatus: BookingReportActions["setSkillUpdateStatus"] = (
    campaignId,
    skillId,
    status,
  ) => {
    if (!learningMutationAllowed() || !workspaceEffectAllowed()) return false;
    const state = currentState();
    const campaign = state?.campaigns.find((item) => item.id === campaignId);
    const update = campaign?.skillUpdates.find((item) => item.id === skillId);
    if (!state || !campaign || !update || update.status !== "proposed") return false;
    if (status !== "accepted" && status !== "rejected") return false;

    let applied = false;
    const committed = commit((current) => {
      const liveCampaign = current.campaigns.find((item) => item.id === campaignId);
      const liveUpdate = liveCampaign?.skillUpdates.find((item) => item.id === skillId);
      if (!liveCampaign || !liveUpdate || liveUpdate.status !== "proposed") return current;
      const agentSkill = status === "accepted" ? getSkill(current.skills, liveUpdate.skill) : null;
      if (status === "accepted" && !agentSkill) return current;
      applied = true;
      let next: HermesState = {
        ...current,
        campaigns: current.campaigns.map((item) =>
          item.id === campaignId
            ? {
                ...item,
                skillUpdates: item.skillUpdates.map((skill) =>
                  skill.id === skillId ? { ...skill, status } : skill,
                ),
              }
            : item,
        ),
        reports: current.reports.map((item) =>
          item.campaignId === campaignId
            ? {
                ...item,
                skillUpdates: item.skillUpdates.map((skill) =>
                  skill.id === skillId ? { ...skill, status } : skill,
                ),
              }
            : item,
        ),
      };
      if (status === "accepted") {
        const { patch, summary } = learningSummary(current, liveUpdate);
        next = {
          ...next,
          skills: next.skills.map((item) =>
            item.key === liveUpdate.skill ? applyLearning(item, patch, summary) : item,
          ),
        };
      }
      return withActivity(
        next,
        makeActivity({
          type: "learning",
          title: `Skill update ${status}`,
          notes: `${liveUpdate.skill}: ${liveUpdate.title}`,
          outcome: status,
          campaignId,
          linkedEntityType: "skill",
          linkedEntityId: skillId,
        }),
        campaignId,
      );
    });
    return committed && applied;
  };

  return {
    createBookingFor,
    updateBooking,
    generateReport,
    setSkillUpdateStatus,
  };
}
