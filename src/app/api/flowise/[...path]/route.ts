import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getFlowiseProxyPolicy } from "@/lib/flowise-policy";

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

  const policy = getFlowiseProxyPolicy(req.method, params.path ?? []);
  if (!policy.ok) {
    return NextResponse.json(
      { ok: false, reason: policy.reason },
      { status: req.method === "POST" ? 403 : 405, headers: { Allow: "POST" } },
    );
  }
  const { data: flowSpec, error: flowSpecErr } = await supabase
    .from("agent_specs")
    .select("id")
    .eq("flowise_chatflow_id", policy.flowId)
    .neq("status", "archived")
    .maybeSingle();
  if (flowSpecErr) {
    return NextResponse.json({ ok: false, reason: "Could not verify the Flowise flow." }, { status: 500 });
  }
  if (!flowSpec) {
    return NextResponse.json({ ok: false, reason: "Flowise flow not found." }, { status: 404 });
  }

  const target = `${base}/api/v1/prediction/${encodeURIComponent(policy.flowId)}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": req.headers.get("content-type") ?? "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  };
  const body = await req.text();
  if (body.length > 100_000) {
    return NextResponse.json({ ok: false, reason: "Flowise request body is too large." }, { status: 413 });
  }
  init.body = body;

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
