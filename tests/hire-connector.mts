import { readFileSync } from "node:fs";
import {
  genericApiHireConnector,
  linkedInSourcingRunsWithoutErp,
  mcpToolHireConnector,
  odooHireConnector,
  smartHireConnector,
  type HireCall,
} from "../src/lib/hire-connector";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const call: HireCall = {
  idempotencyKey: "hire-1",
  model: "hr.applicant",
  method: "create",
  values: { name: "Ada" },
};

const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };

const odooEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "mantu",
  ODOO_USERNAME: "api",
  ODOO_API_KEY: "secret",
};

const smartEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SMART_URL: "https://smart.example.test/",
  SMART_TOKEN: "smart-token",
};

const odooCalls: { url: string; init?: RequestInit }[] = [];
const odooFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  odooCalls.push({ url: String(url), init });
  if (odooCalls.length === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: 42 });
}) as typeof fetch;

const odoo = odooHireConnector(odooEnv, odooFetch);
const created = await odoo.call(call);
ok("odoo returns the execute_kw id", created.ok === true && created.ok && created.id === "42");
ok("odoo posts authenticate then execute_kw", odooCalls.length === 2);
const authBody = JSON.parse(String(odooCalls[0]?.init?.body)) as {
  params: { service: string; method: string; args: unknown[] };
};
const writeBody = JSON.parse(String(odooCalls[1]?.init?.body)) as {
  params: { service: string; method: string; args: unknown[] };
};
ok("odoo authenticate hits jsonrpc common.authenticate", odooCalls[0]?.url === "https://odoo.example.test/jsonrpc" && authBody.params.service === "common" && authBody.params.method === "authenticate");
const createVals = (writeBody.params.args[5] as unknown[][])[0]?.[0] as { name?: string };
ok(
  "odoo execute_kw create uses positional vals_list and empty kwargs",
  odooCalls[1]?.url === "https://odoo.example.test/jsonrpc" &&
    writeBody.params.service === "object" &&
    writeBody.params.method === "execute_kw" &&
    Array.isArray(writeBody.params.args) &&
    writeBody.params.args[1] === 7 &&
    writeBody.params.args[3] === "hr.applicant" &&
    writeBody.params.args[4] === "create" &&
    Array.isArray(writeBody.params.args[5]) &&
    (writeBody.params.args[5] as unknown[]).length === 1 &&
    createVals?.name === "Ada" &&
    Object.keys(writeBody.params.args[6] as object).length === 0,
);

const authFailFetch = (async () => jsonResponse(503, { error: { message: "down" } })) as typeof fetch;
const authFailed = await odooHireConnector(odooEnv, authFailFetch).call(call);
ok("odoo surfaces authenticate HTTP errors", authFailed.ok === false && authFailed.ok === false && authFailed.error === "odoo auth http 503");

