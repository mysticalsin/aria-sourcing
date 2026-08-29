/**
 * HeyReach Public API adapter — official LinkedIn outreach via api.heyreach.io.
 * Uses X-API-KEY. Prefer inbox SendMessage when conversation exists; otherwise
 * AddLeadsToCampaign / campaign Create for connection+message sequences.
 *
 * Config sources (merged): Fly env HEYREACH_* and/or Settings → LinkedIn stack
 * (api_keys vault + settings.heyreach.campaignId).
 *
 * Docs: https://documenter.getpostman.com/view/23808049/2sA2xb5F75
 */

import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getServiceSupabase } from "@/lib/supabase/server";
import { mergeHeyReachConfig } from "@/lib/heyreach-config";
import type { LinkedInDeliveryOutcome, LinkedInDeliveryRequest } from "@/lib/linkedin-channel";
import type { HeyReachSettings } from "@/lib/types";

export { heyReachSettingsReady, mergeHeyReachConfig } from "@/lib/heyreach-config";

const HEYREACH_BASE = "https://api.heyreach.io/api/public";
const TIMEOUT = 20_000;

export type HeyReachConfig = {
  apiKey: string;
  /** Campaign id to add leads into (Settings or env HEYREACH_CAMPAIGN_ID) */
  campaignId?: string;
  /** Optional LinkedIn sender account id in HeyReach */
  accountId?: string;
};

export type HeyReachWorkspaceSecrets = {
  apiKey?: string;
  campaignId?: string;
  accountId?: string;
};

export function heyReachConfiguredFromEnv(): boolean {
  return Boolean((process.env.HEYREACH_API_KEY ?? "").trim());
}

/** API key + campaign id — required before Aria may auto-queue LinkedIn via HeyReach. */
export function heyReachDeliveryReadyFromEnv(): boolean {
  const cfg = heyReachConfigFromEnv();
  return Boolean(cfg?.apiKey && cfg.campaignId);
}

