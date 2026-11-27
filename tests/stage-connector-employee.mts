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
const { createEmployeeForStage, inMemoryEmployeeClient } = await import("../src/lib/hire-employee.ts");
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

const east = {
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate East", email: "fixture.east@example.test" },
  stage: "Hired",
};

const stageFirst = await createEmployeeForStage(
  "Hired",
  { applicantId: "cand-east", name: "Fixture Candidate East" },
  inMemoryEmployeeClient,
);
const createsAfterStage = inMemoryEmployeeClient.createCount;
const apiAfterStage = await runSourcingThroughHired(
  { ...east, idempotencyKey: "api-after-stage-east" },
  apiEnv,
  apiFetch,
);
const eastRow = storeHiredEmployeeId({ stage: "Hired", odooEmployeeId: stageFirst.employeeId ?? undefined }, apiAfterStage.employeeId ?? null);
ok(
  "an API hire reuses the employee a stage hire already stored for that person",
  stageFirst.employeeId === 1 &&
    createsAfterStage === 1 &&
    apiAfterStage.ok === true &&
    apiAfterStage.erp === "api" &&
    apiAfterStage.employeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    inMemoryEmployeeClient.employees[0]?.name === "Fixture Candidate East" &&
    eastRow.odooEmployeeId === 1 &&
    listShows(eastRow, 1),
);

const smartHosts: string[] = [];
const smartAfterStage = await runSourcingThroughHired(
  { ...east, idempotencyKey: "smart-after-stage-east" },
  smartEnv,
  smartFetch(smartHosts),
);
ok(
  "a SMART hire returns that stored id and does not create a second employee",
  smartAfterStage.ok === true &&
    smartAfterStage.erp === "smart" &&
    smartAfterStage.employeeId === 1 &&
    smartHosts.length === 4 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1,
);

let failedFetches = 0;
const failed = await runSourcingThroughHired(
  { ...east, idempotencyKey: "api-fail-east" },
  apiEnv,
  (async () => {
    failedFetches += 1;
    return jsonResponse(500, { error: "api down" });
  }) as typeof fetch,
);
const afterFail = storeHiredEmployeeId(eastRow, failed.employeeId ?? null);
ok(
  "a failed hire leaves the stored id in place",
  failed.ok === false &&
    failed.employeeId == null &&
    failedFetches > 0 &&
    afterFail === eastRow &&
    afterFail.odooEmployeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    listShows(afterFail, 1) &&
    socketOpens === 0,
);

const west = {
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate West", email: "fixture.west@example.test" },
  stage: "Hired",
};
const apiFirst = await runSourcingThroughHired({ ...west, idempotencyKey: "api-before-stage-west" }, apiEnv, apiFetch);
const createsAfterApi = inMemoryEmployeeClient.createCount;
const stageAfterApi = await createEmployeeForStage(
  "Hired",
  { applicantId: "cand-west", name: "Fixture Candidate West" },
  inMemoryEmployeeClient,
);
const westRow = storeHiredEmployeeId(
  { stage: "Hired", odooEmployeeId: apiFirst.employeeId ?? undefined },
  stageAfterApi.employeeId,
);
ok(
  "a stage hire does not replace a stored employee id or create a second employee",
  apiFirst.ok === true &&
    apiFirst.employeeId === 2 &&
    createsAfterApi === 2 &&
    stageAfterApi.employeeId === 2 &&
    inMemoryEmployeeClient.createCount === 2 &&
    inMemoryEmployeeClient.employees.length === 2 &&
    westRow.odooEmployeeId === 2 &&
    listShows(westRow, 2) &&
    inMemoryEmployeeClient.employees.filter((row) => row.name === "Fixture Candidate West").length === 1,
);

console.log(
  `PHYSICAL stage-connector-employee: shown=${afterFail.odooEmployeeId} createCount=${inMemoryEmployeeClient.createCount} failedHireLeftStoredId=${afterFail.odooEmployeeId === 1 && failed.employeeId == null}`,
);
console.log(`RESULT stage-connector-employee: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
