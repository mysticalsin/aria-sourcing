import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can, type Permission } from "@/lib/rbac";
import type { Role } from "@/lib/types";

export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Demo mode (no Supabase) stays open, matching the other token routes.
 * Production without Supabase fails closed. Live mode requires a session,
 * and token writes require an admin.
 */
export async function gateContactRequest(
  req: NextRequest,
  scope: string,
  permission: Extract<Permission, "view" | "outreach" | "manage_keys">,
): Promise<Response | null> {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const limit = checkRateLimit(rateLimitKey(req, scope), {
    windowMs: 60_000,
    max: permission === "manage_keys" ? 20 : 60,
  });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  if (!supabaseEnabled) return null;

  const supabase = await getServerSupabase();
  if (!supabase) return noStore({ ok: false, error: "No Supabase client." }, 500);

  if (permission === "manage_keys") {
    const admin = await requireAdmin(supabase);
    if (!admin.ok) return admin.response;
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return noStore({ ok: false, error: "Not authenticated." }, 401);

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, permission)) {
    return noStore({ ok: false, error: "Insufficient permissions." }, 403);
  }
  return null;
}
