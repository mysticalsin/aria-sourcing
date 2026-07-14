import { mock } from "node:test";
import { NextRequest } from "next/server";
import { createProcessEnvScope } from "./helpers/process-env.mts";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const environment = createProcessEnvScope(["NODE_ENV", "ARIA_ENABLE_REMOTE_MCP_EXECUTION"]);
environment.set({ NODE_ENV: "production", ARIA_ENABLE_REMOTE_MCP_EXECUTION: "true" });

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
let vaultResolutions = 0;
let remoteCalls = 0;

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: true,
    prodFailClosed: () => null,
    demoLoginEnabled: false,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "admin-user" } }, error: null }) },
      rpc: async () => ({ data: "admin", error: null }),
    }),
  },
});
mock.module(moduleUrl("src/lib/demo-auth.ts"), {
  namedExports: { demoAuthConfigured: () => false, verifyDemoToken: () => false },
});
mock.module(moduleUrl("src/lib/ai/vault-secret.ts"), {
  namedExports: {
    resolveVaultSecret: async () => {
      vaultResolutions += 1;
      return "credential-must-not-be-resolved";
    },
  },
});
mock.module(moduleUrl("src/lib/rbac.ts"), {
  namedExports: { can: () => true },
});
mock.module(moduleUrl("src/lib/mcp-client.ts"), {
  namedExports: {
    remoteMcpDiscoveryEnabled: () => false,
    applyMcpAuth: (url: string, token: string) => ({ url, token }),
    connectAndListTools: async () => {
      remoteCalls += 1;
      return { ok: true, serverName: "unexpected", tools: [] };
    },
  },
});

try {
  const route = await import("../src/app/api/mcp/test/route");
  const response = await route.POST(
    new NextRequest("http://localhost/api/mcp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://mcp.example.test/mcp",
        apiKeyId: "11111111-1111-4111-8111-111111111111",
        authStyle: "bearer",
      }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };

  ok("production MCP discovery is rejected", response.status === 403 && body.ok === false);
  ok("production MCP discovery resolves zero vault credentials", vaultResolutions === 0);
  ok("production MCP discovery makes zero remote calls", remoteCalls === 0);
} finally {
  environment.restore();
}

console.log(`RESULT mcp-production-discovery-route: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
