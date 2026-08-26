import type { Candidate } from "@/lib/types";

const TITLE_STOP = new Set(["senior", "lead", "staff", "principal", "junior", "the", "and", "for"]);

/** True when a live lead's title/snippet plausibly matches the role title. */
export function candidateMatchesRoleTitle(
  candidate: Pick<Candidate, "currentTitle" | "recentActivity">,
  roleTitle: string,
): boolean {
  const hay = `${candidate.currentTitle} ${candidate.recentActivity}`.toLowerCase();
  const tokens = roleTitle
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !TITLE_STOP.has(t));
  if (tokens.length === 0) return true;
  const hits = tokens.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(hay);
  }).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.5));
}
