import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateApiKeyFormat } from "@/lib/providers";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { testApifyConnection } from "@/lib/sourcing/apify";
import { clearProviderProbe } from "@/lib/sourcing/provider-egress";

const ApiKeyTestSchema = z.object({
  provider: z.string().max(80).optional(),
  value: z.string().max(1000).optional(),
  id: z.string().uuid().optional(),
});

/**
 * Live Apify auth check (GET /v2/users/me, free of charge) with a format-only
 * fallback on network/timeout error.
 * testApifyConnection never throws (its request wrapper swallows transport
 * errors as status 0), so that case is also routed to the format-only
 * fallback here rather than only on a thrown exception.
 */
async function testApifyKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    const live = await testApifyConnection(clearProviderProbe("Apify"), value);
    if (live.ok) return { valid: true, detail: `Apify key accepted (HTTP ${live.status}).` };
    if (live.status === 401) return { valid: false, detail: live.detail || live.title || "Apify rejected this key (401)." };
    if (live.status === 0) {
      const fmt = validateApiKeyFormat("Apify", value);
      return { valid: fmt.valid, detail: `${fmt.detail} Apify was unreachable, format check only.` };
    }
    return { valid: false, detail: live.detail || live.title || `Apify returned an unexpected HTTP ${live.status}.` };
  } catch {
    return validateApiKeyFormat("Apify", value);
  }
}

/**
 * Test an API key. Either test a value passed directly (just-entered), or test a
 * stored key by id — the secret is read server-side via the service-role client
 * (workspace-scoped), validated, and the row's status is updated. Never returns
 * the secret.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: when a real backend is configured, require admin BEFORE any work
  // or response. The just-entered "value" format check previously returned to
  // unauthenticated callers — it now sits behind this gate.
  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const admin = await requireAdmin(session);
    if (!admin.ok) return admin.response;
  }

  // Throttle: key testing drives provider/LLM cost — abuse-prone. Tight limit.
  const limit = checkRateLimit(rateLimitKey(req, "keys-test"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, ApiKeyTestSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { provider, value, id } = validated.data;

  // Direct value test (e.g. on the entry form) — now behind the auth gate above.
  if (value) {
    if ((provider ?? "") === "Apify") {
      const result = await testApifyKey(value);
      return NextResponse.json({ ok: true, valid: result.valid, detail: result.detail });
    }
    const fmt = validateApiKeyFormat(provider ?? "", value);
    return NextResponse.json({ ok: true, valid: fmt.valid, detail: fmt.detail });
  }

  if (!id) return NextResponse.json({ ok: false, error: "Provide a key value or id." }, { status: 400 });

  // Stored-key test by id.
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, valid: true, detail: "Simulated test (demo mode)." });
  }
  const svc = getServiceSupabase();
  if (!session || !svc) {
    return NextResponse.json({ ok: false, error: "Service role not configured." }, { status: 500 });
  }

  const { data: wid } = await session.rpc("current_workspace_id");

  const { data: row, error } = await svc
    .from("api_keys")
    .select("provider, secret, workspace_id")
    .eq("id", id)
    .single();
  if (error || !row) return NextResponse.json({ ok: false, error: "Key not found." }, { status: 404 });
  if (row.workspace_id !== wid) return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });

  const secret = decryptSecret(row.secret);
  let fmt: { valid: boolean; detail: string };
  if (row.provider === "Apify") {
    fmt = await testApifyKey(secret);
  } else {
    fmt = validateApiKeyFormat(row.provider, secret);
  }
  await svc
    .from("api_keys")
    .update({ status: fmt.valid ? "valid" : "invalid", last_tested_at: new Date().toISOString() })
    .eq("id", id);
  return NextResponse.json({ ok: true, valid: fmt.valid, detail: fmt.detail });
}
