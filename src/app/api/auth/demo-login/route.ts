import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_COOKIE_OPTIONS,
  supabaseEnabled,
  demoLoginEnabled,
  isProduction,
  DEMO_COOKIE_NAME,
} from "@/lib/supabase/config";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { demoAuthConfigured, mintDemoToken } from "@/lib/demo-auth";

/**
 * One-click demo login for the configured showcase account.
 *
 *  - Identity: DEMO_ADMIN_USERNAME (or DEMO_ADMIN_EMAIL); local default "admin".
 *  - Password: DEMO_ADMIN_PASSWORD; local default "admin" when unset.
 *  - LIVE mode (Supabase): signs in SERVER-SIDE as DEMO_ADMIN_EMAIL
 *    (falls back to the username when it already looks like an email).
 *  - OPEN demo (no Supabase): mints a short-lived HMAC-signed httpOnly cookie.
 *
 * Hard-disabled in production unless this is a deliberately public demo instance.
 */
function configuredDemoUsername(): string | null {
  const fromEnv =
    process.env.DEMO_ADMIN_USERNAME?.trim() ||
    process.env.DEMO_ADMIN_EMAIL?.trim() ||
    process.env["NEXT_PUBLIC_DEMO_ADMIN_USERNAME"]?.trim() ||
    null;
  if (fromEnv) return fromEnv;
  return isProduction ? null : "admin";
}

function configuredDemoEmail(username: string): string {
  const explicit = process.env.DEMO_ADMIN_EMAIL?.trim();
  if (explicit) return explicit.toLowerCase();
  if (username.includes("@")) return username.toLowerCase();
  return `${username.toLowerCase()}@hermes.local`;
}

function usernamesMatch(provided: string, expected: string): boolean {
  return provided.trim().toLowerCase() === expected.trim().toLowerCase();
}

export async function POST(req: Request) {
  // Prefer static demoLoginEnabled (build-time NEXT_PUBLIC_*) but also honor a
  // runtime Fly secret: ENABLE_DEMO_LOGIN or dynamically-read NEXT_PUBLIC_* so
  // operators can open the showcase without a full image rebuild. Bracket
  // access avoids Next.js inlining of NEXT_PUBLIC_* at build time.
  const runtimeDemoLogin =
    process.env.ENABLE_DEMO_LOGIN === "true" ||
    process.env["NEXT_PUBLIC_ENABLE_DEMO_LOGIN"] === "true";
  if (isProduction && !demoLoginEnabled && !runtimeDemoLogin) {
    return NextResponse.json({ ok: false, error: "Disabled in production." }, { status: 404 });
  }

  // Throttle credential attempts per client IP (5/min) before any password check.
  const limit = checkRateLimit(rateLimitKey(req, "demo-login"), { windowMs: 60_000, max: 5 });
  if (!limit.ok) {
    return tooManyRequests(limit.retryAfterSec);
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const demoUsername = configuredDemoUsername();
  const demoPassword =
    process.env.DEMO_ADMIN_PASSWORD ?? (isProduction ? null : "admin");
  if (!demoUsername || !demoPassword) {
    return NextResponse.json({ ok: false, error: "Demo login is not configured." }, { status: 500 });
  }
  if (!usernamesMatch(String(body.username || ""), demoUsername) || body.password !== demoPassword) {
    return NextResponse.json({ ok: false, error: "Invalid demo credentials." }, { status: 401 });
  }

  // OPEN demo (no Supabase): mint a signed httpOnly session cookie. The chat route
  // verifies it before spending the env-resident LLM key. Fail closed if unconfigured.
  if (!supabaseEnabled) {
    if (!demoLoginEnabled && !runtimeDemoLogin) {
      return NextResponse.json({ ok: false, error: "No backend configured." }, { status: 400 });
    }
    if (!demoAuthConfigured()) {
      return NextResponse.json({ ok: false, error: "Demo login is not configured." }, { status: 500 });
    }
    const cookieStore = await cookies();
    cookieStore.set(DEMO_COOKIE_NAME, mintDemoToken(), {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return NextResponse.json({ ok: true });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: { name: string; value: string; options?: CookieOptions }[]) {
        list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: configuredDemoEmail(demoUsername),
    password: demoPassword,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Demo login failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
