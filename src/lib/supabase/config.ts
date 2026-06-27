/**
 * Supabase configuration guard.
 *
 * The app runs in two modes:
 *  - DEMO mode  — no Supabase env vars → localStorage persistence, no login gate.
 *  - LIVE mode  — env vars present → Supabase persistence + Microsoft (Entra) login.
 *
 * `supabaseEnabled` is evaluated from public env vars so it is safe in the browser.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseEnabled = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Server-only. Never bundled to the browser (no NEXT_PUBLIC prefix). */
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Optional: restrict sign-in to an email domain (e.g. "mantu.com"). Empty = any. */
export const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "";
