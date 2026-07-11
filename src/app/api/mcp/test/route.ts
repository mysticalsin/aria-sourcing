import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import { AUTH_QUERY_PARAMS } from "@/lib/types";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { applyMcpAuth, connectAndListTools, remoteMcpDiscoveryEnabled } from "@/lib/mcp-client";
import { validateMcpBaseUrl } from "@/lib/mcp-auth-params";

export const runtime = "nodejs";

/**
 * Connection test for a registered MCP (Model Context Protocol) server. Runs the MCP
 * `initialize` JSON-RPC handshake against the server's HTTP endpoint and reports
 * whether it answered as a valid MCP server. Admin-gated (manage_tools) and available
 * only behind the explicit development/test remote-MCP opt-in. Production refuses the
 * probe before resolving any auth secret from the key vault.
 */
const McpTestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(500)
      .refine((url) => validateMcpBaseUrl(url).ok, {
        message: "MCP server URL must be HTTPS and contain no credentials, query, or fragment.",
      }),
    apiKeyId: z.string().uuid().optional(),
    authStyle: z.enum(["bearer", "query"]).optional(),
    authQueryParam: z.enum(AUTH_QUERY_PARAMS).optional(),
  })
  .superRefine((server, ctx) => {
    if ((server.authStyle ?? "bearer") === "query" && !server.authQueryParam) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authQueryParam"],
        message: "authQueryParam is required for query-auth MCP servers.",
      });
    }
  });

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "MCP server";
  }
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "mcp-test"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let token = "";
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "manage_tools")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  } else if (demoLoginEnabled) {
    // Public demo (no Supabase): require the signed admin/admin session cookie so
    // this route isn't reachable anonymously (mirrors the hermes/chat cost gate).
    if (!demoAuthConfigured() || !verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) {
      return NextResponse.json({ ok: false, error: "Sign in to use this tool." }, { status: 401 });
    }
  }

  const validated = await validateBody(req, McpTestSchema, { maxBytes: 5_000 });
  if (!validated.ok) return validated.response;
  const { url, apiKeyId, authStyle, authQueryParam } = validated.data;
  const host = hostFor(url);

  // HTTPS only; never follow redirects (SSRF hardening). The URL is admin-entered.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL." });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "Only HTTPS MCP endpoints are supported." });
  }

  // Credentialed third-party discovery is intentionally unavailable in
  // production. Check before resolving the vault id so a denied probe touches
  // neither secret material nor the remote server.
  if (!remoteMcpDiscoveryEnabled()) {
    return NextResponse.json({ ok: false, error: "Remote MCP discovery is disabled." }, { status: 403 });
  }

  // Resolve the Bearer token from the vault if one was linked, scoped to the
  // caller's workspace (see resolveVaultSecret in @/lib/ai/vault-secret.ts).
  if (apiKeyId) {
    token = await resolveVaultSecret(apiKeyId);
  }
  let auth: { url: string; token: string };
  try {
    auth = applyMcpAuth(url, token, { authStyle, authQueryParam });
  } catch {
    return NextResponse.json({ ok: false, error: `MCP authentication is misconfigured for ${host}.` }, { status: 400 });
  }

  // initialize + tools/list via the MCP client, so the test reports the real tools.
  try {
    const result = await connectAndListTools(auth.url, auth.token);
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        serverName: result.serverName,
        toolCount: result.tools?.length ?? 0,
        toolNames: (result.tools ?? []).map((t) => t.name).slice(0, 50),
      });
    }
    return NextResponse.json({ ok: false, error: result.error ?? "MCP connection failed." });
  } catch {
    return NextResponse.json({ ok: false, error: `MCP connection failed for ${host}.` });
  }
}
