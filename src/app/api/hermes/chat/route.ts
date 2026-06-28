import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { isAllowedHermesUrl } from "@/lib/api/url";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import {
  buildCloudRequest,
  parseCloudResponse,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";
import { connectAndListTools } from "@/lib/mcp-client";
import { runAnthropicWithTools, type ResolvedMcpServer } from "@/lib/ai/tool-loop";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { redactObject, redactSecrets, redactEmail } from "@/lib/log-redact";

/**
 * Aria runtime proxy (SERVER ONLY).
 *
 * Bridges the browser to the always-on NousResearch hermes-agent aiohttp server
 * (the Python service can't run in Vercel serverless, so we only proxy to it).
 * Uses the OpenAI-compatible endpoint POST /v1/chat/completions.
 *
 * SECURITY / SAFETY:
 *  - The bearer token is resolved server-side (from the api_keys vault by id, or
 *    a HERMES_API_KEY env fallback) and NEVER returned to the client.
 *  - TEXT GENERATION ONLY. This route never invokes any hermes tool that sends a
 *    message — it only asks the model to write text. The human approval gate and
 *    the never-auto-send invariant live upstream in the store; nothing here sends.
 *  - URL is validated against an SSRF allow-list; only local/private Aria hosts
 *    and explicit private IP ranges are permitted.
 *  - When not configured, returns { ok: false, reason } so the caller falls back
 *    to the deterministic mock.
 */

const HermesChatSchema = z.object({
  task: z.enum(["outreach", "classify", "sourcing", "chat"]).default("chat"),
  prompt: z.string().min(1).max(20_000),
  stream: z.boolean().default(false),
  hermesApiKeyId: z.string().uuid().optional(),
  /** Cloud provider to route through. "hermes" = existing self-hosted path. */
  provider: z
    .enum(["hermes", "anthropic", "openai", "groq", "xai", "mistral"])
    .default("hermes"),
  /** ApiKey.id for the cloud provider — raw secret resolved server-side only. */
  apiKeyId: z.string().uuid().optional(),
  // Reject path-traversal / injection in the model id; allow valid model slugs.
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).default("hermes"),
  /** Enabled MCP servers to expose to the model as tools (chat task only). Only the
   *  {url, apiKeyId} is sent — the bearer token is resolved server-side from the vault,
   *  so the browser never holds it. */
  mcpServers: z
    .array(z.object({ url: z.string().url().max(500), apiKeyId: z.string().uuid().optional() }))
    .max(20)
    .optional(),
});

const TASK_SYSTEM: Record<"outreach" | "classify" | "sourcing" | "chat", string> = {
  outreach:
    "You are a senior technical recruiter writing first-touch candidate outreach. " +
    "Lead with the candidate's specific recent work, give one genuine reason for reaching out, " +
    "and end with a soft, low-pressure ask. Keep it under 120 words. No AI slop, no corporate filler, no em-dashes. " +
    "Reply with exactly: a line 'Subject: <subject>' then a blank line then the message body. No preamble.",
  classify:
    "You are a reply-classification engine for recruiting outreach. Read the candidate reply and respond with " +
    "compact JSON only: {\"intent\": one of INTERESTED|QUALIFIED_INTEREST|NOT_INTERESTED|REFERRAL|OOO|UNCLEAR|NEGATIVE, " +
    "\"confidence\": 0..1, \"reasoning\": short string, \"suggestedAction\": short recommended next step, " +
    "\"draftResponse\": short draft reply}. No prose outside the JSON.",
  sourcing:
    "You are a talent-sourcing strategist. Given a role, propose concrete search strategies and target signals. " +
    "Return structured, concise text.",
  chat:
    "You are Aria, the recruiting operations brain behind the Aria agent fleet. Be warm, concise, and practical.",
};

const UPSTREAM_TIMEOUT_MS = 30_000;

