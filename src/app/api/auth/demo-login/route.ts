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
 * One-click demo login for the `admin` showcase shortcut.
 *
 *  - Password is DEMO_ADMIN_PASSWORD from env (local default "admin" when unset).
 *  - LIVE mode (Supabase): signs in SERVER-SIDE so the real password never
 *    reaches the client bundle as a hard-coded constant.
 *  - OPEN demo (no Supabase, NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true): mints a
 *    short-lived HMAC-signed httpOnly cookie.
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
  // Password comes from DEMO_ADMIN_PASSWORD (never hard-code in source).
  // Local/dev falls back to "admin" only when the env var is unset.
  const demoPassword =
    process.env.DEMO_ADMIN_PASSWORD ?? (isProduction ? null : "admin");
  if (!demoPassword) {
    return NextResponse.json({ ok: false, error: "Demo login is not configured." }, { status: 500 });
  }
  if (body.username !== "admin" || body.password !== demoPassword) {
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
    email: "admin@hermes.local",
    password: demoPassword,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Demo login failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
