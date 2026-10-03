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
  if (/calypso/i.test(t)) {
    aliases.push(
      "Calypso Support",
      "Calypso Application Support",
      "Calypso Support Analyst",
      "Calypso Business Analyst",
      "Calypso Consultant",
      "Calypso Developer",
      "Calypso Engineer",
    );
  }
  if (/application support/i.test(t)) {
    aliases.push(
      "Application Support Analyst",
      "Application Support Engineer",
      "Apps Support",
      "Production Support",
      "Production Support Analyst",
    );
  }
  if (/business analyst/i.test(t)) {
    aliases.push("Business Analyst", "Functional Analyst", "FO Business Analyst");
  }
  if (/windows desktop|endpoint engineer|intune engineer|desktop engineer/i.test(t)) {
    aliases.push(
      "Windows Desktop Engineer",
      "Enterprise Windows Desktop Engineer",
      "Endpoint Engineer",
      "Intune Engineer",
      "Desktop Engineer",
      "Windows Engineer",
      "Modern Workplace Engineer",
      "Endpoint Management Engineer",
      "SCCM Engineer",
      "Desktop Support Engineer",
    );
  }
  return aliases;
}

const PRODUCT_ROLE_TOKENS = [
  "calypso",
  "murex",
  "summit",
  "kondor",
  "sophis",
  "fidessa",
  "intune",
  "autopilot",
  "sccm",
] as const;
const FUNCTION_ROLE_TOKENS = [
  "support",
  "analyst",
  "consultant",
  "developer",
  "engineer",
  "programmer",
  "architect",
  "desktop",
  "endpoint",
] as const;

/**
 * Consulting product roles (Calypso/Murex/…) often appear as
 * "Developer — Calypso" or snippet-only product mentions. Accept when the
 * haystack carries the product token plus a support/analyst/dev function token.
 */
function productFunctionRoleMatch(hay: string, roleTitle: string): boolean {
  const role = roleTitle.toLowerCase();
  if (/windows desktop|endpoint engineer|intune engineer|desktop engineer/i.test(roleTitle)) {
    const platform = [
      "intune",
      "endpoint",
      "sccm",
      "autopilot",
      "windows desktop",
      "windows365",
      "configmgr",
      "configuration manager",
      "modern workplace",
    ].some((token) => hay.includes(token));
    const fn = ["engineer", "administrator", "admin", "specialist", "architect"].some((token) =>
      hay.includes(token),
    );
    if (platform && fn) return true;
  }
  const product = PRODUCT_ROLE_TOKENS.find((token) => role.includes(token));
  if (!product) return false;
  const functionNeeded = FUNCTION_ROLE_TOKENS.some((token) => role.includes(token));
  if (!functionNeeded) return false;
  if (!hay.includes(product)) return false;
  return FUNCTION_ROLE_TOKENS.some((token) => hay.includes(token));
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
  return productFunctionRoleMatch(hay, roleTitle);
}

/** Keep only leads that clear the sourcing quality floor (default 80%). */
export function meetsSourcingQualityBar(
  candidate: Pick<Candidate, "matchScore">,
  floor: number = SOURCING_QUALITY_FLOOR,
): boolean {
  return Number.isFinite(candidate.matchScore) && candidate.matchScore >= floor;
}
