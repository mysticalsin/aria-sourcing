import type { HermesState } from "../types";

/**
 * Browser-local demo persistence.
 *
 * Synthetic Talent Pool records are always allowed. Live LinkedIn/GitHub/web
 * profiles are also allowed in demo so operators can run LinkedIn-first E2E
 * without Supabase — they stay in localStorage only.
 *
 * Unknown/missing provenance still fails closed.
 */
export function demoStateAllowsCandidatePersistence(state: HermesState): boolean {
  return state.candidates.every(
    (candidate) => candidate.provenance === "synthetic" || candidate.provenance === "live",
  );
}
