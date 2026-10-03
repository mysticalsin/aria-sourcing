import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const targetId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const campaignId = "campaign-1";
const eventId = "44444444-4444-4444-8444-444444444444";

let productionBlock: Response | null = null;
let dependencyError = false;
let adminAllowed = true;
let erasureCalls = 0;
let erasureResult: Record<string, unknown> = {
  status: "erased",
  targetId,
  clearedReceipts: 1,
  cancelledAttempts: 0,
  eventId,
};
let lastInput: Record<string, unknown> | null = null;

const session = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_workspace_id" ? workspaceId : null,
    error: null,
  }),
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => productionBlock },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      if (dependencyError) throw new Error("simulated auth dependency exception");
      return session;
    },
    requireAdmin: async () =>
      adminAllowed
        ? { ok: true, role: "admin" }
        : {
            ok: false,
            response: NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 }),
          },
  },
});
mock.module(moduleUrl("src/lib/sourcing/source-authority.ts"), {
  namedExports: {
    eraseApolloEnrichmentTarget: async (input: Record<string, unknown>) => {
      erasureCalls += 1;
      lastInput = input;
      return erasureResult;
    },
  },
});

const route = await import("../src/app/api/admin/source/apollo/erasure/route");
const post = ((route as any).POST ?? (route as any).default?.POST) as (
  request: NextRequest,
) => Promise<Response>;

function request(body: unknown, origin = "http://localhost", contentType = "application/json") {
  return new NextRequest("http://localhost/api/admin/source/apollo/erasure", {
    method: "POST",
    headers: {
      "content-type": contentType,
      origin,
      "x-request-id": "erase-request-1",
      "x-real-ip": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function payload() {
  return { campaignId, candidateId, targetId };
}

function reset() {
  productionBlock = null;
  dependencyError = false;
  adminAllowed = true;
  erasureCalls = 0;
  lastInput = null;
  erasureResult = {
    status: "erased",
    targetId,
    clearedReceipts: 1,
    cancelledAttempts: 0,
    eventId,
  };
}

test("admin erasure binds exact workspace, campaign, candidate, and target", async () => {
  reset();
  const response = await post(request(payload()));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(lastInput, {
    workspaceId,
    userId,
    campaignId,
    candidateId,
    targetId,
    caseReference: `candidate-erasure:${candidateId}`,
    requestId: "erase-request-1",
  });
  assert.deepEqual(body, {
    ok: true,
    campaignId,
    candidateId,
    targetId,
    clearedReceipts: 1,
    cancelledAttempts: 0,
    eventId,
  });
});

test("cross-origin, malformed media, non-admin, and malformed bindings fail before erasure", async () => {
  reset();
  assert.equal((await post(request(payload(), "https://attacker.test"))).status, 403);
  assert.equal((await post(request(payload(), "http://localhost", "application/jsonp"))).status, 415);
  adminAllowed = false;
  assert.equal((await post(request(payload()))).status, 403);
  adminAllowed = true;
  assert.equal((await post(request({ ...payload(), candidateId: "not-a-uuid" }))).status, 400);
  assert.equal(erasureCalls, 0);
});

test("erasure failures remain typed and non-cacheable", async () => {
  reset();
  productionBlock = new Response("blocked", { status: 503 });
  let response = await post(request(payload()));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "APOLLO_ERASURE_UNAVAILABLE");
  assert.equal(response.headers.get("cache-control"), "no-store");

  reset();
  dependencyError = true;
  response = await post(request(payload()));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "APOLLO_ERASURE_UNAVAILABLE");

  reset();
  erasureResult = { status: "not_found" };
  response = await post(request(payload()));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "APOLLO_TARGET_NOT_FOUND");
});
