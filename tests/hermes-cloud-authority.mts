import { mock } from "node:test";
import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed";

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
let agentSpecAvailable = true;
let runPersistenceFails = false;
let agentSpecChannels = ["Email"];
let agentSpecGuardrails: Record<string, unknown> = { autopilot: false, canary_remaining: 5 };
let agentSpecOwnerId = "user-1";
let agentSpecReadCount = 0;
let agentSpecRemainsActive = true;
let capturedAgentPolicy: Record<string, unknown> | undefined;
const resolverCalls: Array<{ id?: string; provider?: string }> = [];
const serviceReadTables: string[] = [];
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentSpecId = "22222222-2222-4222-8222-222222222222";
const agentRunId = "33333333-3333-4333-8333-333333333333";
const sourcingSeed = buildSeedState();
const sourcingCampaign = {
  ...sourcingSeed.campaigns[0],
  id: "campaign-1",
  status: "Sourcing" as const,
};
const sourcingWorkspaceState = {
  campaigns: [sourcingCampaign],
  candidates: sourcingSeed.candidates.map((candidate) => ({
    ...candidate,
    campaignId: "unrelated-campaign",
  })),
  settings: {
    ...sourcingSeed.settings,
    llmProviders: [{
      id: "provider-openai",
      kind: "OpenAI",
      label: "Approved OpenAI",
      apiKeyId: "11111111-1111-4111-8111-111111111111",
      enabled: true,
      isDefault: true,
    }],
    savedModels: [{
      id: "model-openai-sourcing",
      providerId: "provider-openai",
      modelName: "gpt-4o-mini",
      label: "Approved sourcing model",
      enabled: true,
      defaultForTask: ["sourcing"],
    }],
    defaultModels: { sourcing: "model-openai-sourcing" },
  },
};

mock.module("server-only", { namedExports: {} });

const session = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : workspaceId,
    error: null,
  }),
  from: (table: string) => {
    const specReadAllowed = agentSpecReadCount++ === 0 || agentSpecRemainsActive;
    const query: any = {
      insert: () => query,
      update: () => query,
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: table === "workspace_state"
          ? { state: sourcingWorkspaceState, updated_at: "2026-07-13T19:00:00.000Z" }
          : table === "agent_specs" && agentSpecAvailable && specReadAllowed
            ? {
              id: agentSpecId,
              workspace_id: workspaceId,
              owner_id: agentSpecOwnerId,
              role_brief: { title: "Platform Engineer", skills: ["TypeScript"] },
              channels: agentSpecChannels,
              guardrails: agentSpecGuardrails,
              status: "active",
              }
            : null,
        error: null,
      }),
    };
    return query;
  },
};

