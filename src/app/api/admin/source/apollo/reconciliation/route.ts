import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { encryptionRequiredButMissing, encryptSecret } from "@/lib/crypto-secrets";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  listApolloEnrichmentReconciliation,
  reconcileApolloEnrichment,
} from "@/lib/sourcing/source-authority";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";

const CursorSchema = z
  .object({
    operation: z.literal("list"),
    beforeCreated: z.string().datetime({ offset: true }).max(100).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.beforeCreated) !== Boolean(value.beforeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Both cursor fields are required together.",
      });
    }
  });

const ReconcileSchema = z
  .object({
    operation: z.literal("reconcile"),
    attemptId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    resolution: z.enum([
      "quarantine_stale",
      "complete_found",
      "complete_not_found",
      "release_no_charge",
    ]),
    email: z.string().trim().toLowerCase().email().max(320).optional(),
    caseReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$/),
    evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === "complete_found" && !value.email) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "A verified email is required for this resolution.",
      });
    }
    if (value.resolution !== "complete_found" && value.email !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "This resolution cannot include an email.",
      });
    }
  });

const RequestSchema = z.union([CursorSchema, ReconcileSchema]);

type ErrorCode =
  | "INVALID_REQUEST"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "CROSS_ORIGIN_REQUEST"
  | "WORKSPACE_NOT_FOUND"
  | "APOLLO_ATTEMPT_NOT_FOUND"
  | "APOLLO_ATTEMPT_NOT_STALE"
  | "APOLLO_RECONCILIATION_CONFLICT"
  | "APOLLO_RECONCILIATION_RATE_LIMITED"
  | "APOLLO_RECONCILIATION_UNAVAILABLE";

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
  const prodBlock = prodFailClosed();
  const fail = (status: number, code: ErrorCode, error: string, retryAfter?: number) =>
    errorResponse(status, code, error, correlationId, retryAfter);
  if (prodBlock) {
    return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin reconciliation is not allowed.");
  }
  if (!supabaseEnabled) {
    return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
  }
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    if (admin.response.status === 401) {
      return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
    }
    if (admin.response.status === 403) {
      return fail(403, "INSUFFICIENT_PERMISSIONS", "Administrator permission is required.");
    }
    return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
  }
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return fail(400, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }

  const limit = checkRateLimit(rateLimitKey(req, "admin-apollo-reconciliation", user.id), {
    windowMs: 60_000,
    max: 20,
  });
  if (!limit.ok) {
    return fail(
      429,
      "APOLLO_RECONCILIATION_RATE_LIMITED",
      "Apollo reconciliation rate limit reached.",
      limit.retryAfterSec,
    );
  }

  const validated = await validateBody(req, RequestSchema, { maxBytes: 4_000 });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid reconciliation request.");
  }

  if (validated.data.operation === "list") {
    const pageLimit = validated.data.limit ?? 20;
    const items = await listApolloEnrichmentReconciliation(
      { workspaceId, userId: user.id },
      {
        beforeCreated: validated.data.beforeCreated ?? null,
        beforeId: validated.data.beforeId ?? null,
        limit: pageLimit,
      },
    );
    if (!items) {
      return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
    }
    const last = items.length === pageLimit ? items.at(-1) : undefined;
    return noStoreJson({
      ok: true,
      items,
      nextCursor: last ? { beforeCreated: last.createdAt, beforeId: last.attemptId } : null,
    });
  }

  let emailSecret = "";
  if (validated.data.resolution === "complete_found") {
    if (encryptionRequiredButMissing()) {
      return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Secure receipt storage is unavailable.");
    }
    emailSecret = encryptSecret(validated.data.email ?? "");
    if (!emailSecret) {
      return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Secure receipt storage is unavailable.");
    }
  }

  const result = await reconcileApolloEnrichment({
    workspaceId,
    userId: user.id,
    attemptId: validated.data.attemptId,
    expectedVersion: validated.data.expectedVersion,
    action: validated.data.resolution,
    emailSecret,
    caseReference: validated.data.caseReference,
    evidenceSha256: validated.data.evidenceSha256,
    requestId: correlationId,
  });
  if (result.status === "not_found") {
    return fail(404, "APOLLO_ATTEMPT_NOT_FOUND", "Apollo enrichment attempt not found.");
  }
  if (result.status === "not_stale") {
    return fail(409, "APOLLO_ATTEMPT_NOT_STALE", "Apollo enrichment attempt is not stale.");
  }
  if (result.status === "conflict") {
    return fail(409, "APOLLO_RECONCILIATION_CONFLICT", "Apollo reconciliation state changed.");
  }
  if (result.status !== "reconciled") {
    return fail(503, "APOLLO_RECONCILIATION_UNAVAILABLE", "Apollo reconciliation is unavailable.");
  }
  return noStoreJson({
    ok: true,
    attemptId: result.attemptId,
    status: result.attemptStatus,
    version: result.version,
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
      "APOLLO_RECONCILIATION_UNAVAILABLE",
      "Apollo reconciliation is unavailable.",
      correlationId,
    );
  }
}
