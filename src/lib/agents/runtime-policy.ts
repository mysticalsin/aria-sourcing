import { z } from "zod";

export const SupportedAgentGuardrailsSchema = z.object({
  autopilot: z.literal(false).default(false),
  canary_remaining: z.number().int().min(0).max(50).default(5),
  topics_allow: z.array(z.string()).max(0).default([]),
}).strict();

export const SupportedAgentChannelsSchema = z.tuple([z.literal("Email")]);

export interface AgentExecutionPolicy {
  channel: "Email";
  queueMode: "human_review";
  autopilotRequested: boolean;
}

export type AgentRuntimePolicyResult =
  | { ok: true; policy: AgentExecutionPolicy }
  | { ok: false; reason: string };

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
      queueMode: "human_review",
      autopilotRequested: false,
    },
  };
}
