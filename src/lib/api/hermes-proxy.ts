import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { decryptSecret } from "@/lib/crypto-secrets";
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

export async function resolveHermesBearerToken(hermesApiKeyId?: string): Promise<string> {
  let bearerToken = process.env.HERMES_API_KEY ?? "";
  if (supabaseEnabled && hermesApiKeyId) {
    const session = await getServerSupabase();
    const svc = getServiceSupabase();
    if (session && svc) {
      const {
        data: { user },
      } = await session.auth.getUser();
      if (user) {
        const { data: wid } = await session.rpc("current_workspace_id");
        const { data: row } = await svc
          .from("api_keys")
          .select("secret, workspace_id")
          .eq("id", hermesApiKeyId)
          .single();
        if (row && row.workspace_id === wid && typeof row.secret === "string") {
          bearerToken = decryptSecret(row.secret);
        }
      }
    }
  }
  return bearerToken;
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
