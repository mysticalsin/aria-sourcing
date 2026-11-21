import type { PolicyEnv, PolicyResult } from "./types";

export const DEFAULT_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KILL_SWITCH_OFF = new Set(["0", "false", "off"]);
const KILL_SWITCH_ON = new Set(["1", "true", "on"]);

export interface RecipientAllowlist {
  enforced: boolean;
  entries: ReadonlySet<string>;
}

export type RunMode = "demo" | "test";

const HOMOGLYPHS: Readonly<Record<string, string>> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0445": "x",
  "\u0443": "y",
  "\u0456": "i",
  "\u0410": "a",
  "\u0415": "e",
  "\u041e": "o",
  "\u0420": "p",
  "\u0421": "c",
  "\u0425": "x",
  "\u0423": "y",
  "\u0406": "i",
};

/** NFC, then fold Cyrillic lookalikes, then trim and lowercase. */
export function normalizeRecipient(value: string): string {
  const folded = value.normalize("NFC").replace(/[\u0400-\u04FF]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  return folded.trim().toLocaleLowerCase();
}

/** Split a configured list on commas, semicolons, or whitespace. Empty tokens drop out. */
export function parseAllowlistEntries(raw: string | undefined): Set<string> {
  const entries = new Set<string>();
  if (!raw) return entries;
  for (const part of raw.split(/[\s,;]+/)) {
    const token = normalizeRecipient(part);
    if (token) entries.add(token);
  }
  return entries;
}

/**
 * `live` is refused. Unset and `demo` stay in demo. Both demo and test
 * enforce the allowlist, including when the list itself is empty.
 */
export function resolveRunMode(value: string | undefined): { ok: true; mode: RunMode } | { ok: false; reason: "live-refused" } {
  if (value === undefined || value === "" || value === "demo") return { ok: true, mode: "demo" };
  if (value === "test") return { ok: true, mode: "test" };
  return { ok: false, reason: "live-refused" };
}

/**
 * Demo and test both fail closed. An unset or empty list matches nobody.
 * `mode` is accepted so callers can keep passing the resolved run mode.
 */
export function recipientAllowlist(mode: RunMode, raw: string | undefined): RecipientAllowlist {
  void mode;
  return {
    enforced: true,
    entries: parseAllowlistEntries(raw),
  };
}

function hostOf(value: string): string {
  const at = value.lastIndexOf("@");
  return at >= 0 ? value.slice(at + 1) : value;
}

/**
 * Exact entry, or a bare host entry matching that host or a dot-boundary
 * subdomain. `evil-example.com` does not match `example.com`.
 */
export function recipientAllowed(allowlist: RecipientAllowlist, recipient: string): boolean {
  if (!allowlist.enforced) return true;
  const key = normalizeRecipient(recipient);
  if (!key) return false;
  if (allowlist.entries.has(key)) return true;
  const host = hostOf(key);
  for (const entry of allowlist.entries) {
    if (entry.includes("@")) continue;
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** Policy for recording a manual approval. The route must call this before the approval RPC. */
export function approvalPolicyFromEnv(env: PolicyEnv, recipient: string): PolicyResult {
  const mode = resolveRunMode(env.ARIA_MODE);
  if (!mode.ok) {
    return {
      ok: false,
      status: 403,
      error: "Live mode is refused.",
      reason: "live-refused",
    };
  }
  if (!recipientAllowed(recipientAllowlist(mode.mode, env.ARIA_RECIPIENT_ALLOWLIST), recipient)) {
    return {
      ok: false,
      status: 403,
      error: "Recipient is not on the allowlist.",
      reason: "allowlist",
    };
  }
  return { ok: true };
}

/**
 * Unset or blank leaves the switch off. Explicit 0, false, or off leave it off.
 * Any other set value engages it. An unrecognized value also logs a warning and
 * does not echo the value.
 */
export function killSwitchEngaged(env: PolicyEnv): boolean {
  const raw = env.ARIA_SEND_KILL_SWITCH;
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === "") return false;
  if (KILL_SWITCH_OFF.has(value)) return false;
  if (KILL_SWITCH_ON.has(value)) return true;
  console.warn("ARIA_SEND_KILL_SWITCH is set to an unrecognized value; the kill switch is engaged.");
  return true;
}

/** Blank uses 7 days. A set value that is not a positive number expires every approval and logs a warning. */
export function approvalTtlMs(env: PolicyEnv): number {
  const raw = env.ARIA_APPROVAL_TTL_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_APPROVAL_TTL_MS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    console.warn("ARIA_APPROVAL_TTL_DAYS is set to an unrecognized value; approvals are treated as expired.");
    return 0;
  }
  return days * 24 * 60 * 60 * 1000;
}

export function approvalIsCurrent(approvedAt: string | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) return false;
  if (!approvedAt) return false;
  const at = Date.parse(approvedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
  return nowMs >= at && nowMs - at <= ttlMs;
}
