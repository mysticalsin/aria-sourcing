import { fetchPublicUrl } from "@/lib/api/public-fetch";
import {
  connectorRuntimeConfigured,
  hireEnvForRoute,
  runSourcingThroughHired,
  type SourcingThroughHiredStep,
} from "@/lib/mcp-client";

/**
 * Sourcing screens call the same hire function as POST /api/hire.
 * With no live connector, fixture env runs SMART, the generic HTTPS API, and MCP
 * on in-process stubs, and the unset case stays skipped. A complete runtime
 * connector uses the public HTTPS transport. No host is guessed.
 */
export const SOURCING_SCREENS = ["search", "shortlist", "candidate", "command"] as const;
export type SourcingScreen = (typeof SOURCING_SCREENS)[number];

export interface SourcingScreenHireInput {
  screen: SourcingScreen;
  idempotencyKey: string;
  job: { name: string; department?: string };
  applicant: { name: string; email?: string };
  stage: string;
}

export interface SourcingScreenHireStep {
  action: SourcingThroughHiredStep["action"];
  model: string;
  method: string;
  ok: boolean;
  id?: string;
  skipped?: boolean;
  reason?: string;
}

export interface SourcingScreenFixtureConnector {
  erp: "smart" | "api" | "mcp";
  hired: boolean;
  ok: boolean;
  linkedIn: boolean;
  hosts: string[];
}

export interface SourcingScreenHireResult {
  ok: boolean;
  erp: "odoo" | "smart" | "api" | "mcp" | "skipped";
  linkedIn: boolean;
  screen: SourcingScreen;
  transport: "fixture" | "live";
  steps: SourcingScreenHireStep[];
  vacancyClose: unknown;
  vacancyKwargs: unknown;
  hrJobStateSent: boolean;
  unset?: { ok: boolean; erp: "skipped" | "odoo" | "smart" | "api" | "mcp"; linkedIn: boolean; fetchCount: number };
  connectors?: SourcingScreenFixtureConnector[];
  error?: string;
  /** Positive hr.employee id from the in-memory client when this hire has one. */
  employeeId?: number | null;
}

type HireFetch = (url: string, init?: RequestInit) => Promise<Response>;

const FIXTURE_SMART_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "smart",
  SMART_URL: "https://smart.example.test/",
  SMART_TOKEN: "fixture-smart",
};

const FIXTURE_API_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "api",
  HIRE_API_URL: "https://hire-api.example.test/",
  HIRE_API_TOKEN: "fixture-api",
};

const FIXTURE_MCP_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HIRE_CONNECTOR: "mcp",
  HIRE_MCP_URL: "https://hire-mcp.example.test/mcp",
  HIRE_MCP_TOKEN: "fixture-mcp",
  HIRE_MCP_TOOL: "hire",
};

function shownStep(step: SourcingThroughHiredStep): SourcingScreenHireStep {
  return {
    action: step.action,
    model: step.model,
    method: step.method,
    ok: step.ok,
    id: step.id,
    skipped: step.skipped,
    reason: step.reason,
  };
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
): HireFetch {
  return (async (url: string, init?: RequestInit) => {
    hosts.push(String(url));
    return respond(init, hosts.length);
  }) as HireFetch;
}

function fixtureConnector(
  erp: SourcingScreenFixtureConnector["erp"],
  result: Awaited<ReturnType<typeof runSourcingThroughHired>>,
  hosts: string[],
): SourcingScreenFixtureConnector {
  const closed = result.steps.some((step) => step.action === "hire" && step.ok && step.skipped !== true);
  return {
    erp,
    ok: result.ok,
    linkedIn: result.linkedIn,
    hired: result.ok && result.linkedIn && result.erp === erp && closed,
    hosts,
  };
}

export function isSourcingScreen(value: string): value is SourcingScreen {
  return (SOURCING_SCREENS as readonly string[]).includes(value);
}

