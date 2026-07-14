import { createHash } from "node:crypto";

import {
  completeAgentFrameworkRun,
  failAgentFrameworkRun,
  recordAgentFrameworkStep,
  claimAgentFrameworkRun,
  authorizeAgentFrameworkMemoryEgress,
  releaseAgentFrameworkMemoryEgress,
  type FrameworkRpcClient,
} from "@/lib/agents/framework/authority";
import {
  AgentFrameworkProposalSchema,
  proposalMatchesWorkflow,
  type AgentFrameworkNeed,
  type AgentFrameworkRuntimeConfiguration,
} from "@/lib/agents/framework/contracts";
import { runDeerFlowProposal } from "@/lib/agents/framework/private-clients";
import {
  signAgentFrameworkClaimCapability,
  signAgentFrameworkRequestCapability,
  signAgentFrameworkSourcingCapability,
} from "@/lib/agents/framework/capability";
import {
  MAX_AGENT_MEMORY_BYTES,
  MAX_AGENT_MEMORY_ITEMS,
  type AgentMemoryContext,
  type AgentMemoryScope,
} from "@/lib/agents/memory";

type ExecutionFailure =
  | "authority_unavailable"
  | "framework_disabled"
  | "configuration_invalid"
  | "workflow_unavailable"
  | "framework_unavailable"
  | "idempotency_conflict"
  | "in_progress"
  | "already_completed"
  | "authority_changed"
  | "proposal_invalid"
  | "receipt_failed";

export type AgentFrameworkExecutionResult =
  | {
      ok: true;
      runId: string;
      reports: string[];
      sourceReviewedCampaign: true;
      sourceQuery: string;
      sourcingCapabilityToken: string;
    }
  | { ok: false; code: ExecutionFailure };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function frameworkMemoryFromContext(context: AgentMemoryContext) {
  if (
    !Array.isArray(context.items) ||
    !Array.isArray(context.receipts) ||
    context.items.length !== context.receipts.length ||
    context.items.length > MAX_AGENT_MEMORY_ITEMS ||
    !Number.isInteger(context.totalBytes) ||
    context.totalBytes < 0 ||
    context.totalBytes > MAX_AGENT_MEMORY_BYTES
  ) {
    throw new Error("Agent framework memory context is inconsistent.");
  }

  let totalBytes = 0;
  const memoryIds = new Set<string>();
  const receiptAuthority: unknown[] = ["aria.agent-framework.memory-receipt.v1"];
  const items = context.items.map((item, index) => {
    const receipt = context.receipts[index];
    const byteCount = Buffer.byteLength(item.content, "utf8");
    if (
      !receipt ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item.memoryId) ||
      memoryIds.has(item.memoryId) ||
      receipt.memoryId !== item.memoryId ||
      receipt.position !== index ||
      !Number.isInteger(receipt.memoryRevision) ||
      receipt.memoryRevision < 1 ||
      !/^[0-9a-f]{64}$/.test(receipt.contentSha256) ||
      sha256(item.content) !== receipt.contentSha256 ||
      !Number.isInteger(receipt.byteCount) ||
      receipt.byteCount < 1 ||
      receipt.byteCount !== byteCount ||
      item.kind.length < 1 ||
      item.kind.length > 64 ||
      item.kind.trim() !== item.kind ||
      item.content.length < 1 ||
      item.content.length > MAX_AGENT_MEMORY_BYTES
    ) {
      throw new Error("Agent framework memory receipt no longer matches its content.");
    }
    memoryIds.add(item.memoryId);
    totalBytes += byteCount;
    receiptAuthority.push([
      receipt.memoryId,
      receipt.memoryRevision,
      receipt.contentSha256,
      receipt.position,
      receipt.byteCount,
    ]);
    return { kind: item.kind, content: item.content };
  });

  if (totalBytes !== context.totalBytes || totalBytes > MAX_AGENT_MEMORY_BYTES) {
    throw new Error("Agent framework memory byte count is inconsistent.");
  }
  return {
    policy: "untrusted-reference-v1" as const,
    receiptSha256: sha256(JSON.stringify(receiptAuthority)),
    items,
  };
}

function mapClaimFailure(status: string): ExecutionFailure {
  if (status === "framework_disabled") return "framework_disabled";
  if (status === "configuration_invalid") return "configuration_invalid";
  if (status === "workflow_unavailable") return "workflow_unavailable";
  if (status === "flowise_unavailable" || status === "deerflow_unavailable") return "framework_unavailable";
  if (status === "idempotency_conflict") return "idempotency_conflict";
  if (status === "in_progress") return "in_progress";
  if (status === "already_completed") return "already_completed";
  if (status === "authority_changed") return "authority_changed";
  return "authority_unavailable";
}

