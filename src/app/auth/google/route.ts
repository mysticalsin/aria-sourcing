import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

// Auth-gated, never cacheable — and without this, Next tries to prerender the
// route at build time (calling requireAdmin() before it touches any request
// API Next would otherwise auto-detect as dynamic), which throws the
// production fail-closed guard as a build error when Supabase isn't configured.
export const dynamic = "force-dynamic";

/**
 * Start Google OAuth for a Gmail API seat.
 *
 * Query params:
 *   seat_id  — the agent_seat.id to connect
 *
 * Required env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_REDIRECT_URI (defaults to http://localhost:3000/auth/google/callback)
 */
export async function GET(req: NextRequest) {
  // Only an authenticated admin may initiate an OAuth seat connection.
  const admin = await requireAdmin(await getServerSupabase());
  if (!admin.ok) return admin.response;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Google OAuth is not configured." }, { status: 500 });
  }

  const searchParams = new URL(req.url).searchParams;
  const seatId = searchParams.get("seat_id");
  if (!seatId) {
    return NextResponse.json({ ok: false, error: "Missing seat_id." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: false, status: "dry-run", error: PUBLIC_DEMO_DRY_RUN_DETAIL }, { status: 403 });
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/auth/google/callback";

  // CSRF: random nonce echoed in `state` and bound to an HttpOnly cookie, verified
  // in the callback. PKCE (S256): a high-entropy verifier kept server-side (cookie)
  // with only its SHA-256 challenge sent to Google, so a stolen code is useless.
  const nonce = randomToken(16);
  const codeVerifier = randomToken(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = Buffer.from(JSON.stringify({ seatId, provider: "Gmail API", nonce })).toString("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
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

/** Cookie names binding the OAuth `state` nonce and PKCE verifier to this browser. */
const STATE_COOKIE = "g_oauth_state";
const VERIFIER_COOKIE = "g_oauth_verifier";

/** URL-safe random token from `bytes` of CSPRNG entropy (Web Crypto). */
function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

/** PKCE S256 challenge: base64url( SHA-256( verifier ) ). */
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}