async function hireWithFixtureConnectors(
  input: SourcingScreenHireInput,
  payload: {
    idempotencyKey: string;
    job: { name: string; department?: string };
    applicant: { name: string; email?: string };
    stage: string;
  },
): Promise<SourcingScreenHireResult> {
  let unsetFetches = 0;
  const unset = await runSourcingThroughHired(payload, { NODE_ENV: "test" }, (async () => {
    unsetFetches += 1;
    throw new Error("unset connector must not fetch");
  }) as HireFetch);

  const smartHosts: string[] = [];
  const smart = await runSourcingThroughHired(
    { ...payload, idempotencyKey: `${payload.idempotencyKey}:smart` },
    FIXTURE_SMART_ENV,
    recordedFetch(smartHosts, (_init, index) => jsonResponse(200, { id: `smart-${index}` })),
  );

  const apiHosts: string[] = [];
  const api = await runSourcingThroughHired(
    { ...payload, idempotencyKey: `${payload.idempotencyKey}:api` },
    FIXTURE_API_ENV,
    recordedFetch(apiHosts, (_init, index) => jsonResponse(200, { id: `api-${index}` })),
  );

  const mcpHosts: string[] = [];
  const mcp = await runSourcingThroughHired(
    { ...payload, idempotencyKey: `${payload.idempotencyKey}:mcp` },
    FIXTURE_MCP_ENV,
    recordedFetch(mcpHosts, (init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "initialize") {
        return jsonResponse(200, { result: { serverInfo: { name: "fixture-hire" } } }, { "mcp-session-id": "fixture-session" });
      }
      if (body.method === "notifications/initialized") return jsonResponse(202, {});
      return jsonResponse(200, { result: { structuredContent: { id: `mcp-${mcpHosts.length}` } } });
    }),
  );

  const connectors = [
    fixtureConnector("smart", smart, smartHosts),
    fixtureConnector("api", api, apiHosts),
    fixtureConnector("mcp", mcp, mcpHosts),
  ];
  const allHired = connectors.every((connector) => connector.hired);
  const unsetSkipped = unset.ok === true && unset.erp === "skipped" && unset.linkedIn === true && unsetFetches === 0;
  const employeeId =
    api.ok && mcp.ok && typeof api.employeeId === "number" && api.employeeId === mcp.employeeId ? api.employeeId : null;

  return {
    ok: allHired && unsetSkipped,
    erp: "skipped",
    linkedIn: true,
    screen: input.screen,
    transport: "fixture",
    steps: [],
    vacancyClose: null,
    vacancyKwargs: null,
    hrJobStateSent: false,
    employeeId,
    unset: {
      ok: unset.ok,
      erp: unset.erp,
      linkedIn: unset.linkedIn,
      fetchCount: unsetFetches,
    },
    connectors,
  };
}

export async function hireFromSourcingScreen(
  input: SourcingScreenHireInput,
  env: NodeJS.ProcessEnv = process.env,
  liveFetch: HireFetch = fetchPublicUrl,
): Promise<SourcingScreenHireResult> {
  if (!isSourcingScreen(input.screen)) {
    return {
      ok: false,
      erp: "skipped",
      linkedIn: true,
      screen: "command",
      transport: "fixture",
      steps: [],
      vacancyClose: null,
      vacancyKwargs: null,
      hrJobStateSent: false,
      error: "Unknown sourcing screen.",
    };
  }
  const payload = {
    idempotencyKey: input.idempotencyKey,
    job: input.job,
    applicant: input.applicant,
    stage: input.stage,
  };
  if (!connectorRuntimeConfigured(env)) {
    return hireWithFixtureConnectors(input, payload);
  }
  const hired = await runSourcingThroughHired(payload, hireEnvForRoute(env, false), liveFetch);
  return {
    ok: hired.ok,
    erp: hired.erp,
    linkedIn: hired.linkedIn,
    screen: input.screen,
    transport: "live",
    steps: hired.steps.map(shownStep),
    vacancyClose: null,
    vacancyKwargs: null,
    hrJobStateSent: false,
    ...(typeof hired.employeeId === "number" ? { employeeId: hired.employeeId } : {}),
    error: hired.error,
  };
}
