import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

import { describeStoredAgentRuntimeAvailability } from "../src/lib/agents/runtime-policy";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const specId = "33333333-3333-4333-8333-333333333333";
const otherSpecId = "44444444-4444-4444-8444-444444444444";
const workflowVersionId = "55555555-5555-4555-8555-555555555555";
const workflowSha256 = "a".repeat(64);

const specRows = [
  {
    id: specId,
    name: "Backend sourcing",
    role_brief: { title: "Staff Backend Engineer" },
    channels: ["Email"],
    guardrails: { autopilot: false, canary_remaining: 5, topics_allow: [] },
    owner_id: ownerId,
    seat_id: null,
    status: "active",
    created_at: "2026-07-14T00:00:00.000Z",
  },
  {
    id: otherSpecId,
    name: "No approved workflow",
    role_brief: { title: "Platform Engineer" },
    channels: ["Email"],
    guardrails: { autopilot: false, canary_remaining: 5, topics_allow: [] },
    owner_id: ownerId,
    seat_id: null,
    status: "active",
    created_at: "2026-07-13T00:00:00.000Z",
  },
];

let serviceAvailable = true;
let serviceError: { message: string } | null = null;
let executionEnabled = true;
let killSwitch = false;
let workflowPayload: unknown = {
  status: "ok",
  workflows: [{
    spec_id: specId,
    workflow_version_id: workflowVersionId,
    version: 1,
    external_workflow_ref: "reviewed_backend_v1",
    workflow_sha256: workflowSha256,
    workflow_name: "Reviewed backend sourcing",
  }],
};
let serviceCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

const session = {
  auth: {
    getUser: async () => ({ data: { user: { id: ownerId } }, error: null }),
  },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? "member" : workspaceId,
    error: null,
  }),
  from: (table: string) => {
    assert.equal(table, "agent_specs");
    const query = {
      select() { return query; },
      neq() { return query; },
      async order() { return { data: specRows, error: null }; },
    };
    return query;
  },
};

const service = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    serviceCalls.push({ name, args });
    return { data: workflowPayload, error: serviceError };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => serviceAvailable ? service : null,
  },
});
mock.module(moduleUrl("src/lib/agents/framework/runtime-config.ts"), {
  namedExports: {
    agentFrameworkRuntimeFromEnvironment: () => ({
      config: {
        deerflowUrl: "https://deerflow.service.internal",
        deerflowSourceCommit: "3c0a45ad772cdba388009b8d5ecad5e48cd22429",
        deerflowImageDigest: `registry.internal/deerflow@sha256:${"b".repeat(64)}`,
        flowiseUrl: "https://flowise.service.internal",
        flowiseSourceCommit: "ed9e100fb71643cd3922b005908f9732bc0e07dc",
        flowiseImageDigest: `registry.internal/flowise@sha256:${"c".repeat(64)}`,
        flowiseIsolation: "instance-per-workspace",
        configurationSha256: "d".repeat(64),
        executionEnabled,
        killSwitch,
      },
      tokens: { deerflowToken: "deerflow-private-token", flowiseToken: "flowise-private-token" },
    }),
  },
});

const route = await import("../src/app/api/agents/specs/route");

function reset() {
  serviceAvailable = true;
  serviceError = null;
  executionEnabled = true;
  killSwitch = false;
  workflowPayload = {
    status: "ok",
    workflows: [{
      spec_id: specId,
      workflow_version_id: workflowVersionId,
      version: 1,
      external_workflow_ref: "reviewed_backend_v1",
      workflow_sha256: workflowSha256,
      workflow_name: "Reviewed backend sourcing",
    }],
  };
  serviceCalls = [];
}

function request() {
  return new NextRequest("http://localhost/api/agents/specs", { method: "GET" });
}

async function getResponse() {
  const response = await route.GET(request());
  assert.ok(response, "GET must return a response");
  return response;
}

