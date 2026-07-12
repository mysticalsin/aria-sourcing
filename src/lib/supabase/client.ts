"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_AUTH_COOKIE_NAME, SUPABASE_URL, supabaseEnabled } from "./config";

let cached: ReturnType<typeof createBrowserClient> | null = null;

const MAX_ATTEMPTS = 8;
const PER_ATTEMPT_TIMEOUT_MS = 7000;

function backoff(attempt: number) {
  const ms = Math.min(250 * 2 ** attempt, 2000);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Edge-resilient fetch. A hosting edge can intermittently drop connections
 * (observed on the Fly public edge), which surfaces to the browser as
 * "Failed to fetch" and breaks sign-in. A dropped connection or a gateway
 * error (502/503/504) never reached the origin, so it is safe to retry on a
 * fresh connection — including for POSTs. Each attempt has its own short
 * timeout so a stalled connection fails fast instead of hanging, and the
 * caller's AbortSignal is always honoured. Definitive responses
 * (2xx / 4xx / 500) are returned unchanged.
 */
const edgeResilientFetch: typeof fetch = async (input, init) => {
  const external = init?.signal ?? undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (external?.aborted) throw new DOMException("Aborted", "AbortError");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
    const relayAbort = () => controller.abort();
    external?.addEventListener("abort", relayAbort, { once: true });

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < MAX_ATTEMPTS - 1) {
        await backoff(attempt);
        continue;
      }
      return res;
    } catch (error) {
      // Caller genuinely cancelled → do not retry.
      if (external?.aborted) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await backoff(attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", relayAbort);
    }
  }

  throw lastError;
};

/**
 * Browser Supabase client (singleton). Returns null in DEMO mode so callers can
 * branch without crashing when no project is configured.
 */
export function getBrowserSupabase() {
  if (!supabaseEnabled) return null;
  if (cached) return cached;
  cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE_NAME },
    global: { fetch: edgeResilientFetch },
  });
  return cached;
}
