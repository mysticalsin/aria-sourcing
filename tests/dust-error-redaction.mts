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

const secret = "dust-special key/+?=&%25";
const encoded = encodeURIComponent(secret);
const formEncoded = new URLSearchParams({ value: secret }).toString().slice("value=".length);
const doubleEncoded = encodeURIComponent(encoded);
const leak = `Bearer ${secret}; authorization=${doubleEncoded}; api_key=${formEncoded}`;
const representations = [secret, encoded, formEncoded, doubleEncoded];
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const session = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async (name: string) => ({ data: name === "current_workspace_id" ? workspaceId : "admin", error: null }),
};
const service = {
  from: (table: string) => {
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data:
          table === "dust_connections"
            ? {
                id: "22222222-2222-4222-8222-222222222222",
                workspace_id: workspaceId,
                dust_workspace_id: "dust-workspace",
                region: "us",
                api_key_id: "11111111-1111-4111-8111-111111111111",
                agent_locks: { jdAnalysis: "agent-1" },
                agents: [],
                enabled: true,
                config_revision: 1,
              }
            : {
                secret: "encrypted",
                workspace_id: workspaceId,
                provider: "Dust",
                status: "valid",
              },
        error: null,
      }),
    };
    return query;
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => ({ ok: true, user: { id: "user-1" } }),
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: { decryptSecret: () => secret },
});
mock.module(moduleUrl("src/lib/dust/client.ts"), {
  namedExports: {
    listDustAgents: async () => {
      throw new Error(leak);
    },
    runDustAgent: async () => ({ ok: false, error: leak }),
  },
});

const testRoute = await import("../src/app/api/dust/test/route");
const runRoute = await import("../src/app/api/dust/run/route");

const testResponse = await testRoute.POST(
  new NextRequest("http://localhost/api/dust/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: "dust-workspace", apiKey: secret, region: "us" }),
  }),
);
const testBody = (await testResponse.json()) as { ok?: boolean; error?: string };
const serializedTestBody = JSON.stringify(testBody);
ok("Dust connection-test route maps provider errors generically", testResponse.status === 502 && testBody.error === "Dust connection failed.");
ok("Dust connection-test route reflects no raw or encoded bearer secret", representations.every((value) => !serializedTestBody.includes(value)));

const runResponse = await runRoute.POST(
  new NextRequest("http://localhost/api/dust/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "jdAnalysis", message: "Analyze this role" }),
  }),
);
const runBody = (await runResponse.json()) as { ok?: boolean; error?: string };
const serializedRunBody = JSON.stringify(runBody);
ok("Dust run route maps provider errors generically", runBody.error === "Dust agent request failed.");
ok("Dust run route reflects no raw or encoded bearer secret", representations.every((value) => !serializedRunBody.includes(value)));

console.log(`RESULT dust-error-redaction: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
