import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  handleRequisitionParseJob,
  type RequisitionParseDependencies,
  type RequisitionParseRpcClient,
} from "../src/lib/needs/requisition-parse";
import type { ActiveAiRuntimeBindingResult } from "../src/lib/ai/runtime-binding";

const JOB = {
  jobId: "70000000-0000-4000-8000-000000000001",
  leaseId: "80000000-0000-4000-8000-000000000001",
  workspaceId: "51111111-1111-4111-8111-111111111111",
  requisitionId: "61111111-1111-4111-8111-111111111111",
};

const CLAIM_TOKEN = "90000000-0000-4000-8000-000000000001";
const EGRESS_ATTEMPT_ID = "a0000000-0000-4000-8000-000000000001";
const FENCE_VERSION = 1;

const READY_MODEL_JSON = JSON.stringify({
  title: "Senior Data Engineer",
  seniority: "Senior",
  employmentType: "Full-time",
  locationType: "Remote",
  requiredSkills: ["Python", "SQL"],
});

const SOURCE_CONTENT =
  "We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.";
const NEED_SHA256 = createHash("sha256").update(`text/plain\n${SOURCE_CONTENT}`, "utf8").digest("hex");

const ACTIVE_BINDING: ActiveAiRuntimeBindingResult = {
  ok: true,
  binding: {
    workspaceId: JOB.workspaceId,
    bindingSetId: "b0000000-0000-4000-8000-000000000001",
    setSha256: "a".repeat(64),
    bindingId: "b1000000-0000-4000-8000-000000000001",
    purpose: "requisition_parse",
    provider: "anthropic",
    credentialProvider: "Anthropic",
    endpointProfile: "anthropic_messages_2023_06_01",
    model: "claude-sonnet-4-6",
    apiKeyId: "b2000000-0000-4000-8000-000000000001",
    catalogRevision: 1,
    configSha256: "b".repeat(64),
  },
};

function anthropicResponse(text: string): Response {
  return new Response(JSON.stringify({ content: [{ text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

interface RpcEnvelope {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "data") && Object.hasOwn(value, "error");
}

function makeClient(overrides: Partial<Record<string, (params: Record<string, unknown>) => unknown>> = {}) {
  const calls: RpcCall[] = [];
  const defaults: Record<string, (params: Record<string, unknown>) => unknown> = {
    authorize_requisition_parse_job_v2: () => ({
      status: "authorized",
      requisition_id: JOB.requisitionId,
      workspace_id: JOB.workspaceId,
      content: SOURCE_CONTENT,
      content_type: "text/plain",
      need_sha256: NEED_SHA256,
      claim_token: CLAIM_TOKEN,
      fence_version: FENCE_VERSION,
    }),
    begin_requisition_parse_egress: () => ({
      status: "egress_started",
      egress_attempt_id: EGRESS_ATTEMPT_ID,
      fence_version: FENCE_VERSION,
    }),
    finalize_requisition_parse: () => ({ status: "completed", ready: true }),
    // Mirrors 0038's fail_aria_job: retryable -> queued, non-retryable -> dead.
    fail_aria_job: (params) => (params.p_retryable ? "queued" : "dead"),
    fail_requisition_parse_egress: () => ({ status: "marked_ambiguous" }),
  };
  const behavior = { ...defaults, ...overrides };
  const client: RequisitionParseRpcClient = {
    async rpc(name, params) {
      calls.push({ name, params });
      const fn = behavior[name];
      if (!fn) throw new Error(`unexpected rpc: ${name}`);
      const result = await fn(params);
      return isRpcEnvelope(result) ? result : { data: result, error: null };
    },
  };
  return { client, calls };
}

function baseDeps(overrides: Partial<RequisitionParseDependencies> = {}, client?: RequisitionParseRpcClient): RequisitionParseDependencies {
  const { client: defaultClient } = makeClient();
  return {
    getServiceClient: () => client ?? defaultClient,
    resolveAiBinding: async () => ACTIVE_BINDING,
    resolveApiKeySecret: async () => "sk-test-secret",
    fetcher: (async () => anthropicResponse(READY_MODEL_JSON)) as unknown as typeof fetch,
    ...overrides,
  };
}

test("authorized job with no matching input is dead-lettered without provider egress", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "input_not_found" }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
      client,
    ),
  );
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "requisition_not_found_for_workspace" });
  const failCall = calls.find((c) => c.name === "fail_aria_job");
  assert.equal(failCall?.params.p_retryable, false);
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
});

