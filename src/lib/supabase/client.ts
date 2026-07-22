"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_AUTH_COOKIE_NAME, SUPABASE_URL, supabaseEnabled } from "./config";

let cached: ReturnType<typeof createBrowserClient> | null = null;

const MAX_ATTEMPTS = 8;
const PER_ATTEMPT_TIMEOUT_MS = 7000;
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

type TimerHandle = ReturnType<typeof setTimeout>;

type EdgeResilientFetchOptions = {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
  waitBeforeRetry?: (attempt: number, signal?: AbortSignal) => Promise<void>;
  setAttemptTimeout?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearAttemptTimeout?: (timer: TimerHandle) => void;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && input !== null && "method" in input && typeof input.method === "string") {
    return input.method.toUpperCase();
  }
  return "GET";
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof input === "object" && input !== null && "signal" in input && input.signal) {
    return input.signal;
  }
  return undefined;
}

function backoff(attempt: number, signal?: AbortSignal) {
  const ms = Math.min(250 * 2 ** attempt, 2000);
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);

    let timer: TimerHandle;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal!));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    // Close the small race between the initial check and listener registration.
    if (signal?.aborted) onAbort();
  });
}

/**
 * Edge-resilient fetch. A hosting edge can intermittently drop connections
 * (observed on the Fly public edge), which surfaces to the browser as
 * "Failed to fetch". Only safe read methods are retried: a transport failure or
 * gateway response does not prove that a mutation failed before reaching the
 * origin. Replaying Auth POSTs can create duplicate sessions or race refresh
 * token rotation. Each attempt has its own short timeout, and the caller's
 * AbortSignal is always honoured. Definitive responses are returned unchanged.
 */
export function createEdgeResilientFetch(options: EdgeResilientFetchOptions = {}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_ATTEMPTS));
  const perAttemptTimeoutMs = Math.max(1, Math.floor(options.perAttemptTimeoutMs ?? PER_ATTEMPT_TIMEOUT_MS));
  const waitBeforeRetry = options.waitBeforeRetry ?? backoff;
  const setAttemptTimeout = options.setAttemptTimeout ?? setTimeout;
  const clearAttemptTimeout = options.clearAttemptTimeout ?? clearTimeout;

  return async (input, init) => {
    const external = requestSignal(input, init);
    const canRetry = RETRYABLE_METHODS.has(requestMethod(input, init));
    const attemptLimit = canRetry ? maxAttempts : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      throwIfAborted(external);

      const controller = new AbortController();
      const timer = setAttemptTimeout(
        () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
        perAttemptTimeoutMs,
      );
      const relayAbort = () => controller.abort(abortReason(external!));
      external?.addEventListener("abort", relayAbort, { once: true });

      let response: Response | undefined;
      try {
        response = await fetchImpl(input, { ...init, signal: controller.signal });
      } catch (error) {
        if (external?.aborted) throw abortReason(external);
        lastError = error;
        if (attempt >= attemptLimit - 1) throw error;
      } finally {
        clearAttemptTimeout(timer);
        external?.removeEventListener("abort", relayAbort);
      }

      if (response) {
        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= attemptLimit - 1) {
          return response;
        }
        // The response will not be exposed to the caller. Release its stream
        // before opening another connection, even when cancellation itself fails.
        try {
          await response.body?.cancel();
        } catch {
          // Cancellation is best-effort; the retry policy remains fail-bounded.
        }
      }

      await waitBeforeRetry(attempt, external);
    }

    throw lastError ?? new TypeError("Edge request failed without a response.");
  };
}

const edgeResilientFetch = createEdgeResilientFetch();

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
