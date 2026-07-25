import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import {
  getHermesBaseUrl,
  resolveHermesBearerToken,
  logHermesProxy,
  isAllowedHermesPath,
  HERMES_PROXY_TIMEOUT_MS,
} from "@/lib/api/hermes-proxy";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { redactObject, redactSecrets, redactEmail } from "@/lib/log-redact";
import {
  evaluateHermesProxyOperation,
  evaluateHermesWorkspaceBinding,
} from "@/lib/api/hermes-runtime-isolation";

/**
 * Aria runtime proxy (SERVER ONLY).
 *
 * Single entry point for all Aria runtime HTTP calls. The caller passes the
 * upstream Aria path as a query parameter (`?path=api/status`) and the HTTP
 * method is forwarded unchanged. This avoids a Next.js App Router catch-all API
 * route, which can trigger build-time internal errors in some Next.js 14 builds.
 *
 * Security:
 *  - Authenticated callers only for EVERY method — Supabase session in prod, a
 *    shared proxy secret in demo. No demo bypass; never an open relay.
 *  - Rate-limited (60/min) per principal+IP.
 *  - Aria base URL is taken from env only; SSRF allow-list + no redirect-follow.
 *  - Bearer token resolved server-side (env fallback + api_keys vault).
 *  - Only paths listed in HERMES_PROXY_ALLOW_LIST are forwarded.
 *  - Request bodies are capped; response bodies are streamed through without parsing.
 */

const ProxyQuerySchema = z.object({
  upstreamPath: z.string().min(1).max(200),
  hermesApiKeyId: z.string().uuid().optional(),
});

/** Reject upstream request bodies larger than this before forwarding (DoS guard). */
const MAX_PROXY_BODY_BYTES = 256 * 1024;

/** True when a fetch (with redirect:"manual") yielded a redirect we must not follow. */
function isRedirectResponse(res: Response): boolean {
  return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}