let writeAttempts = 0;
const writeFailFetch = (async () => {
  writeAttempts += 1;
  if (writeAttempts === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(500, {});
}) as typeof fetch;
const writeFailed = await odooHireConnector(odooEnv, writeFailFetch).call(call);
ok("odoo surfaces execute_kw HTTP errors", writeFailed.ok === false && writeFailed.error === "odoo write http 500");

const smartCalls: { url: string; init?: RequestInit }[] = [];
const smartMissingId = await smartHireConnector(smartEnv, (async (url: string | URL | Request, init?: RequestInit) => {
  smartCalls.push({ url: String(url), init });
  return jsonResponse(200, {});
}) as typeof fetch).call(call);
const smartHeaders = new Headers(smartCalls[0]?.init?.headers);
ok("smart posts the bearer hire call", smartCalls.length === 1 && smartCalls[0]?.url === "https://smart.example.test/api/hire/hr.applicant" && smartCalls[0]?.init?.method === "POST");
ok("smart sends the bearer token and idempotency key", smartHeaders.get("authorization") === "Bearer smart-token" && smartHeaders.get("idempotency-key") === "hire-1");
ok("smart surfaces a missing id", smartMissingId.ok === false && smartMissingId.error === "smart response missing id");

const smartOk = await smartHireConnector(smartEnv, (async () => jsonResponse(200, { id: "sm-9" })) as typeof fetch).call(call);
ok("smart returns the response id", smartOk.ok === true && smartOk.ok && smartOk.id === "sm-9");

let fetchCalls = 0;
const countingFetch = (async () => {
  fetchCalls += 1;
  return jsonResponse(200, { id: "should-not-run" });
}) as typeof fetch;
const missingOdoo = await odooHireConnector(emptyEnv, countingFetch).call(call);
const missingSmart = await smartHireConnector(emptyEnv, countingFetch).call(call);
ok("missing odoo env returns ok:false", missingOdoo.ok === false && missingOdoo.error.includes("ODOO_URL"));
ok("missing smart env returns ok:false", missingSmart.ok === false && missingSmart.error.includes("SMART_URL"));
ok("missing env does not call fetch", fetchCalls === 0);

ok("odoo does not follow redirects", odooCalls[0]?.init?.redirect === "error" && odooCalls[1]?.init?.redirect === "error");

let unsafeCalls = 0;
const unsafeFetch = (async () => {
  unsafeCalls += 1;
  return jsonResponse(200, { result: 1 });
}) as typeof fetch;
const unsafeUrls: Record<string, string> = {
  "plain http": "http://odoo.example.test",
  "embedded credentials": "https://user:secret@odoo.example.test",
  loopback: "https://127.0.0.1",
  metadata: "https://169.254.169.254",
  localhost: "https://localhost",
  file: "file:///tmp/odoo",
};
for (const [label, url] of Object.entries(unsafeUrls)) {
  const refused = await odooHireConnector(
    { NODE_ENV: "test", ODOO_URL: url, ODOO_DB: "mantu", ODOO_USERNAME: "api", ODOO_API_KEY: "secret" },
    unsafeFetch,
  ).call(call);
  ok(`odoo refuses ${label}`, refused.ok === false && unsafeCalls === 0);
}
const smartUnsafe = await smartHireConnector(
  { NODE_ENV: "test", SMART_URL: "https://169.254.169.254", SMART_TOKEN: "smart-token" },
  unsafeFetch,
).call(call);
ok("smart refuses a metadata endpoint", smartUnsafe.ok === false && unsafeCalls === 0);

let falseSteps = 0;
const falseResult = await odooHireConnector(odooEnv, (async () => {
  falseSteps += 1;
  if (falseSteps === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: false });
}) as typeof fetch).call(call);
ok("a false execute_kw result is not a hire", falseResult.ok === false && !(falseResult.ok === false && falseResult.error.includes("secret")));

const writeCalls: { init?: RequestInit }[] = [];
const written = await odooHireConnector(odooEnv, (async (_url: string, init?: RequestInit) => {
  writeCalls.push({ init });
  if (writeCalls.length === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: true });
}) as typeof fetch).call({ ...call, method: "write", values: { id: 42, stage_id: 9 } });
const writeKw = JSON.parse(String(writeCalls[1]?.init?.body)) as { params: { args: unknown[] } };
ok(
  "odoo execute_kw write uses positional ids and vals",
  written.ok === true &&
    JSON.stringify(writeKw.params.args[5]) === JSON.stringify([[42], { stage_id: 9 }]) &&
    Object.keys(writeKw.params.args[6] as object).length === 0,
);

const echoed = await odooHireConnector(odooEnv, (async () => jsonResponse(200, { error: { message: "rejected secret" } })) as typeof fetch).call(call);
ok("odoo auth errors do not echo the api key", echoed.ok === false && !echoed.error.includes("secret"));

const smartEcho = await smartHireConnector(smartEnv, (async () => jsonResponse(200, { id: "sm-1", error: "bearer smart-token" })) as typeof fetch).call(call);
ok("smart errors do not echo the bearer token", smartEcho.ok === false && !smartEcho.error.includes("smart-token"));

let foreignModelCalls = 0;
const foreignModel = await smartHireConnector(smartEnv, (async () => {
  foreignModelCalls += 1;
  return jsonResponse(200, { id: "nope" });
}) as typeof fetch).call({ ...call, model: "../admin" });
ok("smart refuses a model outside hr.job and hr.applicant", foreignModel.ok === false && foreignModelCalls === 0);

const odooSource = readFileSync(new URL("../src/lib/hire-connector.ts", import.meta.url), "utf8");
const odooFn = odooSource.slice(odooSource.indexOf("export function odooHireConnector"), odooSource.indexOf("export function smartHireConnector"));
ok("odoo authenticate body is not logged", odooFn.includes('method: "authenticate"') && !/console\.(log|info|debug|warn|error)/.test(odooFn));
ok("linkedin gating stays true with empty env", linkedInSourcingRunsWithoutErp(emptyEnv) === true);
ok(
  "linkedin gating stays true when ERP urls are set",
  linkedInSourcingRunsWithoutErp({
    NODE_ENV: "test",
    ODOO_URL: "https://odoo.example.test",
    SMART_URL: "https://smart.example.test",
  } satisfies NodeJS.ProcessEnv) === true,
);

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

