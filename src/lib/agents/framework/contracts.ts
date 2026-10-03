import { z } from "zod";

import {
  EMPLOYMENT_TYPES,
  LOCATION_TYPES,
  SENIORITY_LEVELS,
} from "@/lib/types";
import { normalizePrivateInternalUrl } from "@/lib/agents/framework/configuration-core.mjs";

/** Audited upstream revisions. Branch names and floating tags are forbidden. */
export const DEERFLOW_SOURCE_COMMIT = "fabadae4168db81f0eaaf62f209050f978e2f691";
export const FLOWISE_SOURCE_COMMIT = "bb773ffa710bd22639c4ba2643413a0ea2b679d3";

const WorkflowNodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  kind: z.enum([
    "plan",
    "source_reviewed_campaign",
    "report",
  ]),
}).strict();

const WorkflowEdgeSchema = z.object({
  from: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  to: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
}).strict();

/**
 * ARIA's immutable intermediate representation. Flowise may author a graph and
 * DeerFlow may orchestrate it, but neither framework can add arbitrary code,
 * HTTP, MCP, credential, provider, nested-flow, or delivery capabilities.
 */
export const AgentWorkflowV1Schema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  nodes: z.array(WorkflowNodeSchema).min(1).max(24),
  edges: z.array(WorkflowEdgeSchema).max(48),
}).strict().superRefine((workflow, ctx) => {
  if (workflow.nodes.filter((node) => node.kind === "source_reviewed_campaign").length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodes"],
      message: "Workflow must contain exactly one reviewed sourcing node.",
    });
    return;
  }
  if (workflow.nodes.filter((node) => node.kind === "report").length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodes"],
      message: "Workflow must contain exactly one report node.",
    });
    return;
  }
  const ids = workflow.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "Workflow node IDs must be unique." });
    return;
  }

  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const edgeKeys = new Set<string>();
  for (const edge of workflow.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to) || edge.from === edge.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Workflow edges must reference distinct known nodes." });
      return;
    }
    const key = `${edge.from}\u0000${edge.to}`;
    if (edgeKeys.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Workflow edges must be unique." });
      return;
    }
    edgeKeys.add(key);
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const roots = ids.filter((id) => indegree.get(id) === 0);
  if (roots.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Workflow must have exactly one root." });
    return;
  }

  const pending = [...roots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  if (visited.size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Workflow must be connected and acyclic." });
    return;
  }

  const remaining = new Map(indegree);
  const queue = ids.filter((id) => remaining.get(id) === 0);
  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    processed += 1;
    for (const next of adjacency.get(current) ?? []) {
      const value = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, value);
      if (value === 0) queue.push(next);
    }
  }
  if (processed !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Workflow cycles are forbidden." });
  }
});

export type AgentWorkflowV1 = z.infer<typeof AgentWorkflowV1Schema>;

const BoundedId = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedNeedText = z.string().trim().max(200);

const AgentMemoryItemSchema = z.object({
  kind: z.string().min(1).max(64).refine((value) => value.trim() === value),
  content: z.string().min(1).max(8_192),
}).strict();

export const AgentFrameworkMemorySchema = z.object({
  policy: z.literal("untrusted-reference-v1"),
  receiptSha256: Sha256,
  items: z.array(AgentMemoryItemSchema).max(8),
}).strict().superRefine((memory, ctx) => {
  const totalBytes = memory.items.reduce(
    (total, item) => total + new TextEncoder().encode(item.content).byteLength,
    0,
  );
  if (totalBytes > 8_192) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items"],
      message: "Agent memory exceeds the context byte limit.",
    });
  }
});

export type AgentFrameworkMemory = z.infer<typeof AgentFrameworkMemorySchema>;

export const AgentFrameworkNeedSchema = z.object({
  title: BoundedNeedText.min(1),
  seniority: z.enum(SENIORITY_LEVELS),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  locationType: z.enum(LOCATION_TYPES),
  location: BoundedNeedText.optional(),
  regions: z.array(BoundedNeedText.min(1)).max(50),
  requiredSkills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  niceToHaveSkills: z.array(z.string().trim().min(1).max(100)).max(100),
  minYearsExperience: z.number().finite().nonnegative().max(100).nullable(),
  maxYearsExperience: z.number().finite().nonnegative().max(100).nullable(),
  industryExperience: z.array(z.string().trim().min(1).max(100)).max(50),
}).strict().refine(
  (need) => need.maxYearsExperience === null || need.minYearsExperience === null ||
    need.maxYearsExperience >= need.minYearsExperience,
  { message: "Maximum experience cannot be lower than minimum experience." },
);

export type AgentFrameworkNeed = z.infer<typeof AgentFrameworkNeedSchema>;

export function normalizeAgentRoleTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Only opaque authority references cross the DeerFlow process boundary. */
export const AgentFrameworkRunRequestSchema = z.object({
  runId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ownerId: z.string().uuid(),
  actorId: z.string().uuid(),
  specId: z.string().uuid(),
  campaignId: BoundedId,
  workflowVersionId: z.string().uuid(),
  campaignFingerprint: Sha256,
  configurationSha256: Sha256,
  workflowSha256: Sha256,
  workflow: AgentWorkflowV1Schema,
  need: AgentFrameworkNeedSchema,
  reviewedQueries: z.array(z.object({
    platform: z.literal("GitHub"),
    query: z.string().trim().min(3).max(256),
  }).strict()).min(1).max(20),
  agentMemory: AgentFrameworkMemorySchema,
  deerflowInstanceId: z.string().uuid(),
  flowiseInstanceId: z.string().uuid(),
  flowiseSourceCommit: z.literal(FLOWISE_SOURCE_COMMIT),
  flowiseImageDigest: z.string().regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/),
  flowiseIsolation: z.enum(["instance-per-workspace", "licensed-enterprise-workspace"]),
  idempotencyKey: BoundedId,
  capabilityToken: z.string().min(32).max(4_096).regex(/^\S+$/),
}).strict();

