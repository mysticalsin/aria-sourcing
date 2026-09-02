import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { LINKEDIN_VENDOR_PROVIDER } from "@/lib/linkedin-channel";

export const dynamic = "force-dynamic";

/**
 * Start official LinkedIn OAuth (OpenID) for the LinkedIn sending seat.
 * Fail-closed without LINKEDIN_CLIENT_ID. Official authorization endpoint only.
 *
 * Query params:
 *   seat_id  — the agent_seat.id to connect
 *
 * Required env:
 *   LINKEDIN_CLIENT_ID
 *   LINKEDIN_REDIRECT_URI (defaults to http://localhost:3000/auth/linkedin/callback)
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(await getServerSupabase());
  if (!admin.ok) return admin.response;

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "LinkedIn OAuth is not configured." }, { status: 500 });
  }

  const searchParams = new URL(req.url).searchParams;
  const seatId = searchParams.get("seat_id");
  if (!seatId) {
    return NextResponse.json({ ok: false, error: "Missing seat_id." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: false, status: "dry-run", error: PUBLIC_DEMO_DRY_RUN_DETAIL }, { status: 403 });
  }

  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3000/auth/linkedin/callback";
  const nonce = randomToken(16);
  const codeVerifier = randomToken(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = Buffer.from(JSON.stringify({ seatId, provider: LINKEDIN_VENDOR_PROVIDER, nonce })).toString("base64url");

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());
  const isHttps = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const isLocalhost = req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1";
  const secureCookie = isHttps || !isLocalhost;
  const cookieOpts = {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(STATE_COOKIE, nonce, cookieOpts);
  res.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOpts);
  return res;
}

const STATE_COOKIE = "li_oauth_state";
const VERIFIER_COOKIE = "li_oauth_verifier";

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}
