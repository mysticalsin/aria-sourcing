import { envForHireRequest, runSourcingThroughHired } from "../src/lib/hire-connector.ts";

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

const input = {
  idempotencyKey: "hire-batch-1",
  job: { name: "Staff Engineer", department: "Engineering" },
  applicant: { name: "Ada Lovelace", email: "ada@example.test" },
  stage: "Hired",
};

const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const absentCalls: unknown[] = [];
const absent = await runSourcingThroughHired(input, emptyEnv, (async () => {
  absentCalls.push(1);
  return jsonResponse(200, { id: "nope" });
}) as typeof fetch);
ok(
  "no connector configured still completes LinkedIn sourcing",
  absent.ok === true && absent.erp === "skipped" && absent.linkedIn === true && absent.steps.length === 0 && absentCalls.length === 0,
);

const partialCalls: unknown[] = [];
const partial = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", HIRE_API_URL: "https://hire-api.example.test" },
  (async () => {
    partialCalls.push(1);
    return jsonResponse(200, { id: "nope" });
  }) as typeof fetch,
);
ok("a partial generic api env does not call fetch", partial.erp === "skipped" && partial.linkedIn === true && partialCalls.length === 0);

type Captured = { url: string; init?: RequestInit };
const apiCalls: Captured[] = [];
let apiSeq = 0;
const apiFetch = (async (url: string, init?: RequestInit) => {
  apiCalls.push({ url, init });
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
  ODOO_API_KEY: "fake-odoo-key",
};
const apiSelected = await runSourcingThroughHired(input, { ...apiEnv, HIRE_CONNECTOR: "api" }, apiFetch);
ok(
  "an explicit generic api connector hires alongside a configured Odoo env",
  apiSelected.ok === true &&
    apiSelected.erp === "api" &&
    apiSelected.linkedIn === true &&
    apiSelected.steps.map((step) => step.action).join(",") === "job,applicant,stage,hire",
);
ok("generic api sends one post per hire step", apiCalls.length === 4 && apiCalls.every((entry) => entry.url.startsWith("https://hire-api.example.test/v1/hire/")));
const apiBodies = apiCalls.map((entry) => JSON.parse(String(entry.init?.body)) as { method: string; values: Record<string, unknown> });
ok(
  "generic api creates the job, the applicant, the stage, then the hire",
  apiCalls[0]?.url.endsWith("/hr.job") &&
    apiBodies[0]?.method === "create" &&
    apiBodies[0]?.values.name === "Staff Engineer" &&
    apiCalls[1]?.url.endsWith("/hr.applicant") &&
    apiBodies[1]?.values.job_id === "api-1" &&
    apiBodies[1]?.values.email === "ada@example.test" &&
    apiBodies[2]?.method === "write" &&
    apiBodies[2]?.values.id === "api-2" &&
    apiBodies[2]?.values.stage === "Hired" &&
    apiBodies[3]?.values.hired === true &&
    apiBodies[3]?.values.id === "api-2" &&
    new Headers(apiCalls[3]?.init?.headers).get("idempotency-key") === "hire-batch-1:hire",
);

const mcpCalls: Captured[] = [];
let mcpSeq = 0;
const mcpFetch = (async (url: string, init?: RequestInit) => {
  mcpCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { method?: string };
  if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { name: "fake-hire" } } }, { "mcp-session-id": "sess-9" });
  if (body.method === "notifications/initialized") return jsonResponse(202, {});
  mcpSeq += 1;
  return jsonResponse(200, { result: { structuredContent: { id: `mcp-${mcpSeq}` }, content: [{ type: "text", text: JSON.stringify({ id: `mcp-${mcpSeq}` }) }] } });
}) as typeof fetch;

const mcpEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
  HIRE_MCP_TOKEN: "fake-mcp-token",
};
const mcpHired = await runSourcingThroughHired(input, mcpEnv, mcpFetch);
const toolArgs = mcpCalls
  .map((entry) => JSON.parse(String(entry.init?.body)) as { method?: string; params?: { arguments?: Record<string, unknown> } })
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
    (toolArgs[3]?.values as { hired?: boolean }).hired === true,
);

let stopped = 0;
const failed = await runSourcingThroughHired(input, { ...apiEnv, HIRE_CONNECTOR: "api" }, (async () => {
  stopped += 1;
  if (stopped === 1) return jsonResponse(200, { result: false });
  return jsonResponse(200, { id: "later" });
}) as typeof fetch);
ok("a false generic api result stops the pipeline before later writes", failed.ok === false && failed.erp === "api" && stopped === 1);

const odooCalls: Captured[] = [];
let odooId = 10;
const odooFetch = (async (url: string, init?: RequestInit) => {
  odooCalls.push({ url, init });
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string } };
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  odooId += 1;
  return jsonResponse(200, { result: odooId });
}) as typeof fetch;
const odooHired = await runSourcingThroughHired(
  input,
  { NODE_ENV: "test", ODOO_URL: "https://odoo.example.test/", ODOO_DB: "mantu", ODOO_USERNAME: "api", ODOO_API_KEY: "fake-odoo-key", HIRE_API_URL: "https://hire-api.example.test", HIRE_API_TOKEN: "fake-api-token" },
  odooFetch,
);
ok(
  "configured Odoo stays ahead of the generic api",
  odooHired.ok === true && odooHired.erp === "odoo" && odooCalls.length === 8 && odooCalls.every((entry) => entry.url === "https://odoo.example.test/jsonrpc"),
);

const demoEnv = envForHireRequest(
  { ...apiEnv, ...mcpEnv, SMART_URL: "https://smart.example.test", SMART_TOKEN: "fake-smart-token", HIRE_CONNECTOR: "api" },
  false,
);
ok(
  "demo hire env drops every connector credential",
  !demoEnv.ODOO_URL && !demoEnv.ODOO_API_KEY && !demoEnv.SMART_TOKEN && !demoEnv.HIRE_API_URL && !demoEnv.HIRE_API_TOKEN && !demoEnv.HIRE_MCP_URL && !demoEnv.HIRE_MCP_TOKEN && !demoEnv.HIRE_CONNECTOR,
);
const demoCalls: unknown[] = [];
const demoHire = await runSourcingThroughHired(input, demoEnv, (async () => {
  demoCalls.push(1);
  return jsonResponse(200, { id: "nope" });
}) as typeof fetch);
ok("a demo hire with no connector configured skips ERP and still runs LinkedIn", demoHire.ok === true && demoHire.erp === "skipped" && demoHire.linkedIn === true && demoCalls.length === 0);

console.log(`RESULT hire-pipeline: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
