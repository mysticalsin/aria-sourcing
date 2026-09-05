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
  openBotTakeControl,
  type OpenBotAgentComputerConfig,
} from "@/lib/openbot/agent-computer-client";
import { openBotLinkedInSend } from "@/lib/openbot/linkedin-send";
import {
  openBotEnsureComputer,
  openBotResetComputer,
  openBotStopComputer,
  type OpenBotSupervisorConfig,
} from "@/lib/openbot/supervisor-client";

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
};

export type ComputerSupervisorEndpoint = {
  url?: string | null;
  token?: string | null;
  /** Agent-computer COMPUTER_TOKEN (defaults to OPENBOT_COMPUTER_TOKEN / COMPUTER_TOKEN / supervisor token). */
  computerToken?: string | null;
  mockSend?: boolean | null;
};

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
  if (endpointOverride?.mockSend === true) return true;
  if (endpointOverride?.mockSend === false) return false;
  return process.env.COMPUTER_SUPERVISOR_MOCK_SEND === "1";
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
  private readonly maxAudits = 500;

  private audit(
    computerId: string,
    action: string,
    detail: string,
    actor: AuditEntry["actor"] = "system",
  ) {
    this.audits.push({ at: isoNow(), computerId, action, detail, actor });
    if (this.audits.length > this.maxAudits) {
      this.audits.splice(0, this.audits.length - this.maxAudits);
    }
  }

  ensureComputer(opts: {
    workspaceId: string;
    seatId: string;
    computerId?: string;
  }): ComputerRecord {
    const existing = [...this.computers.values()].find(
      (c) => c.workspaceId === opts.workspaceId && c.seatId === opts.seatId,
    );
    if (existing) return existing;
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
    };
    this.computers.set(computerId, rec);
    this.audit(computerId, "ensure", `Seat ${opts.seatId} computer registered`);
    return rec;
  }

  list(workspaceId: string): ComputerRecord[] {
    return [...this.computers.values()].filter((c) => c.workspaceId === workspaceId);
  }

  get(computerId: string): ComputerRecord | undefined {
    return this.computers.get(computerId);
  }

  async start(computerId: string): Promise<ComputerRecord> {
    const rec = this.computers.get(computerId);
    if (!rec) throw new Error("computer-not-found");
    rec.status = "starting";
    rec.updatedAt = isoNow();
    this.audit(computerId, "start", "Booting isolated Chromium via OpenBot ensure", "system");

    const cfg = openBotSupervisorCfg();
    if (cfg) {
      try {
        const state = await openBotEnsureComputer(cfg, rec.botId || computerId);
        rec.botId = state.botId || rec.botId || toOpenBotBotId(computerId);
        rec.remoteUrl =
          state.url ?? (state.port ? `http://127.0.0.1:${state.port}` : rec.remoteUrl);
        if (!rec.remoteUrl) {
          rec.status = "error";
          rec.lastError =
            "OpenBot ensure returned no computer URL/port — check published ports / COMPUTER_NETWORK";
          rec.updatedAt = isoNow();
          this.audit(computerId, "start_failed", rec.lastError, "system");
          return rec;
        }
      } catch (err) {
        rec.status = "error";
        rec.lastError = err instanceof Error ? err.message : "OpenBot ensure failed";
        rec.updatedAt = isoNow();
        this.audit(computerId, "start_failed", rec.lastError, "system");
        return rec;
      }
    }

    rec.status = "ready";
    rec.lastError = null;
    rec.updatedAt = isoNow();
    rec.lastAudit = "ready";
    this.audit(computerId, "ready", "Computer ready for bot actions", "system");
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
    await this.stop(computerId);
    return this.start(computerId);
  }

  /** Human opens observe/takeover — bot actions refuse until release. */
  takeControl(computerId: string): ComputerRecord {
    const rec = this.require(computerId);
    rec.control = "human";
    rec.updatedAt = isoNow();
    rec.lastAudit = "human_takeover";
    this.audit(computerId, "takeover", "Operator took control — bot mutex held", "human");
    const agent = agentCfg(rec);
    if (agent) {
      void openBotTakeControl(agent).catch((err) => {
        this.audit(
          computerId,
          "takeover_remote_failed",
          err instanceof Error ? err.message : "remote take failed",
          "system",
        );
      });
    }
    return rec;
  }

  releaseControl(computerId: string): ComputerRecord {
    const rec = this.require(computerId);
    rec.control = "bot";
    rec.updatedAt = isoNow();
    rec.lastAudit = "control_released";
    this.audit(computerId, "release", "Operator released control — bot may act", "human");
    const agent = agentCfg(rec);
    if (agent) {
      void openBotReleaseControl(agent).catch((err) => {
        this.audit(
          computerId,
          "release_remote_failed",
          err instanceof Error ? err.message : "remote release failed",
          "system",
        );
      });
    }
    return rec;
  }

  requestHelp(computerId: string, detail: string): ComputerRecord {
    const rec = this.require(computerId);
    rec.status = "help_requested";
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
      this.audit(opts.computerId, "act_refused", `Job ${opts.kind} refused — human mutex`, "bot");
      return job;
    }

    if (rec.status !== "ready" && rec.status !== "busy") {
      if (rec.status === "stopped" || rec.status === "error") {
        await this.start(opts.computerId);
      }
    }

    this.jobs.set(jobId, job);
    this.audit(opts.computerId, "decide", `Accepted job ${opts.kind}`, "bot");
    return this.runJob(job);
  }

  private async runJob(job: ComputerJob): Promise<ComputerJob> {
    const rec = this.require(job.computerId);
    if (rec.control === "human") {
      job.status = "refused";
      job.detail = "human-has-control";
      job.finishedAt = isoNow();
      this.jobs.set(job.jobId, job);
      return job;
    }

    rec.status = "busy";
    job.status = "running";
    this.jobs.set(job.jobId, job);
    this.audit(job.computerId, "act", `Running ${job.kind}`, "bot");

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
          return job;
        }

        if (job.kind === "login_assist") {
          this.requestHelp(job.computerId, "Login/2FA required — open Observe / Take control");
          job.status = "failed";
          job.detail = "help_requested";
          job.finishedAt = isoNow();
          this.jobs.set(job.jobId, job);
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
            return job;
          }

          const profileUrl = String(job.payload.profileUrl ?? "").trim();
          const messageBody = String(
            job.payload.body ?? job.payload.messageBody ?? job.payload.text ?? "",
          ).trim();
          const subject = String(job.payload.subject ?? "").trim() || undefined;

          const result = await openBotLinkedInSend(agent, {
            profileUrl,
            messageBody,
            subject,
          });

          if (result.helpRequested) {
            this.requestHelp(job.computerId, result.detail);
            job.status = "failed";
            job.detail = result.detail;
            job.finishedAt = isoNow();
            this.jobs.set(job.jobId, job);
            return job;
          }

          job.status = result.ok ? "succeeded" : "failed";
          job.detail = result.detail;
          job.finishedAt = isoNow();
          fresh.status = result.ok ? "ready" : "error";
          if (!result.ok) fresh.lastError = result.detail;
          fresh.updatedAt = isoNow();
          this.jobs.set(job.jobId, job);
          this.audit(job.computerId, "act_done", job.detail, "bot");
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
          this.audit(job.computerId, "act_done", job.detail, "bot");
          return job;
        }

        job.status = "failed";
        job.detail = `unsupported remote job kind ${job.kind}`;
        job.finishedAt = isoNow();
        fresh.status = "error";
        this.jobs.set(job.jobId, job);
        return job;
      } catch (err) {
        job.status = "failed";
        job.detail = err instanceof Error ? err.message : "OpenBot remote job failed";
        job.finishedAt = isoNow();
        rec.status = "error";
        rec.lastError = job.detail;
        this.jobs.set(job.jobId, job);
        return job;
      }
    }

    // Local MVP: durable enqueue signal (adapter records outcome).
    if (job.kind === "login_assist") {
      this.requestHelp(job.computerId, "Login/2FA required — open Observe / Take control");
      job.status = "failed";
      job.detail = "help_requested";
      job.finishedAt = isoNow();
      this.jobs.set(job.jobId, job);
      return job;
    }

    job.status = "succeeded";
    job.detail = supervisorMockSend()
      ? "mock browser-computer send accepted"
      : "queued on local computer supervisor (set COMPUTER_SUPERVISOR_URL for live OpenBot Chromium)";
    job.finishedAt = isoNow();
    rec.status = "ready";
    rec.lastAudit = job.detail;
    rec.updatedAt = isoNow();
    this.jobs.set(job.jobId, job);
    this.audit(job.computerId, "act_done", job.detail, "bot");
    return job;
  }

  getJob(jobId: string): ComputerJob | undefined {
    return this.jobs.get(jobId);
  }

  recentAudits(computerId: string, limit = 20): AuditEntry[] {
    return this.audits.filter((a) => a.computerId === computerId).slice(-limit);
  }

  private require(computerId: string): ComputerRecord {
    const rec = this.computers.get(computerId);
    if (!rec) throw new Error("computer-not-found");
    return rec;
  }
}

/** Process-local supervisor (Fleet API + LinkedIn browser-computer adapter). */
export const defaultComputerSupervisor = new ComputerSupervisor();
