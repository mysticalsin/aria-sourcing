import { createHmac, timingSafeEqual } from "node:crypto";

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4_096 || /[\r\n]/.test(secret)) {
    throw new Error("invalid agent framework capability secret");
  }
}

function needAuthority(need) {
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

function queryAuthority(queries) {
  return queries.map((query) => [query.platform, query.query]);
}

function workflowAuthority(workflow) {
  return [
    workflow.version,
    workflow.name,
    workflow.nodes.map((node) => [node.id, node.kind]),
    workflow.edges.map((edge) => [edge.from, edge.to]),
  ];
}

export function buildAgentFrameworkRequestAuthority(input) {
  return [
    "aria.deerflow.run.v1",
    input.runId,
    input.workspaceId,
    input.ownerId,
    input.actorId,
    input.specId,
    input.campaignId,
    input.workflowVersionId,
    input.campaignFingerprint,
    input.configurationSha256,
    input.workflowSha256,
    workflowAuthority(input.workflow),
    input.deerflowInstanceId,
    input.flowiseInstanceId,
    input.flowiseSourceCommit,
    input.flowiseImageDigest,
    input.flowiseIsolation,
    input.idempotencyKey,
    needAuthority(input.need),
    queryAuthority(input.reviewedQueries),
  ];
}

export function signAgentFrameworkAuthority(secret, authority) {
  requireSecret(secret);
  return createHmac("sha256", secret)
    .update(JSON.stringify(authority), "utf8")
    .digest("base64url");
}

export function signAgentFrameworkRequestCapabilityCore(secret, input) {
  return signAgentFrameworkAuthority(secret, buildAgentFrameworkRequestAuthority(input));
}

export function verifyAgentFrameworkRequestCapabilityCore(secret, input, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    const expected = Buffer.from(signAgentFrameworkRequestCapabilityCore(secret, input), "base64url");
    const supplied = Buffer.from(token, "base64url");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}
