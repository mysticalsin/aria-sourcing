import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const KEY_SHA256 = "a".repeat(64);
const RECEIPT_SHA256 = "b".repeat(64);
const EXPIRES_AT = "2026-08-20T12:00:00.000Z";

type Row = Record<string, unknown>;
type RpcCall = { name: string; args?: Record<string, unknown> };

let adminAllowed = true;
let serviceAvailable = true;
let userAvailable = true;
let workspaceResult: unknown = WORKSPACE_ID;
let workspaceResults: unknown[] = [];
let workspaceError: unknown = null;
let mutationResult: unknown = null;
let mutationError: unknown = null;
let rpcCalls: RpcCall[] = [];
let serviceQueries: Array<{
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
}> = [];
let rows: Row[] = [];

function reset() {
  adminAllowed = true;
  serviceAvailable = true;
  userAvailable = true;
  workspaceResult = WORKSPACE_ID;
  workspaceResults = [];
  workspaceError = null;
  mutationResult = null;
  mutationError = null;
  rpcCalls = [];
  serviceQueries = [];
  rows = [
    {
      id: CREDENTIAL_ID,
      label: "Workday production",
      status: "active",
      expires_at: EXPIRES_AT,
      created_at: "2026-07-21T12:00:00.000Z",
      revoked_at: null,
    },
  ];
}

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Array<[string, string, unknown]> = [];
  private columns = "";

  select(columns: string) {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  order(column: string, options?: unknown) {
    this.filters.push(["order", column, options]);
    return this;
  }

  limit(value: number) {
    this.filters.push(["limit", "rows", value]);
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    serviceQueries.push({ table: "need_ingress_credentials", select: this.columns, filters: [...this.filters] });
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

const session = {
  auth: {
    getUser: async () => ({
      data: { user: userAvailable ? { id: ACTOR_ID } : null },
      error: null,
    }),
  },
  rpc: async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === "current_workspace_id") {
      return {
        data: workspaceResults.length > 0 ? workspaceResults.shift() : workspaceResult,
        error: workspaceError,
      };
    }
    return { data: mutationResult, error: mutationError };
  },
};

const service = { from: () => new Query() };

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => (serviceAvailable ? service : null),
    requireAdmin: async () =>
      adminAllowed
        ? { ok: true, role: "admin" }
        : { ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) },
  },
});

const route = await import("../src/app/api/admin/need-ingress/credentials/route");

