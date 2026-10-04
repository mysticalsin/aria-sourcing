import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";

let productionBlock: Response | null = null;
let authDependencyError = false;
let adminAllowed = true;
let listCalls = 0;
let reconcileCalls = 0;
let encryptionMissing = false;
let listed: Record<string, unknown>[] | null = [];
let reconciled: Record<string, unknown> = {
  status: "reconciled",
  attemptId,
  attemptStatus: "completed",
  version: 2,
  eventId,
};
let lastReconcileInput: Record<string, unknown> | null = null;

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
      if (authDependencyError) throw new Error("simulated auth dependency exception");
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
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: {
    encryptionRequiredButMissing: () => encryptionMissing,
    encryptSecret: (value: string) => (value ? `encrypted:${value}` : ""),
  },
});
mock.module(moduleUrl("src/lib/sourcing/source-authority.ts"), {
  namedExports: {
    listApolloEnrichmentReconciliation: async () => {
      listCalls += 1;
      return listed;
    },
    reconcileApolloEnrichment: async (input: Record<string, unknown>) => {
      reconcileCalls += 1;
      lastReconcileInput = input;
      return reconciled;
    },
  },
});

const routeModule = await import("../src/app/api/admin/source/apollo/reconciliation/route");
const post = ((routeModule as any).POST ?? (routeModule as any).default?.POST) as (
  request: NextRequest,
) => Promise<Response>;

function request(body: unknown, origin = "http://localhost", contentType = "application/json") {
  return new NextRequest("http://localhost/api/admin/source/apollo/reconciliation", {
    method: "POST",
    headers: {
      "content-type": contentType,
      origin,
      "x-request-id": crypto.randomUUID(),
      "x-real-ip": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function reset() {
  productionBlock = null;
  authDependencyError = false;
  adminAllowed = true;
  listCalls = 0;
  reconcileCalls = 0;
  encryptionMissing = false;
  listed = [];
  reconciled = {
    status: "reconciled",
    attemptId,
    attemptStatus: "completed",
    version: 2,
    eventId,
  };
  lastReconcileInput = null;
}

test("production fail-closed preserves the typed non-cacheable admin contract", async () => {
  reset();
  productionBlock = new Response("blocked", { status: 503 });
  const response = await post(request({ operation: "list", limit: 20 }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "APOLLO_RECONCILIATION_UNAVAILABLE");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(listCalls, 0);
});

test("dependency exceptions preserve the typed non-cacheable admin contract", async () => {
  reset();
  authDependencyError = true;
  const response = await post(request({ operation: "list", limit: 20 }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "APOLLO_RECONCILIATION_UNAVAILABLE");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(listCalls, 0);
});

test("cross-origin and non-admin requests cannot read the queue", async () => {
  reset();
  const crossOrigin = await post(request({ operation: "list", limit: 20 }, "https://attacker.test"));
  assert.equal(crossOrigin.status, 403);
  assert.equal(listCalls, 0);

  adminAllowed = false;
  const member = await post(request({ operation: "list", limit: 20 }));
  assert.equal(member.status, 403);
  assert.equal(listCalls, 0);
});

test("JSON prefix media types are rejected before admin authority work", async () => {
  reset();
  const response = await post(
    request({ operation: "list", limit: 20 }, "http://localhost", "application/jsonp"),
  );
  const body = await response.json();
  assert.equal(response.status, 415);
  assert.equal(body.code, "INVALID_REQUEST");
  assert.equal(listCalls, 0);
});

test("admin list returns only the bounded investigation queue", async () => {
  reset();
  listed = [
    {
      attemptId,
      targetId,
      providerExternalId: "apollo-person-1",
      requesterId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "ambiguous",
      version: 2,
      requestId: "claim-request-1",
      createdAt: "2026-07-13T08:00:00.000Z",
      leaseExpiresAt: "2026-07-13T08:02:00.000Z",
      ambiguousAt: "2026-07-13T08:00:20.000Z",
    },
  ];
  const response = await post(request({ operation: "list", limit: 20 }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(listCalls, 1);
  assert.equal(body.items[0].providerExternalId, "apollo-person-1");
  assert.equal(JSON.stringify(body).includes("emailSecret"), false);
  assert.equal(JSON.stringify(body).includes("confirmationNonce"), false);
  assert.equal(JSON.stringify(body).includes("idempotencyKey"), false);
});

test("complete-found encrypts one validated email before the service RPC", async () => {
  reset();
  const response = await post(request({
    operation: "reconcile",
    attemptId,
    expectedVersion: 2,
    resolution: "complete_found",
    email: "Person@Example.Test",
    caseReference: "INC-2026-0713",
    evidenceSha256: "a".repeat(64),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "completed");
  assert.equal(body.eventId, eventId);
  assert.equal(reconcileCalls, 1);
  assert.equal(lastReconcileInput?.emailSecret, "encrypted:person@example.test");
  assert.equal(lastReconcileInput?.action, "complete_found");
  assert.equal(JSON.stringify(body).includes("person@example.test"), false);
});

test("invalid evidence, missing email, and missing encryption fail before reconciliation", async () => {
  reset();
  const missingEmail = await post(request({
    operation: "reconcile",
    attemptId,
    expectedVersion: 2,
    resolution: "complete_found",
    caseReference: "INC-2026-0713",
    evidenceSha256: "a".repeat(64),
  }));
  assert.equal(missingEmail.status, 400);
  assert.equal(reconcileCalls, 0);

  encryptionMissing = true;
  const noEncryption = await post(request({
    operation: "reconcile",
    attemptId,
    expectedVersion: 2,
    resolution: "complete_found",
    email: "person@example.test",
    caseReference: "INC-2026-0713",
    evidenceSha256: "a".repeat(64),
  }));
  assert.equal(noEncryption.status, 503);
  assert.equal(reconcileCalls, 0);
});

test("state races, lease gates, foreign attempts, and dependencies are typed", async () => {
  for (const [status, expectedHttp, expectedCode] of [
    ["conflict", 409, "APOLLO_RECONCILIATION_CONFLICT"],
    ["not_stale", 409, "APOLLO_ATTEMPT_NOT_STALE"],
    ["not_found", 404, "APOLLO_ATTEMPT_NOT_FOUND"],
    ["dependency_unavailable", 503, "APOLLO_RECONCILIATION_UNAVAILABLE"],
  ] as const) {
    reset();
    reconciled = { status };
    const response = await post(request({
      operation: "reconcile",
      attemptId,
      expectedVersion: 2,
      resolution: "complete_not_found",
      caseReference: "INC-2026-0713",
      evidenceSha256: "a".repeat(64),
    }));
    const body = await response.json();
    assert.equal(response.status, expectedHttp);
    assert.equal(body.code, expectedCode);
  }
});
