/**
 * Client-safe LinkedIn automatic delivery helpers.
 * Keep this free of server-only imports — the Zustand store imports it.
 */

import type { AgentSeat, Candidate } from "@/lib/types";

/** Providers that may send when deliveryMode is automatic (never assisted-manual). */
export const LINKEDIN_AUTOMATIC_PROVIDERS = [
  "LinkedIn Vendor API",
  "LinkedIn Browser Computer",
] as const;

export function isLinkedInAutomaticProvider(provider: string | null | undefined): boolean {
  return LINKEDIN_AUTOMATIC_PROVIDERS.includes(
    provider as (typeof LINKEDIN_AUTOMATIC_PROVIDERS)[number],
  );
}

/** Prefer active automatic LinkedIn seats when the pool has LinkedIn profile URLs. */
export function preferLinkedInAutomaticSeats(
  seats: AgentSeat[],
  pool: Array<Pick<Candidate, "linkedinUrl">> | Pick<Candidate, "linkedinUrl">,
): AgentSeat[] {
  const list = Array.isArray(pool) ? pool : [pool];
  if (!list.some((c) => (c.linkedinUrl ?? "").trim())) return seats;
  const auto = seats.filter((s) => s.status === "active" && isLinkedInAutomaticProvider(s.provider));
  if (auto.length === 0) return seats;
  const rest = seats.filter((s) => !auto.some((a) => a.id === s.id));
  return [...auto, ...rest];
}
