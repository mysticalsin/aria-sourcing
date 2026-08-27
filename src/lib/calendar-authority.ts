import "server-only";

// Durable claim-before-effect / reconcile-after-effect authority for live
// calendar bookings (closes the NO-GO finding on /api/calendar/event). Mirrors
// the shape of src/lib/sourcing/source-authority.ts: every export takes the
// already-resolved service-role client, calls exactly one SECURITY DEFINER
// RPC (0034_calendar_booking_authority.sql), and never throws on transport —
// a network failure or a malformed RPC result fails closed as
// "dependency_unavailable", which the caller must treat the same as a
// definite block (never call the calendar provider).

export type CalendarBookingProvider = "Gmail API" | "Microsoft Graph";
export type CalendarBookingStatus = "claimed" | "confirmed" | "failed" | "released";

/** Minimal shape callers need: a service-role Supabase client's `.rpc`. A real
 *  SupabaseClient's rpc() returns a thenable PostgrestFilterBuilder rather
 *  than a literal Promise, so this is declared as PromiseLike (awaitable),
 *  not Promise — matching the actual client's structural type. */
export interface CalendarAuthorityServiceClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

type ClaimInput = {
  workspaceId: string;
  candidateId: string;
  startTime: string;
  requestId: string;
  provider: CalendarBookingProvider;
};

export type CalendarBookingClaimResult =
  | {
      status: "claimed";
      id: string;
      bookingStatus: CalendarBookingStatus;
      externalEventId: string | null;
      /** Teams/Outlook join URL when previously reconciled (replay path). */
      meetingUrl: string | null;
      /** True when this call returned a PRE-EXISTING row for this exact
       *  request_id (a retry) rather than creating a new one. */
      replay: boolean;
    }
  | { status: "double_booked" | "idempotency_conflict" | "invalid_request" | "dependency_unavailable" };

type ReconcileInput = {
  workspaceId: string;
  id: string;
  status: Extract<CalendarBookingStatus, "confirmed" | "failed" | "released">;
  externalEventId?: string | null;
  detail?: string | null;
  meetingUrl?: string | null;
};

export type CalendarBookingReconcileResult =
  | { status: "reconciled"; id: string; bookingStatus: CalendarBookingStatus }
  | { status: "not_found" | "invalid_request" | "dependency_unavailable" };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : "";
}

function nullableString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function isBookingStatus(value: unknown): value is CalendarBookingStatus {
  return value === "claimed" || value === "confirmed" || value === "failed" || value === "released";
}

/**
 * Claim the (workspace, candidate, start_time) booking slot BEFORE any
 * provider call. A retry with the same requestId returns the existing claim
 * (`replay: true`) instead of creating a second row — the caller must never
 * call the provider again for a replayed claim that is already 'confirmed'.
 * Fail closed (never call the provider) for `double_booked` (the slot is
 * already actively held by a different attempt), `idempotency_conflict`
 * (this requestId was already used for a different candidate/start_time —
 * not a valid replay), `invalid_request`, or `dependency_unavailable`.
 */
export async function claimCalendarBooking(
  service: CalendarAuthorityServiceClient,
  input: ClaimInput,
): Promise<CalendarBookingClaimResult> {
  const { data, error } = await service.rpc("claim_calendar_booking", {
    p_workspace_id: input.workspaceId,
    p_candidate_id: input.candidateId,
    p_start_time: input.startTime,
    p_request_id: input.requestId,
    p_provider: input.provider,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "claimed") {
    const id = boundedString(result.id, 100);
    const bookingStatus = result.booking_status;
    if (!id || !isBookingStatus(bookingStatus)) return { status: "dependency_unavailable" };
    return {
      status: "claimed",
      id,
      bookingStatus,
      externalEventId: nullableString(result.external_event_id, 512),
      meetingUrl: nullableString(result.meeting_url, 2000),
      replay: result.replay === true,
    };
  }
  if (
    result?.status === "double_booked" ||
    result?.status === "idempotency_conflict" ||
    result?.status === "invalid_request"
  ) {
    return { status: result.status };
  }
  return { status: "dependency_unavailable" };
}

/**
 * Reconcile a claimed booking to its terminal outcome AFTER the provider call
 * returns. Never call this for an unknown/ambiguous outcome (a transport
 * throw, or a delivery state that isn't provably pre-transport) — leaving the
 * row 'claimed' is the fail-closed behavior: it keeps holding the double-book
 * and retry-idempotency slot until a human reconciles it, mirroring the
 * outreach route's 'ambiguous' handling.
 */
export async function reconcileCalendarBooking(
  service: CalendarAuthorityServiceClient,
  input: ReconcileInput,
): Promise<CalendarBookingReconcileResult> {
  const { data, error } = await service.rpc("reconcile_calendar_booking", {
    p_workspace_id: input.workspaceId,
    p_id: input.id,
    p_status: input.status,
    p_external_event_id: input.externalEventId ?? null,
    p_detail: input.detail ?? null,
    p_meeting_url: input.meetingUrl ?? null,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "reconciled") {
    const id = boundedString(result.id, 100);
    const bookingStatus = result.booking_status;
    if (!id || !isBookingStatus(bookingStatus)) return { status: "dependency_unavailable" };
    return { status: "reconciled", id, bookingStatus };
  }
  if (result?.status === "not_found" || result?.status === "invalid_request") {
    return { status: result.status };
  }
  return { status: "dependency_unavailable" };
}
