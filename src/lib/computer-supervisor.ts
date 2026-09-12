/**
 * OpenBot computer supervisor adapter (in-process + remote).
 * One Chromium computer per LinkedIn seat — ensure/stop/reset, decide→audit→act,
 * human takeover mutex (bot actions refuse while operator has control).
 *
 * Remote path uses CopilotKit OpenBot supervisor:
 *   POST /computers/:botId/ensure|stop|reset
 * then drives agent-computer with COMPUTER_TOKEN (/navigate /snapshot /click /type).
 *
 * When COMPUTER_SUPERVISOR_URL is unset, jobs queue locally (mock send for tests).
 */

import { toOpenBotBotId } from "@/lib/openbot/bot-id";
import {
  openBotNavigate,
  openBotReleaseControl,
  openBotSessionProbe,
  openBotTakeControl,
  type OpenBotAgentComputerConfig,
} from "@/lib/openbot/agent-computer-client";
import { openBotLinkedInSend } from "@/lib/openbot/linkedin-send";
import {
  openBotEnsureComputer,
  openBotListComputers,
  openBotResetComputer,
  openBotStopComputer,
  type OpenBotSupervisorConfig,
} from "@/lib/openbot/supervisor-client";
import {
  recordComputerAudit,
} from "@/lib/computer-audit";

export type ComputerStatus =
  | "stopped"
  | "starting"
  | "ready"
  | "busy"
  | "help_requested"
  | "error";

export type ComputerControl = "bot" | "human";

export type ComputerRecord = {
  computerId: string;
  seatId: string;
  workspaceId: string;
  status: ComputerStatus;
  control: ComputerControl;
  lastAudit: string | null;
  lastError: string | null;
  profileVolume: string;
  updatedAt: string;
  botId?: string;
  remoteUrl?: string | null;
  /** Human-facing live view (screenshot/stream). Falls back to remoteUrl. */
  viewUrl?: string | null;
  /** Last campaign scope that touched this computer (Campaign Agents). */
  campaignId?: string | null;
  /** Last LinkedIn session probe result (null = unknown). */
  sessionHealthy?: boolean | null;
};

export type ComputerJobKind = "linkedin_send" | "warmup_nav" | "login_assist";

export type ComputerJob = {
  jobId: string;
  computerId: string;
  kind: ComputerJobKind;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed" | "refused";
  detail: string;
  createdAt: string;
  finishedAt: string | null;
};

export type AuditEntry = {
  at: string;
  computerId: string;
  action: string;
  detail: string;
  actor: "bot" | "human" | "system";
  workspaceId?: string;
  seatId?: string | null;
  campaignId?: string | null;
  correlationId?: string | null;
  jobId?: string | null;
  id?: string;
};

export type ComputerSupervisorEndpoint = {
  url?: string | null;
  token?: string | null;
  /** Agent-computer COMPUTER_TOKEN (defaults to OPENBOT_COMPUTER_TOKEN / COMPUTER_TOKEN / supervisor token). */
  computerToken?: string | null;
  mockSend?: boolean | null;
};

/**
 * Seat id for host Chromiums that are running but not yet bound to an agent_seats row.
 * hydrateFromHost imports them so Login/Fleet can probe+reclaim without minting twins.
 * Never invent sessionHealthy for these — probe first.
 */
export const HOST_ORPHAN_SEAT_ID = "__orphan__";

let endpointOverride: ComputerSupervisorEndpoint | null = null;

/** Bind Aria Settings / vault-resolved supervisor endpoint for the current deliver call. */
export function bindComputerSupervisorEndpoint(endpoint: ComputerSupervisorEndpoint | null) {
  endpointOverride = endpoint;
}

function supervisorUrl(): string {
  return (endpointOverride?.url ?? process.env.COMPUTER_SUPERVISOR_URL ?? "").trim();
}

function supervisorToken(): string {
  return (endpointOverride?.token ?? process.env.COMPUTER_SUPERVISOR_TOKEN ?? "").trim();
}

function resolveComputerToken(): string {
  return (
    endpointOverride?.computerToken ??
    process.env.OPENBOT_COMPUTER_TOKEN ??
    process.env.COMPUTER_TOKEN ??
    supervisorToken()
  ).trim();
}

