import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { initialsFrom } from "@/lib/utils";
import { orchestrateEnrichment } from "@/lib/enrichment/orchestrator";
import { ENRICHMENT_PROVIDERS } from "@/lib/enrichment/registry";
import { recordEnrichmentAttempt } from "@/lib/enrichment/merge";
import {
  ENRICHABLE_FIELDS,
  SOURCE_PLATFORMS,
  type Candidate,
  type CandidateEnrichment,
  type EnrichableField,
  type EnrichmentAttempt,
  type MatchBreakdownItem,
  type Role,
  type SourcePlatform,
} from "@/lib/types";

export const runtime = "nodejs";

/**
 * Unified cross-provider enrichment
 * (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md, "Routes").
 * Runs the cost-ordered waterfall (orchestrateEnrichment) against every
 * configured provider (Apify dev_fusion, Apollo, Seamless, Sillage) that can
 * resolve an identity from the candidate's universal fields (name, company,
 * linkedinUrl, email, externalIds) and fill at least one `want` field —
 * cheapest first, stopping once `want` is covered or the budget runs out.
 * Providers without a stored key report "not_configured" (graceful, never an
 * error); no key is ever accepted from the client or returned in the
 * response. Mirrors the guard chain in /api/source/apollo/enrich.
 */

const ENRICHABLE_FIELD_VALUES = ENRICHABLE_FIELDS as unknown as [EnrichableField, ...EnrichableField[]];
const SOURCE_PLATFORM_VALUES = SOURCE_PLATFORMS as unknown as [SourcePlatform, ...SourcePlatform[]];

/** Hard server-side ceiling on spend per enrichment request, in registry cost
 *  units. `budgetRemaining` in the request body is client-supplied (the store
 *  computes it from client-held state — see store.ts's enrichCandidate) and
 *  defaults to unlimited when omitted, so it's only ever a hint, never
 *  authoritative: a client could send any number, or none at all. Clamping to
 *  this constant means a single request can never authorize more spend than
 *  the server allows, regardless of what the client sends.
 *  v2 seam: replace this per-request constant with a full ledger-based
 *  per-workspace budget read from `workspace_state` (mirroring
 *  `state.enrichmentBudgetUnits`/`enrichmentLedger` client-side today), so the
 *  ceiling is enforced across the whole workspace's spend, not just one call. */
const MAX_ENRICH_UNITS_PER_REQUEST = 10;

// Loose validation for the enrichment sub-object the client may echo back
// (e.g. re-running the waterfall on a candidate enriched in an earlier call)
// — string-keyed records rather than exact-enum records so a shape the
// client's own JSON round-trip produces is never spuriously rejected; the
// domain-typed cast happens once, in buildCandidate.
const FieldProvenanceSchema = z.object({
  provider: z.enum(SOURCE_PLATFORM_VALUES),
  at: z.string().max(60),
  confidence: z.number().min(0).max(1).optional(),
});

const EnrichmentAttemptSchema = z.object({
  provider: z.enum(SOURCE_PLATFORM_VALUES),
  at: z.string().max(60),
  status: z.enum(["ok", "no_data", "not_configured", "no_key_field", "budget_exceeded", "error", "deferred"]),
  fieldsFilled: z.array(z.enum(ENRICHABLE_FIELD_VALUES)).max(20),
  costUnits: z.number(),
  detail: z.string().max(500).optional(),
});

const CandidateEnrichmentSchema = z.object({
  status: z.enum(["unenriched", "partial", "enriched", "failed"]),
  lastEnrichedAt: z.string().max(60).optional(),
  fieldProvenance: z.record(z.string(), FieldProvenanceSchema),
  attempts: z.array(EnrichmentAttemptSchema).max(200),
  coverage: z.array(z.enum(ENRICHABLE_FIELD_VALUES)),
});

// Minimal Candidate subset the runners/orchestrator/merge actually read
// (see runners.ts, merge.ts) — everything else is defaulted server-side in
// buildCandidate. `.passthrough()` lets the client send its full Candidate
// object without this route having to mirror every field on the domain type.
const CandidateInputSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(300),
    sourcePlatform: z.enum(SOURCE_PLATFORM_VALUES),
    campaignId: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
    phone: z.string().max(50).optional(),
    currentTitle: z.string().max(300).optional(),
    currentCompany: z.string().max(300).optional(),
    location: z.string().max(300).optional(),
    linkedinUrl: z.string().max(500).optional(),
    githubUrl: z.string().max(500).optional(),
    techStack: z.array(z.string().max(100)).max(200).optional(),
    matchScore: z.number().optional(),
    matchBreakdown: z.array(z.unknown()).max(50).optional(),
    externalIds: z.record(z.string(), z.string().max(300)).optional(),
    enrichment: CandidateEnrichmentSchema.optional(),
  })
  .passthrough();