test("pre-egress authority denies wrong job kind without mutating the unrelated job", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "wrong_kind" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("pre-egress authority denies cross-workspace job without mutating it", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "wrong_workspace" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("pre-egress authority denies expired lease without attempting a stale mutation", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "lease_expired" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("pre-egress authority denies payload requisition_id mismatch without mutating the job", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "payload_mismatch" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("authorize transport failure is fail-closed with no provider call or job mutation", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
      client,
    ),
  );
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
  assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
});

test("pre-egress authority never trusts a caller-supplied input hash", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({
      status: "authorized",
      requisition_id: JOB.requisitionId,
      workspace_id: JOB.workspaceId,
      content: SOURCE_CONTENT,
      content_type: "text/plain",
      need_sha256: NEED_SHA256,
      claim_token: CLAIM_TOKEN,
      fence_version: FENCE_VERSION,
    }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "completed", ready: true });
  assert.equal(fetchCalled, true);
  const authCall = calls.find((c) => c.name === "authorize_requisition_parse_job_v2");
  assert.equal(Object.hasOwn(authCall?.params ?? {}, "p_input_sha256"), false);
});

test("authorization content must hash to the database-bound input before binding resolution or provider egress", async () => {
  let bindingCalled = false;
  let vaultCalled = false;
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({
      status: "authorized",
      requisition_id: JOB.requisitionId,
      workspace_id: JOB.workspaceId,
      content: `${SOURCE_CONTENT} tampered`,
      content_type: "text/plain",
      need_sha256: NEED_SHA256,
      claim_token: CLAIM_TOKEN,
      fence_version: FENCE_VERSION,
    }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      {
        resolveAiBinding: async () => { bindingCalled = true; return ACTIVE_BINDING; },
        resolveApiKeySecret: async () => { vaultCalled = true; return "sk-test-secret"; },
        fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
      },
      client,
    ),
  );
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "requisition_content_hash_mismatch" });
  assert.equal(bindingCalled, false);
  assert.equal(vaultCalled, false);
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
});

test("pre-egress authority denies disabled intake: no fetch, retryable", async () => {
  let fetchCalled = false;
  const { client } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "intake_disabled" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "retry_scheduled", reason: "unauthorized_intake_disabled" });
  assert.equal(fetchCalled, false);
});

test("authorize call carries the exact lease/workspace/requisition/input-hash facts", async () => {
  const { client, calls } = makeClient();
  await handleRequisitionParseJob(JOB, baseDeps({}, client));
  const authCall = calls.find((c) => c.name === "authorize_requisition_parse_job_v2");
  assert.deepEqual(authCall?.params, {
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_requisition_id: JOB.requisitionId,
  });
});

test("fail_aria_job result checking: a lost lease (not_found) never reports retry/dead success", async () => {
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "intake_disabled" }),
    fail_aria_job: () => "not_found",
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.ok(calls.some((c) => c.name === "fail_aria_job"));
});

test("fail_aria_job invalid_request response also reports stale_lease, not a lie", async () => {
  const { client } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "intake_disabled" }),
    fail_aria_job: () => "invalid_request",
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "stale_lease" });
});

test("no active requisition-parse binding: dead-lettered with no synthetic fallback or model call", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient();
  const deps = baseDeps(
    {
      resolveAiBinding: async () => ({ ok: false, code: "not_configured" }),
      fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
    },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "ai_binding_not_configured" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
});

