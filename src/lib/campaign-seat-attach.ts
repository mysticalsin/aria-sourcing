/**
 * Campaign ↔ seat attach rules for N-agent isolation.
 * LinkedIn Browser Computer desks require explicit assignedCampaignIds
 * (same contract as floor / setup / go-live). Other providers keep empty =
 * shared pool.
 */

import type { AgentSeat } from "@/lib/types";

export function isBrowserComputerSeat(
  seat: Pick<AgentSeat, "provider" | "linkedinDeliveryBackend">,
): boolean {
  return (
    seat.provider === "LinkedIn Browser Computer" ||
    seat.linkedinDeliveryBackend === "browser-computer"
  );
}

/** True when this seat may draft/send/pulse for the campaign. */
export function seatAttachedToCampaign(
  seat: Pick<AgentSeat, "provider" | "linkedinDeliveryBackend" | "assignedCampaignIds">,
  campaignId: string,
): boolean {
  const assigned = seat.assignedCampaignIds ?? [];
  if (isBrowserComputerSeat(seat)) return assigned.includes(campaignId);
  return assigned.length === 0 || assigned.includes(campaignId);
}
