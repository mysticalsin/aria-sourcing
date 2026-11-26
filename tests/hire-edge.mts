/**
 * Edge cases for the sourcing-to-hire path. Every fetch is injected.
 * Hosts are example.test or the documentation range 203.0.113.50.
 */
import { mcpToolHireConnector, odooHireConnector, smartHireConnector } from "../src/lib/hire-connector";
import { runSourcingThroughHired } from "../src/lib/mcp-client";

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
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const odooEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};

const applicant = { name: "Fixture Candidate North", email: "fixture.north@example.test" };
const job = { name: "Fixture Platform Role", department: "Fixture Delivery" };

function hireInput(idempotencyKey: string) {
  return { idempotencyKey, job, applicant, stage: "Hired" };
}

interface RpcBody {
  method?: string;
  params?: { method?: string; args?: unknown[] };
}

function parseBody(init?: RequestInit): RpcBody {
  return JSON.parse(String(init?.body ?? "{}")) as RpcBody;
}

function modelOf(body: RpcBody): unknown {
  return body.params?.args?.[3];
}

function methodOf(body: RpcBody): unknown {
  return body.params?.method === "authenticate" ? "authenticate" : body.params?.args?.[4];
}

/** Auth uid 7, job id 11, applicant id 12, write true. */
function successOdoo(extra?: (body: RpcBody) => Response | null): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = parseBody(init);
    const replaced = extra?.(body);
    if (replaced) return replaced;
    if (methodOf(body) === "authenticate") return jsonResponse(200, { result: 7 });
    if (methodOf(body) === "create" && modelOf(body) === "hr.job") return jsonResponse(200, { result: 11 });
    if (methodOf(body) === "create") return jsonResponse(200, { result: 12 });
    return jsonResponse(200, { result: true });
  }) as typeof fetch;
}

let repeatJobs = 0;
const repeat = successOdoo((body) => {
  if (methodOf(body) === "create" && modelOf(body) === "hr.job") repeatJobs += 1;
  return null;
});
const firstRepeat = await runSourcingThroughHired(hireInput("edge-repeat"), odooEnv, repeat);
const secondRepeat = await runSourcingThroughHired(hireInput("edge-repeat"), odooEnv, repeat);
ok(
  "a repeated hire with the same key does not create a second job",
  firstRepeat.ok === true && secondRepeat.ok === true && secondRepeat.erp === "odoo" && repeatJobs === 1,
);

let retryJobs = 0;
let retryApplicants = 0;
const retryFetch = (async (_url: string, init?: RequestInit) => {
  const body = parseBody(init);
  if (methodOf(body) === "authenticate") return jsonResponse(200, { result: 7 });
  if (methodOf(body) === "create" && modelOf(body) === "hr.job") {
    retryJobs += 1;
    return jsonResponse(200, { result: 11 });
  }
  if (modelOf(body) === "hr.applicant") {
    retryApplicants += 1;
    return jsonResponse(500, {});
  }
  return jsonResponse(200, { result: true });
}) as typeof fetch;
const firstRetry = await runSourcingThroughHired(hireInput("edge-retry"), odooEnv, retryFetch);
const secondRetry = await runSourcingThroughHired(hireInput("edge-retry"), odooEnv, retryFetch);
ok(
  "a retry after a failed applicant does not create the job again",
  firstRetry.ok === false && secondRetry.ok === false && retryJobs === 1 && retryApplicants === 2,
);

let concurrentAuth = 0;
let concurrentJobs = 0;
let releaseGate: () => void = () => {};
const gate = new Promise<void>((resolve) => {
  releaseGate = resolve;
});
let held = false;
const concurrentFetch = (async (_url: string, init?: RequestInit) => {
  const body = parseBody(init);
  if (methodOf(body) === "authenticate") {
    concurrentAuth += 1;
    if (!held) {
      held = true;
      await gate;
    }
    return jsonResponse(200, { result: 7 });
  }
  if (methodOf(body) === "create" && modelOf(body) === "hr.job") {
    concurrentJobs += 1;
    return jsonResponse(200, { result: 11 });
  }
  if (methodOf(body) === "create") return jsonResponse(200, { result: 12 });
  return jsonResponse(200, { result: true });
}) as typeof fetch;
const concurrentLeft = runSourcingThroughHired(hireInput("edge-concurrent"), odooEnv, concurrentFetch);
const concurrentRight = runSourcingThroughHired(hireInput("edge-concurrent"), odooEnv, concurrentFetch);
releaseGate();
const [leftResult, rightResult] = await Promise.all([concurrentLeft, concurrentRight]);
ok(
  "two overlapping hires share one job create",
  leftResult.ok === true && rightResult.ok === true && concurrentAuth === 3 && concurrentJobs === 1,
);

