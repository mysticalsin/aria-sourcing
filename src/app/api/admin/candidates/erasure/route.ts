import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { classifySameOriginJsonRequest } from "@/lib/api/same-origin-json";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import {
  getServerSupabase,
  getServiceSupabase,
  requireAdmin,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Identifier = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const RequestSchema = z.object({
  campaignId: Identifier,
  candidateId: Identifier,
}).strict();
const ScrubCountsSchema = z.record(z.string(), z.number().int().nonnegative()).refine(
  (value) => Object.keys(value).length <= 20,
);
const ObligationSchema = z.object({
  id: z.string().uuid(),
  provider: z.string().min(1).max(64).regex(/^[a-z][a-z0-9._:-]{0,63}$/),
  status: z.enum([
    "pending_provider",
    "manual_required",
    "retryable_failure",
    "completed",
    "blocked_legal_hold",
  ]),
  attemptCount: z.number().int().min(0).max(100),
}).strict();
const PatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }).strict(),
  z.object({
    action: z.literal("inspect"),
    obligationId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    obligationId: z.string().uuid(),
    expectedAttemptCount: z.number().int().min(0).max(100),
    evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    caseReference: z.string().min(1).max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$/),
  }).strict(),
]);
const ProviderReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("source_record"),
    provider: z.string().min(1).max(64).regex(/^[a-z][a-z0-9._:-]{0,63}$/),
    campaignId: Identifier,
    externalId: z.string().min(1).max(200).optional(),
    authorityId: z.string().min(1).max(200).optional(),
    sourceUrl: z.string().min(1).max(1_000).optional(),
    lookupEmail: z.string().min(1).max(320).optional(),
    lookupName: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({
    kind: z.literal("message_record"),
    recordId: z.string().uuid(),
    direction: z.enum(["inbound", "outbound"]),
    channel: z.enum(["email", "linkedin", "whatsapp", "sms"]),
    providerMessageId: z.string().min(1).max(512),
  }).strict(),
  z.object({
    kind: z.literal("apollo_profile"),
    targetId: z.string().uuid(),
    campaignId: Identifier,
    providerExternalId: z.string().min(1).max(200),
  }).strict(),
]);
const AuthorityResultSchema = z.object({
  status: z.enum(["pending_provider", "manual_required", "retryable_failure"]),
  obligation_id: z.string().uuid(),
  provider: z.string().min(1).max(64).regex(/^[a-z][a-z0-9._:-]{0,63}$/),
  attempt_count: z.number().int().min(0).max(100),
  reference: ProviderReferenceSchema,
}).strict();
const ResultSchema = z.object({
  status: z.enum([
    "pending_provider",
    "manual_required",
    "retryable_failure",
    "completed",
    "blocked_legal_hold",
  ]),
  request_id: z.string().uuid(),
  campaign_id: Identifier,
  candidate_id: Identifier,
  replayed: z.boolean(),
  scrub_counts: ScrubCountsSchema,
  obligations: z.array(ObligationSchema).max(100),
}).strict();
const PendingQueueSchema = z.array(ResultSchema).max(100);

type AdminContext = {
  actorId: string;
  workspaceId: string;
};

type ErrorCode =
  | "invalid_request"
  | "cross_origin_request"
  | "not_authenticated"
  | "insufficient_permissions"
  | "candidate_not_found"
  | "idempotency_conflict"
  | "candidate_erasure_blocked_legal_hold"
  | "candidate_erasure_obligation_not_found"
  | "candidate_erasure_obligation_conflict"
  | "candidate_erasure_obligation_completed"
  | "candidate_erasure_obligation_limit_exceeded"
  | "candidate_erasure_rate_limited"
  | "candidate_erasure_unavailable";

function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
}

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

