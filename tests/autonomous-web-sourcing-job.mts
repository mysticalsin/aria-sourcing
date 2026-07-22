import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  handleAutonomousWebSourcingJob,
  resolveAutonomousWebTavilyCredential,
  type AutonomousWebRuntimeDependencies,
} from "../src/lib/sourcing/autonomous-web-runtime.ts";

const JOB = {
  jobId: "70000000-0000-4000-8000-000000000001",
  leaseId: "80000000-0000-4000-8000-000000000001",
  workspaceId: "51111111-1111-4111-8111-111111111111",
  campaignId: "90000000-0000-4000-8000-000000000001",
  claimToken: "a0000000-0000-4000-8000-000000000001",
  fenceVersion: 1,
};
const ATTEMPT_ID = "b0000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "c0000000-0000-4000-8000-000000000001";
const QUERY = 'site:linkedin.com/in "vp finance" "sap"';
const QUERY_SHA256 = "d".repeat(64);
const REQUEST_SHA256 = "e".repeat(64);
const CREDENTIAL_VERSION = "f".repeat(64);
const RESULT_SHA256 = "1".repeat(64);
const RAW_SHA256 = "2".repeat(64);
const REQUEST = {
  query: QUERY,
  search_depth: "basic",
  max_results: 5,
  include_domains: ["linkedin.com"],
  include_answer: false,
  include_images: false,
};
const BEGIN = {
  status: "begun",
  egressAttemptId: ATTEMPT_ID,
  provider: "tavily",
  credentialId: CREDENTIAL_ID,
  credentialVersion: CREDENTIAL_VERSION,
  queryPolicyVersion: "tavily-linkedin-deterministic-v1",
  canonicalQuerySha256: QUERY_SHA256,
  requestSha256: REQUEST_SHA256,
  request: REQUEST,
  egressExpiresAt: "2026-07-21T12:35:26.000Z",
};
const NORMALIZED_RESULTS = [{
  url: "https://www.linkedin.com/in/ada-lovelace",
  title: "Ada Lovelace - VP Finance | LinkedIn",
  content: "VP Finance leading SAP transformation.",
  score: 0.93,
}];
const PROVIDER_RECEIPT = {
  provider: "tavily",
  providerRequestId: "123e4567-e89b-12d3-a456-426614174111",
  responseTimeMs: 210,
  resultCount: 1,
  querySha256: QUERY_SHA256,
  requestSha256: REQUEST_SHA256,
  rawResponseSha256: RAW_SHA256,
  rawResponseBytes: 512,
};

type RpcCall = { name: string; params: Record<string, unknown> };