function proposalUsesOnlyReviewedAuthority(
  raw: unknown,
  workflow: Parameters<typeof proposalMatchesWorkflow>[1],
  reviewedGithubQueries: ReadonlySet<string>,
) {
  const parsed = AgentFrameworkProposalSchema.safeParse(raw);
  if (!parsed.success || !proposalMatchesWorkflow(parsed.data, workflow)) return null;
  let sourceActionCount = 0;
  let reportActionCount = 0;
  for (const action of parsed.data.actions) {
    if (action.kind === "source_query") {
      if (action.platform !== "GitHub" || !reviewedGithubQueries.has(action.query.trim())) return null;
      sourceActionCount += 1;
      continue;
    }
    if (action.kind === "report") reportActionCount += 1;
  }
  const workflowSourceCount = workflow.nodes.filter((node) => node.kind === "source_reviewed_campaign").length;
  const workflowReportCount = workflow.nodes.filter((node) => node.kind === "report").length;
  if (
    workflowSourceCount !== 1 ||
    sourceActionCount !== workflowSourceCount ||
    workflowReportCount !== 1 ||
    reportActionCount !== workflowReportCount
  ) return null;
  const sourceQuery = parsed.data.actions.find(
    (action): action is Extract<(typeof parsed.data.actions)[number], { kind: "source_query" }> =>
      action.kind === "source_query",
  )?.query.trim();
  return sourceQuery
    ? { proposal: parsed.data, sourceReviewedCampaign: true as const, sourceQuery }
    : null;
}