export function heyReachConfigFromEnv(): HeyReachConfig | null {
  const apiKey = (process.env.HEYREACH_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return {
    apiKey,
    campaignId: (process.env.HEYREACH_CAMPAIGN_ID ?? "").trim() || undefined,
    accountId: (process.env.HEYREACH_ACCOUNT_ID ?? "").trim() || undefined,
  };
}

async function heyReachFetch(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${HEYREACH_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

/** Probe API key — GET auth/CheckApiKey */
export async function checkHeyReachApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await heyReachFetch("/auth/CheckApiKey", apiKey, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve delivery config for a workspace: Fly env and/or Settings vault + campaign id.
 * NEVER logs the decrypted API key.
 */
export async function resolveHeyReachConfigForWorkspace(
  workspaceId: string,
): Promise<HeyReachConfig | null> {
  const env = heyReachConfigFromEnv();
  if (env?.apiKey && env.campaignId) return env;

  const wid = workspaceId.trim();
  if (!wid) return mergeHeyReachConfig(env, null);

  const svc = getServiceSupabase();
  if (!svc) return mergeHeyReachConfig(env, null);

  const { data: row } = await svc
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", wid)
    .maybeSingle();
  const state = row?.state as { settings?: { heyreach?: HeyReachSettings } } | null | undefined;
  const hey = state?.settings?.heyreach;
  const campaignId = (hey?.campaignId ?? "").trim();
  const accountId = (hey?.accountId ?? "").trim() || undefined;
  const apiKeyId = (hey?.apiKeyId ?? "").trim();

  let apiKey = "";
  if (apiKeyId) {
    const { data: keyRow } = await svc
      .from("api_keys")
      .select("secret, status, provider")
      .eq("id", apiKeyId)
      .eq("workspace_id", wid)
      .maybeSingle();
    if (
      keyRow &&
      keyRow.status === "valid" &&
      (keyRow.provider === "HeyReach" || keyRow.provider === "Custom") &&
      typeof keyRow.secret === "string"
    ) {
      apiKey = decryptSecret(keyRow.secret).trim();
    }
  }
  if (!apiKey) {
    const { data: latest } = await svc
      .from("api_keys")
      .select("secret")
      .eq("workspace_id", wid)
      .eq("provider", "HeyReach")
      .eq("status", "valid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.secret && typeof latest.secret === "string") {
      apiKey = decryptSecret(latest.secret).trim();
    }
  }

  return mergeHeyReachConfig(env, {
    apiKey: apiKey || undefined,
    campaignId: campaignId || undefined,
    accountId,
  });
}

export async function heyReachDeliveryReadyForWorkspace(workspaceId: string): Promise<boolean> {
  return Boolean(await resolveHeyReachConfigForWorkspace(workspaceId));
}

/**
 * Deliver a LinkedIn first-touch via HeyReach.
 * Strategy:
 * 1. If campaignId set → AddLeadsToCampaign with profile URL + custom message fields
 * 2. Else → refuse with clear detail (operator must set campaign id in Settings or env)
 */
export async function deliverLinkedInViaHeyReach(
  req: LinkedInDeliveryRequest,
  config: HeyReachConfig,
): Promise<LinkedInDeliveryOutcome> {
  const profileUrl = req.profileUrl.trim();
  if (!profileUrl) {
    return {
      status: "error",
      deliveryState: "not-sent",
      provider: "HeyReach",
      detail: "LinkedIn profile URL is required for HeyReach delivery.",
    };
  }
  if (!config.campaignId) {
    return {
      status: "error",
      deliveryState: "not-sent",
      provider: "HeyReach",
      detail:
        "HeyReach campaign id is required (Settings → LinkedIn stack, or HEYREACH_CAMPAIGN_ID).",
    };
  }

  try {
    const res = await heyReachFetch("/campaign/AddLeadsToCampaignV2", config.apiKey, {
      method: "POST",
      body: JSON.stringify({
        campaignId: Number(config.campaignId) || config.campaignId,
        accountLeadPairs: [
          {
            linkedInAccountId: config.accountId ? Number(config.accountId) || config.accountId : undefined,
            lead: {
              profileUrl,
              firstName: undefined,
              lastName: undefined,
              customUserFields: [
                { name: "aria_message_id", value: req.messageId },
                { name: "aria_subject", value: req.subject.slice(0, 500) },
                { name: "aria_body", value: req.body.slice(0, 7500) },
              ],
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      // Fallback older endpoint shape
      const fallback = await heyReachFetch("/campaign/AddLeadsToCampaign", config.apiKey, {
        method: "POST",
        body: JSON.stringify({
          campaignId: Number(config.campaignId) || config.campaignId,
          linkedInAccountId: config.accountId ? Number(config.accountId) || config.accountId : undefined,
          leads: [{ profileUrl, customFields: { aria_message_id: req.messageId } }],
        }),
      });
      if (!fallback.ok) {
        return {
          status: "error",
          deliveryState: classifyFailedHttpDeliveryState(res.status),
          provider: "HeyReach",
          detail: `HeyReach AddLeads HTTP ${res.status}/${fallback.status}`,
        };
      }
      return {
        status: "sent",
        deliveryState: "accepted",
        provider: "HeyReach",
        detail: "Lead added to HeyReach campaign for LinkedIn sequence delivery.",
        id: `${req.attemptId}:heyreach-campaign`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as { addedLeadsCount?: number; id?: string };
    return {
      status: "sent",
      deliveryState: "accepted",
      provider: "HeyReach",
      detail: `Lead queued in HeyReach campaign (added=${data.addedLeadsCount ?? "ok"}).`,
      id: data.id?.trim() || `${req.attemptId}:heyreach`,
    };
  } catch (err) {
    return {
      status: "error",
      deliveryState: "unknown",
      provider: "HeyReach",
      detail: err instanceof Error ? err.message : "HeyReach delivery failed.",
    };
  }
}
