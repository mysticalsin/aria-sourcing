/**
 * Supabase configuration guard.
 *
 * The app runs in two modes:
 *  - DEMO mode  — no Supabase env vars → localStorage persistence, no login gate.
 *  - LIVE mode  — env vars present → Supabase persistence + Microsoft (Entra) login.
 *
 * `supabaseEnabled` is evaluated from public env vars so it is safe in the browser.
 */
// Server code prefers `SUPABASE_URL` (non-public) so a container can reach the
// host's Supabase via a different host (e.g. host.docker.internal) than the
// browser. In the browser bundle the non-public var is undefined, so this always
// resolves to the public URL there. Unset → falls back to the public URL (normal
// local/prod runs are unchanged).
export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseEnabled = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** True for production builds (`next build` / `next start`). */
export const isProduction = process.env.NODE_ENV === "production";

/**
 * Fail-closed guard. In production the app MUST run in LIVE mode: if Supabase env
 * is missing, the open DEMO fallbacks (no login gate, every caller treated as
 * admin) would expose the entire app. Throwing here forces request-scoped server
 * entry points to refuse the request instead of silently granting access.
 *
 * Call ONLY inside request-scoped code (route handlers, server clients) — never
 * at module top level — so it can never break the build.
 */
export function assertSupabaseConfiguredInProd(): void {
  // A deliberately public demo (demoLoginEnabled) is the one sanctioned exception:
  // it intentionally runs open in prod with no Supabase, so don't throw for it.
  if (isProduction && !supabaseEnabled && !demoLoginEnabled) {
    throw new Error(
      "Supabase is not configured while NODE_ENV=production. Refusing to fall back to open DEMO mode.",
    );
  }
}

/**
 * Request-scoped fail-closed gate for API route handlers (middleware does not run
 * on /api/*). Returns a 503 Response to refuse the request when running in
 * production without Supabase configured — so handlers never silently fall back to
 * open DEMO mode (e.g. spending env-resident provider keys unauthenticated) —
 * or null to proceed. Call as the FIRST statement of each protected handler.
 */
export function prodFailClosed(): Response | null {
  if (isProduction && !supabaseEnabled && !demoLoginEnabled) {
    return new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/** Server-only. Never bundled to the browser (no NEXT_PUBLIC prefix). */
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Optional: restrict sign-in to an email domain (e.g. "mantu.com"). Empty = any. */
export const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "";

/**
 * Public-demo escape hatch. When `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` this instance
 * is a deliberately public, synthetic-data demo, which changes two things in prod:
 *
 *  1. With Supabase configured — the one-click `admin`/`admin` demo login
 *     (`/api/auth/demo-login`) is permitted even under `NODE_ENV=production`.
 *  2. WITHOUT Supabase configured — the app is allowed to run in open DEMO mode in
 *     production (in-browser `localStorage`, no login gate) instead of failing
 *     closed. The per-request fail-closed guards below honour this flag.
 *
 * Default (unset) preserves the strict production fail-closed posture: demo login
 * stays 404'd and a missing Supabase env returns 503. Set ONLY on a public demo;
 * never on a real tenant deployment. All outreach stays dry-run regardless.
 */
export const demoLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true";
