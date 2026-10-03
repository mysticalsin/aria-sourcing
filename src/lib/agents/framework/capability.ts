import type {
  AgentFrameworkNeed,
  AgentFrameworkRunRequest,
} from "@/lib/agents/framework/contracts";
import {
  buildAgentFrameworkRequestAuthority,
  signAgentFrameworkAuthority,
  verifyAgentFrameworkRequestCapabilityCore,
} from "@/lib/agents/framework/capability-core.mjs";

type ReviewedQuery = AgentFrameworkRunRequest["reviewedQueries"][number];

export type AgentFrameworkClaimCapabilityInput = {
  workspaceId: string;
  ownerId: string;
  actorId: string;
  specId: string;
  campaignId: string;
  workflowVersionId: string;
  campaignFingerprint: string;
  configurationSha256: string;
  idempotencyKey: string;
  need: AgentFrameworkNeed;
  reviewedQueries: ReviewedQuery[];
};

export type AgentFrameworkRequestCapabilityInput = Omit<
  AgentFrameworkRunRequest,
  "capabilityToken"
>;

export type AgentFrameworkSourcingCapabilityInput = {
  runId: string;
  workspaceId: string;
  actorId: string;
  campaignId: string;
  campaignFingerprint: string;
  count: number;
  sourceQuery: string;
};

function needAuthority(need: AgentFrameworkNeed): unknown[] {
  return [
    need.title,
    need.seniority,
    need.employmentType,
    need.locationType,
    need.location ?? null,
    need.regions,
    need.requiredSkills,
    need.niceToHaveSkills,
    need.minYearsExperience,
    need.maxYearsExperience,
    need.industryExperience,
  ];
}

function queryAuthority(queries: ReviewedQuery[]): unknown[] {
  return queries.map((query) => [query.platform, query.query]);
}

export function signAgentFrameworkClaimCapability(
  secret: string,
  input: AgentFrameworkClaimCapabilityInput,
): string {
  return signAgentFrameworkAuthority(secret, [
    "aria.agent-framework.claim.v1",
    input.workspaceId,
    input.ownerId,
    input.actorId,
    input.specId,
    input.campaignId,
    input.workflowVersionId,
    input.campaignFingerprint,
    input.configurationSha256,
    input.idempotencyKey,
    needAuthority(input.need),
    queryAuthority(input.reviewedQueries),
  ]);
}

export function signAgentFrameworkRequestCapability(
  secret: string,
  input: AgentFrameworkRequestCapabilityInput,
): string {
  return signAgentFrameworkAuthority(secret, buildAgentFrameworkRequestAuthority(input));
}

export function verifyAgentFrameworkRequestCapability(
  secret: string,
  input: AgentFrameworkRequestCapabilityInput,
  token: string,
): boolean {
  return verifyAgentFrameworkRequestCapabilityCore(secret, input, token);
}

export function signAgentFrameworkSourcingCapability(
  secret: string,
  input: AgentFrameworkSourcingCapabilityInput,
): string {
  return signAgentFrameworkAuthority(secret, [
    "aria.agent-framework.sourcing.v1",
    input.runId,
    input.workspaceId,
    input.actorId,
    input.campaignId,
    input.campaignFingerprint,
    input.count,
    input.sourceQuery,
  ]);
}
