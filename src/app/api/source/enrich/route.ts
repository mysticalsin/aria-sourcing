import { isDeepStrictEqual } from "node:util";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { orchestrateEnrichment } from "@/lib/enrichment/orchestrator";
import { enrichmentBasis, enrichmentPatch, enrichmentOutcome } from "@/lib/enrichment/result";
import { candidateEnrichmentBlocker } from "@/lib/candidate-review";
import { effectiveWeights } from "@/lib/skills";
import { ENRICHABLE_FIELDS, type EnrichableField, type HermesState, type Role } from "@/lib/types";

export const runtime = "nodejs";
const MAX_ENRICH_UNITS_PER_REQUEST = 10;
const fields = ENRICHABLE_FIELDS as unknown as [EnrichableField, ...EnrichableField[]];
const EnrichBodySchema = z.object({
  candidateId: z.string().min(1).max(200),
  want: z.array(z.enum(fields)).min(1).max(ENRICHABLE_FIELDS.length),
  budgetRemaining: z.number().finite().min(0).optional(),
}).strict();
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return json({ ok: false, error: "Enrichment requires a connected workspace." }, 503);
  const session = await getServerSupabase();
  if (!session) return json({ ok: false, error: "Workspace unavailable." }, 503);
  const { data: { user } } = await session.auth.getUser();
  if (!user) return json({ ok: false, error: "Not authenticated." }, 401);
  const [role, workspace] = await Promise.all([session.rpc("current_profile_role"), session.rpc("current_workspace_id")]);
  if (role.error || workspace.error || typeof workspace.data !== "string" || !can(role.data as Role, "source")) {
    return json({ ok: false, error: "Insufficient sourcing authority." }, 403);
  }
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({ ok: false, error: "Cross-origin enrichment is not allowed." }, 403);
  const rl = checkRateLimit(rateLimitKey(req, `source-enrich:${workspace.data}:${user.id}`), { windowMs: 60_000, max: 15 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, EnrichBodySchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { candidateId, want, budgetRemaining } = validated.data;

  const load = async () => {
    const [currentRole, currentWorkspace, { data: auth }] = await Promise.all([
      session.rpc("current_profile_role"), session.rpc("current_workspace_id"), session.auth.getUser(),
    ]);
    if (auth.user?.id !== user.id || currentRole.error || currentWorkspace.error || currentWorkspace.data !== workspace.data || !can(currentRole.data as Role, "source")) return null;
    const { data, error } = await session.from("workspace_state").select("state").eq("workspace_id", workspace.data).single();
    if (error || !Array.isArray(data?.state?.candidates) || !Array.isArray(data?.state?.campaigns)) return null;
    const state = data.state as HermesState;
    const candidate = state.candidates.find((c) => c.id === candidateId);
    const campaign = state.campaigns.find((c) => c.id === candidate?.campaignId);
    return { state, candidate, campaign };
  };
  try {
    const saved = await load();
    if (!saved) return json({ ok: false, error: "Workspace authority unavailable." }, 503);
    if (!saved.candidate) return json({ ok: false, error: "Candidate not found in this workspace." }, 404);
    const blocker = candidateEnrichmentBlocker(saved.candidate, saved.campaign);
    if (blocker || !saved.campaign) return json({ ok: false, error: blocker ?? "Campaign unavailable." }, 409);
    // All profile evidence and scoring input comes from persisted workspace state.
    const result = await orchestrateEnrichment({ session, candidate: saved.candidate, want: [...new Set(want)],
      budgetRemaining: Math.min(budgetRemaining ?? MAX_ENRICH_UNITS_PER_REQUEST, MAX_ENRICH_UNITS_PER_REQUEST),
      jd: saved.campaign.jobAnalysis, weights: effectiveWeights(saved.campaign.scoringWeights, saved.state.skills),
    });
    const latest = await load();
    if (!latest?.candidate || candidateEnrichmentBlocker(latest.candidate, latest.campaign)
      || !isDeepStrictEqual(enrichmentBasis(saved.candidate), enrichmentBasis(latest.candidate))
      || !isDeepStrictEqual(saved.campaign.jobAnalysis, latest.campaign?.jobAnalysis)
      || !isDeepStrictEqual(saved.campaign.scoringWeights, latest.campaign?.scoringWeights)
      || !isDeepStrictEqual(saved.state.skills, latest.state.skills)) {
      return json({ ok: false, error: "Candidate or campaign changed during enrichment. Reload and review; do not automatically repeat a paid request." }, 409);
    }
    const outcome = enrichmentOutcome(result.attempts);
    // A completed API request is distinct from provider success. Return attempts
    // even on provider refusal, so the caller can persist the honest audit trail.
    return json({ ok: true, patch: enrichmentPatch(result.candidate), attempts: result.attempts,
      spend: result.spend, outcome });
  } catch {
    return json({ ok: false, error: "Enrichment could not complete. Check the provider before starting another paid request." }, 502);
  }
}
