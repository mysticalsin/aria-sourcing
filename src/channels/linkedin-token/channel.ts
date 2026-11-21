/// <reference path="./node-sqlite.d.ts" />
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { approvalHash } from "@/lib/outreach-content";
import { decryptToken, encryptToken, type Env } from "./crypto";
import { RISK_NOTICE } from "./notice";
import {
  buildSendMessageRequest,
  classifyAnswer,
  sendSlot,
  type AnswerKind,
} from "./ported";

export type { Env };

const SELF_MEMBER = "ACoAASyntheticSelf01";
const DAY_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 120_000;

export class RedactedToken {
  constructor(private readonly value: string) {}

  reveal(): string {
    return this.value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }
}

export interface MailMessage {
  model: string;
  res_id: number;
  message_type: string;
  subtype_xmlid: string;
  subject: string;
  body: string;
  date: string;
  email_from: string;
  record_name: string;
  is_internal: boolean;
}

export interface Auditor {
  postChatter(msg: MailMessage): Promise<void>;
}

export interface TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  attempt: number;
}

export interface TransportResult {
  status: number;
  body: string;
  finalUrl?: string | null;
  error?: string | null;
  timeout?: boolean;
}

export interface Transport {
  deliver(request: TransportRequest): Promise<TransportResult>;
}

export interface ActionResult {
  ok: boolean;
  reason: string;
  infrastructure?: boolean;
}