function logUpstream(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
  // Structured log line for production observability. In Vercel this becomes
  // a regular function log; in self-hosted environments it can be scraped.
  // Redact before emitting: mask sensitive-keyed values, then scrub any emails /
  // credentials that leaked into free-text fields (e.g. upstream error bodies,
  // network error messages) so nothing sensitive reaches a log sink.
  const entry = { time: new Date().toISOString(), source: "hermes-proxy", level, message, ...redactObject(meta ?? {}) };
  const line = redactSecrets(redactEmail(JSON.stringify(entry)));
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

/** True when a fetch (with redirect:"manual") yielded a redirect we must not follow. */
function isRedirectResponse(res: Response): boolean {
  return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}

/**
 * Resolve a vault secret by ApiKey.id, scoped to the caller's workspace.
 * Returns the raw secret string, or "" on any failure.
 * NEVER logs or returns the value outside the immediate call site.
 */
async function resolveVaultSecret(id?: string): Promise<string> {
  if (!supabaseEnabled || !id) return "";
  const session = getServerSupabase();
  const svc = getServiceSupabase();
  if (!session || !svc) return "";
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return "";
  const { data: wid } = await session.rpc("current_workspace_id");
  const { data: row } = await svc
    .from("api_keys")
    .select("secret, workspace_id")
    .eq("id", id)
    .single();
  if (row && row.workspace_id === wid && typeof row.secret === "string") {
    return decryptSecret(row.secret);
  }
  return "";
}

/**
 * Resolve the caller's enabled MCP servers into connectable servers with their tools.
 * The bearer token for each is resolved from the vault server-side (never from the
 * browser). http(s) only (SSRF). Servers that fail to connect or expose no tools are
 * skipped, so a broken server can't block the chat.
 */
async function gatherMcpServers(
  servers: { url: string; apiKeyId?: string }[],
): Promise<ResolvedMcpServer[]> {
  const resolved: ResolvedMcpServer[] = [];
  for (const s of servers) {
    let parsed: URL;
    try {
      parsed = new URL(s.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const token = s.apiKeyId ? await resolveVaultSecret(s.apiKeyId) : "";
    const conn = await connectAndListTools(s.url, token);
    if (conn.ok && conn.tools && conn.tools.length) {
      resolved.push({ url: s.url, token, tools: conn.tools });
    }
  }
  return resolved;
}

export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*): never serve the
  // open demo path — which could spend env-resident provider keys unauthenticated.
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // S-1: Auth FIRST — reject unauthenticated callers before buffering any body.
  const supabase = supabaseEnabled ? getServerSupabase() : null;
  let userId: string | null = null;
  if (supabaseEnabled) {
    if (!supabase) return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
    userId = user.id;
  } else if (process.env.HERMES_API_URL) {
    // Demo mode but a live Aria runtime is configured — require a shared secret so
    // the proxy isn't an open relay to the upstream runtime.
    const secret = process.env.HERMES_PROXY_SECRET;
    if (!secret) return NextResponse.json({ ok: false, reason: "Proxy authentication not configured." }, { status: 503 });
    if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
    }
  }

  // S-2: Rate limit — 60 req/min, keyed to the authenticated principal (and IP),
  // applied right after identifying the caller and before buffering the body.
  const rl = checkRateLimit(rateLimitKey(req, "hermes-chat", userId), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, HermesChatSchema, { maxBytes: 32_000 });
  if (!validated.ok) return validated.response;
  const { task, prompt, stream, hermesApiKeyId, model, provider, apiKeyId, mcpServers } = validated.data;
  // keyId: cloud provider key id takes precedence over the hermes key id.
  const keyId = apiKeyId ?? hermesApiKeyId;

  // Per-task authorization — outreach/sourcing/classify need the matching permission.
  if (supabaseEnabled && supabase) {
    const { data: role } = await supabase.rpc("current_profile_role");
    const TASK_PERM: Record<string, "outreach" | "source" | undefined> = {
      outreach: "outreach",
      sourcing: "source",
      classify: "source",
    };
    const perm = TASK_PERM[task as string];
    if (perm && !can(role as Role, perm)) {
      return NextResponse.json({ ok: false, reason: "Insufficient permissions for this task." }, { status: 403 });
    }
  }

  // S-3: Server-defined system prompt only — never accept body.system (prompt injection risk).
  const system = TASK_SYSTEM[task as keyof typeof TASK_SYSTEM] ?? TASK_SYSTEM.chat;

  /* ---- Cloud provider branch (Anthropic / OpenAI-compatible) -------------- */
  if (provider !== "hermes") {
    // Key resolution: vault by id (workspace-scoped) → env fallback → error.
    // The raw secret is NEVER logged or returned to the caller.
    const slug = provider as AiProviderSlug;
    const vaultKey = await resolveVaultSecret(keyId);
    const key = vaultKey || process.env[PROVIDER_ENV[slug]] || "";
    if (!key) {
      return NextResponse.json({ ok: false, reason: `No API key configured for ${provider}.` });
    }
    // MCP tool-calling (chat task, Anthropic): when the workspace has enabled MCP
    // servers, let the model call their tools and loop to a final answer. Additive —
    // falls through to the normal single-shot completion when no usable servers resolve.
    if (task === "chat" && slug === "anthropic" && mcpServers && mcpServers.length) {
      const resolvedServers = await gatherMcpServers(mcpServers);
      if (resolvedServers.length) {
        const result = await runAnthropicWithTools({
          model: model && model !== "hermes" ? model : "claude-sonnet-4-6",
          system,
          prompt,
          key,
          servers: resolvedServers,
        });
        if (result.ok && result.text) return NextResponse.json({ ok: true, text: result.text });
        if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason ?? "MCP tool loop failed." });
        // result.ok with empty text → fall through to a normal completion.
      }
    }
    const { url, headers, body } = buildCloudRequest(slug, model ?? "hermes", system, prompt, key);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers,
        body,
        // SSRF hardening: never auto-follow upstream redirects.
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (isRedirectResponse(upstream)) {
        logUpstream("error", "Blocked cloud provider redirect", { provider, status: upstream.status });
        return NextResponse.json({ ok: false, reason: "Upstream redirect blocked (SSRF guard)." });
      }
      if (!upstream.ok) {
        logUpstream("error", "Cloud provider upstream error", { provider, status: upstream.status });
        return NextResponse.json({ ok: false, reason: `Upstream error ${upstream.status}` });
      }
      const json = await upstream.json().catch(() => null);
      const text = parseCloudResponse(slug, json);
      if (!text) {
        return NextResponse.json({ ok: false, reason: "Empty response from provider." });
      }
      return NextResponse.json({ ok: true, text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error.";
      logUpstream("error", "Cloud provider network error", { provider, error: msg });
      return NextResponse.json({ ok: false, reason: redactSecrets(redactEmail(msg)) });
    }
  }

  // S-1: URL is env-only — never use client-supplied hermesApiUrl (SSRF risk).
  const rawBaseUrl = process.env.HERMES_API_URL ?? "";
  const baseUrl = rawBaseUrl.replace(/\/$/, "");
  if (!baseUrl) {
    return NextResponse.json({ ok: false, reason: "Aria runtime URL is not configured." });
  }
  const urlCheck = isAllowedHermesUrl(baseUrl);
  if (!urlCheck.ok) {
    logUpstream("error", "Blocked Aria URL due to SSRF policy", { url: baseUrl, reason: urlCheck.reason });
    return NextResponse.json({ ok: false, reason: `Aria runtime URL rejected: ${urlCheck.reason}` });
  }

  // Resolve the bearer token server-side. Vault by id (workspace-scoped) first;
  // env fallback second. The raw secret is NEVER logged or returned.
  let bearerToken = process.env.HERMES_API_KEY ?? "";
  const vaultSecret = await resolveVaultSecret(hermesApiKeyId);
  if (vaultSecret) bearerToken = vaultSecret;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const upstreamBody = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    stream,
  });

  const upstreamUrl = `${baseUrl}/v1/chat/completions`;
  logUpstream("info", "Proxying Aria request", { task, stream, model });

  /* ---- Streaming: pipe the SSE through unchanged --------------------------- */
  if (stream) {
    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: upstreamBody,
        // SSRF hardening: never auto-follow upstream redirects.
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (isRedirectResponse(upstream)) {
        logUpstream("error", "Blocked Aria redirect", { status: upstream.status });
        return NextResponse.json({ ok: false, reason: "Upstream redirect blocked (SSRF guard)." });
      }
      if (!upstream.ok || !upstream.body) {
        const err = await upstream.text().catch(() => "");
        logUpstream("error", "Aria upstream error", { status: upstream.status, err: err.slice(0, 500) });
        // Generic message to the client; the (redacted) detail is logged above.
        return NextResponse.json({ ok: false, reason: `Upstream error ${upstream.status}` });
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error.";
      logUpstream("error", "Aria upstream network error", { error: msg });
      return NextResponse.json({ ok: false, reason: redactSecrets(redactEmail(msg)) });
    }
  }

  /* ---- Non-stream: return { ok, text } ------------------------------------- */
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: upstreamBody,
      // SSRF hardening: never auto-follow upstream redirects.
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (isRedirectResponse(upstream)) {
      logUpstream("error", "Blocked Aria redirect", { status: upstream.status });
      return NextResponse.json({ ok: false, reason: "Upstream redirect blocked (SSRF guard)." });
    }
    if (!upstream.ok) {
      const err = await upstream.text().catch(() => "");
      logUpstream("error", "Aria upstream error", { status: upstream.status, err: err.slice(0, 500) });
      // Generic message to the client; the (redacted) detail is logged above —
      // matches the streaming path, never leaks the raw upstream error body.
      return NextResponse.json({ ok: false, reason: `Upstream error ${upstream.status}` });
    }
    const json = (await upstream.json().catch(() => null)) as
      | { choices?: { message?: { content?: string }; delta?: { content?: string } }[] }
      | null;
    const text =
      json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? "";
    if (!text) {
      return NextResponse.json({ ok: false, reason: "Empty response from Aria runtime." });
    }
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error.";
    logUpstream("error", "Aria upstream network error", { error: msg });
    return NextResponse.json({ ok: false, reason: redactSecrets(redactEmail(msg)) });
  }
}