function request(
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  options: { origin?: string; contentType?: string; rawBody?: string } = {},
) {
  const headers = new Headers({
    "x-real-ip": crypto.randomUUID(),
    accept: "application/json",
  });
  if (method !== "GET") {
    headers.set("content-type", options.contentType ?? "application/json");
    headers.set("origin", options.origin ?? "http://localhost");
  }
  return new NextRequest("http://localhost/api/admin/need-ingress/credentials", {
    method,
    headers,
    body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

test("GET returns only exact tenant non-secret credential metadata", async () => {
  reset();
  const response = await route.GET(request("GET"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    credentials: [
      {
        id: CREDENTIAL_ID,
        label: "Workday production",
        status: "active",
        expiresAt: EXPIRES_AT,
        createdAt: "2026-07-21T12:00:00.000Z",
        revokedAt: null,
      },
    ],
  });
  assert.deepEqual(serviceQueries, [
    {
      table: "need_ingress_credentials",
      select: "id,label,status,expires_at,created_at,revoked_at",
      filters: [
        ["eq", "workspace_id", WORKSPACE_ID],
        ["order", "status", { ascending: true }],
        ["order", "expires_at", { ascending: false }],
        ["order", "created_at", { ascending: false }],
        ["limit", "rows", 100],
      ],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(await (await route.GET(request("GET"))).json()), /key_sha256|created_by|revoked_by/i);
});

test("GET fails closed when tenant authority changes during the service-role read", async () => {
  reset();
  workspaceResults = [WORKSPACE_ID, OTHER_WORKSPACE_ID];

  const response = await route.GET(request("GET"));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "NEED_INGRESS_AUTHORITY_CHANGED",
    error: "Need ingress credential authority changed during the request.",
  });
  assert.deepEqual(serviceQueries[0]?.filters[0], ["eq", "workspace_id", WORKSPACE_ID]);
});

test("every operation fails closed before tenant data when admin authority is absent", async () => {
  reset();
  adminAllowed = false;
  assert.equal((await route.GET(request("GET"))).status, 403);
  assert.equal(
    (await route.POST(request("POST", {
      label: "Workday production",
      keySha256: KEY_SHA256,
      expiresAt: EXPIRES_AT,
      requestId: REQUEST_ID,
    }))).status,
    403,
  );
  assert.deepEqual(serviceQueries, []);
  assert.deepEqual(rpcCalls, []);
});

test("GET rejects malformed database metadata instead of reflecting it", async () => {
  reset();
  rows = [{ ...rows[0], key_sha256: KEY_SHA256 }];
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "NEED_INGRESS_CREDENTIALS_UNAVAILABLE",
    error: "Need ingress credential metadata is invalid.",
  });
});

test("POST rejects non-JSON and cross-origin mutations before RPC execution", async () => {
  reset();
  assert.equal(
    (await route.POST(request("POST", {}, { contentType: "text/plain" }))).status,
    415,
  );
  assert.equal(
    (await route.POST(request("POST", {}, { origin: "https://attacker.example" }))).status,
    403,
  );
  assert.deepEqual(rpcCalls, []);
});

test("POST sends only the strict lowercase digest and actor-bound arguments to the authenticated RPC", async () => {
  reset();
  mutationResult = {
    status: "created",
    replay: false,
    credential_id: CREDENTIAL_ID,
    workspace_id: WORKSPACE_ID,
    label: "Workday production",
    expires_at: EXPIRES_AT,
    receipt_sha256: RECEIPT_SHA256,
  };
  const response = await route.POST(request("POST", {
    label: "Workday production",
    keySha256: KEY_SHA256,
    expiresAt: EXPIRES_AT,
    requestId: REQUEST_ID,
  }));

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const responseBody = await response.json();
  assert.deepEqual(responseBody, {
    ok: true,
    status: "created",
    replay: false,
    credential: {
      id: CREDENTIAL_ID,
      label: "Workday production",
      status: "active",
      expiresAt: EXPIRES_AT,
    },
    receiptSha256: RECEIPT_SHA256,
  });
  assert.deepEqual(rpcCalls, [
    { name: "current_workspace_id", args: undefined },
    {
      name: "create_need_ingress_credential",
      args: {
        p_label: "Workday production",
        p_key_sha256: KEY_SHA256,
        p_expires_at: EXPIRES_AT,
        p_request_id: REQUEST_ID,
        p_expected_workspace_id: WORKSPACE_ID,
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(responseBody), /aria_need_v1_/);
});

test("POST rejects unknown fields, malformed hashes, oversized bodies, and expirations beyond 90 days", async () => {
  reset();
  const base = {
    label: "Workday production",
    keySha256: KEY_SHA256,
    expiresAt: EXPIRES_AT,
    requestId: REQUEST_ID,
  };
  assert.equal((await route.POST(request("POST", { ...base, rawCredential: "aria_need_v1_secret" }))).status, 400);
  assert.equal((await route.POST(request("POST", { ...base, keySha256: KEY_SHA256.toUpperCase() }))).status, 400);
  assert.equal(
    (await route.POST(request("POST", { ...base, expiresAt: "2099-01-01T00:00:00.000Z" }))).status,
    400,
  );
  assert.equal(
    (await route.POST(request("POST", undefined, { rawBody: JSON.stringify({ ...base, padding: "x".repeat(4_000) }) }))).status,
    413,
  );
  assert.equal(rpcCalls.filter((call) => call.name === "create_need_ingress_credential").length, 0);
});

test("POST maps typed conflicts and rejects malformed RPC success data", async () => {
  reset();
  mutationResult = { status: "key_conflict" };
  const body = {
    label: "Workday production",
    keySha256: KEY_SHA256,
    expiresAt: EXPIRES_AT,
    requestId: REQUEST_ID,
  };
  assert.equal((await route.POST(request("POST", body))).status, 409);

  reset();
  mutationResult = { status: "workspace_conflict" };
  const changed = await route.POST(request("POST", body));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "NEED_INGRESS_AUTHORITY_CHANGED");

  reset();
  mutationResult = { status: "active_limit_reached" };
  const limited = await route.POST(request("POST", body));
  assert.equal(limited.status, 409);
  assert.equal((await limited.json()).code, "NEED_INGRESS_CREDENTIAL_LIMIT_REACHED");

  reset();
  mutationResult = { status: "created", credential_id: CREDENTIAL_ID, raw: "unexpected" };
  assert.equal((await route.POST(request("POST", body))).status, 503);
});

test("DELETE revokes through the authenticated session RPC and maps lifecycle statuses", async () => {
  reset();
  mutationResult = {
    status: "revoked",
    replay: false,
    credential_id: CREDENTIAL_ID,
    workspace_id: WORKSPACE_ID,
    receipt_sha256: RECEIPT_SHA256,
  };
  const response = await route.DELETE(request("DELETE", {
    credentialId: CREDENTIAL_ID,
    requestId: REQUEST_ID,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "revoked",
    replay: false,
    credentialId: CREDENTIAL_ID,
    receiptSha256: RECEIPT_SHA256,
  });
  assert.deepEqual(rpcCalls, [
    { name: "current_workspace_id", args: undefined },
    {
      name: "revoke_need_ingress_credential",
      args: {
        p_credential_id: CREDENTIAL_ID,
        p_request_id: REQUEST_ID,
        p_expected_workspace_id: WORKSPACE_ID,
      },
    },
  ]);

  reset();
  mutationResult = { status: "not_found" };
  assert.equal(
    (await route.DELETE(request("DELETE", { credentialId: CREDENTIAL_ID, requestId: REQUEST_ID }))).status,
    404,
  );

  reset();
  mutationResult = { status: "already_revoked" };
  assert.equal(
    (await route.DELETE(request("DELETE", { credentialId: CREDENTIAL_ID, requestId: REQUEST_ID }))).status,
    409,
  );

  reset();
  mutationResult = { status: "workspace_conflict" };
  const changed = await route.DELETE(request("DELETE", {
    credentialId: CREDENTIAL_ID,
    requestId: REQUEST_ID,
  }));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "NEED_INGRESS_AUTHORITY_CHANGED");
});
