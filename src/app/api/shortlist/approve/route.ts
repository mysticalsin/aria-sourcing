import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { swarmRequestBoundary } from "@/lib/api/swarm-request-boundary";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "@/lib/recruiting-loop/constants";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CandidateIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);

const ApprovalSchema = z
  .object({
    // Enterprise loop shortlist is top-10; human approve must not enqueue beyond that.
    candidateIds: z.array(CandidateIdSchema).min(1).max(TOP_CANDIDATE_SHORTLIST_SIZE),
  })
  .strict()
  .superRefine((value, context) => {
    const unique = new Set(value.candidateIds);
    if (unique.size !== value.candidateIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateIds"],
        message: "Candidate ids must be unique.",
      });
    }
  });

type CandidateRow = {
  id: string;
  campaign_id: string;
};

type EnqueueResult = {
  status?: string;
  id?: string;
  replay?: boolean;
};

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function enqueueErrorStatus(status: string): number {
  if (status === "control_blocked") return 403;
  if (status === "idempotency_conflict") return 409;
  if (status === "invalid_request") return 400;
  return 503;
}

export async function POST(req: NextRequest) {
  const boundary = swarmRequestBoundary(req);
  if (boundary) return boundary;

  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) {
    return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);
  }

  const [{ data: auth }, { data: workspaceId, error: workspaceError }] = await Promise.all([
    session.auth.getUser(),
    session.rpc("current_workspace_id"),
  ]);
  const actorId = auth.user?.id;
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId || !actorId) {
    return noStoreJson({ ok: false, error: "Workspace unresolved." }, 403);
  }

  const limit = checkRateLimit(rateLimitKey(req, "shortlist-approval", actorId), {
    windowMs: 60_000,
    max: 20,
  });
  if (!limit.ok) {
    const response = noStoreJson({ ok: false, error: "Rate limited." }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }

  const body = await validateBody(req, ApprovalSchema, { maxBytes: 8_000 });
  if (!body.ok) return body.response;

  const service = getServiceSupabase();
  if (!service) {
    return noStoreJson({ ok: false, error: "Draft approval authority unavailable." }, 503);
  }

  const enabled = await service.rpc("sourcing_loop_stage_enabled", {
    p_workspace_id: workspaceId,
    p_kind: "draft_generate",
  });
  if (enabled.error) {
    return noStoreJson({ ok: false, error: "Draft approval authority unavailable." }, 503);
  }
  if (enabled.data !== true) {
    return noStoreJson({ ok: false, error: "Sourcing is disabled for this workspace." }, 403);
  }

  const candidateIds = body.data.candidateIds;
  const selected = await service
    .from("candidates")
    .select("id,campaign_id")
    .eq("workspace_id", workspaceId)
    .in("id", candidateIds);

  if (selected.error || !Array.isArray(selected.data)) {
    return noStoreJson({ ok: false, error: "Candidate validation failed." }, 503);
  }

  const rows = selected.data as CandidateRow[];
  const rowsByCandidate = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.campaign_id !== "string") continue;
    const existing = rowsByCandidate.get(row.id) ?? [];
    existing.push(row);
    rowsByCandidate.set(row.id, existing);
  }

  const missing = candidateIds.filter((candidateId) => !rowsByCandidate.has(candidateId));
  if (missing.length > 0) {
    return noStoreJson({ ok: false, error: "Candidate not found in this workspace." }, 404);
  }
  const ambiguous = [...rowsByCandidate.entries()]
    .filter(([, candidateRows]) => candidateRows.length !== 1)
    .map(([candidateId]) => candidateId);
  if (ambiguous.length > 0) {
    return noStoreJson({ ok: false, error: "Candidate approval is ambiguous." }, 409);
  }

  const jobs: Array<{ candidateId: string; campaignId: string; jobId: string; replay: boolean }> = [];
  for (const candidateId of candidateIds) {
    const candidate = rowsByCandidate.get(candidateId)?.[0];
    if (!candidate) {
      return noStoreJson({ ok: false, error: "Candidate validation failed." }, 503);
    }
    const enqueue = await service.rpc("enqueue_aria_job", {
      p_workspace_id: workspaceId,
      p_kind: "draft_generate",
      p_idempotency_key: `draft:${candidate.campaign_id}:${candidate.id}`,
      p_payload: {
        campaignId: candidate.campaign_id,
        candidateId: candidate.id,
        approvedBy: actorId,
        approvalSource: "human",
      },
      p_run_at: new Date().toISOString(),
      p_priority: 80,
    });
    const result = enqueue.data as EnqueueResult | null;
    if (enqueue.error || result?.status !== "enqueued" || typeof result.id !== "string") {
      const status = result?.status ?? enqueue.error?.code ?? "enqueue_failed";
      return noStoreJson({ ok: false, error: "Draft enqueue failed.", status }, enqueueErrorStatus(status));
    }
    jobs.push({
      candidateId: candidate.id,
      campaignId: candidate.campaign_id,
      jobId: result.id,
      replay: result.replay === true,
    });
  }

  return noStoreJson({ ok: true, jobs });
}
