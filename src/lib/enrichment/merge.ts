// Field-merge logic for the unified enrichment orchestrator
// (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md, "Merge").
// CLIENT-SAFE: pure functions only, no server imports (no supabase/server, no
// crypto-secrets, no adapter imports) — this module is imported by both the
// server-only orchestrator (enrichment/orchestrator.ts) and, potentially, UI
// code that wants to preview a merge without a network round-trip.
//
// Candidate mapping — where a merged field VALUE actually lives:
//   email     -> candidate.email
//   phone     -> candidate.phone
//   headline  -> candidate.currentTitle
//   location  -> candidate.location
//   company   -> candidate.currentCompany
//   skills    -> candidate.techStack (union-merged, case-insensitive de-dupe)
// `experience`, `education` and `languages` have NO dedicated slot on
// `Candidate` today (see src/lib/types.ts) — only `enrichment.fieldProvenance`
// + `enrichment.coverage` track that a provider supplied them, so the
// waterfall correctly stops re-querying for a field it already has. The raw
// string[] payload for those three fields is intentionally not persisted
// here: inventing a side-channel (e.g. stuffing it into `candidate.notes`)
// would surprise every other reader of that field for a gap that belongs to
// a `Candidate` schema change, not this narrowly-scoped merge module.

import { ENRICHABLE_FIELDS } from "@/lib/types";
import type { Candidate, CandidateEnrichment, EnrichableField, EnrichmentAttempt, FieldProvenance, SourcePlatform } from "@/lib/types";

/** One field's proposed new value from a provider, prior to the merge gate. */
export interface EnrichedFieldResult {
  value: string | string[];
  /** 0..1 confidence signal (e.g. Apify's email qualityScore). Absent = unknown/low. */
  confidence?: number;
}

/** What a provider run returns for `mergeEnrichment` to fold in — one entry
 *  per field it actually found data for (omit fields it has nothing for). */
export type EnrichedFields = Partial<Record<EnrichableField, EnrichedFieldResult>>;

/** Fields with a dedicated scalar/array slot elsewhere on `Candidate` — the
 *  only fields whose "is this present?" question can be answered from live
 *  candidate data. See the module header for the field -> slot mapping. */
const HOMED_FIELDS: ReadonlySet<EnrichableField> = new Set(["email", "phone", "headline", "location", "company", "skills", "experience", "education", "languages"]);

/** Fields every configured provider can realistically fill and that outreach
 *  directly depends on (email/phone drive every send channel). Deliberately
 *  narrower than the full `ENRICHABLE_FIELDS` set: `company` is never
 *  produced by any registered provider today and `experience`/`education`/
 *  `languages` are Apify-only bonus richness — requiring them would make
 *  "enriched" unreachable via the Apollo/Seamless/Sillage-only paths. */
const COMMON_ENRICHMENT_FIELDS: readonly EnrichableField[] = ["email", "phone"];

/** Fields that merge additively (union of items) rather than overwrite. These
 *  bypass the "already covered" / "confidence beats stored" gate below —
 *  gating an additive merge on presence would silently drop every later
 *  provider's contribution once the field had a single item on it, which
 *  defeats the whole point of unioning richer data in from multiple sources.
 *  `applyFieldValue` itself decides whether a given call actually has
 *  anything new to add (returning null, same as a shape mismatch, when not). */
const UNION_FIELDS: ReadonlySet<EnrichableField> = new Set(["skills"]);

function emptyEnrichment(): CandidateEnrichment {
  return { status: "unenriched", fieldProvenance: {}, attempts: [], coverage: [] };
}

/** Current value for a field with a dedicated Candidate slot, or undefined
 *  when blank/absent. Returns undefined (never throws) for a homeless field —
 *  callers must fall back to provenance for those. */
