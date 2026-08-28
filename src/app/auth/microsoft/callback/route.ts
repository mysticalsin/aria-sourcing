import { NextResponse, type NextRequest } from "next/server";
import { resolveMicrosoftOAuthAuthority, resolveMicrosoftRedirectUri } from "@/lib/email-connections";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { publicOrigin } from "@/lib/public-origin";

/**
 * Microsoft OAuth callback for Microsoft Graph seat connection.
 *
 * Exchanges the authorization code for tokens, stores them in
 * public.email_connections, updates the seat's connected_account, and redirects
 * back to Settings → Fleet with a toast.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectError(req, "Microsoft OAuth is not configured.");
  }

  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const stateParam = searchParams.get("state");

  if (error) {
    return redirectError(req, `Microsoft OAuth error: ${error}`);
  }
  if (!code || !stateParam) {
    return redirectError(req, "Missing authorization code or state.");
  }

  let state: { seatId?: string; provider?: string; nonce?: string };
  try {
    state = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf-8"));
  } catch {
    return redirectError(req, "Invalid OAuth state.");
  }
  const seatId = state.seatId;
  if (!seatId) {
    return redirectError(req, "Missing seat id in OAuth state.");
  }

  // CSRF: the state nonce must match the value bound to this browser at start.
  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!state.nonce || !cookieNonce || !safeEqual(state.nonce, cookieNonce)) {
    return redirectError(req, "OAuth state mismatch.");
  }
  // PKCE: the verifier proves this is the same browser that began the flow.
  const codeVerifier = req.cookies.get(VERIFIER_COOKIE)?.value;
  if (!codeVerifier) {
    return redirectError(req, "Missing PKCE verifier.");
  }

  if (!supabaseEnabled) {
    return redirectError(req, "Email connections require Supabase (live mode).");
  }

  // Fail closed: never persist a new OAuth mailbox token in cleartext when
  // production requires encryption at rest but DATA_ENCRYPTION_KEY isn't configured.
  if (encryptionRequiredButMissing()) {
    return redirectError(req, "Server encryption key is not configured.");
  }

  const supabase = await getServerSupabase();
  const svc = getServiceSupabase();
  if (!supabase || !svc) {
    return redirectError(req, "Supabase not configured.");
  }

  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;
  if (publicDemoSideEffectsDisabled()) {
    return redirectError(req, PUBLIC_DEMO_DRY_RUN_DETAIL);
  }

  const redirectUri = resolveMicrosoftRedirectUri();
  if (!redirectUri) {
    return redirectError(
      req,
      "MICROSOFT_REDIRECT_URI must be set to the public https callback (e.g. https://aria-mantu-app.fly.dev/auth/microsoft/callback).",
    );
  }

  const authority = resolveMicrosoftOAuthAuthority();
  if (!authority) {
    return redirectError(
      req,
      "MICROSOFT_TENANT_ID (or GOTRUE_EXTERNAL_AZURE_URL with tenant GUID) is required for Graph token exchange.",
    );
  }

  // Exchange code for tokens (PKCE verifier proves possession; 10s timeout).
  let tokenRes: Response;
  try {
    tokenRes = await fetchWithTimeout(`${authority}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
  } catch {
    return redirectError(req, "Microsoft token exchange timed out.");
  }
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    return redirectError(req, tokenJson.error_description ?? tokenJson.error ?? "Microsoft token exchange failed.");
  }

  // Fetch account email from Microsoft Graph.
  let profileRes: Response;
  try {
    profileRes = await fetchWithTimeout("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
  } catch {
    return redirectError(req, "Could not retrieve Microsoft account email.");
  }
  const profile = (await profileRes.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  const accountEmail = profile.mail ?? profile.userPrincipalName ?? "";
  if (!accountEmail) {
    return redirectError(req, "Could not retrieve Microsoft account email.");
  }

  const { data: wid } = await supabase.rpc("current_workspace_id");
  // Cross-tenant guard: the seat must belong to the caller's workspace before any
  // service-role write (the service-role client bypasses RLS).
  const { data: seatRow } = await svc.from("agent_seats").select("workspace_id").eq("id", seatId).single();
  if (!seatRow || seatRow.workspace_id !== wid) {
    return redirectError(req, "Seat is not in your workspace.");
  }
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  // Upsert connection.
  const { data: upserted, error: upsertError } = await svc
    .from("email_connections")
    .upsert(
      {
        workspace_id: wid,
        seat_id: seatId,
        provider: "Microsoft Graph",
        account_email: accountEmail,
        access_token: encryptSecret(tokenJson.access_token),
        refresh_token: tokenJson.refresh_token ? encryptSecret(tokenJson.refresh_token) : null,
        expires_at: expiresAt,
        scope: tokenJson.scope ?? "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/OnlineMeetings.ReadWrite https://graph.microsoft.com/User.Read offline_access",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id, seat_id" },
    )
    .select("id")
    .single();
  if (upsertError || !upserted?.id) {
    console.error("[microsoft/callback] email_connections upsert failed:", upsertError?.message, upsertError?.code);
    return redirectError(req, "Failed to save email connection.");
  }

  // Mirror connected account on the seat first, but keep mode non-live until
  // inbound route + Graph webhook subscription succeed (avoids Connected/live lie).
  {
    const { error: accountErr } = await svc
      .from("agent_seats")
      .update({ connected_account: accountEmail, status: "active" })
      .eq("id", seatId);
    if (accountErr) {
      console.error("[microsoft/callback] agent_seats account update failed:", accountErr.message, accountErr.code);
      return redirectError(req, "Failed to update seat connection.");
    }
  }

  // Register inbound webhook routing so Graph/HMAC ingest can resolve this mailbox.
  // Fail closed: a connected token without a durable route yields 404 "No route for mailbox"
  // on every notification — never claim webhook-ready without the route.
  const { data: routeResult, error: routeErr } = await svc.rpc("upsert_inbound_mailbox_route", {
    p_mailbox: accountEmail.toLowerCase(),
    p_connection_id: upserted.id,
    p_purpose: "reply",
    p_workspace_id: wid,
  });
  if (routeErr || !(routeResult as { ok?: boolean } | null)?.ok) {
    const reason =
      routeErr?.message ?? (routeResult as { reason?: string } | null)?.reason ?? "unknown";
    console.error("[microsoft/callback] inbound route upsert failed:", reason);
    return redirectError(
      req,
      `Connected ${accountEmail} but inbound mailbox route failed (${reason}). Reconnect or use Enable webhook / register_inbound in Settings.`,
    );
  }

  // Ensure Graph change-notification subscription (webhook push, no inbox polling).
  // Use ensure (not create-only): reconnect when Graph already has an Inbox sub must
  // not fail closed before mode=live promote — same path as Settings → Enable webhook.
  try {
    const { ensureGraphMailSubscription } = await import("@/lib/email-graph-subscriptions");
    const sub = await ensureGraphMailSubscription({ workspaceId: wid, connectionId: upserted.id });
    if (!sub.ok) {
      console.error("[microsoft/callback] graph subscription:", sub.reason);
      return redirectError(
        req,
        `Connected ${accountEmail} but Graph webhook failed (${sub.reason}). Reconnect Outlook or use Enable webhook in Settings.`,
      );
    }
  } catch (err) {
    console.error(
      "[microsoft/callback] graph subscription error:",
      err instanceof Error ? err.message : "unknown",
    );
    return redirectError(
      req,
      `Connected ${accountEmail} but Graph webhook setup failed. Reconnect Outlook or use Enable webhook in Settings.`,
    );
  }

  // Promote seat to live only after inbound route + Graph webhook are durable —
  // confirmLive Teams books require mode=live and operators must not see Connected without webhook.
  {
    const { error: liveErr } = await svc
      .from("agent_seats")
      .update({ mode: "live", status: "active", connected_account: accountEmail })
      .eq("id", seatId);
    if (liveErr) {
      console.error("[microsoft/callback] agent_seats live promote failed:", liveErr.message, liveErr.code);
      return redirectError(req, "Graph webhook ready but failed to promote seat to live. Reconnect Outlook.");
    }
  }

  return redirectSuccess(req, `Connected ${accountEmail}`);
}

/** Cookie names binding the OAuth `state` nonce and PKCE verifier to this browser. */
const STATE_COOKIE = "ms_oauth_state";
const VERIFIER_COOKIE = "ms_oauth_verifier";

/** `fetch` with a hard abort deadline so a hung provider cannot stall the route. */
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Constant-time string compare to avoid leaking the nonce via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Expire the single-use state/verifier cookies on every callback exit. */
function clearOAuthCookies(res: NextResponse): void {
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
}

function redirectError(req: NextRequest, message: string) {
  const encoded = encodeURIComponent(message);
  const origin = publicOrigin(req.headers);
  const res = NextResponse.redirect(new URL(`/settings?tab=integrations&oauth=error&message=${encoded}`, origin));
  clearOAuthCookies(res);
  return res;
}

function redirectSuccess(req: NextRequest, message: string) {
  const encoded = encodeURIComponent(message);
  const origin = publicOrigin(req.headers);
  const res = NextResponse.redirect(new URL(`/settings?tab=integrations&oauth=success&message=${encoded}`, origin));
  clearOAuthCookies(res);
  return res;
}
