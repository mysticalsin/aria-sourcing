// Declarative, CLIENT-SAFE provider registry for the unified enrichment
// orchestrator (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md,
// "Provider registry"). This module renders coverage/provenance badges in the
// UI, so it must be safe to import from the browser: no server-only imports
// (no supabase/server, no crypto-secrets), no adapter imports, and no secrets — just types + pure functions.
//
// The server-only runners that actually call each provider's adapter live in
// enrichment/runners.ts (not this file) and resolve the stored key there.
//
// CORE DESIGN PRINCIPLE ("works with all my tools"): every provider resolves
// its OWN identity from a candidate's universal fields (name, company,
// linkedinUrl, externalIds) via its free search/lookup step, then enriches.
// keyField() returns the identifier + its kind so a candidate discovered by
// one provider can still be enriched by every other configured provider —
// it returns null when the candidate lacks what that provider needs, which
// is how the orchestrator decides a provider can't run on this candidate.

import type { Candidate, EnrichableField, SourcePlatform } from "@/lib/types";

/** What a provider needs to identify/re-identify a candidate, and how. */
export interface EnrichmentKey {
  /** Discriminates which identifier shape `value` is, per provider:
   *  currently only "linkedinUrl". */
  kind: string;
  value: string;
}

export interface EnrichmentProvider {
  id: SourcePlatform;
  label: string;
  /** Candidate fields this provider can fill in, when it has data for them. */
  enriches: EnrichableField[];
  /** Relative cost unit for waterfall ordering + the spend ledger (cheapest
   *  runs first: never call a costlier provider once a cheaper one already
   *  filled the missing fields). Not a real currency amount. */
  costUnits: number;
  /** Extract this provider's identifier from the candidate's universal fields.
   *  Returns null when the candidate lacks what this provider needs to run —
   *  the orchestrator skips the provider entirely rather than calling it. */
  keyField(c: Candidate): EnrichmentKey | null;
}

/** Trimmed, non-empty string, else null. */
function nonEmpty(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const ENRICHMENT_PROVIDERS: EnrichmentProvider[] = [
  // dev_fusion (Apify family) — URL-in, full-profile-out LinkedIn enrichment.
  // Keyed purely on linkedinUrl: the one universal field every source
  // platform in SOURCE_PLATFORMS can supply for a real profile.
  {
    id: "Apify",
    label: "Apify (LinkedIn full profile)",
    enriches: ["email", "headline", "skills", "experience", "education", "languages", "location"],
    costUnits: 1,
    keyField(c) {
      const linkedinUrl = nonEmpty(c.linkedinUrl);
      if (!linkedinUrl) return null;
      return { kind: "linkedinUrl", value: linkedinUrl };
    },
  },
];