async function handler(req: NextRequest) {
  const supabase = supabaseEnabled ? await getServerSupabase() : null;

  // S-1: Auth FIRST — require an authenticated principal for EVERY method, in demo
  // AND prod. The proxy must never be an open relay (closes the unauthenticated-GET
  // BFLA / open-relay hole). No demo bypass.
  let userId: string | null = null;
  let workspaceId: string | null = null;
  let callerRole: Role | null = null;
  if (supabaseEnabled) {
    if (!supabase) return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
    userId = user.id;
  } else {
    // Demo mode: no Supabase session to verify, so require the shared proxy secret
    // for every method — there is no demo bypass for the proxy.
    const secret = process.env.HERMES_PROXY_SECRET;
    if (!secret) return NextResponse.json({ ok: false, reason: "Proxy authentication not configured." }, { status: 503 });
    if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
    }
  }

  // S-2: Rate limit — 60 req/min, keyed to the authenticated principal (and IP),
  // applied right after identifying the caller and before any upstream work.
  const rl = checkRateLimit(rateLimitKey(req, "hermes-proxy", userId), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // S-3: bind the one-process runtime to the caller's server-resolved workspace.
  if (supabaseEnabled && supabase) {
    const [{ data: resolvedWorkspaceId, error: workspaceError }, { data: role }] = await Promise.all([
      supabase.rpc("current_workspace_id"),
      supabase.rpc("current_profile_role"),
    ]);
    workspaceId = typeof resolvedWorkspaceId === "string" ? resolvedWorkspaceId : null;
    callerRole = role as Role;
    if (workspaceError || !workspaceId) {
      return NextResponse.json({ ok: false, reason: "Workspace not available." }, { status: 403 });
    }
  }
  const production = process.env.NODE_ENV === "production";
  const binding = evaluateHermesWorkspaceBinding({
    production,
    supabaseEnabled,
    workspaceId,
    boundWorkspaceId: process.env.HERMES_RUNTIME_WORKSPACE_ID,
  });
  if (!binding.ok) {
    return NextResponse.json({ ok: false, reason: binding.reason }, { status: binding.status });
  }

  // Preserve the development admin boundary. Production is stricter below:
  // every generic mutation is disabled, including chat and session creation.
  if (!production && supabaseEnabled && supabase) {
    const requestedPath = (req.nextUrl.searchParams.get("upstreamPath") ?? "").replace(/^\/+/, "");
    const nonAdminPostPaths = ["v1/chat/completions", "api/sessions"];
    const adminMutation =
      ["PUT", "PATCH", "DELETE"].includes(req.method) ||
      (req.method === "POST" && !nonAdminPostPaths.includes(requestedPath));
    if (adminMutation && !can(callerRole as Role, "manage_settings")) {
      return NextResponse.json({ ok: false, reason: "Admins only." }, { status: 403 });
    }
  }

  // S-4: validate query.
  const searchParams = req.nextUrl.searchParams;
  const queryCheck = ProxyQuerySchema.safeParse({
    upstreamPath: searchParams.get("upstreamPath") ?? undefined,
    hermesApiKeyId: searchParams.get("hermesApiKeyId") ?? undefined,
  });
  if (!queryCheck.success) {
    return NextResponse.json({ ok: false, reason: "Invalid query parameters." }, { status: 400 });
  }

  // S-5: path allow-list.
  const upstreamPath = queryCheck.data.upstreamPath.replace(/^\//, "");
  const pathCheck = isAllowedHermesPath(upstreamPath.split("/").filter(Boolean));
  if (!pathCheck.ok) {
    logHermesProxy("error", "Blocked Aria proxy path", redactObject({ path: redactSecrets(redactEmail(upstreamPath)), reason: pathCheck.reason }));
    return NextResponse.json({ ok: false, reason: pathCheck.reason }, { status: 404 });
  }

  const operation = evaluateHermesProxyOperation({
    production,
    method: req.method,
    upstreamPath: pathCheck.upstreamPath,
    canManageSettings: can(callerRole as Role, "manage_settings"),
  });
  if (!operation.ok) {
    return NextResponse.json(
      { ok: false, reason: operation.reason },
      { status: operation.status, ...(operation.status === 405 ? { headers: { Allow: "GET" } } : {}) },
    );
  }

  // S-6: base URL from env only, chosen by the path's owning upstream process.
  // Upstream is two servers with disjoint route sets; the allow-list records
  // which one owns each path so the decision is data, not convention.
  const baseUrlResult = getHermesBaseUrl(pathCheck.base);
  if (!baseUrlResult.ok) {
    return NextResponse.json({ ok: false, reason: baseUrlResult.reason });
  }

  // S-7: resolve bearer token server-side.
  const bearerToken = await resolveHermesBearerToken(queryCheck.data.hermesApiKeyId);
  if (!bearerToken.ok) {
    return NextResponse.json({ ok: false, reason: bearerToken.reason }, { status: 403 });
  }
  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  if (bearerToken.token) headers["Authorization"] = `Bearer ${bearerToken.token}`;

  const upstreamUrl = new URL(`${baseUrlResult.baseUrl}/${pathCheck.upstreamPath}`);
  // Forward only an explicit safe-param allowlist — never blindly relay client-supplied
  // query keys to the upstream runtime (parameter injection).
  for (const key of ["page", "limit", "cursor", "q", "level"]) {
    const val = searchParams.get(key);
    if (val !== null) upstreamUrl.searchParams.set(key, val);
  }
  logHermesProxy("info", "Proxying Aria request", { method: req.method, path: pathCheck.upstreamPath });

  try {
    let body: ArrayBuffer | undefined;
    if (!["GET", "HEAD", "DELETE"].includes(req.method)) {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_PROXY_BODY_BYTES) {
        return NextResponse.json({ ok: false, reason: "Payload too large." }, { status: 413 });
      }
      body = buf;
    }
    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers,
      body,
      // SSRF hardening: never auto-follow upstream redirects — a 3xx Location could
      // bounce us to an internal address outside the env allow-list.
      redirect: "manual",
      signal: AbortSignal.timeout(HERMES_PROXY_TIMEOUT_MS),
    });

    if (isRedirectResponse(upstream)) {
      logHermesProxy("error", "Blocked upstream redirect", redactObject({
        status: upstream.status,
        location: redactSecrets(redactEmail(upstream.headers.get("location") ?? "")),
        path: pathCheck.upstreamPath,
      }));
      return NextResponse.json({ ok: false, reason: "Upstream redirect blocked (SSRF guard)." }, { status: 502 });
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      logHermesProxy("error", "Upstream error", redactObject({ status: upstream.status, err: redactSecrets(redactEmail(errText.slice(0, 500))), path: pathCheck.upstreamPath }));
      return NextResponse.json({ ok: false, reason: `Upstream error ${upstream.status}.` }, { status: upstream.status >= 500 ? 502 : upstream.status });
    }
    if (!upstream.body) {
      return new NextResponse(null, { status: upstream.status, statusText: upstream.statusText });
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error.";
    const safeMsg = redactSecrets(redactEmail(msg));
    logHermesProxy("error", "Aria proxy upstream error", redactObject({ error: safeMsg, path: pathCheck.upstreamPath }));
    return NextResponse.json({ ok: false, reason: safeMsg }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
