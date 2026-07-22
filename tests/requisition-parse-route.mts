import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, mock } from "node:test";

import { NextRequest } from "next/server";

import { createProcessEnvScope } from "./helpers/process-env.mts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const JOB = {
  jobId: "70000000-0000-4000-8000-000000000001",
  leaseId: "80000000-0000-4000-8000-000000000001",
  workspaceId: "51111111-1111-4111-8111-111111111111",
  requisitionId: "61111111-1111-4111-8111-111111111111",
};
const PARSE_SECRET = "p".repeat(40);
const CRON_SECRET = "c".repeat(40);
const CLAIM_TOKEN = "90000000-0000-4000-8000-000000000001";
const EGRESS_ATTEMPT_ID = "a0000000-0000-4000-8000-000000000001";
const FENCE_VERSION = 1;
const SOURCE_CONTENT =
  "We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.";
const NEED_SHA256 = createHash("sha256").update(`text/plain\n${SOURCE_CONTENT}`, "utf8").digest("hex");
const MODEL_OUTPUT = JSON.stringify({
  title: "Senior Data Engineer",
  seniority: "Senior",
  employmentType: "Full-time",
  locationType: "Remote",
  requiredSkills: ["Python", "SQL"],
});
const API_KEY_ID = "b2000000-0000-4000-8000-000000000001";
const ACTIVE_BINDING_RPC = {
  status: "configured",
  workspace_id: JOB.workspaceId,
  binding_set_id: "b0000000-0000-4000-8000-000000000001",
  set_sha256: "a".repeat(64),
  binding_id: "b1000000-0000-4000-8000-000000000001",
  purpose: "requisition_parse",
  provider_slug: "anthropic",
  credential_provider: "Anthropic",
  endpoint_profile: "anthropic_messages_2023_06_01",
  model_name: "claude-sonnet-4-6",
  api_key_id: API_KEY_ID,
  catalog_revision: 1,
  config_sha256: "b".repeat(64),
};

interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

let rpcCalls: RpcCall[] = [];
let vaultCalls: Array<{
  apiKeyId: string;
  expectedProvider: string;
  workspaceId: string;
}> = [];
let providerCalls: Array<{ url: string; init?: RequestInit }> = [];
let serviceClientAvailable = true;
let authorizeStatus = "authorized";
let bindingRpcData: unknown = ACTIVE_BINDING_RPC;
let bindingRpcError: unknown = null;

const serviceClient = {
  async rpc(name: string, params: Record<string, unknown>) {
    rpcCalls.push({ name, params });
    if (name === "authorize_requisition_parse_job_v2") {
      if (authorizeStatus !== "authorized") {
        return { data: { status: authorizeStatus }, error: null };
      }
      return {
        data: {
          status: "authorized",
          workspace_id: JOB.workspaceId,
          requisition_id: JOB.requisitionId,
          content: SOURCE_CONTENT,
          content_type: "text/plain",
          need_sha256: NEED_SHA256,
          claim_token: CLAIM_TOKEN,
          fence_version: FENCE_VERSION,
        },
        error: null,
      };
    }
    if (name === "resolve_active_ai_runtime_binding") {
      return { data: bindingRpcData, error: bindingRpcError };
    }
    if (name === "begin_requisition_parse_egress") {
      return {
        data: { status: "egress_started", egress_attempt_id: EGRESS_ATTEMPT_ID, fence_version: FENCE_VERSION },
        error: null,
      };
    }
    if (name === "finalize_requisition_parse") {
      return { data: { status: "completed", ready: true }, error: null };
    }
    if (name === "fail_requisition_parse_egress") {
      return { data: { status: "marked_ambiguous" }, error: null };
    }
    if (name === "fail_aria_job") {
      return { data: params.p_retryable ? "queued" : "dead", error: null };
    }
    throw new Error(`unexpected rpc: ${name}`);
  },
};

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => (serviceClientAvailable ? serviceClient : null),
  },
});

