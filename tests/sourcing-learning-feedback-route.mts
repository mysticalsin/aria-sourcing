import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const receiptId = "33333333-3333-4333-8333-333333333333";

let user: { id: string } | null = { id: userId };
let role: "admin" | "member" | "viewer" = "member";
let authorityResult: { status: string; feedbackId?: string } = {
  status: "recorded",
  feedbackId: "44444444-4444-4444-8444-444444444444",
};
let pendingResult: { status: string; receipts?: unknown[] } = {
  status: "ready",
  receipts: [{ receiptId, platform: "GitHub", candidateCount: 0 }],
};
let authorityCalls = 0;
let authorityInput: Record<string, unknown> | null = null;
let sequence = 0;

const session = {
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : workspaceId,
    error: null,
  }),
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    prodFailClosed: () => null,
    supabaseEnabled: true,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: { getServerSupabase: async () => session },
});
mock.module(moduleUrl("src/lib/sourcing/learning-authority.ts"), {
  namedExports: {
    listPendingSourcingFeedback: async (input: Record<string, unknown>) => {
      authorityCalls += 1;
      authorityInput = input;
      return pendingResult;
    },
    recordSourcingQueryFeedback: async (input: Record<string, unknown>) => {
      authorityCalls += 1;
      authorityInput = input;
      return authorityResult;
    },
  },
});

const route = await import("../src/app/api/sourcing-learning/feedback/route");

function reset() {
  user = { id: userId };
  role = "member";
  authorityResult = {
    status: "recorded",
    feedbackId: "44444444-4444-4444-8444-444444444444",
  };
  pendingResult = {
    status: "ready",
    receipts: [{ receiptId, platform: "GitHub", candidateCount: 0 }],
  };
  authorityCalls = 0;
  authorityInput = null;
}

function pendingRequest(campaignId = "campaign-1") {
  return new NextRequest(
    `http://localhost/api/sourcing-learning/feedback?campaignId=${encodeURIComponent(campaignId)}`,
    {
      method: "GET",
      headers: {
        "x-request-id": `pending-${++sequence}`,
        "x-real-ip": `203.0.113.${sequence}`,
      },
    },
  );
}

test("pending aggregate feedback survives reload and remains actor scoped", async () => {
  reset();
  const response = await route.GET(pendingRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.receipts, [{ receiptId, platform: "GitHub", candidateCount: 0 }]);
  assert.deepEqual(authorityInput, {
    workspaceId,
    actorId: userId,
    campaignId: "campaign-1",
    limit: 20,
  });
});

test("pending feedback listing requires a valid campaign and source authority", async () => {
  reset();
  assert.equal((await route.GET(pendingRequest(""))).status, 400);
  assert.equal(authorityCalls, 0);

  reset();
  role = "viewer";
  assert.equal((await route.GET(pendingRequest())).status, 403);
  assert.equal(authorityCalls, 0);
});

function request(
  body: unknown = { receiptId, verdict: "useful" },
  options: { origin?: string; idempotencyKey?: string; contentType?: string } = {},
) {
  return new NextRequest("http://localhost/api/sourcing-learning/feedback", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? "http://localhost",
      "idempotency-key":
        options.idempotencyKey ?? "55555555-5555-4555-8555-555555555555",
      "x-request-id": `feedback-${++sequence}`,
      "x-real-ip": `198.51.100.${sequence}`,
    },
    body: JSON.stringify(body),
  });
}

test("authenticated sourcers can record one aggregate feedback receipt", async () => {
  reset();
  const response = await route.POST(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    receiptId,
    verdict: "useful",
    requestId: `feedback-${sequence}`,
  });
  assert.equal(authorityCalls, 1);
  assert.deepEqual(authorityInput, {
    workspaceId,
    actorId: userId,
    receiptId,
    verdict: "useful",
    requestId: "55555555-5555-4555-8555-555555555555",
  });
});

test("cross-origin, invalid media, malformed bodies, and missing replay keys fail before authority", async () => {
  reset();
  assert.equal((await route.POST(request(undefined, { origin: "https://attacker.test" }))).status, 403);
  assert.equal((await route.POST(request(undefined, { contentType: "text/plain" }))).status, 415);
  assert.equal((await route.POST(request({ receiptId: "bad", verdict: "useful" }))).status, 400);
  assert.equal((await route.POST(request(undefined, { idempotencyKey: "bad" }))).status, 400);
  assert.equal(authorityCalls, 0);
});

test("authentication and live source permission are required", async () => {
  reset();
  user = null;
  assert.equal((await route.POST(request())).status, 401);
  assert.equal(authorityCalls, 0);

  reset();
  role = "viewer";
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(authorityCalls, 0);
});

test("not-found, conflicting, invalid, and unavailable receipts map to bounded errors", async () => {
  for (const [status, expectedHttp, expectedCode] of [
    ["not_found", 404, "FEEDBACK_RECEIPT_NOT_FOUND"],
    ["idempotency_conflict", 409, "FEEDBACK_CONFLICT"],
    ["feedback_conflict", 409, "FEEDBACK_CONFLICT"],
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["dependency_unavailable", 503, "SOURCING_LEARNING_UNAVAILABLE"],
  ] as const) {
    reset();
    authorityResult = { status };
    const response = await route.POST(request());
    const body = await response.json();
    assert.equal(response.status, expectedHttp);
    assert.equal(body.code, expectedCode);
    assert.equal(String(body.error).includes("database"), false);
  }
});