const EnrichBodySchema = z.object({
  candidate: CandidateInputSchema,
  want: z.array(z.enum(ENRICHABLE_FIELD_VALUES)).min(1).max(ENRICHABLE_FIELDS.length),
  budgetRemaining: z.number().min(0).optional(),
});

type CandidateInput = z.infer<typeof CandidateInputSchema>;

/** Fill every Candidate field the client's minimal input omits with a safe,
 *  inert default — same shape mapApifyCandidates (sourcing-helpers.ts) builds
 *  for a sourced candidate, so orchestrateEnrichment/mergeEnrichment see an
 *  ordinary Candidate regardless of which route constructed it. Only the
 *  fields the waterfall actually reads (name, currentCompany, linkedinUrl,
 *  email, phone, currentTitle, location, techStack, externalIds, enrichment)
 *  come from the client; the rest (outreach history, compliance flags, stage,
 *  …) are harmless defaults this route never needs — no `jd`/`weights` is
 *  passed to orchestrateEnrichment here, so the candidate is enriched but not
 *  re-scored (matchScore/matchBreakdown pass through unchanged). */
function buildCandidate(input: CandidateInput): Candidate {
  return {
    id: input.id,
    campaignId: input.campaignId ?? "",
    name: input.name,
    email: input.email ?? "",
    phone: input.phone,
    avatarInitials: initialsFrom(input.name),
    currentTitle: input.currentTitle ?? "",
    currentCompany: input.currentCompany ?? "",
    location: input.location ?? "",
    timezone: "",
    linkedinUrl: input.linkedinUrl ?? "",
    githubUrl: input.githubUrl ?? "",
    externalIds: input.externalIds as Partial<Record<SourcePlatform, string>> | undefined,
    sourcePlatform: input.sourcePlatform,
    sourceQuery: "",
    matchScore: input.matchScore ?? 0,
    matchBreakdown: (input.matchBreakdown ?? []) as MatchBreakdownItem[],
    techStack: input.techStack ?? [],
    yearsExperience: 0,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    enrichment: input.enrichment as CandidateEnrichment | undefined,
  };
}

/** Demo-mode / no-session path: no stored key can exist without a real
 *  Supabase session (resolveStored*Key all read `api_keys` via the session),
 *  so every provider that would otherwise be eligible is recorded as
 *  "not_configured" without ever attempting a network call — graceful, not
 *  an error, exactly like the guarded routes' own no-key fallback. */
function enrichWithoutSession(
  candidate: Candidate,
  want: EnrichableField[],
): { candidate: Candidate; attempts: EnrichmentAttempt[]; spend: number } {
  const attempts: EnrichmentAttempt[] = [];
  let next = candidate;
  const providers = ENRICHMENT_PROVIDERS.filter(
    (provider) => want.some((field) => provider.enriches.includes(field)) && provider.keyField(candidate) != null,
  );
  for (const provider of providers) {
    const attempt: EnrichmentAttempt = {
      provider: provider.id,
      at: new Date().toISOString(),
      status: "not_configured",
      fieldsFilled: [],
      costUnits: 0,
      detail: "No authenticated session — connect provider keys in Settings → API Keys.",
    };
    next = recordEnrichmentAttempt(next, attempt);
    attempts.push(attempt);
  }
  return { candidate: next, attempts, spend: 0 };
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-enrich"), { windowMs: 60_000, max: 15 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, EnrichBodySchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { candidate: candidateInput, want, budgetRemaining } = validated.data;

  const candidate = buildCandidate(candidateInput);
  // Never trust the client's number over the server ceiling — a missing
  // value is clamped to the ceiling too, not to Infinity.
  const effectiveBudget = Math.min(budgetRemaining ?? MAX_ENRICH_UNITS_PER_REQUEST, MAX_ENRICH_UNITS_PER_REQUEST);

  try {
    const result = session
      ? await orchestrateEnrichment({ session, candidate, want, budgetRemaining: effectiveBudget })
      : enrichWithoutSession(candidate, want);
    const enriched = result.candidate;

    return NextResponse.json({
      ok: true,
      patch: {
        enrichment: enriched.enrichment,
        email: enriched.email,
        phone: enriched.phone,
        currentTitle: enriched.currentTitle,
        location: enriched.location,
        currentCompany: enriched.currentCompany,
        techStack: enriched.techStack,
        externalIds: enriched.externalIds,
        matchScore: enriched.matchScore,
        matchBreakdown: enriched.matchBreakdown,
      },
      attempts: result.attempts,
      spend: result.spend,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Enrichment failed.";
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }
}
