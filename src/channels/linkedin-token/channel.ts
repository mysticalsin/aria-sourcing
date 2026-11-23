/// <reference path="./node-sqlite.d.ts" />
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { OutgoingHttpHeaders } from "node:http";
import https from "node:https";
import { DatabaseSync } from "node:sqlite";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";

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
const PINNED_HOST = "www.linkedin.com";
const MAX_QUEUE = 20;
const MAX_BODY = 4_000;
const MAX_SUBJECT = 300;
const MAX_NONCE = 80;
const MAX_AUDIT = 200;
const RECIPIENT_PATTERN = /^ACoAA[A-Za-z0-9_-]{4,64}$/;

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

export type HostResolver = (host: string) => Promise<string[]>;

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
  sentAt?: number;
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
  killed: boolean;
  approvalTtlMs?: number;
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
  resolver?: HostResolver;
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
    killed: false,
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

function testBuild(env: Env): boolean {
  return env.lookup("NODE_ENV") === "test" && env.lookup("ARIA_LINKEDIN_TOKEN_TEST_SESSION") === "1";
}

function ipv4Parts(host: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function blockedIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10 || a === 0 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function blockedIpv6(host: string): boolean {
  const value = host.toLowerCase();
  if (value === "::1") return false;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  return true;
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
  private readonly resolver: HostResolver;
  private tail: Promise<void> = Promise.resolve();
  private readonly flights = new Map<string, Set<AbortController>>();
  private waiters: Waiter[] = [];

  constructor(options: ChannelOptions) {
    this.env = options.env;
    this.auditor = options.auditor;
    this.transport = options.transport;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetchPinned;
    this.resolver = options.resolver ?? defaultResolver;
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
          killed INTEGER NOT NULL DEFAULT 0,
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
          sent_at TEXT,
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
      ensureColumn(this.db, "linkedin_token_workspace", "killed", "alter table linkedin_token_workspace add column killed integer not null default 0");
      ensureColumn(this.db, "linkedin_token_queue", "sent_at", "alter table linkedin_token_queue add column sent_at text");
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
      killSwitch: killEngaged(this.env) || state.killed,
      audit: state.audit,
      e2e: testBuild(this.env),
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

  async engageKill(input: { workspaceId: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      const state = this.memory(input.workspaceId);
      state.killed = true;
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "refusal", "kill-switch");
      this.cancelOutstanding(input.workspaceId, "cancelled");
      return { ok: true, reason: "kill-switch" };
    });
  }

  async setApprovalTtl(workspaceId: string, ttlMs: number): Promise<void> {
    return this.exclusive(async () => {
      this.memory(workspaceId).approvalTtlMs = ttlMs;
    });
  }

  async approveFromServer(input: {
    workspaceId: string;
    nonce: string;
    recipient: string;
    subject: string;
    body: string;
    mode: "manual" | "auto";
    userId: string;
  }): Promise<ActionResult> {
    const now = this.clock.now();
    const state = this.memory(input.workspaceId);
    const ttl = state.approvalTtlMs ?? 60 * 60 * 1000;
    return this.approve({
      workspaceId: input.workspaceId,
      nonce: input.nonce,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      mode: input.mode,
      qcPass: false,
      autoOptIn: false,
      senderId: input.userId,
      issuedAt: now,
      expiresAt: now + ttl,
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

  async clearKill(input: { workspaceId: string; role: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (input.role !== "admin" && input.role !== "owner") return { ok: false, reason: "role" };
      const state = this.memory(input.workspaceId);
      state.killed = false;
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "unkill", "unkill");
      return { ok: true, reason: "" };
    });
  }

  async putToken(input: { workspaceId: string; role: string; actorId: string; token: string }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (input.role !== "admin" && input.role !== "owner") {
        await this.audit(input.workspaceId, "refusal", "role");
        return { ok: false, reason: "role" };
      }
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
      if (input.role !== "admin" && input.role !== "owner") {
        await this.audit(input.workspaceId, "refusal", "role");
        return { ok: false, reason: "role" };
      }
      const state = this.memory(input.workspaceId);
      state.tokenCiphertext = null;
      this.persist(input.workspaceId);
      await this.audit(input.workspaceId, "purge", "revoke");
      return { ok: true, reason: "" };
    });
  }

  async approve(input: ApprovalInput): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!RECIPIENT_PATTERN.test(input.recipient)) return { ok: false, reason: "recipient" };
      if (input.subject.length > MAX_SUBJECT || input.body.length > MAX_BODY || input.nonce.length > MAX_NONCE) {
        return { ok: false, reason: "bounds" };
      }
      if (input.expiresAt <= input.issuedAt || input.expiresAt - input.issuedAt > DAY_MS) {
        return { ok: false, reason: "approval-lifetime" };
      }
      if (input.issuedAt > this.clock.now() + SKEW_MS) return { ok: false, reason: "approval-lifetime" };
      if (input.mode === "auto" && (!input.qcPass || !input.autoOptIn)) return { ok: false, reason: "qc-required" };
      const state = this.memory(input.workspaceId);
      state.approvals = state.approvals.filter((item) => item.nonce !== input.nonce);
      state.approvals.push({ ...input, binding: bindingOf(input), consumed: false });
      if (state.approvals.length > 50) state.approvals.splice(0, state.approvals.length - 50);
      return { ok: true, reason: "" };
    });
  }

  async sendUsingStored(input: {
    workspaceId: string;
    nonce: string;
    recipient: string;
    subject: string;
    body: string;
    mode: "manual" | "auto";
    actorId: string;
    hold?: boolean;
    fakeStatus?: number;
    challenge?: boolean;
    delayMs?: number;
    enqueue?: boolean;
  }): Promise<ActionResult> {
    const stored = this.memory(input.workspaceId).approvals.find((item) => item.nonce === input.nonce);
    if (!stored) return { ok: false, reason: "approval-token" };
    if (
      stored.recipient !== input.recipient ||
      stored.subject !== input.subject ||
      stored.body !== input.body ||
      stored.mode !== input.mode
    ) {
      return { ok: false, reason: "binding-mismatch" };
    }
    const send: SendInput = {
      ...stored,
      actorId: input.actorId,
      hold: input.hold,
      fakeStatus: input.fakeStatus,
      challenge: input.challenge,
      delayMs: input.delayMs,
    };
    return input.enqueue ? this.enqueue(send) : this.send(send);
  }

  async send(input: SendInput): Promise<ActionResult> {
    return this.dispatch(input);
  }

  async enqueue(input: SendInput): Promise<ActionResult> {
    const queued = await this.exclusive(() => {
      const state = this.memory(input.workspaceId);
      const inflight = this.flights.get(input.workspaceId)?.size ?? 0;
      const waiting = this.waiters.filter((waiter) => waiter.input.workspaceId === input.workspaceId).length;
      if (inflight + waiting >= MAX_QUEUE) return { ok: false, reason: "queue-full" } satisfies ActionResult;
      if (inflight > 0 || waiting > 0) {
        const id = randomBytes(8).toString("hex");
        state.queue.push({
          id,
          state: "queued",
          nonce: input.nonce,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
          senderId: input.senderId,
        });
        this.waiters.push({
          id,
          input,
          resolve: (result) => {
            if (result.ok) return;
            const row = this.memory(input.workspaceId).queue.find((item) => item.id === id);
            if (row && (row.state === "queued" || row.state === "sending")) {
              row.state = "failed";
              this.persist(input.workspaceId);
            }
          },
        });
        this.persist(input.workspaceId);
        return { ok: true, reason: "queued" } satisfies ActionResult;
      }
      return null;
    });
    if (queued) return queued;
    return this.dispatch(input);
  }

  async reset(workspaceId: string): Promise<void> {
    return this.exclusive(async () => {
      this.flights.get(workspaceId)?.forEach((controller) => controller.abort());
      this.flights.delete(workspaceId);
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
        this.flights.get(input.workspaceId)?.delete(controller);
        this.pump(input.workspaceId);
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
    if (killEngaged(this.env) || state.killed) return refuse("kill-switch");
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
    const destination = await this.destination();
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
    const active = this.flights.get(input.workspaceId) ?? new Set<AbortController>();
    active.add(controller);
    this.flights.set(input.workspaceId, active);
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
    const destination = await this.destination();
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
    if (destination.host) headers.host = destination.host;
    headers.cookie = `li_at=${token}`;
    if (testBuild(this.env)) {
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
    const timeoutMs = input.hold ? 120_000 : intEnv(this.env, "ARIA_LINKEDIN_TOKEN_TIMEOUT_MS", 10_000);
    this.reloadKill(input.workspaceId);
    if (controller.signal.aborted || killEngaged(this.env) || this.memory(input.workspaceId).killed) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const once = { ...requestBase, attempt: 0 };
    return this.transport ? this.transport.deliver(once) : this.fetchOnce(once, timeoutMs);
  }

  private async fetchOnce(request: TransportRequest, timeoutMs: number): Promise<TransportResult> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      const servername = request.headers.host;
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
        redirect: "manual",
        servername,
        rejectUnauthorized: true,
      } as RequestInit);
      const body = await response.text();
      return { status: response.status, body: this.scrub(body), finalUrl: response.url };
    } catch (err) {
      if (request.signal.aborted) throw err;
      if (timeout.aborted) return { status: 0, body: "", timeout: true, error: "timeout" };
      return { status: 0, body: "", error: "transport" };
    }
  }

  private async finish(input: SendInput, controller: AbortController, delivered: TransportResult): Promise<ActionResult> {
    this.reloadKill(input.workspaceId);
    const state = this.memory(input.workspaceId);
    if (controller.signal.aborted || !state.enabled || killEngaged(this.env) || state.killed) {
      this.rollback(input);
      this.markQueue(input, "cancelled");
      await this.audit(input.workspaceId, "refusal", "cancelled");
      return { ok: false, reason: "cancelled" };
    }
    if (delivered.timeout) {
      this.markQueue(input, "unknown");
      await this.audit(input.workspaceId, "unknown", "infrastructure-timeout");
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
      this.markQueue(input, "unknown");
      await this.audit(input.workspaceId, "unknown", "unknown");
      return { ok: false, reason: "unknown" };
    }
    this.markQueue(input, "sent");
    this.persist(input.workspaceId);
    await this.audit(input.workspaceId, "send", input.nonce);
    return { ok: true, reason: "" };
  }

  private async finishThrown(input: SendInput, controller: AbortController, err: unknown): Promise<ActionResult> {
    this.reloadKill(input.workspaceId);
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    const stopped = aborted || killEngaged(this.env) || this.memory(input.workspaceId).killed || !this.memory(input.workspaceId).enabled;
    if (stopped) {
      this.rollback(input);
      this.markQueue(input, "cancelled");
      await this.audit(input.workspaceId, "refusal", "cancelled");
      this.log("send ended");
      return { ok: false, reason: "cancelled" };
    }
    this.markQueue(input, "unknown");
    await this.audit(input.workspaceId, "unknown", "unknown");
    this.log("send ended");
    return { ok: false, reason: "unknown" };
  }

  private rollback(input: SendInput): void {
    const state = this.memory(input.workspaceId);
    state.recentSends.pop();
    this.persist(input.workspaceId);
  }

  private markQueue(input: SendInput, status: string): void {
    const state = this.memory(input.workspaceId);
    const row = [...state.queue].reverse().find((item) => item.nonce === input.nonce && item.state !== "cancelled");
    if (row) {
      row.state = status;
      if (status === "sent" || status === "unknown") row.sentAt = this.clock.now();
    }
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
    this.flights.get(workspaceId)?.forEach((controller) => controller.abort());
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

  private async destination(): Promise<{ ok: true; url: string; host?: string } | { ok: false; reason: string }> {
    const raw = (this.env.lookup("ARIA_LINKEDIN_TOKEN_BASE_URL") ?? "").trim();
    if (!raw) return { ok: false, reason: "config" };
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, reason: "config" };
    }
    if (parsed.username || parsed.password) return { ok: false, reason: "config" };
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (loopback(host)) {
      if (!testBuild(this.env) || parsed.protocol !== "http:") return { ok: false, reason: "config" };
      return { ok: true, url: parsed.origin };
    }
    if (parsed.protocol !== "https:" || parsed.port) return { ok: false, reason: "config" };
    if (parsed.pathname !== "" && parsed.pathname !== "/") return { ok: false, reason: "config" };
    if (parsed.search || parsed.hash) return { ok: false, reason: "config" };
    if (host !== PINNED_HOST) return { ok: false, reason: "config" };
    let addresses: string[] = [];
    try {
      addresses = await this.resolver(host);
    } catch {
      return { ok: false, reason: "config" };
    }
    if (addresses.length === 0 || addresses.some((address) => !publicAddress(address))) return { ok: false, reason: "config" };
    const pinned = addresses[0].includes(":") ? `[${addresses[0]}]` : addresses[0];
    return { ok: true, url: `https://${pinned}`, host: PINNED_HOST };
  }

  private pump(workspaceId: string): void {
    const next = this.waiters.find((waiter) => waiter.input.workspaceId === workspaceId);
    if (!next) return;
    if ((this.flights.get(workspaceId)?.size ?? 0) > 0) return;
    this.waiters = this.waiters.filter((waiter) => waiter !== next);
    void this.dispatch(next.input).then((result) => next.resolve(result));
  }

  private reloadKill(workspaceId: string): void {
    const state = this.memory(workspaceId);
    if (!this.db) return;
    const row = this.db.prepare("select killed from linkedin_token_workspace where workspace_id = ?").get(workspaceId) as
      | { killed: number }
      | undefined;
    if (row) state.killed = row.killed === 1;
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
        "select enabled, acknowledgement, acknowledged_by, token_ciphertext, paused, pause_reason, killed from linkedin_token_workspace where workspace_id = ?",
      )
      .get(workspaceId) as
      | {
          enabled: number;
          acknowledgement: string | null;
          acknowledged_by: string | null;
          token_ciphertext: string | null;
          paused: number;
          pause_reason: string | null;
          killed: number;
        }
      | undefined;
    if (!row) return;
    state.enabled = row.enabled === 1;
    state.acknowledgement = row.acknowledgement;
    state.acknowledgedBy = row.acknowledged_by;
    state.tokenCiphertext = row.token_ciphertext;
    state.paused = row.paused === 1;
    state.pauseReason = row.pause_reason;
    state.killed = row.killed === 1;
    const queued = this.db
      .prepare("select id, status, recipient, subject, body, nonce, sender_id, sent_at from linkedin_token_queue where workspace_id = ?")
      .all(workspaceId) as {
      id: string;
      status: string;
      recipient: string;
      subject: string;
      body: string;
      nonce: string;
      sender_id: string;
      sent_at: string | null;
    }[];
    state.queue = queued.map((item) => ({
      id: item.id,
      state: item.status,
      recipient: item.recipient,
      subject: item.subject,
      body: item.body,
      nonce: item.nonce,
      senderId: item.sender_id,
      sentAt: item.sent_at ? Date.parse(item.sent_at) : undefined,
    }));
    const dayAgo = this.clock.now() - DAY_MS;
    state.recentSends = state.queue
      .filter((item) => (item.state === "sent" || item.state === "unknown") && item.sentAt !== undefined && item.sentAt > dayAgo)
      .map((item) => item.sentAt as number);
  }

  private persist(workspaceId: string): void {
    if (!this.db) return;
    const state = this.memory(workspaceId);
    const now = new Date(this.clock.now()).toISOString();
    this.db
      .prepare(
        `insert into linkedin_token_workspace
          (workspace_id, enabled, acknowledgement, acknowledged_by, acknowledged_at, token_ciphertext, paused, pause_reason, killed, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(workspace_id) do update set
          enabled = excluded.enabled,
          acknowledgement = excluded.acknowledgement,
          acknowledged_by = excluded.acknowledged_by,
          acknowledged_at = excluded.acknowledged_at,
          token_ciphertext = excluded.token_ciphertext,
          paused = excluded.paused,
          pause_reason = excluded.pause_reason,
          killed = excluded.killed,
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
        state.killed ? 1 : 0,
        now,
      );
    this.db.prepare("delete from linkedin_token_queue where workspace_id = ?").run(workspaceId);
    const insert = this.db.prepare(
      "insert into linkedin_token_queue (id, workspace_id, status, recipient, subject, body, nonce, sender_id, sent_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of state.queue) {
      insert.run(
        row.id,
        workspaceId,
        row.state,
        row.recipient,
        row.subject,
        row.body,
        row.nonce,
        row.senderId,
        row.sentAt ? new Date(row.sentAt).toISOString() : null,
        now,
      );
    }
  }

  private async audit(workspaceId: string, action: string, detail: string): Promise<void> {
    const state = this.memory(workspaceId);
    const at = new Date(this.clock.now()).toISOString();
    state.audit.push({ action, at });
    if (state.audit.length > MAX_AUDIT) state.audit.splice(0, state.audit.length - MAX_AUDIT);
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

function fetchPinned(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const extra = init as RequestInit & { servername?: string; rejectUnauthorized?: boolean };
  if (!extra?.servername || extra.rejectUnauthorized === false) return globalThis.fetch(input, init);
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: extra.method,
        headers: extra.headers as OutgoingHttpHeaders,
        ...pinnedTlsOptions(url.hostname.replace(/^\[|\]$/g, ""), Number(url.port || 443)),
        signal: extra.signal ?? undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0 }));
        });
      },
    );
    req.on("error", reject);
    if (typeof extra.body === "string") req.write(extra.body);
    req.end();
  });
}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, statement: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(statement);
}

function expandIpv6(input: string): number[] | null {
  let host = input.toLowerCase().split("%")[0];
  if (host.includes(".")) {
    const last = host.lastIndexOf(":");
    const parts = ipv4Parts(host.slice(last + 1));
    if (!parts) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    host = `${host.slice(0, last)}:${hi}:${lo}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const nums = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  if (nums.some((part) => Number.isNaN(part))) return null;
  return nums;
}

function mappedIpv4(address: string): number[] | null {
  const groups = expandIpv6(address);
  if (!groups) return null;
  const head = groups.slice(0, 5).every((part) => part === 0);
  const compatible = groups.slice(0, 6).every((part) => part === 0) && (groups[6] !== 0 || groups[7] !== 0);
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((part) => part === 0);
  if (!(head && groups[5] === 0xffff) && !compatible && !nat64) return null;
  return [(groups[6] >> 8) & 255, groups[6] & 255, (groups[7] >> 8) & 255, groups[7] & 255];
}

function publicAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = mappedIpv4(host);
  if (mapped) return !blockedIpv4(mapped);
  if (host.includes(":")) {
    const groups = expandIpv6(host);
    if (!groups) return false;
    if (groups.every((part) => part === 0)) return false;
    if (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1) return false;
    if ((groups[0] & 0xffc0) === 0xfe80) return false;
    if ((groups[0] & 0xfe00) === 0xfc00) return false;
    if ((groups[0] & 0xffc0) === 0xfec0) return false;
    if ((groups[0] & 0xff00) === 0xff00) return false;
    if (groups[0] === 0x2002) {
      const embedded = [(groups[1] >> 8) & 255, groups[1] & 255, (groups[2] >> 8) & 255, groups[2] & 255];
      return !blockedIpv4(embedded);
    }
    return true;
  }
  const parts = ipv4Parts(host);
  if (!parts) return false;
  return !blockedIpv4(parts);
}

function pinnedTlsOptions(host: string, port: number, ca?: Buffer): ConnectionOptions {
  return {
    host,
    port,
    servername: PINNED_HOST,
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
  };
}

export function probePinnedTls(input: { host: string; port: number; ca: Buffer }): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(pinnedTlsOptions(input.host, input.port, input.ca), () => {
      socket.end();
      resolve();
    });
    socket.once("error", reject);
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
