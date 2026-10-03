import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const campaignId = "campaign-1";
const requestKey = "44444444-4444-4444-8444-444444444444";
const erasureRequestId = "55555555-5555-4555-8555-555555555555";
const obligationId = "66666666-6666-4666-8666-666666666666";

let adminAllowed = true;
let productionBlock: Response | null = null;
let rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
let rpcResult: unknown = completedResult();
let rpcError: unknown = null;

function completedResult(): Record<string, unknown> {
  return {
    status: "completed",
    request_id: erasureRequestId,
    campaign_id: campaignId,
    candidate_id: candidateId,
    replayed: false,
    scrub_counts: {
      workspace_state: 1,
      messages_outbound: 2,
      messages_inbound: 1,
    },
    obligations: [],
  };
}

const session = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_workspace_id" ? workspaceId : null,
    error: null,
  }),
};

const service = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: rpcResult, error: rpcError };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => productionBlock },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => adminAllowed
      ? { ok: true, role: "admin" }
      : {
          ok: false,
          response: NextResponse.json({ ok: false }, { status: 403 }),
        },
  },
});

const route = await import("../src/app/api/admin/candidates/erasure/route");

function request(body: unknown, options: {
  origin?: string | null;
  contentType?: string;
  idempotencyKey?: string | null;
} = {}) {
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "x-request-id": "candidate-erasure-http-1",
    "x-real-ip": "127.0.0.1",
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost");
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? requestKey);
  }
  return new NextRequest("http://localhost/api/admin/candidates/erasure", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/admin/candidates/erasure", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin,
      "x-request-id": "candidate-erasure-patch-1",
      "x-real-ip": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

function queueRequest() {
  return new NextRequest("http://localhost/api/admin/candidates/erasure", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-request-id": "candidate-erasure-queue-1",
      "x-real-ip": "127.0.0.1",
    },
    body: JSON.stringify({ action: "list" }),
  });
}

function payload() {
  return { campaignId, candidateId };
}

function reset() {
  adminAllowed = true;
  productionBlock = null;
  rpcCalls = [];
  rpcResult = completedResult();
  rpcError = null;
}

test("candidate erasure binds exact tenant, actor, candidate, campaign, and idempotency authority", async () => {
  reset();
  const response = await route.POST(request(payload()));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(rpcCalls, [{
    name: "request_candidate_erasure",
    args: {
      p_workspace_id: workspaceId,
      p_actor_id: userId,
      p_campaign_id: campaignId,
      p_candidate_id: candidateId,
      p_request_key: requestKey,
    },
  }]);
  assert.deepEqual(body, {
    ok: true,
    completed: true,
    status: "completed",
    requestId: erasureRequestId,
    campaignId,
    candidateId,
    replayed: false,
    scrubCounts: {
      workspace_state: 1,
      messages_outbound: 2,
      messages_inbound: 1,
    },
    obligations: [],
  });
  assert.equal(JSON.stringify(body).includes("@"), false);
});

test("candidate erasure never reports completed while provider work remains", async () => {
  reset();
  rpcResult = {
    ...completedResult(),
    status: "manual_required",
    obligations: [{ id: obligationId, provider: "apollo", status: "manual_required", attemptCount: 0 }],
  };
  let response = await route.POST(request(payload()));
  let body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.completed, false);
  assert.equal(body.status, "manual_required");

  rpcResult = {
    ...completedResult(),
    status: "retryable_failure",
    obligations: [{ id: obligationId, provider: "whatsapp", status: "retryable_failure", attemptCount: 1 }],
  };
  response = await route.POST(request(payload()));
  body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.completed, false);
  assert.equal(body.status, "retryable_failure");
});

test("legal holds, cross-tenant misses, and replay conflicts are typed failures", async () => {
  reset();
  rpcResult = {
    status: "blocked_legal_hold",
    request_id: erasureRequestId,
    campaign_id: campaignId,
    candidate_id: candidateId,
    replayed: false,
    scrub_counts: {},
    obligations: [],
  };
  let response = await route.POST(request(payload()));
  assert.equal(response.status, 423);
  assert.equal((await response.json()).code, "candidate_erasure_blocked_legal_hold");

  rpcResult = { status: "not_found" };
  response = await route.POST(request(payload()));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "candidate_not_found");

  rpcResult = { status: "idempotency_conflict" };
  response = await route.POST(request(payload()));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "idempotency_conflict");
});

test("same-origin JSON, administrator authority, and UUID idempotency fail before database mutation", async () => {
  reset();
  assert.equal((await route.POST(request(payload(), { origin: "https://attacker.test" }))).status, 403);
  assert.equal((await route.POST(request(payload(), { contentType: "text/plain" }))).status, 415);
  assert.equal((await route.POST(request(payload(), { idempotencyKey: null }))).status, 400);
  assert.equal((await route.POST(request(payload(), { idempotencyKey: "not-a-uuid" }))).status, 400);
  adminAllowed = false;
  assert.equal((await route.POST(request(payload()))).status, 403);
  assert.equal(rpcCalls.length, 0);
});

