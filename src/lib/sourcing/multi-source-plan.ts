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

/** People-first Source next batch: poll harvestapi Full until terminal. */
export const PEOPLE_FIRST_SEARCH_BUDGET_MS = 90_000;

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
function harvestRoleFromTitle(title: string): string {
  if (/\bbusiness analyst\b|\bba\b/i.test(title)) return "Business Analyst";
  return "";
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
  const role = harvestRoleFromTitle(job.title);
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
 */
export function peopleFirstHarvestAttempts(job: JobAnalysis): PlannedSearch[] {
  const attempts: PlannedSearch[] = [];
  const seen = new Set<string>();
  const push = (query: string, currentJobTitles?: string[]) => {
    const trimmed = query.trim().slice(0, 256);
    const key = `${trimmed.toLowerCase()}|${(currentJobTitles ?? []).join(",").toLowerCase()}`;
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
  const role = harvestRoleFromTitle(job.title);
  push(primary);
  if (platform && role) push(platform, [role]);
  for (const query of peopleFirstHarvestQueries(job)) push(query);
  return attempts.slice(0, 4);
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
