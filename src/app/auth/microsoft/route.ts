import { NextResponse, type NextRequest } from "next/server";
import { resolveMicrosoftRedirectUri } from "@/lib/email-connections";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

// Auth-gated, never cacheable — and without this, Next tries to prerender the
// route at build time (calling requireAdmin() before it touches any request
// API Next would otherwise auto-detect as dynamic), which throws the
// production fail-closed guard as a build error when Supabase isn't configured.
export const dynamic = "force-dynamic";

/**
 * Start Microsoft OAuth for a Microsoft Graph seat.
 *
 * Query params:
 *   seat_id  — the agent_seat.id to connect
 *
 * Required env:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_REDIRECT_URI (required in production; localhost default only for local NODE_ENV≠production)
 */
export async function GET(req: NextRequest) {
  // Only an authenticated admin may initiate an OAuth seat connection.
  const admin = await requireAdmin(await getServerSupabase());
  if (!admin.ok) return admin.response;

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Microsoft OAuth is not configured." }, { status: 500 });
  }

  const searchParams = new URL(req.url).searchParams;
  const seatId = searchParams.get("seat_id");
  if (!seatId) {
    return NextResponse.json({ ok: false, error: "Missing seat_id." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: false, status: "dry-run", error: PUBLIC_DEMO_DRY_RUN_DETAIL }, { status: 403 });
  }

  const redirectUri = resolveMicrosoftRedirectUri();
  if (!redirectUri) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "MICROSOFT_REDIRECT_URI must be set to the public https callback (e.g. https://aria-mantu-app.fly.dev/auth/microsoft/callback).",
      },
      { status: 500 },
    );
  }

  // CSRF: random nonce echoed in `state` and bound to an HttpOnly cookie, verified
  // in the callback. PKCE (S256): a high-entropy verifier kept server-side (cookie)
  // with only its SHA-256 challenge sent to Microsoft, so a stolen code is useless.
  const nonce = randomToken(16);
  const codeVerifier = randomToken(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = Buffer.from(JSON.stringify({ seatId, provider: "Microsoft Graph", nonce })).toString("base64url");

  const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access",
  );
  authUrl.searchParams.set("response_mode", "query");
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
const STATE_COOKIE = "ms_oauth_state";
const VERIFIER_COOKIE = "ms_oauth_verifier";

/** URL-safe random token from `bytes` of CSPRNG entropy (Web Crypto). */
function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

/** PKCE S256 challenge: base64url( SHA-256( verifier ) ). */
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}
