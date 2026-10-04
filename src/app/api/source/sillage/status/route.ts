import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { experimentalPaidSourcingEnabled, supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getMappingStage, findMappingId, getCompanyMapping, resolveStoredSillageKey } from "@/lib/sourcing/sillage";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";

/**
 * Poll a Sillage account-mapping job. While in progress: {status:"processing"}.
 * On completion: resolves the mapping id via list-company-mappings (free) and
 * returns the raw resolved company + profiles — mapping those into scored
 * Candidates happens client-side in store.ts (checkSillageMapping), the same
 * split /api/source/route.ts uses for GitHub/web results (this route has no
 * access to the campaign's job analysis or scoring weights, which live only in
 * the client-side store).
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!experimentalPaidSourcingEnabled) {
    return NextResponse.json(
      { ok: false, error: "Sillage is unavailable until server-owned provider receipts are enabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rl = checkRateLimit(rateLimitKey(req, "source-sillage-status"), { windowMs: 60_000, max: 30 });
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

  const requestId = new URL(req.url).searchParams.get("requestId");
  if (!requestId) return NextResponse.json({ ok: false, error: "requestId is required." }, { status: 400 });

  const apiKey = session ? await resolveStoredSillageKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect a Sillage key in Settings first." });
  }

  const clearance = clearIdentityResolution("Sillage", { requestId });
  if (!clearance.ok) return NextResponse.json({ ok: false, error: clearance.error }, { status: 422 });

  const stageRes = await getMappingStage(clearance.clearance, apiKey, requestId);
  if (!stageRes.ok) {
    return NextResponse.json(
      { ok: false, status: stageRes.status, error: stageRes.detail || stageRes.title },
      { status: stageRes.status || 502 },
    );
  }

  const { stage, company } = stageRes.data;
  if (stage === "account_mapping_failed") {
    return NextResponse.json({ ok: false, status: "failed", error: "Sillage enrichment failed for this company." });
  }
  if (stage !== "completed") {
    return NextResponse.json({ ok: true, status: "processing" });
  }

  const mappingIdRes = await findMappingId(clearance.clearance, apiKey, { id: company.id, domain: company.domain });
  if (!mappingIdRes.ok) {
    return NextResponse.json(
      { ok: false, status: mappingIdRes.status, error: mappingIdRes.detail || mappingIdRes.title },
      { status: mappingIdRes.status || 502 },
    );
  }
  if (!mappingIdRes.data) {
    return NextResponse.json({
      ok: false,
      status: "failed",
      error: "Mapping completed but no matching company-mapping record was found.",
    });
  }

  const mappingRes = await getCompanyMapping(clearance.clearance, apiKey, mappingIdRes.data);
  if (!mappingRes.ok) {
    return NextResponse.json(
      { ok: false, status: mappingRes.status, error: mappingRes.detail || mappingRes.title },
      { status: mappingRes.status || 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: "completed",
    company: mappingRes.data.company,
    profiles: mappingRes.data.profiles,
  });
}
