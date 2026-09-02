// Booking from the reply loop: claim the slot, create the real calendar event
// through calendar.ts, reconcile. Every dependency is injected so the route
// wires calendar-authority (server-only) while tests prove the fail-closed
// paths with fakes. A failed or unknown calendar outcome is never a booking.

import type { CalendarEventInput, CalendarEventOutcome } from "@/lib/calendar";
import type { CalendarBookingClaimResult, CalendarBookingReconcileResult } from "@/lib/calendar-authority";
import { meetingSlot } from "@/lib/linkedin-loop";

export interface LoopBookingDeps {
  claim(input: {
    workspaceId: string;
    candidateId: string;
    startTime: string;
    requestId: string;
    provider: "Gmail API" | "Microsoft Graph";
  }): Promise<CalendarBookingClaimResult>;
  reconcile(input: {
    workspaceId: string;
    id: string;
    status: "confirmed" | "failed";
    externalEventId?: string | null;
    detail?: string | null;
  }): Promise<CalendarBookingReconcileResult>;
  /** Resolve the calendar seat's live provider and connection. Null when the
   *  seat is not a live Gmail / Graph mailbox in this workspace. */
  resolveCalendar(workspaceId: string, seatId: string): Promise<{
    provider: "Gmail API" | "Microsoft Graph";
    createEvent: (ev: CalendarEventInput) => Promise<CalendarEventOutcome>;
    interviewerEmail: string;
  } | null>;
}

export interface LoopBookingInput {
  workspaceId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  role: string;
  start: Date;
  timezone: string;
  calendarSeatId: string | null;
  interviewerEmail: string;
  /** Idempotency key: the inbound message id. */
  requestId: string;
}

export type LoopBookingResult =
  | { booked: true; eventId: string | null; link: string | null }
  | { booked: false; reason: string };

export async function bookMeetingFromLoop(deps: LoopBookingDeps, input: LoopBookingInput): Promise<LoopBookingResult> {
  if (!input.calendarSeatId) return { booked: false, reason: "calendar-seat-not-configured" };
  const calendar = await deps.resolveCalendar(input.workspaceId, input.calendarSeatId);
  if (!calendar) return { booked: false, reason: "calendar-not-connected" };

  const slot = meetingSlot(input.start);
  const claim = await deps.claim({
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
    startTime: slot.startTime,
    requestId: input.requestId,
    provider: calendar.provider,
  });
  if (claim.status !== "claimed") return { booked: false, reason: `calendar-claim-${claim.status}` };
  if (claim.replay) {
    if (claim.bookingStatus === "confirmed") return { booked: true, eventId: claim.externalEventId, link: null };
    return { booked: false, reason: `calendar-replay-${claim.bookingStatus}` };
  }

  const ev: CalendarEventInput = {
    candidateName: input.candidateName || "Candidate",
    role: input.role || "Interview",
    startTime: slot.startTime,
    endTime: slot.endTime,
    timezone: input.timezone || "UTC",
    candidateEmail: input.candidateEmail,
    interviewerEmail: input.interviewerEmail || calendar.interviewerEmail,
    agenda: [],
  };
  let outcome: CalendarEventOutcome;
  try {
    outcome = await calendar.createEvent(ev);
  } catch {
    // The request may have reached the provider. The claim stays held for a
    // human to reconcile; nothing is booked from Aria's point of view.
    return { booked: false, reason: "calendar-outcome-unknown" };
  }
  if (outcome.ok) {
    await deps.reconcile({
      workspaceId: input.workspaceId,
      id: claim.id,
      status: "confirmed",
      externalEventId: outcome.eventId ?? null,
      detail: outcome.detail,
    });
    return { booked: true, eventId: outcome.eventId ?? null, link: outcome.link ?? null };
  }
  if (outcome.deliveryState === "not-sent") {
    await deps.reconcile({ workspaceId: input.workspaceId, id: claim.id, status: "failed", detail: outcome.detail });
    return { booked: false, reason: "calendar-rejected" };
  }
  return { booked: false, reason: "calendar-outcome-unknown" };
}
