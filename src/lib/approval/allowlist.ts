import type { PolicyEnv, PolicyResult } from "./types";

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

export function killSwitchEngaged(env: PolicyEnv): boolean {
  const value = (env.ARIA_SEND_KILL_SWITCH ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}
