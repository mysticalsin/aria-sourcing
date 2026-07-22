import assert from "node:assert/strict";
import test from "node:test";

import { resolveActiveAiRuntimeBinding } from "../src/lib/ai/runtime-binding";
import {
  verifyExecutionCredential,
  verifyExecutionModelCapability,
} from "../src/lib/ai/provider-key-verification";

const WORKSPACE_ID = "b1000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "b2000000-0000-4000-8000-000000000002";

function configured(overrides: Record<string, unknown> = {}) {
  return {
    status: "configured",
    workspace_id: WORKSPACE_ID,
    binding_set_id: "d1000000-0000-4000-8000-000000000001",
    set_sha256: "a".repeat(64),
    binding_id: "e1000000-0000-4000-8000-000000000001",
    purpose: "requisition_parse",
    provider_slug: "anthropic",
    credential_provider: "Anthropic",
    endpoint_profile: "anthropic_messages_2023_06_01",
    model_name: "claude-sonnet-4-6",
    api_key_id: "c1000000-0000-4000-8000-000000000001",
    catalog_revision: 1,
    config_sha256: "b".repeat(64),
    ...overrides,
  };
}

test("resolves a validated active binding through the service-only RPC", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      return { data: configured(), error: null };
    },
  };

  const result = await resolveActiveAiRuntimeBinding(client, WORKSPACE_ID, "requisition_parse");

  assert.deepEqual(calls, [{
    name: "resolve_active_ai_runtime_binding",
    params: { p_workspace_id: WORKSPACE_ID, p_purpose: "requisition_parse" },
  }]);
  assert.deepEqual(result, {
    ok: true,
    binding: {
      workspaceId: WORKSPACE_ID,
      bindingSetId: "d1000000-0000-4000-8000-000000000001",
      setSha256: "a".repeat(64),
      bindingId: "e1000000-0000-4000-8000-000000000001",
      purpose: "requisition_parse",
      provider: "anthropic",
      credentialProvider: "Anthropic",
      endpointProfile: "anthropic_messages_2023_06_01",
      model: "claude-sonnet-4-6",
      apiKeyId: "c1000000-0000-4000-8000-000000000001",
      catalogRevision: 1,
      configSha256: "b".repeat(64),
    },
  });
});

test("fails closed on tenant, purpose, or output-shape substitution", async () => {
  for (const data of [
    configured({ workspace_id: OTHER_WORKSPACE_ID }),
    configured({ purpose: "sourcing" }),
    configured({ secret: "must-never-cross-the-RPC" }),
    configured({ provider_slug: "unreviewed-provider" }),
  ]) {
    let calls = 0;
    const result = await resolveActiveAiRuntimeBinding(
      { async rpc() { calls += 1; return { data, error: null }; } },
      WORKSPACE_ID,
      "requisition_parse",
    );
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: false, code: "backend_error" });
  }
});

test("rejects a database endpoint profile that the running provider client does not implement", async () => {
  const result = await resolveActiveAiRuntimeBinding(
    {
      async rpc() {
        return {
          data: configured({ endpoint_profile: "openai_chat_completions_v1" }),
          error: null,
        };
      },
    },
    WORKSPACE_ID,
    "requisition_parse",
  );

  assert.deepEqual(result, { ok: false, code: "authority_invalid" });
});

test("preserves bounded authority statuses and converts transport failures to backend_error", async () => {
  for (const code of ["not_configured", "credential_unavailable", "authority_invalid"] as const) {
    const result = await resolveActiveAiRuntimeBinding(
      { async rpc() { return { data: { status: code }, error: null }; } },
      WORKSPACE_ID,
      "sourcing",
    );
    assert.deepEqual(result, { ok: false, code });
  }

  assert.deepEqual(
    await resolveActiveAiRuntimeBinding(
      { async rpc() { return { data: null, error: { message: "synthetic" } }; } },
      WORKSPACE_ID,
      "sourcing",
    ),
    { ok: false, code: "backend_error" },
  );
  assert.deepEqual(
    await resolveActiveAiRuntimeBinding(
      { async rpc() { throw new Error("synthetic"); } },
      WORKSPACE_ID,
      "sourcing",
    ),
    { ok: false, code: "backend_error" },
  );
});

test("rejects invalid local identifiers without touching the database", async () => {
  let calls = 0;
  const client = { async rpc() { calls += 1; return { data: configured(), error: null }; } };

  assert.deepEqual(
    await resolveActiveAiRuntimeBinding(client, "not-a-workspace", "sourcing"),
    { ok: false, code: "backend_error" },
  );
  assert.equal(calls, 0);
});

