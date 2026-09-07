import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  bindComputerSupervisorEndpoint,
  defaultComputerSupervisor,
} from "@/lib/computer-supervisor";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { validateBody } from "@/lib/api/validate";
import {
  loadLinkedInCredentialRefsForWorkspace,
  resolveLinkedInCredentials,
  resolveLinkedInCredentialsForWorkspace,
} from "@/lib/linkedin-credentials";

export const dynamic = "force-dynamic";

async function bindWorkspaceSupervisor(workspaceId: string | null) {
  const refs = workspaceId ? await loadLinkedInCredentialRefsForWorkspace(workspaceId) : {};
  // Session vault first (Fleet UI); fall back to service-role workspace resolve.
  let creds = await resolveLinkedInCredentials(refs);
  if (workspaceId && !creds.computerSupervisorToken) {
    creds = await resolveLinkedInCredentialsForWorkspace(workspaceId, refs);
  }

  bindComputerSupervisorEndpoint({
    url: creds.computerSupervisorUrl,
    token: creds.computerSupervisorToken,
    computerToken:
      process.env.OPENBOT_COMPUTER_TOKEN?.trim() ||
      process.env.COMPUTER_TOKEN?.trim() ||
      undefined,
    mockSend: creds.computerSupervisorMockSend,
  });
  return creds;
}

/**
 * GET — list computers for the workspace (observe/takeover UI; closed by default).
 * POST — start | stop | reset | take_control | release_control | request_help
 */
export async function GET() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    try {
      await bindWorkspaceSupervisor(null);
      return NextResponse.json({ computers: defaultComputerSupervisor.list("__local__") });
    } finally {
      bindComputerSupervisorEndpoint(null);
    }
  }
  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  try {
    await bindWorkspaceSupervisor(String(wid));

    const { data: seats } = await supabase
      .from("agent_seats")
      .select("id, name, provider, computer_id, status")
      .eq("workspace_id", wid)
      .eq("provider", "LinkedIn Browser Computer");

    const computers = (seats ?? []).map((seat) => {
      const rec = defaultComputerSupervisor.ensureComputer({
        workspaceId: String(wid),
        seatId: seat.id,
        computerId: seat.computer_id ?? undefined,
      });
      return {
        ...rec,
        seatName: seat.name,
        seatStatus: seat.status,
        lastAudit: rec.lastAudit,
        remoteUrl: rec.remoteUrl ?? null,
      };
    });

    return NextResponse.json({ computers });
  } finally {
    bindComputerSupervisorEndpoint(null);
  }
}

const BodySchema = z.object({
  action: z.enum(["start", "stop", "reset", "take_control", "release_control", "request_help"]),
  computerId: z.string().min(1).max(120),
  detail: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const parsed = await validateBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  let role: Role = "member";
  let workspaceId: string | null = null;
  if (supabase) {
    const { data: roleName } = await supabase.rpc("current_profile_role");
    role = (roleName as Role) ?? "member";
    const { data: wid } = await supabase.rpc("current_workspace_id");
    workspaceId = wid ? String(wid) : null;
  }
  if (!can(role, "manage_fleet")) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  try {
    await bindWorkspaceSupervisor(workspaceId);
    let rec;
    switch (body.action) {
      case "start":
        rec = await defaultComputerSupervisor.start(body.computerId);
        break;
      case "stop":
        rec = await defaultComputerSupervisor.stop(body.computerId);
        break;
      case "reset":
        rec = await defaultComputerSupervisor.reset(body.computerId);
        break;
      case "take_control":
        rec = await defaultComputerSupervisor.takeControl(body.computerId);
        break;
      case "release_control":
        rec = await defaultComputerSupervisor.releaseControl(body.computerId);
        break;
      case "request_help":
        rec = defaultComputerSupervisor.requestHelp(
          body.computerId,
          body.detail ?? "Operator requested help",
        );
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ computer: rec });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "computer action failed" },
      { status: 400 },
    );
  } finally {
    bindComputerSupervisorEndpoint(null);
  }
}