export type AgentFrameworkRunRequest = z.infer<typeof AgentFrameworkRunRequestSchema>;

const FrameworkActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("source_query"),
    platform: z.enum(["GitHub", "Stack Overflow", "Dribbble", "Behance"]),
    query: z.string().trim().min(3).max(256),
  }).strict(),
  z.object({
    kind: z.literal("report"),
    summary: z.string().trim().min(1).max(500),
  }).strict(),
]);

const FrameworkStepReceiptSchema = z.object({
  ordinal: z.number().int().min(0).max(99),
  nodeId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  nodeKind: WorkflowNodeSchema.shape.kind,
  requestSha256: Sha256,
  responseSha256: Sha256,
}).strict();

/** Framework output is a proposal. ARIA remains the sole effect authority. */
export const AgentFrameworkProposalSchema = z.object({
  runId: z.string().uuid(),
  status: z.literal("proposed"),
  steps: z.array(FrameworkStepReceiptSchema).min(1).max(24),
  actions: z.array(FrameworkActionSchema).max(48),
}).strict().superRefine((proposal, ctx) => {
  const ordinals = new Set(proposal.steps.map((step) => step.ordinal));
  const nodeIds = new Set(proposal.steps.map((step) => step.nodeId));
  if (ordinals.size !== proposal.steps.length || nodeIds.size !== proposal.steps.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: "Framework step receipts must be unique." });
  }
});

export type AgentFrameworkProposal = z.infer<typeof AgentFrameworkProposalSchema>;

export const AgentFrameworkRunSuccessResponseSchema = z.object({
  ok: z.literal(true),
  runId: z.string().uuid(),
  reports: z.array(z.string().trim().min(1).max(500)).max(24),
  command: z.object({
    kind: z.literal("source_reviewed_campaign"),
    campaignId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    count: z.number().int().min(1).max(8),
    query: z.string().trim().min(3).max(256),
    capabilityToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).strict(),
  requestId: z.string().min(1).max(100),
}).strict();

export type AgentFrameworkRunSuccessResponse = z.infer<typeof AgentFrameworkRunSuccessResponseSchema>;

export function proposalMatchesWorkflow(
  proposal: AgentFrameworkProposal,
  workflow: AgentWorkflowV1,
): boolean {
  if (proposal.steps.length !== workflow.nodes.length) return false;
  const expected = new Map(workflow.nodes.map((node) => [node.id, node.kind]));
  const order = new Map<string, number>();
  for (const [index, step] of [...proposal.steps]
    .sort((left, right) => left.ordinal - right.ordinal)
    .entries()) {
    if (step.ordinal !== index || expected.get(step.nodeId) !== step.nodeKind) return false;
    order.set(step.nodeId, step.ordinal);
  }
  if (order.size !== expected.size) return false;
  return workflow.edges.every((edge) =>
    (order.get(edge.from) ?? Number.MAX_SAFE_INTEGER) <
    (order.get(edge.to) ?? Number.MIN_SAFE_INTEGER));
}

export interface AgentFrameworkRuntimeConfiguration {
  deerflowUrl?: string;
  deerflowSourceCommit?: string;
  deerflowImageDigest?: string;
  flowiseUrl?: string;
  flowiseSourceCommit?: string;
  flowiseImageDigest?: string;
  flowiseIsolation?: string;
  configurationSha256?: string;
  configurationIntegrity?: boolean;
  readinessWorkspaceId?: string;
  readinessDeerflowInstanceId?: string;
  readinessFlowiseInstanceId?: string;
  executionEnabled?: boolean;
  killSwitch?: boolean;
}

const ImmutableImageDigest = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/;

function isPrivateServiceUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    normalizePrivateInternalUrl(value, "framework adapter URL");
    return true;
  } catch {
    return false;
  }
}

export function assessAgentFrameworkAuthoringRuntime(
  config: AgentFrameworkRuntimeConfiguration,
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (config.configurationIntegrity === false) reasons.push("framework-configuration-sha256-mismatch");
  if (!Sha256.safeParse(config.configurationSha256).success) reasons.push("framework-configuration-sha256-required");
  if (!isPrivateServiceUrl(config.deerflowUrl)) reasons.push("deerflow-private-url-required");
  if (config.deerflowSourceCommit !== DEERFLOW_SOURCE_COMMIT) reasons.push("deerflow-source-commit-mismatch");
  if (!ImmutableImageDigest.test(config.deerflowImageDigest ?? "")) reasons.push("deerflow-image-digest-required");
  if (!isPrivateServiceUrl(config.flowiseUrl)) reasons.push("flowise-private-url-required");
  if (config.flowiseSourceCommit !== FLOWISE_SOURCE_COMMIT) reasons.push("flowise-source-commit-mismatch");
  if (!ImmutableImageDigest.test(config.flowiseImageDigest ?? "")) reasons.push("flowise-image-digest-required");
  if (!["instance-per-workspace", "licensed-enterprise-workspace"].includes(config.flowiseIsolation ?? "")) {
    reasons.push("flowise-tenant-isolation-unproven");
  }
  return { ready: reasons.length === 0, reasons };
}

export function assessAgentFrameworkRuntime(
  config: AgentFrameworkRuntimeConfiguration,
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!config.executionEnabled) reasons.push("framework-execution-disabled");
  if (config.killSwitch) reasons.push("framework-kill-switch-active");
  reasons.push(...assessAgentFrameworkAuthoringRuntime(config).reasons);
  return { ready: reasons.length === 0, reasons };
}
