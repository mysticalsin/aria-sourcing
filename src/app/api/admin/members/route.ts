import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** GET /api/admin/members — admin roster with autopilot entitlement flags. */
export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) {
    return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);
  }
  if (!can("admin", "manage_autopilot")) {
    return noStoreJson({ ok: false, error: "Admins only." }, 403);
  }

  const { data: auth } = await session.auth.getUser();
  const actorId = auth.user?.id;
  if (!actorId) {
    return noStoreJson({ ok: false, error: "Not authenticated." }, 401);
  }

  const limit = checkRateLimit(rateLimitKey(req, "admin-members-list", actorId), {
    windowMs: 60_000,
    max: 60,
  });
  if (!limit.ok) {
    const response = noStoreJson({ ok: false, error: "Rate limited." }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }

  const listed = await session.rpc("list_workspace_members");
  if (listed.error) {
    return noStoreJson({ ok: false, error: "Member roster unavailable." }, 503);
  }
  return noStoreJson({ ok: true, members: listed.data ?? [] });
}

const PatchSchema = z
  .object({
    userId: z.string().uuid(),
    autopilotEnabled: z.boolean(),
  })
  .strict();

/**
 * PATCH /api/admin/members — toggle autopilot entitlement for one teammate.
 * Body: { userId, autopilotEnabled }
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) {
    return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);
  }

  const { data: auth } = await session.auth.getUser();
  const actorId = auth.user?.id;
  if (!actorId) {
    return noStoreJson({ ok: false, error: "Not authenticated." }, 401);
  }

  const limit = checkRateLimit(rateLimitKey(req, "admin-members-autopilot", actorId), {
    windowMs: 60_000,
    max: 30,
  });
  if (!limit.ok) {
    const response = noStoreJson({ ok: false, error: "Rate limited." }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }

  const body = await validateBody(req, PatchSchema, { maxBytes: 2_000 });
  if (!body.ok) return body.response;

  const result = await session.rpc("set_member_autopilot", {
    p_target_user_id: body.data.userId,
    p_enabled: body.data.autopilotEnabled,
  });

  if (result.error) {
    const message = result.error.message ?? "";
    if (/administrator required|authentication required|workspace required/i.test(message)) {
      return noStoreJson({ ok: false, error: "Admins only." }, 403);
    }
    return noStoreJson({ ok: false, error: "Entitlement update failed." }, 503);
  }

  const payload = result.data as { status?: string; enabled?: boolean; target_user_id?: string } | null;
  if (!payload || payload.status !== "ok") {
    const status = payload?.status ?? "failed";
    if (status === "not_found") return noStoreJson({ ok: false, error: "Member not found.", status }, 404);
    if (status === "viewer_denied") {
      return noStoreJson({ ok: false, error: "Viewers cannot receive autopilot.", status }, 400);
    }
    if (status === "invalid_request") {
      return noStoreJson({ ok: false, error: "Invalid request.", status }, 400);
    }
    return noStoreJson({ ok: false, error: "Entitlement update failed.", status }, 503);
  }

  return noStoreJson({
    ok: true,
    userId: payload.target_user_id,
    autopilotEnabled: payload.enabled === true,
  });
}
