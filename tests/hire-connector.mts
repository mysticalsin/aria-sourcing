import { readFileSync } from "node:fs";
import {
  genericApiHireConnector,
  linkedInSourcingRunsWithoutErp,
  mcpToolHireConnector,
  odooHireConnector,
  smartHireConnector,
  type HireCall,
} from "../src/lib/hire-connector.ts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const call: HireCall = {
  idempotencyKey: "hire-1",
  model: "hr.applicant",
  method: "create",
  values: { name: "Ada" },
};

const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const apiToken = "fake-api-token";
const mcpToken = "fake-mcp-token";

const apiEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_API_URL: "https://hire-api.example.test/",
  HIRE_API_TOKEN: apiToken,
};

const mcpEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
  HIRE_MCP_TOKEN: mcpToken,
  HIRE_MCP_TOOL: "hire",
};

const odooEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "mantu",
  ODOO_USERNAME: "api",
  ODOO_API_KEY: "fake-odoo-key",
};

const smartEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SMART_URL: "https://smart.example.test/",
  SMART_TOKEN: "fake-smart-token",
};

const apiCalls: { url: string; init?: RequestInit }[] = [];
const apiFetch = (async (url: string, init?: RequestInit) => {
  apiCalls.push({ url, init });
  return jsonResponse(200, { id: "api-9" });
}) as typeof fetch;

const created = await genericApiHireConnector(apiEnv, apiFetch).call(call);
ok("generic api returns the response id", created.ok === true && created.ok && created.id === "api-9");
ok("generic api posts once to the public hire path", apiCalls.length === 1 && apiCalls[0]?.url === "https://hire-api.example.test/v1/hire/hr.applicant");
const apiHeaders = new Headers(apiCalls[0]?.init?.headers);
const apiBody = JSON.parse(String(apiCalls[0]?.init?.body)) as { method: string; values: { name: string } };
ok(
  "generic api sends the bearer token, idempotency key, and does not follow redirects",
  apiCalls[0]?.init?.method === "POST" &&
    apiCalls[0]?.init?.redirect === "error" &&
    apiHeaders.get("authorization") === `Bearer ${apiToken}` &&
    apiHeaders.get("idempotency-key") === "hire-1" &&
    apiBody.method === "create" &&
    apiBody.values.name === "Ada",
);

const falseApi = await genericApiHireConnector(apiEnv, (async () => jsonResponse(200, { result: false })) as typeof fetch).call(call);
ok("a false generic api result is not a hire", falseApi.ok === false && falseApi.ok === false && falseApi.error === "api response missing id");

const emptyApi = await genericApiHireConnector(apiEnv, (async () => jsonResponse(200, {})) as typeof fetch).call(call);
ok("an empty generic api result is not a hire", emptyApi.ok === false && emptyApi.error === "api response missing id");

const echoed = await genericApiHireConnector(
  apiEnv,
  (async () => jsonResponse(200, { error: `rejected ${apiToken}` })) as typeof fetch,
).call(call);
ok("generic api errors do not echo the bearer token", echoed.ok === false && !echoed.error.includes(apiToken));

let apiUnsafeCalls = 0;
const apiUnsafeFetch = (async () => {
  apiUnsafeCalls += 1;
  return jsonResponse(200, { id: "nope" });
}) as typeof fetch;
for (const [label, url] of Object.entries({
  "plain http": "http://hire-api.example.test",
  "embedded credentials": "https://user:secret@hire-api.example.test",
  query: "https://hire-api.example.test/v1?access_token=fake",
  loopback: "https://127.0.0.1",
  metadata: "https://169.254.169.254",
  localhost: "https://localhost",
})) {
  const refused = await genericApiHireConnector(
    { NODE_ENV: "test", HIRE_API_URL: url, HIRE_API_TOKEN: apiToken },
    apiUnsafeFetch,
  ).call(call);
  ok(`generic api refuses ${label}`, refused.ok === false && apiUnsafeCalls === 0);
}

const foreignApi = await genericApiHireConnector(apiEnv, apiUnsafeFetch).call({ ...call, model: "../admin" });
ok("generic api refuses a model outside hr.job and hr.applicant", foreignApi.ok === false && apiUnsafeCalls === 0);

const mcpCalls: { url: string; init?: RequestInit }[] = [];
const mcpFetch = (async (url: string, init?: RequestInit) => {
  mcpCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { method?: string };
  if (body.method === "initialize") {
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-1" });
  }
  if (body.method === "notifications/initialized") return jsonResponse(202, {});
  return jsonResponse(200, { result: { content: [{ type: "text", text: JSON.stringify({ id: "mcp-9" }) }] } });
}) as typeof fetch;

