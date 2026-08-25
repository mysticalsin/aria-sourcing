// Tokens are NEVER logged, returned, or forwarded outside this file.
// The refresh_token is only read to issue a revocation request; it is
// never included in any log call, error message, or HTTP response.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { decryptSecret } from "@/lib/crypto-secrets";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

const DisconnectSchema = z.object({
  seatId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  // ── 1. Fail closed in production ──────────────────────────────────────────
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // ── 2. Rate limit (blunt abuse before any work) ───────────────────────────
  // 20 disconnects/min per IP. Pre-auth, so userId is not yet known.
  const rl = checkRateLimit(rateLimitKey(req, "email-disconnect"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // ── 3. Parse + validate body ───────────────────────────────────────────────
  const validated = await validateBody(req, DisconnectSchema, { maxBytes: 4_096 });
  if (!validated.ok) return validated.response;
  const { seatId } = validated.data;

  // ── 4. Supabase guard (503 in demo mode) ──────────────────────────────────
  if (!supabaseEnabled) {
    return NextResponse.json(
      { ok: false, error: "Authentication backend not configured." },
      { status: 503 },
    );
  }

  // ── 5. Auth ────────────────────────────────────────────────────────────────
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  // ── 6. Role check — only fleet managers may disconnect mailboxes ───────────
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "manage_fleet")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  // ── 7. Resolve the caller's workspace ─────────────────────────────────────
  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  // Preserve ownership semantics before the public-demo exit without reading
  // any mailbox credential. RLS makes a foreign seat indistinguishable from an
  // absent one, matching the normal idempotent disconnect response.
  const { data: ownedSeat, error: ownedSeatErr } = await supabase
    .from("agent_seats")
    .select("id")
    .eq("id", seatId)
    .maybeSingle();
  if (ownedSeatErr) {
    return NextResponse.json({ ok: false, error: "Failed to verify mailbox ownership." }, { status: 500 });
  }
  if (!ownedSeat) {
    return NextResponse.json({ ok: true, revoked: false });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", revoked: false, changed: false, detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  // ── 8. Load the email connection (service-role bypasses RLS for secrets) ──
  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 500 });
  }

  const { data: conn, error: connErr } = await svc
    .from("email_connections")
    .select("id, refresh_token, provider, workspace_id")
    .eq("seat_id", seatId)
    .maybeSingle();

  if (connErr) {
    console.error("[email-disconnect] email_connections query error", { code: connErr.code });
    return NextResponse.json({ ok: false, error: "Failed to look up email connection." }, { status: 500 });
  }

  // ── 9. Cross-tenant guard — nothing to revoke if conn absent or mismatched ─
  // Defence-in-depth: the service-role client bypasses RLS, so we explicitly
  // verify the connection belongs to the caller's workspace before acting on it.
  if (!conn || conn.workspace_id !== wid) {
    // Treat as a no-op: idempotent, leaks no information.
    return NextResponse.json({ ok: true, revoked: false });
  }

  // ── 10. Best-effort token revocation with the provider ───────────────────
  // We wrap in try/catch so a provider error (timeout, 5xx) never prevents the
  // row from being deleted. The token is consumed here only — never logged.
  let revoked = false;

  // Deactivate inbound routes before deleting the connection row.
  const { error: routeDeactErr } = await svc.rpc("deactivate_inbound_mailbox_route_for_connection", {
    p_connection_id: conn.id,
    p_workspace_id: wid,
  });
  if (routeDeactErr) {
    console.warn("[email-disconnect] inbound route deactivate failed", {
      connectionId: conn.id,
      code: routeDeactErr.code,
    });
  }

  if (conn.provider === "Gmail API" && conn.refresh_token) {
    try {
      const body = new URLSearchParams({ token: decryptSecret(conn.refresh_token) });
      const res = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      // Google returns 200 on success; any 2xx is considered a revocation.
      revoked = res.ok;
      if (!res.ok) {
        // Log the status only — never the token or its value.
        console.warn("[email-disconnect] Google revoke returned non-2xx", {
          connectionId: conn.id,
          status: res.status,
        });
      }
    } catch {
      // Timeout, network error, or AbortError — best-effort, so we continue.
      console.warn("[email-disconnect] Google revoke request failed (timeout/network)", {
        connectionId: conn.id,
      });
    }
  } else if (conn.provider === "Microsoft Graph") {
    // Microsoft Graph has no unauthenticated single-token revoke endpoint.
    // Revoking a Graph refresh_token requires a call to
    //   POST /v1.0/users/{id}/revokeSignInSessions
    // which demands a valid app bearer token and elevated permissions not
    // available in the OAuth flow here. We skip the network call and rely
    // on deleting the row to prevent the app from issuing further outreach
    // using this token. Admins can force-revoke from Azure Portal if needed.
    revoked = false;
  }
  // Unknown providers: revoked stays false; the row is still deleted below.

  // ── 11. Delete the email_connections row ──────────────────────────────────
  const { error: deleteErr } = await svc.from("email_connections").delete().eq("id", conn.id);
  if (deleteErr) {
    console.error("[email-disconnect] email_connections delete error", { code: deleteErr.code });
    return NextResponse.json({ ok: false, error: "Failed to remove email connection." }, { status: 500 });
  }

  // ── 12. Clear the seat's connected_account mirror ─────────────────────────
  // Service-role write — mirrors the exact inverse of what the OAuth callback
  // does when it sets connected_account = accountEmail.
  const { error: seatErr } = await svc
    .from("agent_seats")
    .update({ connected_account: null })
    .eq("id", seatId);
  if (seatErr) {
    // Non-fatal: the email_connections row is already gone; log and continue.
    console.error("[email-disconnect] agent_seats clear failed", { code: seatErr.code, seatId });
  }

  console.log("[email-disconnect] disconnected", {
    connectionId: conn.id,
    provider: conn.provider,
    seatId,
    revoked,
  });

  // ── 13. Response — token is NEVER returned ────────────────────────────────
  return NextResponse.json({ ok: true, revoked });
}
