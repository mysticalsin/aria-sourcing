import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createFakeOdooFetch, odooExecuteResponse } from "../src/lib/fake-odoo";
import { fetchPublicUrl } from "../src/lib/api/public-fetch";
import { clearHireIdempotency, envForHireRequest, hireEnvForRoute, runSourcingThroughHired as runSourcingThroughHiredRaw } from "../src/lib/mcp-client";

async function runSourcingThroughHired(
  input: Parameters<typeof runSourcingThroughHiredRaw>[0],
  env?: Parameters<typeof runSourcingThroughHiredRaw>[1],
  fetchImpl?: Parameters<typeof runSourcingThroughHiredRaw>[2],
) {
  clearHireIdempotency();
  return runSourcingThroughHiredRaw(input, env, fetchImpl);
}
import { runSyntheticHireDemo } from "../src/lib/synthetic-hire-demo";

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
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string; args?: unknown[] } };
  return odooExecuteResponse(body, () => {
    nextId += 1;
    return nextId;
  });
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
ok(
  "Odoo skips the stage write when no hired stage id is configured",
  calls.length === 6 && hired.steps[2]?.skipped === true && hired.steps[2]?.reason === "Hired stage id is not configured.",
);

function odooArgs(index: number) {
  return JSON.parse(String(calls[index]?.init?.body)) as {
    params: { service: string; method: string; args: unknown[] };
  };
}

ok("each Odoo step authenticates on jsonrpc", [0, 2, 4].every((index) => calls[index]?.url === "https://odoo.example.test/jsonrpc" && odooArgs(index).params.method === "authenticate"));

const jobWrite = odooArgs(1);
const applicantWrite = odooArgs(3);
const hireWrite = odooArgs(5);
const positional = (body: { params: { args: unknown[] } }) => body.params.args[5];
ok(
  "hr.job is created with the job name as positional vals",
  jobWrite.params.method === "execute_kw" &&
    jobWrite.params.args[3] === "hr.job" &&
    jobWrite.params.args[4] === "create" &&
    JSON.stringify(positional(jobWrite)) === JSON.stringify([[{ name: "Staff Engineer" }]]) &&
    Object.keys(jobWrite.params.args[6] as object).length === 0,
);
ok(
  "hr.applicant is created with email_from and the new job id",
  applicantWrite.params.args[3] === "hr.applicant" &&
    applicantWrite.params.args[4] === "create" &&
    JSON.stringify(positional(applicantWrite)) ===
      JSON.stringify([[{ name: "Ada Lovelace", partner_name: "Ada Lovelace", email_from: "ada@example.test", job_id: 11 }]]),
);
ok(
  "hire write closes that job instead of sending hired true",
  hireWrite.params.args[3] === "hr.job" &&
    hireWrite.params.args[4] === "write" &&
    JSON.stringify(positional(hireWrite)) === JSON.stringify([[11], { no_of_recruitment: 0 }]),
);
const rejectedState = await odooExecuteResponse(
  {
    params: {
      method: "execute_kw",
      args: ["mantu", 7, "secret", "hr.job", "write", [[11], { state: "open", no_of_recruitment: 0 }], {}],
    },
  },
  () => 0,
).json();
ok(
  "the fake Odoo rejects an unknown hr.job field before a hire can succeed",
  (rejectedState as { error?: { message?: string } }).error?.message === "ValueError: Invalid field 'state' on model 'hr.job'",
);
const writeTrue = await odooExecuteResponse(
  {
    params: {
      method: "execute_kw",
      args: ["mantu", 7, "secret", "hr.job", "write", [[11], { no_of_recruitment: 0 }], {}],
    },
  },
  () => 99,
).json();
ok(
  "a fake Odoo write returns true and does not mint a new record id",
  (writeTrue as { result?: unknown }).result === true,
);

calls.length = 0;
nextId = 10;
const alpha = await runSourcingThroughHired(
  { ...input, idempotencyKey: "hire-alpha", job: { name: "Need Alpha", department: "Platform" } },
  odooEnv,
  fakeFetch,
);
const beta = await runSourcingThroughHired(
  { ...input, idempotencyKey: "hire-beta", job: { name: "Need Beta", department: "Design" } },
  odooEnv,
  fakeFetch,
);
const executed = calls
  .map((call) => JSON.parse(String(call.init?.body)) as { params: { method: string; args: unknown[] } })
  .filter((body) => body.params.method === "execute_kw");
