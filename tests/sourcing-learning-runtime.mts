import assert from "node:assert/strict";
import { mock, test } from "node:test";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const frameworkRunId = "88888888-8888-4888-8888-888888888888";
const lessonId = "44444444-4444-4444-8444-444444444444";
const roleFingerprint = "a".repeat(64);
const configurationFingerprint = "b".repeat(64);

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: { getServiceSupabase: () => null },
});

const authority = await import("../src/lib/sourcing/learning-authority");

let response: { data: unknown; error: unknown } = { data: null, error: null };
let lastRpc: { name: string; args: Record<string, unknown> } | null = null;
const service = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    lastRpc = { name, args };
    return response;
  },
};
const roleBasis = {
  title: "Senior Backend Engineer",
  seniority: "Senior",
  employmentType: "Full-time",
  locationType: "Remote",
  region: "EU",
  timezone: "CET",
  skills: ["Go", "PostgreSQL"],
};

function reset() {
  response = { data: null, error: null };
  lastRpc = null;
}

test("begin maps exact server-owned authority inputs and accepts only a strict claimed receipt", async () => {
  reset();
  response = {
    data: {
      status: "claimed",
      run_id: runId,
      role_fingerprint: roleFingerprint,
      lessons_enabled: true,
    },
    error: null,
  };
  const result = await authority.beginSourcingRun(
    {
      workspaceId,
      actorId,
      campaignId: "campaign-1",
      roleBasis,
      configurationFingerprint,
      mode: "deterministic",
      provider: null,
      model: null,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestId: "request-1",
    },
    service as never,
  );

  assert.deepEqual(result, {
    status: "claimed",
    runId,
    roleFingerprint,
    lessonsEnabled: true,
  });
  assert.equal(lastRpc?.name, "begin_sourcing_run");
  assert.deepEqual(lastRpc?.args.p_role_basis, roleBasis);
  assert.equal(lastRpc?.args.p_configuration_fingerprint, configurationFingerprint);
  assert.equal(lastRpc?.args.p_provider, null);
  assert.equal(lastRpc?.args.p_model, null);
});

test("begin rejects malformed local and database receipts without inventing authority", async () => {
  reset();
  const invalidLocal = await authority.beginSourcingRun(
    {
      workspaceId,
      actorId,
      campaignId: "campaign-1",
      roleBasis,
      configurationFingerprint: "not-a-sha",
      mode: "cloud",
      provider: "openai",
      model: "gpt-4o-mini",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestId: "request-2",
    },
    service as never,
  );
  assert.deepEqual(invalidLocal, { status: "invalid_request" });
  assert.equal(lastRpc, null);

  response = {
    data: {
      status: "claimed",
      run_id: "not-a-uuid",
      role_fingerprint: roleFingerprint,
      lessons_enabled: true,
    },
    error: null,
  };
  const malformed = await authority.beginSourcingRun(
    {
      workspaceId,
      actorId,
      campaignId: "campaign-1",
      roleBasis,
      configurationFingerprint,
      mode: "cloud",
      provider: "openai",
      model: "gpt-4o-mini",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestId: "request-3",
    },
    service as never,
  );
  assert.deepEqual(malformed, { status: "dependency_unavailable" });
});

test("promoted lessons are parsed only from the bounded runtime schema", async () => {
  reset();
  response = {
    data: {
      status: "ready",
      role_fingerprint: roleFingerprint,
      lessons: [{
        lessonId,
        platform: "GitHub",
        query: "language:Go followers:>10",
        graphifyClusterRef: "community:0",
        graphifyClusterRank: 1,
        evidenceRunCount: 2,
        evidenceCampaignCount: 2,
        usefulFeedbackCount: 3,
        expiresAt: "2026-10-01T00:00:00.000Z",
        rank: 1,
      }],
    },
    error: null,
  };
  const listed = await authority.listPromotedSourcingLessons(
    { workspaceId, actorId, roleBasis, limit: 10 },
    service as never,
  );
  assert.equal(listed.status, "ready");
  assert.equal(listed.status === "ready" ? listed.lessons[0]?.lessonId : "", lessonId);
  assert.equal(
    listed.status === "ready" ? listed.lessons[0]?.graphifyClusterRef : "",
    "community:0",
  );
  assert.equal(lastRpc?.name, "list_promoted_sourcing_lessons");

  response = {
    data: {
      status: "ready",
      role_fingerprint: roleFingerprint,
      lessons: [{
        lessonId,
        platform: "Apollo",
        query: "language:Go",
        graphifyClusterRef: "community:0",
        graphifyClusterRank: 1,
        evidenceRunCount: 2,
        evidenceCampaignCount: 2,
        usefulFeedbackCount: 2,
        expiresAt: "2026-10-01T00:00:00.000Z",
        rank: 1,
      }],
    },
    error: null,
  };
  assert.deepEqual(
    await authority.listPromotedSourcingLessons(
      { workspaceId, actorId, roleBasis, limit: 10 },
      service as never,
    ),
    { status: "dependency_unavailable" },
  );
});

