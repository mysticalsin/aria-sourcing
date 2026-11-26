import { createFakeOdooFetch, type RecordedOdooCall } from "@/lib/fake-odoo";
import { createEmployeeForStage, FakeOdooEmployeeClient } from "@/lib/hire-employee";
import { runSourcingThroughHired, type SourcingThroughHiredResult, type SourcingThroughHiredStep } from "@/lib/mcp-client";

/**
 * Fixture for the sourcing-to-hired demo. Names are labels, not people.
 * Every connector talks to an in-process stub. Nothing here calls LinkedIn,
 * Azure, or a live ERP.
 */
export const SYNTHETIC_HIRE_FIXTURE = {
  idempotencyKey: "synthetic-fixture-hire",
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
} as const;

export const SYNTHETIC_ODOO_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "odoo",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};

export interface SyntheticConnectorDemo {
  erp: "smart" | "api" | "mcp";
  label: string;
  ok: boolean;
  linkedIn: boolean;
  hired: boolean;
  hosts: string[];
}

export interface SyntheticHireDemo {
  fixture: {
    jobName: string;
    department: string;
    applicantName: string;
    email: string;
    provenance: "synthetic";
  };
  unset: {
    ok: boolean;
    erp: SourcingThroughHiredResult["erp"];
    linkedIn: boolean;
    steps: SourcingThroughHiredStep[];
    fetchCount: number;
  };
  hired: SourcingThroughHiredResult;
  /** Positional `execute_kw` args for the vacancy close, or null when it did not run. */
  vacancyClose: unknown;
  /** Keyword args on that same write. Real Odoo rejects a non-empty object. */
  vacancyKwargs: unknown;
  /** Id returned by the hr.job create that the close write addresses. */
  jobCreateId: string | null;
  /** Field names sent on hr.job create and write. */
  hrJobFields: string[];
  /** True when any hr.job call carried a `state` field. */
  hrJobStateSent: boolean;
  connectors: SyntheticConnectorDemo[];
  odooHosts: string[];
  /** hr.employee id from the in-memory fake after a successful Odoo hire, otherwise null. */
  employeeId: number | null;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recordedFetch(
  hosts: string[],
  respond: (init: RequestInit | undefined, index: number) => Response,
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    hosts.push(String(url));
    return respond(init, hosts.length);
  }) as typeof fetch;
}

function rpcBodies(calls: RecordedOdooCall[]) {
  return calls.map(
    (call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } },
  );
}

function hasStateKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasStateKey(item));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "state" || hasStateKey(child));
}

function hrJobVals(method: unknown, positional: unknown): Record<string, unknown> | null {
  if (!Array.isArray(positional)) return null;
  if (method === "create") {
    const rows = positional[0];
    const vals = Array.isArray(rows) ? rows[0] : undefined;
    if (vals && typeof vals === "object" && !Array.isArray(vals)) return vals as Record<string, unknown>;
    return null;
  }
  if (method === "write") {
    const vals = positional[1];
    if (vals && typeof vals === "object" && !Array.isArray(vals)) return vals as Record<string, unknown>;
  }
  return null;
}

function hrJobWriteFacts(calls: RecordedOdooCall[]): { fields: string[]; stateSent: boolean } {
  const fields = new Set<string>();
  let stateSent = false;
  for (const body of rpcBodies(calls)) {
    if (body.params?.method !== "execute_kw" || body.params.args?.[3] !== "hr.job") continue;
    const positional = body.params.args[5];
    const kwargs = body.params.args[6];
    if (hasStateKey(positional) || hasStateKey(kwargs)) stateSent = true;
    const vals = hrJobVals(body.params.args[4], positional);
    if (!vals) continue;
    for (const field of Object.keys(vals)) fields.add(field);
  }
  if (fields.has("state")) stateSent = true;
  return { fields: [...fields].sort(), stateSent };
}

function shownConnector(
  erp: SyntheticConnectorDemo["erp"],
  label: string,
  result: SourcingThroughHiredResult,
  hosts: string[],
): SyntheticConnectorDemo {
  const closed = result.steps.some((step) => step.action === "hire" && step.ok && step.skipped !== true);
  return {
    erp,
    label,
    ok: result.ok,
    linkedIn: result.linkedIn,
    hired: result.ok && result.linkedIn && result.erp === erp && closed,
    hosts,
  };
}

