import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { eraseApolloEnrichmentTarget } from "@/lib/sourcing/source-authority";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";

const CampaignIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const ErasureSchema = z
  .object({
    campaignId: CampaignIdSchema,
    candidateId: z.string().uuid(),
    targetId: z.string().uuid(),
  })
  .strict();

type ErrorCode =
  | "INVALID_REQUEST"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "CROSS_ORIGIN_REQUEST"
  | "WORKSPACE_NOT_FOUND"
  | "APOLLO_TARGET_NOT_FOUND"
  | "APOLLO_ERASURE_RATE_LIMITED"
  | "APOLLO_ERASURE_UNAVAILABLE";

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

function errorResponse(
  status: number,
  code: ErrorCode,
  error: string,
  correlationId: string,
  retryAfter?: number,
): NextResponse {
  const response = noStoreJson({ ok: false, code, error, requestId: correlationId }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

async function handlePost(req: NextRequest, correlationId: string) {
  const fail = (status: number, code: ErrorCode, error: string, retryAfter?: number) =>
    errorResponse(status, code, error, correlationId, retryAfter);
  if (prodFailClosed()) {
    return fail(503, "APOLLO_ERASURE_UNAVAILABLE", "Apollo receipt erasure is unavailable.");
  }
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin erasure is not allowed.");
  }
  if (!supabaseEnabled) {
    return fail(503, "APOLLO_ERASURE_UNAVAILABLE", "Apollo receipt erasure is unavailable.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "APOLLO_ERASURE_UNAVAILABLE", "Apollo receipt erasure is unavailable.");
  }
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    if (admin.response.status === 401) {
      return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
    }
    if (admin.response.status === 403) {
      return fail(403, "INSUFFICIENT_PERMISSIONS", "Administrator permission is required.");
    }
    return fail(503, "APOLLO_ERASURE_UNAVAILABLE", "Apollo receipt erasure is unavailable.");
  }
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return fail(400, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }

  const limit = checkRateLimit(rateLimitKey(req, "admin-apollo-erasure", user.id), {
    windowMs: 60_000,
    max: 15,
  });
  if (!limit.ok) {
    return fail(
      429,
      "APOLLO_ERASURE_RATE_LIMITED",
      "Apollo erasure rate limit reached.",
      limit.retryAfterSec,
    );
  }
  const validated = await validateBody(req, ErasureSchema, { maxBytes: 2_000 });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid Apollo erasure request.");
  }

  const result = await eraseApolloEnrichmentTarget({
    workspaceId,
    userId: user.id,
    campaignId: validated.data.campaignId,
    candidateId: validated.data.candidateId,
    targetId: validated.data.targetId,
    caseReference: `candidate-erasure:${validated.data.candidateId}`,
    requestId: correlationId,
  });
  if (result.status === "not_found") {
    return fail(404, "APOLLO_TARGET_NOT_FOUND", "Apollo enrichment target not found.");
  }
  if (result.status !== "erased") {
    return fail(503, "APOLLO_ERASURE_UNAVAILABLE", "Apollo receipt erasure is unavailable.");
  }
  return noStoreJson({
    ok: true,
    campaignId: validated.data.campaignId,
    candidateId: validated.data.candidateId,
    targetId: result.targetId,
    clearedReceipts: result.clearedReceipts,
    cancelledAttempts: result.cancelledAttempts,
    eventId: result.eventId,
  });
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    return await handlePost(req, correlationId);
  } catch {
    return errorResponse(
      503,
      "APOLLO_ERASURE_UNAVAILABLE",
      "Apollo receipt erasure is unavailable.",
      correlationId,
    );
  }
}
