import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assessAgentFrameworkAuthoringRuntime } from "@/lib/agents/framework/contracts";
import { importFlowiseWorkflow } from "@/lib/agents/framework/private-clients";
import { agentFrameworkRuntimeFromEnvironment } from "@/lib/agents/framework/runtime-config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ImportSchema = z.object({
  specId: z.string().uuid(),
  frameworkInstanceId: z.string().uuid(),
  externalWorkflowId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
  expectedName: z.string().trim().min(1).max(120),
  version: z.number().int().min(1).max(1_000_000),
}).strict();

const ReviewSchema = z.object({
  workflowVersionId: z.string().uuid(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(["approve", "revoke"]),
}).strict();

type AdminContext = {
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
  actorId: string;
  workspaceId: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(code: string, status: number, correlationId: string): NextResponse {
  return json({ ok: false, code, requestId: correlationId }, status);
}

function requestBoundary(req: NextRequest, correlationId: string): NextResponse | null {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return failure("INVALID_REQUEST", 415, correlationId);
  }
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) {
    return failure("CROSS_ORIGIN_REQUEST", 403, correlationId);
  }
  return null;
}

async function adminContext(correlationId: string): Promise<AdminContext | NextResponse> {
  if (prodFailClosed() || !supabaseEnabled) {
    return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  }
  const session = await getServerSupabase();
  if (!session) return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    return failure(
      admin.response.status === 401 ? "NOT_AUTHENTICATED" : "INSUFFICIENT_PERMISSIONS",
      admin.response.status === 401 ? 401 : 403,
      correlationId,
    );
  }
  const [{ data: auth }, { data: workspaceId, error: workspaceError }] = await Promise.all([
    session.auth.getUser(),
    session.rpc("current_workspace_id"),
  ]);
  const actorId = auth.user?.id;
  if (!actorId) return failure("NOT_AUTHENTICATED", 401, correlationId);
  if (workspaceError || typeof workspaceId !== "string" || !z.string().uuid().safeParse(workspaceId).success) {
    return failure("WORKSPACE_NOT_FOUND", 400, correlationId);
  }
  return { session, actorId, workspaceId };
}

async function loadOwnedSpec(
  context: AdminContext,
  specId: string,
): Promise<{ ownerId: string } | null> {
  const { data, error } = await context.session
    .from("agent_specs")
    .select("id,owner_id,status")
    .eq("workspace_id", context.workspaceId)
    .eq("id", specId)
    .maybeSingle();
  if (
    error || !data || data.status !== "active" ||
    typeof data.owner_id !== "string" || !z.string().uuid().safeParse(data.owner_id).success
  ) {
    return null;
  }
  return { ownerId: data.owner_id };
}

