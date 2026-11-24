import { readFileSync } from "node:fs";
import { envForHireRequest, runSourcingThroughHired } from "../src/lib/mcp-client";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
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

const input = {
  idempotencyKey: "hire-batch-1",
  job: { name: "Staff Engineer", department: "Engineering" },
  applicant: { name: "Ada Lovelace", email: "ada@example.test" },
  stage: "Hired",
};

const calls: { url: string; init?: RequestInit }[] = [];
let nextId = 10;
const fakeFetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string } };
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  nextId += 1;
  return jsonResponse(200, { result: nextId });
}) as typeof fetch;

const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const absent = await runSourcingThroughHired(input, emptyEnv, fakeFetch);
ok("Odoo and SMART absent still completes LinkedIn sourcing", absent.ok === true && absent.erp === "skipped" && absent.linkedIn === true && absent.steps.length === 0);
ok("absent ERP does not call fetch", calls.length === 0);

const partial = await runSourcingThroughHired(input, { NODE_ENV: "test", ODOO_URL: "https://odoo.example.test" }, fakeFetch);
ok("a partial Odoo env does not call fetch", partial.erp === "skipped" && calls.length === 0);

const odooEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "mantu",
  ODOO_USERNAME: "api",
  ODOO_API_KEY: "secret",
  SMART_URL: "https://smart.example.test",
  SMART_TOKEN: "smart-token",
};
const hired = await runSourcingThroughHired(input, odooEnv, fakeFetch);
ok("configured Odoo is preferred over SMART", hired.ok === true && hired.erp === "odoo" && hired.steps.map((step) => step.action).join(",") === "job,applicant,stage,hire");
ok("Odoo sends authenticate then execute_kw for each of the four steps", calls.length === 8);

function odooArgs(index: number) {
  return JSON.parse(String(calls[index]?.init?.body)) as {
    params: { service: string; method: string; args: unknown[] };
  };
}

ok("each Odoo step authenticates on jsonrpc", [0, 2, 4, 6].every((index) => calls[index]?.url === "https://odoo.example.test/jsonrpc" && odooArgs(index).params.method === "authenticate"));

const jobWrite = odooArgs(1);
const applicantWrite = odooArgs(3);
const stageWrite = odooArgs(5);
const hireWrite = odooArgs(7);
const kwargs = (body: { params: { args: unknown[] } }) => body.params.args[6] as Record<string, unknown>;
ok(
  "hr.job is created with the job name",
  jobWrite.params.method === "execute_kw" &&
    jobWrite.params.args[3] === "hr.job" &&
    jobWrite.params.args[4] === "create" &&
    kwargs(jobWrite).name === "Staff Engineer" &&
    kwargs(jobWrite).x_idempotency_key === "hire-batch-1:job",
);
ok(
  "hr.applicant is created against the new job",
  applicantWrite.params.args[3] === "hr.applicant" &&
    applicantWrite.params.args[4] === "create" &&
    kwargs(applicantWrite).job_id === "11" &&
    kwargs(applicantWrite).email === "ada@example.test",
);
ok(
  "stage write names the stage on that applicant",
  stageWrite.params.args[3] === "hr.applicant" &&
    stageWrite.params.args[4] === "write" &&
    kwargs(stageWrite).id === "12" &&
    kwargs(stageWrite).stage === "Hired",
);
ok(
  "hire write marks that applicant hired",
  hireWrite.params.args[3] === "hr.applicant" &&
    hireWrite.params.args[4] === "write" &&
    kwargs(hireWrite).id === "12" &&
    kwargs(hireWrite).hired === true &&
    kwargs(hireWrite).x_idempotency_key === "hire-batch-1:hire",
);

