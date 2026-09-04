/**
 * OpenBot-inspired computer supervisor (in-process MVP).
 * One Chromium computer per LinkedIn seat — spawn/stop/reset, decide→audit→act,
 * human takeover mutex (bot actions refuse while operator has control).
 *
 * Real browser spawn is behind COMPUTER_SUPERVISOR_URL when set; otherwise jobs
 * queue locally for the browser-computer LinkedIn adapter / Fleet UI.
 */

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

function isoNow() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ComputerSupervisor {
  private computers = new Map<string, ComputerRecord>();
  private jobs = new Map<string, ComputerJob>();
  private audits: AuditEntry[] = [];
  private readonly maxAudits = 500;

  private audit(computerId: string, action: string, detail: string, actor: AuditEntry["actor"] = "system") {
    this.audits.push({ at: isoNow(), computerId, action, detail, actor });
    if (this.audits.length > this.maxAudits) this.audits.splice(0, this.audits.length - this.maxAudits);
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
    const computerId = opts.computerId ?? id("comp");
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
    this.audit(computerId, "start", "Booting isolated Chromium profile", "system");
    // Remote supervisor optional — local MVP flips to ready.
    const remote = process.env.COMPUTER_SUPERVISOR_URL?.trim();
    if (remote) {
      try {
        const res = await fetch(`${remote.replace(/\/$/, "")}/computers/${computerId}/start`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.COMPUTER_SUPERVISOR_TOKEN ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ seatId: rec.seatId, profileVolume: rec.profileVolume }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          rec.status = "error";
          rec.lastError = `remote start ${res.status}`;
          rec.updatedAt = isoNow();
          this.audit(computerId, "start_failed", rec.lastError, "system");
          return rec;
        }
      } catch (err) {
        rec.status = "error";
        rec.lastError = err instanceof Error ? err.message : "remote start failed";
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
    rec.status = "stopped";
    rec.control = "bot";
    rec.updatedAt = isoNow();
    this.audit(computerId, "stop", "Computer stopped", "system");
    return rec;
  }

  async reset(computerId: string): Promise<ComputerRecord> {
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
    return rec;
  }

  releaseControl(computerId: string): ComputerRecord {
    const rec = this.require(computerId);
    rec.control = "bot";
    rec.updatedAt = isoNow();
    rec.lastAudit = "control_released";
    this.audit(computerId, "release", "Operator released control — bot may act", "human");
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
    const jobId = id("job");
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
      if (rec.status === "stopped") await this.start(opts.computerId);
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

    const remote = process.env.COMPUTER_SUPERVISOR_URL?.trim();
    if (remote) {
      try {
        const res = await fetch(`${remote.replace(/\/$/, "")}/computers/${job.computerId}/jobs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.COMPUTER_SUPERVISOR_TOKEN ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(job),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          job.status = "failed";
          job.detail = `remote job ${res.status}`;
          job.finishedAt = isoNow();
          rec.status = "error";
          rec.lastError = job.detail;
          this.jobs.set(job.jobId, job);
          return job;
        }
        const data = (await res.json().catch(() => ({}))) as { detail?: string; status?: string };
        job.status = data.status === "failed" ? "failed" : "succeeded";
        job.detail = data.detail ?? "remote ok";
        job.finishedAt = isoNow();
        rec.status = job.status === "succeeded" ? "ready" : "error";
        this.jobs.set(job.jobId, job);
        this.audit(job.computerId, "act_done", job.detail, "bot");
        return job;
      } catch (err) {
        job.status = "failed";
        job.detail = err instanceof Error ? err.message : "remote job failed";
        job.finishedAt = isoNow();
        rec.status = "error";
        rec.lastError = job.detail;
        this.jobs.set(job.jobId, job);
        return job;
      }
    }

    // Local MVP: accept the job as a durable enqueue signal (adapter records outcome).
    // Login/2FA raises help_requested instead of pretending a send completed.
    if (job.kind === "login_assist") {
      this.requestHelp(job.computerId, "Login/2FA required — open Observe / Take control");
      job.status = "failed";
      job.detail = "help_requested";
      job.finishedAt = isoNow();
      this.jobs.set(job.jobId, job);
      return job;
    }

    job.status = "succeeded";
    job.detail =
      process.env.COMPUTER_SUPERVISOR_MOCK_SEND === "1"
        ? "mock browser-computer send accepted"
        : "queued on local computer supervisor (set COMPUTER_SUPERVISOR_URL for live Chromium)";
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
