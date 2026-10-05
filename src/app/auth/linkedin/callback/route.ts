import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

export const dynamic = "force-dynamic";

/**
 * Official LinkedIn OAuth callback. Binds the member identity to the seat.
 * Does not persist tokens for search — live people still come from Apify /
 * Tavily / GitHub.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectError(req, "LinkedIn OAuth is not configured.");
  }

  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const stateParam = searchParams.get("state");

  if (error) {
    return redirectError(req, `LinkedIn OAuth error: ${error}`);
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

  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!state.nonce || !cookieNonce || !safeEqual(state.nonce, cookieNonce)) {
    return redirectError(req, "OAuth state mismatch.");
  }
  const codeVerifier = req.cookies.get(VERIFIER_COOKIE)?.value;
  if (!codeVerifier) {
    return redirectError(req, "Missing PKCE verifier.");
  }

  if (!supabaseEnabled) {
    return redirectError(req, "LinkedIn connections require Supabase (live mode).");
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

  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3000/auth/linkedin/callback";

  let tokenRes: Response;
  try {
    tokenRes = await fetchWithTimeout("https://www.linkedin.com/oauth/v2/accessToken", {
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
    return redirectError(req, "LinkedIn token exchange timed out.");
  }
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    return redirectError(req, tokenJson.error_description ?? tokenJson.error ?? "LinkedIn token exchange failed.");
  }

  let profileRes: Response;
  try {
    profileRes = await fetchWithTimeout("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
  } catch {
    return redirectError(req, "Could not retrieve LinkedIn member profile.");
  }
  const profile = (await profileRes.json().catch(() => ({}))) as {
    sub?: string;
    name?: string;
    email?: string;
  };
  const account = profile.email?.trim() || profile.name?.trim() || profile.sub?.trim() || "";
  if (!account) {
    return redirectError(req, "Could not retrieve LinkedIn member profile.");
  }

  const { data: wid } = await supabase.rpc("current_workspace_id");
  const { data: seatRow } = await svc.from("agent_seats").select("workspace_id").eq("id", seatId).single();
  if (!seatRow || seatRow.workspace_id !== wid) {
    return redirectError(req, "Seat is not in your workspace.");
  }

  const { error: updateError } = await svc.from("agent_seats").update({ connected_account: account }).eq("id", seatId);
  if (updateError) {
    return redirectError(req, "Failed to update seat connection.");
  }

  return redirectSuccess(req, `Connected ${account}`);
}

const STATE_COOKIE = "li_oauth_state";
const VERIFIER_COOKIE = "li_oauth_verifier";

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
