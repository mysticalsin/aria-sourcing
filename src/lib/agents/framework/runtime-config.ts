import { z } from "zod";
import {
  assessAgentFrameworkAuthoringRuntime,
  type AgentFrameworkRuntimeConfiguration,
} from "@/lib/agents/framework/contracts";
import {
  BoundedResponseError,
  readBoundedResponseText,
  responseOriginMatches,
} from "@/lib/agents/framework/bounded-response";
import { deriveAgentFrameworkConfigurationFromEnvironment } from "@/lib/agents/framework/configuration-core.mjs";

export interface AgentFrameworkServiceTokens {
  deerflowToken: string;
  flowiseToken: string;
}

const ReadinessIdentitySchema = z.object({
  ok: z.literal(true),
  readinessSchema: z.literal("aria.agent-framework-adapter-readiness.v2"),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  imageDigest: z.string().regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/),
  configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  workspaceId: z.string().uuid(),
  frameworkInstanceId: z.string().uuid(),
}).strict();

const DeerFlowAdapterReadinessSchema = ReadinessIdentitySchema.extend({
  framework: z.literal("deerflow"),
  contract: z.literal("aria.deerflow.run.v1"),
  dependencies: z.object({
    modelGateway: z.literal(true),
    runtimeHealth: z.literal(true),
    modelBinding: z.literal(true),
    assistantBinding: z.literal(true),
    policyBundle: z.literal(true),
  }).strict(),
}).strict();

const FlowiseAdapterReadinessSchema = ReadinessIdentitySchema.extend({
  framework: z.literal("flowise"),
  contract: z.literal("aria.flowise.import.v1"),
  isolation: z.enum(["instance-per-workspace", "licensed-enterprise-workspace"]),
  dependencies: z.object({
    database: z.literal(true),
    queue: z.literal(true),
    worker: z.literal(true),
    policy: z.literal(true),
  }).strict(),
}).strict();

const AdapterReadinessSchema = z.discriminatedUnion("framework", [
  DeerFlowAdapterReadinessSchema,
  FlowiseAdapterReadinessSchema,
]);

export function agentFrameworkRuntimeFromEnvironment(): {
  config: AgentFrameworkRuntimeConfiguration;
  tokens: AgentFrameworkServiceTokens;
} {
  const suppliedConfigurationSha256 = process.env.AGENT_FRAMEWORK_CONFIGURATION_SHA256 ?? "";
  let derivedConfigurationSha256 = "";
  try {
    derivedConfigurationSha256 = deriveAgentFrameworkConfigurationFromEnvironment(process.env).sha256;
  } catch {
    derivedConfigurationSha256 = "";
  }
  const configurationIntegrity = derivedConfigurationSha256.length === 64 &&
    suppliedConfigurationSha256 === derivedConfigurationSha256;
  return {
    config: {
      deerflowUrl: process.env.DEERFLOW_ADAPTER_URL,
      deerflowSourceCommit: process.env.DEERFLOW_SOURCE_COMMIT,
      deerflowImageDigest: process.env.DEERFLOW_IMAGE_DIGEST,
      flowiseUrl: process.env.FLOWISE_ADAPTER_URL,
      flowiseSourceCommit: process.env.FLOWISE_SOURCE_COMMIT,
      flowiseImageDigest: process.env.FLOWISE_IMAGE_DIGEST,
      flowiseIsolation: process.env.FLOWISE_TENANT_ISOLATION,
      configurationSha256: configurationIntegrity ? derivedConfigurationSha256 : undefined,
      configurationIntegrity,
      readinessWorkspaceId: process.env.AGENT_FRAMEWORK_READINESS_WORKSPACE_ID,
      readinessDeerflowInstanceId: process.env.DEERFLOW_FRAMEWORK_INSTANCE_ID,
      readinessFlowiseInstanceId: process.env.FLOWISE_FRAMEWORK_INSTANCE_ID,
      executionEnabled: process.env.AGENT_FRAMEWORK_EXECUTION_ENABLED === "true",
      // Missing or malformed values keep the emergency stop engaged.
      killSwitch: process.env.AGENT_FRAMEWORK_KILL_SWITCH !== "false",
    },
    tokens: {
      deerflowToken: process.env.DEERFLOW_ADAPTER_TOKEN ?? "",
      flowiseToken: process.env.FLOWISE_ADAPTER_TOKEN ?? "",
    },
  };
}

