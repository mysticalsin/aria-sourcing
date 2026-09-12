/**
 * Floor FX seat attribution for N Browser Computer desks.
 * Campaign-level source only attributes when exactly one LI Browser seat owns
 * the campaign; replies use the latest outreach seat. Omit otherwise — PacketFX
 * and the floor page already fail-closed without seatId (no hash bleed).
 */

import type { AgentSeat, OutreachMessage } from "@/lib/types";

export function soleCampaignBrowserSeatId(
  seats: AgentSeat[],
  campaignId: string,
): string | undefined {
  const li = seats.filter((seat) => {
    if (seat.status !== "active") return false;
    if (seat.provider !== "LinkedIn Browser Computer") return false;
    const assigned = seat.assignedCampaignIds ?? [];
    return assigned.length === 0 || assigned.includes(campaignId);
  });
  return li.length === 1 ? li[0]!.id : undefined;
}

export function latestOutreachSeatId(
  outreach: OutreachMessage[],
  candidateId: string,
): string | undefined {
  for (let i = outreach.length - 1; i >= 0; i -= 1) {
    const m = outreach[i]!;
    if (m.candidateId === candidateId && m.seatId) return m.seatId;
  }
  return undefined;
}
