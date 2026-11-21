/**
 * Authorization and outbound host checks for the LinkedIn token channel.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

/// <reference path="../src/channels/linkedin-token/node-sqlite.d.ts" />
import { LinkedInTokenChannel, type Env, type Transport } from "../src/channels/linkedin-token/channel.ts";
import { handleLinkedInTokenRequest, type HandlerInput } from "../src/channels/linkedin-token/handlers.ts";
import { RISK_NOTICE } from "../src/channels/linkedin-token/notice.ts";

const HOME = "ws-home";
const FOREIGN = "ws-foreign";
const TOKEN = "fake-li-token-000";
const RECIPIENT = "ACoAASyntheticAda01";

function memEnv(initial: Record<string, string>): Env & { set(key: string, value: string): void } {
  const vars = { ...initial };
  return {
    lookup: (key) => vars[key],
    set: (key, value) => {
      vars[key] = value;
    },
  };
}

function harness(base: string) {
  const calls: { url: string; cookie: string }[] = [];
  const transport: Transport = {
    async deliver(request) {
      calls.push({ url: request.url, cookie: request.headers.cookie ?? "" });
      return { status: 200, body: '{"id":"fake-msg"}', finalUrl: request.url };
    },
  };
  const env = memEnv({
    ARIA_LINKEDIN_TOKEN_KEY: randomBytes(32).toString("base64"),
    ARIA_LINKEDIN_TOKEN_DAILY_CAP: "5",
    ARIA_LINKEDIN_TOKEN_MIN_GAP_MS: "0",
    ARIA_LINKEDIN_TOKEN_BASE_URL: base,
  });
  const dir = mkdtempSync(join(tmpdir(), "li-sec-"));
  const dbPath = join(dir, "token.sqlite");
  const channel = new LinkedInTokenChannel({
    env,
    auditor: { async postChatter() {} },
    transport,
    dbPath,
    clock: { now: () => Date.UTC(2026, 10, 20, 12, 0, 0) },
  });
  const db = new DatabaseSync(dbPath);
  return {
    channel,
    env,
    calls,
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function arm(channel: LinkedInTokenChannel, workspaceId: string) {
  assert.equal(
    (
      await channel.enable({
        workspaceId,
        role: "admin",
        actorId: "ada-admin",
        acknowledgement: RISK_NOTICE,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await channel.putToken({
        workspaceId,
        role: "admin",
        actorId: "ada-admin",
        token: TOKEN,
      })
    ).ok,
    true,
  );
}

function cipher(db: DatabaseSync, workspaceId: string): string | null {
  const row = db.prepare("select token_ciphertext from linkedin_token_workspace where workspace_id = ?").get(workspaceId) as
    | { token_ciphertext: string | null }
    | undefined;
  return row?.token_ciphertext ?? null;
}

function queueCount(db: DatabaseSync, workspaceId: string): number {
  const row = db.prepare("select count(*) as n from linkedin_token_queue where workspace_id = ?").get(workspaceId) as { n: number };
  return Number(row.n);
}

const ACTIONS = ["enable", "disable", "token", "revoke", "approve", "send", "enqueue", "kill"] as const;

function bodyFor(action: string): Record<string, unknown> {
  return {
    acknowledgement: RISK_NOTICE,
    token: "fake-li-token-999",
    nonce: "n-attack",
    recipient: RECIPIENT,
    subject: "Synthetic note",
    body: "Hello Ada, this is a synthetic note.",
    mode: "auto",
    qcPass: true,
    autoOptIn: true,
    senderId: "other-user",
    issuedAt: 1,
    expiresAt: 2,
    actorId: "other-user",
    action,
  };
}

test("rejects an unauthenticated token request", async () => {
  const { channel, calls, db, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, HOME);
    const before = cipher(db, HOME);
    assert.equal(typeof before, "string");
    for (const action of ACTIONS) {
      const result = await handleLinkedInTokenRequest({
        method: "POST",
        role: "",
        userId: null,
        sessionWorkspaceId: HOME,
        workspaceId: HOME,
        channel,
        action,
        body: bodyFor(action),
      } as unknown as HandlerInput);
      assert.equal(result.status, 401, action);
      assert.equal(cipher(db, HOME), before, action);
      assert.equal(queueCount(db, HOME), 0, action);
      assert.equal(channel.view(HOME).killSwitch, false, action);
    }
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("rejects a workspace id outside the session", async () => {
  const { channel, calls, db, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, HOME);
    const before = cipher(db, HOME);
    const result = await handleLinkedInTokenRequest({
      method: "POST",
      role: "admin",
      userId: "ada-admin",
      sessionWorkspaceId: HOME,
      workspaceId: FOREIGN,
      channel,
      action: "send",
      body: bodyFor("send"),
    } as unknown as HandlerInput);
    assert.equal(result.status, 403);
    assert.equal(cipher(db, HOME), before);
    assert.equal(cipher(db, FOREIGN), null);
    assert.equal(queueCount(db, HOME), 0);
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("rejects a read-only role on token changes", async () => {
  const { channel, calls, db, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, HOME);
    const before = cipher(db, HOME);
    for (const action of ACTIONS) {
      const result = await handleLinkedInTokenRequest({
        method: "POST",
        role: "viewer",
        userId: "ada-viewer",
        sessionWorkspaceId: HOME,
        workspaceId: HOME,
        channel,
        action,
        body: bodyFor(action),
      } as unknown as HandlerInput);
      assert.equal(result.status, 403, action);
      assert.equal(cipher(db, HOME), before, action);
      assert.equal(queueCount(db, HOME), 0, action);
      assert.equal(channel.view(HOME).killSwitch, false, action);
    }
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("uses the server QC result for approval", async () => {
  const { channel, calls, db, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, HOME);
    const before = cipher(db, HOME);
    const approved = await handleLinkedInTokenRequest({
      method: "POST",
      role: "member",
      userId: "ada-member",
      sessionWorkspaceId: HOME,
      workspaceId: HOME,
      channel,
      action: "approve",
      serverQcPass: false,
      serverAutoOptIn: false,
      body: { ...bodyFor("approve"), mode: "auto", qcPass: true, autoOptIn: true },
    } as unknown as HandlerInput);
    const sent = await handleLinkedInTokenRequest({
      method: "POST",
      role: "member",
      userId: "ada-member",
      sessionWorkspaceId: HOME,
      workspaceId: HOME,
      channel,
      action: "send",
      serverQcPass: false,
      serverAutoOptIn: false,
      body: { ...bodyFor("send"), mode: "auto", qcPass: true, autoOptIn: true },
    } as unknown as HandlerInput);
    assert.equal(calls.length, 0);
    assert.notEqual(approved.status, 200);
    assert.notEqual(sent.status, 200);
    assert.equal(cipher(db, HOME), before);
    assert.equal(queueCount(db, HOME), 0);
    assert.equal(channel.view(HOME).killSwitch, false);
  } finally {
    close();
  }
});

test("refuses a remote base that is not the allowlisted host", async () => {
  for (const base of ["https://evil.example", "http://169.254.169.254", "https://169.254.169.254"]) {
    const { channel, env, calls, close } = harness(base);
    try {
      env.set("ARIA_LINKEDIN_TOKEN_REMOTE", "on");
      await arm(channel, HOME);
      const issuedAt = Date.UTC(2026, 10, 20, 12, 0, 0);
      const spec = {
        workspaceId: HOME,
        nonce: "n-ssrf",
        recipient: RECIPIENT,
        subject: "Synthetic note",
        body: "Hello Ada, this is a synthetic note.",
        mode: "manual" as const,
        qcPass: false,
        autoOptIn: false,
        senderId: "ada-admin",
        issuedAt,
        expiresAt: issuedAt + 60_000,
      };
      assert.equal((await channel.approve(spec)).ok, true);
      const result = await channel.send({ ...spec, actorId: "ada-admin" });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "config");
      assert.equal(calls.length, 0);
      assert.equal(calls.some((call) => call.cookie.includes(TOKEN)), false);
    } finally {
      close();
    }
  }
});

test("test session opens only for a test build", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNode = env.NODE_ENV;
  const previousFlag = env.ARIA_LINKEDIN_TOKEN_TEST_SESSION;
  const { linkedInTokenTestSessionOpen } = await import("../src/app/api/channels/linkedin-token/route.ts");
  try {
    env.NODE_ENV = "production";
    env.ARIA_LINKEDIN_TOKEN_TEST_SESSION = "1";
    assert.equal(linkedInTokenTestSessionOpen(), false);
    env.NODE_ENV = "test";
    delete env.ARIA_LINKEDIN_TOKEN_TEST_SESSION;
    assert.equal(linkedInTokenTestSessionOpen(), false);
    env.ARIA_LINKEDIN_TOKEN_TEST_SESSION = "1";
    assert.equal(linkedInTokenTestSessionOpen(), true);
  } finally {
    if (previousNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNode;
    if (previousFlag === undefined) delete process.env.ARIA_LINKEDIN_TOKEN_TEST_SESSION;
    else process.env.ARIA_LINKEDIN_TOKEN_TEST_SESSION = previousFlag;
  }
});

test("kill switch requires an administrator", async () => {
  const { channel, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, HOME);
    const missing = await handleLinkedInTokenRequest({
      method: "POST",
      role: "admin",
      workspaceId: HOME,
      sessionWorkspaceId: HOME,
      channel,
      action: "kill",
      body: {},
    } as unknown as HandlerInput);
    assert.equal(missing.status, 401);
    assert.equal(channel.view(HOME).killSwitch, false);
    const member = await handleLinkedInTokenRequest({
      method: "POST",
      role: "member",
      userId: "ada-member",
      workspaceId: HOME,
      sessionWorkspaceId: HOME,
      channel,
      action: "kill",
      body: {},
    } as unknown as HandlerInput);
    assert.equal(member.status, 403);
    assert.equal(channel.view(HOME).killSwitch, false);
  } finally {
    close();
  }
});