function supervisorMockSend(): boolean {
  let wanted: boolean;
  if (endpointOverride?.mockSend === true) wanted = true;
  else if (endpointOverride?.mockSend === false) wanted = false;
  else wanted = process.env.COMPUTER_SUPERVISOR_MOCK_SEND === "1";
  // On Fly, never allow theatrical send-without-probe unless explicitly opted in.
  // N campaign agents must fail closed on sessionHealthy — mock send would lie green.
  if (
    wanted &&
    process.env.FLY_APP_NAME &&
    process.env.ALLOW_COMPUTER_SUPERVISOR_MOCK_SEND !== "1"
  ) {
    return false;
  }
  return wanted;
}

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function openBotSupervisorCfg(): OpenBotSupervisorConfig | null {
  const baseUrl = supervisorUrl();
  const token = supervisorToken();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

function agentCfg(rec: ComputerRecord): OpenBotAgentComputerConfig | null {
  const baseUrl = (rec.remoteUrl ?? "").trim();
  const token = resolveComputerToken();
  if (!baseUrl || !token) return null;
  return {
    baseUrl,
    computerToken: token,
    botId: rec.botId || toOpenBotBotId(rec.computerId),
  };
}

export class ComputerSupervisor {
  private computers = new Map<string, ComputerRecord>();
  private jobs = new Map<string, ComputerJob>();
  private audits: AuditEntry[] = [];
  /** Serialize jobs per computer so one seat never runs two Chromium actions at once. */
  private computerChains = new Map<string, Promise<unknown>>();
  private readonly maxAudits = 2_000;
  /** Active human takeover correlation per computer. */
  private takeoverCorrelation = new Map<string, string>();
  /** Failed linkedin_send jobIds already auto-retried after Release (cap once). */
  private retriedJobIds = new Set<string>();
  private static readonly RELEASE_RETRY_CAP = 3;

  private audit(
    computerId: string,
    action: string,
    detail: string,
    actor: AuditEntry["actor"] = "system",
    extra?: {
      correlationId?: string | null;
      jobId?: string | null;
      campaignId?: string | null;
      meta?: Record<string, unknown>;
    },
  ) {
    const rec = this.computers.get(computerId);
    const correlationId =
      extra?.correlationId ??
      this.takeoverCorrelation.get(computerId) ??
      null;
    const campaignId = extra?.campaignId ?? rec?.campaignId ?? null;
    const durable = recordComputerAudit({
      workspaceId: rec?.workspaceId ?? "__local__",
      computerId,
      seatId: rec?.seatId ?? null,
      campaignId,
      action,
      detail,
      actor,
      correlationId,
      jobId: extra?.jobId ?? null,
      meta: extra?.meta,
    });
    const entry: AuditEntry = {
      id: durable.id,
      at: durable.at,
      computerId,
      action,
      detail,
      actor,
      workspaceId: durable.workspaceId,
      seatId: durable.seatId,
      campaignId: durable.campaignId,
      correlationId: durable.correlationId,
      jobId: durable.jobId,
    };
    this.audits.push(entry);
    if (this.audits.length > this.maxAudits) {
      this.audits.splice(0, this.audits.length - this.maxAudits);
    }
    if (rec) {
      rec.lastAudit = `${action}: ${detail}`.slice(0, 160);
      rec.updatedAt = isoNow();
    }
  }

  ensureComputer(opts: {
    workspaceId: string;
    seatId: string;
    computerId?: string;
    campaignId?: string | null;
  }): ComputerRecord {
    if (opts.computerId) {
      const byId = this.computers.get(opts.computerId);
      if (byId) {
        // Never share one Chromium profile across seats/workspaces — except claiming
        // a host orphan (imported by hydrateFromHost) onto a real agent seat.
        if (byId.workspaceId !== opts.workspaceId) {
          throw new Error(
            `computer-ownership-mismatch: ${opts.computerId} belongs to seat ${byId.seatId} (workspace ${byId.workspaceId}), not seat ${opts.seatId}`,
          );
        }
        if (byId.seatId !== opts.seatId) {
          if (byId.seatId === HOST_ORPHAN_SEAT_ID && opts.seatId !== HOST_ORPHAN_SEAT_ID) {
            // Poll-time ensure with a stale login-wall id must not steal the seat
            // back from a durable VM already bound (reclaim → detach twin → ensure race).
            const seatOwner = [...this.computers.values()].find(
              (c) =>
                c.workspaceId === opts.workspaceId &&
                c.seatId === opts.seatId &&
                c.seatId !== HOST_ORPHAN_SEAT_ID &&
                c.computerId !== opts.computerId,
            );
            if (seatOwner) {
              throw new Error(
                `computer-orphan-claim-blocked: seat ${opts.seatId} already bound to ${seatOwner.computerId}; refusing to claim orphan ${opts.computerId}`,
              );
            }
            return this.claimOrphan(opts.computerId, {
              workspaceId: opts.workspaceId,
              seatId: opts.seatId,
              campaignId: opts.campaignId,
            });
          }
          throw new Error(
            `computer-ownership-mismatch: ${opts.computerId} belongs to seat ${byId.seatId} (workspace ${byId.workspaceId}), not seat ${opts.seatId}`,
          );
        }
        if (opts.campaignId) byId.campaignId = opts.campaignId;
        return byId;
      }
    }
    const existing = [...this.computers.values()].find(
      (c) =>
        c.workspaceId === opts.workspaceId &&
        c.seatId === opts.seatId &&
        c.seatId !== HOST_ORPHAN_SEAT_ID,
    );
    if (existing) {
      // Prefer stable DB computer_id so OpenBot bot ids match across processes —
      // but never silently retarget a live / probed / human-held VM (stale poll race).
      if (opts.computerId && existing.computerId !== opts.computerId) {
        // Block only when retarget would steal a mutex / probed-green / in-flight VM.
        // ready+remoteUrl alone must still allow stopped→stable-DB id migration.
        // ready counts as live even before sessionHealthy probe — otherwise a
        // stale poll computerId can delete the durable binding mid-boot.
        const live =
          existing.control === "human" ||
          existing.sessionHealthy === true ||
          existing.status === "ready" ||
          existing.status === "busy" ||
          existing.status === "starting" ||
          existing.status === "help_requested";
        if (live) {
          this.audit(
            existing.computerId,
            "ensure",
            `Refused client retarget to ${opts.computerId}; seat live on ${existing.computerId}`,
            "system",
            { campaignId: opts.campaignId },
          );
        } else {
          this.computers.delete(existing.computerId);
          existing.computerId = opts.computerId;
          existing.botId = toOpenBotBotId(opts.computerId);
          this.computers.set(opts.computerId, existing);
          this.audit(opts.computerId, "ensure", `Rebound seat ${opts.seatId} to stable computer id`, "system", {
            campaignId: opts.campaignId,
          });
        }
      }
      if (opts.campaignId) existing.campaignId = opts.campaignId;
      return existing;
    }
    const computerId = opts.computerId ?? makeId("comp");
    const rec: ComputerRecord = {
      computerId,
      seatId: opts.seatId,
      workspaceId: opts.workspaceId,
      status: "stopped",
      control: "bot",
      lastAudit: null,
      lastError: null,
      profileVolume: `profiles/${opts.workspaceId}/${opts.seatId}`,
      updatedAt: isoNow(),
      botId: toOpenBotBotId(computerId),
      remoteUrl: null,
      viewUrl: null,
      campaignId: opts.campaignId ?? null,
      sessionHealthy: null,
    };
    this.computers.set(computerId, rec);
    this.audit(computerId, "ensure", `Seat ${opts.seatId} computer registered`, "system", {
      campaignId: opts.campaignId,
    });
    return rec;
  }

  /**
   * List/hydrate only — never mint. Poll/GET paths must call this so unbound
   * seats stay unbound until Deploy/Login/ensure explicitly assigns a durable id.
   */
  hydrateComputer(opts: {
    workspaceId: string;
    seatId: string;
    computerId: string | null | undefined;
    campaignId?: string | null;
  }): ComputerRecord | null {
    const computerId = typeof opts.computerId === "string" ? opts.computerId.trim() : "";
    if (!computerId) return null;
    return this.ensureComputer({
      workspaceId: opts.workspaceId,
      seatId: opts.seatId,
      computerId,
      campaignId: opts.campaignId,
    });
  }

  /**
   * Bind a host-imported orphan Chromium onto a real agent seat.
   * Detaches any other computer still claiming that seat (marks it orphan again)
   * so one seat never owns two profiles.
   */
  claimOrphan(
    computerId: string,
    opts: { workspaceId: string; seatId: string; campaignId?: string | null },
  ): ComputerRecord {
    const rec = this.require(computerId);
    if (rec.workspaceId !== opts.workspaceId) {
      throw new Error(
        `computer-ownership-mismatch: ${computerId} belongs to workspace ${rec.workspaceId}, not ${opts.workspaceId}`,
      );
    }
    if (rec.seatId !== HOST_ORPHAN_SEAT_ID && rec.seatId !== opts.seatId) {
      throw new Error(
        `computer-ownership-mismatch: ${computerId} belongs to seat ${rec.seatId}, not orphan/seat ${opts.seatId}`,
      );
    }
    if (opts.seatId === HOST_ORPHAN_SEAT_ID) {
      throw new Error("claim-orphan-requires-real-seat");
    }
    for (const other of this.computers.values()) {
      if (
        other.workspaceId === opts.workspaceId &&
        other.seatId === opts.seatId &&
        other.computerId !== computerId
      ) {
        other.seatId = HOST_ORPHAN_SEAT_ID;
        other.profileVolume = `profiles/${opts.workspaceId}/${HOST_ORPHAN_SEAT_ID}`;
        other.updatedAt = isoNow();
        this.audit(
          other.computerId,
          "detach_seat",
          `Detached seat ${opts.seatId} while reclaiming ${computerId}`,
          "system",
        );
      }
    }
    rec.seatId = opts.seatId;
    rec.profileVolume = `profiles/${opts.workspaceId}/${opts.seatId}`;
    if (opts.campaignId) rec.campaignId = opts.campaignId;
    rec.updatedAt = isoNow();
    this.audit(
      computerId,
      "claim_orphan",
      `Claimed host orphan onto seat ${opts.seatId}`,
      "system",
      { campaignId: opts.campaignId },
    );
    return rec;
  }

  /**
   * Undo an in-memory orphan claim when durable agent_seats.computer_id persist fails.
   * Optionally restore a previously detached seat binding so cold GET cannot steal.
   */
  releaseToOrphan(
    computerId: string,
    opts?: {
      workspaceId?: string;
      restoreComputerId?: string | null;
      restoreSeatId?: string | null;
    },
  ): ComputerRecord {
    const rec = this.require(computerId);
    if (rec.seatId === HOST_ORPHAN_SEAT_ID) return rec;
    const workspaceId = opts?.workspaceId ?? rec.workspaceId;
    const restoreSeatId = (opts?.restoreSeatId ?? "").trim();
    const restoreComputerId = (opts?.restoreComputerId ?? "").trim();
    rec.seatId = HOST_ORPHAN_SEAT_ID;
    rec.profileVolume = `profiles/${workspaceId}/${HOST_ORPHAN_SEAT_ID}`;
    rec.updatedAt = isoNow();
    this.audit(
      computerId,
      "release_orphan",
      `Rolled back claim — computer_id persist failed`,
      "system",
    );
    if (
      restoreComputerId &&
      restoreSeatId &&
      restoreSeatId !== HOST_ORPHAN_SEAT_ID &&
      restoreComputerId !== computerId
    ) {
      const prev = this.computers.get(restoreComputerId);
      if (
        prev &&
        prev.workspaceId === workspaceId &&
        (prev.seatId === HOST_ORPHAN_SEAT_ID || prev.seatId === restoreSeatId)
      ) {
        prev.seatId = restoreSeatId;
        prev.profileVolume = `profiles/${workspaceId}/${restoreSeatId}`;
        prev.updatedAt = isoNow();
        this.audit(
          restoreComputerId,
          "restore_seat",
          `Restored seat ${restoreSeatId} after failed reclaim of ${computerId}`,
          "system",
        );
      }
    }
    return rec;
  }

  list(workspaceId: string): ComputerRecord[] {
    return [...this.computers.values()].filter((c) => c.workspaceId === workspaceId);
  }

  /** Host Chromiums imported by hydrateFromHost that are not bound to a real seat. */
  listOrphans(workspaceId: string): ComputerRecord[] {
    return this.list(workspaceId).filter((c) => c.seatId === HOST_ORPHAN_SEAT_ID);
  }

  get(computerId: string): ComputerRecord | undefined {
    return this.computers.get(computerId);
  }

  /**
   * Reconcile in-memory rows with live OpenBot host state after cold start.
   * Without this, ensureComputer leaves status=stopped even when Chromiums are up,
   * so Fleet/Floor look empty while Fly still has VMs.
   *
   * Also imports unmatched running host bots as orphans (seatId=__orphan__) so Login
   * can probe+reclaim a durable healthy profile instead of reminting a login-wall twin.
   * Never invents sessionHealthy — orphans stay null until /session-probe.
   */
  async hydrateFromHost(workspaceId: string): Promise<{
    matched: number;
    imported: number;
    hostCount: number;
  }> {
    const cfg = openBotSupervisorCfg();
    if (!cfg) return { matched: 0, imported: 0, hostCount: 0 };
    let hostComputers: Awaited<ReturnType<typeof openBotListComputers>>["computers"] = [];
    try {
      ({ computers: hostComputers } = await openBotListComputers(cfg));
    } catch {
      return { matched: 0, imported: 0, hostCount: 0 };
    }
    const byBot = new Map(
      hostComputers
        .filter((c) => c.botId)
        .map((c) => [c.botId, c] as const),
    );
    const matchedBotIds = new Set<string>();
    let matched = 0;
    for (const rec of this.list(workspaceId)) {
      const botId = rec.botId || toOpenBotBotId(rec.computerId);
      const host = byBot.get(botId);
      if (!host) {
        // Successful host listing without this bot → not running. Don't leave stale ready.
        if (rec.control !== "human" && rec.status !== "stopped") {
          rec.status = "stopped";
          rec.sessionHealthy = null;
          rec.remoteUrl = null;
          rec.viewUrl = null;
          rec.updatedAt = isoNow();
        }
        continue;
      }
      matched += 1;
      matchedBotIds.add(botId);
      this.applyHostState(rec, host);
    }

    let imported = 0;
    for (const host of hostComputers) {
      const botId = (host.botId || "").trim();
      if (!botId || matchedBotIds.has(botId)) continue;
      const raw = (host.status || "").toLowerCase();
      // Only import live processes — stopped host slots are not reclaim candidates.
      if (
        raw &&
        raw !== "running" &&
        raw !== "ready" &&
        raw !== "idle" &&
        raw !== "starting" &&
        raw !== "booting"
      ) {
        continue;
      }
      // Prefer botId as computerId when it is already a durable Aria id (comp_*).
      const computerId = botId;
      if (this.computers.has(computerId)) {
        // Bound to another workspace — do not steal.
        continue;
      }
      const orphan = this.ensureComputer({
        workspaceId,
        seatId: HOST_ORPHAN_SEAT_ID,
        computerId,
      });
      this.applyHostState(orphan, host);
      // Host proves process up only — LinkedIn health requires probe.
      orphan.sessionHealthy = null;
      imported += 1;
      matchedBotIds.add(botId);
      this.audit(
        computerId,
        "import_orphan",
        `Imported unmatched host bot ${botId} as orphan`,
        "system",
      );
    }
    return { matched, imported, hostCount: hostComputers.length };
  }

  private applyHostState(
    rec: ComputerRecord,
    host: { status?: string; url?: string | null; viewUrl?: string | null },
  ): void {
    const raw = (host.status || "").toLowerCase();
    // Human takeover owns status — host sync must not yank the desk to
    // starting/error/stopped mid–Take control (operator is on the VM).
    if (rec.control !== "human") {
      if (raw === "running" || raw === "ready" || raw === "idle") {
        if (rec.status === "stopped" || rec.status === "starting" || rec.status === "error") {
          rec.status = "ready";
          rec.lastError = null;
          // Host proves process up — session health still requires /session-probe.
          rec.sessionHealthy = null;
        }
      } else if (raw === "starting" || raw === "booting") {
        rec.status = "starting";
        rec.sessionHealthy = null;
      } else if (raw === "error" || raw === "failed") {
        rec.status = "error";
        rec.sessionHealthy = null;
      } else if (raw === "stopped" || raw === "exited") {
        rec.status = "stopped";
        rec.sessionHealthy = null;
      }
    }
    if (host.url) rec.remoteUrl = host.url;
    if (host.viewUrl || host.url) rec.viewUrl = host.viewUrl || host.url || rec.viewUrl;
    rec.updatedAt = isoNow();
  }

  /**
   * When the seat's stored computerId is missing or probes unhealthy, probe host
   * orphans and claim the first healthy durable profile. Never invents healthy=true.
   */
  async reclaimHealthyOrphan(opts: {
    workspaceId: string;
    seatId: string;
    computerId?: string | null;
    campaignId?: string | null;
  }): Promise<{ computer: ComputerRecord; reclaimed: boolean }> {
    await this.hydrateFromHost(opts.workspaceId);

    const currentId = typeof opts.computerId === "string" ? opts.computerId.trim() : "";
    if (currentId) {
      try {
        this.ensureComputer({
          workspaceId: opts.workspaceId,
          seatId: opts.seatId,
          computerId: currentId,
          campaignId: opts.campaignId,
        });
        const current = await this.probeSession(currentId);
        if (current.sessionHealthy === true) {
          return { computer: current, reclaimed: false };
        }
      } catch (err) {
        // Foreign / blocked id — fall through to orphan reclaim (do not keep another seat's VM).
        const msg = err instanceof Error ? err.message : String(err);
        if (!/ownership-mismatch|orphan-claim-blocked/.test(msg)) throw err;
      }
    }

    const candidates = this.list(opts.workspaceId).filter((c) => {
      if (currentId && c.computerId === currentId) return false;
      if (!c.remoteUrl) return false;
      return c.seatId === HOST_ORPHAN_SEAT_ID;
    });

    for (const candidate of candidates) {
      const probed = await this.probeSession(candidate.computerId);
      if (probed.sessionHealthy !== true) continue;
      const claimed = this.claimOrphan(candidate.computerId, {
        workspaceId: opts.workspaceId,
        seatId: opts.seatId,
        campaignId: opts.campaignId,
      });
      return { computer: claimed, reclaimed: true };
    }

    if (currentId) {
      const fallback = this.computers.get(currentId);
      // Only keep the stored id when it is still ours (or unbound orphan we already probed unhealthy).
      if (
        fallback &&
        fallback.workspaceId === opts.workspaceId &&
        (fallback.seatId === opts.seatId || fallback.seatId === HOST_ORPHAN_SEAT_ID)
      ) {
        return { computer: fallback, reclaimed: false };
      }
    }
    throw new Error("no-healthy-orphan");
  }

  async start(
    computerId: string,
    opts?: { campaignId?: string | null; warmupUrl?: string | null },
  ): Promise<ComputerRecord> {
    const rec = this.computers.get(computerId);
    if (!rec) throw new Error("computer-not-found");
    if (opts?.campaignId) rec.campaignId = opts.campaignId;
    rec.status = "starting";
    rec.sessionHealthy = null;
    rec.updatedAt = isoNow();
    this.audit(computerId, "start", "Booting isolated Chromium via OpenBot ensure", "system", {
      campaignId: opts?.campaignId,
    });

    const cfg = openBotSupervisorCfg();
    if (cfg) {
      try {
        const state = await openBotEnsureComputer(cfg, rec.botId || computerId);
        rec.botId = state.botId || rec.botId || toOpenBotBotId(computerId);
        rec.remoteUrl =
          state.url ?? (state.port ? `http://127.0.0.1:${state.port}` : rec.remoteUrl);
        rec.viewUrl = state.viewUrl || rec.remoteUrl;
        if (!rec.remoteUrl) {
          rec.status = "error";
          rec.lastError =
            "OpenBot ensure returned no computer URL/port — check published ports / COMPUTER_NETWORK";
          rec.updatedAt = isoNow();
          this.audit(computerId, "start_failed", rec.lastError, "system");
          return rec;
        }
        // Warm the Chromium to LinkedIn so Observe shows real work surface.
        const agent = agentCfg(rec);
        if (agent) {
          try {
            const warmupUrl =
              typeof opts?.warmupUrl === "string" && opts.warmupUrl.trim()
                ? opts.warmupUrl.trim()
                : "https://www.linkedin.com/";
            await openBotNavigate(agent, warmupUrl);
            this.audit(computerId, "warmup_navigate", "Opened LinkedIn after ensure", "system");
          } catch (navErr) {
            this.audit(
              computerId,
              "warmup_navigate_failed",
              navErr instanceof Error ? navErr.message : "LinkedIn warmup navigate failed",
              "system",
            );
          }
        }
      } catch (err) {
        rec.status = "error";
        rec.lastError = err instanceof Error ? err.message : "OpenBot ensure failed";
        rec.updatedAt = isoNow();
        this.audit(computerId, "start_failed", rec.lastError, "system");
        return rec;
      }
    } else if (supervisorMockSend()) {
      // Tests / local mock only — not a real Chromium. Never mark ready without
      // OpenBot unless mock send is explicitly enabled.
      rec.remoteUrl = `/fleet/computers/${encodeURIComponent(computerId)}/viewport`;
      rec.viewUrl = rec.remoteUrl;
      this.audit(
        computerId,
        "start_local_viewport",
        "OpenBot supervisor unset — mock viewport for tests (COMPUTER_SUPERVISOR_MOCK_SEND=1)",
        "system",
      );
    } else {
      rec.status = "error";
      rec.lastError =
        "OpenBot supervisor unset. Set COMPUTER_SUPERVISOR_URL + token (or COMPUTER_SUPERVISOR_MOCK_SEND=1 for tests).";
      rec.remoteUrl = null;
      rec.viewUrl = null;
      rec.updatedAt = isoNow();
      this.audit(computerId, "start_failed", rec.lastError, "system");
      return rec;
    }

    rec.status = "ready";
    rec.lastError = null;
    // Process up ≠ LinkedIn login. Never carry a stale probe across stop→start.
    rec.sessionHealthy = null;
    rec.updatedAt = isoNow();
    rec.lastAudit = "ready";
    this.audit(
      computerId,
      "ready",
      "Computer process ready — LinkedIn session unverified",
      "system",
    );
    return rec;
  }

  async stop(computerId: string): Promise<ComputerRecord> {
    const rec = this.require(computerId);
    const cfg = openBotSupervisorCfg();
    if (cfg) {
      try {
        await openBotStopComputer(cfg, rec.botId || computerId);
      } catch (err) {
        rec.lastError = err instanceof Error ? err.message : "OpenBot stop failed";
        this.audit(computerId, "stop_failed", rec.lastError, "system");
      }
    }
    rec.status = "stopped";
    rec.control = "bot";
    rec.remoteUrl = null;
    rec.viewUrl = null;
    rec.sessionHealthy = null;
    rec.updatedAt = isoNow();
    this.audit(computerId, "stop", "Computer stopped", "system");
    return rec;
  }

  async reset(computerId: string): Promise<ComputerRecord> {
    const rec = this.require(computerId);
    const cfg = openBotSupervisorCfg();
    if (cfg) {
      try {
        await openBotResetComputer(cfg, rec.botId || computerId);
      } catch (err) {
        rec.lastError = err instanceof Error ? err.message : "OpenBot reset failed";
        this.audit(computerId, "reset_failed", rec.lastError, "system");
      }
    }
    rec.remoteUrl = null;
    rec.viewUrl = null;
    await this.stop(computerId);
    return this.start(computerId);
  }

  /** Human opens observe/takeover — bot actions refuse until release. */
  async takeControl(computerId: string, opts?: { campaignId?: string | null }): Promise<ComputerRecord> {
    let rec = this.require(computerId);
    if (opts?.campaignId) rec.campaignId = opts.campaignId;
    if (rec.status === "stopped" || rec.status === "error" || !rec.remoteUrl) {
      rec = await this.start(computerId, opts);
      if (rec.status === "error") return rec;
    }
    const correlationId = `takeover_${computerId}_${Date.now().toString(36)}`;
    this.takeoverCorrelation.set(computerId, correlationId);
    rec.control = "human";
    // Operator may log in / change cookies — prior probe is no longer authoritative.
    // Floor must not stay green-working while human holds the mutex.
    rec.sessionHealthy = null;
    rec.updatedAt = isoNow();
    rec.lastAudit = "human_takeover";
    this.audit(
      computerId,
      "takeover",
      "Operator took control — bot mutex held",
      "human",
      { correlationId, campaignId: opts?.campaignId },
    );
    const agent = agentCfg(rec);
    if (agent) {
      try {
        await openBotTakeControl(agent);
      } catch (err) {
        this.audit(
          computerId,
          "takeover_remote_failed",
          err instanceof Error ? err.message : "remote take failed",
          "system",
          { correlationId },
        );
      }
    }
    return rec;
  }

  /**
   * Probe LinkedIn session on a durable computer profile. Never invents healthy=true.
   * Used by Login/Restore so we open /feed when cookies already work (survives app deploys).
   */
  async probeSession(computerId: string): Promise<ComputerRecord> {
    const rec = this.require(computerId);
    const agent = agentCfg(rec);
    if (!agent) {
      rec.sessionHealthy = null;
      rec.updatedAt = isoNow();
      this.audit(computerId, "session_probe", "No agent endpoint — cannot probe", "system");
      return rec;
    }
    try {
      const probe = await openBotSessionProbe(agent);
      rec.sessionHealthy = probe.healthy;
      if (probe.healthy) {
        rec.lastError = null;
      } else {
        rec.lastError = probe.detail;
      }
      rec.updatedAt = isoNow();
      this.audit(computerId, "session_probe", probe.detail, "system");
    } catch (err) {
      rec.sessionHealthy = null;
      rec.lastError = err instanceof Error ? err.message : "session probe failed";
      rec.updatedAt = isoNow();
      this.audit(
        computerId,
        "session_probe_failed",
        err instanceof Error ? err.message : "session probe failed",
        "system",
      );
    }
    return rec;
  }

  async releaseControl(computerId: string, opts?: { campaignId?: string | null }): Promise<ComputerRecord> {
    const rec = this.require(computerId);
    if (opts?.campaignId) rec.campaignId = opts.campaignId;
    const correlationId = this.takeoverCorrelation.get(computerId) ?? null;
    rec.control = "bot";
    // Operator finished Take control — clear help_requested so the bot may act again.
    // Do NOT invent sessionHealthy=true: login may have failed or been skipped.
    // Leave null until a real LinkedIn probe (or a later help_requested) decides.
    if (rec.status === "help_requested") {
      rec.status = "ready";
      rec.lastError = null;
    }
    // Always invalidate until probe below (or leave null when no agent endpoint).
    rec.sessionHealthy = null;
    rec.updatedAt = isoNow();
    rec.lastAudit = "control_released";
    this.audit(
      computerId,
      "release",
      "Operator released control — bot may act",
      "human",
      { correlationId, campaignId: opts?.campaignId },
    );
    this.takeoverCorrelation.delete(computerId);
    const agent = agentCfg(rec);
    let probedHealthy: boolean | null = null;
    if (agent) {
      try {
        await openBotReleaseControl(agent);
      } catch (err) {
        this.audit(
          computerId,
          "release_remote_failed",
          err instanceof Error ? err.message : "remote release failed",
          "system",
          { correlationId, campaignId: opts?.campaignId },
        );
      }
      // Real LinkedIn probe — never invent healthy=true without this.
      try {
        const probe = await openBotSessionProbe(agent);
        rec.sessionHealthy = probe.healthy;
        probedHealthy = probe.healthy;
        if (probe.healthy) {
          rec.lastError = null;
        } else {
          rec.lastError = probe.detail;
        }
        rec.updatedAt = isoNow();
        this.audit(computerId, "session_probe", probe.detail, "system", {
          correlationId,
          campaignId: opts?.campaignId,
          meta: { healthy: probe.healthy, url: probe.url ?? null },
        });
      } catch (err) {
        rec.sessionHealthy = null;
        probedHealthy = null;
        this.audit(
          computerId,
          "session_probe_failed",
          err instanceof Error ? err.message : "session probe failed",
          "system",
          { correlationId, campaignId: opts?.campaignId },
        );
      }
    } else {
      // No agent endpoint — cannot probe; never leave a stale healthy=true.
      this.audit(computerId, "session_probe", "No agent endpoint — cannot probe after release", "system", {
        correlationId,
        campaignId: opts?.campaignId,
      });
    }

    // Auto-retry only when LinkedIn is confirmed healthy — never on missing probe.
    const allowRetry = probedHealthy === true;
    if (allowRetry) {
      const failed = [...this.jobs.values()]
        .filter(
          (j) =>
            j.computerId === computerId &&
            j.kind === "linkedin_send" &&
            j.status === "failed" &&
            !this.retriedJobIds.has(j.jobId),
        )
        .sort((a, b) => Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt))
        .slice(0, ComputerSupervisor.RELEASE_RETRY_CAP);

      for (const job of failed) {
        this.retriedJobIds.add(job.jobId);
        this.audit(
          computerId,
          "decide",
          `Auto-retry linkedin_send after Release (${job.jobId})`,
          "system",
          { campaignId: opts?.campaignId, jobId: job.jobId },
        );
        void this.enqueueJob({
          computerId,
          kind: "linkedin_send",
          payload: { ...job.payload, retryOf: job.jobId },
        });
      }
    }

    return rec;
  }

  requestHelp(computerId: string, detail: string): ComputerRecord {
    const rec = this.require(computerId);
    rec.status = "help_requested";
    rec.sessionHealthy = false;
    rec.lastError = detail;
    rec.updatedAt = isoNow();
    this.audit(computerId, "help_requested", detail, "bot");
    return rec;
  }

  /**
   * decide → audit → act. Refuses when human holds control (OpenBot mutex).
   */
  async enqueueJob(opts: {
    computerId: string;
    kind: ComputerJobKind;
    payload: Record<string, unknown>;
  }): Promise<ComputerJob> {
    const rec = this.require(opts.computerId);
    const jobId = makeId("job");
    const job: ComputerJob = {
      jobId,
      computerId: opts.computerId,
      kind: opts.kind,
      payload: opts.payload,
      status: "queued",
      detail: "queued",
      createdAt: isoNow(),
      finishedAt: null,
    };

    if (rec.control === "human") {
      job.status = "refused";
      job.detail = "human-has-control";
      job.finishedAt = isoNow();
      this.jobs.set(jobId, job);
      this.audit(opts.computerId, "act_refused", `Job ${opts.kind} refused — human mutex`, "bot", {
        jobId,
      });
      return job;
    }

    // Session gate: LinkedIn sends require a probed-healthy session (align with go-live).
    // Mock send may proceed without a probe so unit tests can exercise the act path.
    if (opts.kind === "linkedin_send") {
      const needsSession =
        rec.status === "help_requested" ||
        (!supervisorMockSend() && rec.sessionHealthy !== true);
      if (needsSession) {
        job.status = "refused";
        job.detail =
          rec.status === "help_requested"
            ? "help_requested"
            : rec.sessionHealthy === false
              ? "session_unhealthy"
              : "session_unverified";
        job.finishedAt = isoNow();
        this.jobs.set(jobId, job);
        this.audit(
          opts.computerId,
          "act_refused",
          `linkedin_send refused — ${job.detail}`,
          "bot",
          { jobId },
        );
        return job;
      }
    }

    if (rec.status !== "ready" && rec.status !== "busy") {
      if (rec.status === "stopped" || rec.status === "error") {
        await this.start(opts.computerId);
      }
    }

    this.jobs.set(jobId, job);
    this.audit(opts.computerId, "decide", `Accepted job ${opts.kind}`, "bot", { jobId });

    // One Chromium per seat: chain jobs so concurrent enqueue on the same
    // computer never interleaves navigate/click/type.
    const prev = this.computerChains.get(opts.computerId) ?? Promise.resolve();
    const run = prev.then(
      () => this.runJob(job),
      () => this.runJob(job),
    );
    this.computerChains.set(
      opts.computerId,
      run.finally(() => {
        if (this.computerChains.get(opts.computerId) === run) {
          this.computerChains.delete(opts.computerId);
        }
      }),
    );
    return run;
  }

  private async runJob(job: ComputerJob): Promise<ComputerJob> {
    const rec = this.require(job.computerId);
    const campaignId =
      typeof job.payload.campaignId === "string" ? job.payload.campaignId : rec.campaignId ?? null;
    if (campaignId) rec.campaignId = campaignId;
    const jobMeta = {
      messageId: job.payload.messageId,
      candidateId: job.payload.candidateId,
      campaignId,
    };
    if (rec.control === "human") {
      job.status = "refused";
      job.detail = "human-has-control";
      job.finishedAt = isoNow();
      this.jobs.set(job.jobId, job);
      this.audit(job.computerId, "act_refused", `Job ${job.kind} refused mid-run — human mutex`, "bot", {
        jobId: job.jobId,
        campaignId,
        meta: jobMeta,
      });
      return job;
    }

    rec.status = "busy";
    job.status = "running";
    this.jobs.set(job.jobId, job);
    this.audit(job.computerId, "act", `Running ${job.kind}`, "bot", {
      jobId: job.jobId,
      campaignId,
      meta: jobMeta,
    });

    const remoteSupervisor = openBotSupervisorCfg();
    if (remoteSupervisor) {
      try {
        if (!rec.remoteUrl) {
          await this.start(job.computerId);
        }
        const fresh = this.require(job.computerId);
        if (fresh.status === "error" || !fresh.remoteUrl) {
          job.status = "failed";
          job.detail = fresh.lastError || "OpenBot computer not ready";
          job.finishedAt = isoNow();
          this.jobs.set(job.jobId, job);
          this.audit(job.computerId, "act_failed", job.detail, "bot", {
            jobId: job.jobId,
            campaignId,
            meta: jobMeta,
          });
          return job;
        }

        if (job.kind === "login_assist") {
          this.requestHelp(job.computerId, "Login/2FA required — open Observe / Take control");
          job.status = "failed";
          job.detail = "help_requested";
          job.finishedAt = isoNow();
          this.jobs.set(job.jobId, job);
          this.audit(job.computerId, "act_failed", job.detail, "bot", {
            jobId: job.jobId,
            campaignId,
            meta: jobMeta,
          });
          return job;
        }

        if (job.kind === "linkedin_send") {
          const agent = agentCfg(fresh);
          if (!agent) {
            job.status = "failed";
            job.detail =
              "COMPUTER_TOKEN / OPENBOT_COMPUTER_TOKEN missing — cannot drive OpenBot agent-computer";
            job.finishedAt = isoNow();
            fresh.status = "error";
            fresh.lastError = job.detail;
            this.jobs.set(job.jobId, job);
            this.audit(job.computerId, "act_failed", job.detail, "bot", {
              jobId: job.jobId,
              campaignId,
              meta: jobMeta,
            });
            return job;
          }

          const profileUrl = String(job.payload.profileUrl ?? "").trim();
          const messageBody = String(
            job.payload.body ?? job.payload.messageBody ?? job.payload.text ?? "",
          ).trim();
          const subject = String(job.payload.subject ?? "").trim() || undefined;

          const preferConnect =
            job.payload.preferConnect === true ||
            job.payload.action === "connect" ||
            job.payload.mode === "connect";
          const result = await openBotLinkedInSend(agent, {
            profileUrl,
            messageBody,
            subject,
            preferConnect,
          });

          if (result.helpRequested) {
            this.requestHelp(job.computerId, result.detail);
            job.status = "failed";
            job.detail = result.detail;
            job.finishedAt = isoNow();
            this.jobs.set(job.jobId, job);
            this.audit(job.computerId, "act_failed", job.detail, "bot", {
              jobId: job.jobId,
              campaignId,
              meta: jobMeta,
            });
            return job;
          }

          job.status = result.ok ? "succeeded" : "failed";
          job.detail = result.detail;
          job.finishedAt = isoNow();
          fresh.status = result.ok ? "ready" : "error";
          if (!result.ok) fresh.lastError = result.detail;
          fresh.updatedAt = isoNow();
          this.jobs.set(job.jobId, job);
          this.audit(
            job.computerId,
            result.ok ? "act_done" : "act_failed",
            job.detail,
            "bot",
            { jobId: job.jobId, campaignId, meta: jobMeta },
          );
          return job;
        }

        if (job.kind === "warmup_nav") {
          const agent = agentCfg(fresh);
          if (!agent) {
            job.status = "failed";
            job.detail = "COMPUTER_TOKEN missing for warmup_nav";
            job.finishedAt = isoNow();
            fresh.status = "error";
            this.jobs.set(job.jobId, job);
            this.audit(job.computerId, "act_failed", job.detail, "bot", {
              jobId: job.jobId,
              campaignId,
              meta: jobMeta,
            });
            return job;
          }
          const url = String(
            job.payload.url ?? job.payload.profileUrl ?? "https://www.linkedin.com/feed/",
          );
          await openBotNavigate(agent, url);
          job.status = "succeeded";
          job.detail = `warmup navigated to ${url}`;
          job.finishedAt = isoNow();
          fresh.status = "ready";
          this.jobs.set(job.jobId, job);
          this.audit(job.computerId, "act_done", job.detail, "bot", {
            jobId: job.jobId,
            campaignId,
            meta: jobMeta,
          });
          return job;
        }

        job.status = "failed";
        job.detail = `unsupported remote job kind ${job.kind}`;
        job.finishedAt = isoNow();
        fresh.status = "error";
        this.jobs.set(job.jobId, job);
        this.audit(job.computerId, "act_failed", job.detail, "bot", {
          jobId: job.jobId,
          campaignId,
          meta: jobMeta,
        });
        return job;
      } catch (err) {
        job.status = "failed";
        job.detail = err instanceof Error ? err.message : "OpenBot remote job failed";
        job.finishedAt = isoNow();
        rec.status = "error";
        rec.lastError = job.detail;
        this.jobs.set(job.jobId, job);
        this.audit(job.computerId, "act_failed", job.detail, "bot", {
          jobId: job.jobId,
          campaignId,
          meta: jobMeta,
        });
        return job;
      }
    }

    // Local path: only mockSend may succeed. A configured URL without token must fail closed.
    if (job.kind === "login_assist") {
      this.requestHelp(job.computerId, "Login/2FA required — open Observe / Take control");
      job.status = "failed";
      job.detail = "help_requested";
      job.finishedAt = isoNow();
      this.jobs.set(job.jobId, job);
      this.audit(job.computerId, "act_failed", job.detail, "bot", {
        jobId: job.jobId,
        campaignId,
        meta: jobMeta,
      });
      return job;
    }

    if (supervisorUrl() && !openBotSupervisorCfg()) {
      job.status = "failed";
      job.detail =
        "COMPUTER_SUPERVISOR_URL is set but supervisor token is missing — refuse local fake send";
      job.finishedAt = isoNow();
      rec.status = "error";
      rec.lastError = job.detail;
      this.jobs.set(job.jobId, job);
      this.audit(job.computerId, "act_failed", job.detail, "bot", {
        jobId: job.jobId,
        campaignId,
        meta: jobMeta,
      });
      return job;
    }

    if (!supervisorMockSend()) {
      job.status = "failed";
      job.detail =
        "OpenBot supervisor is not configured. Set COMPUTER_SUPERVISOR_URL + token (or COMPUTER_SUPERVISOR_MOCK_SEND=1 for tests).";
      job.finishedAt = isoNow();
      rec.status = "error";
      rec.lastError = job.detail;
      this.jobs.set(job.jobId, job);
      this.audit(job.computerId, "act_failed", job.detail, "bot", {
        jobId: job.jobId,
        campaignId,
        meta: jobMeta,
      });
      return job;
    }

    job.status = "succeeded";
    job.detail = "mock browser-computer send accepted";
    job.finishedAt = isoNow();
    rec.status = "ready";
    rec.lastAudit = job.detail;
    rec.updatedAt = isoNow();
    this.jobs.set(job.jobId, job);
    this.audit(job.computerId, "act_done", job.detail, "bot", {
      jobId: job.jobId,
      campaignId,
      meta: jobMeta,
    });
    return job;
  }

  getJob(jobId: string): ComputerJob | undefined {
    return this.jobs.get(jobId);
  }

  recentAudits(computerId: string, limit = 20): AuditEntry[] {
    return this.audits.filter((a) => a.computerId === computerId).slice(-limit);
  }

  /** Fleet-wide recent audits (newest last). */
  recentFleetAudits(workspaceId: string, limit = 50): AuditEntry[] {
    return this.audits
      .filter((a) => !a.workspaceId || a.workspaceId === workspaceId)
      .slice(-limit);
  }

  listJobs(computerId?: string): ComputerJob[] {
    const all = [...this.jobs.values()];
    if (!computerId) return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all
      .filter((j) => j.computerId === computerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private require(computerId: string): ComputerRecord {
    const rec = this.computers.get(computerId);
    if (!rec) throw new Error("computer-not-found");
    return rec;
  }
}

/** Process-local supervisor (Fleet API + LinkedIn browser-computer adapter). */
export const defaultComputerSupervisor = new ComputerSupervisor();