export async function runSyntheticHireDemo(): Promise<SyntheticHireDemo> {
  let unsetFetches = 0;
  const unset = await runSourcingThroughHired(
    SYNTHETIC_HIRE_FIXTURE,
    { NODE_ENV: "test" },
    (async () => {
      unsetFetches += 1;
      throw new Error("unset connector must not fetch");
    }) as typeof fetch,
  );

  const odoo = createFakeOdooFetch();
  const hired = await runSourcingThroughHired(SYNTHETIC_HIRE_FIXTURE, SYNTHETIC_ODOO_ENV, odoo.fetch);
  const employeeId = await employeeIdFromOdooHire(hired);
  const vacancy = rpcBodies(odoo.calls).find(
    (body) => body.params?.method === "execute_kw" && body.params.args?.[3] === "hr.job" && body.params.args?.[4] === "write",
  );
  const vacancyClose = vacancy?.params?.args?.[5] ?? null;
  const vacancyKwargs = vacancy?.params?.args?.[6] ?? null;
  const jobFacts = hrJobWriteFacts(odoo.calls);

  const smartHosts: string[] = [];
  const smart = await runSourcingThroughHired(
    SYNTHETIC_HIRE_FIXTURE,
    {
      NODE_ENV: "test",
      HIRE_CONNECTOR: "smart",
      SMART_URL: "https://smart.example.test/",
      SMART_TOKEN: "fixture-smart",
    },
    recordedFetch(smartHosts, (_init, index) => jsonResponse(200, { id: `smart-${index}` })),
  );

  const apiHosts: string[] = [];
  const api = await runSourcingThroughHired(
    SYNTHETIC_HIRE_FIXTURE,
    {
      NODE_ENV: "test",
      HIRE_CONNECTOR: "api",
      HIRE_API_URL: "https://hire-api.example.test/",
      HIRE_API_TOKEN: "fixture-api",
    },
    recordedFetch(apiHosts, (_init, index) => jsonResponse(200, { id: `api-${index}` })),
  );

  const mcpHosts: string[] = [];
  const mcp = await runSourcingThroughHired(
    SYNTHETIC_HIRE_FIXTURE,
    {
      NODE_ENV: "test",
      HIRE_CONNECTOR: "mcp",
      HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
      HIRE_MCP_TOKEN: "fixture-mcp",
      HIRE_MCP_TOOL: "hire",
    },
    recordedFetch(mcpHosts, (init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "initialize") {
        return jsonResponse(200, { result: { serverInfo: { name: "fixture-hire" } } }, { "mcp-session-id": "fixture-session" });
      }
      if (body.method === "notifications/initialized") return jsonResponse(202, {});
      const toolCalls = mcpHosts.filter((host) => host.length > 0).length;
      return jsonResponse(200, { result: { structuredContent: { id: `mcp-${toolCalls}` } } });
    }),
  );

  return {
    fixture: {
      jobName: SYNTHETIC_HIRE_FIXTURE.job.name,
      department: SYNTHETIC_HIRE_FIXTURE.job.department,
      applicantName: SYNTHETIC_HIRE_FIXTURE.applicant.name,
      email: SYNTHETIC_HIRE_FIXTURE.applicant.email,
      provenance: "synthetic",
    },
    unset: {
      ok: unset.ok,
      erp: unset.erp,
      linkedIn: unset.linkedIn,
      steps: unset.steps,
      fetchCount: unsetFetches,
    },
    hired,
    vacancyClose,
    vacancyKwargs,
    jobCreateId: hired.steps.find((step) => step.action === "job" && step.method === "create")?.id ?? null,
    hrJobFields: jobFacts.fields,
    hrJobStateSent: jobFacts.stateSent,
    connectors: [
      shownConnector("smart", "SMART", smart, smartHosts),
      shownConnector("api", "generic HTTPS API", api, apiHosts),
      shownConnector("mcp", "MCP", mcp, mcpHosts),
    ],
    odooHosts: odoo.calls.map((call) => call.url),
    employeeId,
  };
}

/**
 * Employee id for a successful Odoo hire. The client is the in-memory fake.
 * A hire that did not succeed returns null and does not call the client.
 */
async function employeeIdFromOdooHire(hired: SourcingThroughHiredResult): Promise<number | null> {
  if (!hired.ok || hired.erp !== "odoo") return null;
  const applicantId = hired.steps.find((step) => step.action === "applicant" && step.model === "hr.applicant" && step.ok)?.id;
  if (!applicantId) return null;
  const recorded = await createEmployeeForStage(
    SYNTHETIC_HIRE_FIXTURE.stage,
    { applicantId, name: SYNTHETIC_HIRE_FIXTURE.applicant.name },
    new FakeOdooEmployeeClient(),
  );
  return recorded.employeeId;
}