export interface ApprovalInput {
  workspaceId: string;
  nonce: string;
  recipient: string;
  subject: string;
  body: string;
  mode: "manual" | "auto";
  qcPass: boolean;
  autoOptIn: boolean;
  senderId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SendInput extends ApprovalInput {
  actorId: string;
  hold?: boolean;
  fakeStatus?: number;
  challenge?: boolean;
  delayMs?: number;
}

export interface WorkspaceView {
  enabled: boolean;
  acknowledgement: string | null;
  tokenStored: boolean;
  paused: boolean;
  pauseReason: string | null;
  queue: { id: string; state: string }[];
  killSwitch: boolean;
  audit: { action: string; at: string }[];
  e2e: boolean;
}

interface StoredApproval extends ApprovalInput {
  binding: string;
  consumed: boolean;
}

interface QueueRow {
  id: string;
  state: string;
  nonce: string;
  recipient: string;
  subject: string;
  body: string;
  senderId: string;
}

interface Memory {
  enabled: boolean;
  acknowledgement: string | null;
  acknowledgedBy: string | null;
  tokenCiphertext: string | null;
  paused: boolean;
  pauseReason: string | null;
  recentSends: number[];
  approvals: StoredApproval[];
  queue: QueueRow[];
  audit: { action: string; at: string }[];
}

interface Waiter {
  id: string;
  input: SendInput;
  resolve: (result: ActionResult) => void;
}

export interface ChannelOptions {
  env: Env;
  auditor: Auditor;
  transport?: Transport;
  clock?: { now(): number };
  logger?: (line: string) => void;
  fetchImpl?: typeof fetch;
  dbPath?: string;
}

function blank(): Memory {
  return {
    enabled: false,
    acknowledgement: null,
    acknowledgedBy: null,
    tokenCiphertext: null,
    paused: false,
    pauseReason: null,
    recentSends: [],
    approvals: [],
    queue: [],
    audit: [],
  };
}

function bindingOf(input: ApprovalInput): string {
  return [
    "linkedin-token",
    input.recipient,
    input.subject,
    approvalHash(input.subject, input.body),
    input.mode,
    input.qcPass ? "1" : "0",
    input.autoOptIn ? "1" : "0",
    input.senderId,
  ].join("\n");
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function killEngaged(env: Env): boolean {
  const value = env.lookup("ARIA_SEND_KILL_SWITCH");
  if (value === undefined) return false;
  switch (value.trim().toLowerCase()) {
    case "0":
    case "false":
    case "off":
    case "":
      return false;
    default:
      return true;
  }
}

function intEnv(env: Env, key: string, fallback: number): number {
  const raw = env.lookup(key);
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function loopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function trackingId(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url").slice(0, 16);
}

export class LinkedInTokenChannel {
  private readonly env: Env;
  private readonly auditor: Auditor;
  private readonly transport?: Transport;
  private readonly clock: { now(): number };
  private readonly logger?: (line: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly db: DatabaseSync | null;
  private readonly workspaces = new Map<string, Memory>();
  private readonly secrets = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private flight: AbortController | null = null;
  private flightWorkspace: string | null = null;
  private waiters: Waiter[] = [];

  constructor(options: ChannelOptions) {
    this.env = options.env;
    this.auditor = options.auditor;
    this.transport = options.transport;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.db = options.dbPath ? new DatabaseSync(options.dbPath) : null;
    if (this.db) {
      this.db.exec(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE IF NOT EXISTS linkedin_token_workspace (
          workspace_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          acknowledgement TEXT,
          acknowledged_by TEXT,
          acknowledged_at TEXT,
          token_ciphertext TEXT,
          paused INTEGER NOT NULL DEFAULT 0,
          pause_reason TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS linkedin_token_queue (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          status TEXT NOT NULL,
          recipient TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          nonce TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS linkedin_token_audit (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          action TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    }
  }

  view(workspaceId: string): WorkspaceView {
    const state = this.memory(workspaceId);
    return {
      enabled: state.enabled,
      acknowledgement: state.acknowledgement,
      tokenStored: Boolean(state.tokenCiphertext),
      paused: state.paused,
      pauseReason: state.pauseReason,
      queue: state.queue.map((item) => ({ id: item.id, state: item.state })),
      killSwitch: killEngaged(this.env),
      audit: state.audit,
      e2e: this.env.lookup("ARIA_E2E") === "1",
    };
  }

  async enable(input: { workspaceId: string; role: string; actorId: string; acknowledgement: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (input.role !== "admin" && input.role !== "owner") {
        await this.audit(input.workspaceId, "refusal", "role");
        return { ok: false, reason: "role" };
      }
      if (input.acknowledgement !== RISK_NOTICE) {
        await this.audit(input.workspaceId, "refusal", "acknowledgement");
        return { ok: false, reason: "acknowledgement" };
      }
      const state = this.memory(input.workspaceId);
      state.enabled = true;
      state.acknowledgement = input.acknowledgement;
      state.acknowledgedBy = input.actorId;
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "enable", input.acknowledgement);
      return { ok: true, reason: "" };
    });
  }

  async disable(input: { workspaceId: string; role: string; actorId: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (input.role !== "admin" && input.role !== "owner") {
        await this.audit(input.workspaceId, "refusal", "role");
        return { ok: false, reason: "role" };
      }
      return this.purgeLocked(input.workspaceId, "disable");
    });
  }

  async applyKillSwitch(input: { workspaceId: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!killEngaged(this.env)) return { ok: true, reason: "" };
      await this.audit(input.workspaceId, "refusal", "kill-switch");
      this.cancelOutstanding(input.workspaceId, "cancelled");
      return { ok: true, reason: "kill-switch" };
    });
  }

  async putToken(input: { workspaceId: string; role: string; actorId: string; token: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      const state = this.memory(input.workspaceId);
      if (!state.enabled) {
        await this.audit(input.workspaceId, "refusal", "disabled");
        return { ok: false, reason: "disabled" };
      }
      if (!input.token) return { ok: false, reason: "no-token" };
      this.secrets.add(input.token);
      state.tokenCiphertext = encryptToken(input.token, this.env);
      this.persist(input.workspaceId);
      return { ok: true, reason: "" };
    });
  }

  async revoke(input: { workspaceId: string; role: string; actorId: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      const state = this.memory(input.workspaceId);
      state.tokenCiphertext = null;
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "purge", "revoke");
      return { ok: true, reason: "" };
    });
  }