test("revoked credentials and invalid binding authority fail closed before vault, begin, or provider egress", async () => {
  for (const [code, reason] of [
    ["credential_unavailable", "ai_binding_credential_unavailable"],
    ["authority_invalid", "ai_binding_authority_invalid"],
  ] as const) {
    let vaultCalled = false;
    let fetchCalled = false;
    const { client, calls } = makeClient();
    const outcome = await handleRequisitionParseJob(
      JOB,
      baseDeps(
        {
          resolveAiBinding: async () => ({ ok: false, code }),
          resolveApiKeySecret: async () => { vaultCalled = true; return "sk-test-secret"; },
          fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
        },
        client,
      ),
    );

    assert.deepEqual(outcome, { outcome: "dead_lettered", reason });
    assert.equal(vaultCalled, false);
    assert.equal(fetchCalled, false);
    assert.ok(!calls.some((call) => call.name === "begin_requisition_parse_egress"));
  }
});

test("the exact tenant requisition-parse binding controls provider, model, key id, and vault provider", async () => {
  const { client, calls } = makeClient();
  const bindingCalls: Array<{
    client: RequisitionParseRpcClient;
    workspaceId: string;
    purpose: string;
  }> = [];
  const vaultCalls: Array<{
    workspaceId: string;
    apiKeyId: string;
    expectedProvider: string;
  }> = [];

  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      {
        resolveAiBinding: async (bindingClient, workspaceId, purpose) => {
          bindingCalls.push({ client: bindingClient, workspaceId, purpose });
          return ACTIVE_BINDING;
        },
        resolveApiKeySecret: async (workspaceId, apiKeyId, expectedProvider) => {
          vaultCalls.push({ workspaceId, apiKeyId, expectedProvider });
          return "sk-test-secret";
        },
      },
      client,
    ),
  );

  assert.deepEqual(outcome, { outcome: "completed", ready: true });
  assert.deepEqual(bindingCalls, [
    { client, workspaceId: JOB.workspaceId, purpose: "requisition_parse" },
    { client, workspaceId: JOB.workspaceId, purpose: "requisition_parse" },
  ]);
  assert.deepEqual(vaultCalls, [{
    workspaceId: JOB.workspaceId,
    apiKeyId: ACTIVE_BINDING.binding.apiKeyId,
    expectedProvider: ACTIVE_BINDING.binding.credentialProvider,
  }]);
  const begin = calls.find((call) => call.name === "begin_requisition_parse_egress");
  assert.equal(begin?.params.p_provider, ACTIVE_BINDING.binding.provider);
  assert.equal(begin?.params.p_model, ACTIVE_BINDING.binding.model);
});

test("an AI binding change after the egress claim is recorded stops before the provider call", async () => {
  let bindingCalls = 0;
  let fetchCalled = false;
  const changedBinding: ActiveAiRuntimeBindingResult = {
    ok: true,
    binding: {
      ...ACTIVE_BINDING.binding,
      bindingSetId: "c0000000-0000-4000-8000-000000000001",
      bindingId: "c1000000-0000-4000-8000-000000000001",
      apiKeyId: "c2000000-0000-4000-8000-000000000001",
      setSha256: "c".repeat(64),
      configSha256: "d".repeat(64),
    },
  };
  const { client, calls } = makeClient();

  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      {
        resolveAiBinding: async () => {
          bindingCalls += 1;
          return bindingCalls === 1 ? ACTIVE_BINDING : changedBinding;
        },
        fetcher: (async () => {
          fetchCalled = true;
          return anthropicResponse(READY_MODEL_JSON);
        }) as unknown as typeof fetch,
      },
      client,
    ),
  );

  assert.deepEqual(outcome, {
    outcome: "dead_lettered",
    reason: "ai_binding_changed_before_egress",
  });
  assert.equal(bindingCalls, 2);
  assert.equal(fetchCalled, false);
  assert.ok(calls.some((call) => call.name === "begin_requisition_parse_egress"));
  assert.ok(calls.some((call) => call.name === "fail_requisition_parse_egress"));
  assert.ok(!calls.some((call) => call.name === "finalize_requisition_parse"));
});

test("malformed provider output: unparseable model reply is dead-lettered, never fabricated", async () => {
  const { client, calls } = makeClient();
  const deps = baseDeps(
    { fetcher: (async () => anthropicResponse("not json at all")) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "model_output_unparseable" });
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
});

