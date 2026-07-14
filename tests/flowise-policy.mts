import { getFlowiseProxyPolicy } from "../src/lib/flowise-policy";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

for (const [method, path] of [
  ["POST", ["prediction", "flow_123"]],
  ["GET", ["prediction", "flow_123"]],
  ["PUT", ["prediction", "flow_123"]],
  ["DELETE", ["prediction", "flow_123"]],
  ["POST", ["apikey"]],
  ["POST", ["chatflows"]],
  ["POST", ["prediction"]],
  ["POST", ["prediction", "../other-workspace-flow"]],
] as const) {
  const policy = getFlowiseProxyPolicy(method, path);
  ok(`blocks ${method} /${path.join("/")}`, policy.ok === false);
}

const proxyRoute = readFileSync(new URL("../src/app/api/flowise/[...path]/route.ts", import.meta.url), "utf8");
const specRoute = readFileSync(new URL("../src/app/api/agents/specs/route.ts", import.meta.url), "utf8");
const studio = readFileSync(new URL("../src/app/studio/page.tsx", import.meta.url), "utf8");

ok(
  "the public Flowise proxy is fail-closed until server-owned tenant bindings exist",
  proxyRoute.includes("FLOWISE_PUBLIC_PROXY_DISABLED") && !proxyRoute.includes("await fetch("),
);
ok("proxy no longer exposes Flowise API-key operations", !proxyRoute.includes('"apikey"'));
ok("agent specs do not disclose a public Flowise URL", !specRoute.includes("FLOWISE_PUBLIC_URL"));
ok("operators cannot create or patch raw Flowise identifiers", !specRoute.includes("flowise_chatflow_id"));
ok("studio does not open the Flowise workbench directly", !studio.includes("window.open(flowiseUrl"));

console.log(`RESULT flowise-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
