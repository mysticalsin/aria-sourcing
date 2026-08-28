import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import {
  CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
  isCloudflareAccountId,
  probeCloudflareWorkersAi,
} from "@/lib/integrations/cloudflare-workers-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CloudflareConfigSchema = z
  .object({
    accountId: z.string().trim().min(1).max(64),
    apiKeyId: z.string().uuid(),
    defaultModel: z.string().trim().min(1).max(160).optional(),
    models: z.array(z.string().min(1).max(160)).max(500).optional(),
  })
  .strict()
  .refine((config) => isCloudflareAccountId(config.accountId), {
    message: "Cloudflare account id must be a 32-character hex string.",
    path: ["accountId"],
  });

const CloudflareTestSchema = z
  .object({
    accountId: z.string().trim().min(1).max(64),
    apiToken: z.string().min(20).max(1000),
  })
  .strict()
  .refine((config) => isCloudflareAccountId(config.accountId), {
    message: "Cloudflare account id must be a 32-character hex string.",
    path: ["accountId"],
  });

const CloudflareConnectionRowSchema = z.object({
  account_id: z.string(),
  api_key_id: z.string().uuid(),
  default_model: z.string(),
  models: z.array(z.string()),
  enabled: z.boolean(),
  config_revision: z.number().int().positive(),
  updated_at: z.string(),
});

const CONNECTION_COLUMNS =
  "account_id, api_key_id, default_model, models, enabled, config_revision, updated_at";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type WorkspaceContext =
  | { ok: true; session: ServerSupabase; workspaceId: string }
  | { ok: false; response: NextResponse };

async function workspaceContext(adminOnly: boolean): Promise<WorkspaceContext> {
  if (!supabaseEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Cloudflare configuration requires a live workspace." },
        { status: 400 },
      ),
    };
  }

  const session = await getServerSupabase();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Server authentication is unavailable." }, { status: 503 }),
    };
  }
  if (adminOnly) {
    const admin = await requireAdmin(session);
    if (!admin.ok) return admin;
  }

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    safeLog("Cloudflare config workspace resolution failed", {
      message: workspaceError?.message,
      code: workspaceError?.code,
    });
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Workspace authority could not be resolved." }, { status: 503 }),
    };
  }
  return { ok: true, session, workspaceId };
}

function publicConfig(row: z.infer<typeof CloudflareConnectionRowSchema>) {
  return {
    accountId: row.account_id,
    apiKeyId: row.api_key_id,
    defaultModel: row.default_model,
    models: row.models,
    connected: row.enabled,
    configRevision: row.config_revision,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await workspaceContext(false);
  if (!context.ok) return context.response;

  const { data, error } = await context.session
    .from("cloudflare_connections")
    .select(CONNECTION_COLUMNS)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (error) {
    safeLog("Cloudflare config read failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Cloudflare configuration could not be loaded." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ ok: true, configured: false, config: null });

  const parsed = CloudflareConnectionRowSchema.safeParse({
    ...data,
    models: Array.isArray(data.models) ? data.models : [],
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Cloudflare configuration is invalid." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function PUT(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await workspaceContext(true);
  if (!context.ok) return context.response;

  const limit = checkRateLimit(rateLimitKey(req, "cloudflare-config"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, CloudflareConfigSchema, { maxBytes: 16_000 });
  if (!validated.ok) return validated.response;
  const config = validated.data;

  const { data: key, error: keyError } = await context.session
    .from("api_keys")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("provider", "Cloudflare")
    .eq("status", "valid")
    .eq("id", config.apiKeyId)
    .maybeSingle();
  if (keyError) {
    safeLog("Cloudflare config key lookup failed", { message: keyError.message, code: keyError.code });
    return NextResponse.json({ ok: false, error: "Cloudflare key could not be verified." }, { status: 503 });
  }
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Choose a tested Cloudflare key from this workspace." },
      { status: 409 },
    );
  }

  const defaultModel = config.defaultModel?.trim() || CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL;
  const models = config.models ?? [];

  const { data, error } = await context.session
    .from("cloudflare_connections")
    .upsert(
      {
        workspace_id: context.workspaceId,
        account_id: config.accountId.trim(),
        api_key_id: config.apiKeyId,
        credential_provider: "Cloudflare",
        default_model: defaultModel,
        models,
        enabled: true,
      },
      { onConflict: "workspace_id" },
    )
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) {
    safeLog("Cloudflare config write failed", { message: error.message, code: error.code });
    const status = error.code === "23503" || error.code === "23505" || error.code === "23514" ? 409 : 503;
    return NextResponse.json({ ok: false, error: "Cloudflare configuration could not be saved." }, { status });
  }

  const parsed = CloudflareConnectionRowSchema.safeParse({
    ...data,
    models: Array.isArray(data.models) ? data.models : [],
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Cloudflare configuration was not confirmed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await workspaceContext(true);
  if (!context.ok) return context.response;

  const limit = checkRateLimit(rateLimitKey(req, "cloudflare-test"), { windowMs: 60_000, max: 30 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, CloudflareTestSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const probe = await probeCloudflareWorkersAi(validated.data.accountId, validated.data.apiToken);
  if (!probe.ok) {
    return NextResponse.json({ ok: false, error: probe.detail }, { status: 422 });
  }
  return NextResponse.json({ ok: true, detail: probe.detail, models: probe.models });
}

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await workspaceContext(true);
  if (!context.ok) return context.response;

  const limit = checkRateLimit(rateLimitKey(req, "cloudflare-config-delete"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { error } = await context.session
    .from("cloudflare_connections")
    .delete()
    .eq("workspace_id", context.workspaceId);
  if (error) {
    safeLog("Cloudflare config delete failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Cloudflare configuration could not be removed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: false });
}
