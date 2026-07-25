import { supabaseEnabled } from "@/lib/supabase/config";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { isAllowedHermesUrl } from "./url";

/**
 * Shared helpers for the Aria runtime proxy routes.
 * The bearer token and base URL are always resolved server-side.
 */

export const HERMES_PROXY_TIMEOUT_MS = 30_000;

export function logHermesProxy(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
  const entry = { time: new Date().toISOString(), source: "hermes-proxy", level, message, ...(meta ?? {}) };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function getHermesBaseUrl(): { ok: true; baseUrl: string } | { ok: false; reason: string } {
  const raw = process.env.HERMES_API_URL ?? "";
  const baseUrl = raw.replace(/\/$/, "");
  if (!baseUrl) return { ok: false, reason: "Aria runtime URL is not configured." };
  const urlCheck = isAllowedHermesUrl(baseUrl);
  if (!urlCheck.ok) return { ok: false, reason: `Aria runtime URL rejected: ${urlCheck.reason}` };
  return { ok: true, baseUrl };
}

/**
 * Provider slug that a Hermes runtime credential is stored under. The typed chat
 * route already pins this (`src/app/api/hermes/chat/route.ts`), and the generic
 * proxy must agree with it or the two paths accept different sets of secrets.
 */
const HERMES_VAULT_PROVIDER = "Aria Agent";

export async function resolveHermesBearerToken(
  hermesApiKeyId?: string,
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (!hermesApiKeyId) return { ok: true, token: process.env.HERMES_API_KEY ?? "" };
  if (!supabaseEnabled) return { ok: false, reason: "Aria runtime key is not available." };

  // Delegate to the single hardened resolver rather than re-implementing it.
  // This function used to select on `workspace_id` alone — no `provider`, no
  // `status = 'valid'` — so any authenticated workspace member could name any
  // secret in their workspace, including a REVOKED one, and have it sent as a
  // Bearer token to the Hermes host. resolveVaultSecret filters on workspace,
  // status and provider in the query and re-checks each in code.
  const token = await resolveVaultSecret(hermesApiKeyId, HERMES_VAULT_PROVIDER);
  return token
    ? { ok: true, token }
    : { ok: false, reason: "Aria runtime key is not available." };
}

/**
 * Paths on the Aria runtime web_server that the MSourcing UI is allowed to
 * proxy to. Everything else returns 404. This is an allow-list, not a block-list.
 */
export const HERMES_PROXY_ALLOW_LIST = [
  "api/status",
  "api/system/stats",
  "api/health",
  "api/config",
  "api/sessions",
  "api/memory",
  "api/skills",
  "api/tools",
  "api/models",
  "api/schedules",
  "api/curator",
  "api/files",
  "api/gateway",
  "api/oauth/account",
  "v1/chat/completions",
];

export function isAllowedHermesPath(path: string[]): { ok: boolean; reason?: string; upstreamPath: string } {
  const upstreamPath = path.join("/");
  if (!HERMES_PROXY_ALLOW_LIST.includes(upstreamPath)) {
    return { ok: false, reason: "Path not in Aria proxy allow-list.", upstreamPath };
  }
  return { ok: true, upstreamPath };
}