const mcpCreated = await mcpToolHireConnector(mcpEnv, mcpFetch).call(call);
ok("mcp tool connector returns the tool record id", mcpCreated.ok === true && mcpCreated.ok && mcpCreated.id === "mcp-9");
ok(
  "mcp handshake is initialize, initialized, then tools/call",
  mcpCalls.map((entry) => (JSON.parse(String(entry.init?.body)) as { method?: string }).method).join(",") ===
    "initialize,notifications/initialized,tools/call",
);
const toolCall = JSON.parse(String(mcpCalls[2]?.init?.body)) as {
  method: string;
  params: { name: string; arguments: { model: string; method: string; idempotencyKey: string; values: { name: string } } };
};
const toolHeaders = new Headers(mcpCalls[2]?.init?.headers);
ok(
  "mcp tools/call uses the hire tool, session, and pinned redirect",
  mcpCalls.every((entry) => entry.url === "https://hire-mcp.example.test/mcp" && entry.init?.redirect === "error") &&
    toolCall.params.name === "hire" &&
    toolCall.params.arguments.model === "hr.applicant" &&
    toolCall.params.arguments.method === "create" &&
    toolCall.params.arguments.idempotencyKey === "hire-1" &&
    toolCall.params.arguments.values.name === "Ada" &&
    toolHeaders.get("authorization") === `Bearer ${mcpToken}` &&
    toolHeaders.get("mcp-session-id") === "sess-1",
);

const falseMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") return jsonResponse(200, { result: false });
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("a false mcp tool result is not a hire", falseMcp.ok === false && falseMcp.error === "mcp tool returned no record");

const emptyMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") return jsonResponse(200, { result: { content: [] } });
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("an empty mcp tool result is not a hire", emptyMcp.ok === false && emptyMcp.error === "mcp tool returned no record");

const echoedMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") {
      return jsonResponse(200, { result: { isError: true, content: [{ type: "text", text: `denied ${mcpToken}` }] } });
    }
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp errors do not echo the bearer token", echoedMcp.ok === false && !echoedMcp.error.includes(mcpToken));

let mcpUnsafeCalls = 0;
const mcpUnsafeFetch = (async () => {
  mcpUnsafeCalls += 1;
  return jsonResponse(200, { result: { content: [{ type: "text", text: "{\"id\":\"nope\"}" }] } });
}) as typeof fetch;
const mcpUnsafe = await mcpToolHireConnector(
  { NODE_ENV: "test", HIRE_MCP_URL: "https://user:secret@hire-mcp.example.test/mcp", HIRE_MCP_TOKEN: mcpToken },
  mcpUnsafeFetch,
).call(call);
ok("mcp refuses credentials embedded in the endpoint", mcpUnsafe.ok === false && mcpUnsafeCalls === 0);
const mcpLocal = await mcpToolHireConnector(
  { NODE_ENV: "test", HIRE_MCP_URL: "https://127.0.0.1/mcp", HIRE_MCP_TOKEN: mcpToken },
  mcpUnsafeFetch,
).call(call);
ok("mcp refuses a loopback endpoint", mcpLocal.ok === false && mcpUnsafeCalls === 0);

let missingFetches = 0;
const countingFetch = (async () => {
  missingFetches += 1;
  return jsonResponse(200, { id: "should-not-run" });
}) as typeof fetch;
const missingApi = await genericApiHireConnector(emptyEnv, countingFetch).call(call);
const missingMcp = await mcpToolHireConnector(emptyEnv, countingFetch).call(call);
ok("missing generic api env returns ok:false", missingApi.ok === false && missingApi.error.includes("HIRE_API_URL"));
ok("missing mcp env returns ok:false", missingMcp.ok === false && missingMcp.error.includes("HIRE_MCP_URL"));
ok("missing connector env does not call fetch", missingFetches === 0);

const odooCalls: { url: string; init?: RequestInit }[] = [];
const odooFetch = (async (url: string, init?: RequestInit) => {
  odooCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string } };
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: 42 });
}) as typeof fetch;
const odoo = await odooHireConnector(odooEnv, odooFetch).call(call);
ok("odoo json-rpc still returns the execute_kw id", odoo.ok === true && odoo.ok && odoo.id === "42");
ok("odoo still posts authenticate then execute_kw without following redirects", odooCalls.length === 2 && odooCalls[0]?.init?.redirect === "error" && odooCalls[1]?.url === "https://odoo.example.test/jsonrpc");

const falseOdoo = await odooHireConnector(odooEnv, (async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string } };
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: false });
}) as typeof fetch).call(call);
ok("a false odoo execute_kw result is not a hire", falseOdoo.ok === false && !falseOdoo.error.includes("fake-odoo-key"));

const smart = await smartHireConnector(smartEnv, (async () => jsonResponse(200, { id: "sm-9" })) as typeof fetch).call(call);
ok("smart still returns the response id", smart.ok === true && smart.ok && smart.id === "sm-9");

ok("linkedin sourcing stays available with no connector configured", linkedInSourcingRunsWithoutErp(emptyEnv) === true);

const route = readFileSync(new URL("../src/app/api/hire/route.ts", import.meta.url), "utf8");
ok("the hire route is the HTTP entry and strips connector env unless the workspace is live", route.includes("runSourcingThroughHired") && route.includes("envForHireRequest(process.env, supabaseEnabled)"));

console.log(`RESULT hire-connector: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