mock.module(moduleUrl("src/lib/ai/vault-secret.ts"), {
  namedExports: {
    resolveVaultSecret: async (
      apiKeyId: string,
      expectedProvider: string,
      workspaceId: string,
    ) => {
      vaultCalls.push({ apiKeyId, expectedProvider, workspaceId });
      return "sk-test-secret";
    },
  },
});

const environment = createProcessEnvScope([
  "ARIA_REQUISITION_PARSE_SECRET",
  "CRON_SECRET",
]);
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
  providerCalls.push({ url: String(input), init });
  return new Response(JSON.stringify({ content: [{ text: MODEL_OUTPUT }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
  environment.restore();
});

const route = await import("../src/app/api/internal/requisition-parse/route");

function reset() {
  environment.set({
    ARIA_REQUISITION_PARSE_SECRET: PARSE_SECRET,
    CRON_SECRET,
  });
  rpcCalls = [];
  vaultCalls = [];
  providerCalls = [];
  serviceClientAvailable = true;
  authorizeStatus = "authorized";
  bindingRpcData = ACTIVE_BINDING_RPC;
  bindingRpcError = null;
}

function request(
  body: string = JSON.stringify(JOB),
  authorization: string | null = `Bearer ${PARSE_SECRET}`,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/internal/requisition-parse", {
    method: "POST",
    headers,
    body,
  });
}

test("the parse route requires its dedicated internal secret", async () => {
  reset();
  environment.set({ ARIA_REQUISITION_PARSE_SECRET: undefined });
  assert.equal((await route.POST(request(JSON.stringify(JOB), `Bearer ${CRON_SECRET}`))).status, 401);

  reset();
  environment.set({ ARIA_REQUISITION_PARSE_SECRET: "too-short" });
  assert.equal((await route.POST(request(JSON.stringify(JOB), "Bearer too-short"))).status, 401);

  reset();
  const whitespaceSecret = `${"x".repeat(31)} `;
  environment.set({ ARIA_REQUISITION_PARSE_SECRET: whitespaceSecret });
  assert.equal((await route.POST(request(JSON.stringify(JOB), `Bearer ${whitespaceSecret}`))).status, 401);

  reset();
  assert.equal((await route.POST(request(JSON.stringify(JOB), null))).status, 401);
  assert.equal((await route.POST(request(JSON.stringify(JOB), "Bearer wrong-secret"))).status, 401);

  assert.equal(rpcCalls.length, 0);
  assert.equal(vaultCalls.length, 0);
  assert.equal(providerCalls.length, 0);
});

test("malformed and oversized JSON are rejected before job processing", async () => {
  reset();
  const malformed = await route.POST(request('{"jobId":'));
  assert.equal(malformed.status, 400);
  assert.equal(rpcCalls.length, 0);

  const oversizedBody = JSON.stringify({ ...JOB, padding: "x".repeat(100_000) });
  const oversized = await route.POST(request(oversizedBody));
  assert.equal(oversized.status, 413);
  assert.equal(rpcCalls.length, 0);
  assert.equal(vaultCalls.length, 0);
  assert.equal(providerCalls.length, 0);
});

