import { createHmac, timingSafeEqual } from "crypto";

/**
 * Open-demo session tokens (SERVER ONLY — imports node:crypto, never use in Edge).
 *
 * The public demo has no Supabase auth, but it must not let anonymous callers spend
 * the env-resident LLM key. The one-click admin/admin login mints a short-lived,
 * HMAC-signed token stored in an httpOnly cookie; the chat route verifies it before
 * using the key. This is a lightweight COST gate for a synthetic-data demo — not a
 * user-identity system (there are no real users or private data to protect).
 *
 * Secret: DEMO_SESSION_SECRET (>= 16 chars). Unset → the gate fails closed: no token
 * can be minted or verified, so the LLM key stays unreachable.
 */

const TTL_MS = 12 * 60 * 60 * 1000; // 12h — matches the cookie maxAge.

function secret(): string {
  return process.env.DEMO_SESSION_SECRET ?? "";
}

/** True when a usable signing secret is configured. */
export function demoAuthConfigured(): boolean {
  return secret().length >= 16;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Mint a `<expiryMs>.<hex-hmac>` session token. Caller must first check demoAuthConfigured(). */
export function mintDemoToken(): string {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

/** Verify a session token: correct signature and not expired. Never throws. */
export function verifyDemoToken(token: string | undefined | null): boolean {
  if (!token || !demoAuthConfigured()) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
