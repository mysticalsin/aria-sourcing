import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateApiKeyFormat } from "@/lib/providers";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { testSillageConnection } from "@/lib/sourcing/sillage";
import { checkApolloAuth } from "@/lib/sourcing/apollo";
import { checkSeamlessAuth } from "@/lib/sourcing/seamless";
import { testApifyConnection } from "@/lib/sourcing/apify";
import { safeLog } from "@/lib/log-redact";
import {
  isExecutionCredentialProvider,
  verifyExecutionCredential,
} from "@/lib/ai/provider-key-verification";

const ApiKeyTestSchema = z.object({
  provider: z.string().max(80).optional(),
  value: z.string().max(1000).optional(),
  id: z.string().uuid().optional(),
});

type KeyTestStatus = "untested" | "valid" | "invalid";
type KeyTestResult = {
  valid: boolean;
  status: KeyTestStatus;
  detail: string;
  verificationMethod: "provider_models_list_v1" | "tavily_usage_v1" | null;
  verificationHttpStatus: number | null;
};

function legacyResult(result: { valid: boolean; detail: string }): KeyTestResult {
  return {
    ...result,
    status: result.valid ? "valid" : "invalid",
    verificationMethod: null,
    verificationHttpStatus: null,
  };
}

/**
 * Classify a live Sillage contents/query probe into a valid/invalid verdict.
 * 401 is the only "bad key" signal Sillage documents — any other status (even
 * 402/403/404/409/422/429) means the key itself authenticated, so it's honestly
 * reported valid with that status's own detail. A network/timeout error falls
 * back to the deterministic format check, flagged as inconclusive.
 */
function classifySillageTest(
  live: Awaited<ReturnType<typeof testSillageConnection>>,
  fallbackFormat: () => { valid: boolean; detail: string },
): { valid: boolean; detail: string } {
  if (live.ok) return { valid: true, detail: `Sillage key accepted (HTTP ${live.status}).` };
  if (live.status === 401) return { valid: false, detail: live.detail || live.title || "Sillage rejected this key (401)." };
  if (live.status === 0) {
    const fmt = fallbackFormat();
    return { valid: fmt.valid, detail: `${fmt.detail} Sillage was unreachable, format check only.` };
  }
  return { valid: true, detail: live.detail || live.title || `Sillage responded (HTTP ${live.status}).` };
}

/**
 * Live Apollo auth check (GET /v1/auth/health, free of charge) with a
 * format-only fallback on network/timeout error — checkApolloAuth already
 * returns the {valid, detail} shape this route needs, so no separate
 * classifier is required the way Sillage's status-code fan-out needs one.
 */
async function testApolloKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    return await checkApolloAuth(value);
  } catch {
    return validateApiKeyFormat("Apollo", value);
  }
}

/**
 * Live Seamless auth check (GET /contacts, documented free of research
 * credits) with a format-only fallback on network/timeout error — same shape
 * as testApolloKey.
 */
async function testSeamlessKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    return await checkSeamlessAuth(value);
  } catch {
    return validateApiKeyFormat("Seamless", value);
  }
}

/**
 * Live Apify auth check (GET /v2/users/me, free of charge) with a format-only
 * fallback on network/timeout error — mirrors testApolloKey's try/catch shape.
 * testApifyConnection never throws (its request wrapper swallows transport
 * errors as status 0), so that case is also routed to the format-only
 * fallback here rather than only on a thrown exception.
 */
async function testApifyKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    const live = await testApifyConnection(value);
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

async function testKey(provider: string, value: string): Promise<KeyTestResult> {
  if (isExecutionCredentialProvider(provider)) {
    const result = await verifyExecutionCredential(provider, value);
    return {
      valid: result.status === "valid",
      status: result.status,
      detail: result.detail,
      verificationMethod: result.method,
      verificationHttpStatus: result.httpStatus,
    };
  }
  if (provider === "Sillage") {
    return legacyResult(
      classifySillageTest(
        await testSillageConnection(value),
        () => validateApiKeyFormat(provider, value),
      ),
    );
  }
  if (provider === "Apollo") return legacyResult(await testApolloKey(value));
  if (provider === "Seamless") return legacyResult(await testSeamlessKey(value));
  if (provider === "Apify") return legacyResult(await testApifyKey(value));
  return legacyResult(validateApiKeyFormat(provider, value));
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
    const result = await testKey(provider ?? "", value);
    return NextResponse.json({
      ok: true,
      valid: result.valid,
      status: result.status,
      detail: result.detail,
    });
  }

  if (!id) return NextResponse.json({ ok: false, error: "Provide a key value or id." }, { status: 400 });

  // Stored-key test by id.
  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      valid: false,
      status: "untested",
      detail: "Live credential verification is unavailable in demo mode.",
    });
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
  const result = await testKey(row.provider, secret);
  const testedAt = new Date().toISOString();
  const { error: statusUpdateError } = await svc
    .from("api_keys")
    .update({
      status: result.status,
      last_tested_at: testedAt,
      verification_method: result.verificationMethod,
      verification_http_status: result.verificationHttpStatus,
    })
    .eq("id", id);
  if (statusUpdateError) {
    safeLog("could not persist API key test evidence", {
      message: statusUpdateError.message,
      code: statusUpdateError.code,
    });
    return NextResponse.json(
      { ok: false, error: "Key test evidence could not be saved. Try again." },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    valid: result.valid,
    status: result.status,
    detail: result.detail,
  });
}
