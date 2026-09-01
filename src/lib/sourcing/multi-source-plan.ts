/**
 * Reviewed multi-source search plan. Uses only persisted campaign queries
 * (LinkedIn boolean, GitHub queries) plus the reviewed Skill (Must) list.
 * Does not invent a GitHub language: qualifier from a skill.
 */

import { roleProfile } from "@/lib/roles";
import { GITHUB_SEARCH_LANGUAGES } from "@/lib/sourcing/github-search-language";
import { repairLinkedinBoolean } from "@/lib/sourcing/linkedin-boolean";
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";
import type { JobAnalysis, SourcePlatform, SourcingStrategy } from "@/lib/types";

export interface PlannedSearch {
  platform: SourcePlatform;
  query: string;
  /** harvestapi title filter. Next actor-input when keyword AND returned 0. */
  currentJobTitles?: string[];
}

/** One harvestapi poll. Next-search after items=0 gets a fresh timer. */
export const PEOPLE_FIRST_ATTEMPT_WAIT_MS = 90_000;
/** Planned harvestapi attempts until a real shortlist. */
export const PEOPLE_FIRST_MAX_ATTEMPTS = 4;
/**
 * One Source click must run every planned harvest. A shared 90s abort is
 * 0-and-stop: the first SUCCEEDED items=0 consumes the budget and harvest 2
 * never starts (Ultron Fly d99e772 v212).
 */
export const PEOPLE_FIRST_SEARCH_BUDGET_MS =
  PEOPLE_FIRST_ATTEMPT_WAIT_MS * PEOPLE_FIRST_MAX_ATTEMPTS;

/** Distinctive trading-platform tokens. These are skills / need words, never people. */
const NEED_PLATFORM_TOKENS = [
  "Calypso",
  "Murex",
  "Summit",
  "Kondor",
  "Sophis",
  "Front Arena",
  "Aladdin",
  "Fidessa",
] as const;

function usefulGithubQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 3 || trimmed.length > 256) return false;
  const languages = [...trimmed.matchAll(/(?:^|\s)language:([A-Za-z0-9+#.\-]+)/gi)].map(
    (match) => (match[1] ?? "").replace(/\s+/g, "").toLowerCase(),
  );
  if (languages.some((language) => !GITHUB_SEARCH_LANGUAGES.has(language))) return false;
  return true;
}

function distinctiveNeedPlatform(job: JobAnalysis): string {
  const hay = [job.title, ...job.requiredSkills, ...job.industryExperience].join(" ").toLowerCase();
  return NEED_PLATFORM_TOKENS.find((token) => hay.includes(token.toLowerCase())) ?? "";
}

/** Title role for harvest keywords. BA leftover VSS says "Business Analysis". */
function harvestKeywordRoleFromTitle(title: string): string {
  if (/\bbusiness analyst\b|\bba\b/i.test(title)) return "Business Analyst";
  return "";
}

/** harvestapi `currentJobTitles` after a keyword AND returned 0. */
function harvestTitleFilterFromTitle(title: string): string {
  if (/\bbusiness analyst\b|\bba\b/i.test(title)) return "Business Analyst";
  if (/\bapplication support\b|\bapp(?:licative)? support\b/i.test(title)) return "Application Support";
  if (/\bsupport analyst\b/i.test(title)) return "Support Analyst";
  return "";
}

export function peopleFirstSearchKey(step: Pick<PlannedSearch, "query" | "currentJobTitles">): string {
  return `${step.query.trim().toLowerCase()}|${(step.currentJobTitles ?? []).map((title) => title.toLowerCase()).join(",")}`;
}

/** VSS project-type / low-recall chips. Do not AND these as harvest keywords. */
function skipHarvestExtra(skill: string): boolean {
  return /^(business analysis|mysql)$/i.test(skill.trim());
}

/**
 * harvestapi `searchQuery` is keywords (typically AND), not a LinkedIn boolean.
 * Distinctive platform + first two non-platform Skill (Must) chips, skipping
 * VSS project-type / MySQL leftovers. BA-shaped titles add Business Analyst.
 * Application Support stays `Calypso Linux Python`.
 */
export function apifyHarvestQueryFromBrief(job: JobAnalysis): string {
  const skills = tokenizeMustHaveSkills(job.requiredSkills);
  const platform = distinctiveNeedPlatform(job);
  const role = harvestKeywordRoleFromTitle(job.title);
  const extra = skills
    .filter((skill) => !platform || skill.toLowerCase() !== platform.toLowerCase())
    .filter((skill) => !skipHarvestExtra(skill))
    .filter((skill) => !role || skill.toLowerCase() !== role.toLowerCase());
  const tokens = (platform ? [platform, role, ...extra] : [role, ...skills])
    .filter(Boolean)
    .slice(0, 3);
  return tokens.join(" ").slice(0, 256).trim();
}

/** LinkedIn-attested leftover VSS chip. Use only as a broaden after the title-role query returns 0. */
function linkedinAttestedHarvestExtra(skill: string): boolean {
  return /^business analysis$/i.test(skill.trim());
}

/**
 * Ordered harvestapi `searchQuery` strings. Primary stays the title-role
 * query (`Calypso Business Analyst` / `Calypso Linux Python`). After an
 * honest 0, broaden to a LinkedIn-attested skill or drop the last AND
 * token, then the platform alone. Never invent people. Cap 3.
 */
export function peopleFirstHarvestQueries(job: JobAnalysis): string[] {
  const primary = apifyHarvestQueryFromBrief(job);
  const platform = distinctiveNeedPlatform(job);
  const attested = tokenizeMustHaveSkills(job.requiredSkills).find(linkedinAttestedHarvestExtra);
  const tokens = primary.split(/\s+/).filter(Boolean);
  const dropLast = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : "";
  const attestedQuery = platform && attested ? `${platform} ${attested}` : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of [primary, attestedQuery || dropLast, platform, dropLast]) {
    const next = query.trim().slice(0, 256);
    const key = next.toLowerCase();
    if (!next || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * harvestapi attempts until a real shortlist. First query stays the
 * title-role phrase. After `items=0`, next actor-input is platform
 * keywords + currentJobTitles, then broader phrases. Never 0-and-stop.
 * A one-item plan is FAIL: Ultron Fly a05cf5a ran only
 * `Calypso Business Analyst` and treated the plan as exhausted.
 */
export function peopleFirstHarvestAttempts(job: JobAnalysis): PlannedSearch[] {
  const attempts: PlannedSearch[] = [];
  const seen = new Set<string>();
  const push = (query: string, currentJobTitles?: string[]) => {
    const trimmed = query.trim().slice(0, 256);
    const key = peopleFirstSearchKey({ query: trimmed, currentJobTitles });
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    attempts.push({
      platform: "Apify",
      query: trimmed,
      ...(currentJobTitles?.length ? { currentJobTitles } : {}),
    });
  };
  const primary = apifyHarvestQueryFromBrief(job);
  const platform = distinctiveNeedPlatform(job);
  const titleFilter = harvestTitleFilterFromTitle(job.title);
  const attested = tokenizeMustHaveSkills(job.requiredSkills).find(linkedinAttestedHarvestExtra);
  push(primary);
  if (platform && titleFilter) push(platform, [titleFilter]);
  for (const query of peopleFirstHarvestQueries(job)) push(query);
  if (attempts.length < 2 && platform && attested) push(`${platform} ${attested}`);
  if (attempts.length < 2 && primary) {
    const tokens = primary.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      if (titleFilter) push(tokens[0] ?? "", [titleFilter]);
      if (attempts.length < 2) push(tokens.slice(0, -1).join(" "));
    } else if (titleFilter) {
      push(primary, [titleFilter]);
    }
  }
  return attempts.slice(0, PEOPLE_FIRST_MAX_ATTEMPTS);
}

/**
 * Next harvestapi search after the ones already started. Used when
 * `plannedSourcingSearches` collapsed to one Apify step — the Source
 * click must still enqueue a broader query / next actor-input.
 */
export function nextPeopleFirstHarvest(
  job: JobAnalysis,
  alreadyTried: readonly Pick<PlannedSearch, "query" | "currentJobTitles">[],
): PlannedSearch | null {
  const tried = new Set(alreadyTried.map((step) => peopleFirstSearchKey(step)));
  return peopleFirstHarvestAttempts(job).find((step) => !tried.has(peopleFirstSearchKey(step))) ?? null;
}

/** Queue the Source click actually runs. Never a one-item Apify plan. */
export function peopleFirstHarvestQueue(job: JobAnalysis): PlannedSearch[] {
  return peopleFirstHarvestAttempts(job);
}

function apifyQueryFromLinkedinPlan(job: JobAnalysis, linkedinBoolean: string): string {
  if (!linkedinBoolean.trim()) return "";
  return apifyHarvestQueryFromBrief(job) || linkedinBoolean.trim().slice(0, 256);
}

/** Ordered searches: people-first Apify harvest first; else LinkedIn then Apify. */
export function plannedSourcingSearches(input: {
  jobAnalysis: JobAnalysis;
  sourcingStrategy: Pick<SourcingStrategy, "githubQueries" | "linkedinBoolean">;
}): PlannedSearch[] {
  const peopleFirst = roleProfile(input.jobAnalysis).queryStyle === "linkedin";
  const linkedin = repairLinkedinBoolean(
    input.jobAnalysis,
    input.sourcingStrategy.linkedinBoolean,
  ).trim();
  const allowGithub = roleProfile(input.jobAnalysis).platforms.includes("GitHub");
  const github = allowGithub
    ? input.sourcingStrategy.githubQueries
        .map((item) => item.query.trim())
        .filter(usefulGithubQuery)
    : [];
  const apify = peopleFirst
    ? ""
    : apifyQueryFromLinkedinPlan(input.jobAnalysis, linkedin);
  const plan: PlannedSearch[] = [];
  if (peopleFirst) {
    plan.push(...peopleFirstHarvestAttempts(input.jobAnalysis));
    if (linkedin) plan.push({ platform: "LinkedIn", query: linkedin });
  } else {
    if (linkedin) plan.push({ platform: "LinkedIn", query: linkedin });
    if (apify) plan.push({ platform: "Apify", query: apify });
  }
  for (const query of github) {
    if (!plan.some((step) => step.platform === "GitHub" && step.query === query)) {
      plan.push({ platform: "GitHub", query });
    }
  }
  return plan.slice(0, 6);
}
