import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { assessAgentFrameworkRuntime } from "@/lib/agents/framework/contracts";
import { agentFrameworkRuntimeFromEnvironment } from "@/lib/agents/framework/runtime-config";
import {
  type ApprovedAgentWorkflowBinding,
  describeStoredAgentRuntimeAvailability,
  SupportedAgentChannelsSchema,
  SupportedAgentGuardrailsSchema,
  SupportedAgentRoleBriefSchema,
} from "@/lib/agents/runtime-policy";

export const dynamic = "force-dynamic";

/**
 * Agent spec CRUD — the definitions behind on-demand sourcing agents and the
 * Agent Studio page. Generated drafts remain in run history. This route creates
 * no review queue and grants no delivery authority.
 */

const CreateSpecSchema = z.object({
  name: z.string().min(1).max(120),
  role_brief: SupportedAgentRoleBriefSchema,
  channels: SupportedAgentChannelsSchema.default(["Email"]),
  guardrails: SupportedAgentGuardrailsSchema.default({ autopilot: false, canary_remaining: 5 }),
  seat_id: z.string().uuid().optional(),
});

const UpdateSpecSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  role_brief: SupportedAgentRoleBriefSchema.optional(),
  channels: SupportedAgentChannelsSchema.optional(),
  guardrails: SupportedAgentGuardrailsSchema.optional(),
  seat_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

const ApprovedWorkflowRowSchema = z.object({
  spec_id: z.string().uuid(),
  workflow_version_id: z.string().uuid(),
  version: z.number().int().min(1),
  external_workflow_ref: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  workflow_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  workflow_name: z.string().trim().min(1).max(120),
}).strict();

const ApprovedWorkflowListSchema = z.object({
  status: z.literal("ok"),
  workflows: z.array(ApprovedWorkflowRowSchema).max(500),
}).strict().superRefine((value, ctx) => {
  const specIds = new Set<string>();
  for (const [index, workflow] of value.workflows.entries()) {
    if (specIds.has(workflow.spec_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflows", index, "spec_id"],
        message: "Only one approved workflow may be returned per spec.",
      });
      return;
    }
    specIds.add(workflow.spec_id);
  }
});

type ApprovedWorkflowAuthority = {
  available: boolean;
  workflows: Map<string, ApprovedAgentWorkflowBinding>;
};

async function loadApprovedWorkflowAuthority(
  workspaceId: string,
  ownerId: string,
  listedSpecIds: ReadonlySet<string>,
): Promise<ApprovedWorkflowAuthority> {
  try {
    const service = getServiceSupabase();
    if (!service) return { available: false, workflows: new Map() };
    const { data, error } = await service.rpc("list_agent_framework_workflows", {
      p_workspace_id: workspaceId,
      p_owner_id: ownerId,
      p_actor_id: ownerId,
    });
    if (error) return { available: false, workflows: new Map() };
    const parsed = ApprovedWorkflowListSchema.safeParse(data);
    if (!parsed.success || parsed.data.workflows.some((workflow) => !listedSpecIds.has(workflow.spec_id))) {
      return { available: false, workflows: new Map() };
    }
    return {
      available: true,
      workflows: new Map(parsed.data.workflows.map((workflow) => [
        workflow.spec_id,
        {
          workflowVersionId: workflow.workflow_version_id,
          workflowName: workflow.workflow_name,
          workflowSha256: workflow.workflow_sha256,
        },
      ])),
    };
  } catch {
    return { available: false, workflows: new Map() };
  }
}

async function requireOperator(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { response: prodBlock } as const;
  if (!supabaseEnabled) {
    return {
      response: NextResponse.json({ ok: true, demo: true, specs: [] }),
    } as const;
  }
  const supabase = await getServerSupabase();
  if (!supabase) return { response: NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 }) } as const;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 }) } as const;
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "source")) {
    return { response: NextResponse.json({ ok: false, reason: "Insufficient permissions." }, { status: 403 }) } as const;
  }
  const { data: wid } = await supabase.rpc("current_workspace_id");
  return { supabase, user, workspaceId: wid as string } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from("agent_specs")
    .select("id, name, role_brief, channels, guardrails, owner_id, seat_id, status, created_at")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, reason: "Failed to load agents." }, { status: 500 });
  const specs = data ?? [];
  const workflowAuthority = await loadApprovedWorkflowAuthority(
    auth.workspaceId,
    auth.user.id,
    new Set(specs.map((spec) => spec.id)),
  );
  let runtimeReady = false;
  try {
    runtimeReady = assessAgentFrameworkRuntime(
      agentFrameworkRuntimeFromEnvironment().config,
    ).ready;
  } catch {
    runtimeReady = false;
  }
  return NextResponse.json({
    ok: true,
    specs: specs.map(({ owner_id, ...spec }) => {
      const approvedWorkflow = workflowAuthority.workflows.get(spec.id);
      return {
        ...spec,
        workflowVersionId: approvedWorkflow?.workflowVersionId ?? null,
        workflowName: approvedWorkflow?.workflowName ?? null,
        workflowSha256: approvedWorkflow?.workflowSha256 ?? null,
        ...describeStoredAgentRuntimeAvailability(
          spec.role_brief,
          spec.channels,
          spec.guardrails,
          spec.status,
          owner_id,
          auth.user.id,
          {
            authorityAvailable: workflowAuthority.available,
            runtimeReady,
            approvedWorkflow,
          },
        ),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(req, "agent-specs"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const validated = await validateBody(req, CreateSpecSchema, { maxBytes: 50_000 });
  if (!validated.ok) return validated.response;
  const { data, error } = await auth.supabase
    .from("agent_specs")
    .insert({ ...validated.data, workspace_id: auth.workspaceId, owner_id: auth.user.id })
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ ok: false, reason: "Failed to create agent." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(req, "agent-specs"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const validated = await validateBody(req, UpdateSpecSchema, { maxBytes: 50_000 });
  if (!validated.ok) return validated.response;
  const { id, ...updates } = validated.data;
  const { error } = await auth.supabase
    .from("agent_specs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ ok: false, reason: "Failed to update agent." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
