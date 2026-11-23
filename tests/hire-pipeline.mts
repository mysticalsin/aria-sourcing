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

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
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

console.log(`RESULT hire-pipeline: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