  async approve(input: ApprovalInput): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (input.expiresAt <= input.issuedAt || input.expiresAt - input.issuedAt > DAY_MS) {
        return { ok: false, reason: "approval-lifetime" };
      }
      if (input.issuedAt > this.clock.now() + SKEW_MS) return { ok: false, reason: "approval-lifetime" };
      if (input.mode === "auto" && (!input.qcPass || !input.autoOptIn)) return { ok: false, reason: "qc-required" };
      const state = this.memory(input.workspaceId);
      state.approvals = state.approvals.filter((item) => item.nonce !== input.nonce);
      state.approvals.push({ ...input, binding: bindingOf(input), consumed: false });
      return { ok: true, reason: "" };
    });
  }

  async send(input: SendInput): Promise<ActionResult> {
    return this.dispatch(input);
  }

  async enqueue(input: SendInput): Promise<ActionResult> {
    if (this.flight) {
      const id = randomBytes(8).toString("hex");
      return new Promise((resolve) => {
        this.waiters.push({ id, input, resolve });
        const state = this.memory(input.workspaceId);
        state.queue.push({
          id,
          state: "queued",
          nonce: input.nonce,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
          senderId: input.senderId,
        });
        this.persist(input.workspaceId);
      });
    }
    return this.dispatch(input);
  }

  async reset(workspaceId: string): Promise<void> {
    return this.exclusive(async () => {
      this.flight?.abort();
      this.flight = null;
      for (const waiter of this.waiters) waiter.resolve({ ok: false, reason: "cancelled" });
      this.waiters = [];
      this.workspaces.set(workspaceId, blank());
      if (this.db) {
        this.db.prepare("delete from linkedin_token_queue where workspace_id = ?").run(workspaceId);
        this.db.prepare("delete from linkedin_token_workspace where workspace_id = ?").run(workspaceId);
        this.db.prepare("delete from linkedin_token_audit where workspace_id = ?").run(workspaceId);
      }
    });
  }

  private async dispatch(input: SendInput): Promise<ActionResult> {
    const controller = new AbortController();
    const gate = await this.exclusive(() => this.precheck(input, controller));
    if (!gate.ok) return gate;
    try {
      const delivered = await this.deliver(input, controller);
      return await this.exclusive(() => this.finish(input, controller, delivered));
    } catch (err) {
      return await this.exclusive(() => this.finishThrown(input, controller, err));
    } finally {
      await this.exclusive(() => {
        if (this.flight === controller) {
          this.flight = null;
          this.flightWorkspace = null;
        }
      });
    }
  }

  private async precheck(input: SendInput, controller: AbortController): Promise<ActionResult> {
    const state = this.memory(input.workspaceId);
    const refuse = async (reason: string): Promise<ActionResult> => {
      await this.audit(input.workspaceId, "refusal", reason);
      return { ok: false, reason };
    };
    if (!state.enabled) return refuse("disabled");
    if (killEngaged(this.env)) return refuse("kill-switch");
    if (state.paused) return refuse("sender-paused");
    if (!state.tokenCiphertext) return refuse("no-token");
    let token = "";
    try {
      token = decryptToken(state.tokenCiphertext, this.env);
    } catch {
      return refuse("no-token");
    }
    this.secrets.add(token);
    const stored = state.approvals.find((item) => item.nonce === input.nonce);
    if (!stored) return refuse("approval-token");
    if (stored.consumed) return refuse("token-used");
    if (!same(stored.binding, bindingOf(input))) return refuse("binding-mismatch");
    const now = this.clock.now();
    if (now >= stored.expiresAt || stored.issuedAt > now + SKEW_MS) return refuse("approval-expired");
    const destination = this.destination();
    if (!destination.ok) return refuse(destination.reason);
    const slot = sendSlot({
      now,
      recentSends: state.recentSends,
      dailySendCap: intEnv(this.env, "ARIA_LINKEDIN_TOKEN_DAILY_CAP", 40),
      minSendIntervalMs: intEnv(this.env, "ARIA_LINKEDIN_TOKEN_MIN_GAP_MS", 90_000),
    });
    if (!slot.allowed) return refuse(slot.reason === "daily_cap" ? "daily-cap" : "pacing");
    stored.consumed = true;
    state.recentSends.push(now);
    this.flight = controller;
    this.flightWorkspace = input.workspaceId;
    const row = state.queue.find((item) => item.nonce === input.nonce);
    if (row) row.state = "sending";
    else {
      state.queue.push({
        id: randomBytes(8).toString("hex"),
        state: "sending",
        nonce: input.nonce,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        senderId: input.senderId,
      });
    }
    this.persist(input.workspaceId);
    return { ok: true, reason: "" };
  }

  private async deliver(input: SendInput, controller: AbortController): Promise<TransportResult> {
    const destination = this.destination();
    if (!destination.ok) return { status: 0, body: "", error: "config" };
    const state = this.memory(input.workspaceId);
    const token = decryptToken(state.tokenCiphertext ?? "", this.env);
    const spec = buildSendMessageRequest({
      selfMemberId: SELF_MEMBER,
      text: input.body,
      recipientMemberId: input.recipient,
      originToken: input.nonce,
      trackingId: trackingId(input.nonce),
    });
    const headers: Record<string, string> = { ...spec.headers, "csrf-token": token };
    headers.cookie = `li_at=${token}`;
    if (this.env.lookup("ARIA_E2E") === "1") {
      if (input.hold) headers["x-aria-hold"] = "1";
      if (input.fakeStatus) headers["x-aria-fake-status"] = String(input.fakeStatus);
      if (input.challenge) headers["x-aria-challenge"] = "1";
      if (input.delayMs) headers["x-aria-delay"] = String(input.delayMs);
    }
    const requestBase = {
      url: destination.url + spec.path,
      method: spec.method,
      headers,
      body: spec.body,
      signal: controller.signal,
    };
    const attempts = input.hold ? 1 : 2;
    const timeoutMs = input.hold ? 120_000 : intEnv(this.env, "ARIA_LINKEDIN_TOKEN_TIMEOUT_MS", 10_000);
    let last: TransportResult = { status: 0, body: "", timeout: true, error: "timeout" };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (controller.signal.aborted || killEngaged(this.env)) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      last = this.transport
        ? await this.transport.deliver({ ...requestBase, attempt })
        : await this.fetchOnce({ ...requestBase, attempt }, timeoutMs);
      if (last.timeout && attempt === 0 && attempts > 1) continue;
      return last;
    }
    return last;
  }

  private async fetchOnce(request: TransportRequest, timeoutMs: number): Promise<TransportResult> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
        redirect: "manual",
      });
      const body = await response.text();
      return { status: response.status, body: this.scrub(body), finalUrl: response.url };
    } catch (err) {
      if (request.signal.aborted) throw err;
      if (timeout.aborted) return { status: 0, body: "", timeout: true, error: "timeout" };
      return { status: 0, body: "", error: "transport" };
    }
  }

  private async finish(input: SendInput, controller: AbortController, delivered: TransportResult): Promise<ActionResult> {
    const state = this.memory(input.workspaceId);
    if (controller.signal.aborted || !state.enabled || killEngaged(this.env)) {
      this.rollback(input);
      this.markQueue(input, "cancelled");
      await this.audit(input.workspaceId, "refusal", "cancelled");
      return { ok: false, reason: "cancelled" };
    }
    if (delivered.timeout) {
      this.rollback(input);
      this.markQueue(input, "failed");
      await this.audit(input.workspaceId, "refusal", "infrastructure-timeout");
      return { ok: false, reason: "infrastructure-timeout", infrastructure: true };
    }
    const kind: AnswerKind = classifyAnswer(delivered);
    if (kind === "throttled" || kind === "challenge" || kind === "session" || kind === "warning") {
      this.rollback(input);
      state.paused = true;
      state.pauseReason = kind === "throttled" ? "throttled" : kind;
      if (kind === "challenge") state.pauseReason = "challenge";
      this.markQueue(input, "cancelled");
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "pause", state.pauseReason);
      await this.audit(input.workspaceId, "refusal", "sender-paused");
      return { ok: false, reason: "sender-paused" };
    }
    if (kind !== "ok") {
      this.rollback(input);
      this.markQueue(input, "failed");
      await this.audit(input.workspaceId, "refusal", "delivery");
      return { ok: false, reason: "delivery" };
    }
    this.markQueue(input, "sent");
    this.persist(input.workspaceId);
    await this.audit(input.workspaceId, "send", input.nonce);
    return { ok: true, reason: "" };
  }

  private async finishThrown(input: SendInput, controller: AbortController, err: unknown): Promise<ActionResult> {
    this.rollback(input);
    this.markQueue(input, "cancelled");
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    const reason = aborted || killEngaged(this.env) || !this.memory(input.workspaceId).enabled ? "cancelled" : "delivery";
    await this.audit(input.workspaceId, "refusal", reason);
    this.log("send ended");
    return { ok: false, reason };
  }

  private rollback(input: SendInput): void {
    const state = this.memory(input.workspaceId);
    state.recentSends.pop();
    this.persist(input.workspaceId);
  }

  private markQueue(input: SendInput, status: string): void {
    const state = this.memory(input.workspaceId);
    const row = [...state.queue].reverse().find((item) => item.nonce === input.nonce && item.state !== "cancelled");
    if (row) row.state = status;
    this.persist(input.workspaceId);
  }

  private async purgeLocked(workspaceId: string, action: string): Promise<ActionResult> {
    const state = this.memory(workspaceId);
    state.enabled = false;
    state.tokenCiphertext = null;
    state.paused = false;
    state.pauseReason = null;
    this.persist(workspaceId);
    await this.audit(workspaceId, action, action);
    await this.audit(workspaceId, "purge", "flag-off");
    this.cancelOutstanding(workspaceId, "cancelled");
    return { ok: true, reason: "" };
  }

  private cancelOutstanding(workspaceId: string, reason: string): void {
    if (this.flight && this.flightWorkspace === workspaceId) this.flight.abort();
    const state = this.memory(workspaceId);
    for (const row of state.queue) {
      if (row.state === "queued" || row.state === "sending") row.state = "cancelled";
    }
    const waiting = this.waiters.filter((waiter) => waiter.input.workspaceId === workspaceId);
    this.waiters = this.waiters.filter((waiter) => waiter.input.workspaceId !== workspaceId);
    for (const waiter of waiting) {
      const approval = state.approvals.find((item) => item.nonce === waiter.input.nonce);
      if (approval) approval.consumed = true;
      waiter.resolve({ ok: false, reason });
    }
    this.persist(workspaceId);
    if (waiting.length) void this.audit(workspaceId, "refusal", reason);
  }

  private destination(): { ok: true; url: string } | { ok: false; reason: string } {
    const raw = (this.env.lookup("ARIA_LINKEDIN_TOKEN_BASE_URL") ?? "").trim();
    if (!raw) return { ok: false, reason: "config" };
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, reason: "config" };
    }
    const remote = this.env.lookup("ARIA_LINKEDIN_TOKEN_REMOTE") === "on";
    if (!remote && !loopback(parsed.hostname)) return { ok: false, reason: "config" };
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "config" };
    return { ok: true, url: parsed.origin };
  }

  private memory(workspaceId: string): Memory {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      state = blank();
      this.workspaces.set(workspaceId, state);
      this.hydrate(workspaceId, state);
    }
    return state;
  }

  private hydrate(workspaceId: string, state: Memory): void {
    if (!this.db) return;
    const row = this.db
      .prepare(
        "select enabled, acknowledgement, acknowledged_by, token_ciphertext, paused, pause_reason from linkedin_token_workspace where workspace_id = ?",
      )
      .get(workspaceId) as
      | {
          enabled: number;
          acknowledgement: string | null;
          acknowledged_by: string | null;
          token_ciphertext: string | null;
          paused: number;
          pause_reason: string | null;
        }
      | undefined;
    if (!row) return;
    state.enabled = row.enabled === 1;
    state.acknowledgement = row.acknowledgement;
    state.acknowledgedBy = row.acknowledged_by;
    state.tokenCiphertext = row.token_ciphertext;
    state.paused = row.paused === 1;
    state.pauseReason = row.pause_reason;
    const queued = this.db
      .prepare("select id, status, recipient, subject, body, nonce, sender_id from linkedin_token_queue where workspace_id = ?")
      .all(workspaceId) as {
      id: string;
      status: string;
      recipient: string;
      subject: string;
      body: string;
      nonce: string;
      sender_id: string;
    }[];
    state.queue = queued.map((item) => ({
      id: item.id,
      state: item.status,
      recipient: item.recipient,
      subject: item.subject,
      body: item.body,
      nonce: item.nonce,
      senderId: item.sender_id,
    }));
  }

  private persist(workspaceId: string): void {
    if (!this.db) return;
    const state = this.memory(workspaceId);
    const now = new Date(this.clock.now()).toISOString();
    this.db
      .prepare(
        `insert into linkedin_token_workspace
          (workspace_id, enabled, acknowledgement, acknowledged_by, acknowledged_at, token_ciphertext, paused, pause_reason, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(workspace_id) do update set
          enabled = excluded.enabled,
          acknowledgement = excluded.acknowledgement,
          acknowledged_by = excluded.acknowledged_by,
          acknowledged_at = excluded.acknowledged_at,
          token_ciphertext = excluded.token_ciphertext,
          paused = excluded.paused,
          pause_reason = excluded.pause_reason,
          updated_at = excluded.updated_at`,
      )
      .run(
        workspaceId,
        state.enabled ? 1 : 0,
        state.acknowledgement,
        state.acknowledgedBy,
        state.acknowledgement ? now : null,
        state.tokenCiphertext,
        state.paused ? 1 : 0,
        state.pauseReason,
        now,
      );
    this.db.prepare("delete from linkedin_token_queue where workspace_id = ?").run(workspaceId);
    const insert = this.db.prepare(
      "insert into linkedin_token_queue (id, workspace_id, status, recipient, subject, body, nonce, sender_id, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of state.queue) {
      insert.run(row.id, workspaceId, row.state, row.recipient, row.subject, row.body, row.nonce, row.senderId, now);
    }
  }

  private async audit(workspaceId: string, action: string, detail: string): Promise<void> {
    const state = this.memory(workspaceId);
    const at = new Date(this.clock.now()).toISOString();
    state.audit.push({ action, at });
    const safeDetail = this.scrub(detail);
    const line = `channel=linkedin-token action=${action} detail=${safeDetail}`;
    const message: MailMessage = {
      model: "aria.campaign",
      res_id: 0,
      message_type: "notification",
      subtype_xmlid: "mail.mt_note",
      subject: `Outreach ${action}`,
      body: `<p>${escapeHtml(line)}</p>`,
      date: at,
      email_from: "ARIA <aria@localhost>",
      record_name: workspaceId,
      is_internal: true,
    };
    if (this.db) {
      this.db
        .prepare("insert into linkedin_token_audit (id, workspace_id, action, body, created_at) values (?, ?, ?, ?, ?)")
        .run(randomBytes(8).toString("hex"), workspaceId, action, this.scrub(message.body), at);
    }
    this.log(line);
    await this.auditor.postChatter(message);
  }

  private scrub(value: string): string {
    let next = value;
    for (const secret of this.secrets) {
      if (secret) next = next.split(secret).join("[redacted]");
    }
    return next;
  }

  private log(line: string): void {
    this.logger?.(this.scrub(line));
  }

  private async exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
