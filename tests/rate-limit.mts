/* ============================================================================
   tests/rate-limit.mts
   Area: in-memory sliding-window rate limiter (src/lib/rate-limit.ts).

   Guards the provider-touching / auth endpoints (audit Gate 9). Verifies the
   limiter allows up to `max`, then blocks (429-shaped) within the window, then
   resets once the window elapses. The module reads the global `Date.now`, so we
   install a deterministic fake clock — no real sleeps, no flakiness.
   ========================================================================== */

import { checkRateLimit, rateLimitKey, tooManyRequests } from "../src/lib/rate-limit";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- Deterministic clock (the limiter calls the global Date.now). ---- */
const realNow = Date.now;
let clock = 1_700_000_000_000;
Date.now = () => clock;

try {
  const key = "rl-test:203.0.113.7:user-1";
  const opts = { windowMs: 1000, max: 3 };

  /* Up to `max` requests are allowed, with decreasing `remaining`. */
  const r1 = checkRateLimit(key, opts);
  const r2 = checkRateLimit(key, opts);
  const r3 = checkRateLimit(key, opts);
  ok("1st request allowed (remaining 2)", r1.ok && r1.remaining === 2 && r1.retryAfterSec === 0);
  ok("2nd request allowed (remaining 1)", r2.ok && r2.remaining === 1);
  ok("3rd request allowed (remaining 0 — last in window)", r3.ok && r3.remaining === 0);

  /* The (max+1)-th request is blocked (the 429 case) — not recorded. */
  const r4 = checkRateLimit(key, opts);
  ok("4th request blocked (over max)", r4.ok === false && r4.remaining === 0);
  ok("blocked result carries a positive Retry-After", r4.retryAfterSec >= 1);

  /* Still blocked while the window has not fully elapsed. */
  clock += 500;
  const r5 = checkRateLimit(key, opts);
  ok("still blocked partway through the window", r5.ok === false);

  /* Once the window fully elapses past the first hit, the limit resets. */
  clock += 600; // 1100ms total since the first hit > windowMs (1000ms)
  const r6 = checkRateLimit(key, opts);
  ok("allowed again after the window resets", r6.ok === true && r6.remaining === 2);

  /* Buckets are isolated per key — one client cannot exhaust another's. */
  const rOther = checkRateLimit("rl-test:198.51.100.9:user-2", opts);
  ok("a different key has its own independent bucket", rOther.ok === true && rOther.remaining === 2);

  /* max:0 blocks everything immediately (degenerate config is fail-closed). */
  const rZero = checkRateLimit("rl-test:zero", { windowMs: 1000, max: 0 });
  ok("max:0 blocks the very first request", rZero.ok === false);

  /* tooManyRequests builds a correct 429 response. */
  const resp = tooManyRequests(7);
  ok("tooManyRequests => HTTP 429", resp.status === 429);
  ok("tooManyRequests sets Retry-After (seconds)", resp.headers.get("Retry-After") === "7");
  ok("tooManyRequests Retry-After is at least 1", tooManyRequests(0).headers.get("Retry-After") === "1");

  /* rateLimitKey derivation: scope + spoof-resistant client IP + user id.
     The LEFTMOST x-forwarded-for hop is attacker-controlled on append-style
     proxies (Vercel/CDNs), so we trust the LAST hop (closest trusted proxy). */
  const fwd = new Request("http://localhost/api/x", {
    headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
  });
  ok("key uses the LAST x-forwarded-for hop (not the spoofable first) + scope + user", rateLimitKey(fwd, "scope", "u1") === "scope:10.0.0.1:u1");

  /* x-real-ip (platform-trusted, not client-appendable) wins over x-forwarded-for. */
  const bothIp = new Request("http://localhost/api/x", {
    headers: { "x-real-ip": "5.5.5.5", "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
  });
  ok("key prefers x-real-ip over x-forwarded-for (anti-spoof)", rateLimitKey(bothIp, "scope", "u1") === "scope:5.5.5.5:u1");

  const realIp = new Request("http://localhost/api/x", { headers: { "x-real-ip": "5.5.5.5" } });
  ok("key falls back to x-real-ip and 'anon' when user is absent", rateLimitKey(realIp, "scope") === "scope:5.5.5.5:anon");

  const noIp = new Request("http://localhost/api/x");
  ok("key falls back to 'unknown' IP so unidentified callers share one bucket", rateLimitKey(noIp, "scope") === "scope:unknown:anon");
} finally {
  Date.now = realNow; // never leak the fake clock to other tests in the chain
}

console.log(`RESULT rate-limit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