function fail(
  status: number,
  code: ErrorCode,
  correlationId: string,
  retryAfter?: number,
): NextResponse {
  const response = noStoreJson({
    ok: false,
    completed: false,
    code,
    requestId: correlationId,
  }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function expose(result: z.infer<typeof ResultSchema>) {
  return {
    ok: true,
    completed: result.status === "completed",
    status: result.status,
    requestId: result.request_id,
    campaignId: result.campaign_id,
    candidateId: result.candidate_id,
    replayed: result.replayed,
    scrubCounts: result.scrub_counts,
    obligations: result.obligations,
  };
}

async function adminContext(correlationId: string): Promise<AdminContext | NextResponse> {
  if (prodFailClosed() || !supabaseEnabled) {
    return fail(503, "candidate_erasure_unavailable", correlationId);
  }
  const session = await getServerSupabase();
  if (!session) return fail(503, "candidate_erasure_unavailable", correlationId);
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    if (admin.response.status === 401) return fail(401, "not_authenticated", correlationId);
    if (admin.response.status === 403) {
      return fail(403, "insufficient_permissions", correlationId);
    }
    return fail(503, "candidate_erasure_unavailable", correlationId);
  }
  const [{ data: auth }, { data: workspaceId, error: workspaceError }] = await Promise.all([
    session.auth.getUser(),
    session.rpc("current_workspace_id"),
  ]);
  const actorId = auth.user?.id;
  if (!actorId) return fail(401, "not_authenticated", correlationId);
  if (workspaceError || !z.string().uuid().safeParse(workspaceId).success) {
    return fail(503, "candidate_erasure_unavailable", correlationId);
  }
  return { actorId, workspaceId: workspaceId as string };
}

function mutationBoundary(req: NextRequest, correlationId: string): NextResponse | null {
  const boundary = classifySameOriginJsonRequest(req);
  if (boundary === "unsupported_media_type") {
    return fail(415, "invalid_request", correlationId);
  }
  if (boundary === "cross_origin_request") {
    return fail(403, "cross_origin_request", correlationId);
  }
  return null;
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    if (prodFailClosed() || !supabaseEnabled) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    const boundary = classifySameOriginJsonRequest(req);
    if (boundary === "unsupported_media_type") {
      return fail(415, "invalid_request", correlationId);
    }
    if (boundary === "cross_origin_request") {
      return fail(403, "cross_origin_request", correlationId);
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!z.string().uuid().safeParse(idempotencyKey).success) {
      return fail(400, "invalid_request", correlationId);
    }

    const session = await getServerSupabase();
    if (!session) return fail(503, "candidate_erasure_unavailable", correlationId);
    const admin = await requireAdmin(session);
    if (!admin.ok) {
      if (admin.response.status === 401) {
        return fail(401, "not_authenticated", correlationId);
      }
      if (admin.response.status === 403) {
        return fail(403, "insufficient_permissions", correlationId);
      }
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    const { data: { user } } = await session.auth.getUser();
    if (!user) return fail(401, "not_authenticated", correlationId);
    const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
    if (workspaceError || !z.string().uuid().safeParse(workspaceId).success) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }

    const limit = checkRateLimit(rateLimitKey(req, "admin-candidate-erasure", user.id), {
      windowMs: 60_000,
      max: 10,
    });
    if (!limit.ok) {
      return fail(
        429,
        "candidate_erasure_rate_limited",
        correlationId,
        limit.retryAfterSec,
      );
    }
    const validated = await validateBody(req, RequestSchema, { maxBytes: 1_000 });
    if (!validated.ok) return fail(validated.response.status, "invalid_request", correlationId);
    const service = getServiceSupabase();
    if (!service) return fail(503, "candidate_erasure_unavailable", correlationId);
    const { data, error } = await service.rpc("request_candidate_erasure", {
      p_workspace_id: workspaceId as string,
      p_actor_id: user.id,
      p_campaign_id: validated.data.campaignId,
      p_candidate_id: validated.data.candidateId,
      p_request_key: idempotencyKey,
    });
    if (
      error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === "54000"
    ) {
      return fail(409, "candidate_erasure_obligation_limit_exceeded", correlationId);
    }
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    const status = (data as Record<string, unknown>).status;
    if (status === "not_found") return fail(404, "candidate_not_found", correlationId);
    if (status === "idempotency_conflict") {
      return fail(409, "idempotency_conflict", correlationId);
    }
    const parsed = ResultSchema.safeParse(data);
    if (!parsed.success) return fail(503, "candidate_erasure_unavailable", correlationId);
    if (
      parsed.data.campaign_id !== validated.data.campaignId
      || parsed.data.candidate_id !== validated.data.candidateId
    ) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    if (parsed.data.status === "blocked_legal_hold") {
      return noStoreJson({
        ok: false,
        completed: false,
        code: "candidate_erasure_blocked_legal_hold",
        status: parsed.data.status,
        requestId: parsed.data.request_id,
        campaignId: parsed.data.campaign_id,
        candidateId: parsed.data.candidate_id,
        replayed: parsed.data.replayed,
        scrubCounts: parsed.data.scrub_counts,
        obligations: parsed.data.obligations,
      }, 423);
    }
    return noStoreJson(
      expose(parsed.data),
      parsed.data.status === "completed" ? 200 : 202,
    );
  } catch {
    return fail(503, "candidate_erasure_unavailable", correlationId);
  }
}

