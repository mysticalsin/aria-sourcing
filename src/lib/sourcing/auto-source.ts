/**
 * Auto source: one unattended chain. Search until a real shortlist, then
 * enrich and merge. Actors stay in the backend. Do not invent people.
 */

import type { SourceNextBatchResult } from "@/lib/store/contracts";
import { EMPTY_PEOPLE_FIRST_HARVEST, isPeopleFirstRole } from "@/lib/sourcing/people-plugins";
import type { JobAnalysis } from "@/lib/types";
import { roleProfile } from "@/lib/roles";

export interface AutoSourceEnrichResult {
  ok: boolean;
  error?: string;
}

export async function runAutoSourcePipeline(input: {
  job: JobAnalysis;
  search: () => Promise<SourceNextBatchResult>;
  enrich: () => Promise<AutoSourceEnrichResult>;
  mergeTechStack?: () => Promise<void>;
}): Promise<SourceNextBatchResult & { enriched?: boolean; techStackMerged?: boolean }> {
  const search = await input.search();
  if (!search.ok) return search;
  if (search.accepted.length === 0) {
    return {
      ok: false,
      error: isPeopleFirstRole(input.job)
        ? EMPTY_PEOPLE_FIRST_HARVEST
        : "Empty harvest is not a result. Do not stop at 0 people.",
      source: "unavailable",
    };
  }
  const enrich = await input.enrich();
  if (!enrich.ok && enrich.error) {
    return { ...search, enriched: false };
  }
  let techStackMerged = false;
  if (roleProfile(input.job).queryStyle === "github" && input.mergeTechStack) {
    await input.mergeTechStack();
    techStackMerged = true;
  }
  return { ...search, enriched: true, techStackMerged };
}
