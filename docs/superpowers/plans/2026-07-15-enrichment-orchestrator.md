# Design — Unified Enrichment Orchestrator ("enrich with every tool", scalable)

> Goal: a Candidate discovered by ANY source can be enriched by ALL configured providers
> (Apify harvestapi + dev_fusion, Apollo, Seamless, Sillage) in a cost-ordered waterfall that
> fills missing fields, merges by field with provenance, batches at scale, and respects a budget.
> Extends the existing adapters — does NOT duplicate them. Build stacks on `feat/apify-linkedin-sourcing`.

## Why (grounded in recon)
Today (verified): enrichment is 1 candidate ↔ 1 provider, branched on `candidate.sourcePlatform`
(`store.ts:1527/1680`, drawer buttons gated `sourcePlatform==="Apollo"&&!email`). `dedupeCandidates`
only **rejects** duplicates (never merges). No field-level provenance, no enrichment status/log, no
batch, no cost tracking. Single `sourceExternalId` slot collides across providers. This design fills
exactly those five gaps.

## Provider capability matrix (what each tool gives, by which key)
| Provider | Key it needs on the candidate | Enriches | Cost | Sync? |
|---|---|---|---|---|
| Apify harvestapi (Full+email) | searchQuery/name+company (search) | headline, about, skills, experience, education, languages, email | ~$0.10/pg+$0.01/prof | async (run-sync ok for ≤ small) |
| Apify dev_fusion | `linkedinUrl` | full profile + email | $0.01/prof | async (needs owner approval) |
| Apollo match | `externalIds.Apollo` (apollo id) | email, phone | 1 credit | sync |
| Seamless research | `externalIds.Seamless` (searchResultId) | email, phone | credits | async (start+poll) |
| Sillage mapping | company domain/linkedin | full profile incl. email/phone (per company) | — | async |
| GitHub / web-leads / tavily | — | discovery only, NEVER enrich | free | n/a |

## Data model additions (`src/lib/types.ts`)
Add to `Candidate` (all optional, back-compat):
```ts
export type EnrichableField = "email" | "phone" | "headline" | "skills" | "experience" | "education" | "languages" | "location" | "company";

export interface FieldProvenance {
  provider: SourcePlatform;   // who supplied this field's value
  at: string;                 // ISO
  confidence?: number;        // 0..1 (e.g. email deliverable/qualityScore)
}
export interface EnrichmentAttempt {
  provider: SourcePlatform;
  at: string;
  status: "ok" | "no_data" | "not_configured" | "no_key_field" | "budget_exceeded" | "error";
  fieldsFilled: EnrichableField[];
  costUnits: number;          // credits/$ consumed (0 if free/no-match)
  detail?: string;            // terse, never leaks a key
}
export interface CandidateEnrichment {
  status: "unenriched" | "partial" | "enriched" | "failed";
  lastEnrichedAt?: string;
  fieldProvenance: Partial<Record<EnrichableField, FieldProvenance>>;
  attempts: EnrichmentAttempt[];
  coverage: EnrichableField[];   // fields currently present
}
// Candidate gains:  enrichment?: CandidateEnrichment;  externalIds?: Partial<Record<SourcePlatform, string>>;
```
Keep `sourceExternalId` for back-compat; new code reads/writes `externalIds[provider]`. Mapping helpers
seed `externalIds[sourcePlatform] = sourceExternalId`.

## Provider registry (`src/lib/enrichment/registry.ts`)
Declarative, pluggable — adding a provider is one entry, no orchestrator edits:
```ts
export interface EnrichmentProvider {
  id: SourcePlatform;
  label: string;
  enriches: EnrichableField[];
  costUnits: number;                         // for waterfall ordering + ledger
  keyField(c: Candidate): { kind: string; value: string } | null;  // what it needs; null => can't run on this candidate
  // server-only runner resolved separately (keeps this module client-safe for UI badges)
}
export const ENRICHMENT_PROVIDERS: EnrichmentProvider[] = [ /* Apify, dev_fusion, Apollo, Seamless, Sillage */ ];
```
Server runners live in `src/lib/enrichment/runners.ts` (server-only; import the existing adapters,
resolve the stored key, return `{ fields: Partial<Record<EnrichableField, {value; confidence}>>, costUnits, status }`).

