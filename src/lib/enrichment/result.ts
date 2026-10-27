import type { Candidate, EnrichmentAttempt } from "../types";

/** Only provider-owned richness/scoring fields may cross the enrichment boundary. */
export const ENRICHMENT_PATCH_FIELDS = [
  "enrichment", "email", "phone", "currentTitle", "location", "currentCompany",
  "techStack", "externalIds", "experience", "education", "languages", "matchScore", "matchBreakdown",
] as const satisfies readonly (keyof Candidate)[];
export type EnrichmentPatch = Pick<Candidate, (typeof ENRICHMENT_PATCH_FIELDS)[number]>;

export function enrichmentPatch(candidate: Candidate): EnrichmentPatch {
  return Object.fromEntries(ENRICHMENT_PATCH_FIELDS.map((field) => [field, candidate[field]])) as EnrichmentPatch;
}

/** Stable input for detecting a changed identity/evidence without blocking notes. */
export function enrichmentBasis(candidate: Candidate): unknown[] {
  return [candidate.id, candidate.campaignId, candidate.linkedinUrl, candidate.name,
    candidate.yearsExperience, candidate.companyStageExperience, candidate.industryExperience,
    candidate.recentActivity, candidate.timezone, candidate.provenance,
    ...ENRICHMENT_PATCH_FIELDS.map((field) => candidate[field])];
}

export function enrichmentOutcome(attempts: EnrichmentAttempt[]) {
  const filled = [...new Set(attempts.flatMap((a) => a.fieldsFilled))];
  const issue = attempts.find((a) => ["error", "budget_exceeded", "not_configured", "no_key_field", "deferred"].includes(a.status));
  const performed = attempts.some((a) => a.status === "ok" || a.status === "no_data");
  return {
    ok: filled.length > 0 || (performed && !issue),
    filled,
    detail: filled.length > 0
      ? `${filled.join(", ")} filled.${issue ? " Some provider work could not complete; review the attempt history." : ""}`
      : issue?.detail || (issue ? `Enrichment could not complete (${issue.status}).` : performed ? "Provider checked; no new data found." : "No eligible provider can fill the requested fields. Check the profile identity and provider setup."),
  };
}
