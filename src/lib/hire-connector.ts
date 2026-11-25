import { classifyFetchHost } from "@/lib/api/url";
import { fetchPublicUrl } from "@/lib/api/public-fetch";
import { redactSecrets } from "@/lib/log-redact";

export type HireConnectorKind = "odoo" | "smart" | "api" | "mcp";

export type HireResult = { ok: true; id: string } | { ok: false; error: string };

export type HireCall = {
  idempotencyKey: string;
  model: string;
  method: "create" | "write" | "search";
  values: Record<string, unknown>;
};

export interface HireConnector {
  kind: HireConnectorKind;
  call(input: HireCall): Promise<HireResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const HIRE_MODELS = new Set(["hr.job", "hr.applicant"]);
const MCP_PROTOCOL = "2024-11-05";
const MCP_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const CONNECTOR_ENV_KEYS = [
  "ODOO_URL",
  "ODOO_DB",
  "ODOO_USERNAME",
  "ODOO_API_KEY",
  "SMART_URL",
  "SMART_TOKEN",
  "HIRE_API_URL",
  "HIRE_API_TOKEN",
  "HIRE_MCP_URL",
  "HIRE_MCP_TOKEN",
  "HIRE_MCP_TOOL",
  "HIRE_CONNECTOR",
] as const;

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetchPublicUrl(url, init);
}

function missing(kind: HireConnectorKind, name: string): HireResult {
  return { ok: false, error: `${kind} missing ${name}` };
}

/**
 * ERP and generic API base URLs receive credentials, so they must be public
 * HTTPS hosts with no embedded login, query, or fragment. The default
 * transport pins DNS and does not follow redirects.
 */
function publicHttpsBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (classifyFetchHost(url.hostname.replace(/^\[|\]$/g, "")) === "blocked") return null;
  return url.toString().replace(/\/+$/, "");
}

function scrubbed(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return redactSecrets(out).slice(0, 200);
}

async function send(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  secrets: string[],
): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  try {
    return { ok: true, response: await fetchImpl(url, { ...init, redirect: "error" }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    return { ok: false, error: scrubbed(message, secrets) };
  }
}

/**
 * Streamable HTTP may answer with SSE when the client accepts
 * `text/event-stream`. A progress notification can precede the JSON-RPC
 * response, so the last data frame that carries `result` or `error` wins.
 * The raw frame is never copied into an error string.
 */
function jsonRpcFromEventStream(text: string): { ok: true; value: unknown } | { ok: false } {
  let matched: unknown = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":") || !line.startsWith("data:")) continue;
      data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    const raw = data.join("\n").trim();
    if (!raw || raw === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if ("result" in parsed || "error" in parsed) matched = parsed;
  }
  if (matched == null) return { ok: false };
  return { ok: true, value: matched };
}

async function readJson(response: Response, secrets: string[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/event-stream")) {
      const parsed = jsonRpcFromEventStream(await response.text());
      if (!parsed.ok) return { ok: false, error: "upstream event stream had no json-rpc message" };
      return parsed;
    }
    return { ok: true, value: await response.json() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    return { ok: false, error: scrubbed(message, secrets) };
  }
}