## Waterfall orchestrator (`src/lib/enrichment/orchestrator.ts`, server-only)
`orchestrateEnrichment({ candidate, want, budget, configuredProviders }) => EnrichmentResult`:
1. `missing = want − candidate.enrichment.coverage`.
2. Candidate providers = registry entries that (a) enrich ≥1 missing field, (b) `keyField(candidate)!=null`, (c) key configured (stored). Order by `costUnits` asc (free/cheap first: Apify already-Full → Apollo → Seamless).
3. Run in sequence; after each, `mergeEnrichment` (below), recompute `missing`; stop when `missing` empty or `budget.remaining<=0`.
4. Re-score via `scoreCandidate`. Return merged candidate patch + attempts + spend.

## Merge (`src/lib/enrichment/merge.ts`)
`mergeEnrichment(candidate, providerId, fields) => candidate`: for each returned field, set it only if the
candidate lacks it OR the new `confidence` beats the stored `fieldProvenance[field].confidence`. Record
`fieldProvenance[field]={provider,at,confidence}`, append an `EnrichmentAttempt`, update `coverage`/`status`.
Same-person merge across providers keys on `linkedinUrl` then `email` (the fields every provider shares) —
this is the MERGE path that today's reject-only `dedupeCandidates` lacks.

## Budget / spend ledger
`HermesState.enrichmentLedger: { provider, candidateId, units, at }[]` + `HermesState.enrichmentBudgetUnits`
(per-workspace cap, default generous). Server route checks remaining budget before any paid call; over-budget →
attempt `status:"budget_exceeded"`, skip. (v2 seam: move ledger to a relational table + cross-instance budget in Redis — the current per-instance rate limiter is documented as per-instance only.)

## Routes (`src/app/api/source/enrich/route.ts`, new)
POST — body `{ candidateKeys: {linkedinUrl?, email?, name?, company?, apolloId?, searchResultId?}, want: EnrichableField[] }`.
Guards identical to other source routes (prodFailClosed → rate limit `source-enrich` max 15 → auth → `can(role,"source")` → validateBody). Runs the SYNC-capable waterfall (Apollo, Apify/dev_fusion via run-sync with a bounded timeout) server-side, returns `{ ok, patch: CandidateEnrichment-merge, attempts, spend }`. For providers that must poll (Seamless), returns an async handle the client polls via the existing `research-status` route. Never returns a key.

## Batch (`store.ts` + optional cron seam)
`enrichCampaign(campaignId, { want, concurrency=3, budgetUnits })` — client-orchestrated v1: iterate the
campaign's candidates through `/api/source/enrich` with a concurrency cap and a shared budget, emitting
progress into an `Activity`/toast. v2 seam: a durable server job mirroring the `agent_runs` state machine +
`claim_and_record` lease + `dispatchDue` drainer (all already in the codebase) for true background scale.

## Wow UI
- Candidate drawer: an **Enrichment** panel — coverage chips (email/phone/skills/…), each showing the
  provider that supplied it (provenance badge) + confidence; one-click **Enrich** runs the waterfall with a
  live per-provider progress list; shows spend.
- Campaign view: **Enrich all** (batch) with a progress bar, coverage %, and running spend vs budget.
- Honest empty/degraded states (not_configured provider shown as "connect key", never faked).

## Scale posture (the "very big" seams, explicit)
- Registry-driven: new provider = 1 registry entry + 1 runner. No orchestrator changes.
- Budget + rate limited before spend; ledger is the audit trail.
- Waterfall stops early (cost-minimal): never calls Apollo if Apify already filled email.
- v2 seams named inline (relational candidates + enrichment tables, durable job runner, Redis budget) so
  this v1 upgrades without rework.

## Acceptance
- typecheck + lint + full `npm test` green (new orchestrator/merge/registry/route tests wired into `npm test`).
- Live: the 5 Apify candidates enrich through the waterfall; providers without a stored key report
  `not_configured` (graceful), not an error. Field provenance + spend recorded per candidate.
- No key ever leaked; linkedin-policy guardrails unchanged; GDPR provenance preserved.
