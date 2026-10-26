// Server-only runners for the unified enrichment orchestrator
// (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md). One runner
// per registry provider (src/lib/enrichment/registry.ts); the orchestrator
// (enrichment/orchestrator.ts) resolves which runner to call from
// `provider.id` and folds the result into the candidate via
// `mergeEnrichment`/`recordEnrichmentAttempt` (enrichment/merge.ts).
//
// CORE DESIGN PRINCIPLE ("works with all my tools"): a candidate discovered by
// ANY provider can still be enriched by every OTHER configured provider. Each
// runner resolves ITS OWN identity from the candidate's universal fields
// (name, company, linkedinUrl, externalIds) via that provider's free
// search/lookup step, then enriches. This is the cross-provider identity
// resolution the design calls out as the heart of the feature.
//
// Every runner is defensive: it never throws (adapter errors are caught and
// turned into a `status: "error"` result), never logs a key, and never
// returns one — only the adapters' `resolveStored*Key()` touch the decrypted
// secret, and it stays local to this module's call stack.

import type { getServerSupabase } from "@/lib/supabase/server";
import { enrichProfilesByUrl, resolveStoredApifyKey } from "@/lib/sourcing/apify";
import type { EnrichedFields } from "@/lib/enrichment/merge";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";
import type { Candidate, EnrichmentAttempt } from "@/lib/types";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

/** One provider run against one candidate. `fields` folds into the candidate
 *  via `mergeEnrichment`; `costUnits` is the REAL spend this call incurred
 *  (not the registry's relative ordering weight); `externalId`, when present,
 *  is this provider's resolved identifier for the candidate — the orchestrator records it onto `candidate.externalIds` so a
 *  later re-enrichment skips the free search/resolve step entirely. */
export interface RunnerResult {
  fields: EnrichedFields;
  costUnits: number;
  status: EnrichmentAttempt["status"];
  detail?: string;
  externalId?: string;
}

export type EnrichmentRunner = (session: Session, candidate: Candidate) => Promise<RunnerResult>;

/* ---- dev_fusion (Apify) ----------------------------------------------------
 * Keyed purely on linkedinUrl — the one identifier every source platform can
 * supply. No free "resolve an id" step needed: the URL itself is the identity. */

export const devFusionRunner: EnrichmentRunner = async (session, candidate) => {
  const linkedinUrl = candidate.linkedinUrl?.trim();
  if (!linkedinUrl) {
    return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No linkedinUrl on this candidate." };
  }
  const token = await resolveStoredApifyKey(session);
  if (!token) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No Apify key configured." };

  const clearance = clearIdentityResolution("Apify", { linkedinUrl });
  if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };

  const res = await enrichProfilesByUrl(clearance.clearance, token, [linkedinUrl]);
  if (!res.ok) {
    if (res.title === "not_approved") {
      return {
        fields: {},
        costUnits: 0,
        status: "not_configured",
        detail: "Apify dev_fusion actor needs owner approval in the Apify console.",
      };
    }
    return { fields: {}, costUnits: 0, status: "error", detail: res.detail || res.title };
  }

  const profile = res.data[0];
  if (!profile) return { fields: {}, costUnits: 1, status: "no_data", detail: "dev_fusion found no profile for this URL." };

  const fields: EnrichedFields = {};
  if (profile.email) fields.email = { value: profile.email, confidence: 0.9 };
  if (profile.headline) fields.headline = { value: profile.headline };
  if (profile.location?.text) fields.location = { value: profile.location.text };
  const skills = [...profile.topSkills, ...profile.skills];
  if (skills.length) fields.skills = { value: skills };
  const experience = [...profile.currentPosition, ...profile.experience]
    .map((p) => [p.title, p.companyName].filter(Boolean).join(" @ ") + (p.dateRange ? ` (${p.dateRange})` : ""))
    .filter((s) => s.trim().length > 0);
  if (experience.length) fields.experience = { value: experience };
  const education = profile.education
    .map((e) => [e.degree, e.schoolName].filter(Boolean).join(" @ ") + (e.dateRange ? ` (${e.dateRange})` : ""))
    .filter((s) => s.trim().length > 0);
  if (education.length) fields.education = { value: education };
  if (profile.languages.length) fields.languages = { value: profile.languages };

  return { fields, costUnits: 1, status: "ok" };
};