function odooRecordRef(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Odoo create(vals_list) and write(ids, vals) take positional arguments.
 * A non-empty kwargs object is the shape real Odoo rejects with TypeError.
 * `x_idempotency_key` is not a field on stock hr.job or hr.applicant; the
 * JSON-RPC id already carries the idempotency key.
 */
function odooPositional(input: HireCall): { ok: true; args: unknown[] } | { ok: false; error: string } {
  const vals = { ...input.values };
  delete vals.id;
  if (input.method === "create") return { ok: true, args: [[vals]] };
  if (input.method === "write") {
    const id = odooRecordRef(input.values.id);
    if (id == null) return { ok: false, error: "odoo write requires a record id" };
    return { ok: true, args: [[id], vals] };
  }
  return { ok: false, error: "odoo method must be create or write" };
}

function odooRecordId(result: unknown, input: HireCall): string | null {
  if (result === true) return String(input.values.id ?? input.idempotencyKey);
  if (typeof result === "number" && Number.isSafeInteger(result) && result > 0) return String(result);
  if (Array.isArray(result) && typeof result[0] === "number" && result[0] > 0) return String(result[0]);
  return null;
}

function positiveId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Match the top-level string guard: these are failed payloads, not record ids.
    if (!trimmed || trimmed === "false" || trimmed === "null") return null;
    return trimmed;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

/** A false, empty, or id-less payload is not a hire record. */
function idFromPayload(payload: unknown): string | null {
  if (payload === false || payload == null) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "false" || trimmed === "null") return null;
    try {
      return idFromPayload(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.ok === false || record.result === false || record.isError === true || record.error) return null;
  const direct = positiveId(record.id);
  if (direct) return direct;
  if (typeof record.result === "string" || typeof record.result === "number") return positiveId(record.result);
  if (record.result && typeof record.result === "object") return idFromPayload(record.result);
  return null;
}

function idFromMcpResult(result: unknown): string | null {
  if (result === false || result == null || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  if (record.isError === true) return null;
  const structured = idFromPayload(record.structuredContent);
  if (structured) return structured;
  if (Array.isArray(record.content)) {
    if (record.content.length === 0) return null;
    for (const item of record.content) {
      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string") continue;
      const id = idFromPayload(text);
      if (id) return id;
    }
    return null;
  }
  return idFromPayload(record);
}

function mcpErrorText(result: unknown): string {
  if (!result || typeof result !== "object") return "mcp tool failed";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "mcp tool failed";
  const text = content
    .map((item) => (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : ""))
    .filter(Boolean)
    .join(" ");
  return text || "mcp tool failed";
}

function assertHireModel(kind: HireConnectorKind, model: string): HireResult | null {
  if (HIRE_MODELS.has(model)) return null;
  return { ok: false, error: `${kind} model must be hr.job or hr.applicant` };
}

export function odooHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = defaultFetch): HireConnector {
  return {
    kind: "odoo",
    async call(input) {
      const url = env.ODOO_URL;
      const db = env.ODOO_DB;
      const user = env.ODOO_USERNAME;
      const key = env.ODOO_API_KEY;
      if (!url || !db || !user || !key) return missing("odoo", "ODOO_URL, ODOO_DB, ODOO_USERNAME, or ODOO_API_KEY");
      const base = publicHttpsBase(url);
      if (!base) return { ok: false, error: "odoo ODOO_URL must be a public https URL without credentials" };
      const refused = assertHireModel("odoo", input.model);
      if (refused) return refused;
      const positional = odooPositional(input);
      if (!positional.ok) return positional;
      const endpoint = `${base}/jsonrpc`;
      const secrets = [key, user];
      const auth = await send(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "call",
            id: input.idempotencyKey,
            params: { service: "common", method: "authenticate", args: [db, user, key, {}] },
          }),
        },
        secrets,
      );
      if (!auth.ok) return auth;
      if (!auth.response.ok) return { ok: false, error: `odoo auth http ${auth.response.status}` };
      const authBody = await readJson(auth.response, secrets);
      if (!authBody.ok) return authBody;
      const authJson = authBody.value as { result?: unknown; error?: { message?: string } };
      const uid = authJson.result;
      if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid <= 0) {
        return { ok: false, error: scrubbed(authJson.error?.message ?? "odoo auth failed", secrets) };
      }
      const write = await send(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "call",
            id: input.idempotencyKey,
            params: {
              service: "object",
              method: "execute_kw",
              args: [db, uid, key, input.model, input.method, positional.args, {}],
            },
          }),
        },
        secrets,
      );
      if (!write.ok) return write;
      if (!write.response.ok) return { ok: false, error: `odoo write http ${write.response.status}` };
      const writeBody = await readJson(write.response, secrets);
      if (!writeBody.ok) return writeBody;
      const writeJson = writeBody.value as { result?: unknown; error?: { message?: string } };
      if (writeJson.error) return { ok: false, error: scrubbed(writeJson.error.message ?? "odoo execute_kw failed", secrets) };
      const id = odooRecordId(writeJson.result, input);
      if (!id) return { ok: false, error: "odoo execute_kw returned no record" };
      return { ok: true, id };
    },
  };
}