const createdJobs = executed.filter((body) => body.params.args[3] === "hr.job" && body.params.args[4] === "create");
const closedJobs = executed.filter((body) => body.params.args[3] === "hr.job" && body.params.args[4] === "write");
ok(
  "one successful hire closes that need and does not close a different need",
  alpha.ok === true &&
    beta.ok === true &&
    createdJobs.length === 2 &&
    closedJobs.length === 2 &&
    JSON.stringify(createdJobs[0]?.params.args[5]) === JSON.stringify([[{ name: "Need Alpha" }]]) &&
    JSON.stringify(createdJobs[1]?.params.args[5]) === JSON.stringify([[{ name: "Need Beta" }]]) &&
    JSON.stringify(closedJobs[0]?.params.args[5]) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    JSON.stringify(closedJobs[1]?.params.args[5]) === JSON.stringify([[13], { no_of_recruitment: 0 }]),
);

const stagedCalls: { url: string; init?: RequestInit }[] = [];
let stagedId = 20;
const staged = await runSourcingThroughHired(
  input,
  { ...odooEnv, ODOO_HIRED_STAGE_ID: "15" },
  (async (url: string, init?: RequestInit) => {
    stagedCalls.push({ url, init });
    const body = JSON.parse(String(init?.body)) as { params?: { method?: string; args?: unknown[] } };
    return odooExecuteResponse(body, () => {
      stagedId += 1;
      return stagedId;
    });
  }) as typeof fetch,
);
const stageBody = JSON.parse(String(stagedCalls[5]?.init?.body)) as { params: { args: unknown[] } };
ok(
  "a configured hired stage id is a positional stage_id write",
  staged.ok === true &&
    staged.steps[2]?.skipped !== true &&
    stageBody.params.args[3] === "hr.applicant" &&
    stageBody.params.args[4] === "write" &&
    JSON.stringify(stageBody.params.args[5]) === JSON.stringify([[22], { stage_id: 15 }]),
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
ok(
  "demo hire env drops the hired stage id",
  !envForHireRequest({ ...odooEnv, ODOO_HIRED_STAGE_ID: "15" }, false).ODOO_HIRED_STAGE_ID &&
    envForHireRequest({ ...odooEnv, ODOO_HIRED_STAGE_ID: "15" }, true).ODOO_HIRED_STAGE_ID === "15",
);
ok("live hire env keeps Odoo credentials", envForHireRequest(erpEnv, true).ODOO_URL === erpEnv.ODOO_URL);
calls.length = 0;
const demoHire = await runSourcingThroughHired(input, demoEnv, fakeFetch);
ok("a demo hire never writes to the configured ERP", demoHire.erp === "skipped" && calls.length === 0);
ok(
  "the hire route forwards runtime env and does not use the fake Odoo",
  route.includes("hireEnvForRoute(process.env, supabaseEnabled)") &&
    route.includes("runSourcingThroughHired") &&
    !route.includes("createFakeOdooFetch") &&
    !route.includes("SYNTHETIC_ODOO_ENV"),
);
const hireSource = client.slice(client.indexOf("export function hireEnvForRoute"));
ok(
  "the hire path does not call fetch directly",
  hireSource.includes("runSourcingThroughHired") && !/(?<!PublicUrl)\bfetch\s*\(/.test(hireSource),
);

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
  const body = JSON.parse(String(init?.body)) as { params?: { method?: string; args?: unknown[] } };
  return odooExecuteResponse(body, () => {
    aheadId += 1;
    return aheadId;
  });
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
  odooAhead.ok === true && odooAhead.erp === "odoo" && aheadCalls.length === 6 && aheadCalls.every((entry) => entry.url === "https://odoo.example.test/jsonrpc"),
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

const synthetic = await runSyntheticHireDemo();
const closedStep = synthetic.hired.steps.find((step) => step.action === "hire");
ok(
  "synthetic fixture hire closes that vacancy with no_of_recruitment only",
  synthetic.hired.ok === true &&
    synthetic.hired.erp === "odoo" &&
    synthetic.hired.linkedIn === true &&
    synthetic.fixture.applicantName === "Fixture Candidate North" &&
    synthetic.fixture.provenance === "synthetic" &&
    JSON.stringify(synthetic.vacancyClose) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    !JSON.stringify(synthetic.vacancyClose).includes("state") &&
    closedStep?.model === "hr.job" &&
    closedStep.method === "write" &&
    closedStep.id === "11",
);
ok(
  "synthetic demo talks only to the in-repo fake Odoo",
  synthetic.odooHosts.length > 0 && synthetic.odooHosts.every((url) => url === "https://odoo.example.test/jsonrpc"),
);
ok(
  "unset connector on the synthetic fixture returns erp skipped and linkedIn true",
  synthetic.unset.ok === true &&
    synthetic.unset.erp === "skipped" &&
    synthetic.unset.linkedIn === true &&
    synthetic.unset.steps.length === 0 &&
    synthetic.unset.fetchCount === 0,
);
ok(
  "synthetic odoo write keeps the created job id and empty kwargs",
  synthetic.jobCreateId === "11" &&
    JSON.stringify(synthetic.vacancyKwargs) === "{}" &&
    synthetic.hrJobStateSent === false &&
    synthetic.hrJobFields.includes("name") &&
    synthetic.hrJobFields.includes("no_of_recruitment") &&
    !synthetic.hrJobFields.includes("state"),
);
ok(
  "synthetic SMART, generic api, and MCP each hire on a fixture host",
  synthetic.connectors.map((item) => item.erp).join(",") === "smart,api,mcp" &&
    synthetic.connectors.every(
      (item) =>
        item.hired === true &&
        item.ok === true &&
        item.linkedIn === true &&
        item.hosts.length > 0 &&
        item.hosts.every((host) => host.startsWith("https://") && new URL(host).hostname.endsWith(".example.test")),
    ),
);
function linkedInUrlCount(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>)]+/g)) {
    let host = "";
    try {
      host = new URL(match[0]).hostname;
    } catch {
      continue;
    }
    const labels = host.split(".").filter((label) => label.length > 0);
    if (labels.slice(-2).join(".") === "linkedin.com") count += 1;
  }
  return count;
}
const demoSource = readFileSync(new URL("../src/lib/synthetic-hire-demo.ts", import.meta.url), "utf8");
const demoPage = readFileSync(new URL("../src/app/demo/hire/page.tsx", import.meta.url), "utf8");
ok(
  "the synthetic hire demo does not call LinkedIn",
  linkedInUrlCount(demoSource) === 0 &&
    linkedInUrlCount(demoPage) === 0 &&
    linkedInUrlCount('fetch("https://api.linkedin.com/v2/me")') === 1 &&
    linkedInUrlCount('fetch("https://linkedin.com.evil.test/in/fixture")') === 0,
);
const syntheticApplicantId = synthetic.hired.steps.find((step) => step.action === "applicant" && step.model === "hr.applicant")?.id;
ok(
  "the synthetic hire screen shows the employee id from a successful Odoo hire",
  synthetic.hired.ok === true &&
    synthetic.hired.erp === "odoo" &&
    syntheticApplicantId === "12" &&
    synthetic.employeeId === 1 &&
    demoPage.includes("Employee id") &&
    demoPage.includes('data-testid="employee-id">{demo.employeeId ?? ""}'),
);

