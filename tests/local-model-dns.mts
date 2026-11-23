/**
 * M-03 remainder: an allowlisted model name that resolves to a private
 * address must not be dialed. Name resolution is a stub. No network.
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

mock.module("dns/promises", {
  namedExports: {
    lookup: async () => [{ address: "10.0.0.5", family: 4 }],
  },
});

const envScope = createProcessEnvScope(["PROVIDER_ALLOWED_HOSTS"]);
envScope.set({ PROVIDER_ALLOWED_HOSTS: "models.example.test" });

const { runOpenAiWithTools } = await import("../src/lib/ai/tool-loop");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

dials.length = 0;
const result = await runOpenAiWithTools({
  provider: "local",
  baseUrl: "https://models.example.test/v1",
  model: "synthetic",
  system: "system",
  prompt: "ping",
  key: "",
  servers: [
    {
      url: "builtin:test",
      token: "",
      tools: [{ name: "search" }],
      run: async () => ({ ok: true, content: [] }),
    },
  ],
});

ok("an allowlisted model host that resolves private is refused", result.ok === false);
ok("an allowlisted model host that resolves private is not dialed", dials.length === 0);
if (result.ok !== false || dials.length !== 0) {
  console.log("result", result.ok, result.reason ?? "", dials.join(","));
}

envScope.restore();

console.log(`RESULT local-model-dns: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
