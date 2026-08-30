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
      "System Design Engineer",
      "Systems Design Engineer",
      "Product Development Engineer",
      "Senior System Designer",
      "Senior Systems Designer",
    );
  }
  if (/murex/i.test(t)) {
    aliases.push("Murex Consultant", "Murex Support", "Front Office Support");
  }
  if (/business\s+analyst|\bcalypso\b.*\bba\b|\bba\b.*\bcalypso\b/i.test(t)) {
    aliases.push(
      "Business Analyst",
      "Senior Business Analyst",
      "Calypso Business Analyst",
      "Senior Calypso Business Analyst",
      "Calypso BA",
      "Capital Markets Business Analyst",
      "Functional Analyst",
    );
  }
  // Language/framework + Engineer titles: public LinkedIn headlines rarely say
  // "TypeScript Engineer" verbatim — they say Software/Frontend/Full Stack Engineer.
  if (/\bengineer\b/i.test(t) && /(type\s*script|javascript|react|node\.?js|python|golang|java|kotlin|rust|c\+\+|swift)\b/i.test(t)) {
    aliases.push(
      "Software Engineer",
      "Senior Software Engineer",
      "Full Stack Engineer",
      "Full-Stack Engineer",
      "Frontend Engineer",
      "Front End Engineer",
      "Front-End Engineer",
      "Backend Engineer",
      "Back End Engineer",
      "Back-End Engineer",
      "Platform Engineer",
      "Application Engineer",
    );
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
  for (const alias of roleTitleMatchAliases(roleTitle)) {
    const tokens = alias
      .toLowerCase()
      .split(/[^a-z0-9+.#]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !TITLE_STOP.has(t));
    if (tokens.length === 0) return true;
    // Contiguous phrase required for multi-token titles so
    // "Design Systems" never satisfies "System Designer" / "Systems Designer".
    const phrase = tokens
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    if (new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, "i").test(hay)) return true;
    if (tokens.length === 1 && titleTokenHits(hay, alias) >= 1) return true;
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