function beginParamsForTest(): Record<string, unknown> {
  return {
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_campaign_id: JOB.campaignId,
    p_claim_token: JOB.claimToken,
    p_fence_version: JOB.fenceVersion,
  };
}

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: RpcCall[] = [];
  const defaults: Record<string, unknown> = {
    begin_autonomous_web_sourcing_egress: BEGIN,
    confirm_autonomous_web_sourcing_egress: {
      status: "confirmed",
      egressAttemptId: ATTEMPT_ID,
      mustStartBy: "2026-07-21T12:35:26.000Z",
    },
    record_autonomous_web_sourcing_result: {
      status: "recorded",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
    commit_autonomous_web_sourcing: {
      status: "completed",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
    fail_autonomous_web_sourcing: { status: "dead" },
    reconcile_autonomous_web_sourcing: { status: "not_reconcilable" },
  };
  const results = { ...defaults, ...overrides };
  return {
    calls,
    async rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      const result = results[name];
      if (result instanceof Error) return { data: null, error: { code: result.message } };
      if (typeof result === "function") {
        const resolved = (result as (params: Record<string, unknown>) => unknown)(params);
        if (resolved instanceof Error) {
          return { data: null, error: { code: resolved.message } };
        }
        return { data: resolved, error: null };
      }
      if (!(name in results)) throw new Error(`unexpected rpc ${name}`);
      return { data: result, error: null };
    },
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let resolverCalls = 0;
  let providerCalls = 0;
  const deps: AutonomousWebRuntimeDependencies = {
    resolveCredential: async () => {
      resolverCalls += 1;
      const credential = { kind: "workspace" } as { kind: "workspace"; authorizationHeader?: () => string };
      Object.defineProperty(credential, "authorizationHeader", {
        enumerable: false,
        value: () => "Bearer tvly-production-secret-marker-123456789",
      });
      return credential as { kind: "workspace"; authorizationHeader: () => string };
    },
    executeSearch: async () => {
      providerCalls += 1;
      return {
        ok: true as const,
        normalizedResults: NORMALIZED_RESULTS,
        rawResponseSha256: RAW_SHA256,
        rawResponseBytes: 512,
        providerReceipt: PROVIDER_RECEIPT,
      };
    },
    now: () => Date.parse("2026-07-21T12:35:20.000Z"),
    ...(overrides as Partial<AutonomousWebRuntimeDependencies>),
  };
  return { deps, counts: () => ({ resolverCalls, providerCalls }) };
}

test("begins, resolves, confirms, calls Tavily once, records evidence, then commits", async () => {
  const client = makeClient();
  const { deps, counts } = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, deps);

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "confirm_autonomous_web_sourcing_egress",
    "record_autonomous_web_sourcing_result",
    "commit_autonomous_web_sourcing",
  ]);
  assert.deepEqual(counts(), { resolverCalls: 1, providerCalls: 1 });
  assert.deepEqual(client.calls[0].params, {
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_campaign_id: JOB.campaignId,
    p_claim_token: JOB.claimToken,
    p_fence_version: JOB.fenceVersion,
  });
  assert.deepEqual(client.calls[1].params, {
    p_egress_attempt_id: ATTEMPT_ID,
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_campaign_id: JOB.campaignId,
    p_claim_token: JOB.claimToken,
    p_fence_version: JOB.fenceVersion,
    p_credential_id: CREDENTIAL_ID,
    p_credential_version: CREDENTIAL_VERSION,
    p_query_policy_version: "tavily-linkedin-deterministic-v1",
    p_canonical_query_sha256: QUERY_SHA256,
    p_request_sha256: REQUEST_SHA256,
  });
  assert.deepEqual(client.calls[2].params, {
    p_egress_attempt_id: ATTEMPT_ID,
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_claim_token: JOB.claimToken,
    p_fence_version: JOB.fenceVersion,
    p_provider: "tavily",
    p_credential_id: CREDENTIAL_ID,
    p_credential_version: CREDENTIAL_VERSION,
    p_query_policy_version: "tavily-linkedin-deterministic-v1",
    p_canonical_query_sha256: QUERY_SHA256,
    p_request_sha256: REQUEST_SHA256,
    p_raw_response_sha256: RAW_SHA256,
    p_raw_response_bytes: 512,
    p_provider_receipt: PROVIDER_RECEIPT,
    p_normalized_results: NORMALIZED_RESULTS,
  });
  assert.deepEqual(client.calls[3].params, {
    p_job_id: JOB.jobId,
    p_lease_id: JOB.leaseId,
    p_workspace_id: JOB.workspaceId,
    p_campaign_id: JOB.campaignId,
    p_claim_token: JOB.claimToken,
    p_fence_version: JOB.fenceVersion,
    p_egress_attempt_id: ATTEMPT_ID,
    p_result_sha256: RESULT_SHA256,
  });
});

test("a lost begin response reuses the exact unconfirmed attempt and fetches once", async () => {
  let beginCalls = 0;
  const client = makeClient({
    begin_autonomous_web_sourcing_egress: () => {
      beginCalls += 1;
      return beginCalls === 1 ? new Error("response_lost") : BEGIN;
    },
  });
  const { deps, counts } = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, deps);

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.equal(beginCalls, 2);
  assert.deepEqual(counts(), { resolverCalls: 1, providerCalls: 1 });
  assert.deepEqual(client.calls.slice(0, 2), [
    { name: "begin_autonomous_web_sourcing_egress", params: beginParamsForTest() },
    { name: "begin_autonomous_web_sourcing_egress", params: beginParamsForTest() },
  ]);
});

test("an already-begun response never resolves a secret or makes a second provider request", async () => {
  const client = makeClient({
    begin_autonomous_web_sourcing_egress: {
      status: "already_begun",
      egressAttemptId: ATTEMPT_ID,
    },
    reconcile_autonomous_web_sourcing: {
      status: "completed",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const { deps, counts } = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, deps);
  assert.deepEqual(result, { outcome: "no_op_replay" });
  assert.deepEqual(counts(), { resolverCalls: 0, providerCalls: 0 });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "reconcile_autonomous_web_sourcing",
  ]);
});

