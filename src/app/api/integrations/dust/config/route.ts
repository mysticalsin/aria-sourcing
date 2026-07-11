import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { DUST_TASKS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DustIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const DustAgentSchema = z
  .object({
    sId: DustIdSchema,
    name: z.string().trim().min(1).max(256),
    description: z.string().max(2_000),
  })
  .strict();
const AgentLocksSchema = z
  .record(z.string().max(80), DustIdSchema)
  .refine((locks) => Object.keys(locks).every((task) => (DUST_TASKS as readonly string[]).includes(task)), {
    message: "Unknown Dust task lock.",
  });

const DustConfigSchema = z
  .object({
    workspaceId: DustIdSchema,
    region: z.enum(["us", "eu"]),
    apiKeyId: z.string().uuid(),
    agentLocks: AgentLocksSchema.optional(),
    agents: z.array(DustAgentSchema).max(500),
  })
  .strict()
  .refine((config) => new Set(config.agents.map((agent) => agent.sId)).size === config.agents.length, {
    message: "Dust agent ids must be unique.",
    path: ["agents"],
  });

const DustLockSchema = z
  .object({
    task: z.enum(DUST_TASKS),
    agentSId: DustIdSchema.or(z.literal("")),
  })
  .strict();

const DustConnectionRowSchema = z.object({
  dust_workspace_id: z.string(),
  region: z.enum(["us", "eu"]),
  agent_locks: z.record(z.string(), z.string()),
  agents: z.array(DustAgentSchema),
  enabled: z.boolean(),
  config_revision: z.number().int().positive(),
  updated_at: z.string(),
});

const CONNECTION_COLUMNS =
  "dust_workspace_id, region, agent_locks, agents, enabled, config_revision, updated_at";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type WorkspaceContext =
  | { ok: true; session: ServerSupabase; workspaceId: string }
  | { ok: false; response: NextResponse };

async function workspaceContext(adminOnly: boolean): Promise<WorkspaceContext> {
  if (!supabaseEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Dust configuration requires a live workspace." },
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
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }),
    };
  }
  if (adminOnly) {
    const admin = await requireAdmin(session);
    if (!admin.ok) return admin;
  }

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    safeLog("Dust config workspace resolution failed", {
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

function publicConfig(row: z.infer<typeof DustConnectionRowSchema>) {
  return {
    workspaceId: row.dust_workspace_id,
    region: row.region,
    connected: row.enabled,
    agentLocks: row.agent_locks,
    agents: row.agents,
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
    .from("dust_connections")
    .select(CONNECTION_COLUMNS)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (error) {
    safeLog("Dust config read failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Dust configuration could not be loaded." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ ok: true, configured: false, config: null });

  const parsed = DustConnectionRowSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dust configuration is invalid." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: parsed.data.enabled, config: publicConfig(parsed.data) });
}

export async function PUT(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Authentication and admin authority are checked before secret-adjacent input.
  const context = await workspaceContext(true);
  if (!context.ok) return context.response;
  const limit = checkRateLimit(rateLimitKey(req, "dust-config"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, DustConfigSchema, { maxBytes: 256_000 });
  if (!validated.ok) return validated.response;
  const config = validated.data;

  const { data: key, error: keyError } = await context.session
    .from("api_keys")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("provider", "Dust")
    .eq("status", "valid")
    .eq("id", config.apiKeyId)
    .maybeSingle();
  if (keyError) {
    safeLog("Dust config key lookup failed", { message: keyError.message, code: keyError.code });
    return NextResponse.json({ ok: false, error: "Dust key could not be verified." }, { status: 503 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, error: "Choose a tested Dust key from this workspace." }, { status: 409 });
  }

  const { data: existing, error: existingError } = await context.session
    .from("dust_connections")
    .select("agent_locks")
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (existingError) {
    safeLog("Dust config current lock read failed", { message: existingError.message, code: existingError.code });
    return NextResponse.json({ ok: false, error: "Dust configuration could not be saved." }, { status: 503 });
  }
  const validAgentIds = new Set(config.agents.map((agent) => agent.sId));
  const requestedLocks = config.agentLocks ?? (existing?.agent_locks as Record<string, string> | undefined) ?? {};
  const agentLocks = Object.fromEntries(
    Object.entries(requestedLocks).filter(
      ([task, agentSId]) => (DUST_TASKS as readonly string[]).includes(task) && validAgentIds.has(agentSId),
    ),
  );

  const { data, error } = await context.session
    .from("dust_connections")
    .upsert(
      {
        workspace_id: context.workspaceId,
        dust_workspace_id: config.workspaceId,
        region: config.region,
        api_key_id: config.apiKeyId,
        credential_provider: "Dust",
        agent_locks: agentLocks,
        agents: config.agents,
        enabled: true,
      },
      { onConflict: "workspace_id" },
    )
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) {
    safeLog("Dust config write failed", { message: error.message, code: error.code });
    const status = error.code === "23503" || error.code === "23505" || error.code === "23514" ? 409 : 503;
    return NextResponse.json({ ok: false, error: "Dust configuration could not be saved." }, { status });
  }

  const parsed = DustConnectionRowSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dust configuration was not confirmed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function PATCH(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const context = await workspaceContext(true);
  if (!context.ok) return context.response;
  const limit = checkRateLimit(rateLimitKey(req, "dust-config-lock"), { windowMs: 60_000, max: 30 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, DustLockSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { task, agentSId } = validated.data;

  const { data: current, error: currentError } = await context.session
    .from("dust_connections")
    .select("agent_locks, agents")
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (currentError) {
    safeLog("Dust lock read failed", { message: currentError.message, code: currentError.code });
    return NextResponse.json({ ok: false, error: "Dust agent lock could not be saved." }, { status: 503 });
  }
  if (!current) return NextResponse.json({ ok: false, error: "Dust is not configured." }, { status: 409 });

  const agents = z.array(DustAgentSchema).safeParse(current.agents);
  if (!agents.success || (agentSId && !agents.data.some((agent) => agent.sId === agentSId))) {
    return NextResponse.json({ ok: false, error: "Choose an agent from the configured Dust workspace." }, { status: 409 });
  }
  const agentLocks = { ...((current.agent_locks as Record<string, string> | null) ?? {}) };
  if (agentSId) agentLocks[task] = agentSId;
  else delete agentLocks[task];

  const { data, error } = await context.session
    .from("dust_connections")
    .update({ agent_locks: agentLocks })
    .eq("workspace_id", context.workspaceId)
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) {
    safeLog("Dust lock write failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Dust agent lock could not be saved." }, { status: 503 });
  }
  const parsed = DustConnectionRowSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dust agent lock was not confirmed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: true, config: publicConfig(parsed.data) });
}

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const context = await workspaceContext(true);
  if (!context.ok) return context.response;
  const limit = checkRateLimit(rateLimitKey(req, "dust-config-delete"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { error } = await context.session
    .from("dust_connections")
    .delete()
    .eq("workspace_id", context.workspaceId);
  if (error) {
    safeLog("Dust config delete failed", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Dust configuration could not be removed." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, configured: false });
}