calls.length = 0;
const smartCalls: { url: string; init?: RequestInit }[] = [];
const smartFetch = (async (url: string, init?: RequestInit) => {
  smartCalls.push({ url, init });
  return jsonResponse(200, { id: `smart-${smartCalls.length}` });
}) as typeof fetch;
const smart = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", SMART_URL: "https://smart.example.test/", SMART_TOKEN: "smart-token" },
  smartFetch,
);
ok("SMART posts the four hire steps with a bearer token", smart.ok === true && smart.erp === "smart" && smartCalls.length === 4);
const smartHeaders = smartCalls.map((call) => new Headers(call.init?.headers));
const smartBodies = smartCalls.map((call) => JSON.parse(String(call.init?.body)) as { method: string; values: Record<string, unknown> });
ok(
  "SMART request shapes are bearer posts to the hire models",
  smartCalls.map((call) => call.url).join("|") ===
    "https://smart.example.test/api/hire/hr.job|https://smart.example.test/api/hire/hr.applicant|https://smart.example.test/api/hire/hr.applicant|https://smart.example.test/api/hire/hr.applicant" &&
    smartHeaders.every((headers) => headers.get("authorization") === "Bearer smart-token") &&
    smartBodies[0]?.method === "create" &&
    smartBodies[0]?.values.name === "Staff Engineer" &&
    smartHeaders[0]?.get("idempotency-key") === "hire-batch-1:job" &&
    smartBodies[3]?.method === "write" &&
    smartBodies[3]?.values.hired === true,
);

calls.length = 0;
let odooPosts = 0;
const failingFetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  odooPosts += 1;
  if (odooPosts === 1) return jsonResponse(200, { result: 7 });
  return jsonResponse(500, {});
}) as typeof fetch;
const failed = await runSourcingThroughHired(input, odooEnv, failingFetch);
ok("an Odoo HTTP error stops the pipeline before later writes", failed.ok === false && failed.error === "odoo write http 500" && calls.length === 2);

const route = readFileSync(new URL("../src/app/api/hire/route.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/lib/mcp-client.ts", import.meta.url), "utf8");
ok("the hire route is the HTTP entry for sourcing through hired", route.includes("runSourcingThroughHired") && /export const runtime\s*=\s*["']nodejs["']/.test(route));
const erpEnv: NodeJS.ProcessEnv = { ...odooEnv, NODE_ENV: "test" };
const demoEnv = envForHireRequest(erpEnv, false);
ok("demo hire env drops Odoo and SMART credentials", !demoEnv.ODOO_URL && !demoEnv.ODOO_API_KEY && !demoEnv.SMART_URL && !demoEnv.SMART_TOKEN);
ok("live hire env keeps Odoo credentials", envForHireRequest(erpEnv, true).ODOO_URL === erpEnv.ODOO_URL);
calls.length = 0;
const demoHire = await runSourcingThroughHired(input, demoEnv, fakeFetch);
ok("a demo hire never writes to the configured ERP", demoHire.erp === "skipped" && calls.length === 0);
ok("an open demo hire does not forward process.env", route.includes("envForHireRequest(process.env, supabaseEnabled)"));
ok("the MCP client does not call fetch directly", !/(?<!PublicUrl)\bfetch\s*\(/.test(client));

const partialApiCalls: unknown[] = [];
const partialApi = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", HIRE_API_URL: "https://hire-api.example.test" },
  (async () => {
    partialApiCalls.push(1);
    return jsonResponse(200, { id: "nope" });
  }) as typeof fetch,
);
ok("a partial generic api env does not call fetch", partialApi.erp === "skipped" && partialApi.linkedIn === true && partialApiCalls.length === 0);

type Captured = { url: string; init?: RequestInit };
const apiPipelineCalls: Captured[] = [];
let apiSeq = 0;
const apiFetch = (async (url: string, init?: RequestInit) => {
  apiPipelineCalls.push({ url, init });
  apiSeq += 1;
  return jsonResponse(200, { id: `api-${apiSeq}` });
}) as typeof fetch;
const apiEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_API_URL: "https://hire-api.example.test/",
  HIRE_API_TOKEN: "fake-api-token",
  ODOO_URL: "https://odoo.example.test",
  ODOO_DB: "mantu",
  ODOO_USERNAME: "api",
  ODOO_API_KEY: "secret",
};
const apiSelected = await runSourcingThroughHired(input, { ...apiEnv, HIRE_CONNECTOR: "api" }, apiFetch);
ok(
  "an explicit generic api connector hires alongside a configured Odoo env",
  apiSelected.ok === true &&
    apiSelected.erp === "api" &&
    apiSelected.linkedIn === true &&
    apiSelected.steps.map((step) => step.action).join(",") === "job,applicant,stage,hire",
);
ok(
  "generic api sends one post per hire step",
  apiPipelineCalls.length === 4 && apiPipelineCalls.every((entry) => entry.url.startsWith("https://hire-api.example.test/v1/hire/")),
);
const apiBodies = apiPipelineCalls.map((entry) => JSON.parse(String(entry.init?.body)) as { method: string; values: Record<string, unknown> });
ok(
  "generic api creates the job, the applicant, the stage, then the hire",
  apiPipelineCalls[0]?.url.endsWith("/hr.job") &&
    apiBodies[0]?.method === "create" &&
    apiBodies[0]?.values.name === "Staff Engineer" &&
    apiPipelineCalls[1]?.url.endsWith("/hr.applicant") &&
    apiBodies[1]?.values.job_id === "api-1" &&
    apiBodies[1]?.values.email === "ada@example.test" &&
    apiBodies[2]?.method === "write" &&
    apiBodies[2]?.values.id === "api-2" &&
    apiBodies[2]?.values.stage === "Hired" &&
    apiBodies[3]?.values.hired === true &&
    apiBodies[3]?.values.id === "api-2" &&
    new Headers(apiPipelineCalls[3]?.init?.headers).get("idempotency-key") === "hire-batch-1:hire",
);

const mcpPipelineCalls: Captured[] = [];
let mcpSeq = 0;
const mcpFetch = (async (url: string, init?: RequestInit) => {
  mcpPipelineCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { method?: string };
  if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-9" });
  if (body.method === "notifications/initialized") return jsonResponse(202, {});
  mcpSeq += 1;
  return jsonResponse(200, {
    result: { structuredContent: { id: `mcp-${mcpSeq}` }, content: [{ type: "text", text: JSON.stringify({ id: `mcp-${mcpSeq}` }) }] },
  });
}) as typeof fetch;
const mcpHired = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", HIRE_MCP_URL: "https://hire-mcp.example.test/mcp", HIRE_MCP_TOKEN: "fake-mcp-token" },
  mcpFetch,
);
const toolArgs = mcpPipelineCalls
  .map((entry) => JSON.parse(String(entry.init?.body)) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } })
  .filter((body) => body.method === "tools/call")
  .map((body) => body.params?.arguments ?? {});
