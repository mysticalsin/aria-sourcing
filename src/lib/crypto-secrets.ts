// Server-only envelope encryption for secrets at rest (provider API keys + OAuth
// mailbox tokens). AES-256-GCM with a key-encryption key from env DATA_ENCRYPTION_KEY
// (base64-encoded 32 bytes). So a database/backup compromise no longer leaks every
// tenant's live credentials in plaintext.
//
// Backward-compatible by design:
//   - No DATA_ENCRYPTION_KEY set  -> encryptSecret returns plaintext (today's behavior),
//     decryptSecret passes plaintext through. Existing deployments keep working untouched.
//   - Key set -> new writes are encrypted (prefixed `enc:v1:`); decryptSecret handles
//     both encrypted and legacy-plaintext values, so it is safe to roll the key in
//     without a data migration (old rows stay readable, new rows are protected).
//
// Generate a key: `openssl rand -base64 32`.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? "";
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** True when a valid encryption key is configured (encryption is active). */
export function secretEncryptionEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Fail-closed guard for secret-at-rest writes. True when we are in production,
 * this is NOT a deliberately public demo (demoLoginEnabled), and no
 * DATA_ENCRYPTION_KEY is configured — i.e. persisting a secret right now would
 * silently write plaintext into a column meant to hold ciphertext (provider API
 * keys, OAuth mailbox tokens). Callers MUST check this before any encryptSecret()
 * write that will be persisted and refuse the write instead of degrading to
 * plaintext (mirrors the assertSupabaseConfiguredInProd fail-closed posture; same
 * demoLoginEnabled escape hatch, so the public vercel demo is unaffected).
 */
export function encryptionRequiredButMissing(): boolean {
  const liveSupabaseEnabled = Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "") &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
  );
  const liveProduction = process.env.NODE_ENV === "production";
  const liveDemoLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true";
  return (liveProduction || liveSupabaseEnabled) && !liveDemoLoginEnabled && !secretEncryptionEnabled();
}

/** Encrypt a secret for storage. Returns the plaintext unchanged when no key is set. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key || !plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a stored secret. Legacy plaintext (or no key) passes through unchanged. An
 *  encrypted value with no/invalid key fails closed (empty string). */
export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = getKey();
  if (!key) return "";
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !ctB64) return "";
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
