import { z } from "zod";
import type { JobAnalysis } from "@/lib/types";

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
  queueMode: "human_review";
  autopilotRequested: boolean;
}

export type AgentRuntimePolicyResult =
  | { ok: true; policy: AgentExecutionPolicy }
  | { ok: false; reason: string };

export interface AgentRuntimeAvailability {
  runtime_eligible: boolean;
  runtime_reason: string | null;
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
      queueMode: "human_review",
      autopilotRequested: false,
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Legacy role briefs may contain additional descriptive fields. Normalize the
 * stored value, but require the title that the graph needs to execute. */
export function normalizeStoredAgentRoleBrief(value: unknown): JobAnalysis | null {
  const parsed = SupportedAgentRoleBriefSchema.safeParse(value);
  if (!parsed.success) return null;
  const brief = parsed.data;
  const numberOrNull = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;

  return {
    ...brief,
    title: brief.title,
    department: typeof brief.department === "string" ? brief.department : "",
    seniority: typeof brief.seniority === "string" ? brief.seniority : "Senior",
    employmentType: typeof brief.employmentType === "string" ? brief.employmentType : "Full-time",
    locationType: typeof brief.locationType === "string" ? brief.locationType : "Remote",
    location: typeof brief.location === "string" ? brief.location : "",
    regions: stringArray(brief.regions),
    timezone: typeof brief.timezone === "string" ? brief.timezone : "",
    salaryMin: numberOrNull(brief.salaryMin),
    salaryMax: numberOrNull(brief.salaryMax),
    currency: typeof brief.currency === "string" ? brief.currency : "",
    equity: brief.equity === true,
    requiredSkills: stringArray(brief.requiredSkills).length
      ? stringArray(brief.requiredSkills)
      : stringArray(brief.skills),
    niceToHaveSkills: stringArray(brief.niceToHaveSkills),
    minYearsExperience: numberOrNull(brief.minYearsExperience),
    maxYearsExperience: numberOrNull(brief.maxYearsExperience),
    education: typeof brief.education === "string" ? brief.education : "",
    industryExperience: stringArray(brief.industryExperience),
    companyStageTarget: stringArray(brief.companyStageTarget),
    teamSize: typeof brief.teamSize === "string" ? brief.teamSize : "",
    reportingTo: typeof brief.reportingTo === "string" ? brief.reportingTo : "",
    urgency: typeof brief.urgency === "string" ? brief.urgency : "Standard",
    validationWarnings: [],
  } as JobAnalysis;
}

export function describeStoredAgentRuntimeAvailability(
  roleBrief: unknown,
  channels: unknown,
  guardrails: unknown,
): AgentRuntimeAvailability {
  if (!normalizeStoredAgentRoleBrief(roleBrief)) {
    return { runtime_eligible: false, runtime_reason: "Stored agent role brief is invalid." };
  }
  const resolved = resolveStoredAgentRuntimePolicy(channels, guardrails);
  return resolved.ok
    ? { runtime_eligible: true, runtime_reason: null }
    : { runtime_eligible: false, runtime_reason: resolved.reason };
}
