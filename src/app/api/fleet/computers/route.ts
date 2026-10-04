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
import { seatAttachedToCampaign } from "@/lib/campaign-seat-attach";
import { can } from "@/lib/rbac";
import type { AgentSeat, Role } from "@/lib/types";
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
 * When POST names a campaignId, refuse desks not durably attached to it
 * (BC empty ≠ attached). Skipped in local/demo (no durable assigned_campaign_ids).
 */
async function refuseUnattachedCampaignSeat(input: {
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
  workspaceId: string;
  seatId: string;
  campaignId: string;
}): Promise<NextResponse | null> {
  const { data, error } = await input.supabase
    .from("agent_seats")
    .select("provider, assigned_campaign_ids, linkedin_delivery_backend")
    .eq("id", input.seatId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "seat-lookup-failed", detail: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "seat-not-found" }, { status: 404 });
  }
  const attached = seatAttachedToCampaign(
    {
      provider: data.provider as AgentSeat["provider"],
      linkedinDeliveryBackend:
        typeof data.linkedin_delivery_backend === "string"
          ? (data.linkedin_delivery_backend as AgentSeat["linkedinDeliveryBackend"])
          : null,
      assignedCampaignIds: Array.isArray(data.assigned_campaign_ids)
        ? (data.assigned_campaign_ids as string[])
        : [],
    },
    input.campaignId,
  );
  if (!attached) {
    return NextResponse.json(
      {
        error: "linkedin-seat-not-attached",
        detail: "Seat is not attached to this campaign.",
      },
      { status: 409 },
    );
  }
  return null;
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
      await defaultComputerSupervisor.restoreSessionHealthFromDurableAudits("__local__");
      await defaultComputerSupervisor.refreshSessionHealthForList("__local__");
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
        summary: summarizeFleetComputers(
          computers.filter((c) => {
            const seatId = typeof c.seatId === "string" ? c.seatId.trim() : "";
            return Boolean(seatId) && seatId !== HOST_ORPHAN_SEAT_ID;
          }),
        ),
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

    const { data: seats, error: seatsErr } = await supabase
      .from("agent_seats")
      .select("id, name, provider, computer_id, status, assigned_campaign_ids")
      .eq("workspace_id", wid)
      .eq("provider", "LinkedIn Browser Computer");
    // Fail closed: never emit campaignSeats:[] from a null/error seats read —
    // FE treats [] as durable authority and would detach every Hermes attach.
    if (seatsErr) {
      return NextResponse.json(
        { error: "agent-seats-unavailable", detail: seatsErr.message },
        { status: 500 },
      );
    }

    const computers = [];
    const clearedPoisonedComputerIds = new Set<string>();
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
        // Map conflict vs durable FK: ownership-mismatch (other seat) OR
        // orphan-claim-blocked (host import as __orphan__). Do not 500 the
        // whole fleet poll — Floor/Agents would wipe N desks fail-closed.
        const msg = err instanceof Error ? err.message : String(err);
        const durableConflict =
          msg.includes("computer-ownership-mismatch") ||
          msg.includes("computer-orphan-claim-blocked");
        if (!durableConflict) throw err;
        const cid =
          typeof seat.computer_id === "string" ? seat.computer_id.trim() : "";
        const claimedByOtherSeat = Boolean(
          cid &&
            (seats ?? []).some(
              (s) => s.id !== seat.id && s.computer_id === cid,
            ),
        );
        if (!claimedByOtherSeat && cid) {
          // Stale/orphan Map — adopt durable DB binding; do not null the rightful FK.
          try {
            rec = defaultComputerSupervisor.adoptDurableComputerBinding({
              workspaceId: String(wid),
              seatId: seat.id,
              computerId: cid,
            });
          } catch (adoptErr) {
            const adoptMsg =
              adoptErr instanceof Error ? adoptErr.message : String(adoptErr);
            // Mid-Take on THIS seat (detach blocked): keep FK + emit held twin.
            // Durable cid human-held on ANOTHER seat: poisoned FK — clear (do not
            // push foreign held desk; fleetHermesComputerPatches would null Hermes).
            if (/computer-human-held/i.test(adoptMsg)) {
              const seatDesks = defaultComputerSupervisor
                .list(String(wid))
                .filter((c) => c.seatId === seat.id);
              const seatHeld = seatDesks.find((c) => c.control === "human");
              if (seatHeld) {
                console.warn(
                  "adopt durable skipped — human held; keeping computer_id FK",
                  seat.id,
                );
                computers.push(seatHeld);
                continue;
              }
              console.warn(
                "adopt durable skipped — durable cid human-held elsewhere; clearing poisoned FK",
                seat.id,
              );
              const { error } = await supabase
                .from("agent_seats")
                .update({ computer_id: null })
                .eq("id", seat.id)
                .eq("workspace_id", wid);
              if (error) console.warn("clear poisoned computer_id failed", error.message);
              clearedPoisonedComputerIds.add(seat.id);
              continue;
            }
            console.warn(
              "adopt durable binding failed; clearing poisoned FK",
              seat.id,
              adoptMsg,
            );
            const { error } = await supabase
              .from("agent_seats")
              .update({ computer_id: null })
              .eq("id", seat.id)
              .eq("workspace_id", wid);
            if (error) console.warn("clear poisoned computer_id failed", error.message);
            clearedPoisonedComputerIds.add(seat.id);
            continue;
          }
        } else {
          console.warn("computer_id Map conflict; clearing poisoned FK", seat.id, msg);
          const { error } = await supabase
            .from("agent_seats")
            .update({ computer_id: null })
            .eq("id", seat.id)
            .eq("workspace_id", wid);
          if (error) console.warn("clear poisoned computer_id failed", error.message);
          // Even if DB clear fails, never re-emit the poisoned id into durable bindings —
          // Floor/Fleet ingest would write the foreign computerId back onto Hermes.
          clearedPoisonedComputerIds.add(seat.id);
          continue;
        }
      }
      if (!rec) continue;
      computers.push(rec);
    }

    // Cold-start: pull live OpenBot host state so stopped in-memory rows flip to ready
    // when Chromiums are already running on Fly. Also import unmatched host bots as
    // orphans (visible for Login reclaim) — never mint, never invent sessionHealthy.
    await defaultComputerSupervisor.hydrateFromHost(String(wid));

    // Multi-instance: restore recent probe receipts from durable audits before
    // opportunistic re-probe. Never invents true without meta.healthy===true.
    await defaultComputerSupervisor.restoreSessionHealthFromDurableAudits(String(wid));

    const seenIds = new Set(computers.map((c) => c.computerId));
    for (const orphan of defaultComputerSupervisor.listOrphans(String(wid))) {
      if (seenIds.has(orphan.computerId)) continue;
      computers.push(orphan);
      seenIds.add(orphan.computerId);
    }

    // Refresh LinkedIn health for Floor/Fleet polls — fail closed, never invent true.
    await defaultComputerSupervisor.refreshSessionHealthForList(String(wid));
    // Re-read after probes (TTL + probe results).
    const refreshed = new Map(
      defaultComputerSupervisor.list(String(wid)).map((c) => [c.computerId, c]),
    );
    for (let i = 0; i < computers.length; i++) {
      const next = refreshed.get(computers[i]!.computerId);
      if (next) computers[i] = next;
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
    // Durable campaign↔seat bindings from agent_seats (not Hermes-only theater).
    // Campaign Agents prefer this when present so N desks match DB after cold load.
    const campaignSeats = campaignId
      ? (seats ?? [])
          .filter((s) => {
            const assigned = Array.isArray(s.assigned_campaign_ids)
              ? s.assigned_campaign_ids
              : [];
            return assigned.includes(campaignId);
          })
          .map((s) => ({
            id: s.id,
            name: s.name,
            // Ownership-mismatch clears must not re-poison ingest with the old FK.
            computerId: clearedPoisonedComputerIds.has(s.id) ? null : (s.computer_id ?? null),
            status: s.status,
            assignedCampaignIds: Array.isArray(s.assigned_campaign_ids)
              ? s.assigned_campaign_ids.filter((id: unknown): id is string => typeof id === "string")
              : [],
          }))
      : undefined;
    // Workspace-wide durable LI bindings (Floor / Fleet unscoped polls) — same
    // agent_seats authority as campaignSeats, without inventing campaignSeats:[].
    const browserSeatBindings = Array.isArray(seats)
      ? (seats ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          computerId: clearedPoisonedComputerIds.has(s.id) ? null : (s.computer_id ?? null),
          status: s.status,
          assignedCampaignIds: Array.isArray(s.assigned_campaign_ids)
            ? s.assigned_campaign_ids.filter((id: unknown): id is string => typeof id === "string")
            : [],
        }))
      : undefined;
    return NextResponse.json({
      computers: enriched,
      summary: summarizeFleetComputers(
        enriched.filter((c) => {
          const seatId = typeof c.seatId === "string" ? c.seatId.trim() : "";
          return Boolean(seatId) && seatId !== HOST_ORPHAN_SEAT_ID;
        }),
      ),
      recentAudits,
      hostCapacity,
      // Omit campaignSeats key when not campaign-scoped — never invent [] from error.
      ...(campaignId && Array.isArray(seats) ? { campaignId, campaignSeats } : {}),
      // Omit bindings when seats read failed (already 500 above); present ⇒ authority.
      ...(Array.isArray(browserSeatBindings) ? { browserSeatBindings } : {}),
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
    if (body.action === "reclaim_healthy_orphan" || body.action === "ensure") {
      if (!body.seatId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `seatId required for ${body.action}`,
          path: ["seatId"],
        });
      }
      // ensure may omit computerId — server makeId (no client UUID twin races).
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


/** Load durable seat→computer bindings before host orphan import / ensure / reclaim.
 * Cold POST without this imports DB-bound VMs as __orphan__ and can steal them. */
async function hydrateWorkspaceSeatBindings(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  workspaceId: string,
): Promise<void> {
  const { data: seats } = await supabase
    .from("agent_seats")
    .select("id, computer_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "LinkedIn Browser Computer");
  for (const seat of seats ?? []) {
    try {
      defaultComputerSupervisor.hydrateComputer({
        workspaceId,
        seatId: seat.id,
        computerId: seat.computer_id,
      });
    } catch (err) {
      // Map conflict vs durable FK — adopt when possible; do not 500 POST ensure/reclaim.
      // GET owns clear-on-read when another DB seat claims the id.
      const msg = err instanceof Error ? err.message : String(err);
      const durableConflict =
        msg.includes("computer-ownership-mismatch") ||
        msg.includes("computer-orphan-claim-blocked");
      if (!durableConflict) throw err;
      const cid =
        typeof seat.computer_id === "string" ? seat.computer_id.trim() : "";
      const claimedByOtherSeat = Boolean(
        cid &&
          (seats ?? []).some((s) => s.id !== seat.id && s.computer_id === cid),
      );
      if (!claimedByOtherSeat && cid) {
        try {
          defaultComputerSupervisor.adoptDurableComputerBinding({
            workspaceId,
            seatId: seat.id,
            computerId: cid,
          });
        } catch {
          /* skip — GET owns clear-on-read */
        }
      }
    }
  }
}

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
    // Pre-hydrate DB bindings before ensure/reclaim/navigate so cold host import
    // cannot treat another seat's VM as an orphan and steal it.
    if (supabase && workspaceId && workspaceId !== "__local__") {
      await hydrateWorkspaceSeatBindings(supabase, workspaceId);
      await defaultComputerSupervisor.hydrateFromHost(workspaceId);
      await defaultComputerSupervisor.restoreSessionHealthFromDurableAudits(workspaceId);
    } else if (workspaceId) {
      await defaultComputerSupervisor.hydrateFromHost(workspaceId);
      await defaultComputerSupervisor.restoreSessionHealthFromDurableAudits(workspaceId);
    }
    // N-agent: campaign-scoped Take/nav/ensure/release must name an attached desk.
    const gateCampaignId = (body.campaignId ?? "").trim();
    const gateSeatId = (body.seatId ?? "").trim();
    if (
      gateCampaignId &&
      gateSeatId &&
      gateSeatId !== HOST_ORPHAN_SEAT_ID &&
      supabase &&
      workspaceId &&
      workspaceId !== "__local__"
    ) {
      const refused = await refuseUnattachedCampaignSeat({
        supabase,
        workspaceId,
        seatId: gateSeatId,
        campaignId: gateCampaignId,
      });
      if (refused) return refused;
    }
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
          computerId: computerId || undefined,
          campaignId: body.campaignId,
        });
        // Persist seat↔computer so cold GET / floor poll cannot orphan a live bind.
        if (
          supabase &&
          workspaceId &&
          workspaceId !== "__local__" &&
          rec?.computerId &&
          seatId !== HOST_ORPHAN_SEAT_ID
        ) {
          const { error } = await supabase
            .from("agent_seats")
            .update({ computer_id: rec.computerId })
            .eq("id", seatId)
            .eq("workspace_id", workspaceId);
          if (error) {
            throw new Error(`ensure computer_id persist failed: ${error.message}`);
          }
        }
        break;
      }
      case "start":
      case "take_control":
      case "stop":
      case "reset":
      case "release_control":
      case "request_help": {
        // Orphans stay reclaim-only — never mutate without a real seat bind.
        const owned = defaultComputerSupervisor.get(computerId);
        const boundSeatId = (owned?.seatId ?? "").trim();
        if (!boundSeatId || boundSeatId === HOST_ORPHAN_SEAT_ID) {
          return NextResponse.json(
            {
              error:
                "Unbound host VM — reclaim/bind a seat before Start, Take control, Stop, Reset, or Release.",
            },
            { status: 400 },
          );
        }
        // N-seat isolation: caller must name the owning seat — never drive
        // another desk's Chromium with only a computerId.
        const callerSeatId = (body.seatId ?? "").trim();
        if (!callerSeatId) {
          return NextResponse.json(
            {
              error: `seatId required for ${body.action}`,
            },
            { status: 400 },
          );
        }
        if (callerSeatId !== boundSeatId) {
          return NextResponse.json(
            {
              error: `computer-ownership-mismatch: ${computerId} belongs to seat ${boundSeatId}, not ${callerSeatId}`,
            },
            { status: 409 },
          );
        }
        if (body.action === "start") {
          rec = await defaultComputerSupervisor.start(computerId, campaignOpts);
        } else if (body.action === "take_control") {
          rec = await defaultComputerSupervisor.takeControl(computerId, campaignOpts);
        } else if (body.action === "stop") {
          rec = await defaultComputerSupervisor.stop(computerId);
        } else if (body.action === "reset") {
          rec = await defaultComputerSupervisor.reset(computerId);
        } else if (body.action === "release_control") {
          rec = await defaultComputerSupervisor.releaseControl(computerId, campaignOpts);
        } else {
          rec = defaultComputerSupervisor.requestHelp(
            computerId,
            body.detail ?? "Operator requested help",
          );
        }
        break;
      }
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
          computerId: computerId || undefined,
          campaignId: body.campaignId,
        });
        // Always drive the ensured id — never the raw request id after a rebound.
        const navComputerId = navRec.computerId;
        // Never silently Release Take control — check human before start() so we
        // return 409 (not start()'s computer-human-held → outer 400).
        const held = defaultComputerSupervisor.get(navComputerId);
        if (held?.control === "human") {
          return NextResponse.json(
            { error: "computer-human-held", detail: "Release Take control before navigate." },
            { status: 409 },
          );
        }
        await defaultComputerSupervisor.start(navComputerId, campaignOpts);
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
          computerId: computerId || undefined,
          campaignId: body.campaignId,
        });
        // Probe navigates — refuse while human Holds or mid-act busy (same mutex as navigate).
        const probeHeld = defaultComputerSupervisor.get(probeRec.computerId);
        if (probeHeld?.control === "human") {
          return NextResponse.json(
            { error: "computer-human-held", detail: "Release Take control before session_probe." },
            { status: 409 },
          );
        }
        if (probeHeld?.status === "busy") {
          return NextResponse.json(
            { error: "computer-busy", detail: "Wait for in-flight act before session_probe." },
            { status: 409 },
          );
        }
        rec = await defaultComputerSupervisor.probeSession(probeRec.computerId);
        break;
      }
      case "reclaim_healthy_orphan": {
        // Probe stored id; if unhealthy, probe host orphans and claim first healthy.
        // Never invents healthy. When a claim happens, persist computer_id here so the
        // next GET hydrate cannot re-attach the login-wall twin from a stale FK
        // (Login updateSeat alone races the 5s floor/fleet poll).
        const seatId = (body.seatId ?? "").trim();
        if (!seatId) {
          return NextResponse.json({ error: "seatId required for reclaim_healthy_orphan" }, { status: 400 });
        }
        // Mid-Take: always seat-wide — twin/orphan request id must not skip Taken durable.
        const seatHeld = defaultComputerSupervisor
          .list(workspaceId ?? "__local__")
          .find((c) => c.seatId === seatId && c.control === "human");
        if (seatHeld) {
          return NextResponse.json(
            { error: "computer-human-held", detail: "Release Take control before reclaim." },
            { status: 409 },
          );
        }
        // Mid-act: never /session-probe navigate the busy desk (or orphan-hunt while it sends).
        const seatBusy = defaultComputerSupervisor
          .list(workspaceId ?? "__local__")
          .find((c) => c.seatId === seatId && c.status === "busy");
        if (seatBusy) {
          return NextResponse.json(
            { error: "computer-busy", detail: "Wait for in-flight act before reclaim." },
            { status: 409 },
          );
        }
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
            // Roll back in-memory claim so cold GET cannot keep a stolen binding.
            defaultComputerSupervisor.releaseToOrphan(rec.computerId, {
              workspaceId,
              restoreComputerId: computerId || null,
              restoreSeatId: seatId,
            });
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
    const message = err instanceof Error ? err.message : "computer action failed";
    const status =
      message === "computer-human-held" || message === "computer-busy" ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    bindComputerSupervisorEndpoint(null);
  }
}
