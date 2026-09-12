import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  bindComputerSupervisorEndpoint,
  defaultComputerSupervisor,
  HOST_ORPHAN_SEAT_ID,
} from "@/lib/computer-supervisor";
import { openBotHostHealth, type OpenBotSupervisorConfig } from "@/lib/openbot/supervisor-client";
import { queryComputerAuditsDurable, summarizeFleetComputers } from "@/lib/computer-audit";
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


async function hostCapacityFromEnv(): Promise<{
  computers: number;
  max: number;
  desktop?: boolean;
} | null> {
  const baseUrl = (process.env.COMPUTER_SUPERVISOR_URL ?? "").trim();
  const token = (process.env.COMPUTER_SUPERVISOR_TOKEN ?? "").trim();
  if (!baseUrl || !token) return null;
  const cfg: OpenBotSupervisorConfig = { baseUrl, token };
  const health = await openBotHostHealth(cfg);
  if (!health || !health.max) return null;
  return { computers: health.computers, max: health.max, desktop: health.desktop };
}

function enrichComputer(
  rec: ReturnType<typeof defaultComputerSupervisor.ensureComputer>,
  extras?: { seatName?: string; seatStatus?: string },
) {
  return {
    ...rec,
    seatName: extras?.seatName,
    seatStatus: extras?.seatStatus,
    lastAudit: rec.lastAudit,
    remoteUrl: rec.remoteUrl ?? null,
    viewUrl: rec.viewUrl ?? rec.remoteUrl ?? null,
    recentAudits: defaultComputerSupervisor.recentAudits(rec.computerId, 8),
  };
}

