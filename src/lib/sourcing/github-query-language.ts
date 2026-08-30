/**
 * Map role skills onto GitHub /search/users `language:` qualifiers.
 *
 * GitHub only treats real programming languages as `language:` filters.
 * Skills like PostgreSQL / GraphQL / AWS / React must not become
 * `language:PostgreSQL` — those either zero results or match the wrong people.
 */

/** Canonical GitHub language names we emit in user-search queries. */
const KNOWN_GITHUB_LANGUAGES = new Set(
  [
    "TypeScript",
    "JavaScript",
    "Python",
    "Go",
    "Rust",
    "Java",
    "Kotlin",
    "C",
    "C++",
    "C#",
    "Swift",
    "Ruby",
    "PHP",
    "Scala",
    "Dart",
    "Elixir",
    "Haskell",
    "Lua",
    "R",
    "Shell",
    "Objective-C",
    "Perl",
    "Zig",
  ].map((l) => l.toLowerCase()),
);

const CANONICAL_BY_LOWER = new Map(
  [
    "TypeScript",
    "JavaScript",
    "Python",
    "Go",
    "Rust",
    "Java",
    "Kotlin",
    "C",
    "C++",
    "C#",
    "Swift",
    "Ruby",
    "PHP",
    "Scala",
    "Dart",
    "Elixir",
    "Haskell",
    "Lua",
    "R",
    "Shell",
    "Objective-C",
    "Perl",
    "Zig",
  ].map((l) => [l.toLowerCase(), l] as const),
);

/** Resolve a JD skill to a GitHub `language:` value, or null when it is not a language. */
export function githubLanguageForSkill(skill: string): string | null {
  const s = skill.toLowerCase().trim();
  if (!s) return null;
  if (/type\s*script|\bts\b|tsx/.test(s)) return "TypeScript";
  if (/java\s*script|\bjs\b|react|node\.?js|next\.?js|vue|angular|express/.test(s)) {
    return "JavaScript";
  }
  if (/python|django|flask|fastapi/.test(s)) return "Python";
  if (/golang|\bgo\b/.test(s)) return "Go";
  if (/\brust\b/.test(s)) return "Rust";
  if (/\bjava\b|spring/.test(s)) return "Java";
  if (/kotlin/.test(s)) return "Kotlin";
  if (/c\+\+|cpp/.test(s)) return "C++";
  if (/\bc#|dotnet|\.net/.test(s)) return "C#";
  if (/swift|ios/.test(s)) return "Swift";
  if (/\bruby\b|rails/.test(s)) return "Ruby";
  if (/\bphp\b|laravel/.test(s)) return "PHP";
  if (/scala/.test(s)) return "Scala";
  if (/\bdart\b|flutter/.test(s)) return "Dart";
  // Exact known language name (no permissive "any identifier" fallback).
  const exact = CANONICAL_BY_LOWER.get(s.replace(/\s+/g, ""));
  if (exact) return exact;
  if (KNOWN_GITHUB_LANGUAGES.has(s)) return CANONICAL_BY_LOWER.get(s) ?? skill.trim();
  return null;
}

export function isKnownGithubLanguage(value: string): boolean {
  const cleaned = value.replace(/["']/g, "").trim().toLowerCase();
  return KNOWN_GITHUB_LANGUAGES.has(cleaned) || githubLanguageForSkill(value) !== null;
}

export function primaryGithubLanguage(skills: string[]): string | null {
  for (const skill of skills) {
    const lang = githubLanguageForSkill(skill);
    if (lang) return lang;
  }
  return null;
}

/**
 * Rewrite invalid `language:` qualifiers in a stored/configured user-search query.
 * Non-language tokens become keywords under the role's primary language.
 */
export function sanitizeGithubUserSearchQuery(query: string, requiredSkills: string[]): string {
  const primary = primaryGithubLanguage(requiredSkills);
  const cleaned = query
    .replace(/(^|\s)language:([^\s]+)/gi, (match, lead: string, rawLang: string) => {
      const raw = rawLang.replace(/["']/g, "").trim();
      if (!raw) return lead;
      const mapped = githubLanguageForSkill(raw);
      if (mapped) return `${lead}language:${mapped}`;
      const canonical = CANONICAL_BY_LOWER.get(raw.toLowerCase());
      if (canonical) return `${lead}language:${canonical}`;
      // Not a GitHub language — keep as keyword; attach primary language when available.
      if (primary) return `${lead}${raw} language:${primary}`;
      return `${lead}${raw}`;
    })
    // Repo-only qualifiers silently zero /search/users results.
    .replace(/(^|\s)(?:forks|stars|size|topics|license|mirror|template|archived):[^\s]+/gi, " ")
    .replace(/(^|\s)sort:(?:stars|forks|help-wanted-issues|updated|created)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

export interface BuiltGithubQuery {
  label: string;
  query: string;
  estimatedResults: number;
}

/** Build honest GitHub user-search queries from role skills (no fake language: tokens). */
export function buildGithubUserQueriesForSkills(
  skills: string[],
  opts: { region?: string | null; max?: number } = {},
): BuiltGithubQuery[] {
  const max = opts.max ?? 3;
  const region = opts.region?.trim() ?? "";
  const locationQualifier =
    region && !/^global$/i.test(region) ? ` location:${region.split(",")[0]!.trim()}` : "";
  const languages = Array.from(
    new Set(skills.map(githubLanguageForSkill).filter((lang): lang is string => Boolean(lang))),
  );
  const primary = languages[0] ?? null;
  const out: BuiltGithubQuery[] = [];

  for (let i = 0; i < languages.length && out.length < max; i++) {
    const lang = languages[i]!;
    out.push({
      label: `${lang} contributors`,
      query: `language:${lang}${locationQualifier} followers:>40 ${i === 0 ? "repos:>10" : "repos:>5"}`,
      estimatedResults: 120 + i * 60,
    });
  }

  if (primary) {
    for (const skill of skills) {
      if (out.length >= max) break;
      if (githubLanguageForSkill(skill)) continue;
      const keyword = skill.replace(/\s+/g, "").trim();
      if (!keyword) continue;
      out.push({
        label: `${skill} contributors`,
        query: `${keyword} language:${primary}${locationQualifier} followers:>40 repos:>5`,
        estimatedResults: 100 + out.length * 20,
      });
    }
  } else {
    for (const skill of skills.slice(0, max)) {
      const keyword = skill.replace(/\s+/g, "").trim();
      if (!keyword) continue;
      out.push({
        label: `${skill} contributors`,
        query: `${keyword}${locationQualifier} followers:>40 repos:>5`,
        estimatedResults: 80 + out.length * 20,
      });
    }
  }

  return out.slice(0, max);
}

/** Languages the role implicitly authorizes via skill→language mapping (for query policy). */
export function authorizedGithubLanguages(skills: string[]): string[] {
  return Array.from(
    new Set(skills.map(githubLanguageForSkill).filter((lang): lang is string => Boolean(lang))),
  );
}
