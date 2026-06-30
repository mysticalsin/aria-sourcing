import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseEnabled, demoLoginEnabled } from "@/lib/supabase/config";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

/**
 * DEV-ONLY one-click demo login.
 *
 * Maps the showcase shortcut `admin` / `admin` to the real local account, signing
 * in SERVER-SIDE so the actual account password never reaches the client bundle.
 * Hard-disabled in production. The real password is read from DEMO_ADMIN_PASSWORD
 * (falls back to the local default for the bundled local stack only).
 */
export async function POST(req: Request) {
  // Hard-disabled in production UNLESS this is a deliberately public demo instance
  // (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true). Default prod stays fail-closed (404).
  if (process.env.NODE_ENV === "production" && !demoLoginEnabled) {
    return NextResponse.json({ ok: false, error: "Disabled in production." }, { status: 404 });
  }
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "No backend configured." }, { status: 400 });
  }

  // Throttle credential attempts per client IP to blunt brute-force guessing
  // before any password check runs (5 attempts / minute).
  const limit = checkRateLimit(rateLimitKey(req, "demo-login"), { windowMs: 60_000, max: 5 });
  if (!limit.ok) {
    return tooManyRequests(limit.retryAfterSec);
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (body.username !== "admin" || body.password !== "admin") {
    return NextResponse.json({ ok: false, error: "Invalid demo credentials." }, { status: 401 });
  }

  // In a public production demo the seeded account's real password MUST be set
  // explicitly — never fall back to the well-known local default (it would let
  // anyone sign in to the seeded Supabase account directly). Local/dev keeps the
  // convenience default.
  const demoPassword =
    process.env.DEMO_ADMIN_PASSWORD ??
    (process.env.NODE_ENV === "production" ? null : "admindemo123");
  if (!demoPassword) {
    return NextResponse.json(
      { ok: false, error: "Demo login is not configured." },
      { status: 500 },
    );
  }
  const cookieStore = cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
