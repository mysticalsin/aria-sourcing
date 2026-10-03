/**
 * Client-safe LinkedIn automatic delivery helpers.
 * Keep this free of server-only imports — the Zustand store imports it.
 */

import type { AgentSeat, Candidate } from "@/lib/types";
import { isBrowserComputerSeat, seatAttachedToCampaign } from "@/lib/campaign-seat-attach";

/**
 * Providers that may send when deliveryMode is automatic (never assisted-manual).
 * OpenBot Browser Computer is first — product default is sandbox/VM send, not Vendor API.
 */
export const LINKEDIN_AUTOMATIC_PROVIDERS = [
  "LinkedIn Browser Computer",
  "LinkedIn Vendor API",
] as const;

export function isLinkedInAutomaticProvider(provider: string | null | undefined): boolean {
  return LINKEDIN_AUTOMATIC_PROVIDERS.includes(
    provider as (typeof LINKEDIN_AUTOMATIC_PROVIDERS)[number],
  );
}

function automaticProviderRank(provider: string): number {
  const idx = LINKEDIN_AUTOMATIC_PROVIDERS.indexOf(
    provider as (typeof LINKEDIN_AUTOMATIC_PROVIDERS)[number],
  );
  return idx === -1 ? LINKEDIN_AUTOMATIC_PROVIDERS.length : idx;
}

/** Prefer active automatic LinkedIn seats when the pool has LinkedIn profile URLs. */
export function preferLinkedInAutomaticSeats(
  seats: AgentSeat[],
  pool: Array<Pick<Candidate, "linkedinUrl">> | Pick<Candidate, "linkedinUrl">,
): AgentSeat[] {
  const list = Array.isArray(pool) ? pool : [pool];
  if (!list.some((c) => (c.linkedinUrl ?? "").trim())) return seats;
  const auto = seats
    .filter((s) => s.status === "active" && isLinkedInAutomaticProvider(s.provider))
    .slice()
    .sort((a, b) => automaticProviderRank(a.provider) - automaticProviderRank(b.provider));
  if (auto.length === 0) return seats;
  const rest = seats.filter((s) => !auto.some((a) => a.id === s.id));
  return [...auto, ...rest];
}

/**
 * Pick the live seat used for Approve → Send LinkedIn delivery.
 * Prefer Browser Computer seats attached to the campaign (Campaign Agents),
 * then Vendor API with the same campaign bias (empty Vendor = shared pool).
 * Browser Computer empty assigned is NOT a fallback — match floor/setup attach.
 * Fail-closed when preferred is missing/unusable or N seats tie at the best rank
 * — never silently retarget another desk's VM/profile.
 */
export function pickLiveLinkedInSendSeat(
  seats: AgentSeat[],
  campaignId: string | null | undefined,
  preferredSeatId?: string | null,
): AgentSeat | undefined {
  if (preferredSeatId) {
    const preferred = seats.find(
      (x) =>
        x.id === preferredSeatId &&
        x.status === "active" &&
        x.mode === "live" &&
        isLinkedInAutomaticProvider(x.provider),
    );
    // Preferred was stamped on the draft — do not fall through to another seat.
    // Still refuse unattached / foreign-campaign BC (and non-attached Vendor).
    if (!preferred) return undefined;
    if (campaignId && !seatAttachedToCampaign(preferred, campaignId)) return undefined;
    return preferred;
  }

  const campaignRank = (seat: AgentSeat): number => {
    if (campaignId && seatAttachedToCampaign(seat, campaignId)) return 0;
    const assigned = seat.assignedCampaignIds ?? [];
    // Browser Computer: never treat empty as shared-pool fallback.
    if (isBrowserComputerSeat(seat)) return 2;
    if (assigned.length === 0) return 1;
    return 2;
  };

  const pickProvider = (
    provider: (typeof LINKEDIN_AUTOMATIC_PROVIDERS)[number],
  ): AgentSeat | undefined => {
    const live = seats.filter(
      (x) => x.status === "active" && x.mode === "live" && x.provider === provider,
    );
    if (live.length === 0) return undefined;
    let best = campaignRank(live[0]!);
    for (let i = 1; i < live.length; i += 1) {
      best = Math.min(best, campaignRank(live[i]!));
    }
    const winners = live.filter((x) => campaignRank(x) === best);
    // No campaign-eligible seat at this provider (best is "other campaign" / unattached BC).
    if (best >= 2) return undefined;
    // Unique winner only — N desks at the same campaign rank must not hash/sort-pick.
    return winners.length === 1 ? winners[0] : undefined;
  };

  for (const provider of LINKEDIN_AUTOMATIC_PROVIDERS) {
    const liveForProvider = seats.some(
      (x) => x.status === "active" && x.mode === "live" && x.provider === provider,
    );
    if (!liveForProvider) continue;
    // Provider has live seats: return unique winner, or undefined on tie (do not
    // fall through to a lower-ranked provider — that would silently change path).
    return pickProvider(provider);
  }
  return undefined;
}