function validToken(value: string): boolean {
  return value.length >= 32 && value.length <= 4_096 && !/[\s\r\n]/.test(value);
}

async function probeAdapter(
  input: {
    framework: "deerflow" | "flowise";
    url: string;
    token: string;
    sourceCommit: string;
    imageDigest: string;
    configurationSha256: string;
    workspaceId: string;
    frameworkInstanceId: string;
    isolation?: string;
  },
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!validToken(input.token)) return false;
  try {
    const response = await fetcher(new URL("/readyz", input.url), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
        "X-Aria-Framework-Contract": input.framework === "deerflow"
          ? "aria.deerflow.run.v1"
          : "aria.flowise.import.v1",
        "X-Aria-Workspace-Id": input.workspaceId,
        "X-Aria-Framework-Instance-Id": input.frameworkInstanceId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
      redirect: "error",
    });
    const target = new URL("/readyz", input.url);
    if (!responseOriginMatches(response, target) || !response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    const text = await readBoundedResponseText(response, 64_000);
    const parsed = AdapterReadinessSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return false;
    const expectedContract = input.framework === "deerflow"
      ? "aria.deerflow.run.v1"
      : "aria.flowise.import.v1";
    return parsed.data.framework === input.framework &&
      parsed.data.contract === expectedContract &&
      parsed.data.sourceCommit === input.sourceCommit &&
      parsed.data.imageDigest === input.imageDigest &&
      parsed.data.configurationSha256 === input.configurationSha256 &&
      parsed.data.workspaceId === input.workspaceId &&
      parsed.data.frameworkInstanceId === input.frameworkInstanceId &&
      (input.framework !== "flowise" || (
        parsed.data.framework === "flowise" && parsed.data.isolation === input.isolation
      ));
  } catch (error) {
    if (error instanceof BoundedResponseError) return false;
    return false;
  }
}

/** A plain upstream `/ping` is deliberately insufficient. Each adapter must
 * prove its pinned identity and its framework-specific runtime facts. */
export async function probeAgentFrameworkAdapters(
  config: AgentFrameworkRuntimeConfiguration,
  tokens: AgentFrameworkServiceTokens,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  // Deployment health is independent from effect activation. Production must
  // remain healthy and observable while the emergency stop is engaged.
  if (!assessAgentFrameworkAuthoringRuntime(config).ready) return false;
  const workspaceId = config.readinessWorkspaceId ?? "";
  const deerflowInstanceId = config.readinessDeerflowInstanceId ?? "";
  const flowiseInstanceId = config.readinessFlowiseInstanceId ?? "";
  if (![workspaceId, deerflowInstanceId, flowiseInstanceId].every((value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )) return false;
  const [deerflow, flowise] = await Promise.all([
    probeAdapter({
      framework: "deerflow",
      url: config.deerflowUrl as string,
      token: tokens.deerflowToken,
      sourceCommit: config.deerflowSourceCommit as string,
      imageDigest: config.deerflowImageDigest as string,
      configurationSha256: config.configurationSha256 as string,
      workspaceId,
      frameworkInstanceId: deerflowInstanceId,
    }, fetcher),
    probeAdapter({
      framework: "flowise",
      url: config.flowiseUrl as string,
      token: tokens.flowiseToken,
      sourceCommit: config.flowiseSourceCommit as string,
      imageDigest: config.flowiseImageDigest as string,
      configurationSha256: config.configurationSha256 as string,
      workspaceId,
      frameworkInstanceId: flowiseInstanceId,
      isolation: config.flowiseIsolation,
    }, fetcher),
  ]);
  return deerflow && flowise;
}
