import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const specId = "44444444-4444-4444-8444-444444444444";
const instanceId = "55555555-5555-4555-8555-555555555555";
const workflowVersionId = "66666666-6666-4666-8666-666666666666";
const workflowSha256 = "a".repeat(64);

let adminAllowed = true;
let currentWorkspace = workspaceId;
let specOwner = ownerId;
let importCalls = 0;
let serviceCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let afterImport: (() => void) | null = null;
let authoringReady = true;

const workflow = {
  version: 1 as const,
  name: "Reviewed sourcing",
  nodes: [{ id: "source", kind: "source_reviewed_campaign" as const }],
  edges: [],
};

function specQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return {
        data: specOwner ? { id: specId, owner_id: specOwner, status: "active" } : null,
        error: null,
      };
    },
  };
}

const session = {
  auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_workspace_id" ? currentWorkspace : null,
    error: null,
  }),
  from: (name: string) => {
    assert.equal(name, "agent_specs");
    return specQuery();
  },
};

const service = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    serviceCalls.push({ name, args });
    if (name === "import_agent_workflow_version") {
      return {
        data: {
          status: "imported",
          workflow_version_id: workflowVersionId,
          workflow_sha256: workflowSha256,
          workflow_status: "draft",
        },
        error: null,
      };
    }
    return {
      data: {
        status: args.p_decision === "approve" ? "approved" : "revoked",
        workflow_version_id: workflowVersionId,
        workflow_sha256: workflowSha256,
      },
      error: null,
    };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => adminAllowed
      ? { ok: true, role: "admin" }
      : { ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) },
  },
});
mock.module(moduleUrl("src/lib/agents/framework/runtime-config.ts"), {
  namedExports: {
    agentFrameworkRuntimeFromEnvironment: () => ({
      config: {
        deerflowUrl: "https://deerflow.service.internal",
        deerflowSourceCommit: "3c0a45ad772cdba388009b8d5ecad5e48cd22429",
        deerflowImageDigest: `registry.internal/deerflow@sha256:${"c".repeat(64)}`,
        flowiseUrl: authoringReady ? "https://flowise.service.internal" : "https://flowise.example.com",
        flowiseSourceCommit: "ed9e100fb71643cd3922b005908f9732bc0e07dc",
        flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
        flowiseIsolation: "instance-per-workspace",
        configurationSha256: "e".repeat(64),
        executionEnabled: false,
        killSwitch: true,
      },
      tokens: { deerflowToken: "private-deerflow-token", flowiseToken: "private-flowise-token" },
    }),
  },
});
mock.module(moduleUrl("src/lib/agents/framework/private-clients.ts"), {
  namedExports: {
    importFlowiseWorkflow: async (binding: Record<string, unknown>) => {
      importCalls += 1;
      assert.deepEqual(binding, {
        workspaceId,
        frameworkInstanceId: instanceId,
        externalWorkflowId: "flow_123",
        expectedName: "Reviewed sourcing",
      });
      afterImport?.();
      return workflow;
    },
  },
});

const route = await import("../src/app/api/admin/agent-frameworks/workflows/route");
const post = ((route as any).POST ?? (route as any).default?.POST) as (request: NextRequest) => Promise<Response>;
const patch = ((route as any).PATCH ?? (route as any).default?.PATCH) as (request: NextRequest) => Promise<Response>;

function request(method: "POST" | "PATCH", body: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/admin/agent-frameworks/workflows", {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      "x-request-id": crypto.randomUUID(),
      "x-real-ip": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function reset() {
  adminAllowed = true;
  currentWorkspace = workspaceId;
  specOwner = ownerId;
  importCalls = 0;
  serviceCalls = [];
  afterImport = null;
  authoringReady = true;
}

const importBody = {
  specId,
  frameworkInstanceId: instanceId,
  externalWorkflowId: "flow_123",
  expectedName: "Reviewed sourcing",
  version: 1,
};

test("cross-origin and non-admin imports fail before Flowise egress", async () => {
  reset();
  assert.equal((await post(request("POST", importBody, "https://attacker.test"))).status, 403);
  adminAllowed = false;
  assert.equal((await post(request("POST", importBody))).status, 403);
  assert.equal(importCalls, 0);
  assert.equal(serviceCalls.length, 0);
});

test("admin imports the exact private Flowise binding as a draft DB version", async () => {
  reset();
  const response = await post(request("POST", importBody));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    workflowVersionId,
    workflowSha256,
    status: "draft",
  });
  assert.equal(importCalls, 1);
  assert.deepEqual(serviceCalls, [{
    name: "import_agent_workflow_version",
    args: {
      p_workspace_id: workspaceId,
      p_owner_id: ownerId,
      p_actor_id: actorId,
      p_spec_id: specId,
      p_flowise_instance_id: instanceId,
      p_external_workflow_ref: "flow_123",
      p_version: 1,
      p_workflow_json: workflow,
    },
  }]);
});

test("authority is revalidated after Flowise egress and before the DB import", async () => {
  reset();
  afterImport = () => { currentWorkspace = "77777777-7777-4777-8777-777777777777"; };
  const response = await post(request("POST", importBody));
  assert.equal(response.status, 409);
  assert.equal(importCalls, 1);
  assert.equal(serviceCalls.length, 0);
});

test("unsafe framework authoring configuration fails before Flowise egress", async () => {
  reset();
  authoringReady = false;
  const response = await post(request("POST", importBody));
  assert.equal(response.status, 503);
  assert.equal(importCalls, 0);
});

test("an admin approves or revokes only the exact expected workflow hash", async () => {
  reset();
  const response = await patch(request("PATCH", {
    workflowVersionId,
    expectedSha256: workflowSha256,
    decision: "approve",
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "approved");
  assert.deepEqual(serviceCalls, [{
    name: "review_agent_workflow_version",
    args: {
      p_workspace_id: workspaceId,
      p_actor_id: actorId,
      p_workflow_version_id: workflowVersionId,
      p_expected_sha256: workflowSha256,
      p_decision: "approve",
    },
  }]);
});
