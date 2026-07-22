import assert from "node:assert/strict";
import {
  AgentFrameworkProposalSchema,
  AgentFrameworkRunRequestSchema,
  AgentFrameworkRunSuccessResponseSchema,
  AgentWorkflowV1Schema,
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  assessAgentFrameworkAuthoringRuntime,
  assessAgentFrameworkRuntime,
  proposalMatchesWorkflow,
} from "../src/lib/agents/framework/contracts";

let pass = 0;

function test(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const workflow = {
  version: 1,
  name: "Reviewed sourcing workflow",
  nodes: [
    { id: "plan", kind: "plan" },
    { id: "source", kind: "source_reviewed_campaign" },
    { id: "report", kind: "report" },
  ],
  edges: [
    { from: "plan", to: "source" },
    { from: "source", to: "report" },
  ],
};

test("pins the audited upstream framework commits", () => {
  assert.equal(DEERFLOW_SOURCE_COMMIT, "3c0a45ad772cdba388009b8d5ecad5e48cd22429");
  assert.equal(FLOWISE_SOURCE_COMMIT, "ed9e100fb71643cd3922b005908f9732bc0e07dc");
});

test("accepts only the bounded ARIA workflow vocabulary", () => {
  assert.equal(AgentWorkflowV1Schema.parse(workflow).version, 1);
  assert.equal(
    AgentWorkflowV1Schema.safeParse({
      ...workflow,
      nodes: [{ id: "shell", kind: "custom_javascript", command: "curl metadata" }],
    }).success,
    false,
  );
});

test("rejects disconnected, duplicate, and cyclic workflow authority", () => {
  assert.equal(
    AgentWorkflowV1Schema.safeParse({ ...workflow, nodes: [...workflow.nodes, workflow.nodes[0]] }).success,
    false,
  );
  assert.equal(
    AgentWorkflowV1Schema.safeParse({ ...workflow, edges: [...workflow.edges, { from: "report", to: "plan" }] }).success,
    false,
  );
  assert.equal(
    AgentWorkflowV1Schema.safeParse({ ...workflow, nodes: [...workflow.nodes, { id: "orphan", kind: "report" }] }).success,
    false,
  );
});

test("requires exactly one source and report authority", () => {
  const duplicateSource = {
    ...workflow,
    nodes: [
      ...workflow.nodes,
      { id: "source_again", kind: "source_reviewed_campaign" },
    ],
    edges: [
      ...workflow.edges.slice(0, -1),
      { from: "source", to: "source_again" },
      { from: "source_again", to: "report" },
    ],
  };
  const duplicateReport = {
    ...workflow,
    nodes: [...workflow.nodes, { id: "report_again", kind: "report" }],
    edges: [...workflow.edges, { from: "report", to: "report_again" }],
  };
  assert.equal(AgentWorkflowV1Schema.safeParse(duplicateSource).success, false);
  assert.equal(AgentWorkflowV1Schema.safeParse(duplicateReport).success, false);
  assert.equal(
    AgentWorkflowV1Schema.safeParse({
      ...workflow,
      nodes: workflow.nodes.filter((node) => node.kind !== "source_reviewed_campaign"),
      edges: [],
    }).success,
    false,
  );
  assert.equal(
    AgentWorkflowV1Schema.safeParse({
      ...workflow,
      nodes: workflow.nodes.filter((node) => node.kind !== "report"),
      edges: [{ from: "plan", to: "source" }],
    }).success,
    false,
  );
});

test("run input is server-owned authority, not raw candidates or credentials", () => {
  const input = {
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
    workflow,
    need: {
      title: "Staff Backend Engineer",
      seniority: "Staff",
      employmentType: "Full-time",
      locationType: "Hybrid",
      location: "Montreal",
      regions: ["Canada"],
      requiredSkills: ["TypeScript", "Postgres"],
      niceToHaveSkills: ["Kubernetes"],
      minYearsExperience: 7,
      maxYearsExperience: null,
      industryExperience: ["SaaS"],
    },
    reviewedQueries: [{ platform: "GitHub", query: "language:typescript location:montreal" }],
    agentMemory: {
      policy: "untrusted-reference-v1",
      receiptSha256: "f".repeat(64),
      items: [{ kind: "preference", content: "Prefer reviewed TypeScript community signals." }],
    },
    deerflowInstanceId: "50000000-0000-4000-8000-000000000005",
    flowiseInstanceId: "60000000-0000-4000-8000-000000000006",
    flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
    flowiseIsolation: "instance-per-workspace",
    idempotencyKey: "run:campaign-a:1",
    capabilityToken: "t".repeat(32),
  };
  assert.equal(AgentFrameworkRunRequestSchema.parse(input).campaignId, "campaign-a");
  assert.equal(
    AgentFrameworkRunRequestSchema.safeParse({ ...input, capabilityToken: "t".repeat(31) }).success,
    false,
  );
  assert.equal(
    AgentFrameworkRunRequestSchema.safeParse({ ...input, capabilityToken: "t".repeat(32) }).success,
    true,
  );
  assert.equal(AgentFrameworkRunRequestSchema.safeParse({ ...input, need: undefined }).success, false);
  assert.equal(AgentFrameworkRunRequestSchema.safeParse({ ...input, reviewedQueries: [] }).success, false);
  assert.equal(
    AgentFrameworkRunRequestSchema.safeParse({
      ...input,
      agentMemory: { ...input.agentMemory, items: Array.from({ length: 9 }, () => input.agentMemory.items[0]) },
    }).success,
    false,
  );
  assert.equal(
    AgentFrameworkRunRequestSchema.safeParse({
      ...input,
      agentMemory: {
        ...input.agentMemory,
        items: [{ kind: "fact", content: "x".repeat(8_193) }],
      },
    }).success,
    false,
  );
  assert.equal(
    AgentFrameworkRunRequestSchema.safeParse({ ...input, apiKey: "secret", candidates: [{ name: "Invented" }] }).success,
    false,
  );
});

test("agent run response shares one bounded client/server contract", () => {
  const response = {
    ok: true,
    runId: "10000000-0000-4000-8000-000000000001",
    reports: ["Exact reviewed query approved."],
    command: {
      kind: "source_reviewed_campaign",
      campaignId: "campaign-a",
      count: 5,
      query: "language:typescript location:montreal",
      capabilityToken: "s".repeat(43),
    },
    requestId: "req-1",
  };
  assert.equal(AgentFrameworkRunSuccessResponseSchema.safeParse(response).success, true);
  assert.equal(
    AgentFrameworkRunSuccessResponseSchema.safeParse({ ...response, reports: ["x".repeat(501)] }).success,
    false,
  );
});

test("framework output is a typed proposal with no direct-effect authority", () => {
  const proposal = AgentFrameworkProposalSchema.parse({
    runId: "10000000-0000-4000-8000-000000000001",
    status: "proposed",
    steps: workflow.nodes.map((node, ordinal) => ({
      ordinal,
      nodeId: node.id,
      nodeKind: node.kind,
      requestSha256: "c".repeat(64),
      responseSha256: "d".repeat(64),
    })),
    actions: [
      { kind: "source_query", platform: "GitHub", query: "language:typescript location:montreal" },
      { kind: "report", summary: "One reviewed query proposed." },
    ],
  });
  assert.equal(proposal.actions.length, 2);
  assert.equal(proposalMatchesWorkflow(proposal, AgentWorkflowV1Schema.parse(workflow)), true);
  assert.equal(
    proposalMatchesWorkflow(
      { ...proposal, steps: [...proposal.steps].reverse().map((step, ordinal) => ({ ...step, ordinal })) },
      AgentWorkflowV1Schema.parse(workflow),
    ),
    false,
  );
  assert.equal(
    AgentFrameworkProposalSchema.safeParse({
      runId: proposal.runId,
      status: "proposed",
      steps: proposal.steps,
      actions: [{ kind: "send_message", to: "+14165550199", body: "hello" }],
    }).success,
    false,
  );
});

test("production readiness requires exact commits, immutable digests, private URLs, and a kill switch", () => {
  const ready = assessAgentFrameworkRuntime({
    deerflowUrl: "https://deerflow.service.internal",
    deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
    deerflowImageDigest: `registry.internal/deerflow@sha256:${"c".repeat(64)}`,
    flowiseUrl: "https://flowise.service.internal",
    flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
    flowiseIsolation: "instance-per-workspace",
    configurationSha256: "e".repeat(64),
    executionEnabled: true,
    killSwitch: false,
  });
  assert.deepEqual(ready, { ready: true, reasons: [] });

  const unsafe = assessAgentFrameworkRuntime({
    deerflowUrl: "https://deerflow.example.com",
    deerflowSourceCommit: "main",
    deerflowImageDigest: "latest",
    flowiseUrl: "https://flowise.example.com",
    flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: "flowiseai/flowise:latest",
    flowiseIsolation: "shared-oss",
    executionEnabled: true,
    killSwitch: false,
  });
  assert.equal(unsafe.ready, false);
  assert.ok(unsafe.reasons.length >= 5);
});

test("authoring readiness keeps immutable private bindings but is independent of the execution kill switch", () => {
  const authoring = assessAgentFrameworkAuthoringRuntime({
    deerflowUrl: "https://deerflow.service.internal",
    deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
    deerflowImageDigest: `registry.internal/deerflow@sha256:${"c".repeat(64)}`,
    flowiseUrl: "https://flowise.service.internal",
    flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
    flowiseIsolation: "instance-per-workspace",
    configurationSha256: "e".repeat(64),
    executionEnabled: false,
    killSwitch: true,
  });
  assert.deepEqual(authoring, { ready: true, reasons: [] });

  const flyPrivateAuthoring = assessAgentFrameworkAuthoringRuntime({
    deerflowUrl: "http://aria-mantu-deerflow-adapter.internal:8080",
    deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
    deerflowImageDigest: `registry.internal/deerflow@sha256:${"c".repeat(64)}`,
    flowiseUrl: "http://aria-mantu-flowise-adapter.internal:8080",
    flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
    flowiseIsolation: "instance-per-workspace",
    configurationSha256: "e".repeat(64),
  });
  assert.deepEqual(flyPrivateAuthoring, { ready: true, reasons: [] });

  const unsafe = assessAgentFrameworkAuthoringRuntime({
    flowiseUrl: "https://flowise.example.com",
    flowiseSourceCommit: "main",
    flowiseImageDigest: "flowiseai/flowise:latest",
    flowiseIsolation: "shared-oss",
  });
  assert.equal(unsafe.ready, false);
  assert.ok(unsafe.reasons.includes("framework-configuration-sha256-required"));
  assert.ok(unsafe.reasons.includes("flowise-private-url-required"));
  assert.ok(unsafe.reasons.includes("flowise-source-commit-mismatch"));
  assert.ok(unsafe.reasons.includes("flowise-image-digest-required"));
  assert.ok(unsafe.reasons.includes("flowise-tenant-isolation-unproven"));
});

console.log(`RESULT agent-framework-contract: ${pass} passed, 0 failed`);
