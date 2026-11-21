/**
 * M-03: a chat body cannot choose the model base URL.
 * The transport is a stub. Name resolution is a stub. No network.
 */
import { mock } from "node:test";

import { createProcessEnvScope } from "./helpers/process-env.mts";

const dials: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  dials.push(String(input));
  return new Response(JSON.stringify({ choices: [{ message: { content: "synthetic" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

mock.module("server-only", { namedExports: {} });
mock.module("dns/promises", {
  namedExports: {
    lookup: async () => [{ address: "1.2.3.4", family: 4 }],
  },
});

const envScope = createProcessEnvScope([
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_ENABLE_DEMO_LOGIN",
  "ARIA_LOCAL_MODEL_BASE_URL",
  "PROVIDER_ALLOWED_HOSTS",
  "NODE_ENV",
]);
envScope.set({
  SUPABASE_URL: undefined,
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  NEXT_PUBLIC_ENABLE_DEMO_LOGIN: undefined,
  ARIA_LOCAL_MODEL_BASE_URL: undefined,
  PROVIDER_ALLOWED_HOSTS: undefined,
  NODE_ENV: "test",
});

const { POST } = await import("../src/app/api/ai/chat/route");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function chat(baseUrl: string) {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({
      task: "chat",
      prompt: "ping",
      provider: "local",
      model: "synthetic",
      baseUrl,
    }),
  });
}

dials.length = 0;
const refused = await POST(chat("http://10.0.0.5:8080") as never);
ok("a body-selected private model URL is refused", refused.status === 400);
ok("a refused model URL records no dial", dials.length === 0);
if (refused.status !== 400 || dials.length !== 0) {
  console.log("refused", refused.status, dials.join(","));
}

envScope.set({
  ARIA_LOCAL_MODEL_BASE_URL: "https://models.example.test/v1",
  PROVIDER_ALLOWED_HOSTS: "models.example.test",
});
dials.length = 0;
const accepted = await POST(chat("http://10.0.0.5:8080") as never);
const acceptedBody = (await accepted.json()) as { ok?: boolean };
ok(
  "an admin-configured public model host is accepted",
  accepted.status === 200 && acceptedBody.ok === true && dials.length === 1 && dials[0].startsWith("https://models.example.test/"),
);
ok("the accepted dial is not the body URL", dials.every((url) => !url.includes("10.0.0.5")));

console.log(`RESULT server-model-url: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