ok(
  "mcp tool connector takes the applicant from job through hired",
  mcpHired.ok === true && mcpHired.erp === "mcp" && mcpHired.linkedIn === true && toolArgs.length === 4,
);
ok(
  "mcp tool arguments chain the job and applicant ids",
  toolArgs[0]?.model === "hr.job" &&
    (toolArgs[0]?.values as { name?: string }).name === "Staff Engineer" &&
    toolArgs[1]?.model === "hr.applicant" &&
    (toolArgs[1]?.values as { job_id?: string }).job_id === "mcp-1" &&
    (toolArgs[2]?.values as { stage?: string; id?: string }).stage === "Hired" &&
    (toolArgs[2]?.values as { id?: string }).id === "mcp-2" &&
    (toolArgs[3]?.values as { hired?: boolean }).hired === true &&
    mcpPipelineCalls.every((entry) => entry.url === "https://hire-mcp.example.test/mcp"),
);

let stopped = 0;
const failedApi = await runSourcingThroughHired(input, { ...apiEnv, HIRE_CONNECTOR: "api" }, (async () => {
  stopped += 1;
  if (stopped === 1) return jsonResponse(200, { result: false });
  return jsonResponse(200, { id: "later" });
}) as typeof fetch);
ok("a false generic api result stops the pipeline before later writes", failedApi.ok === false && failedApi.erp === "api" && stopped === 1);

