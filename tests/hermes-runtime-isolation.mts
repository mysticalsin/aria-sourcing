import { mock } from "node:test";
import { NextRequest } from "next/server";
import {
  evaluateHermesProxyOperation,
  evaluateHermesWorkspaceBinding,
} from "../src/lib/api/hermes-runtime-isolation";
import {
  buildHermesSessionKey,
  buildHermesUpstreamPath,
  resolveHermesProfilePrefix,
} from "../src/lib/api/hermes-proxy";
import { createProcessEnvScope } from "./helpers/process-env.mts";

mock.module("server-only", { namedExports: {} });

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

ok(
  "profile prefix is stable per workspace uuid",
  resolveHermesProfilePrefix(workspaceA) === `ws-${workspaceA}`,
);
ok(
  "cross-workspace profile prefixes differ",
  resolveHermesProfilePrefix(workspaceA) !== resolveHermesProfilePrefix(workspaceB),
);
ok(
  "session key scopes workspace:campaign:candidate",
  buildHermesSessionKey({ workspaceId: workspaceA, campaignId: "camp-1", candidateId: "cand-1" })
    === `${workspaceA}:camp-1:cand-1`,
);
ok(
  "upstream path adds profile prefix for multiplexing",
  buildHermesUpstreamPath("/v1/chat/completions", `ws-${workspaceA}`)
    === `/p/ws-${workspaceA}/v1/chat/completions`,
);
ok(
  "session key omitted without full candidate scope",
  buildHermesSessionKey({ workspaceId: workspaceA, campaignId: "camp-1" }) === undefined,
);

ok(
  "production runtime fails closed without a workspace binding",
  evaluateHermesWorkspaceBinding({ production: true, supabaseEnabled: true, workspaceId: workspaceA, boundWorkspaceId: undefined }).status === 503,
);
ok(
  "production runtime refuses a topology without workspace identity",
  evaluateHermesWorkspaceBinding({ production: true, supabaseEnabled: false, workspaceId: null, boundWorkspaceId: workspaceA }).status === 503,
);
ok(
  "production runtime denies a different workspace",
  evaluateHermesWorkspaceBinding({ production: true, supabaseEnabled: true, workspaceId: workspaceB, boundWorkspaceId: workspaceA }).status === 403,
);
ok(
  "production runtime permits only the bound workspace",
  evaluateHermesWorkspaceBinding({ production: true, supabaseEnabled: true, workspaceId: workspaceA, boundWorkspaceId: workspaceA }).ok,
);
ok(
  "production generic proxy denies mutations",
  evaluateHermesProxyOperation({ production: true, method: "PATCH", upstreamPath: "api/config", canManageSettings: true }).status === 405,
);
ok(
  "production generic proxy denies untyped chat POST",
  evaluateHermesProxyOperation({ production: true, method: "POST", upstreamPath: "v1/chat/completions", canManageSettings: true }).status === 405,
);
ok(
  "viewer cannot read runtime memory",
  evaluateHermesProxyOperation({ production: true, method: "GET", upstreamPath: "api/memory", canManageSettings: false }).status === 403,
);
ok(
  // `api/health` exists on NEITHER upstream process — the aiohttp gateway serves
  // `/health`. This assertion previously guarded a path that could only 404.
  "viewer can read bounded health",
  evaluateHermesProxyOperation({ production: true, method: "GET", upstreamPath: "health", canManageSettings: false }).ok,
);
ok(
  "the non-existent api/health path is not a public read",
  !evaluateHermesProxyOperation({ production: true, method: "GET", upstreamPath: "api/health", canManageSettings: false }).ok,
);

const envScope = createProcessEnvScope([
  "NODE_ENV",
  "HERMES_API_URL",
  "HERMES_WEB_URL",
  "HERMES_API_KEY",
  "OPENAI_API_KEY",
  "HERMES_RUNTIME_WORKSPACE_ID",
]);
envScope.set({
  NODE_ENV: "production",
  // Upstream is two processes with disjoint route sets: the aiohttp gateway
  // (8642) and the FastAPI management server (8080). Both must be configured or
  // the management reads below cannot resolve a base URL.
  HERMES_API_URL: "http://127.0.0.1:8642",
  HERMES_WEB_URL: "http://127.0.0.1:8080",
  HERMES_API_KEY: "test-global-runtime-key",
  OPENAI_API_KEY: "test-cloud-key",
  HERMES_RUNTIME_WORKSPACE_ID: undefined,
});

let workspaceId = workspaceA;
let role = "viewer";
let vaultSecret = "";
let upstreamCalls = 0;
let lastAuthorization = "";

const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => {
    if (name === "current_workspace_id") return { data: workspaceId, error: null };
    if (name === "current_profile_role") return { data: role, error: null };
    return { data: null, error: null };
  },
};

