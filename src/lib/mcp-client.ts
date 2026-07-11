// Bounded server-side MCP (Model Context Protocol) client over streamable HTTP.
// Credentialed third-party discovery and tool execution are development/test-only.
// A remote tool's semantics are untrusted and are never assumed to be read-only
// merely because this client uses a constrained transport.

import type { AuthQueryParam } from "./types";
import { fetchPublicUrl, type PublicFetchInit } from "@/lib/api/public-fetch";
import { redactSecrets } from "@/lib/log-redact";
import { validateMcpBaseUrl } from "@/lib/mcp-auth-params";

const PROTOCOL_VERSION = "2024-11-05";
export const MAX_MCP_TOOLS_PER_SERVER = 16;
export const MAX_MCP_TOOL_NAME_LENGTH = 64;
export const MAX_MCP_TOOL_DESCRIPTION_CHARS = 1_024;
export const MAX_MCP_TOOL_SCHEMA_BYTES = 16_384;
const MAX_MCP_SERVER_NAME_CHARS = 200;
const MCP_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

type McpExecutionEnvironment = {
  NODE_ENV?: string;
  ARIA_ENABLE_REMOTE_MCP_EXECUTION?: string;
};

/**
 * Third-party MCP execution is a development/test-only capability. Production
 * always denies execution and discovery, including when the opt-in variable is
 * accidentally or deliberately set.
 */
export function remoteMcpExecutionEnabled(env: McpExecutionEnvironment = process.env): boolean {
  const localRuntime = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  return localRuntime && env.ARIA_ENABLE_REMOTE_MCP_EXECUTION === "true";
}

/**
 * Discovery has the same fail-closed boundary as execution because an MCP
 * handshake can disclose vault credentials and make attacker-controlled remote
 * calls before any tool is selected. Keep one explicit nonproduction opt-in.
 */
export function remoteMcpDiscoveryEnabled(env: McpExecutionEnvironment = process.env): boolean {
  return remoteMcpExecutionEnabled(env);
}

export function isProviderSafeMcpToolName(name: unknown): name is string {
  return typeof name === "string" && name.length <= MAX_MCP_TOOL_NAME_LENGTH && MCP_TOOL_NAME.test(name);
}

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

export function applyMcpAuth(
  baseUrl: string,
  secret: string,
  opts?: { authStyle?: "bearer" | "query"; authQueryParam?: AuthQueryParam },
): { url: string; token: string } {
  const authStyle = opts?.authStyle ?? "bearer";
  const baseUrlGuard = validateMcpBaseUrl(baseUrl);
  if (!baseUrlGuard.ok) throw new Error(baseUrlGuard.error);
  if (authStyle === "bearer") return { url: baseUrl, token: secret };

  const authQueryParam = opts?.authQueryParam;
  if (!authQueryParam) throw new Error("MCP query auth requires an authQueryParam.");

  const url = new URL(baseUrl);
  url.searchParams.append(authQueryParam, secret);
  return { url: url.toString(), token: "" };
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "MCP server";
  }
}

function safeRpcError(host: string, fallback: string): string {
  return `${fallback} (${host}).`;
}

function credentialValues(url: string, token: string): string[] {
  const values = new Set<string>();
  if (token) values.add(token);
  try {
    const parsed = new URL(url);
    for (const [name, value] of parsed.searchParams) {
      for (const candidate of [name, value, encodeURIComponent(name), encodeURIComponent(value)]) {
        if (candidate) values.add(candidate);
      }
      const formEncoded = new URLSearchParams([[name, value]]).toString();
      const equals = formEncoded.indexOf("=");
      if (equals >= 0) {
        const encodedName = formEncoded.slice(0, equals);
        const encodedValue = formEncoded.slice(equals + 1);
        if (encodedName) values.add(encodedName);
        if (encodedValue) values.add(encodedValue);
      }
    }
  } catch {
    // Invalid URLs fail in the outbound transport. There is no query secret to collect here.
  }
  return [...values].filter(Boolean).sort((a, b) => b.length - a.length);
}

function removeCredentialValues(value: string, credentials: readonly string[]): string {
  let sanitized = value;
  let changed: boolean;
  do {
    changed = false;
    for (const credential of credentials) {
      if (!sanitized.includes(credential)) continue;
      sanitized = sanitized.split(credential).join("");
      changed = true;
    }
  } while (changed);
  return sanitized;
}

function sanitizeMcpString(value: string, credentials: readonly string[]): string {
  const exactScrubbed = removeCredentialValues(value, credentials);
  return removeCredentialValues(redactSecrets(exactScrubbed), credentials);
}

function sanitizeMcpText(value: unknown, credentials: readonly string[], fallback: string): string {
  if (typeof value !== "string") return fallback;
  const sanitized = sanitizeMcpString(value, credentials);
  return sanitized === value ? value : fallback;
}

function emptyInputSchema(): Record<string, unknown> {
  return { type: "object", properties: {} };
}

