import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { selectApolloEnrichmentTargets } from "@/lib/sourcing/source-authority";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";

const CampaignIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const SelectionSchema = z
  .object({
    campaignId: CampaignIdSchema,
    candidates: z
      .array(
        z
          .object({
            targetId: z.string().uuid(),
            candidateId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

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
  code: string,
  error: string,
  correlationId: string,
  retryAfter?: number,
): NextResponse {
  const response = noStoreJson({ ok: false, code, error, requestId: correlationId }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

async function handlePost(req: NextRequest, correlationId: string) {
  const fail = (status: number, code: string, error: string, retryAfter?: number) =>
    errorResponse(status, code, error, correlationId, retryAfter);
  if (prodFailClosed()) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin sourcing is not allowed.");
  }
  if (!supabaseEnabled) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
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

  const limit = checkRateLimit(rateLimitKey(req, "source-apollo-select", user.id), {
    windowMs: 60_000,
    max: 15,
  });
  if (!limit.ok) {
    return fail(
      429,
      "APOLLO_SELECTION_RATE_LIMITED",
      "Apollo candidate selection rate limit reached.",
      limit.retryAfterSec,
    );
  }

  const validated = await validateBody(req, SelectionSchema, { maxBytes: 8_000 });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid Apollo selection request.");
  }
  const selected = await selectApolloEnrichmentTargets(
    { workspaceId, userId: user.id, campaignId: validated.data.campaignId },
    validated.data.candidates,
  );
  if (!selected) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Could not select Apollo candidates.");
  }
  return noStoreJson({ ok: true, selected: validated.data.candidates });
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    return await handlePost(req, correlationId);
  } catch {
    return errorResponse(
      503,
      "APOLLO_AUTHORITY_UNAVAILABLE",
      "Live sourcing authority is unavailable.",
      correlationId,
    );
  }
}