const service = {
  rpc: async (name: string) => ({
    data: name === "create_agent_run_with_memory_context" && !runPersistenceFails ? agentRunId : null,
    error: name === "create_agent_run_with_memory_context" && runPersistenceFails
      ? { message: "synthetic persistence failure" }
      : null,
  }),
  from: (table: string) => {
    if (["agent_run_memory_context", "agent_memories", "api_keys"].includes(table)) {
      serviceReadTables.push(table);
    }
    let updated = false;
    const query: any = {
      insert: () => query,
      update: (value: Record<string, unknown>) => {
        updated = true;
        if (table === "agent_runs" && value.state_json) serviceReadTables.push("runtime-policy-snapshot");
        return query;
      },
      select: () => query,
      eq: () => query,
      is: () => query,
      or: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: table === "agent_runs" && updated ? { id: agentRunId } : null, error: null }),
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
    getServiceSupabase: () => service,
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
    runOpenAiWithTools: async (args: { servers?: Array<{ run?: (name: string, input: Record<string, unknown>) => Promise<unknown> }> }) => {
      toolLoopCalls += 1;
      if (args.servers?.[0]?.run) {
        await args.servers[0].run("search_candidates", {
          platform: "GitHub",
          query: sourcingCampaign.sourcingStrategy.githubQueries[0]?.query,
          count: 1,
        });
      }
      return { ok: true, text: '{"drafts":[]}' };
    },
  },
});
mock.module(moduleUrl("src/lib/ai/sourcing-tools.ts"), {
  namedExports: {
    SOURCING_TOOL_DEFS: [{ name: "search_candidates", description: "test" }],
    makeSourcingToolRunner: () => {
      const executions: Array<Record<string, unknown>> = [];
      return {
        run: async (_name: string, input: { platform?: string; query?: string }) => {
          executions.push({
            platform: String(input.platform ?? ""),
            query: String(input.query ?? ""),
            ok: true,
            candidateCount: 0,
            skippedCount: 0,
          });
          return { ok: true, content: { found: [] } };
        },
        getFound: () => [],
        getExecutions: () => executions,
      };
    },
  },
});
mock.module(moduleUrl("src/lib/sourcing/learning-authority.ts"), {
  namedExports: {
    beginSourcingRun: async () => ({
      status: "claimed",
      runId: "55555555-5555-4555-8555-555555555555",
      roleFingerprint: "a".repeat(64),
      lessonsEnabled: false,
    }),
    listPromotedSourcingLessons: async () => ({ status: "learning_disabled", lessons: [] }),
    completeSourcingRun: async () => ({
      status: "completed",
      runId: "55555555-5555-4555-8555-555555555555",
      queryCount: 1,
      candidateCount: 0,
      receipts: [],
    }),
    failSourcingRun: async () => true,
  },
});
mock.module(moduleUrl("src/lib/agents/graph.ts"), {
  namedExports: {
    initialState: (_brief: unknown, _count: unknown, policy?: Record<string, unknown>) => {
      capturedAgentPolicy = policy;
      return { drafts: [], planCursor: 0, errors: [], report: "", executionPolicy: policy };
    },
    runGraph: async (
      state: Record<string, unknown>,
      deps: { generate: (system: string, prompt: string) => Promise<string> },
      onStep?: (node: string, state: Record<string, unknown>, event: { type: string; payload: Record<string, unknown> }) => Promise<void>,
      _startNode?: string,
      _startStep?: number,
      beforeStep?: (node: string, state: Record<string, unknown>, step: number) => Promise<void>,
    ) => {
      graphCalls += 1;
      if (beforeStep) await beforeStep("planner", state, 0);
      await deps.generate("system", "prompt");
      if (onStep) await onStep("done", state, { type: "report", payload: {} });
      return { state, node: "done", steps: 1 };
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
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-forwarded-for": crypto.randomUUID(),
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        campaignId: sourcingCampaign.id,
        count: 1,
      }),
    });
  const agentRequest = (includeSpec = true) =>
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
        ...(includeSpec ? { specId: agentSpecId } : {}),
      }),
    });
  const resetCalls = () => {
    resolverCalls.length = 0;
    upstreamCalls = 0;
    toolLoopCalls = 0;
    graphCalls = 0;
    capturedAgentPolicy = undefined;
    serviceReadTables.length = 0;
    agentSpecReadCount = 0;
    agentSpecRemainsActive = true;
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
  const memberSourcingBody = (await memberSourcing.json()) as { ok?: boolean };
  ok(
    "member with source permission can run server-configured cloud sourcing",
    memberSourcing.status === 200 && memberSourcingBody.ok === true,
  );
  ok(
    "member sourcing uses only the server-selected workspace key and model",
    resolverCalls.some((call) => call.provider === "OpenAI") && toolLoopCalls === 1 && upstreamCalls === 0,
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
  const missingSpecIdAgent = await agentRoute.POST(agentRequest(false));
  ok("graph agent requires a stored spec id", missingSpecIdAgent.status === 400);
  ok("missing spec id fails before vault resolution or model egress", resolverCalls.length === 0 && graphCalls === 0 && upstreamCalls === 0);

  agentSpecAvailable = false;
  resetCalls();
  const unknownSpecAgent = await agentRoute.POST(agentRequest());
  ok("graph agent rejects an unavailable active spec", unknownSpecAgent.status === 404);
  ok("spec authorization fails before vault resolution or model egress", resolverCalls.length === 0 && graphCalls === 0 && upstreamCalls === 0);

  agentSpecAvailable = true;
  runPersistenceFails = true;
  resetCalls();
  const persistenceFailureAgent = await agentRoute.POST(agentRequest());
  ok("graph agent fails closed when run-context persistence fails", persistenceFailureAgent.status === 503);
  ok("run-context persistence failure prevents model egress", graphCalls === 0 && upstreamCalls === 0);
  ok(
    "run-context persistence failure performs zero vault, memory-key, or Tavily-key resolution",
    resolverCalls.length === 0 && serviceReadTables.length === 0,
  );

  runPersistenceFails = false;
  resetCalls();
  const adminAgent = await agentRoute.POST(agentRequest());
  const adminAgentBody = (await adminAgent.json()) as { ok?: boolean };
  ok("admin can run the live cloud graph agent", adminAgent.status === 200 && adminAgentBody.ok === true);
  ok(
    "graph agent snapshots stored channels and guardrails into its runtime policy",
      capturedAgentPolicy?.channel === "Email" &&
      capturedAgentPolicy.draftStorage === "run_history" &&
      capturedAgentPolicy.deliveryAuthority === "none",
  );
  ok(
    "graph agent persists its stored runtime snapshot before memory or provider access",
    serviceReadTables[0] === "runtime-policy-snapshot",
  );
  ok(
    "graph agent response labels drafts as run history with no delivery authority",
    (adminAgentBody as Record<string, unknown>).draftStorage === "run_history" &&
      (adminAgentBody as Record<string, unknown>).deliveryAuthority === "none",
  );
  ok(
    "admin graph agent binds its key before one provider call",
    resolverCalls.some((call) => call.provider === "OpenAI") && graphCalls === 1 && upstreamCalls === 1,
  );

  agentSpecOwnerId = "user-2";
  resetCalls();
  const otherOwnerAgent = await agentRoute.POST(agentRequest());
  ok("graph agent rejects another owner's spec", otherOwnerAgent.status === 404);
  ok("owner mismatch fails before receipt, memory, vault, graph, or model egress", resolverCalls.length === 0 && serviceReadTables.length === 0 && graphCalls === 0 && upstreamCalls === 0);
  agentSpecOwnerId = "user-1";

  agentSpecChannels = ["WhatsApp"];
  resetCalls();
  const unsupportedChannelAgent = await agentRoute.POST(agentRequest());
  ok("graph agent rejects a spec with no supported run-history draft channel", unsupportedChannelAgent.status === 409);
  ok(
    "unsupported stored channels fail before receipt, vault, graph, or model egress",
    resolverCalls.length === 0 && serviceReadTables.length === 0 && graphCalls === 0 && upstreamCalls === 0,
  );
  agentSpecChannels = ["Email"];

  agentSpecGuardrails = { autopilot: true, canary_remaining: 0 };
  resetCalls();
  const unsupportedGuardrailAgent = await agentRoute.POST(agentRequest());
  ok("graph agent rejects stored guardrails it cannot enforce", unsupportedGuardrailAgent.status === 409);
  ok("unsupported guardrails fail before receipt, memory, vault, graph, or model egress", resolverCalls.length === 0 && serviceReadTables.length === 0 && graphCalls === 0 && upstreamCalls === 0);
  agentSpecGuardrails = { autopilot: false, canary_remaining: 5, quiet_hours: { start: "18:00" } };
  resetCalls();
  const unknownGuardrailAgent = await agentRoute.POST(agentRequest());
  ok("graph agent rejects unknown stored authority fields", unknownGuardrailAgent.status === 409);
  ok("unknown stored authority fails before receipt, memory, vault, graph, or model egress", resolverCalls.length === 0 && serviceReadTables.length === 0 && graphCalls === 0 && upstreamCalls === 0);
  agentSpecGuardrails = { autopilot: false, canary_remaining: 5 };

  agentSpecRemainsActive = false;
  resetCalls();
  agentSpecRemainsActive = false;
  const pausedDuringRunAgent = await agentRoute.POST(agentRequest());
  ok("graph agent stops when its stored spec is paused before the next step", pausedDuringRunAgent.status === 503);
  ok("mid-run pause prevents provider egress", upstreamCalls === 0);
  agentSpecRemainsActive = true;

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
