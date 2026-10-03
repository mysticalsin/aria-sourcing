import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getRunStatus, fetchDatasetItems, resolveStoredApifyKeyForWorkspace } from "@/lib/sourcing/apify";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";
import { mapApifyCandidates } from "@/lib/store/sourcing-helpers";
import type { Campaign, Candidate } from "@/lib/types";

export const dynamic = "force-dynamic";

const TERMINAL_FAILED = new Set(["FAILED", "TIMED-OUT", "ABORTED"]);
const DATASET_ITEMS_LIMIT = 50;

const PollBodySchema = z.object({
  workspaceId: z.string().uuid(),
  providerRunId: z.string().uuid(),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return secret !== ""
    && presentedBuf.length === expectedBuf.length
    && timingSafeEqual(presentedBuf, expectedBuf);
}

function campaignFromState(state: unknown, campaignId: string): Campaign | null {
  const root = state && typeof state === "object" ? state as { campaigns?: unknown[] } : {};
  const campaign = Array.isArray(root.campaigns)
    ? root.campaigns.find((item) => (item as { id?: unknown })?.id === campaignId)
    : null;
  return campaign && typeof campaign === "object" ? campaign as Campaign : null;
}

function candidatesFromState(state: unknown): Candidate[] {
  const root = state && typeof state === "object" ? state as { candidates?: unknown[] } : {};
  return Array.isArray(root.candidates) ? root.candidates.filter((item): item is Candidate => Boolean(item && typeof item === "object")) : [];
}

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = PollBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });

  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ ok: false, status: "service_unavailable" }, { status: 503 });

  const run = await supabase.rpc("read_provider_run_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
    p_run_id: parsed.data.providerRunId,
  });
  const runData = run.data as {
    status?: string;
    provider?: string;
    external_run_id?: string;
    dataset_id?: string;
    campaign_id?: string;
    run_status?: string;
  } | null;
  if (run.error || runData?.status !== "ok") {
    return NextResponse.json({ ok: false, status: runData?.status ?? "run_unavailable" }, { status: 409 });
  }
  if (runData.run_status === "failed") return NextResponse.json({ ok: false, status: "failed" });
  if (runData.provider !== "Apify") return NextResponse.json({ ok: false, status: "unsupported_provider" }, { status: 400 });
  if (!runData.external_run_id || runData.external_run_id.startsWith("pending:")) {
    return NextResponse.json({ ok: true, status: "processing" });
  }

  const apiKey = await resolveStoredApifyKeyForWorkspace(parsed.data.workspaceId);
  if (!apiKey) return NextResponse.json({ ok: false, status: "not_configured" }, { status: 409 });

  const clearance = clearIdentityResolution("Apify", {
    runId: runData.external_run_id,
    datasetId: runData.dataset_id ?? "",
  });
  if (!clearance.ok) return NextResponse.json({ ok: false, status: "policy_refused" }, { status: 422 });

  const statusRes = await getRunStatus(clearance.clearance, apiKey, runData.external_run_id);
  if (!statusRes.ok) return NextResponse.json({ ok: false, status: "provider_error" }, { status: statusRes.status || 502 });

  if (TERMINAL_FAILED.has(statusRes.data.status)) {
    await supabase.rpc("settle_provider_run", { p_run_id: parsed.data.providerRunId, p_succeeded: false });
    return NextResponse.json({ ok: false, status: "failed" });
  }
  if (statusRes.data.status !== "SUCCEEDED") {
    return NextResponse.json({ ok: true, status: "processing" });
  }
  if (!runData.dataset_id) return NextResponse.json({ ok: false, status: "dataset_missing" }, { status: 409 });

  const itemsRes = await fetchDatasetItems(clearance.clearance, apiKey, runData.dataset_id, DATASET_ITEMS_LIMIT);
  if (!itemsRes.ok) return NextResponse.json({ ok: false, status: "provider_error" }, { status: itemsRes.status || 502 });

  const snapshot = await supabase.rpc("read_workspace_state_for_loop", { p_workspace_id: parsed.data.workspaceId });
  const snapshotData = snapshot.data as { status?: string; state?: unknown } | null;
  if (snapshot.error || snapshotData?.status !== "ok") {
    return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 409 });
  }
  const campaign = campaignFromState(snapshotData.state, runData.campaign_id ?? "");
  if (!campaign) return NextResponse.json({ ok: false, status: "campaign_unavailable" }, { status: 409 });

  const existing = candidatesFromState(snapshotData.state);
  const mapped = mapApifyCandidates(itemsRes.data, campaign, "Apify provider run", existing);
  await supabase.rpc("settle_provider_run", { p_run_id: parsed.data.providerRunId, p_succeeded: true });

  return NextResponse.json({
    ok: true,
    status: "completed",
    campaignId: campaign.id,
    batchId: parsed.data.providerRunId,
    candidates: mapped.accepted,
    skippedCount: mapped.skipped.length,
  });
}