function responseWith(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const apiCalls: { url: string; init?: RequestInit }[] = [];
const apiFetch = (async (url: string, init?: RequestInit) => {
  apiCalls.push({ url, init });
  return responseWith(200, { id: "api-9" });
}) as typeof fetch;
const apiCreated = await genericApiHireConnector(apiEnv, apiFetch).call(call);
ok("generic api returns the response id", apiCreated.ok === true && apiCreated.ok && apiCreated.id === "api-9");
ok(
  "generic api posts once to the public hire path",
  apiCalls.length === 1 && apiCalls[0]?.url === "https://hire-api.example.test/v1/hire/hr.applicant",
);
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

const falseApi = await genericApiHireConnector(apiEnv, (async () => responseWith(200, { result: false })) as typeof fetch).call(call);
ok("a false generic api result is not a hire", falseApi.ok === false && falseApi.error === "api response missing id");
const falseStringApi = await genericApiHireConnector(apiEnv, (async () => responseWith(200, { result: "false" })) as typeof fetch).call(call);
ok("a string false generic api result is not a hire", falseStringApi.ok === false && falseStringApi.error === "api response missing id");
const nullStringApi = await genericApiHireConnector(apiEnv, (async () => responseWith(200, { id: " null " })) as typeof fetch).call(call);
ok("a string null generic api id is not a hire", nullStringApi.ok === false && nullStringApi.error === "api response missing id");
const emptyApi = await genericApiHireConnector(apiEnv, (async () => responseWith(200, {})) as typeof fetch).call(call);
ok("an empty generic api result is not a hire", emptyApi.ok === false && emptyApi.error === "api response missing id");
const echoedApi = await genericApiHireConnector(
  apiEnv,
  (async () => responseWith(200, { error: `rejected ${apiToken}` })) as typeof fetch,
).call(call);
ok("generic api errors do not echo the bearer token", echoedApi.ok === false && !echoedApi.error.includes(apiToken));
const thrownApi = await genericApiHireConnector(apiEnv, (async () => {
  throw new Error(`connect failed ${apiToken}`);
}) as typeof fetch).call(call);
ok("generic api transport errors do not echo the bearer token", thrownApi.ok === false && !thrownApi.error.includes(apiToken));

let apiUnsafeCalls = 0;
const apiUnsafeFetch = (async () => {
  apiUnsafeCalls += 1;
  return responseWith(200, { id: "nope" });
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
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-1" });
  }
  if (body.method === "notifications/initialized") return responseWith(202, {});
  return responseWith(200, { result: { content: [{ type: "text", text: JSON.stringify({ id: "mcp-9" }) }] } });
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
    if (body.method === "tools/call") return responseWith(200, { result: false });
    if (body.method === "notifications/initialized") return responseWith(202, {});
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("a false mcp tool result is not a hire", falseMcp.ok === false && falseMcp.error === "mcp tool returned no record");
const emptyMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") return responseWith(200, { result: { content: [] } });
    if (body.method === "notifications/initialized") return responseWith(202, {});
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("an empty mcp tool result is not a hire", emptyMcp.ok === false && emptyMcp.error === "mcp tool returned no record");
const stringFalseMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") {
      return responseWith(200, { result: { content: [{ type: "text", text: "{\"result\":\"false\"}" }] } });
    }
    if (body.method === "notifications/initialized") return responseWith(202, {});
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp text that only says false is not a hire", stringFalseMcp.ok === false && stringFalseMcp.error === "mcp tool returned no record");

function sseResponse(events: unknown[], headers?: Record<string, string>) {
  const body = events.map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join("");
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
    if (body.method === "notifications/initialized") return responseWith(202, {});
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
    if (body.method === "notifications/initialized") return responseWith(202, {});
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp event-stream errors do not echo the bearer token", sseError.ok === false && sseError.error.includes("denied") && !sseError.error.includes(mcpToken));

const echoedMcp = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "tools/call") {
      return responseWith(200, { result: { isError: true, content: [{ type: "text", text: `denied ${mcpToken}` }] } });
    }
    if (body.method === "notifications/initialized") return responseWith(202, {});
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } });
  }) as typeof fetch,
).call(call);
ok("mcp errors do not echo the bearer token", echoedMcp.ok === false && !echoedMcp.error.includes(mcpToken));

