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
import type { EnrichedFields } from "@/lib/enrichment/merge";
import type { Candidate, EnrichmentAttempt, SourcePlatform } from "@/lib/types";

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

/**
 * One runner per registry provider id (src/lib/enrichment/registry.ts). Empty
 * since the owner retired Apify (2026-11-06), the only provider wired so far:
 * the orchestrator, its budget authority and the drawer stay ready for the
 * next one, and enrich nothing meanwhile.
 */
export const ENRICHMENT_RUNNERS: Partial<Record<SourcePlatform, EnrichmentRunner>> = {};
