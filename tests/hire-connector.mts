import {
  linkedInSourcingRunsWithoutErp,
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
ok(
  "odoo execute_kw uses the authenticated uid and idempotency key",
  odooCalls[1]?.url === "https://odoo.example.test/jsonrpc" &&
    writeBody.params.service === "object" &&
    writeBody.params.method === "execute_kw" &&
    Array.isArray(writeBody.params.args) &&
    writeBody.params.args[1] === 7 &&
    writeBody.params.args[3] === "hr.applicant" &&
    writeBody.params.args[4] === "create" &&
    (writeBody.params.args[6] as { x_idempotency_key?: string }).x_idempotency_key === "hire-1",
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

ok("linkedin gating stays true with empty env", linkedInSourcingRunsWithoutErp(emptyEnv) === true);
ok(
  "linkedin gating stays true when ERP urls are set",
  linkedInSourcingRunsWithoutErp({
    NODE_ENV: "test",
    ODOO_URL: "https://odoo.example.test",
    SMART_URL: "https://smart.example.test",
  } satisfies NodeJS.ProcessEnv) === true,
);

console.log(`RESULT hire-connector: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
