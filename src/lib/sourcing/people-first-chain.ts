/**
 * Never-0 harvest chain. Empty items=0 is next-search, not a result.
 * Each `search` call must start a real harvest. Tests mock `search` and
 * assert a second distinct run id — not plannedHarvests copy.
 */

import type { JobAnalysis } from "@/lib/types";
import {
  PEOPLE_FIRST_MAX_ATTEMPTS,
  peopleFirstHarvestQueue,
  type PlannedSearch,
} from "@/lib/sourcing/multi-source-plan";

export interface PeopleFirstSearchReceipt<T> {
  runId: string;
  started: boolean;
  itemCount: number;
  status: string;
  accepted: T[];
  /** Hard stop (auth, mock, missing key). Do not start the next harvest. */
  stop?: boolean;
}

export interface PeopleFirstHarvestAttempt {
  step: PlannedSearch;
  runId: string;
  started: boolean;
  itemCount: number;
  status: string;
  acceptedCount: number;
}

export async function runPeopleFirstHarvestChain<T>(input: {
  job: JobAnalysis;
  search: (step: PlannedSearch) => Promise<PeopleFirstSearchReceipt<T>>;
}): Promise<{
  attempts: PeopleFirstHarvestAttempt[];
  accepted: T[];
}> {
  const queue = peopleFirstHarvestQueue(input.job).slice(0, PEOPLE_FIRST_MAX_ATTEMPTS);
  const attempts: PeopleFirstHarvestAttempt[] = [];
  const accepted: T[] = [];
  for (const step of queue) {
    const result = await input.search(step);
    attempts.push({
      step,
      runId: result.runId,
      started: result.started,
      itemCount: result.itemCount,
      status: result.status,
      acceptedCount: result.accepted.length,
    });
    if (result.accepted.length > 0) {
      accepted.push(...result.accepted);
      break;
    }
    if (result.stop) break;
  }
  return { attempts, accepted };
}

export function harvestStepFromReceipt(attempt: PeopleFirstHarvestAttempt): PlannedSearch {
  return attempt.step;
}
