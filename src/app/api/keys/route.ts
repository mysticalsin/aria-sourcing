import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed, experimentalPaidSourcingEnabled } from "@/lib/supabase/config";
import { last4Of, validateApiKeyFormat } from "@/lib/providers";
import { isLiveLlmKeyProvider, testLlmApiKey } from "@/lib/ai/key-probe";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";
import { testSillageConnection } from "@/lib/sourcing/sillage";
import { checkApolloAuth } from "@/lib/sourcing/apollo";
import { checkSeamlessAuth } from "@/lib/sourcing/seamless";
import { testApifyConnection } from "@/lib/sourcing/apify";
import { checkHeyReachApiKey } from "@/lib/heyreach-delivery";
import { clearProviderProbe } from "@/lib/sourcing/provider-egress";

const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(80),
  value: z.string().min(1).max(1000),
});

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
 * Encrypt-then-verify for a newly pasted secret. Mirrors /api/keys/test probes
 * so add-key is end-to-end in one round trip. Never logs `value`.
 */
async function verifyNewKey(
  provider: string,
  value: string,
): Promise<{ valid: boolean; detail: string }> {
  if (provider === "Sillage") {
    if (!experimentalPaidSourcingEnabled) {
      return { valid: false, detail: "Sillage is disabled on this deployment." };
    }
    const live = await testSillageConnection(clearProviderProbe("Sillage"), value);
    return classifySillageTest(live, () => validateApiKeyFormat(provider, value));
  }
  if (provider === "Apollo") {
    try {
      return await checkApolloAuth(clearProviderProbe("Apollo"), value);
    } catch {
      return validateApiKeyFormat(provider, value);
    }
  }
  if (provider === "Seamless") {
    if (!experimentalPaidSourcingEnabled) {
      return { valid: false, detail: "Seamless is disabled on this deployment." };
    }
    try {
      return await checkSeamlessAuth(clearProviderProbe("Seamless"), value);
    } catch {
      return validateApiKeyFormat(provider, value);
    }
  }
  if (provider === "Apify") {
    try {
      const live = await testApifyConnection(clearProviderProbe("Apify"), value);
      if (live.ok) return { valid: true, detail: `Apify key accepted (HTTP ${live.status}).` };
      if (live.status === 401) {
        return { valid: false, detail: live.detail || live.title || "Apify rejected this key (401)." };
      }
      if (live.status === 0) {
        const fmt = validateApiKeyFormat("Apify", value);
        return { valid: fmt.valid, detail: `${fmt.detail} Apify was unreachable, format check only.` };
      }
      return { valid: false, detail: live.detail || live.title || `Apify returned an unexpected HTTP ${live.status}.` };
    } catch {
      return validateApiKeyFormat(provider, value);
    }
  }
  if (isLiveLlmKeyProvider(provider)) return testLlmApiKey(provider, value);
  if (provider === "HeyReach") {
    const ok = await checkHeyReachApiKey(value);
    return ok
      ? { valid: true, detail: "HeyReach API key accepted (CheckApiKey)." }
      : { valid: false, detail: "HeyReach rejected this API key (CheckApiKey)." };
  }
  return validateApiKeyFormat(provider, value);
}

/**
 * API key storage. Secrets are written to the `api_keys` table (admin-only via
 * RLS) and NEVER returned to the browser. After encrypt/store we probe the
 * provider end-to-end and return only last4 + verification status.
 * In DEMO mode nothing persists server-side — we still probe with the plaintext
 * once, then discard it and return metadata for the session.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: resolve and authorise the caller BEFORE parsing the body or
  // touching the secret. Demo mode (no Supabase) is intentionally open and only
  // echoes metadata.
  let supabase: Awaited<ReturnType<typeof getServerSupabase>> = null;
  let createdBy = "unknown";
  if (supabaseEnabled) {
    supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const admin = await requireAdmin(supabase);
    if (!admin.ok) return admin.response;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    createdBy = user?.email ?? "unknown";
  }

  // Throttle: persisting secrets is sensitive — blunt abuse / accidental loops.
  const limit = checkRateLimit(rateLimitKey(req, "keys-create"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, ApiKeyCreateSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { name, provider, value } = validated.data;

  const last4 = last4Of(value);
  const format = validateApiKeyFormat(provider, value);
  // Probe while we still hold plaintext (never returned to the client).
  const probe = await verifyNewKey(provider, value);
  const status = probe.valid ? "valid" : "invalid";

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      id: randomUUID(),
      last4,
      formatValid: format.valid,
      valid: probe.valid,
      status,
      detail: probe.detail,
    });
  }

  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });

  // Fail closed: never persist a new secret in cleartext when production requires
  // encryption at rest but DATA_ENCRYPTION_KEY isn't configured.
  if (encryptionRequiredButMissing()) {
    return NextResponse.json(
      { ok: false, error: "Server encryption key is not configured." },
      { status: 503 },
    );
  }

  const { data: wid } = await supabase.rpc("ensure_workspace");
  // select("id") only: `authenticated` has no column-level SELECT grant on
  // `secret` (by design — it must never round-trip to the browser), and an
  // unqualified .select() asks PostgREST to RETURNING * (every column),
  // which Postgres then denies wholesale as "permission denied for table".
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      workspace_id: wid,
      name,
      provider,
      secret: encryptSecret(value),
      last4,
      created_by: createdBy,
      status,
      last_tested_at: new Date().toISOString(),
    })
    .select("id");
  if (error) {
    // Log the DB detail server-side (redacted); never echo Postgres/RLS internals to the client.
    safeLog("api_keys insert error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Couldn't save the key. Try again." }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    id: data[0].id,
    last4,
    formatValid: format.valid,
    valid: probe.valid,
    status,
    detail: probe.detail,
  });
}

export async function DELETE(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: authorise BEFORE validating input or returning anything.
  let supabase: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const admin = await requireAdmin(supabase);
    if (!admin.ok) return admin.response;
  }

  const limit = checkRateLimit(rateLimitKey(req, "keys-delete"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Missing or invalid id." }, { status: 400 });
  }

  if (!supabaseEnabled) return NextResponse.json({ ok: true, demo: true });
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const { error } = await supabase.from("api_keys").delete().eq("id", id);
  if (error) {
    safeLog("api_keys delete error", { message: error.message, code: error.code });
    if (error.code === "23503") {
      return NextResponse.json(
        { ok: false, error: "Disconnect or rebind integrations that use this key before deleting it." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: "Couldn't delete the key. Try again." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
