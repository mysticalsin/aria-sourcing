/**
 * Auto source: one unattended click. The server runs the harvest chain
 * (search until a real shortlist, then LinkedIn web, enrich, GitHub merge).
 * This side only runs the per-person enrichment waterfall on people that
 * actually landed. 0 people is never a success. Do not invent people.
 */

import type { SourceNextBatchResult } from "@/lib/store/contracts";
import { parseEnrichmentRunIds } from "@/lib/sourcing/people-first-fallthrough";
import { EMPTY_PEOPLE_FIRST_HARVEST, isPeopleFirstRole } from "@/lib/sourcing/people-plugins";
import type { JobAnalysis } from "@/lib/types";

export interface AutoSourceEnrichResult {
  ok: boolean;
  error?: string;
}

export type AutoSourceResult = SourceNextBatchResult & {
  enriched?: boolean;
  techStackMerged?: boolean;
  enrichRunId?: string;
  githubRunId?: string;
};

export async function runAutoSourcePipeline(input: {
  job: JobAnalysis;
  /** The click chain: one POST, re-POST only on PEOPLE_FIRST_HARVEST_CONTINUE. */
  search: () => Promise<SourceNextBatchResult>;
  enrich: () => Promise<AutoSourceEnrichResult>;
  mergeTechStack?: () => Promise<void>;
}): Promise<AutoSourceResult> {
  const result = await input.search();
  if (!result.ok) {
    // Rate limit, quota, mock, not started, empty after the whole chain:
    // all FAIL. Never dress a failed chain as enriched.
    return { ...result, enriched: false, techStackMerged: false, ...parseEnrichmentRunIds(result.error) };
  }
  if (result.accepted.length === 0) {
    return {
      ok: false,
      error: isPeopleFirstRole(input.job)
        ? EMPTY_PEOPLE_FIRST_HARVEST
        : "Empty harvest is not a result. Do not stop at 0 people.",
      source: "unavailable",
      enriched: false,
      techStackMerged: false,
    };
  }
  const enrich = await input.enrich();
  let techStackMerged = false;
  if (input.mergeTechStack) {
    await input.mergeTechStack();
    techStackMerged = true;
  }
  return { ...result, enriched: Boolean(enrich.ok || !enrich.error), techStackMerged };
}
