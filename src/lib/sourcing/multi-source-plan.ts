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

/**
 * harvestapi `searchQuery` is keywords (typically AND), not a LinkedIn boolean.
 * Title + six Skill (Must) tokens has near-zero recall. The recall shape is
 * the distinctive platform (Calypso is a need/skill) plus two must-have skills.
 */
export function apifyHarvestQueryFromBrief(job: JobAnalysis): string {
  const skills = tokenizeMustHaveSkills(job.requiredSkills);
  const platform = distinctiveNeedPlatform(job);
  const extra = skills
    .filter((skill) => skill.toLowerCase() !== platform.toLowerCase())
    .slice(0, 2);
  const tokens = (platform ? [platform, ...extra] : skills.slice(0, 3)).filter(Boolean);
  return tokens.join(" ").slice(0, 256).trim();
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
    ? apifyHarvestQueryFromBrief(input.jobAnalysis)
    : apifyQueryFromLinkedinPlan(input.jobAnalysis, linkedin);
  const plan: PlannedSearch[] = [];
  if (peopleFirst) {
    if (apify) plan.push({ platform: "Apify", query: apify });
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
  return plan.slice(0, 5);
}
