/**
 * Align shortlist → allocateBatch → automatic per-seat LinkedIn deliver planning.
 * Pure helpers — store/dispatcher perform side effects.
 *
 * Contact exclusivity remains allocateBatch ledger + Postgres claim_contact.
 * Knowledge plane may only supply draft context strings.
 */

import { allocateBatch } from "@/lib/fleet";
import {
  isLinkedInAutomaticProvider,
  preferLinkedInAutomaticSeats,
} from "@/lib/linkedin-automatic";
import type {
  AgentSeat,
  AllocationResult,
  Candidate,
  FleetSettings,
  OutreachLedgerEntry,
  SuppressionEntry,
} from "@/lib/types";

export { preferLinkedInAutomaticSeats } from "@/lib/linkedin-automatic";

export type AutomaticDeliverPlan = {
  allocation: AllocationResult;
  automaticLinkedIn: AllocationResult["assignments"];
  other: AllocationResult["assignments"];
  deliveryModeAutomatic: boolean;
};

export function planShortlistAutomaticDeliver(opts: {
  pool: Candidate[];
  seats: AgentSeat[];
  ledger: OutreachLedgerEntry[];
  suppression: SuppressionEntry[];
  fleet: FleetSettings;
  deliveryMode?: string | null;
  now?: Date;
}): AutomaticDeliverPlan {
  const deliveryModeAutomatic = opts.deliveryMode !== "manual";
  const seats = preferLinkedInAutomaticSeats(opts.seats, opts.pool);
  const allocation = allocateBatch(
    opts.pool,
    seats,
    opts.ledger,
    opts.suppression,
    opts.fleet,
    opts.now ?? new Date(),
  );

  const bySeat = new Map(opts.seats.map((s) => [s.id, s]));
  const automaticLinkedIn: AllocationResult["assignments"] = [];
  const other: AllocationResult["assignments"] = [];

  for (const a of allocation.assignments) {
    const seat = bySeat.get(a.seatId);
    const cand = opts.pool.find((c) => c.id === a.candidateId);
    const url = (cand?.linkedinUrl ?? "").trim();
    if (deliveryModeAutomatic && seat && isLinkedInAutomaticProvider(seat.provider) && url) {
      automaticLinkedIn.push(a);
    } else {
      other.push(a);
    }
  }

  return { allocation, automaticLinkedIn, other, deliveryModeAutomatic };
}

