import type { PolicyEnv, PolicyResult } from "./types";

export const DEFAULT_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KILL_SWITCH_OFF = new Set(["0", "false", "off"]);
const KILL_SWITCH_ON = new Set(["1", "true", "on"]);

export interface RecipientAllowlist {
  enforced: boolean;
  entries: ReadonlySet<string>;
}

export type RunMode = "demo" | "test";

/** Split a configured list on commas, semicolons, or whitespace. Empty tokens drop out. */
export function parseAllowlistEntries(raw: string | undefined): Set<string> {
  const entries = new Set<string>();
  if (!raw) return entries;
  for (const part of raw.split(/[\s,;]+/)) {
    const token = part.trim().toLocaleLowerCase();
    if (token) entries.add(token);
  }
  return entries;
}

/**
 * `live` is refused. Unset and `demo` stay in demo. Only `test` turns on
 * allowlist-only mode when the list itself is empty.
 */
export function resolveRunMode(value: string | undefined): { ok: true; mode: RunMode } | { ok: false; reason: "live-refused" } {
  if (value === undefined || value === "" || value === "demo") return { ok: true, mode: "demo" };
  if (value === "test") return { ok: true, mode: "test" };
  return { ok: false, reason: "live-refused" };
}

/**
 * Test mode is allowlist-only, including an empty list (nobody). A list that
 * is actually configured is enforced in demo too, so a manual approval cannot
 * skip it.
 */
export function recipientAllowlist(mode: RunMode, raw: string | undefined): RecipientAllowlist {
  const entries = parseAllowlistEntries(raw);
  return {
    enforced: mode === "test" || entries.size > 0,
    entries,
  };
}

export function recipientAllowed(allowlist: RecipientAllowlist, recipient: string): boolean {
  if (!allowlist.enforced) return true;
  const key = recipient.trim().toLocaleLowerCase();
  if (!key) return false;
  return allowlist.entries.has(key);
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
