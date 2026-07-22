import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  handleCampaignCreateJob,
  isValidCampaignCreateOutcome,
} from "../scripts/sourcing-loop-handlers/campaign-create.mjs";

const JOB = Object.freeze({
  id: "70000000-0000-4000-8000-000000000001",
  lease_id: "80000000-0000-4000-8000-000000000001",
  workspace_id: "51111111-1111-4111-8111-111111111111",
  kind: "campaign_create",
  payload: { requisition_id: "61111111-1111-4111-8111-111111111111" },
});
const CAMPAIGN_ID = "90000000-0000-4000-8000-000000000001";
const SOURCING_JOB_ID = "a0000000-0000-4000-8000-000000000001";
const CAMPAIGN_SHA256 = "a".repeat(64);

type RpcParams = Record<string, unknown>;
type RpcBehavior = (params: RpcParams) => unknown | Promise<unknown>;

function successResponse(status: "completed" | "no_op_replay") {
  return {
    status,
    job_id: JOB.id,
    campaign_id: CAMPAIGN_ID,
    campaign_sha256: CAMPAIGN_SHA256,
    sourcing_job_id: SOURCING_JOB_ID,
  };
}

function makeClient(overrides: Record<string, RpcBehavior> = {}) {
  const calls: Array<{ name: string; params: RpcParams }> = [];
  const defaults: Record<string, RpcBehavior> = {
    finalize_campaign_create_job: () => successResponse("completed"),
    fail_aria_job: (params) => (params.p_retryable ? "queued" : "dead"),
  };
  const behavior = { ...defaults, ...overrides };
  const client = {
    async rpc(name: string, params: RpcParams) {
      calls.push({ name, params });
      const fn = behavior[name];
      if (!fn) throw new Error(`unexpected rpc: ${name}`);
      const result = await fn(params);
      if (result && typeof result === "object" && "__throw" in result) {
        throw result.__throw;
      }
      if (result && typeof result === "object" && Object.hasOwn(result, "data") && Object.hasOwn(result, "error")) {
        return result;
      }
      return { data: result, error: null };
    },
  };
  return { client, calls };
}

test("no client is reported unavailable without touching the job", async () => {
  const outcome = await handleCampaignCreateJob(JOB, undefined);
  assert.deepEqual(outcome, { outcome: "unavailable", reason: "service_client_unavailable" });
});

test("malformed job envelope is rejected before any RPC call", async () => {
  const { client, calls } = makeClient();
  const malformed = [
    { ...JOB, id: undefined },
    { ...JOB, id: "not-a-uuid" },
    { ...JOB, lease_id: "" },
    { ...JOB, lease_id: "not-a-uuid" },
    { ...JOB, workspace_id: null },
    { ...JOB, workspace_id: "not-a-uuid" },
    { ...JOB, kind: "requisition_parse" },
    null,
    "not-an-object",
  ];
  for (const job of malformed) {
    const outcome = await handleCampaignCreateJob(job, client);
    assert.deepEqual(outcome, { outcome: "unavailable", reason: "invalid_job_envelope" });
  }
  assert.equal(calls.length, 0, "no RPC was ever called for an unproven envelope");
});

test("missing, malformed or non-exact payload remains read-only", async () => {
  const { client, calls } = makeClient();
  for (const payload of [
    {},
    { requisition_id: "not-a-uuid" },
    { requisition_id: JOB.payload.requisition_id, extra: "not-authorized" },
  ]) {
    const outcome = await handleCampaignCreateJob({ ...JOB, payload }, client);
    assert.deepEqual(outcome, { outcome: "unavailable", reason: "invalid_job_payload" });
  }
  assert.equal(calls.length, 0);
});

test("RPC transport exception returns unavailable with a bounded reason, never fail_aria_job", async () => {
  const longMessage = "x".repeat(5_000);
  const { client, calls } = makeClient({
    finalize_campaign_create_job: () => ({ __throw: new Error(longMessage) }),
  });
  const outcome = await handleCampaignCreateJob(JOB, client);
  assert.equal(outcome.outcome, "unavailable");
  assert.ok("reason" in outcome);
  assert.equal(outcome.reason.length, 200);
  assert.equal(outcome.reason, longMessage.slice(0, 200));
  assert.equal(calls.filter((c) => c.name === "fail_aria_job").length, 0);
});

