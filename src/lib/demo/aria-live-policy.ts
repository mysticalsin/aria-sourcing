import type { Campaign } from "../types";
import { campaignAllowsLiveSourcing } from "../sourcing/campaign-lifecycle";

export type AriaLiveRunPolicy =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Aria Live mutates the real workspace actions while it plays. Until a
 * side-effect-free adapter exists, it is only safe in an isolated local demo.
 */
export function getAriaLiveRunPolicy(supabaseConnected: boolean): AriaLiveRunPolicy {
  if (supabaseConnected) {
    return {
      ok: false,
      reason: "Aria Live is available only in an isolated local demo until a no-side-effect adapter exists.",
    };
  }
  return { ok: true };
}

/**
 * The campaign Aria Live plays on. The run starts by sourcing, so it needs a
 * campaign the sourcing actions accept (the same lifecycle rule): the active
 * campaign when it qualifies, otherwise the first one that does. Null when no
 * campaign is open for sourcing.
 */
export function pickAriaLiveCampaign(campaigns: Campaign[], activeCampaignId: string | null): Campaign | null {
  const active = campaigns.find((c) => c.id === activeCampaignId);
  if (active && campaignAllowsLiveSourcing(active.status)) return active;
  return campaigns.find((c) => campaignAllowsLiveSourcing(c.status)) ?? null;
}
