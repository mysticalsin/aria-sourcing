/**
 * LinkedIn boolean skill clauses must use the same Skill (Must) tokens as chips.
 * A persisted `("Linux Python Shell …")` phrase is one quoted blob, not search tokens.
 */
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";
import type { JobAnalysis } from "@/lib/types";

function quoteSkill(skill: string): string {
  return `"${skill.replace(/"/g, "").trim()}"`;
}

export function linkedinSkillOrClause(skills: readonly string[]): string {
  const tokens = tokenizeMustHaveSkills([...skills]);
  if (tokens.length === 0) return "";
  return `(${tokens.map(quoteSkill).join(" OR ")})`;
}

/** A quoted phrase that is the Skill (Must) line (spaces or glued), not a job title. */
export function quotedPhraseIsSkillBlob(
  quoted: string,
  requiredSkills: string[] | string,
): boolean {
  const tokens = tokenizeMustHaveSkills(quoted);
  if (tokens.length < 3) return false;
  const required = new Set(tokenizeMustHaveSkills(requiredSkills).map((skill) => skill.toLowerCase()));
  if (required.size === 0) return false;
  return tokens.filter((token) => required.has(token.toLowerCase())).length >= 3;
}

export function linkedinBooleanQuotesSkillBlob(
  boolean: string,
  requiredSkills: string[] | string,
): boolean {
  return [...boolean.matchAll(/"([^"]+)"/g)].some((match) =>
    quotedPhraseIsSkillBlob(match[1] ?? "", requiredSkills),
  );
}

export function repairLinkedinBoolean(
  job: Pick<JobAnalysis, "requiredSkills">,
  boolean: string,
): string {
  const trimmed = boolean.trim();
  if (!trimmed) return "";
  if (!linkedinBooleanQuotesSkillBlob(trimmed, job.requiredSkills)) return trimmed;
  return trimmed.replace(/"([^"]+)"/g, (all, inner: string) => {
    if (!quotedPhraseIsSkillBlob(inner, job.requiredSkills)) return all;
    const tokens = tokenizeMustHaveSkills(inner);
    return tokens.map(quoteSkill).join(" OR ");
  });
}