const service = {
  from: () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: null, error: { message: "not found" } }),
    };
    return query;
  },
};

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
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
    getServerSupabase: async () => supabase,
    getServiceSupabase: () => service,
  },
});
mock.module(moduleUrl("src/lib/ai/vault-secret.ts"), {
  namedExports: {
    resolveVaultSecret: async (keyId?: string) => keyId ? vaultSecret : "",
    resolveStoredLlmKeyForWorkspace: async () => null,
  },
});

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  upstreamCalls++;
  lastAuthorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
  return new Response(JSON.stringify({ choices: [{ message: { content: "bounded answer" } }], ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const proxyModule = await import("../src/app/api/hermes/proxy/route");
  const proxyGet = ((proxyModule as any).GET ?? (proxyModule as any).default?.GET) as (request: NextRequest) => Promise<Response>;
  const proxyPost = ((proxyModule as any).POST ?? (proxyModule as any).default?.POST) as (request: NextRequest) => Promise<Response>;

  envScope.set({ HERMES_RUNTIME_WORKSPACE_ID: undefined });
  upstreamCalls = 0;
  const unbound = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=api/status"));
  ok("unbound production proxy returns 503 before upstream", unbound.status === 503 && upstreamCalls === 0);

  envScope.set({ HERMES_RUNTIME_WORKSPACE_ID: workspaceA });
  workspaceId = workspaceB;
  const crossWorkspace = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=api/status"));
  const crossWorkspaceText = await crossWorkspace.text();
  ok("foreign workspace returns 403 before upstream", crossWorkspace.status === 403 && upstreamCalls === 0);
  ok("foreign-workspace response does not disclose the binding", !crossWorkspaceText.includes(workspaceA));

  workspaceId = workspaceA;
  role = "viewer";
  // `health` on the gateway, not `api/health` — the latter exists on neither
  // upstream process, so it never reached a runtime and now 404s at the allow-list.
  const health = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=health"));
  ok("bound workspace viewer can read health", health.status === 200 && upstreamCalls === 1);
  const deadHealth = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=api/health"));
  ok("the non-existent api/health path 404s before any upstream call", deadHealth.status === 404 && upstreamCalls === 1);

  const memory = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=api/memory"));
  ok("viewer cannot read global runtime memory", memory.status === 403 && upstreamCalls === 1);

  role = "admin";
  const adminMemory = await proxyGet(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=api/memory"));
  ok("bound workspace admin can read runtime memory", adminMemory.status === 200 && upstreamCalls === 2);

  const mutation = await proxyPost(new NextRequest("http://localhost/api/hermes/proxy?upstreamPath=v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  }));
  ok("generic production chat proxy is closed", mutation.status === 405 && upstreamCalls === 2);

  const invalidKeyId = "33333333-3333-4333-8333-333333333333";
  const invalidKey = await proxyGet(new NextRequest(`http://localhost/api/hermes/proxy?upstreamPath=health&hermesApiKeyId=${invalidKeyId}`));
  ok("invalid vault key id cannot fall back to env credential", invalidKey.status === 403 && upstreamCalls === 2);

  const chatModule = await import("../src/app/api/hermes/chat/route");
  const chatPost = ((chatModule as any).POST ?? (chatModule as any).default?.POST) as (request: NextRequest) => Promise<Response>;
  const chatRequest = (body: Record<string, unknown>) => new NextRequest("http://localhost/api/hermes/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
    body: JSON.stringify(body),
  });

  envScope.set({ HERMES_RUNTIME_WORKSPACE_ID: undefined });
  const unboundChat = await chatPost(chatRequest({ provider: "hermes", prompt: "Hello" }));
  ok("typed Hermes chat also fails closed when unbound", unboundChat.status === 503 && upstreamCalls === 2);

  // Loop tasks must still reach cloud env/vault when Hermes is unbound on Fly.
  const unboundOutreach = await chatPost(
    chatRequest({ provider: "hermes", task: "outreach", prompt: "Draft a short LinkedIn note." }),
  );
  const unboundOutreachJson = (await unboundOutreach.json()) as { ok?: boolean; text?: string; reason?: string };
  ok(
    "unbound Hermes outreach failovers to cloud for loop tasks",
    unboundOutreach.status === 200
      && unboundOutreachJson.ok === true
      && typeof unboundOutreachJson.text === "string"
      && unboundOutreachJson.text.length > 0
      && upstreamCalls === 3,
  );

  envScope.set({ HERMES_RUNTIME_WORKSPACE_ID: workspaceA });
  vaultSecret = "";
  const invalidChatKey = await chatPost(chatRequest({ provider: "hermes", prompt: "Hello", hermesApiKeyId: invalidKeyId }));
  ok("typed Hermes chat rejects invalid key without env fallback", invalidChatKey.status === 403 && upstreamCalls === 3);

  const boundedChat = await chatPost(chatRequest({ provider: "hermes", prompt: "Hello" }));
  ok("bound typed Hermes chat reaches its runtime", boundedChat.status === 200 && upstreamCalls === 4);
  ok("bound typed Hermes chat may use the configured env credential", lastAuthorization === "Bearer test-global-runtime-key");

  envScope.set({ HERMES_RUNTIME_WORKSPACE_ID: undefined });
  const cloudChat = await chatPost(chatRequest({ provider: "openai", model: "gpt-4o-mini", prompt: "Hello" }));
  ok("cloud-provider chat remains independent of Hermes binding", cloudChat.status === 200 && upstreamCalls === 5);
} finally {
  globalThis.fetch = originalFetch;
  envScope.restore();
}

console.log(`RESULT hermes-runtime-isolation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
