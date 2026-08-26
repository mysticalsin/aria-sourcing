/**
 * HeyReach MCP — official LinkedIn outreach funnel on top of Aria's LinkedIn OIDC identity.
 * Docs: https://help.heyreach.io/en/articles/12117291-how-does-heyreach-mcp-work-with-popular-tools
 */

import type { ApiKey, McpServerConfig } from "./types";
import { validateMcpBaseUrl } from "./mcp-auth-params";

export const HEYREACH_MCP_HOST = "mcp.heyreach.io";
export const HEYREACH_MCP_SERVER_NAME = "HeyReach MCP";
export const HEYREACH_MCP_INTEGRATION_ID = "int_heyreach";
export const HEYREACH_HELP_URL =
  "https://help.heyreach.io/en/articles/12117291-how-does-heyreach-mcp-work-with-popular-tools";

/** Accept only the official HeyReach MCP host (path carries workspace id). */
export function isHeyReachMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && parsed.hostname === HEYREACH_MCP_HOST;
  } catch {
    return false;
  }
}

export function validateHeyReachMcpUrl(url: string): { ok: true } | { ok: false; error: string } {
  const guard = validateMcpBaseUrl(url.trim());
  if (!guard.ok) return guard;
  if (!isHeyReachMcpUrl(url)) {
    return {
      ok: false,
      error: `HeyReach MCP URL must be https://${HEYREACH_MCP_HOST}/… (copy from HeyReach → Integrations → HeyReach MCP Server).`,
    };
  }
  return { ok: true };
}

export function findHeyReachMcpServer(servers: McpServerConfig[] | undefined): McpServerConfig | undefined {
  return (servers ?? []).find((s) => s.preset === "heyreach" || isHeyReachMcpUrl(s.url));
}

export function heyReachApiKeys(apiKeys: ApiKey[]): ApiKey[] {
  return apiKeys.filter((k) => k.provider === "HeyReach" || k.provider === "Custom");
}

export function heyReachMcpConnected(server: McpServerConfig | undefined): boolean {
  return Boolean(server && server.status === "connected" && server.enabled);
}
