const SENSITIVE_ECHO_KEY = /(?:authorization|api[_-]?key|apikey|token|secret|password|credential|bearer)/i;
const MAX_CREDENTIAL_DECODING_LAYERS = 16;

function decodeCredentialLayer(value: string): string {
  return value
    .replace(/\+/g, " ")
    .replace(/(?:%[0-9a-f]{2})+/gi, (encodedRun) => {
      const bytes = encodedRun
        .slice(1)
        .split("%")
        .map((hex) => Number.parseInt(hex, 16));
      return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
    });
}

/** Detect a raw, form-encoded, URL-encoded, or repeatedly encoded credential
 * inside untrusted provider data. Work is deliberately bounded; an input that
 * keeps changing beyond the bound is treated as unsafe and redacted. */
export function containsCredentialRepresentation(value: string, secret: string): boolean {
  if (!secret) return false;
  let candidate = value;
  for (let layer = 0; layer < MAX_CREDENTIAL_DECODING_LAYERS; layer += 1) {
    if (candidate.includes(secret)) return true;
    const decoded = decodeCredentialLayer(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return true;
}

export function scrubExactSecretString(value: string, secret: string): string {
  return containsCredentialRepresentation(value, secret) ? "" : value;
}

export function scrubExactSecretValue(
  value: unknown,
  secret: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return scrubExactSecretString(value, secret);
  if ((typeof value === "number" || typeof value === "boolean") && String(value) === secret) return null;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 32 || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubExactSecretValue(item, secret, depth + 1, seen));
  const sanitized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_ECHO_KEY.test(key) || containsCredentialRepresentation(key, secret)) continue;
    sanitized[key] = scrubExactSecretValue(item, secret, depth + 1, seen);
  }
  return sanitized;
}
