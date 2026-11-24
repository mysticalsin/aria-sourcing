import { fetchPublicUrl } from "@/lib/api/public-fetch";
import { classifyFetchHost } from "@/lib/api/url";
import { redactSecrets } from "@/lib/log-redact";

export type HireConnectorKind = "odoo" | "smart" | "api" | "mcp" | "linkedin";

export type HireResult = { ok: true; id: string } | { ok: false; error: string; found?: false };

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

function missing(kind: HireConnectorKind, name: string): HireResult {
  return { ok: false, error: `${kind} missing ${name}` };
}

/**
 * ERP base URLs come from the environment and receive credentials, so they
 * must be public HTTPS hosts with no embedded login. The default transport
 * also pins DNS to a public address and never follows redirects.
 */
function erpBase(raw: string): string | null {
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

function odooRecordId(result: unknown, input: HireCall): string | null {
  if (result === true) return String(input.values.id ?? input.idempotencyKey);
  if (typeof result === "number" && Number.isSafeInteger(result) && result > 0) return String(result);
  if (Array.isArray(result) && typeof result[0] === "number" && result[0] > 0) return String(result[0]);
  return null;
}

function odooRecordRef(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

const HIRED_STAGE_NAME = "Hired";

/**
 * A search_read row is a stage only when it is an object with a positive id.
 * An empty list means the Hired stage is absent. A bare id is not a stage.
 */
function hiredStageFromSearch(result: unknown): { id: string } | { empty: true } | { invalid: true } {
  if (!Array.isArray(result) || result.length === 0) return { empty: true };
  const first = result[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return { invalid: true };
  const record = first as { id?: unknown; name?: unknown };
  if (record.name !== undefined && record.name !== HIRED_STAGE_NAME) return { empty: true };
  if (typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id > 0) return { id: String(record.id) };
  return { invalid: true };
}

/**
 * Odoo create(vals_list) and write(ids, vals) take positional arguments.
 * search_read(domain, fields, offset, limit) is positional too.
 * A non-empty kwargs object is the shape real Odoo rejects with TypeError.
 */
function odooPositional(input: HireCall): { ok: true; args: unknown[] } | { ok: false; error: string } {
  if (input.method === "search") {
    if (input.model !== "hr.recruitment.stage") return { ok: false, error: "odoo search model must be hr.recruitment.stage" };
    if (input.values.name !== HIRED_STAGE_NAME) return { ok: false, error: "odoo search name must be Hired" };
    return { ok: true, args: [[["name", "=", HIRED_STAGE_NAME]], ["id", "name"], 0, 1] };
  }
  const vals = { ...input.values };
  delete vals.id;
  // hr.job has no state field on Odoo 16, 18, or 19. A vacancy close is
  // no_of_recruitment only, on this Odoo path and on any caller of it.
  if (input.model === "hr.job") delete vals.state;
  if (input.method === "create") return { ok: true, args: [[vals]] };
  if (input.method === "write") {
    const id = odooRecordRef(input.values.id);
    if (id == null) return { ok: false, error: "odoo write requires a record id" };
    return { ok: true, args: [[id], vals] };
  }
  return { ok: false, error: "odoo method must be create or write" };
}

const MCP_PROTOCOL = "2024-11-05";
const MCP_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function positiveId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
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

async function readJson(response: Response, secrets: string[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await response.json() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    return { ok: false, error: scrubbed(message, secrets) };
  }
}

export function odooHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
  return {
    kind: "odoo",
    async call(input) {
      const url = env.ODOO_URL;
      const db = env.ODOO_DB;
      const user = env.ODOO_USERNAME;
      const key = env.ODOO_API_KEY;
      if (!url || !db || !user || !key) return missing("odoo", "ODOO_URL, ODOO_DB, ODOO_USERNAME, or ODOO_API_KEY");
      const base = erpBase(url);
      if (!base) return { ok: false, error: "odoo ODOO_URL must be a public https URL without credentials" };
      const endpoint = `${base}/jsonrpc`;
      const authRes = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: input.idempotencyKey,
          params: { service: "common", method: "authenticate", args: [db, user, key, {}] },
        }),
      });
      if (!authRes.ok) return { ok: false, error: `odoo auth http ${authRes.status}` };
      const authBody = (await authRes.json()) as { result?: unknown; error?: { message?: string } };
      const uid = authBody.result;
      if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid <= 0) {
        return { ok: false, error: scrubbed(authBody.error?.message ?? "odoo auth failed", [key, user]) };
      }
      const positional = odooPositional(input);
      if (!positional.ok) return positional;
      const rpcMethod = input.method === "search" ? "search_read" : input.method;
      const writeRes = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: input.idempotencyKey,
          params: {
            service: "object",
            method: "execute_kw",
            args: [db, uid, key, input.model, rpcMethod, positional.args, {}],
          },
        }),
      });
      if (!writeRes.ok) return { ok: false, error: `odoo write http ${writeRes.status}` };
      const writeBody = (await writeRes.json()) as { result?: unknown; error?: { message?: string } };
      if (writeBody.error) return { ok: false, error: scrubbed(writeBody.error.message ?? "odoo execute_kw failed", [key, user]) };
      if (input.method === "search") {
        const stage = hiredStageFromSearch(writeBody.result);
        if ("empty" in stage) return { ok: false, error: "odoo search returned no record", found: false };
        if ("invalid" in stage) return { ok: false, error: "odoo search returned no stage" };
        return { ok: true, id: stage.id };
      }
      const id = odooRecordId(writeBody.result, input);
      if (!id) return { ok: false, error: "odoo execute_kw returned no record" };
      return { ok: true, id };
    },
  };
}

export function smartHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
  return {
    kind: "smart",
    async call(input) {
      const raw = env.SMART_URL;
      const token = env.SMART_TOKEN;
      if (!raw || !token) return missing("smart", "SMART_URL or SMART_TOKEN");
      const base = erpBase(raw);
      if (!base) return { ok: false, error: "smart SMART_URL must be a public https URL without credentials" };
      if (!HIRE_MODELS.has(input.model)) return { ok: false, error: "smart model must be hr.job or hr.applicant" };
      const res = await fetchImpl(`${base}/api/hire/${encodeURIComponent(input.model)}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ method: input.method, values: input.values }),
      });
      if (!res.ok) return { ok: false, error: `smart http ${res.status}` };
      const body = (await res.json()) as { id?: unknown; error?: unknown };
      if (body.error) return { ok: false, error: scrubbed(String(body.error), [token]) };
      if (typeof body.id !== "string" || !body.id) return { ok: false, error: "smart response missing id" };
      return { ok: true, id: body.id };
    },
  };
}

export function genericApiHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
  return {
    kind: "api",
    async call(input) {
      const refused = assertHireModel("api", input.model);
      if (refused) return refused;
      const raw = env.HIRE_API_URL;
      const token = env.HIRE_API_TOKEN;
      if (!raw || !token) return missing("api", "HIRE_API_URL or HIRE_API_TOKEN");
      const base = erpBase(raw);
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

export function mcpToolHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
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
      const base = erpBase(raw);
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
      if (!initJson.result || typeof initJson.result !== "object") {
        return { ok: false, error: scrubbed(initJson.error?.message ?? "mcp initialize failed", secrets) };
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

/** LinkedIn sourcing does not depend on Odoo, SMART, the generic API, or MCP. Callers gate those separately. */
export function linkedInSourcingRunsWithoutErp(_env: NodeJS.ProcessEnv): boolean {
  return true;
}
