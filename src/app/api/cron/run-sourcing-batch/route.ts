import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DEFAULT_SOURCING_BATCH_SIZE, TOP_CANDIDATE_SHORTLIST_SIZE } from "@/lib/recruiting-loop/constants";
import { resolveStoredApifyKeyForWorkspace } from "@/lib/sourcing/apify";
import { runMultiProviderSourcing } from "@/lib/sourcing/orchestrator";
import { resolveStoredTavilyKeyForWorkspace } from "@/lib/sourcing/tavily";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Candidate, Campaign, ScoringWeights } from "@/lib/types";

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

  const snapshot = await svc.rpc("read_workspace_state_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const body = snapshot.data as {
    status?: string;
    state?: { campaigns?: Campaign[]; candidates?: Candidate[]; settings?: { scoringWeights?: ScoringWeights } };
  } | null;
  if (snapshot.error || body?.status !== "ok" || !body.state) {
    return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 503 });
  }

  const campaign = (body.state.campaigns ?? []).find((c) => c.id === parsed.data.campaignId);
  if (!campaign?.jobAnalysis) {
    return NextResponse.json({ ok: false, status: "campaign_not_found" }, { status: 404 });
  }

  const count = parsed.data.count ?? Math.max(DEFAULT_SOURCING_BATCH_SIZE, TOP_CANDIDATE_SHORTLIST_SIZE);
  const weights = campaign.scoringWeights ?? body.state.settings?.scoringWeights;
  if (!weights) {
    return NextResponse.json({ ok: false, status: "scoring_weights_missing" }, { status: 503 });
  }

  const [linkedInProfileToken, workspaceTavilyKey] = await Promise.all([
    resolveStoredApifyKeyForWorkspace(parsed.data.workspaceId),
    resolveStoredTavilyKeyForWorkspace(parsed.data.workspaceId),
  ]);

  const result = await runMultiProviderSourcing({
    campaign,
    existing: body.state.candidates ?? [],
    weights,
    count,
    githubToken: process.env.GITHUB_TOKEN ?? "",
    tavilyKey: workspaceTavilyKey ?? process.env.TAVILY_API_KEY,
    linkedInProfileToken,
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