test("wrong-typed provider text is handled as unparseable and never escapes the job handler", async () => {
  const { client, calls } = makeClient();
  const deps = baseDeps(
    {
      fetcher: (async () => new Response(
        JSON.stringify({ content: [{ text: 123 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch,
    },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "model_output_unparseable" });
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
});

test("provider credential requests reject redirects", async () => {
  const { client } = makeClient();
  let redirect: RequestRedirect | undefined;
  const deps = baseDeps(
    {
      fetcher: (async (_url, init) => {
        redirect = init?.redirect;
        return anthropicResponse(READY_MODEL_JSON);
      }) as typeof fetch,
    },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "completed", ready: true });
  assert.equal(redirect, "error");
});

test("post-egress model HTTP error is dead-lettered, never retried: a retry would call the provider twice", async () => {
  const { client, calls } = makeClient();
  const deps = baseDeps(
    { fetcher: (async () => new Response("", { status: 503 })) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "model_http_503" });
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
  const failCall = calls.find((c) => c.name === "fail_requisition_parse_egress");
  assert.equal(failCall?.params.p_claim_token, CLAIM_TOKEN);
  assert.equal(failCall?.params.p_fence_version, FENCE_VERSION);
  assert.equal(failCall?.params.p_egress_attempt_id, EGRESS_ATTEMPT_ID);
  assert.equal(failCall?.params.p_reason, "model_http_503");
});

test("post-egress network failure calling the provider is dead-lettered, never retried", async () => {
  const { client, calls } = makeClient();
  const deps = baseDeps(
    { fetcher: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "model_call_failed" });
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
  const failCall = calls.find((c) => c.name === "fail_requisition_parse_egress");
  assert.ok(failCall);
});

test("post-egress failure authority transport error never fabricates a confirmed dead-letter", async () => {
  const { client, calls } = makeClient({
    fail_requisition_parse_egress: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => new Response("", { status: 503 })) as unknown as typeof fetch },
      client,
    ),
  );
  assert.deepEqual(outcome, {
    outcome: "unavailable",
    reason: "egress_state_unconfirmed:model_http_503",
  });
  assert.ok(calls.some((c) => c.name === "fail_requisition_parse_egress"));
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("post-egress failure authority lease loss reports stale ownership, not a fabricated dead-letter", async () => {
  const { client } = makeClient({
    finalize_requisition_parse: () => ({ data: null, error: { code: "rpc_unavailable" } }),
    fail_requisition_parse_egress: () => ({ status: "lease_mismatch" }),
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "stale_lease" });
});

test("pre-egress binding backend failures remain safely retryable and never reach begin or fetch", async () => {
  const { client, calls } = makeClient();
  const deps = baseDeps({ resolveAiBinding: async () => ({ ok: false, code: "backend_error" }) }, client);
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "retry_scheduled", reason: "ai_binding_backend_error" });
  assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
  const failCall = calls.find((c) => c.name === "fail_aria_job");
  assert.equal(failCall?.params.p_retryable, true);
});

test("crash-recovered succeeded replay short-circuits at authorize: zero binding, vault, fetch, or finalize calls", async () => {
  let fetchCalled = false;
  const bindingCalls: string[] = [];
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "no_op_replay", ready: true }),
  });
  const deps = baseDeps(
    {
      resolveAiBinding: async (_client, workspaceId: string) => {
        bindingCalls.push(workspaceId);
        return ACTIVE_BINDING;
      },
      resolveApiKeySecret: async () => {
        throw new Error("vault must never be called for a no_op_replay");
      },
      fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
    },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "no_op_replay" });
  assert.equal(fetchCalled, false);
  assert.equal(bindingCalls.length, 0);
  assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
  assert.ok(!calls.some((c) => c.name === "finalize_requisition_parse"));
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("a stale claim quarantined by the database is reported dead without a second mutation or provider call", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "quarantined_ambiguous" }),
  });
  const deps = baseDeps(
    { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
    client,
  );
  const outcome = await handleRequisitionParseJob(JOB, deps);
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "prior_egress_ambiguous" });
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
});

