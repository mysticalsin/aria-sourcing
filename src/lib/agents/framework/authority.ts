import { z } from "zod";

import {
  AgentWorkflowV1Schema,
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  type AgentWorkflowV1,
} from "@/lib/agents/framework/contracts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ImageDigest = z.string().regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/);

export interface FrameworkRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const ActiveClaimSchema = z.object({
  status: z.literal("claimed"),
  run_id: z.string().uuid(),
  run_status: z.enum(["claimed", "running", "proposed", "failed", "cancelled"]).optional(),
  lease_id: z.string().uuid(),
  lease_expires_at: z.string().datetime({ offset: true }),
  configuration_sha256: Sha256,
  workflow_version_id: z.string().uuid(),
  workflow_sha256: Sha256,
  workflow: AgentWorkflowV1Schema,
  deerflow_instance_id: z.string().uuid(),
  deerflow_source_commit: z.literal(DEERFLOW_SOURCE_COMMIT),
  deerflow_image_digest: ImageDigest,
  deerflow_readiness_sha256: Sha256,
  flowise_instance_id: z.string().uuid(),
  flowise_source_commit: z.literal(FLOWISE_SOURCE_COMMIT),
  flowise_image_digest: ImageDigest,
  flowise_isolation_mode: z.enum(["instance-per-workspace", "licensed-enterprise-workspace"]),
  flowise_readiness_sha256: Sha256,
}).passthrough();

const ClaimFailureSchema = z.object({
  status: z.enum([
    "invalid_request",
    "idempotency_conflict",
    "framework_disabled",
    "configuration_invalid",
    "not_found",
    "workflow_unavailable",
    "flowise_unavailable",
    "deerflow_unavailable",
    "in_progress",
    "already_completed",
    "authority_changed",
  ]),
}).passthrough();

const RecoveryClaimSchema = z.object({
  status: z.literal("already_completed"),
  run_id: z.string().uuid(),
  run_status: z.literal("proposed"),
  source_query: z.string().trim().min(3).max(256),
  sourcing_count: z.number().int().min(1).max(8),
  reports: z.array(z.string().trim().min(1).max(500)).length(1),
}).passthrough();

export type AgentFrameworkClaim = {
  status: "claimed";
  runId: string;
  runStatus?: "claimed" | "running" | "proposed" | "failed" | "cancelled";
  leaseId: string;
  leaseExpiresAt: string;
  configurationSha256: string;
  workflowVersionId: string;
  workflowSha256: string;
  workflow: AgentWorkflowV1;
  deerflowInstanceId: string;
  deerflowSourceCommit: typeof DEERFLOW_SOURCE_COMMIT;
  deerflowImageDigest: string;
  deerflowReadinessSha256: string;
  flowiseInstanceId: string;
  flowiseSourceCommit: typeof FLOWISE_SOURCE_COMMIT;
  flowiseImageDigest: string;
  flowiseIsolation: "instance-per-workspace" | "licensed-enterprise-workspace";
  flowiseReadinessSha256: string;
};

export type AgentFrameworkClaimResult =
  | { ok: true; claim: AgentFrameworkClaim }
  | {
      ok: true;
      recovery: {
        runId: string;
        sourceQuery: string;
        sourcingCount: number;
        reports: string[];
      };
    }
  | { ok: false; status: z.infer<typeof ClaimFailureSchema>["status"] | "authority_unavailable" };

export async function claimAgentFrameworkRun(
  client: FrameworkRpcClient,
  input: {
    workspaceId: string;
    ownerId: string;
    actorId: string;
    specId: string;
    campaignId: string;
    campaignFingerprint: string;
    workflowVersionId: string;
    idempotencyKey: string;
    capabilitySha256: string;
  },
): Promise<AgentFrameworkClaimResult> {
  const { data, error } = await client.rpc("claim_agent_framework_run", {
    p_workspace_id: input.workspaceId,
    p_owner_id: input.ownerId,
    p_actor_id: input.actorId,
    p_spec_id: input.specId,
    p_campaign_id: input.campaignId,
    p_campaign_fingerprint: input.campaignFingerprint,
    p_workflow_version_id: input.workflowVersionId,
    p_idempotency_key: input.idempotencyKey,
    p_capability_sha256: input.capabilitySha256,
  });
  if (error) return { ok: false, status: "authority_unavailable" };
  const active = ActiveClaimSchema.safeParse(data);
  if (active.success) {
    const value = active.data;
    return {
      ok: true,
      claim: {
        status: value.status,
        runId: value.run_id,
        ...(value.run_status ? { runStatus: value.run_status } : {}),
        leaseId: value.lease_id,
        leaseExpiresAt: value.lease_expires_at,
        configurationSha256: value.configuration_sha256,
        workflowVersionId: value.workflow_version_id,
        workflowSha256: value.workflow_sha256,
        workflow: value.workflow,
        deerflowInstanceId: value.deerflow_instance_id,
        deerflowSourceCommit: value.deerflow_source_commit,
        deerflowImageDigest: value.deerflow_image_digest,
        deerflowReadinessSha256: value.deerflow_readiness_sha256,
        flowiseInstanceId: value.flowise_instance_id,
        flowiseSourceCommit: value.flowise_source_commit,
        flowiseImageDigest: value.flowise_image_digest,
        flowiseIsolation: value.flowise_isolation_mode,
        flowiseReadinessSha256: value.flowise_readiness_sha256,
      },
    };
  }
  const recovery = RecoveryClaimSchema.safeParse(data);
  if (recovery.success) {
    return {
      ok: true,
      recovery: {
        runId: recovery.data.run_id,
        sourceQuery: recovery.data.source_query,
        sourcingCount: recovery.data.sourcing_count,
        reports: recovery.data.reports,
      },
    };
  }
  const malformedRecovery = z.object({
    status: z.literal("already_completed"),
    run_status: z.literal("proposed"),
  }).passthrough().safeParse(data);
  if (malformedRecovery.success) {
    return { ok: false, status: "authority_unavailable" };
  }
  const failure = ClaimFailureSchema.safeParse(data);
  return failure.success
    ? { ok: false, status: failure.data.status }
    : { ok: false, status: "authority_unavailable" };
}