let mcpUnsafeCalls = 0;
const mcpUnsafeFetch = (async () => {
  mcpUnsafeCalls += 1;
  return responseWith(200, { result: { content: [{ type: "text", text: "{\"id\":\"nope\"}" }] } });
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
  return responseWith(200, { id: "metadata" });
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

let missingConnectorFetches = 0;
const missingConnectorFetch = (async () => {
  missingConnectorFetches += 1;
  return responseWith(200, { id: "should-not-run" });
}) as typeof fetch;
const missingApi = await genericApiHireConnector(emptyEnv, missingConnectorFetch).call(call);
const missingMcp = await mcpToolHireConnector(emptyEnv, missingConnectorFetch).call(call);
ok("missing generic api env returns ok:false", missingApi.ok === false && missingApi.error.includes("HIRE_API_URL"));
ok("missing mcp env returns ok:false", missingMcp.ok === false && missingMcp.error.includes("HIRE_MCP_URL"));
ok("missing generic api and mcp env does not call fetch", missingConnectorFetches === 0);

let foreignOdooFetches = 0;
const foreignOdoo = await odooHireConnector(odooEnv, (async () => {
  foreignOdooFetches += 1;
  return jsonResponse(200, { result: 7 });
}) as typeof fetch).call({ ...call, model: "../admin" });
ok("odoo refuses a model outside hr.job and hr.applicant", foreignOdoo.ok === false && foreignOdooFetches === 0);

const odooThrown = await odooHireConnector(odooEnv, (async () => {
  throw new Error("connect failed secret");
}) as typeof fetch).call(call);
ok(
  "odoo transport errors stay in the result and do not echo the api key",
  odooThrown.ok === false && !odooThrown.error.includes("secret"),
);
const odooBadJson = await odooHireConnector(odooEnv, (async () => new Response("not-json", { status: 200 })) as typeof fetch).call(call);
ok("odoo invalid json stays in the result", odooBadJson.ok === false && !odooBadJson.error.includes("secret"));

const smartNumeric = await smartHireConnector(smartEnv, (async () => jsonResponse(200, { id: 15 })) as typeof fetch).call(call);
ok("smart accepts a positive numeric id", smartNumeric.ok === true && smartNumeric.ok && smartNumeric.id === "15");
const smartThrown = await smartHireConnector(smartEnv, (async () => {
  throw new Error("connect failed smart-token");
}) as typeof fetch).call(call);
ok(
  "smart transport errors stay in the result and do not echo the token",
  smartThrown.ok === false && !smartThrown.error.includes("smart-token"),
);
const smartBadJson = await smartHireConnector(smartEnv, (async () => new Response("not-json", { status: 200 })) as typeof fetch).call(call);
ok("smart invalid json stays in the result", smartBadJson.ok === false && !smartBadJson.error.includes("smart-token"));

let mcpToolCallsAfterFailedNotice = 0;
const mcpNotice = await mcpToolHireConnector(
  mcpEnv,
  (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (body.method === "tools/call") mcpToolCallsAfterFailedNotice += 1;
    if (body.method === "notifications/initialized") return responseWith(500, { error: "nope" });
    return responseWith(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-1" });
  }) as typeof fetch,
).call(call);
ok(
  "a failed mcp initialized notification does not call the tool",
  mcpNotice.ok === false && mcpNotice.error === "mcp initialized http 500" && mcpToolCallsAfterFailedNotice === 0,
);

const stateCalls: { init?: RequestInit }[] = [];
const stateWrite = await odooHireConnector(odooEnv, (async (_url: string, init?: RequestInit) => {
  stateCalls.push({ init });
  if (stateCalls.length === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(200, { result: true });
}) as typeof fetch).call({
  idempotencyKey: "hire-close",
  model: "hr.job",
  method: "write",
  values: { id: 11, state: "open", no_of_recruitment: 0 },
});
const stateBody = JSON.parse(String(stateCalls[1]?.init?.body)) as { params: { args: unknown[] } };
ok(
  "odoo hr.job write drops state and closes with no_of_recruitment only",
  stateWrite.ok === true &&
    JSON.stringify(stateBody.params.args[5]) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    Object.keys(stateBody.params.args[6] as object).length === 0 &&
    !JSON.stringify(stateBody).includes("state"),
);

console.log(`RESULT hire-connector: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