test("a differently keyed duplicate job for the same input is dead-lettered before provider egress", async () => {
  let fetchCalled = false;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => ({ status: "duplicate_input_claim" }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
      client,
    ),
  );
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "duplicate_input_claim" });
  assert.equal(fetchCalled, false);
  const failCall = calls.find((c) => c.name === "fail_aria_job");
  assert.equal(failCall?.params.p_retryable, false);
  assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
});

test("begin_requisition_parse_egress is called immediately before fetch, after binding and vault resolution", async () => {
  const events: string[] = [];
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => {
      events.push("authorize");
      return {
        status: "authorized",
        requisition_id: JOB.requisitionId,
        workspace_id: JOB.workspaceId,
        content: SOURCE_CONTENT,
        content_type: "text/plain",
        need_sha256: NEED_SHA256,
        claim_token: CLAIM_TOKEN,
        fence_version: FENCE_VERSION,
      };
    },
    begin_requisition_parse_egress: async () => {
      events.push("begin");
      return {
        status: "egress_started",
        egress_attempt_id: EGRESS_ATTEMPT_ID,
        fence_version: FENCE_VERSION,
      };
    },
    finalize_requisition_parse: () => {
      events.push("finalize");
      return { status: "completed", ready: true };
    },
  });
  await handleRequisitionParseJob(
    JOB,
    baseDeps(
      {
        resolveAiBinding: async () => {
          events.push("binding");
          return ACTIVE_BINDING;
        },
        resolveApiKeySecret: async () => {
          events.push("vault");
          return "sk-test-secret";
        },
        fetcher: (async () => {
          events.push("fetch");
          return anthropicResponse(READY_MODEL_JSON);
        }) as unknown as typeof fetch,
      },
      client,
    ),
  );
  assert.deepEqual(events, ["authorize", "binding", "vault", "begin", "binding", "fetch", "finalize"]);
  const beginIndex = calls.findIndex((c) => c.name === "begin_requisition_parse_egress");
  const finalizeIndex = calls.findIndex((c) => c.name === "finalize_requisition_parse");
  assert.ok(beginIndex >= 0);
  assert.ok(beginIndex < finalizeIndex);
  const beginCall = calls[beginIndex];
  assert.deepEqual(beginCall.params, {
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_requisition_id: JOB.requisitionId,
    p_claim_token: CLAIM_TOKEN,
    p_fence_version: FENCE_VERSION,
    p_input_sha256: NEED_SHA256,
    p_provider: "anthropic",
    p_model: "claude-sonnet-4-6",
  });
});

test("a deferred stale worker denied at begin (lease already transferred) never reaches fetch; the current owner's single fetch still succeeds", async () => {
  let fetchCount = 0;
  const { client: staleClient } = makeClient({
    begin_requisition_parse_egress: () => ({ status: "lease_mismatch" }),
  });
  const staleOutcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => { fetchCount += 1; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
      staleClient,
    ),
  );
  assert.deepEqual(staleOutcome, { outcome: "stale_lease" });
  assert.equal(fetchCount, 0);

  const { client: currentClient } = makeClient();
  const currentOutcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      { fetcher: (async () => { fetchCount += 1; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
      currentClient,
    ),
  );
  assert.deepEqual(currentOutcome, { outcome: "completed", ready: true });
  assert.equal(fetchCount, 1);
});

