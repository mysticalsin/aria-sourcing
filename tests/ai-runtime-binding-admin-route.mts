import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const ACTIVE_SET_ID = "44444444-4444-4444-8444-444444444444";
const STAGED_SET_ID = "55555555-5555-4555-8555-555555555555";
const ANTHROPIC_KEY_ID = "66666666-6666-4666-8666-666666666666";
const OPENAI_KEY_ID = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "88888888-8888-4888-8888-888888888888";
const SET_SHA = "a".repeat(64);
const RECEIPT_SHA = "b".repeat(64);
const PARSE_PROPOSAL_EVIDENCE_ID = "99999999-0001-4999-8999-999999999999";
const SOURCE_PROPOSAL_EVIDENCE_ID = "99999999-0002-4999-8999-999999999999";
const PARSE_ACTIVATION_EVIDENCE_ID = "99999999-0003-4999-8999-999999999999";
const SOURCE_ACTIVATION_EVIDENCE_ID = "99999999-0004-4999-8999-999999999999";

type Row = Record<string, unknown>;

let adminAllowed = true;
let serviceAvailable = true;
let currentWorkspace = WORKSPACE_ID;
let afterServiceRead: (() => void) | null = null;
let rpcResult: unknown = null;
let rpcError: unknown = null;
let sessionRpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
let serviceQueries: Array<{
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
}> = [];
let serviceRows: Record<string, Row[]> = {};
let adminCount = 2;
let capabilityState: "verified" | "rejected" | "unavailable" = "verified";
let capabilityCalls: Array<{
  provider: string;
  key: string;
  model: string;
  purpose: string;
}> = [];
let serviceRpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
let evidenceIds: string[] = [];

function reset() {
  adminAllowed = true;
  serviceAvailable = true;
  currentWorkspace = WORKSPACE_ID;
  afterServiceRead = null;
  rpcResult = null;
  rpcError = null;
  sessionRpcCalls = [];
  serviceQueries = [];
  serviceRpcCalls = [];
  capabilityState = "verified";
  capabilityCalls = [];
  evidenceIds = [
    PARSE_PROPOSAL_EVIDENCE_ID,
    SOURCE_PROPOSAL_EVIDENCE_ID,
    PARSE_ACTIVATION_EVIDENCE_ID,
    SOURCE_ACTIVATION_EVIDENCE_ID,
  ];
  adminCount = 2;
  serviceRows = {
    ai_provider_catalog: [
      {
        provider_slug: "anthropic",
        credential_provider: "Anthropic",
        endpoint_profile: "anthropic_messages_2023_06_01",
        supports_requisition_parse: true,
        supports_sourcing: true,
        catalog_revision: 1,
      },
      {
        provider_slug: "openai",
        credential_provider: "OpenAI",
        endpoint_profile: "openai_chat_completions_v1",
        supports_requisition_parse: true,
        supports_sourcing: true,
        catalog_revision: 1,
      },
    ],
    api_keys: [
      {
        id: ANTHROPIC_KEY_ID,
        name: "Anthropic production",
        provider: "Anthropic",
        last4: "1234",
        status: "valid",
        last_tested_at: "2026-07-21T12:00:00.000Z",
      },
      {
        id: OPENAI_KEY_ID,
        name: "OpenAI production",
        provider: "OpenAI",
        last4: "5678",
        status: "valid",
        last_tested_at: null,
      },
    ],
    ai_runtime_binding_sets: [
      {
        id: ACTIVE_SET_ID,
        status: "active",
        set_sha256: SET_SHA,
        proposed_by: OTHER_ADMIN_ID,
        proposed_at: "2026-07-20T12:00:00.000Z",
        activated_at: "2026-07-20T13:00:00.000Z",
      },
      {
        id: STAGED_SET_ID,
        status: "staged",
        set_sha256: SET_SHA,
        proposed_by: OTHER_ADMIN_ID,
        proposed_at: "2026-07-21T12:00:00.000Z",
        activated_at: null,
      },
    ],
    ai_runtime_bindings: [
      ...[ACTIVE_SET_ID, STAGED_SET_ID].flatMap((bindingSetId) => [
        {
          binding_set_id: bindingSetId,
          purpose: "requisition_parse",
          provider_slug: "anthropic",
          credential_provider: "Anthropic",
          endpoint_profile: "anthropic_messages_2023_06_01",
          catalog_revision: 1,
          model_name: "claude-sonnet-4-6",
          api_key_id: ANTHROPIC_KEY_ID,
        },
        {
          binding_set_id: bindingSetId,
          purpose: "sourcing",
          provider_slug: "openai",
          credential_provider: "OpenAI",
          endpoint_profile: "openai_chat_completions_v1",
          catalog_revision: 1,
          model_name: "gpt-4.1",
          api_key_id: OPENAI_KEY_ID,
        },
      ]),
    ],
    profiles: [],
  };
}