const aheadCalls: Captured[] = [];
let aheadId = 10;
const aheadFetch = (async (url: string, init?: RequestInit) => {
  aheadCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string } };
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  aheadId += 1;
  return jsonResponse(200, { result: aheadId });
}) as typeof fetch;
const odooAhead = await runSourcingThroughHired(
  input,
  {
    NODE_ENV: "test",
    ODOO_URL: "https://odoo.example.test/",
    ODOO_DB: "mantu",
    ODOO_USERNAME: "api",
    ODOO_API_KEY: "secret",
    HIRE_API_URL: "https://hire-api.example.test",
    HIRE_API_TOKEN: "fake-api-token",
    HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
    HIRE_MCP_TOKEN: "fake-mcp-token",
  },
  aheadFetch,
);
ok(
  "configured Odoo stays ahead of the generic api and mcp",
  odooAhead.ok === true && odooAhead.erp === "odoo" && aheadCalls.length === 8 && aheadCalls.every((entry) => entry.url === "https://odoo.example.test/jsonrpc"),
);

const smartAheadCalls: Captured[] = [];
const smartAhead = await runSourcingThroughHired(
  input,
  {
    NODE_ENV: "test",
    SMART_URL: "https://smart.example.test/",
    SMART_TOKEN: "smart-token",
    HIRE_API_URL: "https://hire-api.example.test",
    HIRE_API_TOKEN: "fake-api-token",
    HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
    HIRE_MCP_TOKEN: "fake-mcp-token",
  },
  (async (url: string, init?: RequestInit) => {
    smartAheadCalls.push({ url, init });
    return jsonResponse(200, { id: `smart-${smartAheadCalls.length}` });
  }) as typeof fetch,
);
ok(
  "configured SMART stays ahead of the generic api and mcp",
  smartAhead.ok === true &&
    smartAhead.erp === "smart" &&
    smartAheadCalls.length === 4 &&
    smartAheadCalls.every((entry) => entry.url.startsWith("https://smart.example.test/api/hire/")),
);

const apiAheadCalls: Captured[] = [];
const apiAhead = await runSourcingThroughHired(
  input,
  {
    NODE_ENV: "test",
    HIRE_API_URL: "https://hire-api.example.test/",
    HIRE_API_TOKEN: "fake-api-token",
    HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
    HIRE_MCP_TOKEN: "fake-mcp-token",
  },
  (async (url: string, init?: RequestInit) => {
    apiAheadCalls.push({ url, init });
    return jsonResponse(200, { id: `api-ahead-${apiAheadCalls.length}` });
  }) as typeof fetch,
);
ok(
  "configured generic api stays ahead of mcp",
  apiAhead.ok === true && apiAhead.erp === "api" && apiAheadCalls.length === 4 && apiAheadCalls.every((entry) => entry.url.includes("/v1/hire/")),
);

let invalidCalls = 0;
const invalidConnector = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", HIRE_CONNECTOR: "linkedin", ODOO_URL: "https://odoo.example.test", ODOO_DB: "mantu", ODOO_USERNAME: "api", ODOO_API_KEY: "secret" },
  (async () => {
    invalidCalls += 1;
    return jsonResponse(200, { id: "nope" });
  }) as typeof fetch,
);
ok(
  "an unknown HIRE_CONNECTOR does not call fetch",
  invalidConnector.ok === false && invalidConnector.linkedIn === true && invalidConnector.erp === "skipped" && invalidCalls === 0,
);

const connectorDemo = envForHireRequest(
  {
    ...apiEnv,
    SMART_URL: "https://smart.example.test",
    SMART_TOKEN: "smart-token",
    HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
    HIRE_MCP_TOKEN: "fake-mcp-token",
    HIRE_MCP_TOOL: "hire",
    HIRE_CONNECTOR: "api",
  },
  false,
);
ok(
  "demo hire env drops generic api and mcp credentials",
  !connectorDemo.HIRE_API_URL &&
    !connectorDemo.HIRE_API_TOKEN &&
    !connectorDemo.HIRE_MCP_URL &&
    !connectorDemo.HIRE_MCP_TOKEN &&
    !connectorDemo.HIRE_MCP_TOOL &&
    !connectorDemo.HIRE_CONNECTOR &&
    !connectorDemo.ODOO_API_KEY &&
    !connectorDemo.SMART_TOKEN,
);

console.log(`RESULT hire-pipeline: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
