import { z } from "zod";

const StoredGuardrailsSchema = z.object({
  autopilot: z.boolean().default(false),
  canary_remaining: z.number().int().min(0).max(50).default(5),
  topics_allow: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  max_per_day: z.number().int().min(1).max(200).optional(),
}).passthrough();

const StoredChannelsSchema = z.array(z.enum(["Email", "LinkedIn", "WhatsApp", "SMS"])).min(1).max(4);

export interface AgentExecutionPolicy {
  channel: "Email";
  topicsAllow: string[];
  queueMode: "human_review";
  autopilotRequested: boolean;
  maxPerDay?: number;
}

export type AgentRuntimePolicyResult =
  | { ok: true; policy: AgentExecutionPolicy }
  | { ok: false; reason: string };

/**
 * The graph currently produces first-touch email drafts only. Stored specs for
 * other channels fail closed instead of silently running with Email semantics.
 * Legacy autopilot flags are recorded for audit but never grant delivery
 * authority: this release always terminates in named human review.
 */
export function resolveStoredAgentRuntimePolicy(
  channels: unknown,
  guardrails: unknown,
): AgentRuntimePolicyResult {
  const parsedChannels = StoredChannelsSchema.safeParse(channels);
  const parsedGuardrails = StoredGuardrailsSchema.safeParse(guardrails);
  if (!parsedChannels.success || !parsedGuardrails.success) {
    return { ok: false, reason: "Stored agent execution policy is invalid." };
  }
  if (parsedChannels.data.length !== 1 || parsedChannels.data[0] !== "Email") {
    return { ok: false, reason: "Stored agent has no supported queue-only draft channel." };
  }

  return {
    ok: true,
    policy: {
      channel: "Email",
      topicsAllow: [...new Set(parsedGuardrails.data.topics_allow)],
      queueMode: "human_review",
      autopilotRequested: parsedGuardrails.data.autopilot,
      ...(parsedGuardrails.data.max_per_day === undefined
        ? {}
        : { maxPerDay: parsedGuardrails.data.max_per_day }),
    },
  };
}