test("begin transport failure occurs after binding resolution but remains fail-closed before provider egress", async () => {
  let fetchCalled = false;
  let bindingCalled = false;
  let vaultCalled = false;
  const { client, calls } = makeClient({
    begin_requisition_parse_egress: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps(
      {
        resolveAiBinding: async () => { bindingCalled = true; return ACTIVE_BINDING; },
        resolveApiKeySecret: async () => { vaultCalled = true; return "sk-test-secret"; },
        fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
      },
      client,
    ),
  );
  assert.deepEqual(outcome, { outcome: "stale_lease" });
  assert.equal(bindingCalled, true);
  assert.equal(vaultCalled, true);
  assert.equal(fetchCalled, false);
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
  assert.ok(!calls.some((c) => c.name === "fail_requisition_parse_egress"));
});

test("malformed egress-start evidence never reaches fetch and never guesses a failure capability", async () => {
  for (const malformed of [
    { status: "egress_started", fence_version: FENCE_VERSION },
    { status: "egress_started", egress_attempt_id: EGRESS_ATTEMPT_ID },
    { status: "egress_started", egress_attempt_id: "not-a-uuid", fence_version: FENCE_VERSION },
    { status: "egress_started", egress_attempt_id: EGRESS_ATTEMPT_ID, fence_version: 1.5 },
    { status: "egress_started", egress_attempt_id: EGRESS_ATTEMPT_ID, fence_version: FENCE_VERSION + 1 },
  ]) {
    let fetchCalled = false;
    const { client, calls } = makeClient({
      begin_requisition_parse_egress: () => malformed,
    });
    const outcome = await handleRequisitionParseJob(
      JOB,
      baseDeps(
        { fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch },
        client,
      ),
    );
    assert.deepEqual(outcome, { outcome: "stale_lease" });
    assert.equal(fetchCalled, false);
    assert.ok(!calls.some((c) => c.name === "fail_requisition_parse_egress"));
  }
});

test("malformed authorization capabilities are rejected before binding, vault, begin, or fetch", async () => {
  for (const capability of [
    { claim_token: "not-a-uuid", fence_version: FENCE_VERSION },
    { claim_token: CLAIM_TOKEN, fence_version: 0 },
    { claim_token: CLAIM_TOKEN, fence_version: 1.5 },
  ]) {
    let bindingCalled = false;
    let fetchCalled = false;
    const { client, calls } = makeClient({
      authorize_requisition_parse_job_v2: () => ({
        status: "authorized",
        requisition_id: JOB.requisitionId,
        workspace_id: JOB.workspaceId,
        content: SOURCE_CONTENT,
        content_type: "text/plain",
        need_sha256: NEED_SHA256,
        ...capability,
      }),
    });
    const outcome = await handleRequisitionParseJob(
      JOB,
      baseDeps(
        {
          resolveAiBinding: async () => { bindingCalled = true; return ACTIVE_BINDING; },
          fetcher: (async () => { fetchCalled = true; return anthropicResponse(READY_MODEL_JSON); }) as unknown as typeof fetch,
        },
        client,
      ),
    );
    assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "requisition_context_invalid" });
    assert.equal(bindingCalled, false);
    assert.equal(fetchCalled, false);
    assert.ok(!calls.some((c) => c.name === "begin_requisition_parse_egress"));
  }
});

test("ready brief: one atomic finalize call carries the parsed analysis, provider, model, and input hash", async () => {
  const { client, calls } = makeClient();
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "completed", ready: true });
  const finalizeCall = calls.find((c) => c.name === "finalize_requisition_parse");
  assert.equal(finalizeCall?.params.p_job_id, JOB.jobId);
  assert.equal(finalizeCall?.params.p_lease_id, JOB.leaseId);
  assert.equal(finalizeCall?.params.p_workspace_id, JOB.workspaceId);
  assert.equal(finalizeCall?.params.p_requisition_id, JOB.requisitionId);
  assert.equal(finalizeCall?.params.p_claim_token, CLAIM_TOKEN);
  assert.equal(finalizeCall?.params.p_fence_version, FENCE_VERSION);
  assert.equal(finalizeCall?.params.p_egress_attempt_id, EGRESS_ATTEMPT_ID);
  assert.equal(finalizeCall?.params.p_input_sha256, NEED_SHA256);
  assert.equal(finalizeCall?.params.p_provider, "anthropic");
  assert.ok(typeof finalizeCall?.params.p_model === "string" && (finalizeCall.params.p_model as string).length > 0);
  const analysis = finalizeCall?.params.p_job_analysis as {
    title?: string;
    equity?: boolean;
    equityKnown?: boolean;
    urgency?: string;
    urgencyKnown?: boolean;
    expectedStartDate?: string | null;
  } | undefined;
  assert.equal(analysis?.title, "Senior Data Engineer");
  assert.equal(analysis?.equity, false);
  assert.equal(analysis?.equityKnown, false);
  assert.equal(analysis?.urgency, "Standard");
  assert.equal(analysis?.urgencyKnown, false);
  assert.equal(analysis?.expectedStartDate, null);
  assert.ok(!calls.some((c) => c.name === "record_requisition_parse"));
  assert.ok(!calls.some((c) => c.name === "complete_aria_job"));
});

