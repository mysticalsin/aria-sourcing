/**
 * GitHub /search/users `language:` is only valid for real programming languages.
 * Product platforms (Calypso) and protocols (gRPC) are keyword tokens.
 */
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";
import type { GithubQuery, JobAnalysis } from "@/lib/types";

export const GITHUB_SEARCH_LANGUAGES = new Set([
  "python",
  "shell",
  "java",
  "javascript",
  "typescript",
  "go",
  "ruby",
  "c++",
  "c",
  "rust",
  "php",
  "scala",
  "kotlin",
  "swift",
  "sql",
]);

function githubAtomToken(skill: string): string {
  const trimmed = skill.trim();
  if (!trimmed) return "";
  if (/\s/.test(trimmed)) {
    const first = trimmed.split(/\s+/)[0] ?? trimmed;
    return GITHUB_SEARCH_LANGUAGES.has(first.toLowerCase()) ? `language:${first}` : trimmed;
  }
  if (GITHUB_SEARCH_LANGUAGES.has(trimmed.toLowerCase())) return `language:${trimmed}`;
  return trimmed;
}

export function githubSkillQueryToken(skill: string): string {
  const pieces = tokenizeMustHaveSkills(skill);
  if (pieces.length === 0) return "";
  // Never compact-join "Linux Python Shell…" into language:LinuxPython…
  return githubAtomToken(pieces[0] ?? "");
}

export function githubQueryIsGluedSkillBlob(query: string): boolean {
  const languages = [...query.matchAll(/(?:^|\s)language:([A-Za-z0-9+#.\-]+)/gi)].map(
    (match) => match[1] ?? "",
  );
  if (languages.some((language) => language.length >= 12 && !GITHUB_SEARCH_LANGUAGES.has(language.toLowerCase()))) {
    return true;
  }
  return /LinuxPython|PythonShell|OracleGrafana|GrafanaDynatrace/i.test(query);
}

export function honestGithubQueries(
  job: Pick<JobAnalysis, "requiredSkills">,
): GithubQuery[] {
  const skills = tokenizeMustHaveSkills(job.requiredSkills).slice(0, 3);
  return skills.map((skill, i) => {
    const token = githubSkillQueryToken(skill);
    return {
      label: `${skill} contributors`,
      query: `${token} followers:>40 ${i === 0 ? "repos:>10" : "repos:>5"}`.trim(),
      estimatedResults: 120 + i * 60,
    };
  });
}

export function repairGithubQueries(
  job: Pick<JobAnalysis, "requiredSkills">,
  queries: readonly GithubQuery[],
): GithubQuery[] {
  if (queries.length === 0) return honestGithubQueries(job);
  if (queries.some((item) => githubQueryIsGluedSkillBlob(item.query))) {
    return honestGithubQueries(job);
  }
  return queries.map((item) => ({ ...item }));
}
