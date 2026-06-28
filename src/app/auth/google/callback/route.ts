import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";

/**
 * Google OAuth callback for Gmail API seat connection.
 *
 * Exchanges the authorization code for tokens, stores them in
 * public.email_connections, updates the seat's connected_account, and redirects
 * back to Settings → Fleet with a toast.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectError(req, "Google OAuth is not configured.");
  }

  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const stateParam = searchParams.get("state");

  if (error) {
    return redirectError(req, `Google OAuth error: ${error}`);
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

  const supabase = getServerSupabase();
  const svc = getServiceSupabase();
  if (!supabase || !svc) {
    return redirectError(req, "Supabase not configured.");
  }

  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/auth/google/callback";

  // Exchange code for tokens (PKCE verifier proves possession; 10s timeout).
  let tokenRes: Response;
  try {
    tokenRes = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
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
    return redirectError(req, "Google token exchange timed out.");
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
    return redirectError(req, tokenJson.error_description ?? tokenJson.error ?? "Google token exchange failed.");
  }

  // Fetch account email from Gmail profile (or use tokeninfo as fallback).
  let profileRes: Response;
  try {
    profileRes = await fetchWithTimeout("https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
  } catch {
    return redirectError(req, "Could not retrieve Gmail account email.");
  }
  const profile = (await profileRes.json().catch(() => ({}))) as { emailAddress?: string };
  const accountEmail = profile.emailAddress ?? "";
  if (!accountEmail) {
    return redirectError(req, "Could not retrieve Gmail account email.");
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
  await svc.from("email_connections").upsert(
    {
      workspace_id: wid,
      seat_id: seatId,
      provider: "Gmail API",
      account_email: accountEmail,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token ?? null,
      expires_at: expiresAt,
      scope: tokenJson.scope ?? "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id, seat_id" },
  );

  // Mirror connected account on the seat.
  await svc.from("agent_seats").update({ connected_account: accountEmail }).eq("id", seatId);

  return redirectSuccess(req, `Connected ${accountEmail}`);
}

/** Cookie names binding the OAuth `state` nonce and PKCE verifier to this browser. */
const STATE_COOKIE = "g_oauth_state";
const VERIFIER_COOKIE = "g_oauth_verifier";

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
  const res = NextResponse.redirect(new URL(`/settings?tab=fleet&oauth=error&message=${encoded}`, req.url));
  clearOAuthCookies(res);
  return res;
}

function redirectSuccess(req: NextRequest, message: string) {
  const encoded = encodeURIComponent(message);
  const res = NextResponse.redirect(new URL(`/settings?tab=fleet&oauth=success&message=${encoded}`, req.url));
  clearOAuthCookies(res);
  return res;
}
