/* ============================================================================
   Log redaction — scrub PII / secrets before anything reaches a log sink.

   Audit finding: candidate emails and raw provider request/response bodies were
   logged in cleartext (e.g. the Aria proxy log lines and provider error text).
   These helpers are dependency-free (standard lib / Web APIs only) and never
   throw — a logging utility that throws is worse than one that over-redacts.

   - redactEmail   : mask the local part of every email in a string  -> a***@domain.com
   - redactSecrets : mask bearer tokens, sk-/provider keys, JWTs, long hex/base64
   - redactObject  : shallow-clone an object, masking values of sensitive keys
   - safeLog       : console.log wrapper that deep-redacts strings and objects
   ========================================================================== */

/** Keys whose values are assumed sensitive wherever they appear. */
const SENSITIVE_KEY = /(email|token|secret|key|authorization|password|apikey)/i;

/** Email matcher. Used only with String.replace (which resets lastIndex), so the
    global flag is safe here; never call .test() on this instance. */
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Mask the local part of every email address found in `s`, keeping the first
 * character and the full domain so log lines stay greppable by domain.
 *   "jane.doe@acme.com" -> "j***@acme.com"
 */
export function redactEmail(s: string): string {
  if (typeof s !== "string") return s;
  return s.replace(EMAIL_RE, (_m, first: string, domain: string) => `${first}***@${domain}`);
}

/**
 * Mask common credential shapes in free text: Authorization schemes, JWTs,
 * provider API keys with a known prefix, AWS access-key ids, and long
 * hex / base64 secrets. Over-redacts by design — false positives are harmless
 * in a log line, leaked secrets are not.
 */
export function redactSecrets(s: string): string {
  if (typeof s !== "string") return s;
  return s
    // Authorization schemes: keep the scheme, drop the credential.
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 ***")
    // JWTs (header.payload.signature; base64url header always begins with eyJ).
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "***")
    // Provider API keys with a known prefix (OpenAI/Anthropic sk-, Groq gsk_,
    // xAI xai-, Slack xoxb-, GitHub ghp_/github_pat_, …).
    .replace(/\b(sk|pk|rk|gsk|xai|xoxb|xoxp|ghp|ghs|gho|github_pat)[-_][A-Za-z0-9\-_]{6,}/gi, "$1-***")
    // AWS access-key ids.
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g, "***")
    // Long hex secrets (md5/sha/hmac/api hashes).
    .replace(/\b[0-9a-f]{32,}\b/gi, "***")
    // Long base64 / base64url secrets.
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}/g, "***");
}

/** Redact a single string through both passes. */
function redactString(s: string): string {
  return redactSecrets(redactEmail(s));
}

/** Mask the value of a sensitive key. Emails keep their shape; everything else
    collapses to a fixed marker so no fragment of a secret survives. */
function maskValue(v: unknown): string {
  if (typeof v === "string" && v.includes("@")) return redactEmail(v);
  return "***";
}

/**
 * Return a shallow clone of `o` with the values of any key matching
 * SENSITIVE_KEY masked. Shallow by contract — nested objects are not traversed
 * (use safeLog for deep redaction). Non-objects are returned unchanged.
 */
export function redactObject<T>(o: T): T {
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return [...o] as unknown as T;
  const clone: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEY.test(key)) clone[key] = maskValue(clone[key]);
  }
  return clone as T;
}

/** Deep-redact an arbitrary value: scrub strings, mask sensitive keys, recurse
    into arrays/objects. `seen` guards against circular references. */
function deepRedact(v: unknown, seen: WeakSet<object>): unknown {
  if (typeof v === "string") return redactString(v);
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "[Circular]";
  seen.add(v);
  if (Array.isArray(v)) return v.map((item) => deepRedact(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? maskValue(val) : deepRedact(val, seen);
  }
  return out;
}

/**
 * console.log wrapper that redacts before emitting. String arguments are scrubbed
 * for emails and secrets; objects are deep-redacted (sensitive-key values masked,
 * string values scrubbed) and stringified to JSON; other primitives pass through.
 * Never throws — unserializable values degrade to a marker.
 */
export function safeLog(...args: unknown[]): void {
  const out = args.map((arg) => {
    if (typeof arg === "string") return redactString(arg);
    if (arg !== null && typeof arg === "object") {
      try {
        return JSON.stringify(deepRedact(arg, new WeakSet()));
      } catch {
        return "[unserializable]";
      }
    }
    return arg;
  });
  console.log(...out);
}
