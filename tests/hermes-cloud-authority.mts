import { mock } from "node:test";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const originalEnv = { ...process.env };
delete process.env.OPENAI_API_KEY;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
process.env.NODE_ENV = "test";

let role: "viewer" | "member" | "admin" = "viewer";
let upstreamCalls = 0;
let toolLoopCalls = 0;
let graphCalls = 0;
let vaultProvider = "OpenAI";
const resolverCalls: Array<{ id?: string; provider?: string }> = [];
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const session = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    error: null,
  }),
  from: () => {
    const query: any = {
      insert: () => query,
      update: () => query,
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    DEMO_COOKIE_NAME: "aria_demo",
    demoLoginEnabled: false,
    prodFailClosed: () => null,
    supabaseEnabled: true,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => null,
    requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 403 }) }),
  },
});
mock.module(moduleUrl("src/lib/ai/vault-secret.ts"), {
  namedExports: {
    resolveVaultSecret: async (id?: string, provider?: string) => {
      resolverCalls.push({ id, provider });
      return provider === vaultProvider ? "provider-bound-workspace-secret" : "";
    },
  },
});
mock.module(moduleUrl("src/lib/ai/tool-loop.ts"), {
  namedExports: {
    runAnthropicWithTools: async () => {
      toolLoopCalls += 1;
      return { ok: true, text: '{"drafts":[]}' };
    },
    runOpenAiWithTools: async () => {
      toolLoopCalls += 1;
      return { ok: true, text: '{"drafts":[]}' };
    },
  },
});
mock.module(moduleUrl("src/lib/agents/graph.ts"), {
  namedExports: {
    initialState: () => ({ drafts: [], planCursor: 0, errors: [], report: "" }),
    runGraph: async (state: Record<string, unknown>, deps: { generate: (system: string, prompt: string) => Promise<string> }) => {
      graphCalls += 1;
      await deps.generate("system", "prompt");
      return { state };
    },
  },
});

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  upstreamCalls += 1;
  return new Response(JSON.stringify({ choices: [{ message: { content: "provider answer" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const hermesRoute = await import("../src/app/api/hermes/chat/route");
  const sourcingRoute = await import("../src/app/api/sourcing-agent/route");
  const agentRoute = await import("../src/app/api/agents/run/route");
  const hermesRequest = (provider = "openai") =>
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({
        task: "chat",
        prompt: "Confidential candidate context",
        provider,
        model: provider === "hermes" ? "hermes" : "gpt-4o-mini",
        ...(provider === "hermes" ? {} : { apiKeyId: "11111111-1111-4111-8111-111111111111" }),
      }),
    });
  const campaign = {
    id: "campaign-1",
    jobAnalysis: { title: "Platform Engineer", skills: ["TypeScript"] },
    scoringWeights: {},
  };
  const sourcingRequest = () =>
    new NextRequest("http://localhost/api/sourcing-agent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({
        campaign,
        existing: [],
        count: 1,
        provider: "openai",
        apiKeyId: "11111111-1111-4111-8111-111111111111",
        model: "gpt-4o-mini",
      }),
    });
  const agentRequest = () =>
    new NextRequest("http://localhost/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({
        campaign,
        existing: [],
        count: 1,
        provider: "openai",
        apiKeyId: "11111111-1111-4111-8111-111111111111",
        model: "gpt-4o-mini",
      }),
    });
  const resetCalls = () => {
    resolverCalls.length = 0;
    upstreamCalls = 0;
    toolLoopCalls = 0;
    graphCalls = 0;
  };

  const viewerResponse = await hermesRoute.POST(hermesRequest());
  ok("viewer cannot spend a cloud provider key through chat", viewerResponse.status === 403);
  ok("viewer denial happens before vault resolution or egress", resolverCalls.length === 0 && upstreamCalls === 0);

  role = "member";
  vaultProvider = "OpenAI";
  resetCalls();
  const memberResponse = await hermesRoute.POST(hermesRequest());
  ok("member cannot choose a live cloud provider through chat", memberResponse.status === 403);
  ok(
    "member cloud-chat denial happens before vault resolution or egress",
    resolverCalls.length === 0 && upstreamCalls === 0,
  );

  resetCalls();
  const internalHermes = await hermesRoute.POST(hermesRequest("hermes"));
  ok("member retains the non-cloud internal Hermes path", internalHermes.status !== 403);
  ok("internal Hermes request does not resolve a cloud key", resolverCalls.length === 0 && upstreamCalls === 0);

  role = "admin";
  vaultProvider = "OpenAI";
  resetCalls();
  const adminResponse = await hermesRoute.POST(hermesRequest());
  const adminBody = (await adminResponse.json()) as { ok?: boolean };
  ok("admin can execute cloud chat with a matching valid key", adminResponse.status === 200 && adminBody.ok === true);
  ok(
    "admin cloud chat binds the vault key before one provider call",
    resolverCalls.some((call) => call.provider === "OpenAI") && upstreamCalls === 1,
  );

  vaultProvider = "Anthropic";
  resetCalls();
  const mismatchResponse = await hermesRoute.POST(hermesRequest());
  ok("admin cross-provider key mismatch fails closed", mismatchResponse.status === 403);
  ok(
    "cross-provider cloud chat makes zero provider calls",
    resolverCalls.some((call) => call.provider === "OpenAI") && upstreamCalls === 0,
  );

  role = "member";
  vaultProvider = "OpenAI";
  resetCalls();
  const memberSourcing = await sourcingRoute.POST(sourcingRequest());
  ok("member cannot run the live cloud sourcing agent", memberSourcing.status === 403);
  ok(
    "member sourcing denial happens before vault resolution or model egress",
    resolverCalls.length === 0 && toolLoopCalls === 0 && upstreamCalls === 0,
  );

  role = "admin";
  resetCalls();
  const adminSourcing = await sourcingRoute.POST(sourcingRequest());
  const adminSourcingBody = (await adminSourcing.json()) as { ok?: boolean };
  ok("admin can run the live cloud sourcing agent", adminSourcing.status === 200 && adminSourcingBody.ok === true);
  ok(
    "admin sourcing binds its key before one model call",
    resolverCalls.some((call) => call.provider === "OpenAI") && toolLoopCalls === 1,
  );

  vaultProvider = "Anthropic";
  resetCalls();
  const mismatchSourcing = await sourcingRoute.POST(sourcingRequest());
  ok("sourcing cross-provider key mismatch fails closed before model egress", mismatchSourcing.status === 403 && toolLoopCalls === 0);

  role = "member";
  vaultProvider = "OpenAI";
  resetCalls();
  const memberAgent = await agentRoute.POST(agentRequest());
  ok("member cannot run the live cloud graph agent", memberAgent.status === 403);
  ok(
    "member graph-agent denial happens before vault resolution or model egress",
    resolverCalls.length === 0 && graphCalls === 0 && upstreamCalls === 0,
  );

  role = "admin";
  resetCalls();
  const adminAgent = await agentRoute.POST(agentRequest());
  const adminAgentBody = (await adminAgent.json()) as { ok?: boolean };
  ok("admin can run the live cloud graph agent", adminAgent.status === 200 && adminAgentBody.ok === true);
  ok(
    "admin graph agent binds its key before one provider call",
    resolverCalls.some((call) => call.provider === "OpenAI") && graphCalls === 1 && upstreamCalls === 1,
  );

  vaultProvider = "Anthropic";
  resetCalls();
  const mismatchAgent = await agentRoute.POST(agentRequest());
  ok("graph-agent cross-provider key mismatch fails closed before model egress", mismatchAgent.status === 403 && graphCalls === 0 && upstreamCalls === 0);
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}

console.log(`RESULT hermes-cloud-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
