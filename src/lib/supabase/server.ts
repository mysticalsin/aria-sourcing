import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  supabaseEnabled,
  isProduction,
  demoLoginEnabled,
  assertSupabaseConfiguredInProd,
} from "./config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export type AdminCheckResult =
  | { ok: true; role: string }
  | { ok: false; response: NextResponse };

/**
 * Server-side admin guard. Requires an authenticated session and role = 'admin'.
 * In non-production DEMO mode (no Supabase) the check is skipped and returns
 * ok=true. In production with no Supabase it FAILS CLOSED (503) — never ok=true.
 * Use this in mutating API routes that should be admin-only.
 */
export async function requireAdmin(
  serverSupabase: Awaited<ReturnType<typeof getServerSupabase>>,
): Promise<AdminCheckResult> {
  if (!supabaseEnabled || !serverSupabase) {
    // Fail CLOSED in production: without a verified Supabase session we cannot
    // confirm identity or role, so admin access must NEVER be granted. DEMO mode
    // (non-production) stays open for local development, as does a deliberately
    // public synthetic demo (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true) whose state is
    // entirely in-browser anyway.
    if (isProduction && !demoLoginEnabled) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "Server authentication is not configured." },
          { status: 503 },
        ),
      };
    }
    return { ok: true, role: "admin" };
  }
  const {
    data: { user },
    error: userErr,
  } = await serverSupabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }) };
  }
  const { data: role, error: roleErr } = await serverSupabase.rpc("current_profile_role");
  if (roleErr || role !== "admin") {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 }) };
  }
  return { ok: true, role };
}

/**
 * Service-role client (SERVER ONLY) — bypasses RLS to read secrets (e.g. API key
 * values) for server-side validation. Never import this into a client component.
 */
export function getServiceSupabase() {
  // Fail closed in production: a missing Supabase env must not be silently
  // tolerated here either (a legitimately-absent service-role key still returns
  // null below, which callers already handle).
  assertSupabaseConfiguredInProd();
  if (!supabaseEnabled || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Server Supabase client bound to the request cookies. Use in Server Components,
 * Route Handlers, and middleware. Returns null in DEMO mode.
 */
export async function getServerSupabase() {
  // Fail closed in production: never hand back a null (DEMO/admin) request context
  // when Supabase env is missing — that is the fail-open bug this guard prevents.
  assertSupabaseConfiguredInProd();
  if (!supabaseEnabled) return null;
  // Next.js 15+: cookies() is async-only.
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // called from a Server Component — middleware refreshes the session instead
        }
      },
    },
  });
}
