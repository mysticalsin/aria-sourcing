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
const { hireFromSourcingScreen } = await import("../src/lib/sourcing-screen-hire.ts");
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

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const apiEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "api",
  HIRE_API_URL: "https://hire-api.example.test/",
  HIRE_API_TOKEN: "fixture-api",
};
const mcpEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "mcp",
  HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
  HIRE_MCP_TOKEN: "fixture-mcp",
  HIRE_MCP_TOOL: "hire",
};

let apiCalls = 0;
const apiFetch = (async () => {
  apiCalls += 1;
  return jsonResponse(200, { id: `api-${apiCalls}` });
}) as typeof fetch;

let mcpCalls = 0;
const mcpFetch = (async (_url: string, init?: RequestInit) => {
  mcpCalls += 1;
  const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
  if (body.method === "initialize") {
    return jsonResponse(200, { result: { serverInfo: { name: "fixture-hire" } } }, { "mcp-session-id": "fixture-session" });
  }
  if (body.method === "notifications/initialized") return jsonResponse(202, {});
  return jsonResponse(200, { result: { structuredContent: { id: `mcp-${mcpCalls}` } } });
}) as typeof fetch;

const person = {
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
};

const api = await runSourcingThroughHired({ ...person, idempotencyKey: "api-hire-1" }, apiEnv, apiFetch);
const mcp = await runSourcingThroughHired({ ...person, idempotencyKey: "mcp-hire-1" }, mcpEnv, mcpFetch);
const sharedId = api.employeeId;
ok(
  "a generic HTTPS API hire and an MCP hire return one shared positive employee id",
  api.ok === true &&
    api.erp === "api" &&
    mcp.ok === true &&
    mcp.erp === "mcp" &&
    sharedId === 1 &&
    mcp.employeeId === sharedId &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.model === "hr.employee" &&
    inMemoryEmployeeClient.employees[0]?.applicantId === "Fixture Candidate North" &&
    inMemoryEmployeeClient.employees[0]?.id === sharedId,
);

const stored = storeHiredEmployeeId({ stage: "Hired" }, sharedId ?? null);
const storedAgain = storeHiredEmployeeId(stored, mcp.employeeId ?? null);
const shown = candidateListHire(storedAgain);
const markup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: storedAgain }));
ok(
  "that employee id is stored so the candidate list shows it",
  storedAgain === stored &&
    stored.odooEmployeeId === 1 &&
    shown.hired === true &&
    shown.employeeId === 1 &&
    markup.includes("Hired") &&
    markup.includes("Employee 1") &&
    markup.includes('data-testid="candidate-employee-id"'),
);

const apiAgain = await runSourcingThroughHired({ ...person, idempotencyKey: "api-hire-2" }, apiEnv, apiFetch);
const mcpAgain = await runSourcingThroughHired({ ...person, idempotencyKey: "mcp-hire-2" }, mcpEnv, mcpFetch);
ok(
  "a second hire does not create a second employee",
  apiAgain.ok === true &&
    mcpAgain.ok === true &&
    apiAgain.employeeId === 1 &&
    mcpAgain.employeeId === 1 &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    apiCalls > 4 &&
    mcpCalls > 4,
);

const other = {
  ...person,
  applicant: { name: "Fixture Candidate South", email: "fixture.south@example.test" },
};
const apiOther = await runSourcingThroughHired({ ...other, idempotencyKey: "api-hire-south" }, apiEnv, apiFetch);
const mcpOther = await runSourcingThroughHired({ ...other, idempotencyKey: "mcp-hire-south" }, mcpEnv, mcpFetch);
ok(
  "a different hired person gets a new employee id",
  apiOther.employeeId === 2 &&
    mcpOther.employeeId === 2 &&
    inMemoryEmployeeClient.createCount === 2 &&
    inMemoryEmployeeClient.employees.length === 2,
);

let liveCalls = 0;
const screen = await hireFromSourcingScreen(
  { ...person, screen: "search", idempotencyKey: "screen-north" },
  { NODE_ENV: "test" },
  async () => {
    liveCalls += 1;
    throw new Error("socket open");
  },
);
ok(
  "the search hire returns the same stored employee id without a live fetch",
  liveCalls === 0 &&
    screen.ok === true &&
    screen.transport === "fixture" &&
    screen.employeeId === 1 &&
    inMemoryEmployeeClient.createCount === 2 &&
    inMemoryEmployeeClient.employees.length === 2,
);

const refused = await runSourcingThroughHired(
  {
    ...person,
    idempotencyKey: "api-hire-fail",
    applicant: { name: "Fixture Candidate West", email: "fixture.west@example.test" },
  },
  apiEnv,
  (async () => jsonResponse(200, { result: false })) as typeof fetch,
);
ok(
  "a failed hire does not create an employee",
  refused.ok === false &&
    refused.employeeId == null &&
    inMemoryEmployeeClient.createCount === 2 &&
    inMemoryEmployeeClient.employees.length === 2 &&
    inMemoryEmployeeClient.employees.every((row) => row.applicantId !== "Fixture Candidate West"),
);

const notHired = await runSourcingThroughHired(
  { ...person, idempotencyKey: "api-hire-offer", stage: "Offer" },
  apiEnv,
  apiFetch,
);
ok(
  "a stage other than Hired does not create an employee",
  notHired.ok === true &&
    notHired.erp === "api" &&
    notHired.employeeId == null &&
    inMemoryEmployeeClient.createCount === 2 &&
    inMemoryEmployeeClient.employees.length === 2,
);

const hireLib = readFileSync(new URL("../src/lib/hire-employee.ts", import.meta.url), "utf8");
const hireFn = hireLib.slice(hireLib.indexOf("export async function employeeIdForHiredPerson"), hireLib.indexOf("export class FakeOdooEmployeeClient"));
const pipeline = readFileSync(new URL("../src/lib/mcp-client.ts", import.meta.url), "utf8");
const erpFn = pipeline.slice(pipeline.indexOf("async function runErpHire"));
const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const remember = store.slice(store.indexOf("const rememberConnectorEmployee"), store.indexOf("const setCandidatePhone"));
const searchPage = readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8");
ok(
  "the API and MCP hires use the shared in-memory client and the list stores that id",
  hireFn.includes("inMemoryEmployeeClient") &&
    hireFn.includes("createEmployeeWhenHired") &&
    !hireFn.includes("fetch(") &&
    !/\bhttps?:\/\//.test(hireFn) &&
    erpFn.includes('erp !== "api" && erp !== "mcp"') &&
    erpFn.includes("employeeIdForHiredPerson(input.applicant.name)") &&
    !erpFn.includes("fetch(") &&
    remember.includes('withStage(cand, "Hired")') &&
    remember.includes("storeHiredEmployeeId(hired, employeeId)") &&
    !remember.includes("fetch(") &&
    searchPage.includes("actions.rememberConnectorEmployee(candidateId, employeeId)") &&
    socketOpens === 0,
);

console.log(`RESULT connector-hire-employee: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