function boundedMcpSchema(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return emptyInputSchema();
  try {
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > MAX_MCP_TOOL_SCHEMA_BYTES) return emptyInputSchema();
    const parsed = JSON.parse(serialized) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : emptyInputSchema();
  } catch {
    return emptyInputSchema();
  }
}

function sanitizeMcpValue(
  value: unknown,
  credentials: readonly string[],
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return sanitizeMcpString(value, credentials);
  if ((typeof value === "number" || typeof value === "boolean") && credentials.includes(String(value))) return null;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 32 || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMcpValue(item, credentials, depth + 1, seen));
  }
  const sanitized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (sanitizeMcpString(key, credentials) !== key) continue;
    sanitized[key] = sanitizeMcpValue(item, credentials, depth + 1, seen);
  }
  return sanitized;
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

type McpFetch = (url: string | URL, init?: PublicFetchInit) => Promise<Response>;

async function post(
  url: string,
  token: string,
  body: unknown,
  sessionId?: string,
  fetchImpl: McpFetch = fetchPublicUrl,
  signal?: AbortSignal,
): Promise<PostResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
    timeoutMs: 12_000,
    maxRequestBytes: 250_000,
    maxResponseBytes: 1_000_000,
    signal,
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
export async function connectAndListTools(
  url: string,
  token: string,
  options: { fetchImpl?: McpFetch; signal?: AbortSignal } = {},
): Promise<McpConnectResult> {
  if (!remoteMcpDiscoveryEnabled()) {
    return { ok: false, error: "Remote MCP discovery is disabled." };
  }
  const host = hostFor(url);
  const credentials = credentialValues(url, token);
  let init: PostResult;
  try {
    init = await post(url, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aria-sourcing", version: "1.0" } },
    }, undefined, options.fetchImpl, options.signal);
  } catch {
    return { ok: false, error: `MCP connection failed (${host}).` };
  }
  if (!init.ok) return { ok: false, error: `MCP server responded ${init.status} (${host}).` };
  if (!init.json?.result) {
    return { ok: false, error: safeRpcError(host, "MCP initialize failed") };
  }

  const serverName = sanitizeMcpText(init.json.result.serverInfo?.name, credentials, "MCP server").slice(
    0,
    MAX_MCP_SERVER_NAME_CHARS,
  );
  const session = init.sessionId;

  // Acknowledge initialization (best-effort; some servers require it before tools/list).
  try {
    await post(
      url,
      token,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      session,
      options.fetchImpl,
      options.signal,
    );
  } catch {
    /* ignore: not all servers need this */
  }

  // List tools (best-effort: a server may not expose tools).
  let tools: McpTool[] = [];
  try {
    const list = await post(
      url,
      token,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      session,
      options.fetchImpl,
      options.signal,
    );
    const candidates = list.json?.result?.tools;
    if (Array.isArray(candidates)) {
      for (const tool of candidates) {
        if (tools.length >= MAX_MCP_TOOLS_PER_SERVER) break;
        if (!isProviderSafeMcpToolName(tool.name)) continue;
        if (sanitizeMcpString(tool.name, credentials) !== tool.name) continue;
        const sanitizedSchema = sanitizeMcpValue(tool.inputSchema, credentials);
        tools.push({
          name: tool.name,
          description:
            typeof tool.description === "string"
              ? sanitizeMcpString(tool.description, credentials).slice(0, MAX_MCP_TOOL_DESCRIPTION_CHARS)
              : undefined,
          inputSchema: boundedMcpSchema(sanitizedSchema),
        });
      }
    }
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
  options: { fetchImpl?: McpFetch; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; content?: unknown; error?: string }> {
  if (!remoteMcpExecutionEnabled()) {
    return { ok: false, error: "Remote MCP tool execution is disabled." };
  }
  if (!isProviderSafeMcpToolName(toolName)) {
    return { ok: false, error: "Remote MCP tool name is invalid." };
  }
  const host = hostFor(url);
  const credentials = credentialValues(url, token);
  let init: PostResult;
  try {
    init = await post(url, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aria-sourcing", version: "1.0" } },
    }, undefined, options.fetchImpl, options.signal);
  } catch {
    return { ok: false, error: `MCP connection failed (${host}).` };
  }
  if (!init.ok) return { ok: false, error: `MCP initialize responded ${init.status} (${host}).` };
  if (!init.json?.result) {
    return { ok: false, error: safeRpcError(host, "MCP initialize failed") };
  }
  const session = init.sessionId;
  try {
    await post(
      url,
      token,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      session,
      options.fetchImpl,
      options.signal,
    );
  } catch {
    /* ignore */
  }
  let call: PostResult;
  try {
    call = await post(
      url,
      token,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
      session,
      options.fetchImpl,
      options.signal,
    );
  } catch {
    return { ok: false, error: `MCP tool call failed (${host}).` };
  }
  if (!call.ok) return { ok: false, error: `MCP tool call responded ${call.status} (${host}).` };
  if (!call.json?.result) {
    return { ok: false, error: safeRpcError(host, "MCP tool call failed") };
  }
  return {
    ok: !call.json.result.isError,
    content: sanitizeMcpValue(call.json.result.content, credentials),
  };
}
