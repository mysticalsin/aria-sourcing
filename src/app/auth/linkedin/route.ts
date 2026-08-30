import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import {
  LINKEDIN_AUTHORIZE_URL,
  LINKEDIN_OIDC_SCOPES,
  linkedInOAuthConfigured,
  linkedInOAuthRedirectUri,
} from "@/lib/linkedin-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

/**
 * Start LinkedIn OpenID Connect (Sign In with LinkedIn).
 * Query: seat_id — agent_seats.id to bind the connection to.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(await getServerSupabase());
  if (!admin.ok) return admin.response;

  if (!linkedInOAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (LinkedIn Developer Portal → Sign In with LinkedIn using OpenID Connect).",
      },
      { status: 503 },
    );
  }

  const seatId = new URL(req.url).searchParams.get("seat_id");
  if (!seatId) {
    return NextResponse.json({ ok: false, error: "Missing seat_id." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: false, status: "dry-run", error: PUBLIC_DEMO_DRY_RUN_DETAIL }, { status: 403 });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const redirectUri = linkedInOAuthRedirectUri();
  const nonce = randomToken(16);
  const state = Buffer.from(JSON.stringify({ seatId, nonce, provider: "LinkedIn OIDC" })).toString(
    "base64url",
  );

  const authUrl = new URL(LINKEDIN_AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", LINKEDIN_OIDC_SCOPES);

  const res = NextResponse.redirect(authUrl.toString());
  const isHttps = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const isLocalhost = req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1";
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: isHttps || !isLocalhost,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}
