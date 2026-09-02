/**
 * After every planned harvestapi search returned items=0, the same click
 * keeps going, in the only order that can still produce real people:
 *
 *   1. LinkedIn web discovery (role + geo, site:linkedin.com/in), not another
 *      Calypso harvestapi string.
 *   2. Enrich: harvestapi/linkedin-profile-scraper (email search) on every
 *      LinkedIn URL we now hold: harvest rows that lacked email or phone,
 *      plus the web hits. This is the POST that yields email + phone.
 *   3. GitHub: apivault_labs/github-profile-scraper on handles that belong to
 *      people already accepted. Tech-stack merge only, never a shortlist.
 *
 * Fly 5728ad4 POSTed enrich first with `urls: []` and got `invalid-input`
 * (no run id), then searched the web with nobody left to enrich. An Apify
 * run needs at least one URL, so a step with nothing to send is logged as a
 * skip with its reason, never faked as a run. Do not invent people.
 */

import {
  GITHUB_STACK_ACTOR,
  HARVEST_ENRICH_ACTOR,
  logAriaHarvest,
} from "@/lib/sourcing/harvest-evidence";
import { harvestGeoTerms } from "@/lib/sourcing/multi-source-plan";
import type { JobAnalysis } from "@/lib/types";

export const LINKEDIN_WEB_ACTOR = "tavily~linkedin-web-search";

export interface FallthroughRunReceipt {
  actor: string;
  runId: string;
  started: boolean;
  status: string;
  /** Dataset rows the run wrote. -1 when the run never started. */
  itemCount: number;
  /** URLs or handles sent to the actor. 0 means the step was skipped. */
  sent: number;
  detail?: string;
}

export interface FallthroughDiscoveryReceipt {
  query: string;
  started: boolean;
  urls: string[];
  detail?: string;
}

export interface PeopleFirstFallthroughResult {
  alternateQuery: string;
  discovery: FallthroughDiscoveryReceipt;
  enrich: FallthroughRunReceipt;
  github: FallthroughRunReceipt;
  /** People that passed email + phone + LinkedIn and the ≥60 gate. */
  acceptedCount: number;
  /** Toast-safe evidence: run ids, items, and why a step was skipped. */
  logged: string;
}

export interface PeopleFirstFallthroughDeps {
  job: JobAnalysis;
  /** LinkedIn URLs from harvest rows that lacked email or phone. */
  poolUrls: string[];
  discoverLinkedin: (query: string) => Promise<{ ok: boolean; urls: string[]; detail?: string }>;
  enrichProfiles: (urls: string[]) => Promise<{
    ok: boolean;
    runId: string;
    status: string;
    itemCount: number;
    started: boolean;
    acceptedCount: number;
    detail?: string;
  }>;
  /** GitHub handles on people already accepted. */
  githubHandles: () => string[];
  mergeGithub: (handles: string[]) => Promise<{
    ok: boolean;
    runId: string;
    status: string;
    itemCount: number;
    started: boolean;
    detail?: string;
  }>;
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

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function skipped(actor: string, sent: number, detail: string): FallthroughRunReceipt {
  return { actor, runId: "", started: false, status: "SKIPPED", itemCount: -1, sent, detail };
}

/** `enrich=<run id> items=<n>` or `enrich=skipped (<why>)`. Actor names stay in logs. */
export function formatFallthroughEvidence(result: PeopleFirstFallthroughResult): string {
  const web = result.discovery.started
    ? `web=${result.discovery.query}:${result.discovery.urls.length}`
    : `web=${result.discovery.query}:not_started${result.discovery.detail ? ` (${result.discovery.detail})` : ""}`;
  const run = (label: string, receipt: FallthroughRunReceipt) => {
    if (receipt.runId) {
      const items = receipt.itemCount >= 0 ? ` items=${receipt.itemCount}` : ` status=${receipt.status}`;
      return `${label}=${receipt.runId}${items}`;
    }
    return `${label}=skipped${receipt.detail ? ` (${receipt.detail})` : ""}`;
  };
  return [web, run("enrich", result.enrich), run("github", result.github)].join(" ");
}

export async function runPeopleFirstEmptyFallthrough(
  input: PeopleFirstFallthroughDeps,
): Promise<PeopleFirstFallthroughResult> {
  const alternateQuery = peopleFirstAlternateQuery(input.job);
  const found = await input.discoverLinkedin(alternateQuery);
  const discovery: FallthroughDiscoveryReceipt = {
    query: alternateQuery,
    started: found.ok,
    urls: uniqueUrls(found.urls),
    ...(found.detail ? { detail: found.detail } : {}),
  };
  logAriaHarvest("alternate_search", {
    actor: LINKEDIN_WEB_ACTOR,
    query: alternateQuery,
    started: discovery.started,
    status: discovery.started ? "SUCCEEDED" : "NOT_STARTED",
    itemCount: discovery.started ? discovery.urls.length : -1,
    detail: discovery.detail ?? "LinkedIn web after harvestapi items=0, not another Calypso string",
  });

  const enrichUrls = uniqueUrls([...input.poolUrls, ...discovery.urls]);
  let enrich: FallthroughRunReceipt;
  let acceptedCount = 0;
  if (enrichUrls.length === 0) {
    const why = `nobody to enrich: harvest pool=0, web=${discovery.started ? discovery.urls.length : "not started"}`;
    enrich = skipped(HARVEST_ENRICH_ACTOR, 0, why);
    logAriaHarvest("enrich_skipped", {
      actor: HARVEST_ENRICH_ACTOR,
      query: "email-phone",
      started: false,
      status: "SKIPPED",
      itemCount: 0,
      detail: `${why}. Empty urls is an Apify invalid-input, not a run. Do not invent people.`,
    });
  } else {
    const run = await input.enrichProfiles(enrichUrls);
    acceptedCount += run.acceptedCount;
    enrich = {
      actor: HARVEST_ENRICH_ACTOR,
      runId: run.runId,
      started: run.started,
      status: run.status,
      itemCount: run.itemCount,
      sent: enrichUrls.length,
      ...(run.detail ? { detail: run.detail } : {}),
    };
  }

  const handles = input.githubHandles();
  let github: FallthroughRunReceipt;
  if (handles.length === 0) {
    const why = "no GitHub handle on the shortlist people; GitHub leftovers are not people";
    github = skipped(GITHUB_STACK_ACTOR, 0, why);
    logAriaHarvest("github_skipped", {
      actor: GITHUB_STACK_ACTOR,
      query: "tech-stack-merge",
      started: false,
      status: "SKIPPED",
      itemCount: 0,
      detail: why,
    });
  } else {
    const run = await input.mergeGithub(handles);
    github = {
      actor: GITHUB_STACK_ACTOR,
      runId: run.runId,
      started: run.started,
      status: run.status,
      itemCount: run.itemCount,
      sent: handles.length,
      ...(run.detail ? { detail: run.detail } : {}),
    };
  }

  const result: PeopleFirstFallthroughResult = {
    alternateQuery,
    discovery,
    enrich,
    github,
    acceptedCount,
    logged: "",
  };
  result.logged = formatFallthroughEvidence(result);
  return result;
}

/** Run ids the click logged, read back from the fail-loud copy. `skipped` is not a run. */
export function parseEnrichmentRunIds(error: string): {
  enrichRunId?: string;
  githubRunId?: string;
} {
  const pick = (label: string) => {
    const value = error.match(new RegExp(`\\b${label}=([A-Za-z0-9._:-]+)`))?.[1];
    return value && value !== "skipped" ? value : undefined;
  };
  return { enrichRunId: pick("enrich"), githubRunId: pick("github") };
}