export function smartHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = defaultFetch): HireConnector {
  return {
    kind: "smart",
    async call(input) {
      const refused = assertHireModel("smart", input.model);
      if (refused) return refused;
      const raw = env.SMART_URL;
      const token = env.SMART_TOKEN;
      if (!raw || !token) return missing("smart", "SMART_URL or SMART_TOKEN");
      const base = publicHttpsBase(raw);
      if (!base) return { ok: false, error: "smart SMART_URL must be a public https URL without credentials" };
      const res = await send(
        fetchImpl,
        `${base}/api/hire/${encodeURIComponent(input.model)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({ method: input.method, values: input.values }),
        },
        [token],
      );
      if (!res.ok) return res;
      if (!res.response.ok) return { ok: false, error: `smart http ${res.response.status}` };
      const body = await readJson(res.response, [token]);
      if (!body.ok) return body;
      const json = body.value as { id?: unknown; error?: unknown };
      if (json && typeof json === "object" && "error" in json && json.error) {
        return { ok: false, error: scrubbed(String(json.error), [token]) };
      }
      if (typeof json?.id !== "string" || !json.id) return { ok: false, error: "smart response missing id" };
      return { ok: true, id: json.id };
    },
  };
}

export function genericApiHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = defaultFetch): HireConnector {
  return {
    kind: "api",
    async call(input) {
      const refused = assertHireModel("api", input.model);
      if (refused) return refused;
      const raw = env.HIRE_API_URL;
      const token = env.HIRE_API_TOKEN;
      if (!raw || !token) return missing("api", "HIRE_API_URL or HIRE_API_TOKEN");
      const base = publicHttpsBase(raw);
      if (!base) return { ok: false, error: "api HIRE_API_URL must be a public https URL without credentials" };
      const res = await send(
        fetchImpl,
        `${base}/v1/hire/${encodeURIComponent(input.model)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({ method: input.method, values: input.values }),
        },
        [token],
      );
      if (!res.ok) return res;
      if (!res.response.ok) return { ok: false, error: `api http ${res.response.status}` };
      const body = await readJson(res.response, [token]);
      if (!body.ok) return body;
      if (body.value && typeof body.value === "object" && "error" in body.value && (body.value as { error?: unknown }).error) {
        return { ok: false, error: scrubbed(String((body.value as { error: unknown }).error), [token]) };
      }
      const id = idFromPayload(body.value);
      if (!id) return { ok: false, error: "api response missing id" };
      return { ok: true, id };
    },
  };
}

export function mcpToolHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = defaultFetch): HireConnector {
  return {
    kind: "mcp",
    async call(input) {
      const refused = assertHireModel("mcp", input.model);
      if (refused) return refused;
      const raw = env.HIRE_MCP_URL;
      const token = env.HIRE_MCP_TOKEN;
      const toolName = env.HIRE_MCP_TOOL || "hire";
      if (!raw || !token) return missing("mcp", "HIRE_MCP_URL or HIRE_MCP_TOKEN");
      if (!MCP_TOOL_NAME.test(toolName)) return { ok: false, error: "mcp HIRE_MCP_TOOL is invalid" };
      const base = publicHttpsBase(raw);
      if (!base) return { ok: false, error: "mcp HIRE_MCP_URL must be a public https URL without credentials" };
      const secrets = [token];
      const headers = (session?: string): Record<string, string> => {
        const next: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
        };
        if (session) next["mcp-session-id"] = session;
        return next;
      };
      const init = await send(
        fetchImpl,
        base,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: MCP_PROTOCOL,
              capabilities: {},
              clientInfo: { name: "aria-sourcing", version: "1.0" },
            },
          }),
        },
        secrets,
      );
      if (!init.ok) return init;
      if (!init.response.ok) return { ok: false, error: `mcp initialize http ${init.response.status}` };
      const initBody = await readJson(init.response, secrets);
      if (!initBody.ok) return initBody;
      const initJson = initBody.value as { result?: unknown; error?: { message?: string } };
      if (initJson.error) return { ok: false, error: scrubbed(initJson.error.message ?? "mcp initialize failed", secrets) };
      if (!initJson.result || typeof initJson.result !== "object") {
        return { ok: false, error: scrubbed("mcp initialize failed", secrets) };
      }
      const session = init.response.headers.get("mcp-session-id") ?? undefined;
      const notified = await send(
        fetchImpl,
        base,
        {
          method: "POST",
          headers: headers(session),
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        },
        secrets,
      );
      if (!notified.ok) return notified;
      if (!notified.response.ok) return { ok: false, error: `mcp initialized http ${notified.response.status}` };
      const call = await send(
        fetchImpl,
        base,
        {
          method: "POST",
          headers: headers(session),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: input.idempotencyKey,
            method: "tools/call",
            params: {
              name: toolName,
              arguments: {
                model: input.model,
                method: input.method,
                idempotencyKey: input.idempotencyKey,
                values: input.values,
              },
            },
          }),
        },
        secrets,
      );
      if (!call.ok) return call;
      if (!call.response.ok) return { ok: false, error: `mcp tool http ${call.response.status}` };
      const callBody = await readJson(call.response, secrets);
      if (!callBody.ok) return callBody;
      const callJson = callBody.value as { result?: unknown; error?: { message?: string } };
      if (callJson.error) return { ok: false, error: scrubbed(callJson.error.message ?? "mcp tool failed", secrets) };
      if (callJson.result === false || callJson.result == null) return { ok: false, error: "mcp tool returned no record" };
      if (typeof callJson.result === "object" && (callJson.result as { isError?: unknown }).isError === true) {
        return { ok: false, error: scrubbed(mcpErrorText(callJson.result), secrets) };
      }
      const id = idFromMcpResult(callJson.result);
      if (!id) return { ok: false, error: "mcp tool returned no record" };
      return { ok: true, id };
    },
  };
}

