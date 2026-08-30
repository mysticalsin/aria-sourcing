import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { loadSourcingCampaign } from "@/lib/sourcing/campaign-context";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import {
  resolveStoredSmartKey,
  searchSmartResumes,
  selectBestSmartMatches,
  SMART_DEFAULT_RANK_WINDOW,
  smartForceMock,
} from "@/lib/sourcing/smart";
import { mapSmartCandidates } from "@/lib/sourcing/smart-map";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SmartSearchSchema = z
  .object({
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    count: z.number().int().min(1).max(50).default(10),
    keywords: z.string().max(500).optional(),
    rankWindow: z.number().int().min(10).max(100).optional(),
  })
  .strict();

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": randomUUID(),
    },
  });
}

/** Pull ranked SMART Cvtheque/OCR resumes for a campaign JD. */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return noStoreJson({ ok: false, error: "Untrusted origin." }, 403);
  }

  // Live authority required except forced mock for local contract tests.
  if (!supabaseEnabled && !smartForceMock()) {
    return noStoreJson(
      {
        ok: false,
        code: "SMART_AUTHORITY_UNAVAILABLE",
        error: "Live sourcing authority is unavailable.",
      },
      503,
    );
  }

  if (!supabaseEnabled && smartForceMock()) {
    return noStoreJson(
      {
        ok: false,
        code: "SMART_AUTHORITY_UNAVAILABLE",
        error: "SMART mock search still needs a workspace campaign context (Supabase).",
      },
      503,
    );
  }

  const session = await getServerSupabase();
  if (!session) {
    return noStoreJson({ ok: false, error: "No Supabase client." }, 500);
  }
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return noStoreJson({ ok: false, error: "Unauthorized." }, 401);

  const [{ data: role }, { data: workspaceId }] = await Promise.all([
    session.rpc("current_profile_role"),
    session.rpc("current_workspace_id"),
  ]);
  if (!can(role as Role, "source")) {
    return noStoreJson({ ok: false, error: "Forbidden." }, 403);
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    return noStoreJson({ ok: false, error: "Workspace not found." }, 400);
  }

  const rl = checkRateLimit(rateLimitKey(req, "source-smart-search", user.id), {
    windowMs: 60_000,
    max: 20,
  });
  if (!rl.ok) return noStoreJson({ ok: false, error: "Rate limited." }, 429);

  const validated = await validateBody(req, SmartSearchSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { campaignId, keywords, rankWindow } = validated.data;
  const count = validated.data.count ?? 10;

  const campaign = await loadSourcingCampaign(session, campaignId, workspaceId);
  if (!campaign) return noStoreJson({ ok: false, error: "Campaign not found." }, 404);

  const apiKey = await resolveStoredSmartKey(session);
  const clearance = clearDiscoveryCriteria(
    "SMART",
    {
      title: campaign.jobAnalysis.title,
      skills: campaign.jobAnalysis.requiredSkills.slice(0, 8),
      query: keywords?.trim() || campaign.jobAnalysis.title,
    },
    campaign,
  );
  if (!clearance.ok) {
    return noStoreJson({ ok: false, error: clearance.error }, 400);
  }

  const window = rankWindow ?? Math.min(Math.max(count * 3, SMART_DEFAULT_RANK_WINDOW), 100);
  const searched = await searchSmartResumes(
    clearance.clearance,
    {
      title: campaign.jobAnalysis.title,
      requiredSkills: campaign.jobAnalysis.requiredSkills,
      niceToHaveSkills: campaign.jobAnalysis.niceToHaveSkills,
      regions: campaign.jobAnalysis.regions,
      keywords: keywords?.trim() || undefined,
      limit: window,
    },
    apiKey,
  );

  if (!searched.ok) {
    const status = searched.status === 503 || searched.status === 0 ? 503 : searched.status || 502;
    return noStoreJson(
      {
        ok: false,
        code: "SMART_NOT_CONFIGURED_OR_FAILED",
        error: searched.detail || searched.title,
        mode: searched.mode,
      },
      status,
    );
  }

  const best = selectBestSmartMatches(searched.data.results, count);
  const mapped = mapSmartCandidates(
    best,
    campaign,
    keywords?.trim() || campaign.jobAnalysis.title,
    [],
    campaign.scoringWeights,
  );

  return noStoreJson({
    ok: true,
    source: "smart",
    mode: searched.mode,
    rankWindow: window,
    totalFromSmart: searched.data.total,
    profiles: best,
    candidates: mapped.accepted,
    skipped: mapped.skipped,
  });
}
