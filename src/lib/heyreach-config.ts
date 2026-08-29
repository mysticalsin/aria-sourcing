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