test("a valid request wires the exact tenant requisition-parse binding, vault credential, and provider", async () => {
  reset();
  const response = await route.POST(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    outcome: { outcome: "completed", ready: true },
  });
  assert.deepEqual(rpcCalls[0], {
    name: "authorize_requisition_parse_job_v2",
    params: {
      p_job_id: JOB.jobId,
      p_lease_id: JOB.leaseId,
      p_workspace_id: JOB.workspaceId,
      p_requisition_id: JOB.requisitionId,
    },
  });
  assert.deepEqual(rpcCalls.find((call) => call.name === "resolve_active_ai_runtime_binding"), {
    name: "resolve_active_ai_runtime_binding",
    params: {
      p_workspace_id: JOB.workspaceId,
      p_purpose: "requisition_parse",
    },
  });
  assert.deepEqual(vaultCalls, [
    {
      apiKeyId: API_KEY_ID,
      expectedProvider: "Anthropic",
      workspaceId: JOB.workspaceId,
    },
  ]);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, "https://api.anthropic.com/v1/messages");

  const finalized = rpcCalls.find((call) => call.name === "finalize_requisition_parse");
  assert.equal(finalized?.params.p_job_id, JOB.jobId);
  assert.equal(finalized?.params.p_lease_id, JOB.leaseId);
  assert.equal(finalized?.params.p_workspace_id, JOB.workspaceId);
  assert.equal(finalized?.params.p_requisition_id, JOB.requisitionId);
  assert.equal(finalized?.params.p_claim_token, CLAIM_TOKEN);
  assert.equal(finalized?.params.p_fence_version, FENCE_VERSION);
  assert.equal(finalized?.params.p_egress_attempt_id, EGRESS_ATTEMPT_ID);
  assert.equal(finalized?.params.p_input_sha256, NEED_SHA256);
  assert.equal(finalized?.params.p_provider, "anthropic");
  assert.equal(finalized?.params.p_model, "claude-sonnet-4-6");
});

test("not-configured and revoked bindings fail closed without vault or provider egress", async () => {
  for (const [status, reason] of [
    ["not_configured", "ai_binding_not_configured"],
    ["credential_unavailable", "ai_binding_credential_unavailable"],
  ] as const) {
    reset();
    bindingRpcData = { status };

    const response = await route.POST(request());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      outcome: { outcome: "dead_lettered", reason },
    });
    assert.equal(vaultCalls.length, 0);
    assert.equal(providerCalls.length, 0);
    assert.ok(!rpcCalls.some((call) => call.name === "begin_requisition_parse_egress"));
    assert.deepEqual(rpcCalls.at(-1), {
      name: "fail_aria_job",
      params: {
        p_job_id: JOB.jobId,
        p_lease_id: JOB.leaseId,
        p_error: reason,
        p_retryable: false,
      },
    });
  }
});

test("binding authority backend errors are retryable before vault or provider egress", async () => {
  reset();
  bindingRpcData = null;
  bindingRpcError = { message: "binding authority unavailable" };

  const response = await route.POST(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    outcome: { outcome: "retry_scheduled", reason: "ai_binding_backend_error" },
  });
  assert.equal(vaultCalls.length, 0);
  assert.equal(providerCalls.length, 0);
  assert.ok(!rpcCalls.some((call) => call.name === "begin_requisition_parse_egress"));
});

test("a configured binding for another tenant is rejected as a backend authority failure", async () => {
  reset();
  bindingRpcData = {
    ...ACTIVE_BINDING_RPC,
    workspace_id: "51111111-1111-4111-8111-111111111112",
  };

  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    outcome: { outcome: "retry_scheduled", reason: "ai_binding_backend_error" },
  });
  assert.equal(vaultCalls.length, 0);
  assert.equal(providerCalls.length, 0);
});

test("route maps dependency outage, stale ownership, and receipt replay truthfully", async () => {
  reset();
  serviceClientAvailable = false;
  const unavailable = await route.POST(request());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ok: true,
    outcome: { outcome: "unavailable", reason: "service_client_unavailable" },
  });

  reset();
  authorizeStatus = "lease_mismatch";
  const stale = await route.POST(request());
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { ok: true, outcome: { outcome: "stale_lease" } });
  assert.equal(providerCalls.length, 0);

  reset();
  authorizeStatus = "no_op_replay";
  const replay = await route.POST(request());
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ok: true, outcome: { outcome: "no_op_replay" } });
  assert.ok(!rpcCalls.some((call) => call.name === "resolve_active_ai_runtime_binding"));
  assert.equal(vaultCalls.length, 0);
  assert.equal(providerCalls.length, 0);
});