test("RPC returned error envelope returns unavailable with a bounded reason, never fail_aria_job", async () => {
  const { client, calls } = makeClient({
    finalize_campaign_create_job: () => ({ data: null, error: { message: "connection reset" } }),
  });
  const outcome = await handleCampaignCreateJob(JOB, client);
  assert.deepEqual(outcome, { outcome: "unavailable", reason: "connection reset" });
  assert.equal(calls.filter((c) => c.name === "fail_aria_job").length, 0);
});

test("completed and no_op_replay pass straight through without mutating the job", async () => {
  for (const status of ["completed", "no_op_replay"]) {
    const { client, calls } = makeClient({
      finalize_campaign_create_job: () => successResponse(status as "completed" | "no_op_replay"),
    });
    const outcome = await handleCampaignCreateJob(JOB, client);
    assert.deepEqual(outcome, { outcome: status });
    assert.equal(calls.filter((c) => c.name === "fail_aria_job").length, 0);
  }
});

test("completed and replay responses require exact IDs and hash", async () => {
  const malformed = [
    { ...successResponse("completed"), job_id: "b0000000-0000-4000-8000-000000000001" },
    { ...successResponse("completed"), campaign_id: "not-a-uuid" },
    { ...successResponse("completed"), campaign_sha256: "a".repeat(63) },
    { ...successResponse("completed"), sourcing_job_id: undefined },
    { status: "no_op_replay" },
  ];
  for (const result of malformed) {
    const { client, calls } = makeClient({ finalize_campaign_create_job: () => result });
    const outcome = await handleCampaignCreateJob(JOB, client);
    assert.deepEqual(outcome, { outcome: "unavailable", reason: "invalid_finalize_response" });
    assert.equal(calls.filter((call) => call.name === "fail_aria_job").length, 0);
  }
});

test("null or status-less finalizer data is unavailable, never assumed stale", async () => {
  for (const data of [null, {}]) {
    const { client, calls } = makeClient({
      finalize_campaign_create_job: () => ({ data, error: null }),
    });
    assert.deepEqual(
      await handleCampaignCreateJob(JOB, client),
      { outcome: "unavailable", reason: "invalid_finalize_response" },
    );
    assert.equal(calls.filter((call) => call.name === "fail_aria_job").length, 0);
  }
});

test("every read-only status is treated as stale_lease and never calls fail_aria_job", async () => {
  const readOnlyStatuses = [
    "invalid_request",
    "job_not_found",
    "wrong_kind",
    "wrong_workspace",
    "payload_mismatch",
    "lease_mismatch",
    "lease_expired",
    "replay_conflict",
  ];
  for (const status of readOnlyStatuses) {
    const { client, calls } = makeClient({
      finalize_campaign_create_job: () => ({ status }),
    });
    const outcome = await handleCampaignCreateJob(JOB, client);
    assert.deepEqual(outcome, { outcome: "stale_lease" }, `status=${status}`);
    assert.equal(
      calls.filter((c) => c.name === "fail_aria_job").length,
      0,
      `fail_aria_job must never be called for read-only status=${status}`,
    );
  }
});

test("retryable statuses call fail_aria_job with p_retryable true", async () => {
  for (const status of ["sourcing_disabled", "activation_actor_invalid", "workspace_unavailable"]) {
    const { client, calls } = makeClient({
      finalize_campaign_create_job: () => ({ status }),
      fail_aria_job: () => "queued",
    });
    const outcome = await handleCampaignCreateJob(JOB, client);
    assert.equal(outcome.outcome, "retry_scheduled");
    assert.ok("reason" in outcome);
    assert.equal(outcome.reason, status);
    const failCall = calls.find((c) => c.name === "fail_aria_job");
    assert.ok(failCall);
    assert.equal(failCall.params.p_retryable, true);
    assert.equal(failCall.params.p_job_id, JOB.id);
    assert.equal(failCall.params.p_lease_id, JOB.lease_id);
  }
});

