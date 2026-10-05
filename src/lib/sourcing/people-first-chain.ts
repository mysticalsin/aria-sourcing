/**
 * One Source click is one server-owned chain. The client POSTs once; the
 * server runs every planned harvest, then LinkedIn web, enrich, and GitHub
 * merge. The client re-POSTs only when the server answers
 * PEOPLE_FIRST_HARVEST_CONTINUE with a `resume` step (chain budget ran out
 * with planned harvests left). Any other error is the click's honest result.
 *
 * Why not one harvest per request: Fly 5728ad4 burned 8 sourcing runs per
 * click (quota 10/day, limiter 10/min) and the next click was rate-limited.
 * A rate limit is FAIL, never "done". Do not invent people.
 */

import type { JobAnalysis } from "@/lib/types";
import {
  peopleFirstHarvestQueue,
  peopleFirstSearchKey,
  type PlannedSearch,
} from "@/lib/sourcing/multi-source-plan";

export interface ResumeStep {
  query: string;
  currentJobTitles?: string[];
}

export type ClickChainSearchResult =
  | { ok: true }
  | { ok: false; error: string; resume?: ResumeStep };

export interface ClickChainReceipt<T> {
  result: T;
  /** HTTP requests this click made. 1 unless the server asked to continue. */
  requests: number;
  resumes: PlannedSearch[];
}

/**
 * Drive the click. `search(null)` starts the chain; `search(step)` resumes it.
 * Resume steps must be on the reviewed queue and move forward, so a stale or
 * replayed response cannot loop the chain or desync a second click.
 */
export async function runPeopleFirstClickChain<T extends ClickChainSearchResult>(input: {
  job: JobAnalysis;
  search: (resume: PlannedSearch | null) => Promise<T>;
}): Promise<ClickChainReceipt<T>> {
  const queue = peopleFirstHarvestQueue(input.job);
  const resumes: PlannedSearch[] = [];
  // The first POST already covers step 0. A resume must point past it.
  let cursor = 0;
  let resume: PlannedSearch | null = null;
  let result = await input.search(null);
  let requests = 1;
  while (!result.ok && result.resume && requests <= queue.length) {
    const key = peopleFirstSearchKey(result.resume);
    const index = queue.findIndex((step) => peopleFirstSearchKey(step) === key);
    if (index < 0 || index <= cursor) break;
    cursor = index;
    resume = queue[index] ?? null;
    if (!resume) break;
    resumes.push(resume);
    result = await input.search(resume);
    requests += 1;
  }
  return { result, requests, resumes };
}