test("a crash after durable record recovers and commits without a second provider request", async () => {
  const client = makeClient({
    begin_autonomous_web_sourcing_egress: {
      status: "already_begun",
      egressAttemptId: ATTEMPT_ID,
    },
    reconcile_autonomous_web_sourcing: {
      status: "result_ready",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const { deps, counts } = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, deps);

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.deepEqual(counts(), { resolverCalls: 0, providerCalls: 0 });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "reconcile_autonomous_web_sourcing",
    "commit_autonomous_web_sourcing",
  ]);
  assert.equal(client.calls[2]?.params.p_egress_attempt_id, ATTEMPT_ID);
  assert.equal(client.calls[2]?.params.p_result_sha256, RESULT_SHA256);
});

test("crashes around confirmation or before record never cause a repeated provider request", async () => {
  for (const scenario of [
    {
      name: "confirmation response was lost before fetch",
      client: {
        confirm_autonomous_web_sourcing_egress: new Error("rpc_unavailable"),
        reconcile_autonomous_web_sourcing: {
          status: "no_durable_response",
          resultSha256: null,
        },
      },
      expectedRpcNames: [
        "begin_autonomous_web_sourcing_egress",
        "confirm_autonomous_web_sourcing_egress",
        "reconcile_autonomous_web_sourcing",
      ],
      resolverCalls: 1,
    },
    {
      name: "confirmation was already consumed by an interrupted handler",
      client: {
        confirm_autonomous_web_sourcing_egress: {
          status: "already_confirmed",
          egressAttemptId: ATTEMPT_ID,
          mustStartBy: "2026-07-21T12:35:26.000Z",
        },
        reconcile_autonomous_web_sourcing: {
          status: "no_durable_response",
          resultSha256: null,
        },
      },
      expectedRpcNames: [
        "begin_autonomous_web_sourcing_egress",
        "confirm_autonomous_web_sourcing_egress",
        "reconcile_autonomous_web_sourcing",
      ],
      resolverCalls: 1,
    },
    {
      name: "provider returned but the process crashed before record",
      client: {
        begin_autonomous_web_sourcing_egress: {
          status: "already_begun",
          egressAttemptId: ATTEMPT_ID,
        },
        reconcile_autonomous_web_sourcing: {
          status: "no_durable_response",
          resultSha256: null,
        },
      },
      expectedRpcNames: [
        "begin_autonomous_web_sourcing_egress",
        "reconcile_autonomous_web_sourcing",
      ],
      resolverCalls: 0,
    },
  ]) {
    const client = makeClient(scenario.client);
    const configured = dependencies();
    const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);
    assert.deepEqual(
      result,
      { outcome: "ambiguous_dead_lettered", reason: "no_durable_response" },
      scenario.name,
    );
    assert.deepEqual(
      configured.counts(),
      { resolverCalls: scenario.resolverCalls, providerCalls: 0 },
      scenario.name,
    );
    assert.deepEqual(
      client.calls.map(({ name }) => name),
      scenario.expectedRpcNames,
      scenario.name,
    );
  }
});

test("an expired confirmation window fails terminally without provider egress", async () => {
  const client = makeClient({
    confirm_autonomous_web_sourcing_egress: {
      status: "confirmed",
      egressAttemptId: ATTEMPT_ID,
      mustStartBy: "2026-07-21T12:35:19.999Z",
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "confirmation_window_expired" });
  assert.equal(configured.counts().providerCalls, 0);
  assert.equal(client.calls.at(-1)?.name, "fail_autonomous_web_sourcing");
  assert.equal(client.calls.at(-1)?.params.p_ambiguous, false);
});

test("credential failure and confirmation denial settle terminally before provider egress", async () => {
  for (const scenario of [
    {
      deps: { resolveCredential: async () => null },
      expectedCode: "credential_resolution_failed",
      confirmCalls: 0,
    },
    {
      deps: {
        resolveCredential: async () => {
          throw new Error("credential query transport failed");
        },
      },
      expectedCode: "credential_resolution_failed",
      confirmCalls: 0,
    },
    {
      client: { confirm_autonomous_web_sourcing_egress: { status: "credential_changed" } },
      expectedCode: "egress_confirmation_denied",
      confirmCalls: 1,
    },
  ]) {
    const client = makeClient(scenario.client);
    const configured = dependencies(scenario.deps);
    const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);
    assert.deepEqual(result, { outcome: "dead_lettered", reason: scenario.expectedCode });
    assert.equal(configured.counts().providerCalls, 0);
    assert.equal(
      client.calls.filter(({ name }) => name === "confirm_autonomous_web_sourcing_egress").length,
      scenario.confirmCalls,
    );
    const failure = client.calls.at(-1);
    assert.equal(failure?.name, "fail_autonomous_web_sourcing");
    assert.equal(failure?.params.p_retryable, false);
    assert.equal(failure?.params.p_ambiguous, false);
  }
});