const runtimeOdoo: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};
const forwarded = hireEnvForRoute(runtimeOdoo, false);
ok(
  "runtime Odoo credentials stay on the live hire path",
  forwarded.ODOO_URL === runtimeOdoo.ODOO_URL &&
    forwarded.ODOO_DB === "fixture" &&
    forwarded.ODOO_USERNAME === "fixture-api" &&
    forwarded.ODOO_API_KEY === "fixture-key",
);
const absentRuntime = hireEnvForRoute({ NODE_ENV: "test" }, false);
ok("missing runtime credentials are not invented", !absentRuntime.ODOO_URL && !absentRuntime.ODOO_DB && !absentRuntime.ODOO_API_KEY);

let liveTransportCalled = false;
try {
  await fetchPublicUrl("https://127.0.0.1/jsonrpc", { method: "POST", body: "{}" });
  liveTransportCalled = true;
} catch {
  liveTransportCalled = false;
}
ok("the live transport refuses loopback before a request", liveTransportCalled === false);

let metadataCalled = false;
try {
  await fetchPublicUrl("http://169.254.169.254/jsonrpc");
  metadataCalled = true;
} catch {
  metadataCalled = false;
}
ok("the live transport refuses the metadata host", metadataCalled === false);
ok("the synthetic demo module does not read process.env", !demoSource.includes("process.env"));

const liveCredentialNames = ["ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_API_KEY"] as const;
ok(
  "this process has no live Odoo credentials to spend",
  liveCredentialNames.every((name) => !process.env[name]),
);

const liveFixture = {
  idempotencyKey: "live-path-fixture",
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
};
const liveEnv = hireEnvForRoute(
  {
    NODE_ENV: "test",
    ODOO_URL: "https://odoo.example.test/",
    ODOO_DB: "fixture",
    ODOO_USERNAME: "fixture-api",
    ODOO_API_KEY: "fixture-key",
  },
  false,
);
const liveFake = createFakeOdooFetch(10);
const liveHired = await runSourcingThroughHired(liveFixture, liveEnv, liveFake.fetch);
const liveExecute = liveFake.calls
  .map((call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } })
  .filter((body) => body.params?.method === "execute_kw");
