// Anthropic tool-calling loop backed by registered MCP servers. This is what turns the
// MCP registry into real capability: when MCP servers are configured, the model is given
// their tools and can call them mid-conversation, with the app brokering each call to the
// MCP server (server-side, with the vault token) and feeding the result back.
//
// Additive + safe by construction: callers only invoke this when there is at least one
// resolved MCP server with tools; otherwise the normal single-shot completion path is
// unchanged. Secrets never reach the client — the caller passes resolved server tokens
// (looked up from the key vault server-side), never the raw key from the browser.

import { callMcpTool, type McpTool } from "@/lib/mcp-client";
import { CLOUD_ENDPOINT, type AiProviderSlug } from "@/lib/ai/provider";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface ResolvedMcpServer {
  url: string;
  token: string;
  tools: McpTool[];
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Map resolved MCP servers' tools to Anthropic tool definitions, plus an index from
 * tool name to the owning server. Pure (no I/O) so it is unit-testable. On a tool-name
 * collision across servers, the first server wins (later duplicates are dropped).
 */
export function buildAnthropicToolDefs(servers: ResolvedMcpServer[]): {
  toolDefs: AnthropicToolDef[];
  owner: Map<string, ResolvedMcpServer>;
} {
  const toolDefs: AnthropicToolDef[] = [];
  const owner = new Map<string, ResolvedMcpServer>();
  for (const server of servers) {
    for (const t of server.tools) {
      if (!t.name || owner.has(t.name)) continue;
      owner.set(t.name, server);
      const schema =
        t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} };
      toolDefs.push({ name: t.name, description: t.description ?? "", input_schema: schema });
    }
  }
  return { toolDefs, owner };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

/** Collapse the model's text blocks into a single string. */
function textFrom(content: AnthropicContentBlock[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/**
 * Run an Anthropic completion that may call MCP tools, looping until the model returns a
 * final answer or the round cap is hit. Returns the final text, or an error reason.
 */
export async function runAnthropicWithTools(args: {
  model: string;
  system: string;
  prompt: string;
  key: string;
  servers: ResolvedMcpServer[];
  maxRounds?: number;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const { model, system, prompt, key, servers } = args;
  const maxRounds = args.maxRounds ?? 4;
  const timeoutMs = args.timeoutMs ?? 30_000;

  const { toolDefs, owner } = buildAnthropicToolDefs(servers);
  if (!toolDefs.length) return { ok: false, reason: "No MCP tools available." };

  const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];

  for (let round = 0; round < maxRounds; round++) {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1024, system, messages, tools: toolDefs }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
    }
    if (!res.ok) return { ok: false, reason: `Upstream error ${res.status}` };

    const json = (await res.json().catch(() => null)) as
      | { content?: AnthropicContentBlock[]; stop_reason?: string }
      | null;
    const content = json?.content;
    if (!content) return { ok: false, reason: "Empty response from provider." };

    const toolUses = content.filter((b) => b.type === "tool_use");
    // No tool call (or model is done) → final answer.
    if (json?.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { ok: true, text: textFrom(content) };
    }

    // Echo the assistant turn, then run each requested tool and return the results.
    messages.push({ role: "assistant", content });
    const toolResults: unknown[] = [];
    for (const tu of toolUses) {
      const server = tu.name ? owner.get(tu.name) : undefined;
      let resultText = "Tool not available.";
      if (server && tu.name) {
        const out = await callMcpTool(server.url, server.token, tu.name, tu.input ?? {});
        resultText = out.ok
          ? JSON.stringify(out.content ?? "").slice(0, 4000)
          : `Error: ${out.error ?? "tool failed"}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { ok: false, reason: "Tool loop exceeded the round limit." };
}

/* ------------------------------------------------------------------------- *
 * OpenAI-compatible variant (OpenAI / Groq / xAI / Mistral). Same loop, the  *
 * chat/completions tool-call wire format.                                    *
 * ------------------------------------------------------------------------- */

interface OpenAiToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** Map resolved MCP tools to OpenAI-compatible tool definitions (pure, testable). */
export function buildOpenAiToolDefs(servers: ResolvedMcpServer[]): {
  toolDefs: OpenAiToolDef[];
  owner: Map<string, ResolvedMcpServer>;
} {
  const toolDefs: OpenAiToolDef[] = [];
  const owner = new Map<string, ResolvedMcpServer>();
  for (const server of servers) {
    for (const t of server.tools) {
      if (!t.name || owner.has(t.name)) continue;
      owner.set(t.name, server);
      const parameters =
        t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} };
      toolDefs.push({ type: "function", function: { name: t.name, description: t.description ?? "", parameters } });
    }
  }
  return { toolDefs, owner };
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/** OpenAI-compatible completion that may call MCP tools, looping to a final answer. */
export async function runOpenAiWithTools(args: {
  provider: AiProviderSlug;
  model: string;
  system: string;
  prompt: string;
  key: string;
  servers: ResolvedMcpServer[];
  maxRounds?: number;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const { provider, model, system, prompt, key, servers } = args;
  const maxRounds = args.maxRounds ?? 4;
  const timeoutMs = args.timeoutMs ?? 30_000;
  const url = CLOUD_ENDPOINT[provider];

  const { toolDefs, owner } = buildOpenAiToolDefs(servers);
  if (!toolDefs.length) return { ok: false, reason: "No MCP tools available." };

  const messages: OpenAiMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  for (let round = 0; round < maxRounds; round++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, tools: toolDefs, stream: false }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
    }
    if (!res.ok) return { ok: false, reason: `Upstream error ${res.status}` };

    const json = (await res.json().catch(() => null)) as
      | { choices?: { message?: OpenAiMessage; finish_reason?: string }[] }
      | null;
    const choice = json?.choices?.[0];
    const message = choice?.message;
    if (!message) return { ok: false, reason: "Empty response from provider." };

    const toolCalls = message.tool_calls ?? [];
    if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
      return { ok: true, text: (message.content ?? "").trim() };
    }

    // Echo the assistant turn (carrying its tool_calls), then return each tool result.
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const server = name ? owner.get(name) : undefined;
      let resultText = "Tool not available.";
      if (server && name) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        const out = await callMcpTool(server.url, server.token, name, parsedArgs);
        resultText = out.ok ? JSON.stringify(out.content ?? "").slice(0, 4000) : `Error: ${out.error ?? "tool failed"}`;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: resultText });
    }
  }

  return { ok: false, reason: "Tool loop exceeded the round limit." };
}