test("transport uncertainty is marked ambiguous and never re-egressed", async () => {
  const client = makeClient({ fail_autonomous_web_sourcing: { status: "ambiguous" } });
  const configured = dependencies({
    executeSearch: async () => ({
      ok: false,
      code: "search_transport_unknown",
      retryable: false,
      ambiguous: true,
    }),
  });
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);
  assert.deepEqual(result, { outcome: "ambiguous_dead_lettered", reason: "search_transport_unknown" });
  const failure = client.calls.at(-1);
  assert.equal(failure?.name, "fail_autonomous_web_sourcing");
  assert.equal(failure?.params.p_retryable, false);
  assert.equal(failure?.params.p_ambiguous, true);
});

test("a definitive retryable provider failure is durably scheduled for a new attempt", async () => {
  const client = makeClient({ fail_autonomous_web_sourcing: { status: "retry_scheduled" } });
  const configured = dependencies({
    executeSearch: async () => ({
      ok: false,
      code: "search_rate_limited",
      retryable: true,
      ambiguous: false,
    }),
  });

  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "retry_scheduled", reason: "search_rate_limited" });
  assert.equal(configured.counts().providerCalls, 0);
  const failure = client.calls.at(-1);
  assert.equal(failure?.name, "fail_autonomous_web_sourcing");
  assert.equal(failure?.params.p_retryable, true);
  assert.equal(failure?.params.p_ambiguous, false);
});

test("record uncertainty reconciles before reporting a durable outcome", async () => {
  const client = makeClient({
    record_autonomous_web_sourcing_result: new Error("rpc_unavailable"),
    reconcile_autonomous_web_sourcing: {
      status: "result_ready",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);
  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "confirm_autonomous_web_sourcing_egress",
    "record_autonomous_web_sourcing_result",
    "reconcile_autonomous_web_sourcing",
    "commit_autonomous_web_sourcing",
  ]);
});