/** LinkedIn sourcing does not depend on an ERP or generic connector. */
export function linkedInSourcingRunsWithoutErp(_env: NodeJS.ProcessEnv): boolean {
  return true;
}

export interface SourcingThroughHiredInput {
  idempotencyKey: string;
  job: { name: string; department?: string };
  applicant: { name: string; email?: string };
  stage: string;
}

export interface SourcingThroughHiredStep {
  erp: HireConnectorKind;
  model: "hr.job" | "hr.applicant";
  action: "job" | "applicant" | "stage" | "hire";
  method: "create" | "write";
  ok: boolean;
  id?: string;
  error?: string;
}

export interface SourcingThroughHiredResult {
  ok: boolean;
  erp: HireConnectorKind | "skipped";
  linkedIn: boolean;
  steps: SourcingThroughHiredStep[];
  error?: string;
}

function odooConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ODOO_URL && env.ODOO_DB && env.ODOO_USERNAME && env.ODOO_API_KEY);
}

function smartConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SMART_URL && env.SMART_TOKEN);
}

function apiConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.HIRE_API_URL && env.HIRE_API_TOKEN);
}

function mcpConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.HIRE_MCP_URL && env.HIRE_MCP_TOKEN);
}

function connectorFor(kind: HireConnectorKind, env: NodeJS.ProcessEnv, fetchImpl: FetchLike): HireConnector {
  if (kind === "odoo") return odooHireConnector(env, fetchImpl);
  if (kind === "smart") return smartHireConnector(env, fetchImpl);
  if (kind === "api") return genericApiHireConnector(env, fetchImpl);
  return mcpToolHireConnector(env, fetchImpl);
}

function configured(kind: HireConnectorKind, env: NodeJS.ProcessEnv): boolean {
  if (kind === "odoo") return odooConfigured(env);
  if (kind === "smart") return smartConfigured(env);
  if (kind === "api") return apiConfigured(env);
  return mcpConfigured(env);
}

/**
 * Demo requests have no authenticated workspace user, so they must never
 * spend deployment credentials for Odoo, SMART, the generic API, or MCP.
 */
export function envForHireRequest(env: NodeJS.ProcessEnv, liveAuthenticated: boolean): NodeJS.ProcessEnv {
  if (liveAuthenticated) return env;
  const scoped: NodeJS.ProcessEnv = { ...env };
  for (const key of CONNECTOR_ENV_KEYS) delete scoped[key];
  return scoped;
}

function presentValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function selectKind(env: NodeJS.ProcessEnv): HireConnectorKind | "skipped" | { error: string } {
  const requested = env.HIRE_CONNECTOR;
  if (requested) {
    if (requested !== "odoo" && requested !== "smart" && requested !== "api" && requested !== "mcp") {
      return { error: "HIRE_CONNECTOR must be odoo, smart, api, or mcp" };
    }
    if (!configured(requested, env)) return { error: `${requested} connector is not configured` };
    return requested;
  }
  if (odooConfigured(env)) return "odoo";
  if (smartConfigured(env)) return "smart";
  if (apiConfigured(env)) return "api";
  if (mcpConfigured(env)) return "mcp";
  return "skipped";
}

/**
 * Run one sourced applicant from job creation through hire.
 * Odoo is used when its env is complete, otherwise SMART, otherwise the
 * generic HTTPS API, otherwise the MCP hire tool. HIRE_CONNECTOR selects
 * one path explicitly. When none are configured, LinkedIn sourcing still
 * completes and no upstream request is sent.
 */
export async function runSourcingThroughHired(
  input: SourcingThroughHiredInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SourcingThroughHiredResult> {
  const linkedIn = linkedInSourcingRunsWithoutErp(env);
  if (!linkedIn) {
    return { ok: false, erp: "skipped", linkedIn: false, steps: [], error: "LinkedIn sourcing is not available." };
  }
  const selected = selectKind(env);
  if (selected === "skipped") return { ok: true, erp: "skipped", linkedIn: true, steps: [] };
  if (typeof selected === "object") return { ok: false, erp: "skipped", linkedIn: true, steps: [], error: selected.error };
  return runHire(selected, connectorFor(selected, env, fetchImpl), input);
}

async function runHire(
  erp: HireConnectorKind,
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
  steps.push({
    erp,
    model: "hr.job",
    action: "job",
    method: "create",
    ok: job.ok,
    id: job.ok ? job.id : undefined,
    error: job.ok ? undefined : job.error,
  });
  if (!job.ok) return { ok: false, erp, linkedIn: true, steps, error: job.error };

  const applicant = await connector.call({
    idempotencyKey: `${input.idempotencyKey}:applicant`,
    model: "hr.applicant",
    method: "create",
    values: presentValues({ name: input.applicant.name, email: input.applicant.email, job_id: job.id }),
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
