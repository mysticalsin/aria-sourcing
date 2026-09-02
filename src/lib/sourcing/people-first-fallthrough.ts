/**
 * After the 8-query LinkedIn harvest chain returns items=0, the same click
 * must start enrich + GitHub scrapers and log those run ids. enrichCampaign
 * is gated on existing LinkedIn URLs — that is a no-op on items=0 and is
 * why Fly 510c950 showed zero enrich/github audit rows.
 *
 * Do not invent people. GitHub leftovers are not the shortlist.
 */

import {
  GITHUB_STACK_ACTOR,
  HARVEST_ENRICH_ACTOR,
  formatEnrichmentRunIds,
  logAriaHarvest,
} from "@/lib/sourcing/harvest-evidence";
import {
  harvestGeoTerms,
  peopleFirstHarvestQueue,
  peopleFirstSearchKey,
  type PlannedSearch,
} from "@/lib/sourcing/multi-source-plan";
import type { JobAnalysis } from "@/lib/types";

export interface EnrichmentRunReceipt {
  actor: string;
  runId: string;
  started: boolean;
  status: string;
}

export interface PeopleFirstFallthroughResult {
  enrich: EnrichmentRunReceipt;
  github: EnrichmentRunReceipt;
  alternateQuery: string;
  acceptedCount: number;
  logged: string;
}

export type FallthroughActorStart = () => Promise<
  { ok: true; runId: string; status: string } | { ok: false; status: string }
>;

export function isLastPeopleFirstHarvest(
  job: JobAnalysis,
  step: Pick<PlannedSearch, "query" | "currentJobTitles">,
): boolean {
  const last = peopleFirstHarvestQueue(job).at(-1);
  return Boolean(last && peopleFirstSearchKey(last) === peopleFirstSearchKey(step));
}

/**
 * Non-Calypso alternate discovery after harvestapi is exhausted.
 * LinkedIn web search (site:linkedin.com/in), not another harvestapi string.
 */
export function peopleFirstAlternateQuery(job: JobAnalysis): string {
  const geo = harvestGeoTerms(job)[0] ?? "";
  if (/\bbusiness analyst\b|\bba\b/i.test(job.title)) {
    return geo ? `Business Analyst ${geo}` : "Business Analyst";
  }
  if (/\bapplication support\b|\bapp(?:licative)? support\b/i.test(job.title)) {
    return geo ? `Application Support ${geo}` : "Application Support";
  }
  const role = job.title.replace(/\b(senior|junior|lead|principal)\b/gi, "").trim();
  const query = geo ? `${role} ${geo}` : role;
  return query.slice(0, 256).trim();
}

function receipt(
  actor: string,
  run: { runId: string; started: boolean; status: string },
): EnrichmentRunReceipt {
  return { actor, runId: run.runId, started: run.started, status: run.status };
}

export async function runPeopleFirstEmptyFallthrough(input: {
  job: JobAnalysis;
  startEnrich: FallthroughActorStart;
  startGithub: FallthroughActorStart;
  alternateSearch?: (query: string) => Promise<{ acceptedCount: number }>;
}): Promise<PeopleFirstFallthroughResult> {
  const enrichStart = await input.startEnrich();
  const githubStart = await input.startGithub();
  const enrich = receipt(HARVEST_ENRICH_ACTOR, {
    runId: enrichStart.ok ? enrichStart.runId : "",
    started: Boolean(enrichStart.ok && enrichStart.runId),
    status: enrichStart.status,
  });
  const github = receipt(GITHUB_STACK_ACTOR, {
    runId: githubStart.ok ? githubStart.runId : "",
    started: Boolean(githubStart.ok && githubStart.runId),
    status: githubStart.status,
  });
  logAriaHarvest("enrich_started", {
    actor: HARVEST_ENRICH_ACTOR,
    query: "email-phone",
    runId: enrich.runId,
    started: enrich.started,
    status: enrich.status,
    itemCount: 0,
    detail: "empty LinkedIn harvest is not terminal",
  });
  logAriaHarvest("github_started", {
    actor: GITHUB_STACK_ACTOR,
    query: "tech-stack-merge",
    runId: github.runId,
    started: github.started,
    status: github.status,
    itemCount: 0,
    detail: "merge onto the same people, never a leftover shortlist",
  });
  const alternateQuery = peopleFirstAlternateQuery(input.job);
  let acceptedCount = 0;
  if (input.alternateSearch) {
    const alternate = await input.alternateSearch(alternateQuery);
    acceptedCount = alternate.acceptedCount;
  }
  return {
    enrich,
    github,
    alternateQuery,
    acceptedCount,
    logged: formatEnrichmentRunIds(enrich, github),
  };
}

export function parseEnrichmentRunIds(error: string): {
  enrichRunId?: string;
  githubRunId?: string;
} {
  return {
    enrichRunId: error.match(/\benrich=([A-Za-z0-9._:-]+)/)?.[1],
    githubRunId: error.match(/\bgithub=([A-Za-z0-9._:-]+)/)?.[1],
  };
}
