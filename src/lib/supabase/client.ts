"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from "./config";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser Supabase client (singleton). Returns null in DEMO mode so callers can
 * branch without crashing when no project is configured.
 */
export function getBrowserSupabase() {
  if (!supabaseEnabled) return null;
  if (cached) return cached;
  cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
