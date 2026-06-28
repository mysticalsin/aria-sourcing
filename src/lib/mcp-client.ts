// Minimal server-side MCP (Model Context Protocol) client over the streamable-HTTP
// transport. Enough to connect to a server, complete the `initialize` handshake, and
// enumerate / call its tools. Used by the MCP test probe (list tools) and, later, by
// the agent runtime (call tools). Read-only here apart from the explicit tools/call.

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
