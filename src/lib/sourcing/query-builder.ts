/**
 * Need-agnostic boolean / provider query builder.
 *
 * Prefer the brief's explicit boolean_search / searchBoolean. Otherwise
 * synthesize from must-haves + title aliases + geo so LinkedIn / GitHub /
 * SMART paths share one query contract.
 */
import { europeSourcingLocationHints } from "@/lib/geo-europe";
import { roleTitleMatchAliases } from "@/lib/sourcing/candidate-fit";
import type { JobAnalysis } from "@/lib/types";

const MACRO_GEO = new Set([
  "eu",
  "emea",
  "eea",
  "apac",
  "latam",
  "remote",
  "global",
  "international",
  "europe",
  "european",
  "americas",
  "asia",
  "worldwide",
]);

function quoteTerm(term: string): string {
  const t = term.trim();
  if (!t) return "";
  if (/\s/.test(t) || /[()]/.test(t)) return `"${t.replace(/"/g, "")}"`;
  return t;
}

function geoTerms(jd: JobAnalysis): string[] {
  const europeHints = europeSourcingLocationHints(jd);
  if (europeHints.length > 0) return europeHints.slice(0, 5);
  const places: string[] = [];
  for (const raw of [jd.location ?? "", ...(jd.regions ?? [])]) {
    const city = raw.trim().split(",")[0]!.trim();
    if (city.length < 2) continue;
    if (MACRO_GEO.has(city.toLowerCase())) continue;
    if (!places.some((p) => p.toLowerCase() === city.toLowerCase())) places.push(city);
  }
  return places.slice(0, 5);
}

/** Synthesize a LinkedIn-style boolean from must-haves, titles, and geo. */
export function synthesizeBooleanSearch(jd: JobAnalysis): string {
  const must = (jd.requiredSkills ?? []).slice(0, 5).map(quoteTerm).filter(Boolean);
  const titleAliases = roleTitleMatchAliases(jd.title).slice(0, 4).map(quoteTerm).filter(Boolean);
  const titles =
    titleAliases.length > 0
      ? titleAliases
      : [quoteTerm(jd.title), quoteTerm(`${jd.seniority} ${jd.title}`.trim())].filter(Boolean);
  const geos = geoTerms(jd).map(quoteTerm).filter(Boolean);

  const skillClause = must.length > 0 ? `(${must.join(" AND ")})` : "";
  const titleClause = titles.length > 0 ? `(${titles.join(" OR ")})` : "";
  const geoClause = geos.length > 0 ? `(${geos.join(" OR ")})` : "";

  return [titleClause, skillClause, geoClause, 'NOT "recruiter"'].filter(Boolean).join(" AND ");
}

/**
 * Canonical boolean for LinkedIn / web / SMART paths.
 * Uses `searchBoolean` when the need states one; otherwise synthesizes.
 */
export function buildBooleanSearchQuery(jd: JobAnalysis): string {
  const explicit = jd.searchBoolean?.trim();
  if (explicit) return explicit;
  return synthesizeBooleanSearch(jd);
}

/**
 * GitHub user-search query fragments from this need's code skills + geo.
 * Never invents a product name foreign to the brief.
 */
export function buildGithubSearchQueries(
  jd: JobAnalysis,
): { label: string; query: string; estimatedResults: number }[] {
  const topSkills = (jd.requiredSkills ?? []).slice(0, 4);
  const europeHints = europeSourcingLocationHints(jd);
  const concrete =
    jd.regions.find((r) => !MACRO_GEO.has(r.toLowerCase()) && r.trim().length > 1) ||
    europeHints[0] ||
    (jd.location && !MACRO_GEO.has(jd.location.split(",")[0]!.trim().toLowerCase())
      ? jd.location.split(",")[0]!.trim()
      : "");
  const locationQualifier = concrete ? ` location:${concrete}` : "";

  const CODE_SKILL_RE =
    /^(mysql|sql|postgres(?:ql)?|python|java|typescript|javascript|go|golang|rust|c\+\+|node\.?js|react|kotlin|scala)$/i;
  const githubSkill = topSkills.find((s) => CODE_SKILL_RE.test(s.trim()));
  const domainAnchor =
    topSkills.find((s) => !CODE_SKILL_RE.test(s.trim())) ||
    jd.title
      .split(/[^a-z0-9+.#]+/i)
      .map((t) => t.trim())
      .find(
        (t) =>
          t.length > 2 &&
          !/^(senior|lead|staff|principal|junior|engineer|developer|analyst|consultant|business|software|backend|frontend)$/i.test(
            t,
          ),
      ) ||
    "";

  const githubSkillToken =
    githubSkill && /mysql/i.test(githubSkill)
      ? "MySQL"
      : githubSkill && /node\.?js/i.test(githubSkill)
        ? "Node.js"
        : githubSkill && /postgres/i.test(githubSkill)
          ? "PostgreSQL"
          : githubSkill;

  if (githubSkill) {
    const out: { label: string; query: string; estimatedResults: number }[] = [];
    if (domainAnchor && !CODE_SKILL_RE.test(domainAnchor)) {
      out.push({
        label: `${githubSkillToken} + ${domainAnchor} domain`,
        query: `${githubSkillToken} ${domainAnchor}${locationQualifier} followers:>20`,
        estimatedResults: 40,
      });
    }
    for (let i = 0; i < Math.min(2, topSkills.length); i++) {
      const skill = topSkills[i]!;
      out.push({
        label: `${skill} contributors`,
        query: `"${skill}"${locationQualifier} followers:>20 ${i === 0 ? "repos:>5" : "repos:>3"}`,
        estimatedResults: 60 + i * 30,
      });
    }
    return out;
  }

  return topSkills.slice(0, 3).map((skill, i) => ({
    label: `${skill} contributors`,
    query: `language:${skill.replace(/\s+/g, "")}${locationQualifier} followers:>40 ${
      i === 0 ? "repos:>10" : "repos:>5"
    }`,
    estimatedResults: 120 + i * 60,
  }));
}

/**
 * Deep LinkedIn / web search variants — boolean + title aliases + skills + geo —
 * so Source next batch can fan out and keep only hard-gate / quality-floor fits.
 */
export function buildLinkedInQueryVariants(jd: JobAnalysis, max = 12): string[] {
  const variants: string[] = [];
  const boolean = buildBooleanSearchQuery(jd).trim();
  if (boolean) variants.push(boolean.slice(0, 256));

  const titles = roleTitleMatchAliases(jd.title).slice(0, 6);
  const skills = (jd.requiredSkills ?? []).slice(0, 4);
  const geos = geoTerms(jd);
  const seniority = jd.seniority !== "Unspecified" ? jd.seniority : "";

  for (const alias of titles) {
    for (const geo of geos.slice(0, 2)) {
      variants.push([seniority, alias, geo].filter(Boolean).join(" "));
      if (skills[0]) variants.push([alias, skills[0], geo].filter(Boolean).join(" "));
    }
    if (skills[0]) variants.push([alias, skills[0], geos[0] ?? ""].filter(Boolean).join(" "));
  }
  if (skills[1] && titles[0]) {
    variants.push([titles[0], skills[1], geos[0] ?? ""].filter(Boolean).join(" "));
  }
  const keyword = [jd.title, ...skills.slice(0, 3), ...geos.slice(0, 1)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (keyword) variants.push(keyword.slice(0, 256));

  return Array.from(
    new Set(
      variants
        .map((q) => q.replace(/\s+/g, " ").trim().slice(0, 256))
        .filter((q) => q.length >= 3),
    ),
  ).slice(0, max);
}