test("completion sends only aggregate query receipts and strictly parses the receipt", async () => {
  reset();
  response = {
    data: {
      status: "completed",
      run_id: runId,
      query_count: 1,
      candidate_count: 0,
      receipts: [{ receiptId: lessonId, platform: "GitHub", candidateCount: 0 }],
    },
    error: null,
  };
  const queryReceipts = [{
    platform: "GitHub" as const,
    query: "language:Go",
    ok: true,
    candidateCount: 0,
    skippedCount: 1,
  }];
  const result = await authority.completeSourcingRun(
    { workspaceId, actorId, runId, queryReceipts },
    service as never,
  );
  assert.deepEqual(result, {
    status: "completed",
    runId,
    queryCount: 1,
    candidateCount: 0,
    receipts: [{ receiptId: lessonId, platform: "GitHub", candidateCount: 0 }],
  });
  assert.equal(lastRpc?.name, "complete_sourcing_run");
  assert.deepEqual(lastRpc?.args.p_query_receipts, queryReceipts);
  assert.equal(JSON.stringify(lastRpc?.args).includes("candidateId"), false);
  assert.equal(JSON.stringify(lastRpc?.args).includes("profile"), false);
});

test("pending feedback is strictly parsed and scoped through the service RPC", async () => {
  reset();
  response = {
    data: {
      status: "ready",
      receipts: [{ receiptId: lessonId, platform: "GitHub", candidateCount: 0 }],
    },
    error: null,
  };
  const result = await authority.listPendingSourcingFeedback(
    { workspaceId, actorId, campaignId: "campaign-1", limit: 20 },
    service as never,
  );
  assert.deepEqual(result, {
    status: "ready",
    receipts: [{ receiptId: lessonId, platform: "GitHub", candidateCount: 0 }],
  });
  assert.equal(lastRpc?.name, "list_pending_sourcing_feedback");
  assert.equal(lastRpc?.args.p_campaign_id, "campaign-1");
});

test("failure marking requires the exact server run receipt", async () => {
  reset();
  response = { data: { status: "failed", run_id: runId }, error: null };
  assert.equal(
    await authority.failSourcingRun(
      { workspaceId, actorId, runId, errorCode: "UPSTREAM_FAILED" },
      service as never,
    ),
    true,
  );
  assert.equal(lastRpc?.name, "fail_sourcing_run");

  response = {
    data: { status: "failed", run_id: "66666666-6666-4666-8666-666666666666" },
    error: null,
  };
  assert.equal(
    await authority.failSourcingRun(
      { workspaceId, actorId, runId, errorCode: "UPSTREAM_FAILED" },
      service as never,
    ),
    false,
  );
});

test("query feedback is bound to one opaque receipt and replay key", async () => {
  reset();
  const feedbackId = "77777777-7777-4777-8777-777777777777";
  response = { data: { status: "recorded", feedback_id: feedbackId }, error: null };

  assert.deepEqual(
    await authority.recordSourcingQueryFeedback(
      {
        workspaceId,
        actorId,
        receiptId: lessonId,
        verdict: "useful",
        requestId: "feedback-request-1",
      },
      service as never,
    ),
    { status: "recorded", feedbackId },
  );
  assert.equal(lastRpc?.name, "record_sourcing_query_feedback");
  assert.deepEqual(lastRpc?.args, {
    p_workspace_id: workspaceId,
    p_actor_id: actorId,
    p_receipt_id: lessonId,
    p_verdict: "useful",
    p_request_id: "feedback-request-1",
  });
});

test("framework sourcing begin binds the exact query, campaign fingerprint, count, and capability", async () => {
  reset();
  response = {
    data: {
      status: "claimed",
      run_id: runId,
      role_fingerprint: roleFingerprint,
      lessons_enabled: false,
      framework_run_id: frameworkRunId,
    },
    error: null,
  };
  const input = {
    workspaceId,
    actorId,
    campaignId: "campaign-1",
    roleBasis,
    configurationFingerprint,
    mode: "deterministic" as const,
    provider: null,
    model: null,
    idempotencyKey: frameworkRunId,
    requestId: "framework-source-1",
    count: 5,
    campaignFingerprint: "c".repeat(64),
    sourceQuery: "language:go location:canada",
    frameworkRunId,
    capabilityToken: "s".repeat(43),
  };
  assert.deepEqual(
    await authority.beginAgentFrameworkSourcingRun(input, service as never),
    {
      status: "claimed",
      runId,
      roleFingerprint,
      lessonsEnabled: false,
      frameworkRunId,
    },
  );
  assert.equal(lastRpc?.name, "begin_agent_framework_sourcing_run");
  assert.equal(lastRpc?.args.p_source_query, input.sourceQuery);
  assert.equal(lastRpc?.args.p_campaign_fingerprint, input.campaignFingerprint);
  assert.equal(lastRpc?.args.p_count, 5);
  assert.equal(lastRpc?.args.p_sourcing_capability_token, input.capabilityToken);

  reset();
  assert.deepEqual(
    await authority.beginAgentFrameworkSourcingRun(
      { ...input, idempotencyKey: runId },
      service as never,
    ),
    { status: "invalid_request" },
  );
  assert.equal(lastRpc, null);
});

