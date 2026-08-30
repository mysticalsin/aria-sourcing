import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DEFAULT_SOURCING_BATCH_SIZE, TOP_CANDIDATE_SHORTLIST_SIZE } from "@/lib/recruiting-loop/constants";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import { resolveStoredApifyKeyForWorkspace } from "@/lib/sourcing/apify";
import { runMultiProviderSourcing } from "@/lib/sourcing/orchestrator";
import { resolveStoredSmartKeyForWorkspace } from "@/lib/sourcing/smart";
import { resolveStoredTavilyKeyForWorkspace } from "@/lib/sourcing/tavily";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { ScoringWeights } from "@/lib/types";
import { loadCampaignForLoop } from "@/lib/workspace-loop-slices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(100),
  count: z.number().int().min(1).max(20).optional(),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return (
    secret !== "" &&
    presentedBuf.length === expectedBuf.length &&
    timingSafeEqual(presentedBuf, expectedBuf)
  );
}

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, status: "service_unavailable" }, { status: 503 });
  }

  const campaign = await loadCampaignForLoop(svc, parsed.data.workspaceId, parsed.data.campaignId);
  if (!campaign?.jobAnalysis) {
    return NextResponse.json({ ok: false, status: "campaign_not_found" }, { status: 404 });
  }

  const count = parsed.data.count ?? Math.max(DEFAULT_SOURCING_BATCH_SIZE, TOP_CANDIDATE_SHORTLIST_SIZE);

  let weights: ScoringWeights | undefined = campaign.scoringWeights;
  if (!weights) {
    const weightsRes = await svc.rpc("read_workspace_scoring_weights_for_loop", {
      p_workspace_id: parsed.data.workspaceId,
    });
    const weightsBody = weightsRes.data as { status?: string; scoringWeights?: ScoringWeights } | null;
    if (!weightsRes.error && weightsBody?.status === "ok" && weightsBody.scoringWeights) {
      weights = weightsBody.scoringWeights;
    }
  }
  if (!weights) {
    return NextResponse.json({ ok: false, status: "scoring_weights_missing" }, { status: 503 });
  }

  const identities = await svc.rpc("read_workspace_candidate_identities_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
    p_campaign_id: parsed.data.campaignId,
    p_limit: 500,
  });
  const identityBody = identities.data as {
    status?: string;
    candidates?: CandidateDedupeIdentity[];
  } | null;
  const existing: CandidateDedupeIdentity[] =
    !identities.error && identityBody?.status === "ok" && Array.isArray(identityBody.candidates)
      ? identityBody.candidates
      : [];

  const [linkedInProfileToken, workspaceTavilyKey, smartApiKey] = await Promise.all([
    resolveStoredApifyKeyForWorkspace(parsed.data.workspaceId),
    resolveStoredTavilyKeyForWorkspace(parsed.data.workspaceId),
    resolveStoredSmartKeyForWorkspace(parsed.data.workspaceId),
  ]);

  const result = await runMultiProviderSourcing({
    campaign,
    existing,
    weights,
    count,
    githubToken: process.env.GITHUB_TOKEN ?? "",
    tavilyKey: workspaceTavilyKey ?? process.env.TAVILY_API_KEY,
    linkedInProfileToken,
    smartApiKey,
  });

  const accepted = [...result.accepted]
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, count);

  return NextResponse.json({
    ok: true,
    status: "completed",
    campaignId: campaign.id,
    candidateIds: accepted.map((c) => c.id),
    candidates: accepted,
    providersUsed: result.providersUsed,
    executions: result.executions.map((e) => ({
      providerId: e.providerId,
      platform: e.platform,
      ok: e.ok,
      candidateCount: e.candidateCount,
    })),
  });
}
