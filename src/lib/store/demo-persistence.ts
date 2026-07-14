import type { HermesState } from "../types";

/**
 * Browser-local demo persistence is intentionally limited to records that are
 * explicitly marked synthetic. Missing provenance fails closed because older
 * or externally injected records cannot be proven safe to retain in cleartext.
 */
export function demoStateAllowsCandidatePersistence(state: HermesState): boolean {
  return state.candidates.every((candidate) => candidate.provenance === "synthetic");
}
