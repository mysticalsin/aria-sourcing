import { z } from "zod";

export const SupportedAgentRoleBriefSchema = z.object({
  title: z.string().trim().min(1).max(120),
}).passthrough();

export const SupportedAgentGuardrailsSchema = z.object({
  autopilot: z.literal(false).default(false),
  canary_remaining: z.number().int().min(0).max(50).default(5),
  topics_allow: z.array(z.string()).max(0).default([]),
}).strict();

export const SupportedAgentChannelsSchema = z.tuple([z.literal("Email")]);

export interface AgentExecutionPolicy {
  channel: "Email";
  draftStorage: "run_history";
  deliveryAuthority: "none";
}

export type AgentRuntimePolicyResult =
  | { ok: true; policy: AgentExecutionPolicy }
  | { ok: false; reason: string };

export interface AgentRuntimeAvailability {
  runtime_eligible: boolean;
  runtime_reason: string | null;
}

export const ApprovedAgentWorkflowBindingSchema = z.object({
  workflowVersionId: z.string().uuid(),
  workflowName: z.string().trim().min(1).max(120),
  workflowSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type ApprovedAgentWorkflowBinding = z.infer<typeof ApprovedAgentWorkflowBindingSchema>;

export interface AgentFrameworkRuntimeAvailabilityContext {
  authorityAvailable: boolean;
  runtimeReady: boolean;
  approvedWorkflow?: unknown;
}

/**
 * The graph currently produces first-touch email drafts only. Stored specs for
 * other channels fail closed instead of silently running with Email semantics.
 * Unsupported or unknown authority fields fail closed. This release always
 * terminates with drafts in run history and grants no delivery authority.
 */
export function resolveStoredAgentRuntimePolicy(
  channels: unknown,
  guardrails: unknown,
): AgentRuntimePolicyResult {
  const parsedChannels = SupportedAgentChannelsSchema.safeParse(channels);
  const parsedGuardrails = SupportedAgentGuardrailsSchema.safeParse(guardrails);
  if (!parsedChannels.success || !parsedGuardrails.success) {
    return { ok: false, reason: "Stored agent execution policy is invalid." };
  }
  return {
    ok: true,
    policy: {
      channel: "Email",
      draftStorage: "run_history",
      deliveryAuthority: "none",
    },
  };
}

export function describeStoredAgentRuntimeAvailability(
  roleBrief: unknown,
  channels: unknown,
  guardrails: unknown,
  status: unknown,
  ownerId: unknown,
  actorId: unknown,
  framework: AgentFrameworkRuntimeAvailabilityContext = {
    authorityAvailable: false,
    runtimeReady: false,
  },
): AgentRuntimeAvailability {
  if (typeof ownerId !== "string" || typeof actorId !== "string" || ownerId !== actorId) {
    return { runtime_eligible: false, runtime_reason: "Only the agent owner can run this spec." };
  }
  if (status !== "active") {
    return { runtime_eligible: false, runtime_reason: "Stored agent must be active before it can run." };
  }
  if (!SupportedAgentRoleBriefSchema.safeParse(roleBrief).success) {
    return { runtime_eligible: false, runtime_reason: "Stored agent role brief is invalid." };
  }
  const resolved = resolveStoredAgentRuntimePolicy(channels, guardrails);
  if (!resolved.ok) {
    return { runtime_eligible: false, runtime_reason: resolved.reason };
  }
  if (!framework.authorityAvailable) {
    return {
      runtime_eligible: false,
      runtime_reason: "Approved workflow authority is unavailable.",
    };
  }
  if (!ApprovedAgentWorkflowBindingSchema.safeParse(framework.approvedWorkflow).success) {
    return {
      runtime_eligible: false,
      runtime_reason: "An approved workflow from the agent framework is required before this spec can run.",
    };
  }
  if (!framework.runtimeReady) {
    return {
      runtime_eligible: false,
      runtime_reason: "Agent framework runtime is unavailable.",
    };
  }
  return {
    runtime_eligible: true,
    runtime_reason: null,
  };
}
