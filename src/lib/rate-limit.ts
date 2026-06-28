/**
 * Dependency-free, in-memory sliding-window rate limiter.
 *
 * Designed for Next.js route handlers AND Edge middleware, so it relies only on
 * Web-standard `Request`/`Response` (no `next/server`, no Node-only timers) and
 * stays runtime-agnostic.
 *
 * Algorithm: a sliding-window log. Each key keeps the timestamps of the requests
 * that fall inside the current window; on every check we drop expired timestamps,
 * count what remains, and either record the new hit or reject it. This is exact
 * (no fixed-window burst at the boundary) and cheap for the small `max` values
 * used to guard auth/proxy endpoints.
 *
 * SERVERLESS CAVEAT: state lives in a per-instance `Map`. Each serverless /
 * lambda instance (and each Edge isolate) keeps its own counters, so the
 * effective global limit is `max * <number of warm instances>`. This is a
 * best-effort, defence-in-depth throttle to blunt abuse and accidental loops —
 * NOT a hard, cluster-wide quota. For strict global limits, back this with a
 * shared store (Redis/Upstash). The Map is pinned to `globalThis` so it survives
 * module re-evaluation (dev HMR, warm reuse) within a single instance.
 */

export type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per key within the window. */
  max: number;
};

export type RateLimitResult = {
  /** True when the request is within the limit (and has been recorded). */
  ok: boolean;
  /** Seconds the caller should wait before retrying (0 when ok). */
  retryAfterSec: number;
  /** Requests still allowed in the current window after this call (0 when blocked). */
  remaining: number;
};

/** Per-key log of request timestamps (ms epoch) currently inside the window. */
type Bucket = number[];

type RateLimitStore = {
  buckets: Map<string, Bucket>;
  lastSweep: number;
};

// How often the opportunistic sweep runs, and how long an untouched bucket may
// linger before it is reclaimed. Timer-free so it is safe on Edge/serverless:
// cleanup is piggy-backed onto `checkRateLimit` calls instead of setInterval.
const SWEEP_INTERVAL_MS = 60_000;
const MAX_IDLE_MS = 3_600_000;

const globalRef = globalThis as typeof globalThis & {
  __msourcingRateLimit?: RateLimitStore;
};

const store: RateLimitStore =
  globalRef.__msourcingRateLimit ??
  (globalRef.__msourcingRateLimit = { buckets: new Map(), lastSweep: Date.now() });

/**
 * Build a stable rate-limit key from the request IP, a logical scope, and an
 * optional user id.
 *
 * IP resolution is spoof-resistant: prefer `x-real-ip` (set by Vercel / most
 * proxies to the TRUE client IP and not client-appendable), then the LAST hop of
 * `x-forwarded-for` (appended by the closest trusted proxy — the leftmost entry is
 * attacker-controlled and must never be trusted), then a constant so unidentifiable
 * callers share one bucket rather than minting unlimited buckets. `scope` isolates
 * limits per endpoint; `userId` (when known) ties the limit to the principal.
 */
export function rateLimitKey(req: Request, scope: string, userId?: string | null): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  const lastHop = forwarded
    ? forwarded.split(",").map((s) => s.trim()).filter(Boolean).pop()
    : "";
  const ip = realIp || lastHop || "unknown";
  return `${scope}:${ip}:${userId ?? "anon"}`;
}

/**
 * Check (and record) a request against the sliding window for `key`.
 *
 * On an allowed request the current timestamp is appended and `remaining` is
 * decremented. On a blocked request nothing is recorded and `retryAfterSec`
 * reflects when the oldest in-window hit expires.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = Math.max(1, opts.windowMs);
  const max = Math.max(0, Math.floor(opts.max));

  maybeSweep(now);

  const windowStart = now - windowMs;
  const existing = store.buckets.get(key);
  // Keep only hits still inside the window.
  const hits = existing ? existing.filter((t) => t > windowStart) : [];

  if (hits.length >= max) {
    // Blocked: do not record. Retry once the oldest in-window hit ages out.
    const oldest = hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    // Persist the pruned list so memory does not grow while blocked.
    store.buckets.set(key, hits);
    return { ok: false, retryAfterSec, remaining: 0 };
  }

  hits.push(now);
  store.buckets.set(key, hits);
  return { ok: true, retryAfterSec: 0, remaining: Math.max(0, max - hits.length) };
}

/**
 * Standard 429 response for a rate-limited request: JSON body
 * `{ ok: false, error: "rate_limited" }` plus a `Retry-After` header (seconds).
 */
export function tooManyRequests(retryAfterSec: number): Response {
  const retry = Math.max(1, Math.ceil(retryAfterSec));
  return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retry),
    },
  });
}

/**
 * Opportunistic, timer-free cleanup. Throttled to once per `SWEEP_INTERVAL_MS`,
 * it drops buckets whose most recent hit is older than `MAX_IDLE_MS`, bounding
 * memory against one-off IPs that are never seen again.
 */
function maybeSweep(now: number): void {
  if (now - store.lastSweep < SWEEP_INTERVAL_MS) return;
  store.lastSweep = now;
  const cutoff = now - MAX_IDLE_MS;
  for (const [key, hits] of store.buckets) {
    const last = hits[hits.length - 1];
    if (last === undefined || last <= cutoff) store.buckets.delete(key);
  }
}
