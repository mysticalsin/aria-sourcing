import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { EmailConnection, Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { createGoogleCalendarEvent, createGraphCalendarEvent, type CalendarEventInput } from "@/lib/calendar";
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
 */
const CalendarEventSchema = z.object({
  seatId: z.string().uuid(),
  candidateName: z.string().min(1).max(160),
  candidateEmail: z.string().email().max(255).optional().or(z.literal("")),
  role: z.string().min(1).max(160),
  startTime: z.string().min(1).max(40),
  endTime: z.string().min(1).max(40),
  timezone: z.string().max(60).default("UTC"),
  interviewerEmail: z.string().email().max(255).optional().or(z.literal("")),
  agenda: z.array(z.string().max(200)).max(20).default([]),
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
  const { data: wid } = await supabase.rpc("current_workspace_id");
  const { data: conn } =
    (await svc
      ?.from("email_connections")
      .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
      .eq("seat_id", d.seatId)
      .single()) ?? { data: null };
  if (!conn || conn.workspace_id !== wid) {
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

  try {
    const outcome =
      seat.provider === "Gmail API"
        ? await createGoogleCalendarEvent(ev, connection)
        : await createGraphCalendarEvent(ev, connection);
    if (!outcome.ok) {
      // A skipped provider outcome is not proof that no event was created. The client
      // treats it as ambiguous and requires reconciliation before any local booking.
      return NextResponse.json({ status: "skipped", detail: outcome.detail });
    }
    // Persist a refreshed token if it changed. Fail closed: never write a refreshed
    // token in cleartext when production requires encryption at rest but no key is
    // configured — skip the persist (the event itself was already created above)
    // rather than silently degrade the stored credential to plaintext.
    if (
      svc &&
      (origAccessToken !== connection.accessToken || conn.expires_at !== connection.expiresAt) &&
      !encryptionRequiredButMissing()
    ) {
      await svc
        .from("email_connections")
        .update({
          access_token: encryptSecret(connection.accessToken),
          expires_at: connection.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
    }
    return NextResponse.json({ status: "created", link: outcome.link ?? null, eventId: outcome.eventId ?? null });
  } catch (err) {
    safeLog("calendar event error", { message: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ status: "error", detail: "Calendar event creation failed." }, { status: 500 });
  }
}
