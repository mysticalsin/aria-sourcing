import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { getServiceSupabase } from "@/lib/supabase/server";
import { resolveActiveAiRuntimeBinding } from "@/lib/ai/runtime-binding";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import {
  handleRequisitionParseJob,
  type RequisitionParseRpcClient,
} from "@/lib/needs/requisition-parse";
import { withCriticalPathTelemetry } from "@/lib/observability/critical-path.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z
  .object({
    jobId: z.string().uuid(),
    leaseId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    requisitionId: z.string().uuid(),
  })
  .strict();

function validInternalSecret(secret: string): boolean {
  return secret.length >= 32 && secret.length <= 4_096 && !/\s/.test(secret);
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.ARIA_REQUISITION_PARSE_SECRET ?? "";
  if (!validInternalSecret(secret)) return false;
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return (
    presentedBuf.length === expectedBuf.length
    && timingSafeEqual(presentedBuf, expectedBuf)
  );
}

/**
 * Internal, worker-only trigger for one claimed `requisition_parse` job — the
 * same "web process does the work, worker just drains it" shape as
 * /api/cron/dispatch-outbound. All logic lives in
 * src/lib/needs/requisition-parse.ts; this route only authenticates and wires
 * dependencies.
 */
export async function POST(req: NextRequest) {
  return withCriticalPathTelemetry(
    "requisition_parse",
    () => handlePost(req),
    {
      classify: (response) => ({
        status: response.status < 400 ? "ok" : response.status < 500 ? "rejected" : "degraded",
        code: `http_${response.status}`,
      }),
    },
  );
}

async function handlePost(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = await validateBody(req, BodySchema, { maxBytes: 2_048 });
  if (!parsed.ok) return parsed.response;

  const outcome = await handleRequisitionParseJob(
    {
      jobId: parsed.data.jobId,
      leaseId: parsed.data.leaseId,
      workspaceId: parsed.data.workspaceId,
      requisitionId: parsed.data.requisitionId,
    },
    {
      getServiceClient: () => getServiceSupabase() as unknown as RequisitionParseRpcClient | null,
      resolveAiBinding: (client, workspaceId, purpose) =>
        resolveActiveAiRuntimeBinding(client, workspaceId, purpose),
      resolveApiKeySecret: (workspaceId, apiKeyId, expectedProvider) =>
        resolveVaultSecret(apiKeyId, expectedProvider, workspaceId),
    },
  );

  return NextResponse.json({ ok: true, outcome }, { status: outcomeStatus(outcome.outcome) });
}

/**
 * `unavailable` (a dependency, e.g. the service client, never came up) and
 * `stale_lease` (the lease was gone by the time we tried to act on it) are
 * not successful outcomes for this call and must not return 200 — every
 * other outcome is a fully handled terminal state for the job and returns
 * bounded JSON with 200.
 */
function outcomeStatus(outcome: string): number {
  if (outcome === "unavailable") return 503;
  if (outcome === "stale_lease") return 409;
  return 200;
}