function readHomedValue(candidate: Candidate, field: EnrichableField): string | string[] | undefined {
  switch (field) {
    case "email":
      return candidate.email ? candidate.email : undefined;
    case "phone":
      return candidate.phone ? candidate.phone : undefined;
    case "headline":
      return candidate.currentTitle ? candidate.currentTitle : undefined;
    case "location":
      return candidate.location ? candidate.location : undefined;
    case "company":
      return candidate.currentCompany ? candidate.currentCompany : undefined;
    case "skills":
      return candidate.techStack.length ? candidate.techStack : undefined;
    case "experience":
      return candidate.experience?.length ? candidate.experience : undefined;
    case "education":
      return candidate.education?.length ? candidate.education : undefined;
    case "languages":
      return candidate.languages?.length ? candidate.languages : undefined;
    default:
      return undefined;
  }
}

/** Is `field` currently present on the candidate, given an explicit provenance
 *  map (used mid-merge, before the map is committed to `candidate.enrichment`). */
function isFieldCovered(
  candidate: Candidate,
  field: EnrichableField,
  provenance: Partial<Record<EnrichableField, FieldProvenance>>,
): boolean {
  if (HOMED_FIELDS.has(field)) return readHomedValue(candidate, field) !== undefined;
  return Boolean(provenance[field]);
}

/**
 * Fields currently present on `candidate` — the live counterpart to
 * `CandidateEnrichment.coverage`. Homed fields (email/phone/headline/
 * location/company/skills) are read straight off the candidate; the three
 * homeless fields (experience/education/languages) fall back to whether an
 * enrichment attempt has ever recorded provenance for them.
 */
export function computeCoverage(candidate: Candidate): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) => isFieldCovered(candidate, field, candidate.enrichment?.fieldProvenance ?? {}));
}

function deriveStatus(coverage: EnrichableField[]): CandidateEnrichment["status"] {
  if (coverage.length === 0) return "unenriched";
  return COMMON_ENRICHMENT_FIELDS.every((f) => coverage.includes(f)) ? "enriched" : "partial";
}

/** Apply one field's new value onto the candidate. Returns the updated
 *  candidate, or null when the runtime value shape doesn't match what the
 *  field expects (defensive — a mismatched shape is treated as "no data",
 *  never recorded as provenance). */
function applyFieldValue(candidate: Candidate, field: EnrichableField, value: string | string[]): Candidate | null {
  switch (field) {
    case "email":
      return typeof value === "string" && value.trim() ? { ...candidate, email: value } : null;
    case "phone":
      return typeof value === "string" && value.trim() ? { ...candidate, phone: value } : null;
    case "headline":
      return typeof value === "string" && value.trim() ? { ...candidate, currentTitle: value } : null;
    case "location":
      return typeof value === "string" && value.trim() ? { ...candidate, location: value } : null;
    case "company":
      return typeof value === "string" && value.trim() ? { ...candidate, currentCompany: value } : null;
    case "skills": {
      if (!Array.isArray(value)) return null;
      const cleaned = value.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length === 0) return null;
      // De-dupe case-insensitively both against the existing list AND within
      // the incoming batch itself (a provider can return "Python"/"python").
      const seen = new Set(candidate.techStack.map((s) => s.toLowerCase()));
      const additions: string[] = [];
      for (const s of cleaned) {
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(s);
      }
      // No new items beyond what's already on techStack -> null, same as any
      // other field with nothing real to contribute. This matters because
      // "skills" is additive/union, not overwrite: once techStack is
      // non-empty (the common case — sourcing-time JD matching already seeds
      // it), gating on "already covered" would silently drop every later
      // provider's richer skill list. Returning null (rather than a same-
      // shape no-op candidate) lets the caller bypass that gate for this
      // field entirely and rely on "did applying it actually change
      // anything" instead.
      return additions.length ? { ...candidate, techStack: [...candidate.techStack, ...additions] } : null;
    }
    case "experience":
    case "education":
    case "languages": {
      // Homed to dedicated Candidate slots. Clean + drop empties; an all-blank
      // or non-array value contributes nothing real, so return null (no
      // provenance recorded) exactly like every other field.
      if (!Array.isArray(value)) return null;
      const cleaned = value.map((s) => s.trim()).filter(Boolean);
      return cleaned.length ? { ...candidate, [field]: cleaned } : null;
    }
    default:
      return null;
  }
}

