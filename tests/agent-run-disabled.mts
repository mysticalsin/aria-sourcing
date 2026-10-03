import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import { createProcessEnvScope } from "./helpers/process-env.mts";

mock.module("server-only", { namedExports: {} });

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL: ${name}`);
}

const envScope = createProcessEnvScope([
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);
envScope.set({
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
});

let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  providerCalls += 1;
  return new Response("unexpected");
}) as typeof fetch;

try {
  const [{ POST }, { describeStoredAgentRuntimeAvailability }] = await Promise.all([
    import("../src/app/api/agents/run/route"),
    import("../src/lib/agents/runtime-policy"),
  ]);

  const validStoredSpec = describeStoredAgentRuntimeAvailability(
    { title: "Platform Engineer", seniority: "Staff" },
    ["Email"],
    { autopilot: false, canary_remaining: 5 },
    "active",
    "owner-1",
    "owner-1",
  );
  ok(
    "stored agent execution remains blocked without approved workflow authority",
    validStoredSpec.runtime_eligible === false &&
      /workflow authority.*unavailable/i.test(validStoredSpec.runtime_reason ?? ""),
  );

  const response = await POST(
    new NextRequest("http://localhost/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        existing: [{ id: "caller-controlled-candidate" }],
        provider: "openai",
        apiKeyId: "11111111-1111-4111-8111-111111111111",
        model: "caller-controlled-model",
        specId: "22222222-2222-4222-8222-222222222222",
      }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean; code?: string; reason?: string };
  ok(
    "agent framework execution fails closed until the exact private runtime is configured",
    response.status === 503 &&
      body.ok === false &&
      body.code === "agent_framework_unavailable",
  );
  ok("legacy agent execution performs no provider egress", providerCalls === 0);

  const routeSource = readFileSync(
    new URL("../src/app/api/agents/run/route.ts", import.meta.url),
    "utf8",
  );
  ok(
    "framework route accepts no caller provider, model, key, or candidate authority",
    /AgentFrameworkRunSchema[\s\S]*?\.strict\(\)/.test(routeSource) &&
    !/resolveVaultSecret|makeSourcingToolRunner|runGraph|apiKeyId|existing\s*:|provider:\s*z\.|model:\s*z\./.test(
      routeSource,
    ),
  );

  const runtimeSource = readFileSync(
    new URL("../src/lib/agents/runtime-policy.ts", import.meta.url),
    "utf8",
  );
  ok(
    "stored agent policy never invents missing recruiting needs",
    !/"Senior"|"Full-time"|"Remote"|"Standard"/.test(runtimeSource),
  );

  const studioSource = readFileSync(
    new URL("../src/app/studio/page.tsx", import.meta.url),
    "utf8",
  );
  ok(
    "Agent Studio presents per-spec runtime eligibility without claiming delivery authority",
    /owner-scoped specs/i.test(studioSource) &&
      /runtime_eligible/.test(studioSource) &&
      /No delivery authority/i.test(studioSource) &&
      !/Generated Email drafts are stored in run history only/i.test(studioSource),
  );
} finally {
  globalThis.fetch = originalFetch;
  envScope.restore();
}

console.log(`RESULT agent-run-disabled: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