async function jobCreateResult(label: string, result: unknown) {
  let applicants = 0;
  const outcome = await runSourcingThroughHired(
    hireInput(`edge-job-${label}`),
    odooEnv,
    (async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (methodOf(body) === "authenticate") return jsonResponse(200, { result: 7 });
      if (methodOf(body) === "create" && modelOf(body) === "hr.job") return jsonResponse(200, { result });
      if (modelOf(body) === "hr.applicant") applicants += 1;
      return jsonResponse(200, { result: true });
    }) as typeof fetch,
  );
  ok(
    `a job create of ${label} does not create an applicant`,
    outcome.ok === false && outcome.error === "odoo execute_kw returned no record" && applicants === 0,
  );
}
await jobCreateResult("true", true);
await jobCreateResult("zero", 0);
await jobCreateResult("null", null);
await jobCreateResult("false", false);
await jobCreateResult("empty-list", []);

let partialCalls = 0;
const partialFetch = (async () => {
  partialCalls += 1;
  return jsonResponse(200, { result: 7 });
}) as typeof fetch;
const whitespace = await runSourcingThroughHired(
  hireInput("edge-whitespace"),
  { NODE_ENV: "test", ODOO_URL: "https://odoo.example.test/", ODOO_DB: " ", ODOO_USERNAME: "fixture-api", ODOO_API_KEY: " " },
  partialFetch,
);
const onlyUrl = await runSourcingThroughHired(
  hireInput("edge-only-url"),
  { NODE_ENV: "test", ODOO_URL: "https://odoo.example.test/" },
  partialFetch,
);
ok(
  "whitespace or incomplete Odoo env makes no request",
  whitespace.ok === true &&
    whitespace.erp === "skipped" &&
    onlyUrl.ok === true &&
    onlyUrl.erp === "skipped" &&
    partialCalls === 0,
);

function stageWrites(calls: RpcBody[]): number {
  return calls.filter((body) => JSON.stringify(body.params?.args?.[5] ?? null).includes("stage_id")).length;
}

for (const stage of ["0", "-3", "nope", "15.2", "+4", " 0 "]) {
  const calls: RpcBody[] = [];
  const outcome = await runSourcingThroughHired(
    hireInput(`edge-stage-${stage}`),
    { ...odooEnv, ODOO_HIRED_STAGE_ID: stage },
    successOdoo((body) => {
      calls.push(body);
      return null;
    }),
  );
  const stageStep = outcome.steps.find((step) => step.action === "stage");
  ok(
    `hired stage ${JSON.stringify(stage)} is skipped`,
    outcome.ok === true && stageStep?.skipped === true && stageWrites(calls) === 0,
  );
}

const goodStageCalls: RpcBody[] = [];
const goodStage = await runSourcingThroughHired(
  hireInput("edge-stage-15"),
  { ...odooEnv, ODOO_HIRED_STAGE_ID: " 15 " },
  successOdoo((body) => {
    goodStageCalls.push(body);
    return null;
  }),
);
ok("a positive hired stage id is written once", goodStage.ok === true && stageWrites(goodStageCalls) === 1);

let auth500 = 0;
const http500 = await runSourcingThroughHired(
  hireInput("edge-500"),
  odooEnv,
  (async () => {
    auth500 += 1;
    return jsonResponse(500, { error: { message: "fixture-key down" } });
  }) as typeof fetch,
);
ok(
  "an Odoo 500 stops before execute_kw and hides the key",
  http500.ok === false && http500.error === "odoo auth http 500" && auth500 === 1 && !http500.error.includes("fixture-key"),
);

let after404 = 0;
const http404 = await runSourcingThroughHired(
  hireInput("edge-404"),
  odooEnv,
  (async (_url: string, init?: RequestInit) => {
    after404 += 1;
    const body = parseBody(init);
    if (methodOf(body) === "authenticate") return jsonResponse(200, { result: 7 });
    return jsonResponse(404, {});
  }) as typeof fetch,
);
ok("an Odoo 404 stops the pipeline", http404.ok === false && http404.error === "odoo write http 404" && after404 === 2);

