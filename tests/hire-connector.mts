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

const falseStringApi = await genericApiHireConnector(apiEnv, (async () => jsonResponse(200, { result: "false" })) as typeof fetch).call(call);
ok("a string false generic api result is not a hire", falseStringApi.ok === false && falseStringApi.error === "api response missing id");

const nullStringApi = await genericApiHireConnector(apiEnv, (async () => jsonResponse(200, { id: " null " })) as typeof fetch).call(call);
ok("a string null generic api id is not a hire", nullStringApi.ok === false && nullStringApi.error === "api response missing id");

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

const stringFalseMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") {
      return jsonResponse(200, { result: { content: [{ type: "text", text: "{\"result\":\"false\"}" }] } });
    }
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp text that only says false is not a hire", stringFalseMcp.ok === false && stringFalseMcp.error === "mcp tool returned no record");

let mcpToolCallsAfterFailedInit = 0;
const failedInit = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-1" });
    if (body.method === "notifications/initialized") return jsonResponse(503, { error: "session rejected" });
    mcpToolCallsAfterFailedInit += 1;
    return jsonResponse(200, { result: { structuredContent: { id: "should-not-run" } } });
  }) as typeof fetch,
).call(call);
ok(
  "a failed mcp initialized notification does not call the hire tool",
  failedInit.ok === false && failedInit.error === "mcp initialized http 503" && mcpToolCallsAfterFailedInit === 0,
);

function sseResponse(events: unknown[], headers?: Record<string, string>) {
  const body = events
    .map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
}

const sseMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "initialize") {
      return sseResponse([{ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", serverInfo: { name: "fake-hire" } } }], {
        "mcp-session-id": "sess-sse",
      });
    }
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return sseResponse([
      { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 0 } },
      { jsonrpc: "2.0", id: "hire-1", result: { content: [{ type: "text", text: JSON.stringify({ id: "mcp-sse" }) }] } },
    ]);
  }) as typeof fetch,
).call(call);
ok("mcp event-stream responses still return the tool record id", sseMcp.ok === true && sseMcp.ok && sseMcp.id === "mcp-sse");

const sseError = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") {
      return sseResponse([{ jsonrpc: "2.0", id: "hire-1", result: { isError: true, content: [{ type: "text", text: `denied ${mcpToken}` }] } }]);
    }
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp event-stream errors do not echo the bearer token", sseError.ok === false && sseError.error.includes("denied") && !sseError.error.includes(mcpToken));

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

let mappedCalls = 0;
const mappedFetch = (async () => {
  mappedCalls += 1;
  return jsonResponse(200, { id: "metadata" });
}) as typeof fetch;
for (const url of [
  "https://[::ffff:127.0.0.1]/",
  "https://[::ffff:169.254.169.254]/",
  "https://[::ffff:10.0.0.1]/",
  "https://[fe90::1]/",
  "https://[64:ff9b::a9fe:a9fe]/",
  "https://[2002:a9fe:a9fe::]/",
]) {
  const before = mappedCalls;
  const refused = await genericApiHireConnector(
    { NODE_ENV: "test", HIRE_API_URL: url, HIRE_API_TOKEN: apiToken },
    mappedFetch,
  ).call(call);
  const mcpRefused = await mcpToolHireConnector(
    { NODE_ENV: "test", HIRE_MCP_URL: url, HIRE_MCP_TOKEN: mcpToken },
    mappedFetch,
  ).call(call);
  ok(`generic api refuses non-public ${url}`, refused.ok === false && mappedCalls === before);
  ok(`mcp refuses non-public ${url}`, mcpRefused.ok === false && mappedCalls === before);
}

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
const odooExecute = JSON.parse(String(odooCalls[1]?.init?.body)) as { params: { method: string; args: unknown[] } };
ok(
  "odoo create passes vals positionally and does not invent a field",
  odooExecute.params.method === "execute_kw" &&
    odooExecute.params.args[3] === "hr.applicant" &&
    odooExecute.params.args[4] === "create" &&
    JSON.stringify(odooExecute.params.args[5]) === JSON.stringify([[{ name: "Ada" }]]) &&
    JSON.stringify(odooExecute.params.args[6]) === "{}" &&
    !JSON.stringify(odooExecute.params.args).includes("x_idempotency_key"),
);

const odooWriteCalls: { params?: { method?: string; args?: unknown[] } }[] = [];
const odooWrite = await odooHireConnector(odooEnv, (async (_url: string, init?: RequestInit) => {
  odooWriteCalls.push(JSON.parse(String(init?.body)) as { params?: { method?: string; args?: unknown[] } });
  if (odooWriteCalls.at(-1)?.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: true });
}) as typeof fetch).call({ ...call, method: "write", values: { id: "42", stage: "Hired" } });
ok(
  "odoo write addresses the record positionally",
  odooWrite.ok === true &&
    odooWrite.ok &&
    odooWrite.id === "42" &&
    JSON.stringify(odooWriteCalls[1]?.params?.args?.[5]) === JSON.stringify([[42], { stage: "Hired" }]) &&
    JSON.stringify(odooWriteCalls[1]?.params?.args?.[6]) === "{}",
);

let foreignOdooCalls = 0;
const foreignOdoo = await odooHireConnector(odooEnv, (async () => {
  foreignOdooCalls += 1;
  return jsonResponse(200, { result: 1 });
}) as typeof fetch).call({ ...call, model: "res.users" });
ok("odoo refuses a model outside hr.job and hr.applicant", foreignOdoo.ok === false && foreignOdooCalls === 0);

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