test("readiness in the outcome comes from the server response, not a client-computed flag", async () => {
  const { client } = makeClient({
    finalize_requisition_parse: () => ({ status: "completed", ready: false }),
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "completed", ready: false });
});

test("completed finalizer response requires an explicit boolean readiness value", async () => {
  for (const ready of [undefined, "false", 0]) {
    const { client } = makeClient({
      finalize_requisition_parse: () => ({ status: "completed", ready }),
      // A malformed response may follow a committed finalizer. The exact
      // lease is then gone, so the attempt-bound failure path reports stale
      // rather than fabricating completed=false.
      fail_requisition_parse_egress: () => ({ status: "lease_mismatch" }),
    });
    const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
    assert.deepEqual(outcome, { outcome: "stale_lease" });
  }
});

test("not-ready brief still finalizes in one call; the model output itself was thin", async () => {
  const { client, calls } = makeClient({
    finalize_requisition_parse: () => ({ status: "completed", ready: false }),
  });
  const notReadyJson = JSON.stringify({ title: "Engineer" });
  const outcome = await handleRequisitionParseJob(
    JOB,
    baseDeps({ fetcher: (async () => anthropicResponse(notReadyJson)) as unknown as typeof fetch }, client),
  );
  assert.deepEqual(outcome, { outcome: "completed", ready: false });
  assert.equal(calls.filter((c) => c.name === "finalize_requisition_parse").length, 1);
});

test("crash-recovered replay: finalize reports no_op_replay and the outcome passes it straight through", async () => {
  const { client } = makeClient({
    finalize_requisition_parse: () => ({ status: "no_op_replay" }),
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "no_op_replay" });
});

test("concurrent duplicate requests for the same lease: only one wins the execution claim, exactly one provider fetch", async () => {
  let claimed = false;
  let fetchCount = 0;
  const { client, calls } = makeClient({
    authorize_requisition_parse_job_v2: () => {
      if (claimed) {
        return { status: "already_claimed" };
      }
      claimed = true;
      return {
        status: "authorized",
        requisition_id: JOB.requisitionId,
        workspace_id: JOB.workspaceId,
        content: SOURCE_CONTENT,
        content_type: "text/plain",
        need_sha256: NEED_SHA256,
        claim_token: CLAIM_TOKEN,
        fence_version: FENCE_VERSION,
      };
    },
  });
  const deps = baseDeps(
    {
      fetcher: (async () => {
        fetchCount += 1;
        return anthropicResponse(READY_MODEL_JSON);
      }) as unknown as typeof fetch,
    },
    client,
  );
  const outcomes = await Promise.all([
    handleRequisitionParseJob(JOB, deps),
    handleRequisitionParseJob(JOB, deps),
  ]);
  assert.equal(fetchCount, 1);
  assert.ok(outcomes.some((o) => o.outcome === "completed"));
  assert.ok(outcomes.some((o) => o.outcome === "stale_lease"));
  assert.equal(calls.filter((c) => c.name === "fail_aria_job").length, 0);
});

test("finalize denial after a TOCTOU race (controls flipped mid-flight) fails the job terminally, never silently succeeds, never retries a call the provider already answered", async () => {
  const { client, calls } = makeClient({
    finalize_requisition_parse: () => ({ status: "intake_disabled" }),
  });
  const outcome = await handleRequisitionParseJob(JOB, baseDeps({}, client));
  assert.deepEqual(outcome, { outcome: "dead_lettered", reason: "unauthorized_intake_disabled" });
  assert.ok(!calls.some((c) => c.name === "fail_aria_job"));
  const failCall = calls.find((c) => c.name === "fail_requisition_parse_egress");
  assert.ok(failCall);
  assert.equal(failCall?.params.p_reason, "unauthorized_intake_disabled");
});