test("candidate erasure dependency failures are non-cacheable and never imply completion", async () => {
  reset();
  productionBlock = new Response(null, { status: 503 });
  let response = await route.POST(request(payload()));
  let body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.completed, false);
  assert.equal(response.headers.get("cache-control"), "no-store");

  reset();
  rpcError = new Error("database unavailable");
  response = await route.POST(request(payload()));
  body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "candidate_erasure_unavailable");
  assert.equal(body.completed, false);
});

test("provider obligation overflow is a typed conflict and never implies completion", async () => {
  reset();
  rpcError = {
    code: "54000",
    message: "candidate erasure provider obligation limit exceeded",
  };
  const response = await route.POST(request(payload()));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "candidate_erasure_obligation_limit_exceeded");
  assert.equal(body.completed, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("durable candidate erasure queue resumes non-final requests after reload", async () => {
  reset();
  rpcResult = [{
    ...completedResult(),
    status: "manual_required",
    obligations: [{ id: obligationId, provider: "linkedin", status: "manual_required", attemptCount: 0 }],
  }];
  const response = await route.PATCH(queueRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.requests[0].completed, false);
  assert.equal(body.requests[0].obligations[0].id, obligationId);
  assert.deepEqual(rpcCalls, [{
    name: "list_candidate_erasure_requests",
    args: { p_workspace_id: workspaceId, p_actor_id: userId, p_limit: 100 },
  }]);
});

test("GET is side-effect free and directs queue clients to the protected PATCH contract", async () => {
  reset();
  const response = await route.GET(new NextRequest(
    "http://localhost/api/admin/candidates/erasure",
    { method: "GET", headers: { "x-request-id": "candidate-erasure-get-1" } },
  ));
  const body = await response.json();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, PATCH");
  assert.equal(body.code, "invalid_request");
  assert.deepEqual(rpcCalls, []);
});

test("administrator can inspect one encrypted provider authority without exposing it in queue responses", async () => {
  reset();
  rpcResult = {
    status: "manual_required",
    obligation_id: obligationId,
    provider: "linkedin",
    attempt_count: 0,
    reference: {
      kind: "message_record",
      recordId: "77777777-7777-4777-8777-777777777777",
      direction: "outbound",
      channel: "linkedin",
      providerMessageId: "provider-message-1",
    },
  };
  const response = await route.PATCH(patchRequest({ action: "inspect", obligationId }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reference.providerMessageId, "provider-message-1");
  assert.deepEqual(rpcCalls, [{
    name: "read_candidate_erasure_obligation_authority",
    args: { p_workspace_id: workspaceId, p_actor_id: userId, p_obligation_id: obligationId },
  }]);
});

test("a late legal hold blocks both authority inspection and completion with a typed response", async () => {
  reset();
  rpcResult = { status: "blocked_legal_hold" };

  let response = await route.PATCH(patchRequest({ action: "inspect", obligationId }));
  let body = await response.json();
  assert.equal(response.status, 423);
  assert.equal(body.code, "candidate_erasure_blocked_legal_hold");
  assert.equal(body.completed, false);

  response = await route.PATCH(patchRequest({
    action: "complete",
    obligationId,
    expectedAttemptCount: 0,
    evidenceSha256: "a".repeat(64),
    caseReference: "case:blocked-by-late-hold",
  }));
  body = await response.json();
  assert.equal(response.status, 423);
  assert.equal(body.code, "candidate_erasure_blocked_legal_hold");
  assert.equal(body.completed, false);
});

test("evidence-bound manual completion remains non-final until every obligation is complete", async () => {
  reset();
  rpcResult = {
    ...completedResult(),
    status: "manual_required",
    obligations: [{ id: obligationId, provider: "email", status: "manual_required", attemptCount: 0 }],
  };
  const response = await route.PATCH(patchRequest({
    action: "complete",
    obligationId,
    expectedAttemptCount: 0,
    evidenceSha256: "a".repeat(64),
    caseReference: "case:provider-1",
  }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.completed, false);
  assert.deepEqual(rpcCalls, [{
    name: "reconcile_candidate_erasure_obligation",
    args: {
      p_workspace_id: workspaceId,
      p_actor_id: userId,
      p_obligation_id: obligationId,
      p_expected_attempt_count: 0,
      p_status: "completed",
      p_error_code: null,
      p_evidence_sha256: "a".repeat(64),
      p_case_reference: "case:provider-1",
    },
  }]);
});
