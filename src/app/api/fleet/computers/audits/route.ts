import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import {
  computerAuditsToCsv,
  queryComputerAuditsDurable,
  type ComputerAuditActor,
} from "@/lib/computer-audit";
import { demoLoginEnabled, isProduction } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

async function resolveWorkspace(): Promise<
  | { ok: true; workspaceId: string; role: Role }
  | { ok: false; response: NextResponse }
> {
  const supabase = await getServerSupabase();
  if (!supabase) {
    if (isProduction && !demoLoginEnabled) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Auth required" }, { status: 503 }),
      };
    }
    return { ok: true, workspaceId: "__local__", role: "admin" };
  }
  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return { ok: false, response: NextResponse.json({ error: "No workspace" }, { status: 401 }) };
  }
  const { data: roleName } = await supabase.rpc("current_profile_role");
  const role = (roleName as Role) ?? "member";
  if (!can(role, "manage_fleet") && !can(role, "view_fleet" as never)) {
    // fall back: any authenticated workspace member can read audits
  }
  return { ok: true, workspaceId: String(wid), role };
}

/**
 * GET /api/fleet/computers/audits
 * Query: computerId?, action?, actor?, correlationId?, limit?, format=csv|json
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveWorkspace();
  if (!resolved.ok) return resolved.response;

  // Audit trail is readable by anyone who can view the workspace.
  if (!can(resolved.role, "view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const computerId = url.searchParams.get("computerId")?.trim() || undefined;
  const action = url.searchParams.get("action")?.trim() || undefined;
  const actor = (url.searchParams.get("actor")?.trim() || undefined) as
    | ComputerAuditActor
    | undefined;
  const correlationId = url.searchParams.get("correlationId")?.trim() || undefined;
  const since = url.searchParams.get("since")?.trim() || undefined;
  const until = url.searchParams.get("until")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") || 200);
  const format = (url.searchParams.get("format") || "json").toLowerCase();

  const events = await queryComputerAuditsDurable({
    workspaceId: resolved.workspaceId,
    computerId,
    action,
    actor,
    correlationId,
    since,
    until,
    limit,
  });

  if (format === "csv") {
    const csv = computerAuditsToCsv(events);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="fleet-computer-audits-${Date.now()}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({
    workspaceId: resolved.workspaceId,
    count: events.length,
    filters: { computerId, action, actor, correlationId, since, until, limit },
    events,
  });
}