const MutationReceiptSchema = z.object({
  status: z.enum([
    "recorded",
    "replay",
    "proposed",
    "failed",
    "invalid_request",
    "not_found",
    "framework_disabled",
    "lease_invalid",
    "run_closed",
    "idempotency_conflict",
  ]),
}).passthrough();

async function mutate(
  client: FrameworkRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<z.infer<typeof MutationReceiptSchema>["status"] | "authority_unavailable"> {
  const { data, error } = await client.rpc(name, args);
  if (error) return "authority_unavailable";
  const parsed = MutationReceiptSchema.safeParse(data);
  return parsed.success ? parsed.data.status : "authority_unavailable";
}

export function recordAgentFrameworkStep(
  client: FrameworkRpcClient,
  input: {
    runId: string;
    leaseId: string;
    ordinal: number;
    nodeKind: string;
    idempotencyKey: string;
    requestSha256: string;
    responseSha256: string;
  },
) {
  return mutate(client, "record_agent_framework_step_receipt", {
    p_run_id: input.runId,
    p_lease_id: input.leaseId,
    p_ordinal: input.ordinal,
    p_node_kind: input.nodeKind,
    p_idempotency_key: input.idempotencyKey,
    p_request_sha256: input.requestSha256,
    p_response_sha256: input.responseSha256,
  });
}

export function completeAgentFrameworkRun(
  client: FrameworkRpcClient,
  runId: string,
  leaseId: string,
  proposalSha256: string,
  sourcingCapabilitySha256: string,
  sourcingCount: number,
  sourceQuery: string,
  reports: string[],
) {
  return mutate(client, "complete_agent_framework_run", {
    p_run_id: runId,
    p_lease_id: leaseId,
    p_proposal_sha256: proposalSha256,
    p_sourcing_capability_sha256: sourcingCapabilitySha256,
    p_sourcing_count: sourcingCount,
    p_source_query: sourceQuery,
    p_reports: reports,
  });
}

export function failAgentFrameworkRun(
  client: FrameworkRpcClient,
  runId: string,
  leaseId: string,
  errorCode: string,
) {
  return mutate(client, "fail_agent_framework_run", {
    p_run_id: runId,
    p_lease_id: leaseId,
    p_error_code: errorCode,
  });
}

const MemoryEgressAuthorizationSchema = z.object({
  status: z.literal("authorized"),
  egress_lease_id: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
  replayed: z.literal(false),
}).strict();

const MIN_MEMORY_EGRESS_TTL_MS = 65_000;

const MemoryEgressFailureSchema = z.object({
  status: z.enum([
    "invalid_request",
    "not_found",
    "lease_invalid",
    "memory_changed",
    "memory_in_use",
  ]),
}).passthrough();

export async function authorizeAgentFrameworkMemoryEgress(
  client: FrameworkRpcClient,
  runId: string,
  runLeaseId: string,
): Promise<
  | { ok: true; egressLeaseId: string; expiresAt: string }
  | { ok: false; status: z.infer<typeof MemoryEgressFailureSchema>["status"] | "authority_unavailable" }
> {
  const { data, error } = await client.rpc("authorize_agent_framework_memory_egress", {
    p_framework_run_id: runId,
    p_run_lease_id: runLeaseId,
  });
  if (error) return { ok: false, status: "authority_unavailable" };
  const authorized = MemoryEgressAuthorizationSchema.safeParse(data);
  if (authorized.success) {
    const remainingTtlMs = Date.parse(authorized.data.expires_at) - Date.now();
    if (!Number.isFinite(remainingTtlMs) || remainingTtlMs < MIN_MEMORY_EGRESS_TTL_MS) {
      return { ok: false, status: "authority_unavailable" };
    }
    return {
      ok: true,
      egressLeaseId: authorized.data.egress_lease_id,
      expiresAt: authorized.data.expires_at,
    };
  }
  const failure = MemoryEgressFailureSchema.safeParse(data);
  return failure.success
    ? { ok: false, status: failure.data.status }
    : { ok: false, status: "authority_unavailable" };
}

export async function releaseAgentFrameworkMemoryEgress(
  client: FrameworkRpcClient,
  runId: string,
  runLeaseId: string,
  egressLeaseId: string,
): Promise<"released" | "authority_unavailable"> {
  const { data, error } = await client.rpc("release_agent_framework_memory_egress", {
    p_framework_run_id: runId,
    p_run_lease_id: runLeaseId,
    p_egress_lease_id: egressLeaseId,
  });
  if (error) return "authority_unavailable";
  const parsed = z.object({ status: z.literal("released") }).passthrough().safeParse(data);
  return parsed.success ? "released" : "authority_unavailable";
}