/**
 * Fold one provider's enrichment results into `candidate`. For a scalar field,
 * the new value is accepted only if the candidate currently lacks it, or the
 * new confidence beats the confidence already recorded in
 * `enrichment.fieldProvenance[field]` — an absent confidence (either side) is
 * treated as `0` for this comparison, so a confident new value can still
 * overwrite a field that's merely present with no recorded confidence at all
 * (e.g. a value the candidate arrived with, never routed through this merge
 * gate), while an unconfident new value can never downgrade a field that
 * already has a defined, higher confidence on record. A `UNION_FIELDS` field
 * (currently just `skills`) instead always attempts to merge — it's additive,
 * so gating it on "already covered" would drop every later provider's
 * contribution after the first; `applyFieldValue` decides whether that merge
 * actually added anything. Accepted fields get their provenance recorded
 * (`{ provider: providerId, at, confidence }`); a single `EnrichmentAttempt`
 * is appended summarizing this call (`status: "ok"` when at least one field
 * was filled, `"no_data"` otherwise); `coverage` and `status` are recomputed
 * from the result.
 *
 * This function only ever produces `"ok"` / `"no_data"` attempts — attempts
 * for providers that couldn't run at all (`not_configured`, `no_key_field`,
 * `budget_exceeded`, `deferred`) or that errored belong to
 * `recordEnrichmentAttempt`.
 */
export function mergeEnrichment(candidate: Candidate, providerId: SourcePlatform, fields: EnrichedFields, at: string): Candidate {
  const current = candidate.enrichment ?? emptyEnrichment();
  const fieldProvenance: Partial<Record<EnrichableField, FieldProvenance>> = { ...current.fieldProvenance };
  const filled: EnrichableField[] = [];
  let next = candidate;

  for (const field of ENRICHABLE_FIELDS) {
    const result = fields[field];
    if (!result) continue;

    if (!UNION_FIELDS.has(field)) {
      const stored = fieldProvenance[field];
      const lacksIt = !isFieldCovered(next, field, fieldProvenance);
      // Missing confidence (stored or incoming) defaults to 0 — never let an
      // undefined stored confidence act as an implicit "infinitely
      // confident" wall that no new value could ever beat.
      const storedConfidence = stored?.confidence ?? 0;
      const newConfidence = result.confidence ?? 0;
      const beatsConfidence = newConfidence > storedConfidence;
      if (!lacksIt && !beatsConfidence) continue;
    }

    const applied = applyFieldValue(next, field, result.value);
    if (!applied) continue; // shape mismatch, or (for a union field) nothing new to add — not real data, don't record provenance

    next = applied;
    fieldProvenance[field] = { provider: providerId, at, confidence: result.confidence };
    filled.push(field);
  }

  const attempt: EnrichmentAttempt = {
    provider: providerId,
    at,
    status: filled.length > 0 ? "ok" : "no_data",
    fieldsFilled: filled,
    costUnits: 0,
  };

  next = { ...next, enrichment: { ...current, fieldProvenance, attempts: [...current.attempts, attempt] } };
  const coverage = computeCoverage(next);
  return { ...next, enrichment: { ...next.enrichment!, coverage, status: deriveStatus(coverage), lastEnrichedAt: at } };
}

/**
 * Append an `EnrichmentAttempt` that carries no field data of its own — the
 * orchestrator's path for providers that couldn't run (`not_configured`,
 * `no_key_field`, `budget_exceeded`, `deferred`) or that errored. Recomputes `coverage`
 * from the candidate's live data (unchanged by this call) and updates
 * `status`: `"failed"` only when this attempt's status is `"error"` AND
 * nothing has ever been filled (`coverage` is empty); otherwise `status`
 * follows the same unenriched -> partial -> enriched ladder as
 * `mergeEnrichment` and is never downgraded by a failed/skipped attempt.
 */
export function recordEnrichmentAttempt(candidate: Candidate, attempt: EnrichmentAttempt): Candidate {
  const current = candidate.enrichment ?? emptyEnrichment();
  const coverage = computeCoverage(candidate);
  const status: CandidateEnrichment["status"] = attempt.status === "error" && coverage.length === 0 ? "failed" : deriveStatus(coverage);
  return {
    ...candidate,
    enrichment: { ...current, attempts: [...current.attempts, attempt], coverage, status, lastEnrichedAt: attempt.at },
  };
}
