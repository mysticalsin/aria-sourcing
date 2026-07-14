import assert from "node:assert/strict";

import {
  signAgentFrameworkClaimCapability,
  signAgentFrameworkRequestCapability,
  type AgentFrameworkRequestCapabilityInput,
  verifyAgentFrameworkRequestCapability,
} from "../src/lib/agents/framework/capability";
import { FLOWISE_SOURCE_COMMIT } from "../src/lib/agents/framework/contracts";

const secret = "z".repeat(48);
const request: AgentFrameworkRequestCapabilityInput = {
  runId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  ownerId: "30000000-0000-4000-8000-000000000003",
  actorId: "30000000-0000-4000-8000-000000000003",
  specId: "40000000-0000-4000-8000-000000000004",
  campaignId: "campaign-a",
  workflowVersionId: "50000000-0000-4000-8000-000000000005",
  campaignFingerprint: "a".repeat(64),
  configurationSha256: "e".repeat(64),
  workflowSha256: "b".repeat(64),
  workflow: {
    version: 1 as const,
    name: "Reviewed sourcing",
    nodes: [{ id: "source", kind: "source_reviewed_campaign" as const }],
    edges: [],
  },
  need: {
    title: "Staff Backend Engineer",
    seniority: "Staff" as const,
    employmentType: "Full-time" as const,
    locationType: "Hybrid" as const,
    location: "Montreal",
    regions: ["Canada"],
    requiredSkills: ["TypeScript"],
    niceToHaveSkills: [],
    minYearsExperience: 7,
    maxYearsExperience: null,
    industryExperience: ["SaaS"],
  },
  reviewedQueries: [{ platform: "GitHub" as const, query: "language:typescript location:montreal" }],
  agentMemory: {
    policy: "untrusted-reference-v1" as const,
    receiptSha256: "f".repeat(64),
    items: [{ kind: "preference", content: "Prefer reviewed TypeScript community signals." }],
  },
  deerflowInstanceId: "55000000-0000-4000-8000-000000000005",
  flowiseInstanceId: "60000000-0000-4000-8000-000000000006",
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
  flowiseIsolation: "instance-per-workspace" as const,
  idempotencyKey: "70000000-0000-4000-8000-000000000007",
};

const token = signAgentFrameworkRequestCapability(secret, request);
assert.match(token, /^[A-Za-z0-9_-]{43}$/);
assert.equal(verifyAgentFrameworkRequestCapability(secret, request, token), true);
assert.equal(
  verifyAgentFrameworkRequestCapability(secret, {
    ...request,
    reviewedQueries: [{ platform: "GitHub", query: "language:rust" }],
  }, token),
  false,
);
assert.equal(
  verifyAgentFrameworkRequestCapability(secret, {
    ...request,
    agentMemory: {
      ...request.agentMemory,
      items: [{ kind: "preference", content: "Injected replacement memory." }],
    },
  }, token),
  false,
);
assert.equal(
  verifyAgentFrameworkRequestCapability(secret, {
    ...request,
    need: { ...request.need, title: "Invented title" },
  }, token),
  false,
);
assert.equal(
  verifyAgentFrameworkRequestCapability(secret, {
    ...request,
    workflowSha256: "0".repeat(64),
  }, token),
  false,
);
assert.equal(
  verifyAgentFrameworkRequestCapability(secret, {
    ...request,
    workflow: {
      ...request.workflow,
      nodes: [{ id: "source", kind: "report" as const }],
    },
  }, token),
  false,
);

const claim = signAgentFrameworkClaimCapability(secret, {
  workspaceId: request.workspaceId,
  ownerId: request.ownerId,
  actorId: request.actorId,
  specId: request.specId,
  campaignId: request.campaignId,
  workflowVersionId: request.workflowVersionId,
  campaignFingerprint: request.campaignFingerprint,
  configurationSha256: request.configurationSha256,
  idempotencyKey: request.idempotencyKey,
  need: request.need,
  reviewedQueries: request.reviewedQueries,
});
assert.match(claim, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(claim, token);

assert.throws(() => signAgentFrameworkRequestCapability("short", request));
console.log("RESULT agent-framework-capability: 12 passed, 0 failed");
