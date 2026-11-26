// Minimal server-side MCP (Model Context Protocol) client over the streamable-HTTP
// transport. Enough to connect to a server, complete the `initialize` handshake, and
// enumerate / call its tools. Used by the MCP test probe (list tools) and, later, by
// the agent runtime (call tools). Read-only here apart from the explicit tools/call.
//
// The hire helpers below are separate. They call Odoo, SMART, a generic HTTPS API,
// or an MCP hire tool when that connector's runtime env is complete.

import { fetchPublicUrl } from "@/lib/api/public-fetch";
import {
  genericApiHireConnector,
  linkedInSourcingRunsWithoutErp,
  mcpToolHireConnector,
  odooHireConnector,
  smartHireConnector,
  type HireConnector,
} from "@/lib/hire-connector";
import { createEmployeeForStage, namedHiredStage, type OdooEmployeeClient } from "@/lib/hire-employee";

const PROTOCOL_VERSION = "2024-11-05";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface JsonRpcResponse {
  result?: {
    serverInfo?: { name?: string };
    tools?: McpTool[];
    content?: unknown;
    isError?: boolean;
  };
  error?: { message?: string };
}

/** Parse a JSON-RPC response that may arrive as plain JSON or an SSE `data:` frame. */
function parseRpc(text: string): JsonRpcResponse | null {
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t) as JsonRpcResponse;
    } catch {
      return null;
    }
  }
  for (const line of t.split("\n")) {
    const l = line.trim();
    if (l.startsWith("data:")) {
      try {
        return JSON.parse(l.slice(5).trim()) as JsonRpcResponse;
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

interface PostResult {
  ok: boolean;
  status: number;
  json: JsonRpcResponse | null;
  sessionId: string | undefined;
}

async function post(url: string, token: string, body: unknown, sessionId?: string): Promise<PostResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  const newSession = res.headers.get("Mcp-Session-Id") ?? sessionId;
  let json: JsonRpcResponse | null = null;
  if (res.ok) json = parseRpc(await res.text());
  return { ok: res.ok, status: res.status, json, sessionId: newSession };
}

export interface McpConnectResult {
  ok: boolean;
  serverName?: string;
  tools?: McpTool[];
  error?: string;
}

/** Connect, run the initialize handshake, and list the server's tools. */
export async function connectAndListTools(url: string, token: string): Promise<McpConnectResult> {
  const init = await post(url, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aria-sourcing", version: "1.0" } },
  });
  if (!init.ok) return { ok: false, error: `MCP server responded ${init.status}.` };
  if (!init.json?.result) return { ok: false, error: init.json?.error?.message ?? "No valid MCP initialize response." };

  const serverName = init.json.result.serverInfo?.name ?? "MCP server";
  const session = init.sessionId;

  // Acknowledge initialization (best-effort; some servers require it before tools/list).
  try {
    await post(url, token, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  } catch {
    /* ignore — not all servers need this */
  }

  // List tools (best-effort: a server may not expose tools).
  let tools: McpTool[] = [];
  try {
    const list = await post(url, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session);
    tools = (list.json?.result?.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  } catch {
    /* tools optional */
  }

  return { ok: true, serverName, tools };
}

/** Call a single tool on the server. Returns the tool result content or an error. */
export async function callMcpTool(
  url: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content?: unknown; error?: string }> {
  const init = await post(url, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aria-sourcing", version: "1.0" } },
  });
  if (!init.ok || !init.json?.result) return { ok: false, error: init.json?.error?.message ?? "MCP initialize failed." };
  const session = init.sessionId;
  try {
    await post(url, token, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  } catch {
    /* ignore */
  }
  const call = await post(
    url,
    token,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
    session,
  );
  if (!call.json?.result) return { ok: false, error: call.json?.error?.message ?? "Tool call returned no result." };
  return { ok: !call.json.result.isError, content: call.json.result.content };
}

export interface SourcingThroughHiredInput {
  idempotencyKey: string;
  job: { name: string; department?: string };
  applicant: { name: string; email?: string };
  stage: string;
}

export type HireErpKind = "odoo" | "smart" | "api" | "mcp";

export interface SourcingThroughHiredStep {
  erp: HireErpKind;
  model: "hr.job" | "hr.applicant";
  action: "job" | "applicant" | "stage" | "hire";
  method: "create" | "write";
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface SourcingThroughHiredResult {
  ok: boolean;
  erp: HireErpKind | "skipped";
  linkedIn: boolean;
  steps: SourcingThroughHiredStep[];
  error?: string;
  /** Hired hr.employee id from the injected client. Set on a successful generic API or MCP hire. */
  employeeId?: number | null;
}

type HireFetch = (url: string, init?: RequestInit) => Promise<Response>;

function filled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function odooHireConfigured(env: NodeJS.ProcessEnv): boolean {
  return filled(env.ODOO_URL) && filled(env.ODOO_DB) && filled(env.ODOO_USERNAME) && filled(env.ODOO_API_KEY);
}

function smartHireConfigured(env: NodeJS.ProcessEnv): boolean {
  return filled(env.SMART_URL) && filled(env.SMART_TOKEN);
}

function apiHireConfigured(env: NodeJS.ProcessEnv): boolean {
  return filled(env.HIRE_API_URL) && filled(env.HIRE_API_TOKEN);
}

function mcpHireConfigured(env: NodeJS.ProcessEnv): boolean {
  return filled(env.HIRE_MCP_URL) && filled(env.HIRE_MCP_TOKEN);
}

type HireCallResult = { ok: true; id: string } | { ok: false; error: string };

/** Successful steps only. A failed step stays retryable. Shared by overlapping requests in this process. */
const hireMemory = new Map<string, Promise<HireCallResult>>();
const HIRE_MEMORY_LIMIT = 500;

export function clearHireIdempotency(): void {
  hireMemory.clear();
}

function memoHire(connector: HireConnector, scope: string): HireConnector {
  return {
    kind: connector.kind,
    call(input) {
      const key = `${scope}|${input.idempotencyKey}|${input.model}|${input.method}`;
      const existing = hireMemory.get(key);
      if (existing) return existing;
      const pending = connector.call(input).then(
        (result) => {
          if (!result.ok) hireMemory.delete(key);
          return result;
        },
        (err: unknown) => {
          hireMemory.delete(key);
          throw err;
        },
      );
      hireMemory.set(key, pending);
      if (hireMemory.size > HIRE_MEMORY_LIMIT) {
        const oldest = hireMemory.keys().next().value;
        if (oldest && oldest !== key) hireMemory.delete(oldest);
      }
      return pending;
    },
  };
}

const ERP_ENV_KEYS = [
  "ODOO_URL",
  "ODOO_DB",
  "ODOO_USERNAME",
  "ODOO_API_KEY",
  "ODOO_HIRED_STAGE_ID",
  "SMART_URL",
  "SMART_TOKEN",
  "HIRE_API_URL",
  "HIRE_API_TOKEN",
  "HIRE_MCP_URL",
  "HIRE_MCP_TOKEN",
  "HIRE_MCP_TOOL",
  "HIRE_CONNECTOR",
] as const;

/**
 * Drop ERP credentials. Used when the caller is not allowed to spend them.
 * The copy never logs values.
 */
export function envForHireRequest(env: NodeJS.ProcessEnv, liveAuthenticated: boolean): NodeJS.ProcessEnv {
  if (liveAuthenticated) return env;
  const scoped: NodeJS.ProcessEnv = { ...env };
  for (const key of ERP_ENV_KEYS) delete scoped[key];
  return scoped;
}

/** True when at least one hire connector has every field it needs. */
export function connectorRuntimeConfigured(env: NodeJS.ProcessEnv): boolean {
  return odooHireConfigured(env) || smartHireConfigured(env) || apiHireConfigured(env) || mcpHireConfigured(env);
}

/**
 * Runtime env for POST /api/hire. A complete connector keeps its credentials
 * so the live transport can call that host. An empty env stays empty and the
 * hire result is skipped. The synthetic demo does not use this.
 */
export function hireEnvForRoute(env: NodeJS.ProcessEnv, supabaseOn: boolean): NodeJS.ProcessEnv {
  if (supabaseOn || connectorRuntimeConfigured(env)) return env;
  return envForHireRequest(env, false);
}

function presentValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function hireConnectorConfigured(kind: HireErpKind, env: NodeJS.ProcessEnv): boolean {
  if (kind === "odoo") return odooHireConfigured(env);
  if (kind === "smart") return smartHireConfigured(env);
  if (kind === "api") return apiHireConfigured(env);
  return mcpHireConfigured(env);
}

function connectorFor(kind: HireErpKind, env: NodeJS.ProcessEnv, fetchImpl: HireFetch): HireConnector {
  if (kind === "odoo") return odooHireConnector(env, fetchImpl);
  if (kind === "smart") return smartHireConnector(env, fetchImpl);
  if (kind === "api") return genericApiHireConnector(env, fetchImpl);
  return mcpToolHireConnector(env, fetchImpl);
}

function selectHireConnector(env: NodeJS.ProcessEnv): HireErpKind | "skipped" | { error: string } {
  const requested = env.HIRE_CONNECTOR;
  if (requested) {
    if (requested !== "odoo" && requested !== "smart" && requested !== "api" && requested !== "mcp") {
      return { error: "HIRE_CONNECTOR must be odoo, smart, api, or mcp" };
    }
    if (!hireConnectorConfigured(requested, env)) return { error: `${requested} connector is not configured` };
    return requested;
  }
  if (odooHireConfigured(env)) return "odoo";
  if (smartHireConfigured(env)) return "smart";
  if (apiHireConfigured(env)) return "api";
  if (mcpHireConfigured(env)) return "mcp";
  return "skipped";
}

/**
 * Run one sourced applicant from job creation through hire.
 * When HIRE_CONNECTOR is unset the order is Odoo, then SMART, then the generic
 * HTTPS API, then MCP. When none are configured, LinkedIn sourcing still
 * completes and no upstream request is sent. The default fetch is the live
 * public HTTPS transport. Tests and the synthetic demo pass a local fake.
 * A successful generic API or MCP hire records the employee id the Odoo
 * stage writer records for that applicant. The client is injected. No client
 * leaves the id null and calls nothing.
 */
export async function runSourcingThroughHired(
  input: SourcingThroughHiredInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: HireFetch = fetchPublicUrl,
  employeeClient: OdooEmployeeClient | null = null,
): Promise<SourcingThroughHiredResult> {
  const linkedIn = linkedInSourcingRunsWithoutErp(env);
  if (!linkedIn) {
    return { ok: false, erp: "skipped", linkedIn: false, steps: [], error: "LinkedIn sourcing is not available." };
  }
  const selected = selectHireConnector(env);
  if (selected === "skipped") return { ok: true, erp: "skipped", linkedIn: true, steps: [] };
  if (typeof selected === "object") return { ok: false, erp: "skipped", linkedIn: true, steps: [], error: selected.error };
  const endpoint =
    selected === "odoo" ? env.ODOO_URL : selected === "smart" ? env.SMART_URL : selected === "api" ? env.HIRE_API_URL : env.HIRE_MCP_URL;
  const connector = memoHire(connectorFor(selected, env, fetchImpl), `${selected}|${(endpoint ?? "").trim().replace(/\/+$/, "")}`);
  if (selected === "odoo") return runOdooHire(connector, input, env);
  const hired = await runErpHire(selected, connector, input);
  if ((selected !== "api" && selected !== "mcp") || !hired.ok) return hired;
  return { ...hired, employeeId: await recordedHiredEmployeeId(input, hired, employeeClient) };
}

/**
 * Same employee id createEmployeeForStage stores for this applicant.
 * The client is the one the caller injected. Nothing here opens a socket.
 */
async function recordedHiredEmployeeId(
  input: SourcingThroughHiredInput,
  hired: SourcingThroughHiredResult,
  client: OdooEmployeeClient | null,
): Promise<number | null> {
  const stage = namedHiredStage();
  if (!stage || input.stage !== stage) return null;
  const applicantId = hired.steps.find((step) => step.action === "applicant" && step.ok)?.id;
  if (!applicantId) return null;
  const recorded = await createEmployeeForStage(stage, { applicantId, name: input.applicant.name }, client);
  return recorded.employeeId;
}

function hiredStageId(env: NodeJS.ProcessEnv): number | null {
  const raw = env.ODOO_HIRED_STAGE_ID?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function odooRef(id: string): number | string {
  return /^[1-9]\d*$/.test(id) ? Number(id) : id;
}

/**
 * Odoo hr.job / hr.applicant fields only. The vacancy close is
 * [[id], { no_of_recruitment: 0 }] with kwargs {}. hr.job.state is not sent.
 * A hired stage write is sent only when ODOO_HIRED_STAGE_ID is a positive id.
 */
async function runOdooHire(
  connector: HireConnector,
  input: SourcingThroughHiredInput,
  env: NodeJS.ProcessEnv,
): Promise<SourcingThroughHiredResult> {
  const steps: SourcingThroughHiredStep[] = [];
  const job = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:job`,
    model: "hr.job",
    method: "create",
    values: { name: input.job.name },
  });
  steps.push({ erp: "odoo", model: "hr.job", action: "job", method: "create", ok: job.ok, id: job.ok ? job.id : undefined, error: job.ok ? undefined : job.error });
  if (!job.ok) return { ok: false, erp: "odoo", linkedIn: true, steps, error: job.error };

  const applicant = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:applicant`,
    model: "hr.applicant",
    method: "create",
    values: presentValues({
      name: input.applicant.name,
      partner_name: input.applicant.name,
      email_from: input.applicant.email,
      job_id: odooRef(job.id),
    }),
  });
  steps.push({
    erp: "odoo",
    model: "hr.applicant",
    action: "applicant",
    method: "create",
    ok: applicant.ok,
    id: applicant.ok ? applicant.id : undefined,
    error: applicant.ok ? undefined : applicant.error,
  });
  if (!applicant.ok) return { ok: false, erp: "odoo", linkedIn: true, steps, error: applicant.error };

  const stageId = hiredStageId(env);
  if (stageId == null) {
    steps.push({
      erp: "odoo",
      model: "hr.applicant",
      action: "stage",
      method: "write",
      ok: true,
      skipped: true,
      reason: "Hired stage id is not configured.",
    });
  } else {
    const stage = await connector.call({
      idempotencyKey: `${input.idempotencyKey}:stage`,
      model: "hr.applicant",
      method: "write",
      values: { id: odooRef(applicant.id), stage_id: stageId },
    });
    steps.push({
      erp: "odoo",
      model: "hr.applicant",
      action: "stage",
      method: "write",
      ok: stage.ok,
      id: stage.ok ? stage.id : undefined,
      error: stage.ok ? undefined : stage.error,
    });
    if (!stage.ok) return { ok: false, erp: "odoo", linkedIn: true, steps, error: stage.error };
  }

  const closed = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:hire`,
    model: "hr.job",
    method: "write",
    values: { id: odooRef(job.id), no_of_recruitment: 0 },
  });
  steps.push({
    erp: "odoo",
    model: "hr.job",
    action: "hire",
    method: "write",
    ok: closed.ok,
    id: closed.ok ? closed.id : undefined,
    error: closed.ok ? undefined : closed.error,
  });
  if (!closed.ok) return { ok: false, erp: "odoo", linkedIn: true, steps, error: closed.error };
  return { ok: true, erp: "odoo", linkedIn: true, steps };
}

/** SMART, the generic API, and MCP mark the applicant hired. They do not close hr.job. */
async function runErpHire(
  erp: HireErpKind,
  connector: HireConnector,
  input: SourcingThroughHiredInput,
): Promise<SourcingThroughHiredResult> {
  const steps: SourcingThroughHiredStep[] = [];
  const job = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:job`,
    model: "hr.job",
    method: "create",
    values: presentValues({ name: input.job.name, department: input.job.department }),
  });
  steps.push({ erp, model: "hr.job", action: "job", method: "create", ok: job.ok, id: job.ok ? job.id : undefined, error: job.ok ? undefined : job.error });
  if (!job.ok) return { ok: false, erp, linkedIn: true, steps, error: job.error };

  const applicant = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:applicant`,
    model: "hr.applicant",
    method: "create",
    values: presentValues({
      name: input.applicant.name,
      email: input.applicant.email,
      job_id: job.id,
    }),
  });
  steps.push({
    erp,
    model: "hr.applicant",
    action: "applicant",
    method: "create",
    ok: applicant.ok,
    id: applicant.ok ? applicant.id : undefined,
    error: applicant.ok ? undefined : applicant.error,
  });
  if (!applicant.ok) return { ok: false, erp, linkedIn: true, steps, error: applicant.error };

  const stage = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:stage`,
    model: "hr.applicant",
    method: "write",
    values: { id: applicant.id, stage: input.stage },
  });
  steps.push({
    erp,
    model: "hr.applicant",
    action: "stage",
    method: "write",
    ok: stage.ok,
    id: stage.ok ? stage.id : undefined,
    error: stage.ok ? undefined : stage.error,
  });
  if (!stage.ok) return { ok: false, erp, linkedIn: true, steps, error: stage.error };

  const hired = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:hire`,
    model: "hr.applicant",
    method: "write",
    values: { id: applicant.id, hired: true },
  });
  steps.push({
    erp,
    model: "hr.applicant",
    action: "hire",
    method: "write",
    ok: hired.ok,
    id: hired.ok ? hired.id : undefined,
    error: hired.ok ? undefined : hired.error,
  });
  if (!hired.ok) return { ok: false, erp, linkedIn: true, steps, error: hired.error };
  return { ok: true, erp, linkedIn: true, steps };
}
