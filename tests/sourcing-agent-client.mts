import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeReviewedSourcing,
  completeReviewedSourcingOperation,
  markReviewedSourcingOperationPersisted,
  requestReviewedSourcing,
} from "../src/lib/sourcing/sourcing-agent-client";

const sourcingRunId = "55555555-5555-4555-8555-555555555555";
const resultSha256 = "c".repeat(64);

function success(campaignId: string, idempotencyKey: string, runId = sourcingRunId) {
  return {
    ok: true,
    mode: "deterministic",
    campaignId,
    campaignFingerprint: "reviewed-campaign-fingerprint",
    candidates: [],
    totalFound: 0,
    requestId: idempotencyKey,
    idempotencyKey,
    sourcingRunId: runId,
    sourcingResultSha256: resultSha256,
    appliedLessonIds: [],
    feedbackReceipts: [{
      receiptId: "00000000-0000-4000-8000-000000000001",
      platform: "GitHub",
      candidateCount: 0,
    }],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("concurrent campaign calls share one in-flight request and operation ID", async () => {
  const campaignId = "client-concurrent";
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const requestIds: string[] = [];
  const workspaceFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const idempotencyKey = String(new Headers(init?.headers).get("idempotency-key"));
    requestIds.push(idempotencyKey);
    await blocked;
    return json(success(campaignId, idempotencyKey));
  }) as typeof fetch;

  const first = requestReviewedSourcing(workspaceFetch, campaignId, 1);
  const second = requestReviewedSourcing(workspaceFetch, campaignId, 1);
  assert.equal(requestIds.length, 1);
  release?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, secondResult);
  assert.equal(requestIds.length, 1);
  assert.equal(firstResult.ok, true);
  completeReviewedSourcingOperation(campaignId, requestIds[0]);
});

test("persistence retry fetches the database-staged result with the same operation ID", async () => {
  const campaignId = "client-staged-retry";
  const requestIds: string[] = [];
  const workspaceFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const idempotencyKey = String(new Headers(init?.headers).get("idempotency-key"));
    requestIds.push(idempotencyKey);
    return json(success(campaignId, idempotencyKey));
  }) as typeof fetch;

  const first = await requestReviewedSourcing(workspaceFetch, campaignId, 1);
  const retry = await requestReviewedSourcing(workspaceFetch, campaignId, 1);

  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(requestIds.length, 2, "the client must not cache candidate payloads");
  assert.equal(requestIds[0], requestIds[1], "the staged-result lookup must keep exact idempotency");
  completeReviewedSourcingOperation(campaignId, requestIds[0]);
});

test("a lost acknowledgement response is retried exactly and then permits a fresh batch", async () => {
  const campaignId = "client-lost-ack";
  let sourcingCalls = 0;
  let acknowledgementCalls = 0;
  const requestIds: string[] = [];
  const workspaceFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/ack")) {
      acknowledgementCalls += 1;
      if (acknowledgementCalls === 1) throw new Error("response lost after commit");
      return json({ ok: true, status: "completed", sourcingRunId, resultSha256 });
    }
    sourcingCalls += 1;
    const idempotencyKey = String(new Headers(init?.headers).get("idempotency-key"));
    requestIds.push(idempotencyKey);
    const runId = sourcingCalls === 1
      ? sourcingRunId
      : "66666666-6666-4666-8666-666666666666";
    return json(success(campaignId, idempotencyKey, runId));
  }) as typeof fetch;

  const first = await requestReviewedSourcing(workspaceFetch, campaignId, 1);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  markReviewedSourcingOperationPersisted(
    campaignId,
    first.value.idempotencyKey,
    first.value.sourcingRunId,
    first.value.sourcingResultSha256 ?? "",
  );

  const fresh = await requestReviewedSourcing(workspaceFetch, campaignId, 1);
  assert.equal(fresh.ok, true);
  assert.equal(acknowledgementCalls, 2);
  assert.equal(sourcingCalls, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
  if (fresh.ok) completeReviewedSourcingOperation(campaignId, fresh.value.idempotencyKey);
});

test("acknowledgement replay uses no mutable client state", async () => {
  let calls = 0;
  const workspaceFetch = (async () => {
    calls += 1;
    return json({ ok: true, status: "completed", sourcingRunId, resultSha256 });
  }) as typeof fetch;

  assert.equal(await acknowledgeReviewedSourcing(
    workspaceFetch,
    { sourcingRunId },
    resultSha256,
  ), true);
  assert.equal(await acknowledgeReviewedSourcing(
    workspaceFetch,
    { sourcingRunId },
    resultSha256,
  ), true);
  assert.equal(calls, 2);
});