test("framework sourcing result recovery accepts only content-bound staged receipts", async () => {
  reset();
  const resultPayload = { ok: true, campaignId: "campaign-1" };
  response = {
    data: {
      status: "result_ready",
      run_id: runId,
      framework_run_id: frameworkRunId,
      result_sha256: "d".repeat(64),
      result_payload: resultPayload,
    },
    error: null,
  };
  const result = await authority.completeAgentFrameworkSourcingEffect(
    {
      workspaceId,
      actorId,
      frameworkRunId,
      sourcingRunId: runId,
      queryReceipts: [{
        platform: "GitHub",
        query: "language:go location:canada",
        ok: true,
        candidateCount: 1,
        skippedCount: 0,
      }],
      resultPayload,
    },
    service as never,
  );
  assert.deepEqual(result, {
    status: "result_ready",
    runId,
    frameworkRunId,
    resultSha256: "d".repeat(64),
    resultPayload,
  });
  assert.equal(lastRpc?.name, "complete_agent_framework_sourcing_effect");

  response = {
    data: {
      status: "result_ready",
      run_id: runId,
      framework_run_id: "99999999-9999-4999-8999-999999999999",
      result_sha256: "d".repeat(64),
      result_payload: resultPayload,
    },
    error: null,
  };
  assert.deepEqual(
    await authority.completeAgentFrameworkSourcingEffect(
      {
        workspaceId,
        actorId,
        frameworkRunId,
        sourcingRunId: runId,
        queryReceipts: [],
        resultPayload,
      },
      service as never,
    ),
    { status: "dependency_unavailable" },
  );
});

test("framework execution recheck and persistence acknowledgement fail closed", async () => {
  reset();
  response = { data: { status: "allowed" }, error: null };
  assert.equal(
    await authority.checkAgentFrameworkSourcingExecution(
      { workspaceId, actorId, frameworkRunId, sourcingRunId: runId },
      service as never,
    ),
    true,
  );
  assert.equal(lastRpc?.name, "check_agent_framework_sourcing_execution");

  response = {
    data: {
      status: "completed",
      framework_run_id: frameworkRunId,
      sourcing_run_id: runId,
      result_sha256: "d".repeat(64),
    },
    error: null,
  };
  assert.equal(
    await authority.ackAgentFrameworkSourcingEffect(
      {
        workspaceId,
        actorId,
        frameworkRunId,
        capabilityToken: "s".repeat(43),
        resultSha256: "d".repeat(64),
      },
      service as never,
    ),
    true,
  );
  assert.equal(lastRpc?.name, "ack_agent_framework_sourcing_effect");

  response = { data: { status: "completed", framework_run_id: frameworkRunId }, error: null };
  assert.equal(
    await authority.ackAgentFrameworkSourcingEffect(
      {
        workspaceId,
        actorId,
        frameworkRunId,
        capabilityToken: "s".repeat(43),
        resultSha256: "d".repeat(64),
      },
      service as never,
    ),
    false,
  );
});

test("framework sourcing failure is bound to both framework and sourcing run IDs", async () => {
  reset();
  response = {
    data: {
      status: "failed",
      framework_run_id: frameworkRunId,
      sourcing_run_id: runId,
    },
    error: null,
  };
  assert.equal(
    await authority.failAgentFrameworkSourcingEffect(
      {
        workspaceId,
        actorId,
        frameworkRunId,
        sourcingRunId: runId,
        errorCode: "PROVIDER_FAILED",
      },
      service as never,
    ),
    true,
  );
  assert.equal(lastRpc?.name, "fail_agent_framework_sourcing_effect");

  response = {
    data: {
      status: "failed",
      framework_run_id: frameworkRunId,
      sourcing_run_id: "99999999-9999-4999-8999-999999999999",
    },
    error: null,
  };
  assert.equal(
    await authority.failAgentFrameworkSourcingEffect(
      {
        workspaceId,
        actorId,
        frameworkRunId,
        sourcingRunId: runId,
        errorCode: "PROVIDER_FAILED",
      },
      service as never,
    ),
    false,
  );
});