const liveClose = liveExecute.find((body) => body.params?.args?.[3] === "hr.job" && body.params.args[4] === "write");
ok(
  "the live env selector hires on the fake Odoo when the four variables are set",
  !liveEnv.HIRE_CONNECTOR &&
    liveHired.ok === true &&
    liveHired.erp === "odoo" &&
    liveHired.linkedIn === true &&
    liveHired.steps.map((step) => `${step.action}:${step.skipped === true ? "skipped" : "written"}`).join(",") ===
      "job:written,applicant:written,stage:skipped,hire:written" &&
    JSON.stringify(liveClose?.params?.args?.[5]) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    JSON.stringify(liveClose?.params?.args?.[6]) === "{}" &&
    liveFake.calls.every((call) => call.url === "https://odoo.example.test/jsonrpc"),
);

const stagedLive = createFakeOdooFetch(10);
const stagedLiveResult = await runSourcingThroughHired(
  liveFixture,
  hireEnvForRoute({ ...liveEnv, ODOO_HIRED_STAGE_ID: "15" }, false),
  stagedLive.fetch,
);
const stagedWrite = stagedLive.calls
  .map((call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } })
  .find((body) => body.params?.args?.[3] === "hr.applicant" && body.params.args[4] === "write");
ok(
  "the same live path writes the hired stage when that id is set",
  stagedLiveResult.ok === true &&
    stagedLiveResult.steps[2]?.skipped !== true &&
    JSON.stringify(stagedWrite?.params?.args?.[5]) === JSON.stringify([[12], { stage_id: 15 }]),
);

// 203.0.113.50 is RFC 5737 TEST-NET-3. The public-URL check accepts it without DNS.
// global fetch is the in-repo fake, so the route's live transport never opens a socket.
const routeFake = createFakeOdooFetch(10);
const previousFetch = globalThis.fetch;
const previousEnv = {
  ODOO_URL: process.env.ODOO_URL,
  ODOO_DB: process.env.ODOO_DB,
  ODOO_USERNAME: process.env.ODOO_USERNAME,
  ODOO_API_KEY: process.env.ODOO_API_KEY,
  ODOO_HIRED_STAGE_ID: process.env.ODOO_HIRED_STAGE_ID,
  HIRE_CONNECTOR: process.env.HIRE_CONNECTOR,
};
process.env.ODOO_URL = "https://203.0.113.50/";
process.env.ODOO_DB = "fixture";
process.env.ODOO_USERNAME = "fixture-api";
process.env.ODOO_API_KEY = "fixture-key";
delete process.env.ODOO_HIRED_STAGE_ID;
delete process.env.HIRE_CONNECTOR;
globalThis.fetch = routeFake.fetch;
let routeStatus = 0;
let routeBody: { ok?: boolean; erp?: string; linkedIn?: boolean; steps?: { action: string; skipped?: boolean }[] } = {};
try {
  const { POST } = await import("../src/app/api/hire/route.ts");
  const response = await POST(
    new NextRequest("http://127.0.0.1:3456/api/hire", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3456" },
      body: JSON.stringify(liveFixture),
    }),
  );
  routeStatus = response.status;
  routeBody = (await response.json()) as typeof routeBody;
} finally {
  globalThis.fetch = previousFetch;
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
const routeClose = routeFake.calls
  .map((call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } })
  .find((body) => body.params?.method === "execute_kw" && body.params.args?.[3] === "hr.job" && body.params.args[4] === "write");
const routeStateSent = routeFake.calls.some((call) => {
  const body = JSON.parse(String(call.init?.body ?? "{}")) as { params?: { args?: unknown[] } };
  return JSON.stringify(body.params?.args?.[5] ?? null).includes('"state"');
});
ok(
  "POST /api/hire follows the live path onto the fake Odoo when the four variables are set",
  routeStatus === 200 &&
    routeBody.ok === true &&
    routeBody.erp === "odoo" &&
    routeBody.linkedIn === true &&
    routeBody.steps?.map((step) => step.action).join(",") === "job,applicant,stage,hire" &&
    routeBody.steps?.[2]?.skipped === true &&
    JSON.stringify(routeClose?.params?.args?.[5]) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    JSON.stringify(routeClose?.params?.args?.[6]) === "{}" &&
    routeStateSent === false &&
    routeFake.calls.length === 6 &&
    routeFake.calls.every((call) => call.url === "https://203.0.113.50/jsonrpc"),
);
ok(
  "the route proof removed the fixture credentials from the process",
  liveCredentialNames.every((name) => !process.env[name]),
);

console.log(`RESULT hire-pipeline: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
