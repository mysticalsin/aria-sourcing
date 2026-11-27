import net from "node:net";
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

const { inMemoryEmployeeClient } = await import("../src/lib/hire-employee.ts");
const { runSourcingThroughHired } = await import("../src/lib/mcp-client.ts");
const pageMod = await import("../src/app/demo/hire/page.tsx");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const first = renderToStaticMarkup(await pageMod.default());
ok(
  "the synthetic hire page shows the employee id on the API and MCP hires it already marks hired",
  first.includes("hired") &&
    first.includes('data-testid="connector-api-employee"') &&
    first.includes('data-testid="connector-mcp-employee"') &&
    first.includes("Employee 1") &&
    !first.includes('data-testid="odoo-employee-id"') &&
    !first.includes('data-testid="connector-smart-employee"') &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    inMemoryEmployeeClient.employees[0]?.applicantId === "Fixture Candidate North" &&
    socketOpens === 0,
);

const failed = await runSourcingThroughHired(
  {
    idempotencyKey: "synthetic-hire-employee-fail",
    job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
    applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
    stage: "Hired",
  },
  {
    NODE_ENV: "test",
    HIRE_CONNECTOR: "api",
    HIRE_API_URL: "https://hire-api.example.test/",
    HIRE_API_TOKEN: "fixture-api",
  },
  (async () =>
    new Response(JSON.stringify({ error: "api down" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch,
);
const afterFail = renderToStaticMarkup(await pageMod.default());
ok(
  "a failed hire leaves the stored id on the synthetic hire page",
  failed.ok === false &&
    failed.employeeId == null &&
    inMemoryEmployeeClient.createCount === 1 &&
    inMemoryEmployeeClient.employees.length === 1 &&
    inMemoryEmployeeClient.employees[0]?.id === 1 &&
    afterFail.includes('data-testid="odoo-employee-id"') &&
    afterFail.includes('data-testid="connector-smart-employee"') &&
    afterFail.includes('data-testid="connector-api-employee"') &&
    afterFail.includes('data-testid="connector-mcp-employee"') &&
    afterFail.includes("Employee 1") &&
    !afterFail.includes("Employee 2") &&
    socketOpens === 0,
);

console.log(
  `PHYSICAL synthetic-hire-employee-id: shown=${afterFail.includes("Employee 1") ? 1 : "none"} createCount=${inMemoryEmployeeClient.createCount} failedHireLeftStoredId=${failed.employeeId == null && inMemoryEmployeeClient.employees[0]?.id === 1}`,
);
console.log(`RESULT synthetic-hire-employee-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