/**
 * GET — list computers + ops summary + recent fleet audits.
 * Optional ?campaignId= filters recentAudits to that campaign (when tagged).
 * POST — ensure | start | stop | reset | take_control | release_control | request_help
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim() || undefined;
  const supabase = await getServerSupabase();
  if (!supabase) {
    try {
      await bindWorkspaceSupervisor(null);
      await defaultComputerSupervisor.hydrateFromHost("__local__");
      const computers = defaultComputerSupervisor
        .list("__local__")
        .map((rec) => enrichComputer(rec));
      const durable = await queryComputerAuditsDurable({
        workspaceId: "__local__",
        campaignId,
        limit: 80,
      });
      let recentAudits =
        durable.length > 0
          ? durable
          : defaultComputerSupervisor.recentFleetAudits("__local__", 40);
      if (campaignId) {
        recentAudits = recentAudits.filter(
          (a) => !("campaignId" in a) || !a.campaignId || a.campaignId === campaignId,
        );
      }
      const hostCapacity = await hostCapacityFromEnv();
      return NextResponse.json({
        computers,
        summary: summarizeFleetComputers(computers.filter((c) => c.seatId !== HOST_ORPHAN_SEAT_ID)),
        recentAudits,
        hostCapacity,
      });
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

    const computers = [];
    for (const seat of seats ?? []) {
      // GET is list/hydrate only — never mint. Unbound seats stay unbound until
      // Deploy / Login / POST ensure assigns a durable computer_id. Concurrent
      // Floor+Settings+Campaign polls must not race-mint twin VMs.
      let rec;
      try {
        rec = defaultComputerSupervisor.hydrateComputer({
          workspaceId: String(wid),
          seatId: seat.id,
          computerId: seat.computer_id,
        });
      } catch (err) {
        // Poisoned FK: seat points at another seat's computer. Clear it — do not
        // remint on read (that reintroduced twin ids across pollers).
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("computer-ownership-mismatch")) throw err;
        console.warn("computer_id ownership mismatch; clearing poisoned FK", seat.id, msg);
        const { error } = await supabase
          .from("agent_seats")
          .update({ computer_id: null })
          .eq("id", seat.id)
          .eq("workspace_id", wid);
        if (error) console.warn("clear poisoned computer_id failed", error.message);
        continue;
      }
      if (!rec) continue;
      computers.push(rec);
    }

    // Cold-start: pull live OpenBot host state so stopped in-memory rows flip to ready
    // when Chromiums are already running on Fly. Also import unmatched host bots as
    // orphans (visible for Login reclaim) — never mint, never invent sessionHealthy.
    await defaultComputerSupervisor.hydrateFromHost(String(wid));

    const seenIds = new Set(computers.map((c) => c.computerId));
    for (const orphan of defaultComputerSupervisor.listOrphans(String(wid))) {
      if (seenIds.has(orphan.computerId)) continue;
      computers.push(orphan);
      seenIds.add(orphan.computerId);
    }

    const enriched = computers.map((rec) => {
      const seat = (seats ?? []).find((s) => s.id === rec.seatId);
      return enrichComputer(rec, {
        seatName:
          seat?.name ??
          (rec.seatId === HOST_ORPHAN_SEAT_ID ? "Unbound host VM" : undefined),
        seatStatus: seat?.status,
      });
    });

    const durable = await queryComputerAuditsDurable({
      workspaceId: String(wid),
      campaignId,
      limit: 80,
    });
    let recentAudits =
      durable.length > 0
        ? durable
        : defaultComputerSupervisor.recentFleetAudits(String(wid), 40);
    if (campaignId) {
      recentAudits = recentAudits.filter(
        (a) => !("campaignId" in a) || !a.campaignId || a.campaignId === campaignId,
      );
    }

    const hostCapacity = await hostCapacityFromEnv();
    return NextResponse.json({
      computers: enriched,
      summary: summarizeFleetComputers(enriched.filter((c) => c.seatId !== HOST_ORPHAN_SEAT_ID)),
      recentAudits,
      hostCapacity,
    });
  } finally {
    bindComputerSupervisorEndpoint(null);
  }
}

const BodySchema = z
  .object({
    action: z.enum([
      "ensure",
      "start",
      "stop",
      "reset",
      "take_control",
      "release_control",
      "request_help",
      "navigate",
      "session_probe",
      "reclaim_healthy_orphan",
    ]),
    computerId: z.string().min(1).max(120).optional(),
    seatId: z.string().min(1).max(120).optional(),
    campaignId: z.string().min(1).max(120).optional(),
    detail: z.string().max(500).optional(),
    url: z.string().url().max(2_000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === "reclaim_healthy_orphan") {
      if (!body.seatId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "seatId required for reclaim_healthy_orphan",
          path: ["seatId"],
        });
      }
      return;
    }
    if (!body.computerId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "computerId required",
        path: ["computerId"],
      });
    }
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
  } else {
    // Demo / localStorage mode — no Supabase session; match requireAdmin fail-open.
    role = "admin";
    workspaceId = "__local__";
  }
  if (!can(role, "manage_fleet")) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  try {
    await bindWorkspaceSupervisor(workspaceId);
    const campaignOpts = { campaignId: body.campaignId };
    const computerId = (body.computerId ?? "").trim();
    let rec;
    let reclaimed = false;
    switch (body.action) {
      case "ensure": {
        const seatId = (body.seatId ?? "").trim();
        if (!seatId) {
          return NextResponse.json({ error: "seatId required for ensure" }, { status: 400 });
        }
        rec = defaultComputerSupervisor.ensureComputer({
          workspaceId: workspaceId ?? "__local__",
          seatId,
          computerId,
          campaignId: body.campaignId,
        });
        break;
      }
      case "start":
        rec = await defaultComputerSupervisor.start(computerId, campaignOpts);
        break;
      case "stop":
        rec = await defaultComputerSupervisor.stop(computerId);
        break;
      case "reset":
        rec = await defaultComputerSupervisor.reset(computerId);
        break;
      case "take_control":
        rec = await defaultComputerSupervisor.takeControl(computerId, campaignOpts);
        break;
      case "release_control":
        rec = await defaultComputerSupervisor.releaseControl(computerId, campaignOpts);
        break;
      case "request_help":
        rec = defaultComputerSupervisor.requestHelp(
          computerId,
          body.detail ?? "Operator requested help",
        );
        break;
      case "navigate": {
        if (!body.url) {
          return NextResponse.json({ error: "url required for navigate" }, { status: 400 });
        }
        // Ensure the seat exists, then enqueue a warmup_nav job (AriaBot Chromium).
        const navSeatId = (body.seatId ?? "").trim();
        if (!navSeatId) {
          return NextResponse.json({ error: "seatId required for navigate" }, { status: 400 });
        }
        const navRec = defaultComputerSupervisor.ensureComputer({
          workspaceId: workspaceId ?? "__local__",
          seatId: navSeatId,
          computerId,
          campaignId: body.campaignId,
        });
        // Always drive the ensured id — never the raw request id after a rebound.
        const navComputerId = navRec.computerId;
        await defaultComputerSupervisor.start(navComputerId, campaignOpts);
        // If a human currently holds the mutex, release so AriaBot can navigate.
        const current = defaultComputerSupervisor.get(navComputerId);
        if (current?.control === "human") {
          await defaultComputerSupervisor.releaseControl(navComputerId, campaignOpts);
        }
        await defaultComputerSupervisor.enqueueJob({
          computerId: navComputerId,
          kind: "warmup_nav",
          payload: { url: body.url },
        });
        rec = defaultComputerSupervisor.get(navComputerId);
        if (!rec) throw new Error("computer-not-found");
        break;
      }
      case "session_probe": {
        // Ensure in-memory row exists for durable computerId, then probe LinkedIn cookies.
        const probeSeatId = (body.seatId ?? "").trim();
        if (!probeSeatId) {
          return NextResponse.json({ error: "seatId required for session_probe" }, { status: 400 });
        }
        const probeRec = defaultComputerSupervisor.ensureComputer({
          workspaceId: workspaceId ?? "__local__",
          seatId: probeSeatId,
          computerId,
          campaignId: body.campaignId,
        });
        rec = await defaultComputerSupervisor.probeSession(probeRec.computerId);
        break;
      }
      case "reclaim_healthy_orphan": {
        // Probe stored id; if unhealthy, probe host orphans and claim first healthy.
        // Never invents healthy. When a claim happens, persist computer_id here so the
        // next GET hydrate cannot re-attach the login-wall twin from a stale FK
        // (Login updateSeat alone races the 5s floor/fleet poll).
        const seatId = (body.seatId ?? "").trim();
        const result = await defaultComputerSupervisor.reclaimHealthyOrphan({
          workspaceId: workspaceId ?? "__local__",
          seatId,
          computerId: computerId || null,
          campaignId: body.campaignId,
        });
        rec = result.computer;
        reclaimed = result.reclaimed;
        if (
          reclaimed &&
          supabase &&
          workspaceId &&
          workspaceId !== "__local__" &&
          seatId &&
          rec?.computerId
        ) {
          const { error } = await supabase
            .from("agent_seats")
            .update({ computer_id: rec.computerId })
            .eq("id", seatId)
            .eq("workspace_id", workspaceId);
          if (error) {
            throw new Error(
              `reclaim claimed ${rec.computerId} in-memory but computer_id persist failed: ${error.message}`,
            );
          }
        }
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({
      computer: enrichComputer(rec),
      sessionHealthy: rec.sessionHealthy ?? null,
      reclaimed,
      recentAudits: defaultComputerSupervisor.recentAudits(rec.computerId, 12),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "computer action failed" },
      { status: 400 },
    );
  } finally {
    bindComputerSupervisorEndpoint(null);
  }
}
