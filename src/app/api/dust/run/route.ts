import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { DUST_TASKS } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { runDustAgent } from "@/lib/dust/client";
import { resolveDustAuthority } from "@/lib/integrations/dust-authority";

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
 * Run a Dust agent for one recruiting task (jdAnalysis / companyResearch). The
 * workspace id, tested API key, and task lock are resolved server-side from the
 * normalized admin-owned connection. The request carries only task + message.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: reject unauthenticated / under-permissioned callers before
  // buffering the body or spending the workspace's Dust message quota.
  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
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

  // Demo mode has no normalized backend authority, so live Dust is unavailable.
  if (!supabaseEnabled || !session) {
    return NextResponse.json({ ok: false, error: "No Dust agent locked for this task." });
  }

  const resolved = await resolveDustAuthority(session);
  if (!resolved.ok) {
    const status = resolved.code === "backend_error" ? 503 : 409;
    return NextResponse.json({ ok: false, error: "Dust integration is unavailable." }, { status });
  }
  const { authority } = resolved;
  const agentSId = authority.agentLocks[task];
  if (!agentSId) {
    return NextResponse.json({ ok: false, error: "No Dust agent locked for this task." }, { status: 409 });
  }

  const result = await runDustAgent(
    authority.workspaceId,
    authority.secret,
    agentSId,
    message,
    undefined,
    authority.region,
  );
  // Treat the client result as untrusted provider data. The route exposes a
  // stable generic failure and never reflects raw/encoded bearer material.
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Dust agent request failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, text: result.text, agentId: agentSId });
}
