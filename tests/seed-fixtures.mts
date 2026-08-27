/**
 * Test fixtures — historical demo world with sourced candidates.
 * Default buildSeedState() is a clean slate (zero candidates); use these when
 * a test needs realistic candidate/campaign fixtures.
 */
import { buildHistoricalDemoSeedState } from "../src/lib/seed";
import type { Candidate, HermesState } from "../src/lib/types";

export function historicalSeedState(): HermesState {
  return buildHistoricalDemoSeedState();
}

export function historicalCandidate(): Candidate {
  const candidate = buildHistoricalDemoSeedState().candidates[0];
  if (!candidate) throw new Error("historical demo seed must include candidates");
  return candidate;
}
