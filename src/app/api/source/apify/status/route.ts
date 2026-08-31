import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getRunStatus, fetchDatasetItems, resolveStoredApifyKey, apifyEmptySuccessIsQuota } from "@/lib/sourcing/apify";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";

export const runtime = "nodejs";

const TERMINAL_FAILED = new Set(["FAILED", "TIMED-OUT", "ABORTED"]);
const DATASET_ITEMS_LIMIT = 50;

/**
 * Poll an Apify actor run started by /api/source/apify/start. While in
 * progress: {status:"processing"}. On completion, fetches the run's dataset
 * items and returns the raw resolved profiles — mapping those into scored
 * Candidates (scoring/dedupe) happens client-side, the same split
 * /api/source/sillage/status uses.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-apify-status"), { windowMs: 60_000, max: 30 });
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

  const params = new URL(req.url).searchParams;
  const runId = params.get("runId");
  const datasetId = params.get("datasetId");
  if (!runId) return NextResponse.json({ ok: false, error: "runId is required." }, { status: 400 });

  const apiKey = session ? await resolveStoredApifyKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect an Apify key in Settings first." });
  }
  if (!session) return NextResponse.json({ ok: false, error: "Workspace authority is unavailable." }, { status: 503 });
  const { data: workspaceId } = await session.rpc("current_workspace_id");
  if (typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace authority is unavailable." }, { status: 503 });
  }

  const clearance = clearIdentityResolution("Apify", { runId, datasetId: datasetId ?? "" });
  if (!clearance.ok) return NextResponse.json({ ok: false, error: clearance.error }, { status: 422 });

  const statusRes = await getRunStatus(clearance.clearance, apiKey, runId);
  if (!statusRes.ok) {
    return NextResponse.json(
      { ok: false, status: statusRes.status, error: statusRes.detail || statusRes.title },
      { status: statusRes.status || 502 },
    );
  }

  const { status } = statusRes.data;
  if (TERMINAL_FAILED.has(status)) {
    const svc = getServiceSupabase();
    await svc?.rpc("settle_provider_run_by_external", {
      p_workspace_id: workspaceId,
      p_provider: "Apify",
      p_external_run_id: runId,
      p_succeeded: false,
    });
    return NextResponse.json({ ok: false, status: "failed", error: `Apify run ${status.toLowerCase()}.` });
  }
  if (status !== "SUCCEEDED") {
    return NextResponse.json({ ok: true, status: "processing" });
  }
  if (!datasetId) {
    return NextResponse.json({ ok: false, error: "datasetId is required." }, { status: 400 });
  }

  const itemsRes = await fetchDatasetItems(clearance.clearance, apiKey, datasetId, DATASET_ITEMS_LIMIT);
  if (!itemsRes.ok) {
    return NextResponse.json(
      { ok: false, status: itemsRes.status, error: itemsRes.detail || itemsRes.title },
      { status: itemsRes.status || 502 },
    );
  }

  const svc = getServiceSupabase();
  await svc?.rpc("settle_provider_run_by_external", {
    p_workspace_id: workspaceId,
    p_provider: "Apify",
    p_external_run_id: runId,
    p_succeeded: true,
  });

  return NextResponse.json({ ok: true, status: "completed", profiles: itemsRes.data });
}
