import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { HermesState, Role } from "@/lib/types";
import { DUST_TASKS } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { runDustAgent } from "@/lib/dust/client";

// Auth-gated, never cacheable — without this Next tries to prerender the route at
// build time (calling auth/session helpers before it touches any request API Next
// would otherwise auto-detect as dynamic), which throws the production
// fail-closed guard as a build error when Supabase isn't configured. (Same fix
// already applied to /auth/google and /auth/microsoft.)
export const dynamic = "force-dynamic";

const DustRunSchema = z.object({
  task: z.enum(DUST_TASKS),
  message: z.string().min(1).max(20_000),
});

/**
 * Resolve this workspace's persisted Dust config (settings.dust) server-side.
 * Dust is configured entirely through Settings (Configure modal), never passed
 * by the caller, so a client can only pick WHICH task to run — never which
 * workspace/agent/key to spend against.
 */
async function loadDustSettings(
  session: NonNullable<ReturnType<typeof getServerSupabase>>,
): Promise<HermesState["settings"]["dust"] | null> {
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await session
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", wid)
    .maybeSingle();
  const state = row?.state as HermesState | undefined;
  return state?.settings?.dust ?? null;
}

/** Resolve a vault secret by ApiKey.id, scoped to the caller's workspace. Returns
 *  "" on any failure. NEVER logs or returns the value outside the immediate call. */
async function resolveVaultSecret(
  session: NonNullable<ReturnType<typeof getServerSupabase>>,
  id?: string,
): Promise<string> {
  if (!id) return "";
  const svc = getServiceSupabase();
  if (!svc) return "";
  const { data: wid } = await session.rpc("current_workspace_id");
  const { data: row } = await svc.from("api_keys").select("secret, workspace_id").eq("id", id).single();
  if (row && row.workspace_id === wid && typeof row.secret === "string") {
    return decryptSecret(row.secret);
  }
  return "";
}

/**
 * Run a Dust agent for one recruiting task (jdAnalysis / companyResearch). The
 * workspace id, API key, and which agent is locked to the task are all resolved
 * server-side from the caller's persisted Settings — the request body carries
 * only the task and the message text.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: reject unauthenticated / under-permissioned callers before
  // buffering the body or spending the workspace's Dust message quota.
  let session: ReturnType<typeof getServerSupabase> = null;
  if (supabaseEnabled) {
    session = getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  // Throttle: runs spend the workspace's shared Dust message quota (~100/day/seat).
  const limit = checkRateLimit(rateLimitKey(req, "dust-run"), { windowMs: 60_000, max: 15 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, DustRunSchema, { maxBytes: 32_000 });
  if (!validated.ok) return validated.response;
  const { task, message } = validated.data;

  // Demo mode (no Supabase): Dust config lives only in the persisted workspace
  // document, which doesn't exist without a backend — nothing to resolve.
  if (!supabaseEnabled || !session) {
    return NextResponse.json({ ok: false, error: "No Dust agent locked for this task." });
  }

  const dust = await loadDustSettings(session);
  const agentSId = dust?.agentLocks?.[task];
  if (!dust?.workspaceId || !agentSId) {
    return NextResponse.json({ ok: false, error: "No Dust agent locked for this task." });
  }

  const apiKey = await resolveVaultSecret(session, dust.apiKeyId);
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "No Dust API key configured." });
  }

  const result = await runDustAgent(dust.workspaceId, apiKey, agentSId, message);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, text: result.text });
}