let smartCalls = 0;
const smartHttp = await smartHireConnector(
  { NODE_ENV: "test", SMART_URL: "https://smart.example.test/", SMART_TOKEN: "fixture-smart" },
  (async () => {
    smartCalls += 1;
    return jsonResponse(smartCalls === 1 ? 503 : 200, {});
  }) as typeof fetch,
).call({ idempotencyKey: "edge-smart-503", model: "hr.job", method: "create", values: { name: "Fixture Platform Role" } });
ok("a SMART 503 is a failed result", smartHttp.ok === false && smartHttp.error === "smart http 503" && smartCalls === 1);

let timeoutCalls = 0;
let timeoutThrew = false;
try {
  const timeout = await runSourcingThroughHired(
    hireInput("edge-timeout"),
    odooEnv,
    (async () => {
      timeoutCalls += 1;
      throw new Error("The operation was aborted due to timeout");
    }) as typeof fetch,
  );
  ok(
    "a rejected timeout stays in the result",
    timeout.ok === false && timeout.error === "The operation was aborted due to timeout" && timeoutCalls === 1,
  );
} catch {
  timeoutThrew = true;
}
ok("a rejected timeout does not throw", timeoutThrew === false);

async function expectFailure(name: string, run: () => Promise<{ ok: boolean; error?: string }>) {
  try {
    const result = await run();
    ok(name, result.ok === false && typeof result.error === "string" && result.error.length > 0);
  } catch (err) {
    console.log("THREW:", name, err instanceof Error ? err.message : err);
    ok(name, false);
  }
}

await expectFailure("a null JSON-RPC body stays in the result", () =>
  odooHireConnector(odooEnv, (async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch).call({
    idempotencyKey: "edge-null",
    model: "hr.job",
    method: "create",
    values: { name: "Fixture Platform Role" },
  }),
);

await expectFailure("a non-string JSON-RPC error stays in the result", () =>
  odooHireConnector(odooEnv, (async (_url: string, init?: RequestInit) => {
    const body = parseBody(init);
    if (methodOf(body) === "authenticate") return jsonResponse(200, { result: 7 });
    return jsonResponse(200, { error: { message: { nested: true }, data: { message: "Access Denied" } } });
  }) as typeof fetch).call({
    idempotencyKey: "edge-nested",
    model: "hr.job",
    method: "create",
    values: { name: "Fixture Platform Role" },
  }),
);

const mcpEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
  HIRE_MCP_TOKEN: "fixture-mcp",
  HIRE_MCP_TOOL: "hire",
};
const mcpCall = { idempotencyKey: "edge-mcp", model: "hr.job" as const, method: "create" as const, values: { name: "Fixture Platform Role" } };

const mcpDenied = await mcpToolHireConnector(mcpEnv, (async (_url: string, init?: RequestInit) => {
  const body = parseBody(init);
  if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { name: "fixture" } } });
  if (body.method === "notifications/initialized") return jsonResponse(202, {});
  return jsonResponse(200, { result: { isError: true, content: [{ type: "text", text: "denied" }] } });
}) as typeof fetch).call(mcpCall);
ok("an MCP tool error stays in the result", mcpDenied.ok === false && mcpDenied.error === "denied");

await expectFailure("a malformed MCP JSON-RPC error stays in the result", () =>
  mcpToolHireConnector(mcpEnv, (async (_url: string, init?: RequestInit) => {
    const body = parseBody(init);
    if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { name: "fixture" } } });
    if (body.method === "notifications/initialized") return jsonResponse(202, {});
    return jsonResponse(200, { error: { message: { code: 1 } } });
  }) as typeof fetch).call({ ...mcpCall, idempotencyKey: "edge-mcp-bad" }),
);

const seen: string[] = [];
const redirected = await odooHireConnector(odooEnv, (async (url: string, init?: RequestInit) => {
  seen.push(String(url));
  if (init?.redirect !== "error") seen.push("https://10.0.0.8/jsonrpc");
  return jsonResponse(302, {}, { location: "https://10.0.0.8/jsonrpc" });
}) as typeof fetch).call({
  idempotencyKey: "edge-redirect",
  model: "hr.job",
  method: "create",
  values: { name: "Fixture Platform Role" },
});
ok(
  "a redirect toward a private host is not followed",
  redirected.ok === false && seen.length === 1 && seen[0] === "https://odoo.example.test/jsonrpc" && !seen.some((url) => url.includes("10.0.0.8")),
);

console.log(`hire-edge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
