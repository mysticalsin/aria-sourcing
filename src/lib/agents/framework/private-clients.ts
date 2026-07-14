import {
  AgentFrameworkProposalSchema,
  AgentFrameworkRunRequestSchema,
  AgentWorkflowV1Schema,
  assessAgentFrameworkAuthoringRuntime,
  assessAgentFrameworkRuntime,
  type AgentFrameworkProposal,
  type AgentFrameworkRunRequest,
  type AgentFrameworkRuntimeConfiguration,
  type AgentWorkflowV1,
} from "@/lib/agents/framework/contracts";
import {
  BoundedResponseError,
  readBoundedResponseText,
  responseOriginMatches,
} from "@/lib/agents/framework/bounded-response";

const MAX_FRAMEWORK_RESPONSE_BYTES = 2_000_000;
const FLOW_ID = /^[A-Za-z0-9_-]{1,120}$/;

export class AgentFrameworkAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AgentFrameworkAdapterError";
  }
}

function requirePrivateRuntime(config: AgentFrameworkRuntimeConfiguration): void {
  const readiness = assessAgentFrameworkRuntime(config);
  if (!readiness.ready) {
    throw new AgentFrameworkAdapterError(
      "framework-not-ready",
      `Agent framework runtime is not ready (${readiness.reasons.join(",")}).`,
    );
  }
}

function requirePrivateAuthoringRuntime(config: AgentFrameworkRuntimeConfiguration): void {
  const readiness = assessAgentFrameworkAuthoringRuntime(config);
  if (!readiness.ready) {
    throw new AgentFrameworkAdapterError(
      "framework-not-ready",
      `Agent framework authoring runtime is not ready (${readiness.reasons.join(",")}).`,
    );
  }
}

function requireServiceToken(token: string): void {
  if (token.length < 32 || token.length > 4_096 || /[\s\r\n]/.test(token)) {
    throw new AgentFrameworkAdapterError("framework-token-invalid", "Agent framework service token is invalid.");
  }
}

async function readBoundedJson(response: Response, errorCode: string): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedResponseText(response, MAX_FRAMEWORK_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedResponseError) {
      throw new AgentFrameworkAdapterError(errorCode, "Agent framework response exceeded the size limit.");
    }
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentFrameworkAdapterError(errorCode, "Agent framework returned an invalid response.");
  }
}

/**
 * Calls the private ARIA-owned DeerFlow adapter contract. This never calls the
 * broad DeerFlow Gateway and never sends provider credentials or candidate
 * records; DeerFlow may return proposals only.
 */