export async function GET(req: NextRequest) {
  const correlationId = requestId(req);
  const response = fail(405, "invalid_request", correlationId);
  response.headers.set("Allow", "POST, PATCH");
  return response;
}

export async function PATCH(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const boundary = mutationBoundary(req, correlationId);
    if (boundary) return boundary;
    const context = await adminContext(correlationId);
    if (context instanceof NextResponse) return context;
    const validated = await validateBody(req, PatchSchema, { maxBytes: 2_500 });
    if (!validated.ok) return fail(validated.response.status, "invalid_request", correlationId);
    const action = validated.data;
    const limit = checkRateLimit(
      rateLimitKey(
        req,
        action.action === "list"
          ? "admin-candidate-erasure-queue"
          : "admin-candidate-erasure-reconcile",
        context.actorId,
      ),
      { windowMs: 60_000, max: 20 },
    );
    if (!limit.ok) {
      return fail(
        429,
        "candidate_erasure_rate_limited",
        correlationId,
        limit.retryAfterSec,
      );
    }
    const service = getServiceSupabase();
    if (!service) return fail(503, "candidate_erasure_unavailable", correlationId);

    if (action.action === "list") {
      const { data, error } = await service.rpc("list_candidate_erasure_requests", {
        p_workspace_id: context.workspaceId,
        p_actor_id: context.actorId,
        p_limit: 100,
      });
      if (error) return fail(503, "candidate_erasure_unavailable", correlationId);
      const parsed = PendingQueueSchema.safeParse(data);
      if (!parsed.success) return fail(503, "candidate_erasure_unavailable", correlationId);
      return noStoreJson({
        ok: true,
        requests: parsed.data.map(expose),
      });
    }

    if (action.action === "inspect") {
      const { data, error } = await service.rpc("read_candidate_erasure_obligation_authority", {
        p_workspace_id: context.workspaceId,
        p_actor_id: context.actorId,
        p_obligation_id: action.obligationId,
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        return fail(503, "candidate_erasure_unavailable", correlationId);
      }
      const status = (data as Record<string, unknown>).status;
      if (status === "not_found") {
        return fail(404, "candidate_erasure_obligation_not_found", correlationId);
      }
      if (status === "completed") {
        return fail(409, "candidate_erasure_obligation_completed", correlationId);
      }
      if (status === "blocked_legal_hold") {
        return fail(423, "candidate_erasure_blocked_legal_hold", correlationId);
      }
      const parsed = AuthorityResultSchema.safeParse(data);
      if (!parsed.success || parsed.data.obligation_id !== action.obligationId) {
        return fail(503, "candidate_erasure_unavailable", correlationId);
      }
      return noStoreJson({
        ok: true,
        status: parsed.data.status,
        obligationId: parsed.data.obligation_id,
        provider: parsed.data.provider,
        attemptCount: parsed.data.attempt_count,
        reference: parsed.data.reference,
      });
    }

    const { data, error } = await service.rpc("reconcile_candidate_erasure_obligation", {
      p_workspace_id: context.workspaceId,
      p_actor_id: context.actorId,
      p_obligation_id: action.obligationId,
      p_expected_attempt_count: action.expectedAttemptCount,
      p_status: "completed",
      p_error_code: null,
      p_evidence_sha256: action.evidenceSha256,
      p_case_reference: action.caseReference,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    const status = (data as Record<string, unknown>).status;
    if (status === "not_found") {
      return fail(404, "candidate_erasure_obligation_not_found", correlationId);
    }
    if (status === "conflict" || status === "invalid_transition") {
      return fail(409, "candidate_erasure_obligation_conflict", correlationId);
    }
    if (status === "blocked_legal_hold") {
      return fail(423, "candidate_erasure_blocked_legal_hold", correlationId);
    }
    const parsed = ResultSchema.safeParse(data);
    if (
      !parsed.success
      || !parsed.data.obligations.some((item) => item.id === action.obligationId)
    ) {
      return fail(503, "candidate_erasure_unavailable", correlationId);
    }
    return noStoreJson(
      expose(parsed.data),
      parsed.data.status === "completed" ? 200 : 202,
    );
  } catch {
    return fail(503, "candidate_erasure_unavailable", correlationId);
  }
}
