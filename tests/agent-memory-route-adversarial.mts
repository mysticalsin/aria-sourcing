import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const disabledScenario = process.env.ARIA_TEST_MEMORY_SUPABASE_DISABLED === "1";

const origin = "http://localhost";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const specId = "33333333-3333-4333-8333-333333333333";
const memoryId = "44444444-4444-4444-8444-444444444444";

type QueryCall = {
  table: string;
  operation: string;
  column?: string;
  value?: unknown;
};

type MemoryRow = {
  id: string;
  spec_id: string;
  kind: string;
  content_ciphertext: string;
  content_sha256: string;
  content_byte_count: number;
  revision: number;
  status: string;
  source_type: string;
  pinned: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const specRow = { id: specId, name: "Staff platform sourcing", status: "active" };
const plaintextByCiphertext = new Map<string, string>();

let sessionAvailable = true;
let sessionThrows = false;
let authDependencyError = false;
let serviceAvailable = true;
let encryptionMissing = false;
let encryptionEnabled = true;
let ownedSpecAvailable = true;
let ownedSpecDependencyError = false;
let activeMemory: MemoryRow | null = null;
let listedSpecs: Array<{
  id: string;
  name: string;
  status: string;
  created_at: string;
}> | null = null;
let listedMemories: MemoryRow[] | null = null;
let mutateStatus = "updated";
let cipherSequence = 0;
let sessionReads = 0;
let serviceReads = 0;
let authReads = 0;
let sessionRpcCalls: string[] = [];
let queryCalls: QueryCall[] = [];
let serviceRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let encryptCalls: string[] = [];
let decryptCalls: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function memoryRow(
  ciphertext: string,
  contentSha256: string,
  contentByteCount: number,
  overrides: Partial<MemoryRow> = {},
): MemoryRow {
  return {
    id: memoryId,
    spec_id: specId,
    kind: "instruction",
    content_ciphertext: ciphertext,
    content_sha256: contentSha256,
    content_byte_count: contentByteCount,
    revision: 1,
    status: "pending_review",
    source_type: "operator",
    pinned: false,
    expires_at: null,
    created_at: "2026-07-14T12:00:00.000Z",
    updated_at: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function singleResult(table: string) {
  if (table === "agent_specs") {
    if (ownedSpecDependencyError) {
      return { data: null, error: { message: "agent spec dependency unavailable" } };
    }
    return { data: ownedSpecAvailable ? specRow : null, error: null };
  }
  if (table === "agent_memories") return { data: activeMemory, error: null };
  return { data: null, error: { message: `unexpected table ${table}` } };
}

function listResult(table: string) {
  if (table === "agent_specs") {
    return {
      data: listedSpecs ?? (ownedSpecAvailable ? [specRow] : []),
      error: null,
    };
  }
  if (table === "agent_memories") {
    return { data: listedMemories ?? (activeMemory ? [activeMemory] : []), error: null };
  }
  return { data: null, error: { message: `unexpected table ${table}` } };
}

function queryFor(table: string) {
  queryCalls.push({ table, operation: "from" });
  const query: Record<string, unknown> = {};
  const chain = (operation: string, column?: string, value?: unknown) => {
    queryCalls.push({ table, operation, column, value });
    return query;
  };
  query.select = (columns: string) => chain("select", undefined, columns);
  query.eq = (column: string, value: unknown) => chain("eq", column, value);
  query.neq = (column: string, value: unknown) => chain("neq", column, value);
  query.is = (column: string, value: unknown) => chain("is", column, value);
  query.in = (column: string, value: unknown) => chain("in", column, value);
  query.or = (value: string) => chain("or", undefined, value);
  query.order = (column: string, value: unknown) => chain("order", column, value);
  query.limit = (value: number) => chain("limit", undefined, value);
  query.maybeSingle = async () => {
    queryCalls.push({ table, operation: "maybeSingle" });
    return singleResult(table);
  };
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(listResult(table)).then(resolve, reject);
  return query;
}

const session = {
  auth: {
    getUser: async () => {
      authReads += 1;
      if (authDependencyError) {
        return {
          data: { user: { id: ownerId } },
          error: { message: "authentication dependency unavailable" },
        };
      }
      return { data: { user: { id: ownerId } }, error: null };
    },
  },
  rpc: async (name: string) => {
    sessionRpcCalls.push(name);
    if (name === "current_workspace_id") return { data: workspaceId, error: null };
    if (name === "current_profile_role") return { data: "member", error: null };
    return { data: null, error: { message: `unexpected session RPC ${name}` } };
  },
};

const service = {
  from: (table: string) => queryFor(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    serviceRpcCalls.push({ name, args });
    if (name === "create_agent_memory") {
      activeMemory = memoryRow(
        String(args.p_content_ciphertext),
        String(args.p_content_sha256),
        Number(args.p_content_byte_count),
        {
          kind: String(args.p_kind),
          pinned: Boolean(args.p_pinned),
          expires_at: args.p_expires_at === null ? null : String(args.p_expires_at),
        },
      );
      return { data: { status: "created", id: memoryId }, error: null };
    }
    if (name === "mutate_agent_memory") {
      return { data: { status: mutateStatus }, error: null };
    }
    if (name === "delete_agent_memory_content") {
      return { data: { status: "deleted", revision: 2 }, error: null };
    }
    return { data: null, error: { message: `unexpected service RPC ${name}` } };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: !disabledScenario, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      sessionReads += 1;
      if (sessionThrows) throw new Error("session dependency unavailable");
      return sessionAvailable ? session : null;
    },
    getServiceSupabase: () => {
      serviceReads += 1;
      return serviceAvailable ? service : null;
    },
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: {
    encryptionRequiredButMissing: () => encryptionMissing,
    secretEncryptionEnabled: () => encryptionEnabled,
    encryptSecret: (plaintext: string) => {
      encryptCalls.push(plaintext);
      cipherSequence += 1;
      const ciphertext = `enc:v2:opaque-${cipherSequence}`;
      plaintextByCiphertext.set(ciphertext, plaintext);
      return ciphertext;
    },
    decryptSecret: (ciphertext: string) => {
      decryptCalls.push(ciphertext);
      return plaintextByCiphertext.get(ciphertext) ?? "";
    },
  },
});
mock.module(moduleUrl("src/lib/rate-limit.ts"), {
  namedExports: {
    checkRateLimit: () => ({ ok: true, retryAfterSec: 0 }),
    rateLimitKey: () => "agent-memory-route-adversarial",
  },
});
mock.module(moduleUrl("src/lib/rbac.ts"), {
  namedExports: {
    can: (role: string, permission: string) => role === "member" && permission === "skills",
  },
});

const route = await import("../src/app/api/agents/memories/route");

function reset() {
  sessionAvailable = true;
  sessionThrows = false;
  authDependencyError = false;
  serviceAvailable = true;
  encryptionMissing = false;
  encryptionEnabled = true;
  ownedSpecAvailable = true;
  ownedSpecDependencyError = false;
  activeMemory = null;
  listedSpecs = null;
  listedMemories = null;
  mutateStatus = "updated";
  cipherSequence = 0;
  sessionReads = 0;
  serviceReads = 0;
  authReads = 0;
  sessionRpcCalls = [];
  queryCalls = [];
  serviceRpcCalls = [];
  encryptCalls = [];
  decryptCalls = [];
  plaintextByCiphertext.clear();
}

function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  options: { origin?: string | null; contentType?: string } = {},
) {
  const headers = new Headers({ "x-request-id": "memory-route-adversarial" });
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (method !== "GET") headers.set("content-type", options.contentType ?? "application/json");
  return new NextRequest(`${origin}/api/agents/memories`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

function assertNoAuthorityOrPersistenceWork() {
  assert.equal(sessionReads, 0);
  assert.equal(serviceReads, 0);
  assert.equal(authReads, 0);
  assert.deepEqual(sessionRpcCalls, []);
  assert.deepEqual(queryCalls, []);
  assert.deepEqual(serviceRpcCalls, []);
  assert.deepEqual(encryptCalls, []);
}

if (disabledScenario) {
  test("Supabase-disabled memory authority fails closed before session access", async () => {
    reset();
    const response = await route.POST(request("POST", {
      specId,
      kind: "instruction",
      content: "Do not contact suppressed candidates.",
    }));
    const body = await json(response);
    assert.equal(response.status, 503);
    assert.equal(body.code, "memory_authority_unavailable");
    assertNoStore(response);
    assertNoAuthorityOrPersistenceWork();
  });
} else {
  test("POST rejects hostile or missing origins and non-JSON before authority work", async () => {
    for (const [label, options, expectedStatus, expectedCode] of [
      ["hostile origin", { origin: "https://attacker.example" }, 403, "cross_origin_request"],
      ["missing origin", { origin: null }, 403, "cross_origin_request"],
      ["non-JSON", { contentType: "text/plain" }, 415, "invalid_request"],
      ["JSON prefix", { contentType: "application/jsonp" }, 415, "invalid_request"],
    ] as const) {
      reset();
      const response = await route.POST(request("POST", {
        specId,
        kind: "fact",
        content: "secret",
      }, options));
      const body = await json(response);
      assert.equal(response.status, expectedStatus, label);
      assert.equal(body.code, expectedCode, label);
      assertNoStore(response);
      assertNoAuthorityOrPersistenceWork();
    }
  });

  test("PATCH and DELETE enforce the same pre-auth mutation boundary", async () => {
    const bodies = {
      PATCH: { action: "approve", id: memoryId, specId, revision: 1 },
      DELETE: { id: memoryId, specId, revision: 1 },
    } as const;
    for (const method of ["PATCH", "DELETE"] as const) {
      for (const [label, options, expectedStatus, expectedCode] of [
        ["hostile origin", { origin: "https://attacker.example" }, 403, "cross_origin_request"],
        ["missing origin", { origin: null }, 403, "cross_origin_request"],
        ["non-JSON", { contentType: "text/plain" }, 415, "invalid_request"],
      ] as const) {
        reset();
        const response = await route[method](request(method, bodies[method], options));
        const body = await json(response);
        assert.equal(response.status, expectedStatus, `${method}: ${label}`);
        assert.equal(body.code, expectedCode, `${method}: ${label}`);
        assertNoStore(response);
        assertNoAuthorityOrPersistenceWork();
      }
    }
  });

  test("disabled Supabase fails closed before session access", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        fileURLToPath(import.meta.url),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ARIA_TEST_MEMORY_SUPABASE_DISABLED: "1" },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  test("missing session, service authority, or encryption fails closed", async () => {
    const cases: Array<[string, () => void]> = [
      ["session", () => { sessionAvailable = false; }],
      ["session exception", () => { sessionThrows = true; }],
      ["service authority", () => { serviceAvailable = false; }],
      ["required encryption key", () => { encryptionMissing = true; }],
      ["encryption facility", () => { encryptionEnabled = false; }],
    ];
    for (const [label, arrange] of cases) {
      reset();
      arrange();
      const response = await route.POST(request("POST", {
        specId,
        kind: "instruction",
        content: "Use only reviewed role requirements.",
      }));
      const body = await json(response);
      assert.equal(response.status, 503, label);
      assert.equal(body.code, "memory_authority_unavailable", label);
      assertNoStore(response);
      assert.deepEqual(serviceRpcCalls, [], label);
      assert.deepEqual(encryptCalls, [], label);
    }
  });

  test("authentication lookup errors fail closed instead of becoming unauthenticated", async () => {
    reset();
    authDependencyError = true;
    const response = await route.POST(request("POST", {
      specId,
      kind: "instruction",
      content: "Use only reviewed role requirements.",
    }));
    const body = await json(response);
    assert.equal(response.status, 503);
    assert.equal(body.code, "memory_authority_unavailable");
    assertNoStore(response);
    assert.deepEqual(sessionRpcCalls, []);
    assert.equal(serviceReads, 0);
    assert.deepEqual(queryCalls, []);
    assert.deepEqual(serviceRpcCalls, []);
    assert.deepEqual(encryptCalls, []);
  });

  test("owned AgentSpec dependency errors are 503 for every route", async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ["GET", () => route.GET(new NextRequest(
        `${origin}/api/agents/memories?specId=${specId}`,
        { method: "GET", headers: { "x-request-id": "memory-spec-dependency-get" } },
      ))],
      ["POST", () => route.POST(request("POST", {
        specId,
        kind: "fact",
        content: "Reviewed role fact.",
      }))],
      ["PATCH", () => route.PATCH(request("PATCH", {
        action: "approve",
        id: memoryId,
        specId,
        revision: 1,
      }))],
      ["DELETE", () => route.DELETE(request("DELETE", {
        id: memoryId,
        specId,
        revision: 1,
      }))],
    ];

    for (const [method, invoke] of cases) {
      reset();
      ownedSpecDependencyError = true;
      const response = await invoke();
      const body = await json(response);
      assert.equal(response.status, 503, method);
      assert.equal(body.code, "memory_authority_unavailable", method);
      assertNoStore(response);
      assert.deepEqual(serviceRpcCalls, [], method);
      assert.deepEqual(encryptCalls, [], method);
    }
  });

  test("create scopes lookups, encrypts server-side, and exposes no storage secrets", async () => {
    reset();
    const content = "Use only role requirements approved by the hiring manager.";
    const response = await route.POST(request("POST", {
      specId,
      kind: "instruction",
      content,
      pinned: true,
      expiresAt: null,
    }));
    const body = await json(response);

    assert.equal(response.status, 201);
    assertNoStore(response);
    assert.equal(response.headers.get("location"), `/api/agents/memories?specId=${specId}`);
    assert.deepEqual(encryptCalls, [content]);
    assert.equal(serviceRpcCalls.length, 1);
    const create = serviceRpcCalls[0];
    assert.equal(create.name, "create_agent_memory");
    assert.equal(create.args.p_workspace_id, workspaceId);
    assert.equal(create.args.p_owner_id, ownerId);
    assert.equal(create.args.p_spec_id, specId);
    assert.equal(create.args.p_actor_id, ownerId);
    assert.match(String(create.args.p_content_ciphertext), /^enc:v2:opaque-/);
    assert.equal(create.args.p_content_sha256, sha256(content));
    assert.equal(create.args.p_content_byte_count, Buffer.byteLength(content, "utf8"));
    assert.equal(JSON.stringify(create.args).includes(content), false);
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "eq")
        .map((call) => [call.table, call.column, call.value]),
      [
        ["agent_specs", "workspace_id", workspaceId],
        ["agent_specs", "owner_id", ownerId],
        ["agent_specs", "id", specId],
        ["agent_memories", "workspace_id", workspaceId],
        ["agent_memories", "owner_id", ownerId],
        ["agent_memories", "spec_id", specId],
        ["agent_memories", "id", memoryId],
      ],
    );
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("content_ciphertext"), false);
    assert.equal(serialized.includes("content_sha256"), false);
    assert.equal(serialized.includes("content_byte_count"), false);
    assert.equal(serialized.includes("enc:v2:"), false);
    assert.equal((body.memory as Record<string, unknown>).content, content);
  });

  test("GET uses exact tenant filters and returns an explicit public memory shape", async () => {
    reset();
    const content = "Prefer candidates with production incident leadership.";
    const ciphertext = "enc:v2:opaque-read";
    plaintextByCiphertext.set(ciphertext, content);
    activeMemory = memoryRow(
      ciphertext,
      sha256(content),
      Buffer.byteLength(content, "utf8"),
      { revision: 7, status: "approved", pinned: true },
    );
    const response = await route.GET(new NextRequest(
      `${origin}/api/agents/memories?specId=${specId}`,
      { method: "GET", headers: { "x-request-id": "memory-read-adversarial" } },
    ));
    const body = await json(response);

    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.deepEqual(body.specs, [specRow]);
    assert.deepEqual(body.memories, [{
      id: memoryId,
      specId,
      kind: "instruction",
      content,
      revision: 7,
      status: "approved",
      sourceType: "operator",
      pinned: true,
      expiresAt: null,
      createdAt: "2026-07-14T12:00:00.000Z",
      updatedAt: "2026-07-14T12:00:00.000Z",
    }]);
    assert.deepEqual(body.bounds, {
      specLimit: 100,
      specsTruncated: false,
    });
    assert.equal(body.nextCursor, null);
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "eq")
        .map((call) => [call.table, call.column, call.value]),
      [
        ["agent_specs", "workspace_id", workspaceId],
        ["agent_specs", "owner_id", ownerId],
        ["agent_specs", "id", specId],
        ["agent_memories", "workspace_id", workspaceId],
        ["agent_memories", "owner_id", ownerId],
        ["agent_memories", "spec_id", specId],
      ],
    );
    assert.equal(queryCalls.some((call) => call.operation === "in"), false);
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "order")
        .map((call) => [call.table, call.column, call.value]),
      [
        ["agent_memories", "created_at", { ascending: false }],
        ["agent_memories", "id", { ascending: false }],
      ],
    );
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "limit")
        .map((call) => [call.table, call.value]),
      [["agent_memories", 26]],
    );
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("content_ciphertext"), false);
    assert.equal(serialized.includes("content_sha256"), false);
    assert.equal(serialized.includes("content_byte_count"), false);
    assert.equal(serialized.includes(ciphertext), false);
  });

  test("GET lists AgentSpecs separately and never applies a global memory truncation", async () => {
    reset();
    const specIds = Array.from({ length: 101 }, (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    listedSpecs = specIds.map((id, index) => ({
      id,
      name: `Agent ${index + 1}`,
      status: "active",
      created_at: "2026-07-14T12:00:00.000Z",
    }));

    const response = await route.GET(request("GET"));
    const body = await json(response);
    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.equal((body.specs as unknown[]).length, 100);
    assert.deepEqual(body.memories, []);
    assert.equal(body.nextCursor, null);
    assert.equal(typeof body.nextSpecCursor, "string");
    assert.deepEqual(body.bounds, {
      specLimit: 100,
      specsTruncated: true,
    });
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "limit")
        .map((call) => [call.table, call.value]),
      [["agent_specs", 101]],
    );
    assert.equal(queryCalls.some((call) => call.table === "agent_memories"), false);
    assert.deepEqual(decryptCalls, []);
    assert.equal(JSON.stringify(body).includes(specIds[100]), false);
  });

  test("GET keyset pages AgentSpecs without overlap or omission across timestamp ties", async () => {
    reset();
    const rows = Array.from({ length: 102 }, (_, index) => ({
      id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Paged Agent ${index + 1}`,
      status: "active",
      created_at: index < 100
        ? "2026-07-14T12:00:00.000Z"
        : "2026-07-14T13:00:00.000Z",
    }));
    listedSpecs = rows.slice(0, 101);

    const firstResponse = await route.GET(request("GET"));
    const first = await json(firstResponse);
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(
      (first.specs as Array<{ id: string }>).map((entry) => entry.id),
      rows.slice(0, 100).map((entry) => entry.id),
    );
    assert.equal(typeof first.nextSpecCursor, "string");
    assert.equal(String(first.nextSpecCursor).length > 0, true);
    assert.equal(first.nextCursor, null);
    assert.deepEqual(first.bounds, { specLimit: 100, specsTruncated: true });
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "order")
        .map((call) => [call.table, call.column, call.value]),
      [
        ["agent_specs", "created_at", { ascending: true }],
        ["agent_specs", "id", { ascending: true }],
      ],
    );
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "limit")
        .map((call) => [call.table, call.value]),
      [["agent_specs", 101]],
    );

    queryCalls = [];
    listedSpecs = rows.slice(100);
    const secondResponse = await route.GET(new NextRequest(
      `${origin}/api/agents/memories?specCursor=${encodeURIComponent(String(first.nextSpecCursor))}`,
      { method: "GET", headers: { "x-request-id": "spec-page-two" } },
    ));
    const second = await json(secondResponse);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(
      (second.specs as Array<{ id: string }>).map((entry) => entry.id),
      rows.slice(100).map((entry) => entry.id),
    );
    assert.equal(second.nextSpecCursor, null);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(second.bounds, { specLimit: 100, specsTruncated: false });

    const combined = [
      ...(first.specs as Array<{ id: string }>),
      ...(second.specs as Array<{ id: string }>),
    ].map((entry) => entry.id);
    assert.deepEqual(combined, rows.map((entry) => entry.id));
    assert.equal(new Set(combined).size, rows.length);
    const keyset = queryCalls.find((call) => call.operation === "or")?.value;
    assert.equal(typeof keyset, "string");
    assert.match(String(keyset), /created_at\.gt\.2026-07-14T12:00:00\.000Z/);
    assert.match(String(keyset), /created_at\.eq\.2026-07-14T12:00:00\.000Z/);
    assert.match(String(keyset), /id\.gt\.70000000-0000-4000-8000-000000000100/);
    assert.equal(queryCalls.some((call) => call.table === "agent_memories"), false);
    assert.deepEqual(decryptCalls, []);
  });

  test("GET keyset pages one exact spec without overlap or omission across timestamp ties", async () => {
    reset();
    const rows = [
      { id: "50000000-0000-4000-8000-000000000004", createdAt: "2026-07-14T14:00:00.000Z" },
      { id: "50000000-0000-4000-8000-000000000003", createdAt: "2026-07-14T13:00:00.000Z" },
      { id: "50000000-0000-4000-8000-000000000002", createdAt: "2026-07-14T13:00:00.000Z" },
      { id: "50000000-0000-4000-8000-000000000001", createdAt: "2026-07-14T12:00:00.000Z" },
    ].map(({ id, createdAt }, index) => {
      const content = `page memory ${index + 1}`;
      const ciphertext = `enc:v2:page-${index + 1}`;
      plaintextByCiphertext.set(ciphertext, content);
      return memoryRow(ciphertext, sha256(content), Buffer.byteLength(content, "utf8"), {
        id,
        created_at: createdAt,
        updated_at: createdAt,
        status: "approved",
      });
    });
    listedMemories = rows.slice(0, 3);

    const firstResponse = await route.GET(new NextRequest(
      `${origin}/api/agents/memories?specId=${specId}&limit=2`,
      { method: "GET", headers: { "x-request-id": "memory-page-one" } },
    ));
    const first = await json(firstResponse);
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(
      (first.memories as Array<{ id: string }>).map((entry) => entry.id),
      rows.slice(0, 2).map((entry) => entry.id),
    );
    assert.equal(typeof first.nextCursor, "string");
    assert.equal(String(first.nextCursor).length > 0, true);
    assert.equal(decryptCalls.includes(rows[2].content_ciphertext), false);

    queryCalls = [];
    listedMemories = rows.slice(2);
    const secondResponse = await route.GET(new NextRequest(
      `${origin}/api/agents/memories?specId=${specId}&limit=2&cursor=${encodeURIComponent(String(first.nextCursor))}`,
      { method: "GET", headers: { "x-request-id": "memory-page-two" } },
    ));
    const second = await json(secondResponse);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(
      (second.memories as Array<{ id: string }>).map((entry) => entry.id),
      rows.slice(2).map((entry) => entry.id),
    );
    assert.equal(second.nextCursor, null);

    const combined = [
      ...(first.memories as Array<{ id: string }>),
      ...(second.memories as Array<{ id: string }>),
    ].map((entry) => entry.id);
    assert.deepEqual(combined, rows.map((entry) => entry.id));
    assert.equal(new Set(combined).size, rows.length);
    const keyset = queryCalls.find((call) => call.operation === "or")?.value;
    assert.equal(typeof keyset, "string");
    assert.match(String(keyset), /created_at\.lt\.2026-07-14T13:00:00\.000Z/);
    assert.match(String(keyset), /created_at\.eq\.2026-07-14T13:00:00\.000Z/);
    assert.match(String(keyset), /id\.lt\.50000000-0000-4000-8000-000000000003/);
  });

  test("GET rejects malformed, cross-spec, and unbounded pagination inputs before authority work", async () => {
    const validSpecCursor = Buffer.from(JSON.stringify({
      v: 1,
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "70000000-0000-4000-8000-000000000100",
    }), "utf8").toString("base64url");
    for (const search of [
      `specId=${specId}&limit=0`,
      `specId=${specId}&limit=101`,
      `specId=${specId}&limit=2.5`,
      `specId=${specId}&cursor=not_base64url!`,
      `cursor=eyJ2IjoxfQ`,
      `specId=${specId}&limit=2&limit=3`,
      "specCursor=not_base64url!",
      `specId=${specId}&specCursor=${validSpecCursor}`,
      `specCursor=${validSpecCursor}&limit=2`,
      `specCursor=${validSpecCursor}&specCursor=${validSpecCursor}`,
    ]) {
      reset();
      const response = await route.GET(new NextRequest(
        `${origin}/api/agents/memories?${search}`,
        { method: "GET", headers: { "x-request-id": "memory-invalid-page" } },
      ));
      assert.equal(response.status, 400, search);
      assert.equal((await json(response)).code, "invalid_request", search);
      assertNoAuthorityOrPersistenceWork();
    }

    reset();
    const foreignSpecCursor = Buffer.from(JSON.stringify({
      v: 1,
      specId: "60000000-0000-4000-8000-000000000006",
      createdAt: "2026-07-14T13:00:00.000Z",
      id: "50000000-0000-4000-8000-000000000003",
    }), "utf8").toString("base64url");
    const response = await route.GET(new NextRequest(
      `${origin}/api/agents/memories?specId=${specId}&cursor=${foreignSpecCursor}`,
      { method: "GET", headers: { "x-request-id": "memory-cross-spec-cursor" } },
    ));
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "invalid_request");
    assertNoAuthorityOrPersistenceWork();
  });

  test("a foreign spec is indistinguishable from a missing resource", async () => {
    reset();
    ownedSpecAvailable = false;
    const response = await route.POST(request("POST", {
      specId,
      kind: "fact",
      content: "Foreign workspace data",
    }));
    const body = await json(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "memory_not_found");
    assertNoStore(response);
    assert.deepEqual(serviceRpcCalls, []);
    assert.deepEqual(encryptCalls, []);
    assert.deepEqual(
      queryCalls.filter((call) => call.operation === "eq")
        .map((call) => [call.column, call.value]),
      [["workspace_id", workspaceId], ["owner_id", ownerId], ["id", specId]],
    );
  });

  test("a stale update revision maps to a typed 409 without reading memory content", async () => {
    reset();
    mutateStatus = "revision_conflict";
    const response = await route.PATCH(request("PATCH", {
      action: "approve",
      id: memoryId,
      specId,
      revision: 3,
    }));
    const body = await json(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, "revision_conflict");
    assertNoStore(response);
    assert.equal(serviceRpcCalls.length, 1);
    assert.equal(serviceRpcCalls[0].name, "mutate_agent_memory");
    assert.equal(serviceRpcCalls[0].args.p_workspace_id, workspaceId);
    assert.equal(serviceRpcCalls[0].args.p_owner_id, ownerId);
    assert.equal(serviceRpcCalls[0].args.p_spec_id, specId);
    assert.equal(serviceRpcCalls[0].args.p_memory_id, memoryId);
    assert.equal(serviceRpcCalls[0].args.p_expected_revision, 3);
    assert.equal(queryCalls.some((call) => call.table === "agent_memories"), false);
    assert.equal(JSON.stringify(body).includes("cipher"), false);
    assert.equal(JSON.stringify(body).includes("sha256"), false);
  });

  test("UTF-8 content over 8192 bytes is a 400 and never reaches persistence", async () => {
    reset();
    const content = "é".repeat(5_000);
    assert.equal(content.length < 8192, true);
    assert.equal(Buffer.byteLength(content, "utf8") > 8192, true);
    const response = await route.POST(request("POST", {
      specId,
      kind: "episodic",
      content,
    }));
    const body = await json(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_request");
    assertNoStore(response);
    assert.deepEqual(queryCalls, []);
    assert.deepEqual(serviceRpcCalls, []);
    assert.deepEqual(encryptCalls, []);
  });
}