test("runtime policy admits only an exact approved workflow binding on a ready framework", () => {
  const common = [
    { title: "Staff Backend Engineer" },
    ["Email"],
    { autopilot: false, canary_remaining: 5, topics_allow: [] },
    "active",
    ownerId,
    ownerId,
  ] as const;
  const approved = {
    workflowVersionId,
    workflowName: "Reviewed backend sourcing",
    workflowSha256,
  };

  assert.equal(describeStoredAgentRuntimeAvailability(...common, {
    authorityAvailable: true,
    runtimeReady: true,
    approvedWorkflow: approved,
  }).runtime_eligible, true);
  assert.match(describeStoredAgentRuntimeAvailability(...common, {
    authorityAvailable: true,
    runtimeReady: true,
    approvedWorkflow: { ...approved, workflowSha256: "not-a-sha" },
  }).runtime_reason ?? "", /approved workflow/i);
  assert.match(describeStoredAgentRuntimeAvailability(...common, {
    authorityAvailable: true,
    runtimeReady: false,
    approvedWorkflow: approved,
  }).runtime_reason ?? "", /runtime/i);
});

test("GET lists strict approved workflow bindings through service-only authority", async () => {
  reset();
  const response = await getResponse();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(serviceCalls, [{
    name: "list_agent_framework_workflows",
    args: {
      p_workspace_id: workspaceId,
      p_owner_id: ownerId,
      p_actor_id: ownerId,
    },
  }]);
  assert.deepEqual(body.specs[0], {
    id: specId,
    name: "Backend sourcing",
    role_brief: { title: "Staff Backend Engineer" },
    channels: ["Email"],
    guardrails: { autopilot: false, canary_remaining: 5, topics_allow: [] },
    seat_id: null,
    status: "active",
    created_at: "2026-07-14T00:00:00.000Z",
    workflowVersionId,
    workflowName: "Reviewed backend sourcing",
    workflowSha256,
    runtime_eligible: true,
    runtime_reason: null,
  });
  assert.equal(body.specs[1].workflowVersionId, null);
  assert.equal(body.specs[1].workflowName, null);
  assert.equal(body.specs[1].workflowSha256, null);
  assert.equal(body.specs[1].runtime_eligible, false);
  assert.match(body.specs[1].runtime_reason, /approved workflow/i);
});

test("GET fails closed per spec when service workflow authority is unavailable", async () => {
  reset();
  serviceAvailable = false;
  const response = await getResponse();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(serviceCalls.length, 0);
  assert.equal(body.specs.length, 2);
  for (const spec of body.specs) {
    assert.equal(spec.runtime_eligible, false);
    assert.match(spec.runtime_reason, /authority.*unavailable/i);
    assert.equal(spec.workflowVersionId, null);
  }
});

test("GET fails closed per spec when the service workflow RPC errors", async () => {
  reset();
  serviceError = { message: "database unavailable" };
  const response = await getResponse();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(serviceCalls.length, 1);
  for (const spec of body.specs) {
    assert.equal(spec.runtime_eligible, false);
    assert.match(spec.runtime_reason, /authority.*unavailable/i);
    assert.equal(spec.workflowVersionId, null);
  }
});

test("GET rejects malformed or unexpected workflow authority payloads", async () => {
  reset();
  workflowPayload = {
    status: "ok",
    workflows: [{
      spec_id: specId,
      workflow_version_id: workflowVersionId,
      version: 1,
      external_workflow_ref: "reviewed_backend_v1",
      workflow_sha256: "invalid",
      workflow_name: "Reviewed backend sourcing",
      unreviewed_field: true,
    }],
  };
  const response = await getResponse();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.specs[0].runtime_eligible, false);
  assert.match(body.specs[0].runtime_reason, /authority.*unavailable/i);
  assert.equal(body.specs[0].workflowVersionId, null);
});

test("GET exposes the approved binding but blocks execution when framework runtime is stopped", async () => {
  reset();
  killSwitch = true;
  const response = await getResponse();
  const body = await response.json();

  assert.equal(body.specs[0].workflowVersionId, workflowVersionId);
  assert.equal(body.specs[0].runtime_eligible, false);
  assert.match(body.specs[0].runtime_reason, /runtime.*unavailable/i);
});
