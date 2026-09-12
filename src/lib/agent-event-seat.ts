/**
 * Floor FX seat attribution for N Browser Computer desks.
 * Source waves pulse every attached LI Browser desk (allocate-style) so N-seat
 * campaigns stay visible without hash-picking a single owner. Draft/send still
 * use soleCampaignBrowserSeatId / msg.seatId. PacketFX and the floor page
 * fail-closed without seatId (no hash bleed).
 */

import type { AgentSeat, OutreachMessage } from "@/lib/types";

/** Active LinkedIn Browser Computer seats that own (or share) this campaign. */
export function campaignBrowserSeatIds(
  seats: AgentSeat[],
  campaignId: string,
): string[] {
  return seats
    .filter((seat) => {
      if (seat.status !== "active") return false;
      if (seat.provider !== "LinkedIn Browser Computer") return false;
      const assigned = seat.assignedCampaignIds ?? [];
      return assigned.length === 0 || assigned.includes(campaignId);
    })
    .map((seat) => seat.id);
}

/** Exactly one LI Browser seat → safe sole stamp; otherwise undefined (fail-closed). */
export function soleCampaignBrowserSeatId(
  seats: AgentSeat[],
  campaignId: string,
): string | undefined {
  const li = campaignBrowserSeatIds(seats, campaignId);
  return li.length === 1 ? li[0] : undefined;
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
