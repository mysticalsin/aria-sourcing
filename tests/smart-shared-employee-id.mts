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

const smartEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "smart",
  SMART_URL: "https://smart.example.test/",
  SMART_TOKEN: "fixture-smart",
};

let apiCalls = 0;
const apiFetch = (async () => {
  apiCalls += 1;
  return jsonResponse(200, { id: `api-${apiCalls}` });
}) as typeof fetch;

function smartFetch(hosts: string[]): typeof fetch {
  return (async (url: string) => {
    hosts.push(String(url));
    return jsonResponse(200, { id: `smart-${hosts.length}` });
  }) as typeof fetch;
}

const person = {
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
};

const api = await runSourcingThroughHired({ ...person, idempotencyKey: "api-before-smart" }, apiEnv, apiFetch);
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

const smartHosts: string[] = [];
const hired = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-smart-same" },
  smartEnv,
  smartFetch(smartHosts),
);
const afterSmart = storeHiredEmployeeId(stored, hired.employeeId ?? null);
ok(
  "a synthetic SMART hire returns that id and does not create a second employee",
  hired.ok === true &&
    hired.erp === "smart" &&
    hired.employeeId === 1 &&
    smartHosts.length === 4 &&
    smartHosts.every((host) => host.startsWith("https://smart.example.test/api/hire/")) &&
    afterSmart === stored &&
    afterSmart.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    inMemoryEmployeeClient.employees[0]?.applicantId === "Fixture Candidate North" &&
    listShows(afterSmart, 1),
);

const smartAgainHosts: string[] = [];
const hiredAgain = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-smart-again" },
  smartEnv,
  smartFetch(smartAgainHosts),
);
ok(
  "a second synthetic SMART hire still returns the stored id",
  hiredAgain.ok === true &&
    hiredAgain.employeeId === 1 &&
    smartAgainHosts.length === 4 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1,
);

let failedFetches = 0;
const failed = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-smart-fail" },
  smartEnv,
  (async () => {
    failedFetches += 1;
    return jsonResponse(500, { error: "smart down" });
  }) as typeof fetch,
);
const afterFail = storeHiredEmployeeId(afterSmart, failed.employeeId ?? null);
ok(
  "a failed SMART hire does not clear the stored id",
  failed.ok === false &&
    failed.erp === "smart" &&
    failed.employeeId == null &&
    failedFetches > 0 &&
    afterFail === afterSmart &&
    afterFail.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    listShows(afterFail, 1),
);

let skippedFetches = 0;
const skipped = await runSourcingThroughHired(
  { ...person, idempotencyKey: "synthetic-smart-skip" },
  { NODE_ENV: "test", SMART_URL: "   ", SMART_TOKEN: " " },
  (async () => {
    skippedFetches += 1;
    throw new Error("socket open");
  }) as typeof fetch,
);
const afterSkip = storeHiredEmployeeId(afterFail, skipped.employeeId ?? null);
ok(
  "a skipped SMART hire does not clear the stored id",
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

const otherHosts: string[] = [];
const otherHire = await runSourcingThroughHired(
  {
    ...person,
    idempotencyKey: "synthetic-smart-south",
    applicant: { name: "Fixture Candidate South", email: "fixture.south@example.test" },
  },
  smartEnv,
  smartFetch(otherHosts),
);
const southRow = storeHiredEmployeeId({ stage: "Hired", odooEmployeeId: 1 }, otherHire.employeeId ?? null);
ok(
  "a SMART hire with no stored id does not create an employee or clear another row",
  otherHire.ok === true &&
    otherHire.erp === "smart" &&
    otherHire.employeeId == null &&
    otherHosts.length === 4 &&
    southRow.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees.every((row) => row.applicantId !== "Fixture Candidate South"),
);

const hireLib = readFileSync(new URL("../src/lib/hire-employee.ts", import.meta.url), "utf8");
const lookup = hireLib.slice(hireLib.indexOf("export async function storedEmployeeIdForPerson"));
const pipeline = readFileSync(new URL("../src/lib/mcp-client.ts", import.meta.url), "utf8");
const smartFn = pipeline.slice(pipeline.indexOf('if (erp === "smart")'), pipeline.indexOf('if (erp !== "api" && erp !== "mcp")'));
ok(
  "the SMART hire reads the in-memory id and does not open a socket",
  lookup.includes("inMemoryEmployeeClient.findByApplicant(applicantId)") &&
    !lookup.includes(".create(") &&
    !lookup.includes("fetch(") &&
    !/\bhttps?:\/\//.test(lookup) &&
    smartFn.includes("storedEmployeeIdForPerson(input.applicant.name)") &&
    !smartFn.includes("employeeIdForHiredPerson") &&
    !smartFn.includes(".create(") &&
    !smartFn.includes("fetch(") &&
    socketOpens === 0,
);

console.log(`RESULT smart-shared-employee-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
