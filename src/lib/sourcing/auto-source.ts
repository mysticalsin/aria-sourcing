/**
 * Auto source: one unattended chain. Search until a real shortlist, then
 * enrich and merge. Empty first harvest is next-search, not a stop.
 * Actors stay in the backend. Do not invent people.
 */

import type { SourceNextBatchResult } from "@/lib/store/contracts";
import { EMPTY_PEOPLE_FIRST_HARVEST, isPeopleFirstRole } from "@/lib/sourcing/people-plugins";
import { runPeopleFirstHarvestChain } from "@/lib/sourcing/people-first-chain";
import type { PlannedSearch } from "@/lib/sourcing/multi-source-plan";
import type { JobAnalysis } from "@/lib/types";
import { roleProfile } from "@/lib/roles";

export interface AutoSourceEnrichResult {
  ok: boolean;
  error?: string;
}

function isHardSearchStop(result: SourceNextBatchResult): boolean {
  if (result.ok) return false;
  const error = result.error;
  if (/Empty harvest is not a result|Next planned search must start|every planned search was tried/i.test(error)) {
    return false;
  }
  return true;
}

export async function runAutoSourcePipeline(input: {
  job: JobAnalysis;
  search: (step: PlannedSearch) => Promise<SourceNextBatchResult>;
  enrich: () => Promise<AutoSourceEnrichResult>;
  mergeTechStack?: () => Promise<void>;
}): Promise<SourceNextBatchResult & { enriched?: boolean; techStackMerged?: boolean }> {
  const searches: SourceNextBatchResult[] = [];
  const chain = await runPeopleFirstHarvestChain({
    job: input.job,
    search: async (step) => {
      const result = await input.search(step);
      searches.push(result);
      if (result.ok && result.accepted.length > 0) {
        return {
          runId: `accepted-${step.query}`,
          started: true,
          itemCount: result.accepted.length,
          status: "SUCCEEDED",
          accepted: result.accepted,
        };
      }
      const runIdMatch = !result.ok ? result.error.match(/\brun=([A-Za-z0-9._:-]+)/) : null;
      return {
        runId: runIdMatch?.[1] ?? "",
        started: Boolean(runIdMatch?.[1] || result.ok),
        itemCount: 0,
        status: result.ok ? "SUCCEEDED" : "EMPTY",
        accepted: [],
        stop: isHardSearchStop(result),
      };
    },
  });
  const last = searches.at(-1) ?? null;
  const hit = searches.find((result) => result.ok && result.accepted.length > 0);
  if (chain.accepted.length > 0 && hit && hit.ok) {
    const enrich = await input.enrich();
    let techStackMerged = false;
    if (roleProfile(input.job).queryStyle === "github" && input.mergeTechStack) {
      await input.mergeTechStack();
      techStackMerged = true;
    }
    return { ...hit, enriched: Boolean(enrich.ok || !enrich.error), techStackMerged };
  }
  if (last && !last.ok && isHardSearchStop(last)) return last;
  return {
    ok: false,
    error: isPeopleFirstRole(input.job)
      ? EMPTY_PEOPLE_FIRST_HARVEST
      : "Empty harvest is not a result. Do not stop at 0 people.",
    source: "unavailable",
  };
}