test("terminal statuses call fail_aria_job with p_retryable false and never include state_conflict", async () => {
  for (const status of ["requisition_not_ready", "parse_receipt_mismatch", "invalid_role_basis"]) {
    const { client, calls } = makeClient({
      finalize_campaign_create_job: () => ({ status }),
      fail_aria_job: () => "dead",
    });
    const outcome = await handleCampaignCreateJob(JOB, client);
    assert.equal(outcome.outcome, "dead_lettered");
    assert.ok("reason" in outcome);
    assert.equal(outcome.reason, status);
    const failCall = calls.find((c) => c.name === "fail_aria_job");
    assert.ok(failCall);
    assert.equal(failCall.params.p_retryable, false);
  }
  // state_conflict is no longer a status finalize_campaign_create_job can
  // return (it raises instead once the campaign row is written), so a
  // duplicate/forged call reporting it must fall through to the unknown-
  // status branch rather than being silently treated as terminal.
  const { client, calls } = makeClient({
    finalize_campaign_create_job: () => ({ status: "state_conflict" }),
    fail_aria_job: () => "dead",
  });
  const outcome = await handleCampaignCreateJob(JOB, client);
  assert.deepEqual(outcome, { outcome: "unavailable", reason: "unknown_finalize_response" });
  assert.equal(calls.filter((call) => call.name === "fail_aria_job").length, 0);
});

test("unknown status remains read-only and degrades the worker", async () => {
  const { client, calls } = makeClient({
    finalize_campaign_create_job: () => ({ status: "totally_unrecognized" }),
  });
  const outcome = await handleCampaignCreateJob(JOB, client);
  assert.deepEqual(outcome, { outcome: "unavailable", reason: "unknown_finalize_response" });
  assert.equal(calls.filter((call) => call.name === "fail_aria_job").length, 0);
});

test("fail_aria_job transport errors are unavailable, never assumed stale", async () => {
  const { client } = makeClient({
    finalize_campaign_create_job: () => ({ status: "sourcing_disabled" }),
    fail_aria_job: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  assert.deepEqual(
    await handleCampaignCreateJob(JOB, client),
    { outcome: "unavailable", reason: "rpc_unavailable" },
  );
});

test("only an exact not_found failure result proves a stale lease", async () => {
  for (const data of [null, "invalid_request", "unexpected_contract_value"]) {
    const { client } = makeClient({
      finalize_campaign_create_job: () => ({ status: "sourcing_disabled" }),
      fail_aria_job: () => ({ data, error: null }),
    });
    assert.deepEqual(
      await handleCampaignCreateJob(JOB, client),
      { outcome: "unavailable", reason: "invalid_fail_response" },
    );
  }
  const { client } = makeClient({
    finalize_campaign_create_job: () => ({ status: "sourcing_disabled" }),
    fail_aria_job: () => "not_found",
  });
  assert.deepEqual(await handleCampaignCreateJob(JOB, client), { outcome: "stale_lease" });
});

test("campaign authority atomically projects an app-compatible campaign without invented facts", () => {
  const migration = readFileSync("supabase/migrations/0052_campaign_create_authority.sql", "utf8");
  const body = migration
    .match(/create or replace function public\.finalize_campaign_create_job[\s\S]+?\n\$\$;/)?.[0]
    ?.replace(/^\s*--.*$/gm, "") ?? "";
  assert.notEqual(body, "");
  assert.match(body, /public\.workspace_state%rowtype/);
  assert.match(body, /from public\.workspace_state[\s\S]+for update/);
  assert.match(body, /jsonb_set\(workspace_row\.state, '\{campaigns\}'/);
  for (const required of [
    "'jobAnalysis'",
    "'sourcingStrategy'",
    "'scoringWeights'",
    "'metrics'",
    "'skillUpdates'",
    "'activities'",
    "'hiringManager'",
    "'hiringManagerEmail'",
    "'targetStartDate'",
  ]) {
    assert.equal(body.includes(required), true, required);
  }
  for (const forbidden of [
    "apply_workspace_patch",
    "record_requisition_campaign",
    "estimatedResults",
    "targetDate",
    "exception when others",
  ]) {
    assert.equal(body.includes(forbidden), false, forbidden);
  }
});

test("isValidCampaignCreateOutcome enforces the outcome/reason contract", () => {
  assert.equal(isValidCampaignCreateOutcome({ outcome: "completed" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "no_op_replay" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "stale_lease" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "retry_scheduled", reason: "x" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "dead_lettered", reason: "x" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "unavailable", reason: "x" }), true);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "unavailable" }), false, "unavailable requires a reason");
  assert.equal(isValidCampaignCreateOutcome({ outcome: "retry_scheduled" }), false, "retry_scheduled requires a reason");
  assert.equal(isValidCampaignCreateOutcome({ outcome: "not_a_real_outcome" }), false);
  assert.equal(isValidCampaignCreateOutcome(null), false);
  assert.equal(isValidCampaignCreateOutcome({ outcome: "dead_lettered", reason: "x".repeat(2_001) }), false);
});
