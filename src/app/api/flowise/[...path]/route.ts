import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Flowise sidecar proxy — ARIA's only path to the Flowise API.
 *
 * Why a proxy: the OSS Flowise auth model is one shared workspace with
 * API keys (see _relay/research/2026-07-09-flowise-integration-spec.md).
 * The workspace API key therefore stays server-side here — the browser never
 * holds it — and ARIA's own session auth decides who may reach Flowise at
 * all. The app's CSP (connect-src 'self') also means the browser cannot talk
 * to the sidecar directly; everything flows through this route.
 *
 * Env: FLOWISE_URL (sidecar base, e.g. https://flows.internal.example) and
 * FLOWISE_API_KEY. Absent → 503, feature simply off.
 */

const ALLOWED_PREFIXES = ["chatflows", "prediction", "agentflowv2-generator", "apikey"];

async function proxy(req: NextRequest, params: { path: string[] }) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const base = (process.env.FLOWISE_URL ?? "").replace(/\/+$/, "");
  const apiKey = process.env.FLOWISE_API_KEY ?? "";
  if (!base || !apiKey) {
    return NextResponse.json({ ok: false, reason: "Flowise sidecar not configured." }, { status: 503 });
  }

  // ARIA session gate (operators only). Demo mode has no Flowise.
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, reason: "Flowise requires the Supabase backend." }, { status: 503 });
  }
  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "source")) {
    return NextResponse.json({ ok: false, reason: "Insufficient permissions." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "flowise-proxy", user.id), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // Path allowlist — only the API families Agent Studio needs, no traversal.
  const segments = (params.path ?? []).filter((s) => s !== ".." && s !== ".");
  if (segments.length === 0 || !ALLOWED_PREFIXES.includes(segments[0])) {
    return NextResponse.json({ ok: false, reason: "Path not allowed." }, { status: 403 });
  }

  const target = `${base}/api/v1/${segments.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": req.headers.get("content-type") ?? "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(target, init);
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "Flowise unreachable." },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, await ctx.params);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, await ctx.params);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, await ctx.params);
}
