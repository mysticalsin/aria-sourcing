import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import {
  listPendingSourcingFeedback,
  recordSourcingQueryFeedback,
} from "@/lib/sourcing/learning-authority";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FeedbackSchema = z
  .object({
    receiptId: z.string().regex(UUID_RE),
    verdict: z.enum(["useful", "dead_end", "corrected"]),
  })
  .strict();

function noStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(req: NextRequest) {
  const suppliedRequestId = req.headers.get("x-request-id")?.trim() ?? "";
  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const fail = (status: number, code: string, error: string) =>
    noStore({ ok: false, code, error, requestId }, status);

  try {
    if (prodFailClosed() || !supabaseEnabled) {
      return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
    }
    const campaignValues = req.nextUrl.searchParams.getAll("campaignId");
    const campaignId = campaignValues.length === 1 ? campaignValues[0]?.trim() ?? "" : "";
    if (!campaignId || campaignId.length > 100 || /[\u0000-\u001f\u007f]/.test(campaignId)) {
      return fail(400, "INVALID_REQUEST", "A valid campaign ID is required.");
    }
    const session = await getServerSupabase();
    if (!session) {
      return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
    }
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
    const [{ data: role }, { data: workspaceId }] = await Promise.all([
      session.rpc("current_profile_role"),
      session.rpc("current_workspace_id"),
    ]);
    if (!can(role as Role, "source")) {
      return fail(403, "INSUFFICIENT_PERMISSIONS", "Sourcing authority is required.");
    }
    if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) {
      return fail(403, "WORKSPACE_NOT_FOUND", "Workspace authority is unavailable.");
    }
    const limit = checkRateLimit(rateLimitKey(req, "sourcing-learning-pending", user.id), {
      windowMs: 60_000,
      max: 30,
    });
    if (!limit.ok) {
      const response = fail(429, "SOURCING_LEARNING_RATE_LIMITED", "Feedback rate limit reached.");
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }
    const result = await listPendingSourcingFeedback({
      workspaceId,
      actorId: user.id,
      campaignId,
      limit: 20,
    });
    if (result.status === "ready" || result.status === "learning_disabled") {
      return noStore({ ok: true, receipts: result.receipts, requestId }, 200);
    }
    if (result.status === "not_found") {
      return fail(404, "CAMPAIGN_NOT_FOUND", "Pending sourcing feedback was not found.");
    }
    if (result.status === "invalid_request") {
      return fail(400, "INVALID_REQUEST", "Invalid pending-feedback request.");
    }
    return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
  } catch {
    return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
  }
}

export async function POST(req: NextRequest) {
  const suppliedRequestId = req.headers.get("x-request-id")?.trim() ?? "";
  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const fail = (status: number, code: string, error: string) =>
    noStore({ ok: false, code, error, requestId }, status);

  try {
    if (prodFailClosed() || !supabaseEnabled) {
      return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
    }
    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
      return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
    }
    const origin = req.headers.get("origin");
    if (!origin || origin !== req.nextUrl.origin) {
      return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin feedback is not allowed.");
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!UUID_RE.test(idempotencyKey)) {
      return fail(400, "INVALID_REQUEST", "A valid idempotency key is required.");
    }
    const validated = await validateBody(req, FeedbackSchema, { maxBytes: 1_000 });
    if (!validated.ok) {
      return fail(validated.response.status, "INVALID_REQUEST", "Invalid sourcing feedback.");
    }

    const session = await getServerSupabase();
    if (!session) {
      return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
    }
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
    const [{ data: role }, { data: workspaceId }] = await Promise.all([
      session.rpc("current_profile_role"),
      session.rpc("current_workspace_id"),
    ]);
    if (!can(role as Role, "source")) {
      return fail(403, "INSUFFICIENT_PERMISSIONS", "Sourcing authority is required.");
    }
    if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) {
      return fail(403, "WORKSPACE_NOT_FOUND", "Workspace authority is unavailable.");
    }
    const limit = checkRateLimit(rateLimitKey(req, "sourcing-learning-feedback", user.id), {
      windowMs: 60_000,
      max: 30,
    });
    if (!limit.ok) {
      const response = fail(429, "SOURCING_LEARNING_RATE_LIMITED", "Feedback rate limit reached.");
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }

    const result = await recordSourcingQueryFeedback({
      workspaceId,
      actorId: user.id,
      receiptId: validated.data.receiptId,
      verdict: validated.data.verdict,
      requestId: idempotencyKey,
    });
    if (result.status === "recorded") {
      return noStore(
        {
          ok: true,
          receiptId: validated.data.receiptId,
          verdict: validated.data.verdict,
          requestId,
        },
        200,
      );
    }
    if (result.status === "not_found") {
      return fail(404, "FEEDBACK_RECEIPT_NOT_FOUND", "Feedback receipt not found.");
    }
    if (result.status === "idempotency_conflict" || result.status === "feedback_conflict") {
      return fail(409, "FEEDBACK_CONFLICT", "Feedback was already recorded differently.");
    }
    if (result.status === "invalid_request") {
      return fail(400, "INVALID_REQUEST", "Invalid sourcing feedback.");
    }
    return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
  } catch {
    return fail(503, "SOURCING_LEARNING_UNAVAILABLE", "Sourcing learning is unavailable.");
  }
}
