import { readFileSync } from "node:fs";
import net from "node:net";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let socketOpens = 0;
function refuseSocket(): never {
  socketOpens += 1;
  throw new Error("socket open");
}
net.Socket.prototype.connect = refuseSocket as typeof net.Socket.prototype.connect;
net.connect = refuseSocket as typeof net.connect;
net.createConnection = refuseSocket as typeof net.createConnection;
globalThis.fetch = refuseSocket as typeof fetch;

const { runSourcingThroughHired } = await import("../src/lib/mcp-client.ts");
const { inMemoryEmployeeClient } = await import("../src/lib/hire-employee.ts");
const { candidateListHire, storeHiredEmployeeId } = await import("../src/lib/candidate-list-hire.ts");
const { CandidateListHireStatus } = await import("../src/components/candidates/candidate-list-hire.tsx");
const { createFakeOdooFetch } = await import("../src/lib/fake-odoo.ts");
const { SYNTHETIC_ODOO_ENV } = await import("../src/lib/synthetic-hire-demo.ts");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function listShows(row: { stage: "Hired"; odooEmployeeId?: number }, id: number): boolean {
  const shown = candidateListHire(row);
  const markup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: row }));
  return (
    shown.hired === true &&
    shown.employeeId === id &&
    markup.includes("Hired") &&
    markup.includes(`Employee ${id}`) &&
    markup.includes('data-testid="candidate-employee-id"')
  );
}

const apiEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "api",
  HIRE_API_URL: "https://hire-api.example.test/",
  HIRE_API_TOKEN: "fixture-api",
};

let apiCalls = 0;
const apiFetch = (async () => {
  apiCalls += 1;
  return jsonResponse(200, { id: `api-${apiCalls}` });
}) as typeof fetch;

const person = {
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
};

const api = await runSourcingThroughHired({ ...person, idempotencyKey: "api-before-odoo" }, apiEnv, apiFetch);
const storedId = api.employeeId;
const stored = storeHiredEmployeeId({ stage: "Hired" }, storedId ?? null);
ok(
  "a generic API hire stores one positive employee id",
  api.ok === true &&
    api.erp === "api" &&
    storedId === 1 &&
    stored.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    listShows(stored, 1),
);

const odoo = createFakeOdooFetch();
const hired = await runSourcingThroughHired({ ...person, idempotencyKey: "synthetic-odoo-same" }, SYNTHETIC_ODOO_ENV, odoo.fetch);
const afterOdoo = storeHiredEmployeeId(stored, hired.employeeId ?? null);
ok(
  "a synthetic Odoo hire returns that id and does not create a second employee",
  hired.ok === true &&
    hired.erp === "odoo" &&
    hired.employeeId === 1 &&
    hired.steps.some((step) => step.action === "stage" && step.skipped === true) &&
    odoo.calls.length > 0 &&
    odoo.calls.every((call) => call.url === "https://odoo.example.test/jsonrpc") &&
    afterOdoo === stored &&
    afterOdoo.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    inMemoryEmployeeClient.employees[0]?.applicantId === "Fixture Candidate North" &&
    listShows(afterOdoo, 1),
);

const odooAgain = createFakeOdooFetch();
const hiredAgain = await runSourcingThroughHired({ ...person, idempotencyKey: "synthetic-odoo-again" }, SYNTHETIC_ODOO_ENV, odooAgain.fetch);
ok(
  "a second synthetic Odoo hire still returns the stored id",
  hiredAgain.ok === true &&
    hiredAgain.employeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1,
);

let failedFetches = 0;
const failed = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-odoo-fail" },
  SYNTHETIC_ODOO_ENV,
  (async () => {
    failedFetches += 1;
    return jsonResponse(200, { error: { message: "odoo down" } });
  }) as typeof fetch,
);
const afterFail = storeHiredEmployeeId(afterOdoo, failed.employeeId ?? null);
ok(
  "a failed Odoo hire does not clear the stored id",
  failed.ok === false &&
    failed.erp === "odoo" &&
    failed.employeeId == null &&
    failedFetches > 0 &&
    afterFail === afterOdoo &&
    afterFail.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    listShows(afterFail, 1),
);

let skippedFetches = 0;
const skipped = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-odoo-skip" },
  { NODE_ENV: "test", ODOO_URL: "   ", ODOO_DB: " ", ODOO_USERNAME: " ", ODOO_API_KEY: " " },
  (async () => {
    skippedFetches += 1;
    throw new Error("socket open");
  }) as typeof fetch,
);
const afterSkip = storeHiredEmployeeId(afterFail, skipped.employeeId ?? null);
ok(
  "a skipped Odoo hire does not clear the stored id",
  skipped.ok === true &&
    skipped.erp === "skipped" &&
    skipped.employeeId == null &&
    skippedFetches === 0 &&
    afterSkip === afterFail &&
    afterSkip.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    listShows(afterSkip, 1) &&
    socketOpens === 0,
);

const other = createFakeOdooFetch();
const otherHire = await runSourcingThroughHired(
  {
    ...person,
    idempotencyKey: "synthetic-odoo-south",
    applicant: { name: "Fixture Candidate South", email: "fixture.south@example.test" },
  },
  SYNTHETIC_ODOO_ENV,
  other.fetch,
);
const southRow = storeHiredEmployeeId({ stage: "Hired", odooEmployeeId: 1 }, otherHire.employeeId ?? null);
ok(
  "an Odoo hire with no stored id does not create an employee or clear another row",
  otherHire.ok === true &&
    otherHire.erp === "odoo" &&
    otherHire.employeeId == null &&
    southRow.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees.every((row) => row.applicantId !== "Fixture Candidate South"),
);

const hireLib = readFileSync(new URL("../src/lib/hire-employee.ts", import.meta.url), "utf8");
const lookup = hireLib.slice(hireLib.indexOf("export async function storedEmployeeIdForPerson"));
const pipeline = readFileSync(new URL("../src/lib/mcp-client.ts", import.meta.url), "utf8");
const odooFn = pipeline.slice(pipeline.indexOf("async function runOdooHire"), pipeline.indexOf("async function runErpHire"));
ok(
  "the Odoo hire reads the in-memory id and does not open a socket",
  lookup.includes("inMemoryEmployeeClient.findByApplicant(applicantId)") &&
    !lookup.includes(".create(") &&
    !lookup.includes("fetch(") &&
    !/\bhttps?:\/\//.test(lookup) &&
    odooFn.includes('if (!closed.ok) return { ok: false, erp: "odoo", linkedIn: true, steps, error: closed.error };') &&
    odooFn.includes("storedEmployeeIdForPerson(input.applicant.name)") &&
    !odooFn.includes("employeeIdForHiredPerson") &&
    !odooFn.includes(".create(") &&
    !odooFn.includes("fetch(") &&
    socketOpens === 0,
);

console.log(`RESULT odoo-shared-employee-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
