import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { EmailConnection, Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { createGoogleCalendarEvent, createGraphCalendarEvent, type CalendarEventInput } from "@/lib/calendar";
import { claimCalendarBooking, reconcileCalendarBooking } from "@/lib/calendar-authority";
import { safeLog } from "@/lib/log-redact";
import { decryptSecret, encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

/**
 * Create a REAL interview calendar event on the seat's connected mailbox calendar.
 * Safe by construction (same shape as the send route): a real event is created ONLY
 * when Supabase is configured, the caller is authenticated with the `book`
 * permission, the seat is live with a connected Gmail/Graph mailbox in the caller's
 * workspace, and `confirmLive` is true. Anything else degrades to dry-run. A mail-only
 * connection (no calendar scope) returns `skipped`; the client surfaces that outcome
 * as reconciliation-required and does not commit a local booking.
 *
 * Durable authority (closes a NO-GO finding): the exact same
 * claim-before-effect / reconcile-after-effect discipline as outreach send
 * (claim_and_record, 0021) now guards this route too, via
 * calendar_booking_ledger (0034). The candidate + start_time slot is claimed
 * BEFORE the provider is ever called; a double-book or an unrecordable claim
 * fails closed and never reaches the provider. A `requestId` supplied by the
 * client makes a retry idempotent — the same requestId always resolves to the
 * same ledger row instead of a second provider call.
 */
const CalendarEventSchema = z.object({
  seatId: z.string().uuid(),
  candidateId: z.string().min(1).max(200),
  candidateName: z.string().min(1).max(160),
  candidateEmail: z.string().email().max(255).optional().or(z.literal("")),
  role: z.string().min(1).max(160),
  startTime: z.string().min(1).max(40),
  endTime: z.string().min(1).max(40),
  timezone: z.string().max(60).default("UTC"),
  interviewerEmail: z.string().email().max(255).optional().or(z.literal("")),
  agenda: z.array(z.string().max(200)).max(20).default([]),
  // Client-supplied idempotency key for safe retries. The server generates a
  // fallback when absent (that request simply forfeits cross-retry
  // idempotency; the double-book guard on candidate + start_time still applies).
  requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  confirmLive: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "calendar-event"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, CalendarEventSchema, { maxBytes: 20_000 });
  if (!validated.ok) return validated.response;
  const d = validated.data;

  // DEMO / not confirmed: never touch a real calendar.
  if (!supabaseEnabled || !d.confirmLive) {
    return NextResponse.json({ status: "dry-run", detail: "Demo / dry-run: no calendar event created." });
  }

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ status: "dry-run", detail: "No Supabase client." });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ status: "error", detail: "Not authenticated." }, { status: 401 });
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "book")) {
    return NextResponse.json({ status: "error", detail: "Insufficient permissions." }, { status: 403 });
  }

  // Seat must belong to the caller's workspace (RLS), be live, and use an OAuth provider.
  const { data: seat } = await supabase
    .from("agent_seats")
    .select("id, provider, status, mode")
    .eq("id", d.seatId)
    .maybeSingle();
  if (!seat) return NextResponse.json({ status: "error", detail: "Seat not found in your workspace." }, { status: 403 });
  if (seat.mode !== "live") return NextResponse.json({ status: "dry-run", detail: "Seat not live: no event created." });
  if (seat.provider !== "Gmail API" && seat.provider !== "Microsoft Graph") {
    return NextResponse.json({ status: "skipped", detail: "Seat provider has no calendar integration." });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  // Resolve the email_connection (service-role) + verify workspace (defense-in-depth).
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ status: "dry-run", detail: "No service credential, dry-run." });
  const { data: wid } = await supabase.rpc("current_workspace_id");
  const { data: conn } =
    (await svc
      .from("email_connections")
      .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
      .eq("seat_id", d.seatId)
      .single()) ?? { data: null };
  if (!conn || !wid || conn.workspace_id !== wid) {
    return NextResponse.json({ status: "dry-run", detail: `${seat.provider} mailbox not connected: no event created.` });
  }
  // Tokens are stored encrypted at rest; decrypt for use. Keep the decrypted
  // original to detect a refresh below.
  const origAccessToken = decryptSecret(conn.access_token);
  const connection: EmailConnection = {
    id: conn.id,
    seatId: d.seatId,
    provider: seat.provider,
    accountEmail: conn.account_email,
    accessToken: origAccessToken,
    refreshToken: conn.refresh_token ? decryptSecret(conn.refresh_token) : conn.refresh_token,
    expiresAt: conn.expires_at,
    scope: conn.scope,
    connectedAt: "",
    updatedAt: "",
  };

  const ev: CalendarEventInput = {
    candidateName: d.candidateName,
    role: d.role,
    startTime: d.startTime,
    endTime: d.endTime,
    timezone: d.timezone ?? "UTC",
    candidateEmail: d.candidateEmail ?? "",
    interviewerEmail: d.interviewerEmail ?? "",
    agenda: d.agenda ?? [],
  };
  const provider: "Gmail API" | "Microsoft Graph" = seat.provider === "Gmail API" ? "Gmail API" : "Microsoft Graph";
  const requestId = d.requestId ?? randomUUID();

  // Claim BEFORE any provider call. This is the durable authority record the
  // finding required: a double-book on the same candidate + start_time, or a
  // claim that cannot be recorded at all, fails closed here and the provider
  // is never invoked.
  const claim = await claimCalendarBooking(svc, {
    workspaceId: wid,
    candidateId: d.candidateId,
    startTime: d.startTime,
    requestId,
    provider,
  });
  if (claim.status !== "claimed") {
    // TS narrows on the single-literal "claimed" tag above, not on the
    // multi-literal tag below, so branch on it here rather than in two
    // separate early-return guards.
    if (claim.status === "double_booked") {
      return NextResponse.json(
        { status: "error", detail: "This candidate already has an active booking at that time." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { status: "error", detail: "Booking authority could not be recorded." },
      { status: 409 },
    );
  }
  if (claim.replay) {
    // A retry with the same requestId. Never call the provider again — return
    // the previously recorded outcome instead.
    if (claim.bookingStatus === "confirmed") {
      return NextResponse.json({
        status: "created",
        link: claim.meetingUrl,
        eventId: claim.externalEventId,
      });
    }
    if (claim.bookingStatus === "claimed") {
      // The prior attempt under this exact requestId is still unreconciled
      // (in flight, or its outcome was unknown). Never retry the provider
      // call on an ambiguous outcome.
      return NextResponse.json(
        {
          status: "reconciliation-required",
          delivery: "calendar-reconciliation-required",
          bookingId: claim.id,
          detail: "This booking request is already being processed or its outcome is unknown. Do not retry.",
        },
        { status: 502 },
      );
    }
    // 'failed' or 'released': this exact requestId already resolved
    // negatively. Retry with a NEW requestId to attempt again.
    return NextResponse.json(
      { status: "error", detail: "This booking request already failed. Retry with a new request." },
      { status: 409 },
    );
  }

  try {
    const outcome =
      provider === "Gmail API"
        ? await createGoogleCalendarEvent(ev, connection)
        : await createGraphCalendarEvent(ev, connection);

    if (outcome.ok) {
      const reconciled = await reconcileCalendarBooking(svc, {
        workspaceId: wid,
        id: claim.id,
        status: "confirmed",
        externalEventId: outcome.eventId ?? null,
        meetingUrl: outcome.link ?? null,
        detail: outcome.detail,
      });
      if (reconciled.status !== "reconciled" || reconciled.bookingStatus !== "confirmed") {
        return NextResponse.json(
          {
            status: "reconciliation-required",
            delivery: "calendar-reconciliation-required",
            bookingId: claim.id,
            detail: "Calendar event may exist, but durable booking reconciliation failed. Do not retry.",
          },
          { status: 502 },
        );
      }
      // Persist a refreshed token if it changed. Fail closed: never write a refreshed
      // token in cleartext when production requires encryption at rest but no key is
      // configured — skip the persist (the event itself was already created and
      // reconciled above) rather than silently degrade the stored credential.
      if (
        (origAccessToken !== connection.accessToken || conn.expires_at !== connection.expiresAt) &&
        !encryptionRequiredButMissing()
      ) {
        try {
          await svc
            .from("email_connections")
            .update({
              access_token: encryptSecret(connection.accessToken),
              expires_at: connection.expiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connection.id);
        } catch (persistErr) {
          // Storage-only failure after the outcome is known and reconciled:
          // log and move on. The next sync simply refreshes the token again.
          safeLog("calendar token persist error", { message: persistErr instanceof Error ? persistErr.message : "unknown" });
        }
      }
      return NextResponse.json({ status: "created", link: outcome.link ?? null, eventId: outcome.eventId ?? null });
    }

    if (outcome.deliveryState === "not-sent") {
      // Proven pre-transport failure: the provider definitively never
      // accepted this request, so the slot is safe to free for a retry
      // (with a new requestId).
      await reconcileCalendarBooking(svc, { workspaceId: wid, id: claim.id, status: "failed", detail: outcome.detail });
      return NextResponse.json({ status: "skipped", detail: outcome.detail });
    }
    // deliveryState "unknown" (or absent, which fails closed the same way):
    // never reconcile. The claim stays 'claimed' — this ledger's status enum
    // has no separate ambiguous state because 'claimed' already IS the
    // active, retry-blocking state — and keeps holding the slot until a human
    // resolves it against the provider's calendar.
    return NextResponse.json(
      {
        status: "reconciliation-required",
        delivery: "calendar-reconciliation-required",
        bookingId: claim.id,
        detail: "Calendar provider acceptance is not yet reconciled. Do not retry this request.",
      },
      { status: 502 },
    );
  } catch (err) {
    safeLog("calendar event error", { message: err instanceof Error ? err.message : "unknown" });
    // An unexpected throw after the provider call began may follow
    // acceptance. Never reconcile here — the claim stays 'claimed' and keeps
    // blocking a retry until a human resolves it.
    return NextResponse.json(
      {
        status: "reconciliation-required",
        delivery: "calendar-reconciliation-required",
        bookingId: claim.id,
        detail: "Calendar event creation outcome could not be confirmed. Do not retry this request.",
      },
      { status: 502 },
    );
  }
}
