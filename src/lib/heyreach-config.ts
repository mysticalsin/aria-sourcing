/**
 * Client-safe HeyReach config helpers (no server/crypto imports).
 */

import type { HeyReachSettings } from "@/lib/types";

export type HeyReachConfigParts = {
  apiKey?: string;
  campaignId?: string;
  accountId?: string;
};

/** Pure merge: env wins per-field when set; Settings fills gaps. Ready only with both key+campaign. */
export function mergeHeyReachConfig(
  env: HeyReachConfigParts | null | undefined,
  workspace: HeyReachConfigParts | null | undefined,
): { apiKey: string; campaignId: string; accountId?: string } | null {
  const apiKey = (env?.apiKey ?? workspace?.apiKey ?? "").trim();
  const campaignId = (env?.campaignId ?? workspace?.campaignId ?? "").trim();
  if (!apiKey || !campaignId) return null;
  const accountId = (env?.accountId ?? workspace?.accountId ?? "").trim() || undefined;
  return { apiKey, campaignId, accountId };
}

export function heyReachSettingsReady(settings: HeyReachSettings | null | undefined): boolean {
  return Boolean(settings?.apiKeyId?.trim() && settings?.campaignId?.trim());
}

/** Read non-secret HeyReach Settings from a workspace_state.state blob. */
export function heyReachSettingsFromWorkspaceState(state: unknown): HeyReachSettings | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const settings = (state as { settings?: unknown }).settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const hey = (settings as { heyreach?: unknown }).heyreach;
  if (!hey || typeof hey !== "object" || Array.isArray(hey)) return null;
  const row = hey as HeyReachSettings;
  return {
    apiKeyId: typeof row.apiKeyId === "string" ? row.apiKeyId : undefined,
    campaignId: typeof row.campaignId === "string" ? row.campaignId : undefined,
    accountId: typeof row.accountId === "string" ? row.accountId : undefined,
    connected: row.connected === true,
  };
}