class Query implements PromiseLike<{ data: Row[] | null; error: null; count: number | null }> {
  private readonly filters: Array<[string, string, unknown]> = [];
  private selectColumns = "";

  constructor(private readonly table: string) {}

  select(columns: string) {
    this.selectColumns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(["in", column, values]);
    return this;
  }

  order(column: string, options?: unknown) {
    this.filters.push(["order", column, options]);
    return this;
  }

  then<TResult1 = { data: Row[] | null; error: null; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    serviceQueries.push({
      table: this.table,
      select: this.selectColumns,
      filters: [...this.filters],
    });
    const value = {
      data: this.table === "profiles"
        ? []
        : (serviceRows[this.table] ?? [])
          .filter((row) => this.filters.every(([kind, column, value]) => {
            if (!(column in row)) return true;
            if (kind === "eq") return row[column] === value;
            if (kind === "in") return Array.isArray(value) && value.includes(row[column]);
            return true;
          }))
          .map((row) => this.table === "api_keys" && this.selectColumns.includes("secret")
            ? {
                id: row.id,
                workspace_id: WORKSPACE_ID,
                provider: row.provider,
                status: row.status,
                secret: row.id === ANTHROPIC_KEY_ID
                  ? "encrypted-anthropic-secret"
                  : "encrypted-openai-secret",
              }
            : row),
      error: null,
      count: this.table === "profiles" ? adminCount : null,
    };
    if (this.table === "ai_runtime_bindings") afterServiceRead?.();
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

const session = {
  auth: {
    getUser: async () => ({ data: { user: { id: ACTOR_ID } }, error: null }),
  },
  rpc: async (name: string, args?: Record<string, unknown>) => {
    sessionRpcCalls.push({ name, args });
    if (name === "current_workspace_id") return { data: currentWorkspace, error: null };
    return { data: rpcResult, error: rpcError };
  },
};

const service = {
  from: (table: string) => new Query(table),
  rpc: async (name: string, args?: Record<string, unknown>) => {
    serviceRpcCalls.push({ name, args });
    if (name !== "record_ai_runtime_model_evidence") {
      return { data: null, error: { message: "unexpected service RPC" } };
    }
    const evidenceId = evidenceIds.shift();
    return evidenceId
      ? {
          data: {
            status: "recorded",
            evidence_id: evidenceId,
            evidence_sha256: "c".repeat(64),
          },
          error: null,
        }
      : { data: null, error: { message: "missing evidence fixture" } };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => serviceAvailable ? service : null,
    requireAdmin: async () => adminAllowed
      ? { ok: true, role: "admin" }
      : { ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) },
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: {
    decryptSecret: (value: string) => value.replace(/^encrypted-/, "decrypted-"),
  },
});
mock.module(moduleUrl("src/lib/ai/provider-key-verification.ts"), {
  namedExports: {
    isExecutionCredentialProvider: (provider: string) => [
      "Anthropic",
      "OpenAI",
      "Groq",
      "xAI",
      "Mistral",
      "Kimi (Moonshot)",
      "Tavily",
    ].includes(provider),
    verifyExecutionModelCapability: async (
      provider: string,
      key: string,
      model: string,
      purpose: string,
    ) => {
      capabilityCalls.push({ provider, key, model, purpose });
      return {
        state: capabilityState,
        method: capabilityState === "verified" ? "provider_model_capability_v1" : null,
        httpStatus: capabilityState === "unavailable" ? 503 : 200,
        detail: "bounded fixture",
      };
    },
  },
});

const route = await import("../src/app/api/admin/ai-runtime-bindings/route");

function request(
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  options: { origin?: string; idempotencyKey?: string; contentType?: string } = {},
) {
  const headers = new Headers({
    "x-request-id": crypto.randomUUID(),
    "x-real-ip": crypto.randomUUID(),
  });
  if (method !== "GET") {
    headers.set("content-type", options.contentType ?? "application/json");
    headers.set("origin", options.origin ?? "http://localhost");
    if (options.idempotencyKey !== undefined) {
      headers.set("idempotency-key", options.idempotencyKey);
    }
  }
  return new NextRequest("http://localhost/api/admin/ai-runtime-bindings", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validStageBody = {
  requisitionParse: {
    providerSlug: "anthropic",
    modelName: "claude-sonnet-4-6",
    apiKeyId: ANTHROPIC_KEY_ID,
  },
  sourcing: {
    providerSlug: "openai",
    modelName: "gpt-4.1",
    apiKeyId: OPENAI_KEY_ID,
  },
};

test("GET authenticates an admin and returns exact tenant non-secret authority metadata", async () => {
  reset();
  const response = await route.GET(request("GET"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    catalog: [
      {
        providerSlug: "anthropic",
        credentialProvider: "Anthropic",
        endpointProfile: "anthropic_messages_2023_06_01",
        supportsRequisitionParse: true,
        supportsSourcing: true,
        catalogRevision: 1,
      },
      {
        providerSlug: "openai",
        credentialProvider: "OpenAI",
        endpointProfile: "openai_chat_completions_v1",
        supportsRequisitionParse: true,
        supportsSourcing: true,
        catalogRevision: 1,
      },
    ],
    keys: [
      {
        id: ANTHROPIC_KEY_ID,
        name: "Anthropic production",
        provider: "Anthropic",
        last4: "1234",
        status: "valid",
        lastTestedAt: "2026-07-21T12:00:00.000Z",
      },
      {
        id: OPENAI_KEY_ID,
        name: "OpenAI production",
        provider: "OpenAI",
        last4: "5678",
        status: "valid",
        lastTestedAt: null,
      },
    ],
    activeSet: {
      id: ACTIVE_SET_ID,
      status: "active",
      setSha256: SET_SHA,
      proposedAt: "2026-07-20T12:00:00.000Z",
      activatedAt: "2026-07-20T13:00:00.000Z",
      bindings: [
        {
          purpose: "requisition_parse",
          providerSlug: "anthropic",
          credentialProvider: "Anthropic",
          endpointProfile: "anthropic_messages_2023_06_01",
          catalogRevision: 1,
          modelName: "claude-sonnet-4-6",
          apiKeyId: ANTHROPIC_KEY_ID,
          credentialAvailable: true,
        },
        {
          purpose: "sourcing",
          providerSlug: "openai",
          credentialProvider: "OpenAI",
          endpointProfile: "openai_chat_completions_v1",
          catalogRevision: 1,
          modelName: "gpt-4.1",
          apiKeyId: OPENAI_KEY_ID,
          credentialAvailable: true,
        },
      ],
    },
    stagedSets: [{
      id: STAGED_SET_ID,
      status: "staged",
      setSha256: SET_SHA,
      proposedAt: "2026-07-21T12:00:00.000Z",
      activatedAt: null,
      proposedBySelf: false,
      canActivate: true,
      bindings: [
        {
          purpose: "requisition_parse",
          providerSlug: "anthropic",
          credentialProvider: "Anthropic",
          endpointProfile: "anthropic_messages_2023_06_01",
          catalogRevision: 1,
          modelName: "claude-sonnet-4-6",
          apiKeyId: ANTHROPIC_KEY_ID,
          credentialAvailable: true,
        },
        {
          purpose: "sourcing",
          providerSlug: "openai",
          credentialProvider: "OpenAI",
          endpointProfile: "openai_chat_completions_v1",
          catalogRevision: 1,
          modelName: "gpt-4.1",
          apiKeyId: OPENAI_KEY_ID,
          credentialAvailable: true,
        },
      ],
    }],
    adminCount: 2,
    self: {
      hasStagedProposal: false,
      canActivate: true,
    },
  });

  assert.deepEqual(serviceQueries, [
    {
      table: "ai_provider_catalog",
      select: "provider_slug,credential_provider,endpoint_profile,supports_requisition_parse,supports_sourcing,catalog_revision",
      filters: [["order", "provider_slug", undefined]],
    },
    {
      table: "api_keys",
      select: "id,name,provider,last4,status,last_tested_at",
      filters: [
        ["eq", "workspace_id", WORKSPACE_ID],
        ["eq", "status", "valid"],
        ["order", "provider", { ascending: true }],
        ["order", "name", { ascending: true }],
      ],
    },
    {
      table: "ai_runtime_binding_sets",
      select: "id,status,set_sha256,proposed_by,proposed_at,activated_at",
      filters: [
        ["eq", "workspace_id", WORKSPACE_ID],
        ["in", "status", ["active", "staged"]],
        ["order", "proposed_at", { ascending: false }],
      ],
    },
    {
      table: "profiles",
      select: "id",
      filters: [
        ["eq", "workspace_id", WORKSPACE_ID],
        ["eq", "role", "admin"],
      ],
    },
    {
      table: "ai_runtime_bindings",
      select: "binding_set_id,purpose,provider_slug,credential_provider,endpoint_profile,catalog_revision,model_name,api_key_id",
      filters: [
        ["eq", "workspace_id", WORKSPACE_ID],
        ["in", "binding_set_id", [ACTIVE_SET_ID, STAGED_SET_ID]],
        ["order", "purpose", { ascending: true }],
      ],
    },
  ]);
  assert.equal(JSON.stringify(body).includes(ACTOR_ID), false);
  assert.equal(JSON.stringify(body).includes(OTHER_ADMIN_ID), false);
  assert.equal(JSON.stringify(body).includes("secret"), false);
});

test("GET fails closed for a non-admin, missing service reader, or malformed database rows", async () => {
  reset();
  adminAllowed = false;
  assert.equal((await route.GET(request("GET"))).status, 403);
  assert.equal(serviceQueries.length, 0);

  reset();
  serviceAvailable = false;
  assert.equal((await route.GET(request("GET"))).status, 503);

  reset();
  serviceRows.ai_provider_catalog[0].unexpected = "must fail strict validation";
  assert.equal((await route.GET(request("GET"))).status, 503);
});

test("GET derives self-review and credential availability without exposing identities", async () => {
  reset();
  adminCount = 1;
  serviceRows.ai_runtime_binding_sets[1].proposed_by = ACTOR_ID;
  serviceRows.api_keys = serviceRows.api_keys.filter((key) => key.id !== OPENAI_KEY_ID);

  const response = await route.GET(request("GET"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.adminCount, 1);
  assert.deepEqual(body.self, { hasStagedProposal: true, canActivate: false });
  assert.equal(body.stagedSets[0].proposedBySelf, true);
  assert.equal(body.stagedSets[0].canActivate, false);
  assert.equal(
    body.stagedSets[0].bindings.find((binding: { purpose: string }) => binding.purpose === "sourcing").credentialAvailable,
    false,
  );
  assert.equal(JSON.stringify(body).includes(ACTOR_ID), false);
});

test("GET revalidates admin and tenant authority before returning service-role reads", async () => {
  reset();
  afterServiceRead = () => {
    currentWorkspace = "99999999-9999-4999-8999-999999999999";
  };
  const response = await route.GET(request("GET"));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "AI_RUNTIME_AUTHORITY_CHANGED");
  assert.equal(JSON.stringify(body).includes("Anthropic production"), false);
});

test("POST rejects unsafe requests before staging and calls only the authenticated session RPC", async () => {
  reset();
  assert.equal((await route.POST(request("POST", validStageBody, {
    origin: "https://attacker.example",
    idempotencyKey: IDEMPOTENCY_KEY,
  }))).status, 403);
  assert.equal(sessionRpcCalls.length, 0);

  reset();
  adminAllowed = false;
  assert.equal((await route.POST(request("POST", validStageBody, {
    idempotencyKey: IDEMPOTENCY_KEY,
  }))).status, 403);
  assert.equal(sessionRpcCalls.length, 0);

  reset();
  assert.equal((await route.POST(request("POST", validStageBody, {
    idempotencyKey: "not-a-uuid",
  }))).status, 400);
  assert.equal(sessionRpcCalls.length, 0);

  reset();
  assert.equal((await route.POST(request("POST", {
    ...validStageBody,
    actorId: OTHER_ADMIN_ID,
  }, { idempotencyKey: IDEMPOTENCY_KEY }))).status, 400);
  assert.deepEqual(sessionRpcCalls.map((call) => call.name), ["current_workspace_id"]);

  reset();
  rpcResult = {
    status: "staged",
    replay: false,
    binding_set_id: STAGED_SET_ID,
    set_sha256: SET_SHA,
    receipt_sha256: RECEIPT_SHA,
  };
  const response = await route.POST(request("POST", validStageBody, {
    idempotencyKey: IDEMPOTENCY_KEY,
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "staged",
    replayed: false,
    bindingSetId: STAGED_SET_ID,
    setSha256: SET_SHA,
    receiptSha256: RECEIPT_SHA,
  });
  assert.deepEqual(sessionRpcCalls, [
    { name: "current_workspace_id", args: undefined },
    {
      name: "stage_ai_runtime_binding_set",
      args: {
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_parse_provider_slug: "anthropic",
        p_parse_model_name: "claude-sonnet-4-6",
        p_parse_api_key_id: ANTHROPIC_KEY_ID,
        p_parse_model_evidence_id: PARSE_PROPOSAL_EVIDENCE_ID,
        p_sourcing_provider_slug: "openai",
        p_sourcing_model_name: "gpt-4.1",
        p_sourcing_api_key_id: OPENAI_KEY_ID,
        p_sourcing_model_evidence_id: SOURCE_PROPOSAL_EVIDENCE_ID,
        p_expected_workspace_id: WORKSPACE_ID,
      },
    },
  ]);
  assert.deepEqual(capabilityCalls, [
    {
      provider: "Anthropic",
      key: "decrypted-anthropic-secret",
      model: "claude-sonnet-4-6",
      purpose: "requisition_parse",
    },
    {
      provider: "OpenAI",
      key: "decrypted-openai-secret",
      model: "gpt-4.1",
      purpose: "sourcing",
    },
  ]);
  assert.deepEqual(serviceRpcCalls.map((call) => call.name), [
    "record_ai_runtime_model_evidence",
    "record_ai_runtime_model_evidence",
  ]);
});

test("POST refuses a listed but purpose-incompatible or unavailable exact model before staging", async () => {
  for (const [state, expectedStatus, expectedCode] of [
    ["rejected", 409, "AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE"],
    ["unavailable", 503, "AI_RUNTIME_MODEL_VERIFICATION_UNAVAILABLE"],
  ] as const) {
    reset();
    capabilityState = state;
    const response = await route.POST(request("POST", {
      ...validStageBody,
      sourcing: { ...validStageBody.sourcing, modelName: "text-embedding-3-large" },
    }, { idempotencyKey: IDEMPOTENCY_KEY }));
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).code, expectedCode);
    assert.equal(sessionRpcCalls.some((call) => call.name === "stage_ai_runtime_binding_set"), false);
    assert.equal(serviceRpcCalls.length, 0);
  }
});

test("POST maps typed authority statuses without exposing database errors", async () => {
  const cases: Array<[string, number, string]> = [
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["provider_unsupported", 400, "AI_RUNTIME_PROVIDER_UNSUPPORTED"],
    ["credential_unavailable", 409, "AI_RUNTIME_CREDENTIAL_UNAVAILABLE"],
    ["idempotency_conflict", 409, "AI_RUNTIME_IDEMPOTENCY_CONFLICT"],
    ["authority_invalid", 409, "AI_RUNTIME_AUTHORITY_INVALID"],
    ["workspace_conflict", 409, "AI_RUNTIME_AUTHORITY_CHANGED"],
    ["staged_limit_reached", 409, "AI_RUNTIME_STAGED_LIMIT_REACHED"],
  ];
  for (const [status, expectedHttp, expectedCode] of cases) {
    reset();
    rpcResult = { status };
    const response = await route.POST(request("POST", validStageBody, {
      idempotencyKey: IDEMPOTENCY_KEY,
    }));
    assert.equal(response.status, expectedHttp);
    assert.equal((await response.json()).code, expectedCode);
  }

  reset();
  rpcError = { message: "secret database detail", code: "XX000" };
  const response = await route.POST(request("POST", validStageBody, {
    idempotencyKey: IDEMPOTENCY_KEY,
  }));
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes("secret database detail"), false);
});

test("PATCH activates through the authenticated session RPC and enforces four-eyes outcomes", async () => {
  reset();
  rpcResult = {
    status: "activated",
    replay: false,
    binding_set_id: STAGED_SET_ID,
    set_sha256: SET_SHA,
    receipt_sha256: RECEIPT_SHA,
  };
  const response = await route.PATCH(request("PATCH", {
    bindingSetId: STAGED_SET_ID,
  }, { idempotencyKey: IDEMPOTENCY_KEY }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "activated",
    replayed: false,
    bindingSetId: STAGED_SET_ID,
    setSha256: SET_SHA,
    receiptSha256: RECEIPT_SHA,
  });
  assert.deepEqual(sessionRpcCalls, [
    { name: "current_workspace_id", args: undefined },
    {
      name: "activate_ai_runtime_binding_set",
      args: {
        p_binding_set_id: STAGED_SET_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_parse_model_evidence_id: PARSE_PROPOSAL_EVIDENCE_ID,
        p_sourcing_model_evidence_id: SOURCE_PROPOSAL_EVIDENCE_ID,
        p_expected_workspace_id: WORKSPACE_ID,
      },
    },
  ]);
  assert.deepEqual(capabilityCalls.map(({ provider, model, purpose }) => ({
    provider,
    model,
    purpose,
  })), [
    { provider: "Anthropic", model: "claude-sonnet-4-6", purpose: "requisition_parse" },
    { provider: "OpenAI", model: "gpt-4.1", purpose: "sourcing" },
  ]);
  assert.equal(serviceRpcCalls.length, 2);

  for (const [status, expectedHttp, expectedCode] of [
    ["not_found", 404, "AI_RUNTIME_BINDING_SET_NOT_FOUND"],
    ["independent_reviewer_required", 409, "AI_RUNTIME_INDEPENDENT_REVIEW_REQUIRED"],
    ["credential_unavailable", 409, "AI_RUNTIME_CREDENTIAL_UNAVAILABLE"],
    ["idempotency_conflict", 409, "AI_RUNTIME_IDEMPOTENCY_CONFLICT"],
    ["authority_invalid", 409, "AI_RUNTIME_AUTHORITY_INVALID"],
    ["workspace_conflict", 409, "AI_RUNTIME_AUTHORITY_CHANGED"],
  ] as const) {
    reset();
    rpcResult = { status };
    const failed = await route.PATCH(request("PATCH", {
      bindingSetId: STAGED_SET_ID,
    }, { idempotencyKey: IDEMPOTENCY_KEY }));
    assert.equal(failed.status, expectedHttp);
    assert.equal((await failed.json()).code, expectedCode);
  }
});

test("PATCH re-probes both exact staged models and refuses activation when either capability is gone", async () => {
  reset();
  capabilityState = "rejected";
  const response = await route.PATCH(request("PATCH", {
    bindingSetId: STAGED_SET_ID,
  }, { idempotencyKey: IDEMPOTENCY_KEY }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE");
  assert.equal(sessionRpcCalls.some((call) => call.name === "activate_ai_runtime_binding_set"), false);
  assert.equal(serviceRpcCalls.length, 0);
  assert.deepEqual(capabilityCalls.map((call) => call.purpose).sort(), [
    "requisition_parse",
    "sourcing",
  ]);
});