export async function runDeerFlowProposal(
  rawRequest: AgentFrameworkRunRequest,
  config: AgentFrameworkRuntimeConfiguration,
  serviceToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentFrameworkProposal> {
  requirePrivateRuntime(config);
  requireServiceToken(serviceToken);
  const request = AgentFrameworkRunRequestSchema.parse(rawRequest);
  const target = new URL("/v1/aria/runs", config.deerflowUrl);

  let response: Response;
  try {
    response = await fetcher(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        "Content-Type": "application/json",
        "X-Aria-Framework-Contract": "aria.deerflow.run.v1",
        "X-Aria-Workspace-Id": request.workspaceId,
        "X-Aria-Framework-Instance-Id": request.deerflowInstanceId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
  } catch {
    throw new AgentFrameworkAdapterError("deerflow-unreachable", "The private DeerFlow adapter is unavailable.");
  }
  if (!responseOriginMatches(response, target) || !response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AgentFrameworkAdapterError("deerflow-upstream-error", "The private DeerFlow adapter rejected the run.");
  }

  const parsed = AgentFrameworkProposalSchema.safeParse(
    await readBoundedJson(response, "deerflow-response-invalid"),
  );
  if (!parsed.success || parsed.data.runId !== request.runId) {
    throw new AgentFrameworkAdapterError("deerflow-response-invalid", "The private DeerFlow proposal was invalid.");
  }
  return parsed.data;
}

export interface FlowiseWorkflowBinding {
  workspaceId: string;
  frameworkInstanceId: string;
  externalWorkflowId: string;
  expectedName: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compileFlowiseExport(
  raw: unknown,
  binding: FlowiseWorkflowBinding,
  config: AgentFrameworkRuntimeConfiguration,
): AgentWorkflowV1 {
  const envelope = record(raw);
  const exported = record(envelope?.workflow);
  if (
    !envelope ||
    envelope.workspaceId !== binding.workspaceId ||
    envelope.frameworkInstanceId !== binding.frameworkInstanceId ||
    envelope.sourceCommit !== config.flowiseSourceCommit ||
    envelope.imageDigest !== config.flowiseImageDigest ||
    !exported ||
    exported.id !== binding.externalWorkflowId ||
    exported.name !== binding.expectedName ||
    typeof exported.flowData !== "string"
  ) {
    throw new AgentFrameworkAdapterError("flowise-workflow-rejected", "The Flowise workflow binding did not match.");
  }

  let graph: Record<string, unknown> | null = null;
  try {
    graph = record(JSON.parse(exported.flowData));
  } catch {
    graph = null;
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new AgentFrameworkAdapterError("flowise-workflow-rejected", "The Flowise workflow export was invalid.");
  }

  const nodes = graph.nodes.map((rawNode) => {
    const node = record(rawNode);
    const data = record(node?.data);
    return { id: node?.id, kind: data?.ariaKind };
  });
  const edges = graph.edges.map((rawEdge) => {
    const edge = record(rawEdge);
    return { from: edge?.source, to: edge?.target };
  });
  const compiled = AgentWorkflowV1Schema.safeParse({
    version: 1,
    name: exported.name,
    nodes,
    edges,
  });
  if (!compiled.success) {
    throw new AgentFrameworkAdapterError(
      "flowise-workflow-rejected",
      "The Flowise workflow contains unsupported or unsafe nodes.",
    );
  }
  return compiled.data;
}

/**
 * Imports one server-bound Flowise graph over the private network and compiles
 * it into ARIA's allowlisted IR. Raw Flowise nodes, credentials, and tools are
 * never stored as executable authority.
 */
export async function importFlowiseWorkflow(
  binding: FlowiseWorkflowBinding,
  config: AgentFrameworkRuntimeConfiguration,
  serviceToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentWorkflowV1> {
  requirePrivateAuthoringRuntime(config);
  requireServiceToken(serviceToken);
  if (
    !/^[0-9a-f-]{36}$/i.test(binding.workspaceId) ||
    !/^[0-9a-f-]{36}$/i.test(binding.frameworkInstanceId) ||
    !FLOW_ID.test(binding.externalWorkflowId) ||
    binding.expectedName.trim().length < 1 ||
    binding.expectedName.length > 120
  ) {
    throw new AgentFrameworkAdapterError("flowise-binding-invalid", "The Flowise workflow binding is invalid.");
  }

  const target = new URL(`/v1/aria/workflows/${encodeURIComponent(binding.externalWorkflowId)}/export`, config.flowiseUrl);
  let response: Response;
  try {
    response = await fetcher(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        Accept: "application/json",
        "X-Aria-Framework-Contract": "aria.flowise.import.v1",
        "X-Aria-Workspace-Id": binding.workspaceId,
        "X-Aria-Framework-Instance-Id": binding.frameworkInstanceId,
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new AgentFrameworkAdapterError("flowise-unreachable", "The private Flowise adapter is unavailable.");
  }
  if (!responseOriginMatches(response, target) || !response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AgentFrameworkAdapterError("flowise-upstream-error", "The private Flowise adapter rejected the import.");
  }
  return compileFlowiseExport(
    await readBoundedJson(response, "flowise-workflow-rejected"),
    binding,
    config,
  );
}
