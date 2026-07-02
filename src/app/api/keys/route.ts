import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { last4Of, validateApiKeyFormat } from "@/lib/providers";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";

const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(80),
  value: z.string().min(1).max(1000),
});

/**
 * API key storage. Secrets are written to the `api_keys` table (admin-only via
 * RLS) and NEVER returned to the browser. In DEMO mode nothing persists
 * server-side — the response carries only metadata (last4) for the session.
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
  const fmt = validateApiKeyFormat(provider, value);

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      last4,
      formatValid: fmt.valid,
      detail: "Saved for this session (demo). Configure Supabase to persist server-side.",
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
    .insert({ workspace_id: wid, name, provider, secret: encryptSecret(value), last4, created_by: createdBy })
    .select("id");
  if (error) {
    // Log the DB detail server-side (redacted); never echo Postgres/RLS internals to the client.
    safeLog("api_keys insert error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Couldn't save the key — try again." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, id: data[0].id, last4, formatValid: fmt.valid });
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
    return NextResponse.json({ ok: false, error: "Couldn't delete the key — try again." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
