import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { encryptionRequiredButMissing, encryptSecret, decryptSecret } from "@/lib/crypto-secrets";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import {
  claimApolloEnrichmentTarget,
  completeApolloEnrichmentTarget,
  markApolloEnrichmentAmbiguous,
  prepareApolloEnrichmentTarget,
} from "@/lib/sourcing/source-authority";
import { matchApolloPerson, resolveStoredApolloKey } from "@/lib/sourcing/apollo";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

const PrepareSchema = z
  .object({
    action: z.literal("prepare"),
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    candidateId: z.string().uuid(),
    targetId: z.string().uuid(),
    scope: z.literal("email"),
  })
  .strict();

const CommitSchema = z
  .object({
    action: z.literal("commit"),
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    candidateId: z.string().uuid(),
    targetId: z.string().uuid(),
    scope: z.literal("email"),
    confirmationNonce: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

const EnrichmentSchema = z.discriminatedUnion("action", [PrepareSchema, CommitSchema]);
const EmailSchema = z.string().email().max(320);

type ErrorCode =
  | "INVALID_REQUEST"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "CROSS_ORIGIN_REQUEST"
  | "WORKSPACE_NOT_FOUND"
  | "APOLLO_TARGET_NOT_FOUND"
  | "APOLLO_ENRICHMENT_IN_PROGRESS"
  | "APOLLO_RECONCILIATION_REQUIRED"
  | "APOLLO_CONFIRMATION_INVALID"
  | "APOLLO_IDEMPOTENCY_CONFLICT"
  | "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION"
  | "APOLLO_QUOTA_EXCEEDED"
  | "APOLLO_NOT_CONFIGURED"
  | "APOLLO_AUTHORITY_UNAVAILABLE"
  | "APOLLO_RECEIPT_UNAVAILABLE"
  | "APOLLO_OUTCOME_UNKNOWN";

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
  req: NextRequest,
  status: number,
  code: ErrorCode,
  error: string,
  retryAfter?: number,
  correlationId = requestId(req),
): NextResponse {
  const response = noStoreJson({ ok: false, code, error, requestId: correlationId }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function completedResponse(input: {
  campaignId: string;
  candidateId: string;
  targetId: string;
  found: boolean;
  email: string;
  cached: boolean;
}): NextResponse {
  return noStoreJson({
    ok: true,
    status: "completed",
    campaignId: input.campaignId,
    candidateId: input.candidateId,
    targetId: input.targetId,
    revealed: input.found,
    cached: input.cached,
    email: input.email,
    phone: "",
    detail: input.found ? "email_revealed" : "no_contact_found",
  });
}

async function handlePost(req: NextRequest, correlationId: string) {
  const prodBlock = prodFailClosed();
  const fail = (
    status: number,
    code: ErrorCode,
    error: string,
    retryAfter?: number,
  ) => errorResponse(req, status, code, error, retryAfter, correlationId);
  if (prodBlock) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live enrichment authority is unavailable.");
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin enrichment is not allowed.");
  }

  if (!supabaseEnabled) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live enrichment authority is unavailable.");
  }
  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live enrichment authority is unavailable.");
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
    return fail(403, "INSUFFICIENT_PERMISSIONS", "Source permission is required.");
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    return fail(400, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }

  const rl = checkRateLimit(rateLimitKey(req, "source-apollo-enrich", user.id), {
    windowMs: 60_000,
    max: 15,
  });
  if (!rl.ok) {
    return fail(429, "APOLLO_QUOTA_EXCEEDED", "Enrichment rate limit reached.", rl.retryAfterSec);
  }

  const validated = await validateBody(req, EnrichmentSchema, { maxBytes: 2_000 });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid enrichment request.");
  }
  const payload = validated.data;
  const authority = {
    workspaceId,
    userId: user.id,
    campaignId: payload.campaignId,
    candidateId: payload.candidateId,
    targetId: payload.targetId,
    scope: payload.scope,
  };

  if (payload.action === "prepare") {
    const prepared = await prepareApolloEnrichmentTarget(authority);
    if (prepared.status === "not_found") {
      return fail(404, "APOLLO_TARGET_NOT_FOUND", "Enrichment target not found.");
    }
    if (prepared.status !== "prepared") {
      return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Enrichment authority is unavailable.");
    }
    return noStoreJson({
      ok: true,
      status: "prepared",
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      targetId: payload.targetId,
      scope: payload.scope,
      confirmationNonce: prepared.confirmationNonce,
      expiresAt: prepared.expiresAt,
      maxCostCredits: 1,
    });
  }

  if (encryptionRequiredButMissing()) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Secure receipt storage is unavailable.");
  }
  const apiKey = await resolveStoredApolloKey(session);
  if (!apiKey) {
    return fail(503, "APOLLO_NOT_CONFIGURED", "Apollo is not configured.");
  }

  const claim = await claimApolloEnrichmentTarget({
    ...authority,
    confirmationNonce: payload.confirmationNonce,
    idempotencyKey: payload.idempotencyKey,
    requestId: correlationId,
  });
  if (claim.status === "not_found") {
    return fail(404, "APOLLO_TARGET_NOT_FOUND", "Enrichment target not found.");
  }
  if (claim.status === "in_progress") {
    return fail(409, "APOLLO_ENRICHMENT_IN_PROGRESS", "Enrichment is already in progress.");
  }
  if (claim.status === "ambiguous") {
    return fail(409, "APOLLO_RECONCILIATION_REQUIRED", "Enrichment requires reconciliation.");
  }
  if (claim.status === "nonce_invalid") {
    return fail(409, "APOLLO_CONFIRMATION_INVALID", "Enrichment confirmation is invalid or expired.");
  }
  if (claim.status === "idempotency_conflict") {
    return fail(409, "APOLLO_IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with another request.");
  }
  if (claim.status === "cancelled") {
    return fail(
      409,
      "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION",
      "A new confirmation is required before retrying enrichment.",
    );
  }
  if (claim.status === "quota_exceeded") {
    return fail(429, "APOLLO_QUOTA_EXCEEDED", "Workspace or operator enrichment quota reached.");
  }
  if (claim.status === "dependency_unavailable") {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Enrichment authority is unavailable.");
  }
  if (claim.status === "completed") {
    const email = decryptSecret(claim.emailSecret);
    if (claim.found && !EmailSchema.safeParse(email).success) {
      return fail(503, "APOLLO_RECEIPT_UNAVAILABLE", "Stored enrichment receipt is unavailable.");
    }
    return completedResponse({
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      targetId: payload.targetId,
      found: claim.found,
      email: claim.found ? email : "",
      cached: true,
    });
  }
  if (claim.status !== "claimed") {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Enrichment authority is unavailable.");
  }

  try {
    const clearance = clearIdentityResolution("Apollo", { providerExternalId: claim.providerExternalId });
    if (!clearance.ok) {
      await markApolloEnrichmentAmbiguous({ ...authority, attemptId: claim.attemptId });
      return fail(503, "APOLLO_RECONCILIATION_REQUIRED", "Enrichment requires reconciliation.");
    }
    const match = await matchApolloPerson(clearance.clearance, claim.providerExternalId, apiKey, { revealPhone: false });
    const parsedEmail = match?.email ? EmailSchema.safeParse(match.email.trim().toLowerCase()) : null;
    const email = parsedEmail?.success ? parsedEmail.data : "";
    const found = Boolean(email);
    const emailSecret = encryptSecret(email);
    if (email && !emailSecret) {
      await markApolloEnrichmentAmbiguous({ ...authority, attemptId: claim.attemptId });
      return fail(503, "APOLLO_RECONCILIATION_REQUIRED", "Enrichment requires reconciliation.");
    }
    const persisted = await completeApolloEnrichmentTarget({
      ...authority,
      attemptId: claim.attemptId,
      found,
      emailSecret,
      phoneSecret: "",
    });
    if (!persisted) {
      await markApolloEnrichmentAmbiguous({ ...authority, attemptId: claim.attemptId });
      return fail(503, "APOLLO_RECONCILIATION_REQUIRED", "Enrichment requires reconciliation.");
    }
    return completedResponse({
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      targetId: payload.targetId,
      found,
      email,
      cached: false,
    });
  } catch {
    await markApolloEnrichmentAmbiguous({ ...authority, attemptId: claim.attemptId });
    safeLog("Apollo enrichment outcome is ambiguous", {
      requestId: correlationId,
      targetId: payload.targetId,
      attemptId: claim.attemptId,
    });
    return fail(502, "APOLLO_OUTCOME_UNKNOWN", "Apollo outcome is unknown; reconciliation is required.");
  }
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    return await handlePost(req, correlationId);
  } catch {
    return errorResponse(
      req,
      503,
      "APOLLO_AUTHORITY_UNAVAILABLE",
      "Live enrichment authority is unavailable.",
      undefined,
      correlationId,
    );
  }
}