async function importWorkflow(req: NextRequest, correlationId: string): Promise<NextResponse> {
  const boundary = requestBoundary(req, correlationId);
  if (boundary) return boundary;
  const resolved = await adminContext(correlationId);
  if (resolved instanceof NextResponse) return resolved;

  const limit = checkRateLimit(rateLimitKey(req, "admin-agent-framework-workflows", resolved.actorId), {
    windowMs: 60_000,
    max: 10,
  });
  if (!limit.ok) {
    const response = failure("AGENT_FRAMEWORK_ADMIN_RATE_LIMITED", 429, correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const validated = await validateBody(req, ImportSchema, { maxBytes: 4_000 });
  if (!validated.ok) return failure("INVALID_REQUEST", validated.response.status, correlationId);

  const runtimeConfig = agentFrameworkRuntimeFromEnvironment();
  if (!assessAgentFrameworkAuthoringRuntime(runtimeConfig.config).ready) {
    return failure("AGENT_FRAMEWORK_AUTHORING_UNAVAILABLE", 503, correlationId);
  }
  const spec = await loadOwnedSpec(resolved, validated.data.specId);
  if (!spec) return failure("AGENT_SPEC_NOT_FOUND", 404, correlationId);

  const workflow = await importFlowiseWorkflow(
    {
      workspaceId: resolved.workspaceId,
      frameworkInstanceId: validated.data.frameworkInstanceId,
      externalWorkflowId: validated.data.externalWorkflowId,
      expectedName: validated.data.expectedName,
    },
    runtimeConfig.config,
    runtimeConfig.tokens.flowiseToken,
  );

  const current = await adminContext(correlationId);
  if (
    current instanceof NextResponse || current.actorId !== resolved.actorId ||
    current.workspaceId !== resolved.workspaceId
  ) {
    return failure("AGENT_FRAMEWORK_AUTHORITY_CHANGED", 409, correlationId);
  }
  const currentSpec = await loadOwnedSpec(current, validated.data.specId);
  if (!currentSpec || currentSpec.ownerId !== spec.ownerId) {
    return failure("AGENT_FRAMEWORK_AUTHORITY_CHANGED", 409, correlationId);
  }

  const service = getServiceSupabase();
  if (!service) return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  const { data, error } = await service.rpc("import_agent_workflow_version", {
    p_workspace_id: resolved.workspaceId,
    p_owner_id: spec.ownerId,
    p_actor_id: resolved.actorId,
    p_spec_id: validated.data.specId,
    p_flowise_instance_id: validated.data.frameworkInstanceId,
    p_external_workflow_ref: validated.data.externalWorkflowId,
    p_version: validated.data.version,
    p_workflow_json: workflow,
  });
  const receipt = record(data);
  if (error || !receipt) return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  if (receipt.status === "idempotency_conflict") {
    return failure("AGENT_WORKFLOW_VERSION_CONFLICT", 409, correlationId);
  }
  if (receipt.status === "not_found") return failure("AGENT_SPEC_NOT_FOUND", 404, correlationId);
  if (receipt.status !== "imported" && receipt.status !== "replay") {
    return failure("AGENT_FRAMEWORK_AUTHORING_UNAVAILABLE", 503, correlationId);
  }
  if (
    typeof receipt.workflow_version_id !== "string" ||
    !z.string().uuid().safeParse(receipt.workflow_version_id).success ||
    typeof receipt.workflow_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(receipt.workflow_sha256) ||
    receipt.workflow_status !== "draft"
  ) {
    return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  }
  return json({
    ok: true,
    workflowVersionId: receipt.workflow_version_id,
    workflowSha256: receipt.workflow_sha256,
    status: "draft",
  }, receipt.status === "imported" ? 201 : 200);
}

async function reviewWorkflow(req: NextRequest, correlationId: string): Promise<NextResponse> {
  const boundary = requestBoundary(req, correlationId);
  if (boundary) return boundary;
  const resolved = await adminContext(correlationId);
  if (resolved instanceof NextResponse) return resolved;
  const limit = checkRateLimit(rateLimitKey(req, "admin-agent-framework-review", resolved.actorId), {
    windowMs: 60_000,
    max: 20,
  });
  if (!limit.ok) {
    const response = failure("AGENT_FRAMEWORK_ADMIN_RATE_LIMITED", 429, correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const validated = await validateBody(req, ReviewSchema, { maxBytes: 2_000 });
  if (!validated.ok) return failure("INVALID_REQUEST", validated.response.status, correlationId);
  const service = getServiceSupabase();
  if (!service) return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  const { data, error } = await service.rpc("review_agent_workflow_version", {
    p_workspace_id: resolved.workspaceId,
    p_actor_id: resolved.actorId,
    p_workflow_version_id: validated.data.workflowVersionId,
    p_expected_sha256: validated.data.expectedSha256,
    p_decision: validated.data.decision,
  });
  const receipt = record(data);
  if (error || !receipt) return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  if (receipt.status === "reviewer_conflict") {
    return failure("AGENT_WORKFLOW_REVIEWER_CONFLICT", 409, correlationId);
  }
  if (receipt.status === "conflict") return failure("AGENT_WORKFLOW_VERSION_CONFLICT", 409, correlationId);
  if (receipt.status === "not_found") return failure("AGENT_WORKFLOW_NOT_FOUND", 404, correlationId);
  const expectedStatus = validated.data.decision === "approve" ? "approved" : "revoked";
  if (
    receipt.status !== expectedStatus ||
    receipt.workflow_version_id !== validated.data.workflowVersionId ||
    receipt.workflow_sha256 !== validated.data.expectedSha256
  ) {
    return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  }
  return json({
    ok: true,
    workflowVersionId: receipt.workflow_version_id,
    workflowSha256: receipt.workflow_sha256,
    status: expectedStatus,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = requestId(req);
  try {
    return await importWorkflow(req, correlationId);
  } catch {
    return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const correlationId = requestId(req);
  try {
    return await reviewWorkflow(req, correlationId);
  } catch {
    return failure("AGENT_FRAMEWORK_ADMIN_UNAVAILABLE", 503, correlationId);
  }
}
