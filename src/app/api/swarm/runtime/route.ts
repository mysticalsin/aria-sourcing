// /api/swarm/runtime — swarm runtime snapshot for the console (Rock 8).
//
// GET → agents + live counts + active missions + open-escalation count for the
// caller's workspace. Admin-gated (requireAdmin) because the read crosses into
// the service-role get_swarm_runtime RPC. Read-only: this surface can never
// dispatch, enable, or answer anything.

import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  const service = getServiceSupabase();
  if (!session || !service) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-runtime"), { windowMs: 60_000, max: 60 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace unresolved." }, { status: 403 });
  }
  const { data, error } = await service.rpc("get_swarm_runtime", { p_workspace_id: workspaceId });
  if (error) {
    return NextResponse.json({ ok: false, error: "Runtime read failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, runtime: data });
}
