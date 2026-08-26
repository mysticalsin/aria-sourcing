import type { Candidate } from "@/lib/types";

const TITLE_STOP = new Set(["senior", "lead", "staff", "principal", "junior", "the", "and", "for"]);

/** Minimum match score for accepting a live sourced lead into the campaign. */
export const SOURCING_QUALITY_FLOOR = 80;

/** Adjacent titles that still count as a role-title hit for common consulting needs. */
export function roleTitleMatchAliases(roleTitle: string): string[] {
  const t = roleTitle.trim();
  if (!t) return [];
  const aliases = [t];
  if (/system designer/i.test(t)) {
    aliases.push(
      "Systems Designer",
      "System Architect",
      "Systems Architect",
      "Systems Engineer",
      "Product Development Engineer",
    );
  }
  if (/murex/i.test(t)) {
    aliases.push("Murex Consultant", "Murex Support", "Front Office Support");
  }
  return aliases;
}

function titleTokenHits(hay: string, roleTitle: string): number {
  const tokens = roleTitle
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !TITLE_STOP.has(t));
  if (tokens.length === 0) return 1;
  return tokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  }).length;
}

/** True when a live lead's title/snippet plausibly matches the role title (or alias). */
export function candidateMatchesRoleTitle(
  candidate: Pick<Candidate, "currentTitle" | "recentActivity">,
  roleTitle: string,
): boolean {
  const hay = `${candidate.currentTitle} ${candidate.recentActivity}`.toLowerCase();
  const aliases = roleTitleMatchAliases(roleTitle);
  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i]!;
    const tokens = alias
      .toLowerCase()
      .split(/[^a-z0-9+.#]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !TITLE_STOP.has(t));
    if (tokens.length === 0) return true;
    const hits = titleTokenHits(hay, alias);
    // Primary title: half the tokens. Aliases must match in full so
    // "Quality Systems Manager" does not pass via a lone "systems" hit.
    const needed = i === 0 ? Math.max(1, Math.ceil(tokens.length * 0.5)) : tokens.length;
    if (hits >= needed) return true;
  }
  return false;
}

/** Keep only leads that clear the sourcing quality floor (default 80%). */
export function meetsSourcingQualityBar(
  candidate: Pick<Candidate, "matchScore">,
  floor: number = SOURCING_QUALITY_FLOOR,
): boolean {
  return Number.isFinite(candidate.matchScore) && candidate.matchScore >= floor;
}
