/**
 * Lab fixture people are recorded matcher evidence, not LinkedIn.
 * Fly / live workspaces must not hydrate or display them.
 */
import { isSyntheticRecipientEmail } from "@/lib/sourcing/people-connect";
import type { HermesState } from "@/lib/types";

export const FIXTURE_NOT_ON_LIVE = "FIXTURE_NOT_ON_LIVE";

export const FIXTURE_NOT_ON_LIVE_TOAST =
  "Lab fixtures are not LinkedIn. Connect a real Apify key and switch the card to Live.";

export const FIXTURE_NOT_ON_LIVE_PATHS = [
  "Connect Apify in Access & Keys and switch the card to Live.",
  "Source next batch runs harvestapi Full only — lab fixtures are not LinkedIn.",
  "Do not POST mode=fixture on Fly.",
] as const;

export function isLabFixtureCandidate(candidate: {
  email?: string;
  provenance?: string;
}): boolean {
  if (candidate.provenance === "synthetic") return true;
  if (candidate.email && isSyntheticRecipientEmail(candidate.email)) return true;
  return false;
}

export function liveVisibleCandidates<T extends { email?: string; provenance?: string }>(
  candidates: readonly T[],
): T[] {
  return candidates.filter((candidate) => !isLabFixtureCandidate(candidate));
}

export function stripLabFixturePeople(state: HermesState): {
  state: HermesState;
  removedIds: string[];
  campaignIds: string[];
} {
  const removed = state.candidates.filter(isLabFixtureCandidate);
  if (removed.length === 0) {
    return { state, removedIds: [], campaignIds: [] };
  }
  const removedIds = new Set(removed.map((candidate) => candidate.id));
  const campaignIds = [...new Set(removed.map((candidate) => candidate.campaignId).filter(Boolean))];
  return {
    state: {
      ...state,
      candidates: state.candidates.filter((candidate) => !removedIds.has(candidate.id)),
      outreach: state.outreach.filter((message) => !removedIds.has(message.candidateId)),
    },
    removedIds: [...removedIds],
    campaignIds,
  };
}