test("a malformed record replay response recovers only from exact durable metadata", async () => {
  const client = makeClient({
    record_autonomous_web_sourcing_result: {
      status: "recorded",
      resultSha256: RESULT_SHA256,
    },
    reconcile_autonomous_web_sourcing: {
      status: "result_ready",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "confirm_autonomous_web_sourcing_egress",
    "record_autonomous_web_sourcing_result",
    "reconcile_autonomous_web_sourcing",
    "commit_autonomous_web_sourcing",
  ]);
});

test("erasure-scrubbed staged evidence settles the exact attempt without another fetch", async () => {
  const client = makeClient({
    commit_autonomous_web_sourcing: { status: "result_binding_invalid" },
    fail_autonomous_web_sourcing: { status: "dead" },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "result_binding_invalid" });
  assert.equal(configured.counts().providerCalls, 1);
  assert.deepEqual(client.calls.map(({ name }) => name), [
    "begin_autonomous_web_sourcing_egress",
    "confirm_autonomous_web_sourcing_egress",
    "record_autonomous_web_sourcing_result",
    "commit_autonomous_web_sourcing",
    "fail_autonomous_web_sourcing",
  ]);
  assert.equal(client.calls.at(-1)?.params.p_ambiguous, false);
  assert.equal(client.calls.at(-1)?.params.p_retryable, false);
});

test("commit uncertainty retries only the same durable result and never re-fetches", async () => {
  let commitCalls = 0;
  const client = makeClient({
    commit_autonomous_web_sourcing: () => {
      commitCalls += 1;
      if (commitCalls === 1) throw new Error("commit response lost");
      return {
        status: "completed",
        resultSha256: RESULT_SHA256,
        candidateCount: 1,
      };
    },
    reconcile_autonomous_web_sourcing: {
      status: "result_ready",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.equal(commitCalls, 2);
  assert.equal(configured.counts().providerCalls, 1);
  assert.deepEqual(
    client.calls
      .filter(({ name }) => name === "commit_autonomous_web_sourcing")
      .map(({ params }) => [params.p_egress_attempt_id, params.p_result_sha256]),
    [
      [ATTEMPT_ID, RESULT_SHA256],
      [ATTEMPT_ID, RESULT_SHA256],
    ],
  );
});

test("a lost successful commit response reconciles without an unnecessary retry", async () => {
  const client = makeClient({
    commit_autonomous_web_sourcing: new Error("commit response lost"),
    reconcile_autonomous_web_sourcing: {
      status: "completed",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "no_op_replay" });
  assert.equal(
    client.calls.filter(({ name }) => name === "commit_autonomous_web_sourcing").length,
    1,
  );
  assert.equal(configured.counts().providerCalls, 1);
});

test("a no-op commit replay is accepted without making candidate facts up", async () => {
  const client = makeClient({
    commit_autonomous_web_sourcing: {
      status: "no_op_replay",
      resultSha256: RESULT_SHA256,
      candidateCount: 1,
    },
  });
  const configured = dependencies();
  const result = await handleAutonomousWebSourcingJob(JOB, client, configured.deps);

  assert.deepEqual(result, { outcome: "no_op_replay" });
  assert.equal(configured.counts().providerCalls, 1);
  assert.equal(
    client.calls.filter(({ name }) => name === "commit_autonomous_web_sourcing").length,
    1,
  );
});

test("credential resolution recomputes the exact immutable version and hides the decrypted key", async () => {
  const lastTestedAt = "2026-07-21T12:34:56.123456+00:00";
  const expectedVersion = createHash("sha256").update([
    "aria.autonomous-web-credential.v1",
    CREDENTIAL_ID,
    JOB.workspaceId,
    "Tavily",
    "6789",
    "2026-07-21T12:34:56.123456Z",
    "tavily_usage_v1",
    "200",
  ].join("\n"), "utf8").digest("hex");
  const filters: Array<[string, unknown]> = [];
  const row = {
    id: CREDENTIAL_ID,
    workspace_id: JOB.workspaceId,
    provider: "Tavily",
    status: "valid",
    secret: "tvly-production-secret-marker-123456789",
    last4: "6789",
    last_tested_at: lastTestedAt,
    verification_method: "tavily_usage_v1",
    verification_http_status: 200,
  };
  const query = {
    select() { return this; },
    eq(column: string, value: unknown) { filters.push([column, value]); return this; },
    in(column: string, value: readonly unknown[]) { filters.push([column, value]); return this; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  const service = { from: (table: string) => { assert.equal(table, "api_keys"); return query; } };

  const credential = await resolveAutonomousWebTavilyCredential(
    service,
    JOB.workspaceId,
    CREDENTIAL_ID,
    expectedVersion,
    (stored) => stored,
  );
  assert.ok(credential);
  assert.equal(credential.authorizationHeader(), `Bearer ${row.secret}`);
  assert.equal(JSON.stringify(credential).includes(row.secret), false);
  assert.deepEqual(filters, [
    ["id", CREDENTIAL_ID],
    ["workspace_id", JOB.workspaceId],
    ["provider", "Tavily"],
    ["status", "valid"],
    ["verification_method", ["tavily_usage_v1", "tavily_key_info_v1"]],
    ["verification_http_status", 200],
  ]);

  assert.equal(
    await resolveAutonomousWebTavilyCredential(
      service,
      JOB.workspaceId,
      CREDENTIAL_ID,
      "0".repeat(64),
      (stored) => stored,
    ),
    null,
  );

  assert.equal(
    await resolveAutonomousWebTavilyCredential(
      service,
      JOB.workspaceId,
      CREDENTIAL_ID,
      expectedVersion,
      () => "tvly-production-secret-marker-wrong-last4",
    ),
    null,
  );
  assert.equal(
    await resolveAutonomousWebTavilyCredential(
      service,
      JOB.workspaceId,
      CREDENTIAL_ID,
      expectedVersion,
      () => { throw new Error(`decrypt failed: ${row.secret}`); },
    ),
    null,
  );
});
