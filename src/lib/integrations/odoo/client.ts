/* ============================================================================
   Odoo external API client (server only).

   Odoo 19+ exposes one external API, JSON-2: POST /json/2/<model>/<method>
   with the API key as a bearer token and the database in X-Odoo-Database.
   XML-RPC and JSON-RPC are deprecated in 19 and scheduled for removal in 20,
   so ARIA speaks JSON-2 only (docs/odoo.md, ADR 0003).

   Safety rules:
   - The API key only ever travels to the configured Odoo origin: redirects are
     refused (never followed with the bearer token).
   - Odoo error bodies carry a full Python traceback ("debug"). It never leaves
     this module: callers get a code, the HTTP status and Odoo's short message.
   - Responses are size-capped and time-limited.
   ========================================================================== */

export const ODOO_TIMEOUT_MS = 15_000;
export const ODOO_MAX_RESPONSE_BYTES = 4_000_000;

export type OdooErrorCode =
  | "invalid_config"
  | "unreachable"
  | "timeout"
  | "redirect_refused"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rejected"
  | "server_error"
  | "bad_response";

export class OdooError extends Error {
  readonly code: OdooErrorCode;
  readonly status: number | null;
  /** Odoo's exception class, e.g. "odoo.exceptions.AccessError". */
  readonly odooName: string | null;

  constructor(code: OdooErrorCode, message: string, status: number | null = null, odooName: string | null = null) {
    super(message);
    this.name = "OdooError";
    this.code = code;
    this.status = status;
    this.odooName = odooName;
  }
}

export function isOdooError(value: unknown): value is OdooError {
  return value instanceof Error && (value as { name?: string }).name === "OdooError" && "code" in value;
}

export interface OdooConnectionConfig {
  /** Normalised origin (+ optional path prefix), no trailing slash. */
  baseUrl: string;
  database: string;
  apiKey: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OdooClient {
  readonly baseUrl: string;
  call<T = unknown>(model: string, method: string, params?: Record<string, unknown>): Promise<T>;
  /** Odoo's public version endpoint (no key needed). */
  version(): Promise<OdooVersion>;
}

export interface OdooVersion {
  version: string;
  major: number;
}

const MODEL_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const METHOD_RE = /^[a-z][a-z0-9_]*$/;
const DATABASE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

/** True when the server may reach Odoo over plain HTTP (local dev only). */
export function odooHttpAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ODOO_ALLOW_HTTP === "true";
}

export type NormalizedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate the admin-entered Odoo address. HTTPS only unless ODOO_ALLOW_HTTP
 * is set on the server (local Docker); no credentials, query or fragment.
 */
export function normalizeOdooBaseUrl(raw: string, options: { allowHttp: boolean }): NormalizedUrl {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return { ok: false, error: "Enter the Odoo address, e.g. https://odoo.example.com." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "The Odoo address is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "The Odoo address must start with https://." };
  }
  if (parsed.protocol === "http:" && !options.allowHttp) {
    return { ok: false, error: "Use https:// for Odoo (plain http is allowed only when the server sets ODOO_ALLOW_HTTP=true)." };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "Do not put credentials in the Odoo address." };
  if (parsed.search || parsed.hash) return { ok: false, error: "The Odoo address must not have a query or fragment." };
  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/(json|web|odoo)(\/|$)/.test(path)) {
    return { ok: false, error: "Enter the Odoo root address, without /web or /odoo." };
  }
  return { ok: true, url: `${parsed.origin}${path}` };
}

export function validOdooDatabase(raw: string): boolean {
  return DATABASE_RE.test(raw);
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OdooError("bad_response", "Odoo returned a response that is too large.", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OdooError("bad_response", "Odoo returned a response that is too large.", response.status);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function shortMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  // First line only: Odoo appends "(Record: ..., User: n)" diagnostics below.
  return value.split("\n", 1)[0]!.trim().slice(0, 240);
}

function errorFor(status: number, body: unknown): OdooError {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = typeof record.name === "string" ? record.name.slice(0, 120) : null;
  const message = shortMessage(record.message);
  if (status === 401) return new OdooError("unauthorized", "Odoo refused the API key.", status, name);
  if (status === 403) return new OdooError("forbidden", message || "The Odoo user is not allowed to do this.", status, name);
  if (status === 404) return new OdooError("not_found", message || "Not found in Odoo.", status, name);
  if (status === 400 || status === 422) return new OdooError("rejected", message || "Odoo rejected the request.", status, name);
  return new OdooError("server_error", message || `Odoo answered ${status}.`, status, name);
}

function parseJson(text: string, status: number): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new OdooError("bad_response", "Odoo did not answer with JSON.", status);
  }
}

export function createOdooClient(
  config: OdooConnectionConfig,
  deps: { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number } = {},
): OdooClient {
  if (!config.apiKey || /[\r\n\s]/.test(config.apiKey)) throw new OdooError("invalid_config", "The Odoo API key is missing or malformed.");
  if (!validOdooDatabase(config.database)) throw new OdooError("invalid_config", "The Odoo database name is invalid.");
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? ODOO_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? ODOO_MAX_RESPONSE_BYTES;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  async function send(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new OdooError("timeout", "Odoo did not answer in time.");
      throw new OdooError("unreachable", "Odoo could not be reached. Check the address and that the ARIA server can reach it.");
    }
    if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect") {
      await response.body?.cancel().catch(() => undefined);
      throw new OdooError("redirect_refused", "Odoo redirected the request. Enter the final https:// address of Odoo.", response.status || null);
    }
    const text = await readCapped(response, maxBytes);
    const body = parseJson(text, response.status);
    if (!response.ok) throw errorFor(response.status, body);
    return { status: response.status, body };
  }

  return {
    baseUrl,
    async call<T>(model: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (!MODEL_RE.test(model) || model.length > 120) throw new OdooError("invalid_config", "Invalid Odoo model name.");
      if (!METHOD_RE.test(method) || method.length > 80) throw new OdooError("invalid_config", "Invalid Odoo method name.");
      const { body } = await send(`${baseUrl}/json/2/${model}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `bearer ${config.apiKey}`,
          "X-Odoo-Database": config.database,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
          "User-Agent": "ARIA-Odoo-Connector/1",
        },
        body: JSON.stringify(params),
      });
      return body as T;
    },
    async version(): Promise<OdooVersion> {
      const { body } = await send(`${baseUrl}/web/version`, { method: "GET", headers: { Accept: "application/json" } });
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const info = Array.isArray(record.version_info) ? record.version_info : [];
      const major = typeof info[0] === "number" ? info[0] : Number.parseInt(String(record.version ?? ""), 10);
      if (!Number.isFinite(major)) throw new OdooError("bad_response", "Odoo did not report its version.");
      return { version: String(record.version ?? major).slice(0, 40), major };
    },
  };
}
