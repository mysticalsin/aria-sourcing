import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { classifyFetchHost } from "@/lib/api/url";
import { validateBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import {
  canonicalDatabricksOrigin,
  isDatabricksOriginAllowed,
} from "@/lib/integrations/databricks-origin-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DatabricksConfigSchema = z
  .object({
    host: z.string().url().max(2048),
    warehouseId: z.string().trim().min(1).max(256),
    authMode: z.enum(["pat", "m2m"]),
    clientId: z.string().trim().max(256).optional(),
    apiKeyId: z.string().uuid(),
    needsQuery: z.string().min(1).max(20_000),
  })
  .strict()
  .refine((config) => config.authMode === "pat" || Boolean(config.clientId), {
    message: "OAuth client ID is required for M2M authentication.",
    path: ["clientId"],
  })
  .refine((config) => config.needsQuery.includes(":since"), {
    message: "The needs query must use the :since parameter.",
    path: ["needsQuery"],
  });

const DatabricksConnectionRowSchema = z.object({
  id: z.string().uuid(),
  origin: z.string(),
  warehouse_id: z.string(),
  auth_mode: z.enum(["pat", "m2m"]),
  client_id: z.string().nullable(),
  api_key_id: z.string().uuid(),
  needs_query: z.string(),
  enabled: z.boolean(),
  config_revision: z.number().int().positive(),
  updated_at: z.string(),
});

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

type AdminContext =
  | { ok: true; session: ServerSupabase; workspaceId: string }
  | { ok: false; response: NextResponse };

async function adminContext(): Promise<AdminContext> {
  if (!supabaseEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Databricks configuration requires a live workspace." },
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
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin;

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    safeLog("Databricks config workspace resolution failed", {
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

function publicConfig(row: z.infer<typeof DatabricksConnectionRowSchema>) {
  return {
    id: row.id,
    host: row.origin,
    warehouseId: row.warehouse_id,
    authMode: row.auth_mode,
    clientId: row.client_id ?? undefined,
    apiKeyId: row.api_key_id,
    needsQuery: row.needs_query,
    enabled: row.enabled,
    configRevision: row.config_revision,
    updatedAt: row.updated_at,
  };
}

const CONNECTION_COLUMNS =
  "id, origin, warehouse_id, auth_mode, client_id, api_key_id, needs_query, enabled, config_revision, updated_at";

export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await adminContext();
  if (!context.ok) return context.response;
  const { data, error } = await context.session
    .from("databricks_connections")
    .select(CONNECTION_COLUMNS)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (error) {
    safeLog("Databricks config read failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Databricks configuration could not be loaded." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ ok: true, configured: false, config: null });

  const parsed = DatabricksConnectionRowSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Databricks configuration is invalid." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function PUT(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Authentication and role checks happen before body parsing or validation.
  const context = await adminContext();
  if (!context.ok) return context.response;

  const limit = checkRateLimit(rateLimitKey(req, "databricks-config"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, DatabricksConfigSchema, { maxBytes: 24_000 });
  if (!validated.ok) return validated.response;
  const config = validated.data;

  const origin = canonicalDatabricksOrigin(config.host);
  if (!origin) {
    return NextResponse.json(
      { ok: false, error: "Databricks host must be one canonical HTTPS origin without a port, path, query, or fragment." },
      { status: 400 },
    );
  }
  if (!isDatabricksOriginAllowed(origin)) {
    return NextResponse.json(
      { ok: false, error: "This Databricks origin is not approved by deployment policy." },
      { status: 403 },
    );
  }
  if (classifyFetchHost(new URL(origin).hostname) === "blocked") {
    return NextResponse.json({ ok: false, error: "Databricks host is not publicly reachable." }, { status: 400 });
  }
  const { data: key, error: keyError } = await context.session
    .from("api_keys")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("provider", "Databricks")
    .eq("status", "valid")
    .eq("id", config.apiKeyId)
    .maybeSingle();
  if (keyError) {
    safeLog("Databricks config key lookup failed", { message: keyError.message, code: keyError.code });
    return NextResponse.json({ ok: false, error: "Databricks key could not be verified." }, { status: 503 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, error: "Choose a tested Databricks key from this workspace." }, { status: 409 });
  }

  const { data, error } = await context.session
    .from("databricks_connections")
    .upsert(
      {
        workspace_id: context.workspaceId,
        purpose: "hiring_needs",
        origin,
        warehouse_id: config.warehouseId,
        auth_mode: config.authMode,
        client_id: config.authMode === "m2m" ? config.clientId : null,
        api_key_id: config.apiKeyId,
        credential_provider: "Databricks",
        needs_query: config.needsQuery,
        enabled: true,
      },
      { onConflict: "workspace_id" },
    )
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) {
    safeLog("Databricks config write failed", { message: error.message, code: error.code });
    const status = error.code === "23503" || error.code === "23505" || error.code === "23514" ? 409 : 503;
    return NextResponse.json({ ok: false, error: "Databricks configuration could not be saved." }, { status });
  }

  const parsed = DatabricksConnectionRowSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Databricks configuration was not confirmed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const context = await adminContext();
  if (!context.ok) return context.response;

  const limit = checkRateLimit(rateLimitKey(req, "databricks-config-delete"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { error } = await context.session
    .from("databricks_connections")
    .delete()
    .eq("workspace_id", context.workspaceId);
  if (error) {
    safeLog("Databricks config delete failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Databricks configuration could not be removed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: false });
}
