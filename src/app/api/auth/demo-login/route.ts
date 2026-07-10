import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_AUTH_COOKIE_NAME,
  supabaseEnabled,
  demoLoginEnabled,
  isProduction,
  DEMO_COOKIE_NAME,
} from "@/lib/supabase/config";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { demoAuthConfigured, mintDemoToken } from "@/lib/demo-auth";

/**
 * One-click demo login for the `admin` / `admin` showcase shortcut.
 *
 *  - LIVE mode (Supabase): resolves admin/admin to the seeded account and signs in
 *    SERVER-SIDE, so the real account password never reaches the client bundle.
 *  - OPEN demo (no Supabase, NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true): mints a short-lived,
 *    HMAC-signed httpOnly cookie so the chat route can gate the env-resident LLM key
 *    behind this login instead of serving it to anonymous callers.
 *
 * Hard-disabled in production unless this is a deliberately public demo instance.
 */
export async function POST(req: Request) {
  if (isProduction && !demoLoginEnabled) {
    return NextResponse.json({ ok: false, error: "Disabled in production." }, { status: 404 });
  }

  // Throttle credential attempts per client IP (5/min) before any password check.
  const limit = checkRateLimit(rateLimitKey(req, "demo-login"), { windowMs: 60_000, max: 5 });
  if (!limit.ok) {
    return tooManyRequests(limit.retryAfterSec);
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (body.username !== "admin" || body.password !== "admin") {
    return NextResponse.json({ ok: false, error: "Invalid demo credentials." }, { status: 401 });
  }

  // OPEN demo (no Supabase): mint a signed httpOnly session cookie. The chat route
  // verifies it before spending the env-resident LLM key. Fail closed if unconfigured.
  if (!supabaseEnabled) {
    if (!demoLoginEnabled) {
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

  // LIVE mode (Supabase): the seeded account's real password MUST be set explicitly in
  // a public production demo — never fall back to the well-known local default (it would
  // let anyone sign in to the seeded account directly). Local/dev keeps the convenience default.
  const demoPassword =
    process.env.DEMO_ADMIN_PASSWORD ?? (isProduction ? null : "admindemo123");
  if (!demoPassword) {
    return NextResponse.json({ ok: false, error: "Demo login is not configured." }, { status: 500 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE_NAME },
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
    email: "admin@hermes.local",
    password: demoPassword,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Demo login failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
