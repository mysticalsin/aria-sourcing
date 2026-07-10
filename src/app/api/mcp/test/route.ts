import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { assertPublicUrl } from "@/lib/api/url";
import { can } from "@/lib/rbac";
import { AUTH_QUERY_PARAMS } from "@/lib/types";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { applyMcpAuth, connectAndListTools } from "@/lib/mcp-client";
import { validateMcpBaseUrlHasNoAuthQueryParam } from "@/lib/mcp-auth-params";

/**
 * Connection test for a registered MCP (Model Context Protocol) server. Runs the MCP
 * `initialize` JSON-RPC handshake against the server's HTTP endpoint and reports
 * whether it answered as a valid MCP server. Admin-gated (manage_tools) in live mode;
 * the auth secret is resolved server-side from the key vault and never returned.
 */
const McpTestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(500)
      .refine((url) => validateMcpBaseUrlHasNoAuthQueryParam(url).ok, {
        message: "MCP server URL must not contain auth query params.",
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

  // SSRF guard: block private/loopback/link-local/metadata hosts (and DNS-rebinding)
  // before the server ever dials the admin-entered URL.
  const guard = await assertPublicUrl(url);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.reason ?? "URL blocked." }, { status: 400 });
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