export async function executeAgentFrameworkRun(input: {
  client: FrameworkRpcClient;
  runtime: AgentFrameworkRuntimeConfiguration;
  deerflowToken: string;
  capabilitySecret: string;
  workspaceId: string;
  ownerId: string;
  actorId: string;
  specId: string;
  campaignId: string;
  campaignFingerprint: string;
  workflowVersionId: string;
  idempotencyKey: string;
  reviewedGithubQueries: string[];
  need: AgentFrameworkNeed;
  sourcingCount: number;
  loadMemoryContext: (scope: AgentMemoryScope, runId: string) => Promise<AgentMemoryContext>;
  revalidateAuthority: () => Promise<boolean>;
  fetcher?: typeof fetch;
}): Promise<AgentFrameworkExecutionResult> {
  const authorityStillValid = async () => {
    try {
      return await input.revalidateAuthority();
    } catch {
      return false;
    }
  };
  const reviewedQueries = input.reviewedGithubQueries.map((query) => ({
    platform: "GitHub" as const,
    query,
  }));
  let claimCapability: string;
  try {
    claimCapability = signAgentFrameworkClaimCapability(input.capabilitySecret, {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      actorId: input.actorId,
      specId: input.specId,
      campaignId: input.campaignId,
      workflowVersionId: input.workflowVersionId,
      campaignFingerprint: input.campaignFingerprint,
      configurationSha256: input.runtime.configurationSha256 ?? "",
      idempotencyKey: input.idempotencyKey,
      need: input.need,
      reviewedQueries,
    });
  } catch {
    return { ok: false, code: "configuration_invalid" };
  }
  const capabilitySha256 = sha256(claimCapability);
  const claimed = await claimAgentFrameworkRun(input.client, {
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    actorId: input.actorId,
    specId: input.specId,
    campaignId: input.campaignId,
    campaignFingerprint: input.campaignFingerprint,
    workflowVersionId: input.workflowVersionId,
    idempotencyKey: input.idempotencyKey,
    capabilitySha256,
  });
  if (!claimed.ok) return { ok: false, code: mapClaimFailure(claimed.status) };
  if ("recovery" in claimed) {
    if (claimed.recovery.sourcingCount !== input.sourcingCount) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (!await authorityStillValid()) {
      return { ok: false, code: "authority_changed" };
    }
    let sourcingCapabilityToken: string;
    try {
      sourcingCapabilityToken = signAgentFrameworkSourcingCapability(input.capabilitySecret, {
        runId: claimed.recovery.runId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        campaignId: input.campaignId,
        campaignFingerprint: input.campaignFingerprint,
        count: input.sourcingCount,
        sourceQuery: claimed.recovery.sourceQuery,
      });
    } catch {
      return { ok: false, code: "configuration_invalid" };
    }
    return {
      ok: true,
      runId: claimed.recovery.runId,
      sourceReviewedCampaign: true,
      sourceQuery: claimed.recovery.sourceQuery,
      sourcingCapabilityToken,
      reports: claimed.recovery.reports,
    };
  }
  const claim = claimed.claim;
  if (
    claim.configurationSha256 !== input.runtime.configurationSha256 ||
    claim.deerflowSourceCommit !== input.runtime.deerflowSourceCommit ||
    claim.deerflowImageDigest !== input.runtime.deerflowImageDigest ||
    claim.flowiseSourceCommit !== input.runtime.flowiseSourceCommit ||
    claim.flowiseImageDigest !== input.runtime.flowiseImageDigest ||
    claim.flowiseIsolation !== input.runtime.flowiseIsolation
  ) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "CONFIGURATION_MISMATCH");
    return { ok: false, code: "configuration_invalid" };
  }

  if (!await authorityStillValid()) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "AUTHORITY_CHANGED");
    return { ok: false, code: "authority_changed" };
  }

  let agentMemory;
  try {
    agentMemory = frameworkMemoryFromContext(await input.loadMemoryContext({
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      specId: input.specId,
    }, claim.runId));
  } catch {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "MEMORY_UNAVAILABLE");
    return { ok: false, code: "framework_unavailable" };
  }

  if (!await authorityStillValid()) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "AUTHORITY_CHANGED");
    return { ok: false, code: "authority_changed" };
  }

  const memoryEgress = await authorizeAgentFrameworkMemoryEgress(
    input.client,
    claim.runId,
    claim.leaseId,
  );
  if (!memoryEgress.ok) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "MEMORY_AUTHORITY_CHANGED");
    return {
      ok: false,
      code: memoryEgress.status === "memory_changed" || memoryEgress.status === "memory_in_use"
        ? "authority_changed"
        : "framework_unavailable",
    };
  }

  let proposal: unknown;
  let egressRelease: "released" | "authority_unavailable" = "authority_unavailable";
  try {
    const frameworkRequest = {
      runId: claim.runId,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      actorId: input.actorId,
      specId: input.specId,
      campaignId: input.campaignId,
      workflowVersionId: claim.workflowVersionId,
      campaignFingerprint: input.campaignFingerprint,
      configurationSha256: claim.configurationSha256,
      workflowSha256: claim.workflowSha256,
      workflow: claim.workflow,
      need: input.need,
      reviewedQueries,
      agentMemory,
      deerflowInstanceId: claim.deerflowInstanceId,
      flowiseInstanceId: claim.flowiseInstanceId,
      flowiseSourceCommit: claim.flowiseSourceCommit,
      flowiseImageDigest: claim.flowiseImageDigest,
      flowiseIsolation: claim.flowiseIsolation,
      idempotencyKey: input.idempotencyKey,
    };
    const capabilityToken = signAgentFrameworkRequestCapability(
      input.capabilitySecret,
      frameworkRequest,
    );
    proposal = await runDeerFlowProposal({
      ...frameworkRequest,
      capabilityToken,
    }, input.runtime, input.deerflowToken, input.fetcher);
  } catch {
    // The release is completed in finally before the run failure is recorded.
  } finally {
    egressRelease = await releaseAgentFrameworkMemoryEgress(
      input.client,
      claim.runId,
      claim.leaseId,
      memoryEgress.egressLeaseId,
    );
  }
  if (proposal === undefined || egressRelease !== "released") {
    await failAgentFrameworkRun(
      input.client,
      claim.runId,
      claim.leaseId,
      proposal === undefined ? "ADAPTER_FAILED" : "MEMORY_EGRESS_RELEASE_FAILED",
    );
    return { ok: false, code: "framework_unavailable" };
  }

  if (!await authorityStillValid()) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "AUTHORITY_CHANGED");
    return { ok: false, code: "authority_changed" };
  }

  const accepted = proposalUsesOnlyReviewedAuthority(
    proposal,
    claim.workflow,
    new Set(input.reviewedGithubQueries.map((query) => query.trim()).filter(Boolean)),
  );
  if (!accepted) {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "PROPOSAL_INVALID");
    return { ok: false, code: "proposal_invalid" };
  }

  for (const step of accepted.proposal.steps) {
    const receipt = await recordAgentFrameworkStep(input.client, {
      runId: claim.runId,
      leaseId: claim.leaseId,
      ordinal: step.ordinal,
      nodeKind: step.nodeKind,
      idempotencyKey: `${input.idempotencyKey}.${step.ordinal}`,
      requestSha256: step.requestSha256,
      responseSha256: step.responseSha256,
    });
    if (receipt !== "recorded" && receipt !== "replay") {
      await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "RECEIPT_FAILED");
      return { ok: false, code: "receipt_failed" };
    }
  }

  const proposalSha256 = sha256(JSON.stringify(accepted.proposal));
  const reports = accepted.proposal.actions
    .filter((action): action is Extract<(typeof accepted.proposal.actions)[number], { kind: "report" }> => action.kind === "report")
    .map((action) => action.summary);
  const sourcingCapabilityToken = signAgentFrameworkSourcingCapability(input.capabilitySecret, {
    runId: claim.runId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    campaignId: input.campaignId,
    campaignFingerprint: input.campaignFingerprint,
    count: input.sourcingCount,
    sourceQuery: accepted.sourceQuery,
  });
  const completed = await completeAgentFrameworkRun(
    input.client,
    claim.runId,
    claim.leaseId,
    proposalSha256,
    sha256(sourcingCapabilityToken),
    input.sourcingCount,
    accepted.sourceQuery,
    reports,
  );
  if (completed !== "proposed" && completed !== "replay") {
    await failAgentFrameworkRun(input.client, claim.runId, claim.leaseId, "RECEIPT_FAILED");
    return { ok: false, code: "receipt_failed" };
  }

  return {
    ok: true,
    runId: claim.runId,
    sourceReviewedCampaign: accepted.sourceReviewedCampaign,
    sourceQuery: accepted.sourceQuery,
    sourcingCapabilityToken,
    reports,
  };
}
