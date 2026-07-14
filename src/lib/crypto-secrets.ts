// Server-only envelope encryption for secrets at rest (provider API keys + OAuth
// mailbox tokens). AES-256-GCM with a key-encryption key from env DATA_ENCRYPTION_KEY
// (base64-encoded 32 bytes). So a database/backup compromise no longer leaks every
// tenant's live credentials in plaintext.
//
// Backward-compatible by design:
//   - No DATA_ENCRYPTION_KEY set -> encryptSecret returns plaintext (today's behavior),
//     decryptSecret passes plaintext through. Existing deployments keep working untouched.
//   - Key set -> new writes use `enc:v2:<key-id>:...`. DATA_ENCRYPTION_PREVIOUS_KEYS
//     may hold up to eight prior keys, allowing both v2 and legacy v1 rows to remain
//     readable during a bounded rotation window without a data migration.
//
// Generate a key: `openssl rand -base64 32`.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTED_PREFIX = "enc:";
const LEGACY_PREFIX = "enc:v1:";
const PREFIX = "enc:v2:";
const MAX_PREVIOUS_KEYS = 8;

type KeyRing = {
  state: "valid";
  current: Buffer;
  byId: Map<string, Buffer>;
  all: Buffer[];
};

type KeyRingConfig = KeyRing | { state: "absent" } | { state: "invalid" };

function decodeCanonicalBase64(value: string, expectedLength?: number): Buffer | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) return null;
    if (expectedLength !== undefined && decoded.length !== expectedLength) return null;
    return decoded;
  } catch {
    return null;
  }
}

function decodeCurrentKey(value: string): Buffer | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex");
}

function getKeyRing(): KeyRingConfig {
  const currentRaw = process.env.DATA_ENCRYPTION_KEY ?? "";
  const previousRaw = process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
  const previousConfigured = previousRaw !== undefined && previousRaw.trim() !== "";
  const current = decodeCurrentKey(currentRaw);

  // Preserve the historical no/invalid-current-key passthrough only when no
  // rotation ring is configured. A ring without a usable current key is an
  // invalid configuration and must not silently downgrade secret writes.
  if (!current) return previousConfigured ? { state: "invalid" } : { state: "absent" };

  let previousValues: unknown[] = [];
  if (previousConfigured) {
    try {
      const parsed: unknown = JSON.parse(previousRaw as string);
      if (!Array.isArray(parsed) || parsed.length > MAX_PREVIOUS_KEYS) return { state: "invalid" };
      previousValues = parsed;
    } catch {
      return { state: "invalid" };
    }
  }

  const canonicalKeys = new Set<string>([current.toString("base64")]);
  const all = [current];
  for (const value of previousValues) {
    if (typeof value !== "string" || canonicalKeys.has(value)) return { state: "invalid" };
    const key = decodeCanonicalBase64(value, 32);
    if (!key) return { state: "invalid" };
    canonicalKeys.add(value);
    all.push(key);
  }

  const byId = new Map<string, Buffer>();
  for (const key of all) {
    const id = keyId(key);
    if (byId.has(id)) return { state: "invalid" };
    byId.set(id, key);
  }
  return { state: "valid", current, byId, all };
}

/** True when a valid encryption key is configured (encryption is active). */
export function secretEncryptionEnabled(): boolean {
  return getKeyRing().state === "valid";
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
  if (!plaintext) return plaintext;
  const ring = getKeyRing();
  if (ring.state === "absent") return plaintext;
  if (ring.state === "invalid") return "";
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", ring.current, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${keyId(ring.current)}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  } catch {
    return "";
  }
}

function decryptWithKey(fields: string[], key: Buffer): string | null {
  if (fields.length !== 3) return null;
  const [ivB64, tagB64, ctB64] = fields;
  const iv = decodeCanonicalBase64(ivB64, 12);
  const tag = decodeCanonicalBase64(tagB64, 16);
  const ct = decodeCanonicalBase64(ctB64);
  if (!iv || !tag || !ct || ct.length === 0) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Decrypt a stored secret. Legacy plaintext passes through unchanged. An encrypted
 *  value with a missing/invalid key ring or malformed envelope fails closed (empty). */
export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const ring = getKeyRing();
  if (ring.state !== "valid") return "";

  if (stored.startsWith(PREFIX)) {
    const fields = stored.slice(PREFIX.length).split(":");
    if (fields.length !== 4) return "";
    const [id, ...ciphertextFields] = fields;
    if (!/^[a-f0-9]{64}$/.test(id)) return "";
    const key = ring.byId.get(id);
    if (!key) return "";
    return decryptWithKey(ciphertextFields, key) ?? "";
  }

  if (stored.startsWith(LEGACY_PREFIX)) {
    const fields = stored.slice(LEGACY_PREFIX.length).split(":");
    for (const key of ring.all) {
      const plaintext = decryptWithKey(fields, key);
      if (plaintext !== null) return plaintext;
    }
  }
  return "";
}
