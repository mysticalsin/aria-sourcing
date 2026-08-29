/**
 * HeyReach Public API adapter — official LinkedIn outreach via api.heyreach.io.
 * Uses X-API-KEY. Prefer inbox SendMessage when conversation exists; otherwise
 * AddLeadsToCampaign / campaign Create for connection+message sequences.
 *
 * Docs: https://documenter.getpostman.com/view/23808049/2sA2xb5F75
 */

import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";
import type { LinkedInDeliveryOutcome, LinkedInDeliveryRequest } from "@/lib/linkedin-channel";

const HEYREACH_BASE = "https://api.heyreach.io/api/public";
const TIMEOUT = 20_000;

export type HeyReachConfig = {
  apiKey: string;
  /** Optional campaign id to add leads into (Settings / env HEYREACH_CAMPAIGN_ID) */
  campaignId?: string;
  /** Optional LinkedIn sender account id in HeyReach */
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
 * Deliver a LinkedIn first-touch via HeyReach.
 * Strategy:
 * 1. If campaignId set → AddLeadsToCampaign with profile URL + custom message fields
 * 2. Else → refuse with clear detail (operator must set HEYREACH_CAMPAIGN_ID or use assisted-manual)
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
        "HEYREACH_CAMPAIGN_ID is required so Aria can add the lead to your HeyReach campaign sequence.",
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