test("live credential probes use only fixed non-completion provider endpoints", async () => {
  const cases = [
    ["Anthropic", "https://api.anthropic.com/v1/models?limit=1", "x-api-key"],
    ["OpenAI", "https://api.openai.com/v1/models", "authorization"],
    ["Groq", "https://api.groq.com/openai/v1/models", "authorization"],
    ["xAI", "https://api.x.ai/v1/models", "authorization"],
    ["Mistral", "https://api.mistral.ai/v1/models", "authorization"],
    ["Kimi (Moonshot)", "https://api.moonshot.ai/v1/models", "authorization"],
  ] as const;
  const secret = "synthetic-provider-secret-that-must-not-leak";

  for (const [provider, expectedUrl, authHeader] of cases) {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const result = await verifyExecutionCredential(provider, secret, async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response('{"object":"list","data":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    assert.equal(seenUrl, expectedUrl);
    assert.equal(seenInit?.method, "GET");
    assert.equal(seenInit?.redirect, "manual");
    assert.equal(seenInit?.cache, "no-store");
    assert.ok((seenInit?.headers as Record<string, string> | undefined)?.[authHeader]);
    assert.deepEqual(result, {
      state: "verified",
      status: "valid",
      method: "provider_models_list_v1",
      httpStatus: 200,
      detail: `${provider} authentication verified.`,
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("Tavily uses the bounded non-billable usage proof for standard and Enterprise keys", async () => {
  const calls: string[] = [];
  const verified = await verifyExecutionCredential(
    "Tavily",
    "tvly-synthetic-standard-key",
    async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        key: { usage: 3, limit: 1000, search_usage: 3 },
        account: { current_plan: "Researcher", plan_usage: 3, plan_limit: 1000 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.deepEqual(calls, ["https://api.tavily.com/usage"]);
  assert.equal(verified.state, "verified");
  assert.equal(verified.method, "tavily_usage_v1");
  assert.equal(calls.some((url) => url.endsWith("/search")), false);

  const rejected = await verifyExecutionCredential(
    "Tavily",
    "tvly-synthetic-rejected-key",
    async () => new Response("unauthorized", { status: 401 }),
  );
  assert.deepEqual(rejected, {
    state: "rejected",
    status: "invalid",
    method: null,
    httpStatus: 401,
    detail: "Tavily rejected this credential.",
  });
});

test("rejected and transport-unknown probes remain distinguishable and non-activatable", async () => {
  const rejected = await verifyExecutionCredential(
    "OpenAI",
    "synthetic-rejected-key",
    async () => new Response("secret-bearing rejection", { status: 401 }),
  );
  assert.deepEqual(rejected, {
    state: "rejected",
    status: "invalid",
    method: null,
    httpStatus: 401,
    detail: "OpenAI rejected this credential.",
  });

  const unavailable = await verifyExecutionCredential(
    "OpenAI",
    "synthetic-transport-key",
    async () => { throw new Error("secret-bearing transport failure"); },
  );
  assert.deepEqual(unavailable, {
    state: "unavailable",
    status: "untested",
    method: null,
    httpStatus: null,
    detail: "OpenAI verification is temporarily unavailable.",
  });
  assert.equal(JSON.stringify([rejected, unavailable]).includes("synthetic-"), false);
});

test("redirects, non-JSON success, oversized evidence, and malformed local keys fail closed", async () => {
  const redirect = await verifyExecutionCredential(
    "OpenAI",
    "synthetic-redirect-key",
    async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.invalid/provider-body" },
    }),
  );
  assert.equal(redirect.state, "unavailable");
  assert.equal(redirect.status, "untested");
  assert.equal(redirect.httpStatus, 302);

  const nonJson = await verifyExecutionCredential(
    "OpenAI",
    "synthetic-non-json-key",
    async () => new Response("secret-bearing success body", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  );
  assert.equal(nonJson.state, "unavailable");
  assert.equal(nonJson.status, "untested");

  const oversizedTavily = await verifyExecutionCredential(
    "Tavily",
    "synthetic-oversized-key",
    async () => new Response(JSON.stringify({
      key: { usage: 0, limit: 1000 },
      account: { current_plan: "Researcher" },
      providerBody: "secret-bearing".repeat(400),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(oversizedTavily.state, "unavailable");
  assert.equal(oversizedTavily.status, "untested");

  let malformedFetches = 0;
  const malformed = await verifyExecutionCredential(
    "OpenAI",
    "synthetic\nheader-injection",
    async () => {
      malformedFetches += 1;
      throw new Error("must not execute");
    },
  );
  assert.equal(malformed.state, "rejected");
  assert.equal(malformedFetches, 0);

  const serialized = JSON.stringify([redirect, nonJson, oversizedTavily, malformed]);
  assert.equal(serialized.includes("secret-bearing"), false);
  assert.equal(serialized.includes("attacker.invalid"), false);
});

test("exact requisition-model evidence proves the selected model on the real parse endpoint", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const result = await verifyExecutionModelCapability(
    "OpenAI",
    "synthetic-capability-key",
    "gpt-exact-model",
    "requisition_parse",
    async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), body });
      assert.equal(body.model, "gpt-exact-model");
      assert.equal(body.stream, false);
      assert.equal(Array.isArray(body.tools), false);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"aria_runtime_probe":true}' } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.openai.com/v1/chat/completions",
  ]);
  assert.deepEqual(result, {
    state: "verified",
    method: "provider_model_capability_v1",
    httpStatus: 200,
    detail: "OpenAI requisition_parse capability verified for the exact model.",
  });
});

test("exact sourcing-model evidence requires a validated tool call from the selected model", async () => {
  const result = await verifyExecutionModelCapability(
    "Anthropic",
    "synthetic-capability-key",
    "claude-exact-model",
    "sourcing",
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: unknown;
        tools?: Array<{ name?: unknown }>;
        tool_choice?: { name?: unknown };
        messages?: Array<{ content?: unknown }>;
      };
      assert.equal(body.model, "claude-exact-model");
      assert.equal(body.tools?.[0]?.name, "aria_runtime_capability_probe");
      assert.equal(body.tool_choice?.name, "aria_runtime_capability_probe");
      const nonce = body.messages?.[0]?.content;
      assert.equal(typeof nonce, "string");
      const expectedNonce = String(nonce).match(/[0-9a-f-]{36}/i)?.[0];
      assert.ok(expectedNonce);
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: "aria_runtime_capability_probe",
          input: { nonce: expectedNonce },
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.equal(result.state, "verified");
  assert.equal(result.method, "provider_model_capability_v1");

  const kimi = await verifyExecutionModelCapability(
    "Kimi (Moonshot)",
    "synthetic-capability-key",
    "kimi-k2.5",
    "sourcing",
    async (input, init) => {
      assert.equal(String(input), "https://api.moonshot.ai/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ content?: unknown }>;
        parallel_tool_calls?: unknown;
      };
      assert.equal(Object.hasOwn(body, "parallel_tool_calls"), false);
      const nonce = String(body.messages?.[0]?.content).match(/[0-9a-f-]{36}/i)?.[0];
      assert.ok(nonce);
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            tool_calls: [{
              type: "function",
              function: {
                name: "aria_runtime_capability_probe",
                arguments: JSON.stringify({ nonce }),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.equal(kimi.state, "verified");
});

test("listed, embedding-only, missing, or malformed model capabilities cannot authorize a binding", async () => {
  const cases: Array<Promise<unknown>> = [
    verifyExecutionModelCapability(
      "OpenAI",
      "synthetic-capability-key",
      "text-embedding-3-large",
      "requisition_parse",
      async () => new Response(JSON.stringify({
        data: [{ id: "text-embedding-3-large", object: "model" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
    verifyExecutionModelCapability(
      "OpenAI",
      "synthetic-capability-key",
      "does-not-exist",
      "requisition_parse",
      async () => new Response('{"error":{"type":"model_not_found"}}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ),
    verifyExecutionModelCapability(
      "OpenAI",
      "synthetic-capability-key",
      "gpt-malformed-output",
      "requisition_parse",
      async () => new Response(JSON.stringify({
        choices: [{ message: { content: "not-json" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
    verifyExecutionModelCapability(
      "OpenAI",
      "synthetic-capability-key",
      "gpt-no-tool-call",
      "sourcing",
      async () => new Response(JSON.stringify({
        choices: [{ message: { content: "I cannot call tools." } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  ];

  for (const result of await Promise.all(cases)) {
    assert.deepEqual(result, {
      state: "rejected",
      method: null,
      httpStatus: (result as { httpStatus: number }).httpStatus,
      detail: "OpenAI rejected the exact model capability for this purpose.",
    });
  }
});

test("capability probes reject unsafe inputs and upstream ambiguity without exposing provider bodies", async () => {
  let fetches = 0;
  const unsafe = await verifyExecutionModelCapability(
    "OpenAI",
    "synthetic-capability-key",
    "gpt-model\nheader-injection",
    "sourcing",
    async () => {
      fetches += 1;
      throw new Error("must not execute");
    },
  );
  assert.equal(fetches, 0);
  assert.equal(unsafe.state, "rejected");

  const unavailable = await verifyExecutionModelCapability(
    "OpenAI",
    "synthetic-capability-key",
    "gpt-model",
    "sourcing",
    async () => new Response("secret-bearing upstream body", {
      status: 429,
      headers: { "content-type": "text/plain" },
    }),
  );
  assert.deepEqual(unavailable, {
    state: "unavailable",
    method: null,
    httpStatus: 429,
    detail: "OpenAI exact-model capability verification is temporarily unavailable.",
  });
  assert.equal(JSON.stringify([unsafe, unavailable]).includes("secret-bearing"), false);
});
