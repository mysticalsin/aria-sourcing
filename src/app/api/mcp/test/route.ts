import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

/**
 * Connection test for a registered MCP (Model Context Protocol) server. Runs the MCP
 * `initialize` JSON-RPC handshake against the server's HTTP endpoint and reports
 * whether it answered as a valid MCP server. Admin-gated (manage_tools) in live mode;
 * the Bearer token is resolved server-side from the key vault and never returned.
 */
const McpTestSchema = z.object({
  url: z.string().url().max(500),
  apiKeyId: z.string().max(120).optional(),
});

interface McpInitResponse {
  result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
  error?: { message?: string };
}

function parseMcpResponse(text: string): McpInitResponse | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as McpInitResponse;
    } catch {
      return null;
    }
  }
  // Streamable HTTP may answer as SSE: find the first `data: {...}` line.
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l.startsWith("data:")) {
      try {
        return JSON.parse(l.slice(5).trim()) as McpInitResponse;
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "mcp-test"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let token = "";
  if (supabaseEnabled) {
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "manage_tools")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, McpTestSchema, { maxBytes: 5_000 });
  if (!validated.ok) return validated.response;
  const { url, apiKeyId } = validated.data;

  // Only http(s); never follow redirects (SSRF hardening). The URL is admin-entered.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL." });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: "Only http(s) MCP endpoints are supported." });
  }

  // Resolve the Bearer token from the vault if one was linked.
  if (apiKeyId && supabaseEnabled) {
    const svc = getServiceSupabase();
    const { data } = (await svc?.from("api_keys").select("secret").eq("id", apiKeyId).maybeSingle()) ?? { data: null };
    const secret = (data as { secret?: string } | null)?.secret;
    if (secret) token = decryptSecret(secret);
  }

  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aria-sourcing", version: "1.0" },
    },
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(initBody),
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `MCP server responded ${res.status}.` });
    }
    const json = parseMcpResponse(await res.text());
    if (json?.result) {
      // A valid initialize result confirms the connection; tools/list (the tool count)
      // is a follow-up call left for when the fleet actually invokes MCP tools.
      return NextResponse.json({ ok: true, serverName: json.result.serverInfo?.name ?? "MCP server" });
    }
    return NextResponse.json({ ok: false, error: json?.error?.message ?? "No valid MCP initialize response." });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "MCP connection failed." });
  }
}
