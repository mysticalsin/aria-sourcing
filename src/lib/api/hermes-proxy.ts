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

/**
 * Upstream Hermes is TWO processes, not one, and their route sets do not overlap:
 *
 *  - "api"  the aiohttp gateway (`gateway/platforms/api_server.py`, default port
 *           8642). Serves `/health`, `/v1/*` and the `/api/sessions` family.
 *  - "web"  the FastAPI management server (`hermes_cli/web_server.py`, started as
 *           `python -m hermes_cli.main web --port 8080`). Serves `/api/status`,
 *           `/api/system/stats`, `/api/config`, `/api/memory`, `/api/skills`,
 *           `/api/curator` and `/api/files`.
 *
 * Addressing both off one base URL is why seven management paths returned 404
 * against a perfectly healthy runtime: they were being asked of the gateway.
 */
export type HermesProxyBase = "api" | "web";

const HERMES_BASE_ENV: Record<HermesProxyBase, string> = {
  api: "HERMES_API_URL",
  web: "HERMES_WEB_URL",
};

export function getHermesBaseUrl(
  base: HermesProxyBase = "api",
): { ok: true; baseUrl: string } | { ok: false; reason: string } {
  const envVar = HERMES_BASE_ENV[base];
  const raw = process.env[envVar] ?? "";
  const baseUrl = raw.replace(/\/$/, "");
  if (!baseUrl) {
    // Deliberately no fallback to HERMES_API_URL. Falling back is exactly how
    // every management path came to be sent to the gateway and 404 silently; a
    // clear "not configured" is more useful than a confident wrong answer.
    return {
      ok: false,
      reason:
        base === "web"
          ? `Aria runtime management URL is not configured (${envVar}).`
          : "Aria runtime URL is not configured.",
    };
  }
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
 * Paths on the Aria runtime that the MSourcing UI is allowed to proxy to, each
 * paired with the upstream process that actually serves it. Everything else
 * returns 404. This is an allow-list, not a block-list.
 *
 * Every entry below was verified to exist at upstream `origin/main`
 * (NousResearch/hermes-agent, 2026-07-24). Six entries were removed because they
 * exist on NEITHER upstream process and could only ever have 404'd:
 *
 *   api/health          the gateway serves `/health`, not `/api/health`
 *   api/tools           only `/api/tools/toolsets/*` and `/api/tools/computer-use/*`
 *   api/models          only `/api/model/*` (singular) and `/v1/models`
 *   api/schedules       no such route anywhere upstream
 *   api/gateway         only `/api/gateway/{drain,restart,start,stop}`
 *   api/oauth/account   a Nous cloud endpoint, not a local route
 *
 * Keeping dead entries here widened the nominal proxy surface for zero function
 * and made the list look maintained when it was not.
 */
export const HERMES_PROXY_ALLOW_LIST: readonly { path: string; base: HermesProxyBase }[] = [
  // aiohttp gateway.
  { path: "health", base: "api" },
  { path: "v1/chat/completions", base: "api" },
  // Registered on both processes; the gateway owns the chat session lifecycle
  // (GET/POST/PATCH/DELETE), so GET and POST must not straddle two servers.
  { path: "api/sessions", base: "api" },
  // FastAPI management server.
  { path: "api/status", base: "web" },
  { path: "api/system/stats", base: "web" },
  { path: "api/config", base: "web" },
  { path: "api/memory", base: "web" },
  { path: "api/skills", base: "web" },
  { path: "api/curator", base: "web" },
  { path: "api/files", base: "web" },
];

export function isAllowedHermesPath(
  path: string[],
): { ok: true; upstreamPath: string; base: HermesProxyBase } | { ok: false; reason: string; upstreamPath: string } {
  const upstreamPath = path.join("/");
  const entry = HERMES_PROXY_ALLOW_LIST.find((candidate) => candidate.path === upstreamPath);
  if (!entry) {
    return { ok: false, reason: "Path not in Aria proxy allow-list.", upstreamPath };
  }
  return { ok: true, upstreamPath, base: entry.base };
}
