import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { publicOrigin } from "@/lib/public-origin";
import {
  LINKEDIN_OIDC_SCOPES,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_USERINFO_URL,
  displayNameFromLinkedInProfile,
  linkedInOAuthRedirectUri,
  type LinkedInUserInfo,
} from "@/lib/linkedin-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * LinkedIn OIDC callback — exchange code, fetch userinfo, encrypt tokens,
 * bind to seat, redirect to Settings → Integrations.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectError(req, "LinkedIn OAuth is not configured.");
  }

  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const stateParam = searchParams.get("state");

  if (oauthError) {
    return redirectError(req, `LinkedIn OAuth error: ${oauthError}`);
  }
  if (!code || !stateParam) {
    return redirectError(req, "Missing authorization code or state.");
  }

  let state: { seatId?: string; nonce?: string };
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
  if (!state.nonce || !cookieNonce || !timingSafeEqual(state.nonce, cookieNonce)) {
    return redirectError(req, "OAuth state mismatch.");
  }

  if (!supabaseEnabled) {
    return redirectError(req, "LinkedIn login requires Supabase (live mode).");
  }
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

  const redirectUri = linkedInOAuthRedirectUri();

  let tokenRes: Response;
  try {
    tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return redirectError(req, "LinkedIn token exchange timed out.");
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
    return redirectError(
      req,
      tokenJson.error_description ?? tokenJson.error ?? "LinkedIn token exchange failed.",
    );
  }

  let profileRes: Response;
  try {
    profileRes = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return redirectError(req, "Could not retrieve LinkedIn profile.");
  }

  const profile = (await profileRes.json().catch(() => ({}))) as LinkedInUserInfo;
  if (!profileRes.ok || !profile.sub) {
    return redirectError(req, "LinkedIn userinfo failed — ensure Sign In with LinkedIn (OIDC) is enabled on the app.");
  }

  const displayName = displayNameFromLinkedInProfile(profile);
  const { data: wid } = await supabase.rpc("current_workspace_id");
  const { data: seatRow } = await svc.from("agent_seats").select("workspace_id, provider").eq("id", seatId).single();
  if (!seatRow || seatRow.workspace_id !== wid) {
    return redirectError(req, "Seat is not in your workspace.");
  }
  if (
    seatRow.provider !== "LinkedIn Assisted Manual" &&
    seatRow.provider !== "LinkedIn Vendor API"
  ) {
    return redirectError(req, "Seat is not a LinkedIn messaging seat.");
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  const { error: upsertError } = await svc.from("linkedin_oauth_connections").upsert(
    {
      workspace_id: wid,
      seat_id: seatId,
      linkedin_sub: profile.sub,
      display_name: displayName,
      email: profile.email ?? null,
      picture_url: profile.picture ?? null,
      access_token: encryptSecret(tokenJson.access_token),
      refresh_token: tokenJson.refresh_token ? encryptSecret(tokenJson.refresh_token) : null,
      expires_at: expiresAt,
      scope: tokenJson.scope ?? LINKEDIN_OIDC_SCOPES,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,seat_id" },
  );
  if (upsertError) {
    console.error("[linkedin/callback] upsert failed:", upsertError.message, upsertError.code);
    return redirectError(req, "Failed to save LinkedIn connection.");
  }

  await svc
    .from("agent_seats")
    .update({
      connected_account: profile.email ? `${displayName} <${profile.email}>` : displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seatId)
    .eq("workspace_id", wid);

  const res = redirectSuccess(req, `LinkedIn connected as ${displayName}`);
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

function redirectError(req: NextRequest, message: string) {
  const origin = publicOrigin(req.headers);
  const url = new URL("/settings", origin);
  url.searchParams.set("tab", "integrations");
  url.searchParams.set("oauth", "error");
  url.searchParams.set("message", message.slice(0, 200));
  const res = NextResponse.redirect(url.toString());
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

function redirectSuccess(req: NextRequest, message: string) {
  const origin = publicOrigin(req.headers);
  const url = new URL("/settings", origin);
  url.searchParams.set("tab", "integrations");
  url.searchParams.set("oauth", "success");
  url.searchParams.set("message", message.slice(0, 200));
  return NextResponse.redirect(url.toString());
}
