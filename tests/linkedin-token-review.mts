/**
 * Behaviour checks for authorization, host checks, and send control.
 * Synthetic tokens only. No live network.
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

const TOKEN = "fake-li-token-000";
const RECIPIENT = "ACoAASyntheticAda01";
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

function memEnv(initial: Record<string, string>): Env & { set(key: string, value: string): void } {
  const vars = { ...initial };
  return {
    lookup: (key) => vars[key],
    set: (key, value) => {
      vars[key] = value;
    },
  };
}

function harness(
  base: string,
  extra: Record<string, string> = {},
  options?: { resolver?: (host: string) => Promise<string[]>; transport?: Transport; calls?: { url: string; attempt: number }[] },
) {
  const calls = options?.calls ?? [];
  const notes: string[] = [];
  const transport: Transport = options?.transport ?? {
    async deliver(request) {
      calls.push({ url: request.url, attempt: request.attempt });
      return { status: 200, body: '{"id":"fake-msg"}', finalUrl: request.url };
    },
  };
  const env = memEnv({
    ARIA_LINKEDIN_TOKEN_KEY: randomBytes(32).toString("base64"),
    ARIA_LINKEDIN_TOKEN_DAILY_CAP: "5",
    ARIA_LINKEDIN_TOKEN_MIN_GAP_MS: "0",
    ARIA_LINKEDIN_TOKEN_BASE_URL: base,
    NODE_ENV: "test",
    ARIA_LINKEDIN_TOKEN_TEST_SESSION: "1",
    ...extra,
  });
  const dir = mkdtempSync(join(tmpdir(), "li-review-"));
  const dbPath = join(dir, "token.sqlite");
  const channel = new LinkedInTokenChannel({
    env,
    auditor: {
      async postChatter(msg) {
        notes.push(msg.subject);
      },
    },
    transport,
    dbPath,
    clock: { now: () => NOW },
    resolver: options?.resolver,
  } as ConstructorParameters<typeof LinkedInTokenChannel>[0]);
  return {
    channel,
    env,
    calls,
    notes,
    dbPath,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function spec(nonce: string, workspaceId: string, body = "Hello Ada, this is a synthetic note.") {
  return {
    workspaceId,
    nonce,
    recipient: RECIPIENT,
    subject: "Synthetic note",
    body,
    mode: "manual" as const,
    qcPass: false,
    autoOptIn: false,
    senderId: "ada-admin",
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
  };
}

async function arm(channel: LinkedInTokenChannel, workspaceId: string) {
  assert.equal(
    (await channel.enable({ workspaceId, role: "admin", actorId: "ada-admin", acknowledgement: RISK_NOTICE })).ok,
    true,
  );
  assert.equal(
    (await channel.putToken({ workspaceId, role: "admin", actorId: "ada-admin", token: TOKEN })).ok,
    true,
  );
}

test("a member cannot approve or send", async () => {
  const { channel, calls, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, "ws-home");
    for (const action of ["approve", "send", "enqueue"] as const) {
      const result = await handleLinkedInTokenRequest({
        method: "POST",
        role: "member",
        userId: "ada-member",
        sessionWorkspaceId: "ws-home",
        workspaceId: "ws-home",
        channel,
        action,
        body: spec("n-member", "ws-home"),
      } as unknown as HandlerInput);
      assert.equal(result.status, 403, action);
    }
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("an unknown role is refused", async () => {
  const { channel, calls, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, "ws-home");
    const result = await handleLinkedInTokenRequest({
      method: "POST",
      role: "nope",
      userId: "ada",
      sessionWorkspaceId: "ws-home",
      workspaceId: "ws-home",
      channel,
      action: "approve",
      body: spec("n-role", "ws-home"),
    } as unknown as HandlerInput);
    assert.equal(result.status, 403);
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("a missing user is refused", async () => {
  const { channel, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, "ws-home");
    const result = await handleLinkedInTokenRequest({
      method: "POST",
      role: "admin",
      sessionWorkspaceId: "ws-home",
      workspaceId: "ws-home",
      channel,
      action: "kill",
      body: {},
    } as unknown as HandlerInput);
    assert.equal(result.status, 401);
    assert.equal(channel.view("ws-home").killSwitch, false);
  } finally {
    close();
  }
});

test("token storage and revoke require an administrator", async () => {
  const { channel, dbPath, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, "ws-home");
    const db = new DatabaseSync(dbPath);
    const before = (db.prepare("select token_ciphertext from linkedin_token_workspace where workspace_id = ?").get("ws-home") as { token_ciphertext: string }).token_ciphertext;
    const stored = await channel.putToken({ workspaceId: "ws-home", role: "member", actorId: "ada-member", token: "fake-li-token-999" });
    assert.equal(stored.ok, false);
    assert.equal(stored.reason, "role");
    const revoked = await channel.revoke({ workspaceId: "ws-home", role: "member", actorId: "ada-member" });
    assert.equal(revoked.ok, false);
    assert.equal(revoked.reason, "role");
    const after = (db.prepare("select token_ciphertext from linkedin_token_workspace where workspace_id = ?").get("ws-home") as { token_ciphertext: string }).token_ciphertext;
    assert.equal(after, before);
    db.close();
  } finally {
    close();
  }
});

test("only the pinned host is accepted, and only at a public address", async () => {
  const allowed = harness("https://www.linkedin.com", {}, { resolver: async () => ["203.0.113.10"] });
  try {
    await arm(allowed.channel, "ws-home");
    const specOk = spec("n-pin", "ws-home");
    assert.equal((await allowed.channel.approve(specOk)).ok, true);
    const sent = await allowed.channel.send({ ...specOk, actorId: "ada-admin" });
    assert.equal(sent.ok, true);
    assert.equal(new URL(allowed.calls[0].url).hostname, "203.0.113.10");
  } finally {
    allowed.close();
  }
  for (const ip of ["10.1.2.3", "169.254.169.254", "127.0.0.1"]) {
    const blocked = harness("https://www.linkedin.com", {}, { resolver: async () => [ip] });
    try {
      await arm(blocked.channel, "ws-home");
      const item = spec(`n-${ip}`, "ws-home");
      assert.equal((await blocked.channel.approve(item)).ok, true);
      const result = await blocked.channel.send({ ...item, actorId: "ada-admin" });
      assert.equal(result.reason, "config", ip);
      assert.equal(blocked.calls.length, 0, ip);
    } finally {
      blocked.close();
    }
  }
});

test("plain http loopback is limited to a test build", async () => {
  const { channel, calls, close } = harness("http://127.0.0.1:9", { NODE_ENV: "production", ARIA_LINKEDIN_TOKEN_TEST_SESSION: "" });
  try {
    await arm(channel, "ws-home");
    const item = spec("n-loop", "ws-home");
    assert.equal((await channel.approve(item)).ok, true);
    const result = await channel.send({ ...item, actorId: "ada-admin" });
    assert.equal(result.reason, "config");
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("each workspace keeps its own in-flight send", async () => {
  const signals = new Map<string, AbortSignal>();
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen = 0;
  const transport: Transport = {
    async deliver(request) {
      seen += 1;
      signals.set(request.body?.includes("Hold A") ? "a" : "b", request.signal);
      if (seen === 2) release();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: "{}", finalUrl: null };
    },
  };
  const { channel, close } = harness("http://127.0.0.1:9", {}, { transport });
  try {
    await arm(channel, "ws-a");
    await arm(channel, "ws-b");
    const a = spec("n-a", "ws-a", "Hold A");
    const b = spec("n-b", "ws-b", "Hold B");
    assert.equal((await channel.approve(a)).ok, true);
    assert.equal((await channel.approve(b)).ok, true);
    const left = channel.send({ ...a, actorId: "ada-admin" });
    const right = channel.send({ ...b, actorId: "ada-admin" });
    await started;
    await channel.engageKill({ workspaceId: "ws-a" });
    assert.equal(signals.get("a")?.aborted, true);
    assert.equal(signals.get("b")?.aborted, false);
    await channel.engageKill({ workspaceId: "ws-b" });
    assert.equal((await left).reason, "cancelled");
    assert.equal((await right).reason, "cancelled");
  } finally {
    close();
  }
});

test("an in-flight send stops after the channel is killed", async () => {
  let release: (value: { status: number; body: string }) => void = () => undefined;
  const gate = new Promise<{ status: number; body: string }>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const transport: Transport = {
    async deliver() {
      calls += 1;
      return gate;
    },
  };
  const first = harness("http://127.0.0.1:9", { ARIA_LINKEDIN_TOKEN_DEDUPE: "on" }, { transport });
  try {
    await arm(first.channel, "ws-home");
    const item = spec("n-inflight-kill", "ws-home");
    assert.equal((await first.channel.approve(item)).ok, true);
    const pending = first.channel.send({ ...item, actorId: "ada-admin" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = new LinkedInTokenChannel({
      env: first.env,
      auditor: { async postChatter() {} },
      dbPath: first.dbPath,
      clock: { now: () => NOW },
    });
    assert.equal((await second.engageKill({ workspaceId: "ws-home" })).ok, true);
    release({ status: 200, body: '{"id":"late"}' });
    const result = await pending;
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.notEqual(result.reason, "");
    assert.equal(first.channel.view("ws-home").queue.some((row) => row.state === "sent"), false);
  } finally {
    first.close();
  }
});

test("kill and recent sends survive a second instance", async () => {
  const first = harness("http://127.0.0.1:9", { ARIA_LINKEDIN_TOKEN_DAILY_CAP: "1" });
  try {
    await arm(first.channel, "ws-home");
    const item = spec("n-cap", "ws-home");
    assert.equal((await first.channel.approve(item)).ok, true);
    assert.equal((await first.channel.send({ ...item, actorId: "ada-admin" })).ok, true);
    await first.channel.engageKill({ workspaceId: "ws-home" });
    const second = new LinkedInTokenChannel({
      env: first.env,
      auditor: { async postChatter() {} },
      transport: { async deliver() { return { status: 200, body: "{}", finalUrl: null }; } },
      dbPath: first.dbPath,
      clock: { now: () => NOW },
    });
    assert.equal(second.view("ws-home").killSwitch, true);
    const cleared = await handleLinkedInTokenRequest({
      method: "POST",
      role: "admin",
      userId: "ada-admin",
      sessionWorkspaceId: "ws-home",
      workspaceId: "ws-home",
      channel: second,
      action: "unkill",
      body: {},
    } as unknown as HandlerInput);
    assert.equal(cleared.status, 200);
    assert.equal(second.view("ws-home").killSwitch, false);
    const again = spec("n-cap-2", "ws-home", "Second synthetic note.");
    assert.equal((await second.approve(again)).ok, true);
    const capped = await second.send({ ...again, actorId: "ada-admin" });
    assert.equal(capped.reason, "daily-cap");
  } finally {
    first.close();
  }
});

test("a timeout is a single attempt", async () => {
  let calls = 0;
  const transport: Transport = {
    async deliver() {
      calls += 1;
      return { status: 0, body: "", timeout: true, error: "timeout" };
    },
  };
  const { channel, close } = harness("http://127.0.0.1:9", {}, { transport });
  try {
    await arm(channel, "ws-home");
    const item = spec("n-once", "ws-home");
    assert.equal((await channel.approve(item)).ok, true);
    const result = await channel.send({ ...item, actorId: "ada-admin" });
    assert.equal(calls, 1);
    assert.equal(result.reason, "infrastructure-timeout");
  } finally {
    close();
  }
});

test("an unknown outcome stays on the cap", async () => {
  const transport: Transport = {
    async deliver() {
      return { status: 0, body: "", error: "transport" };
    },
  };
  const { channel, notes, close } = harness("http://127.0.0.1:9", { ARIA_LINKEDIN_TOKEN_DAILY_CAP: "1" }, { transport });
  try {
    await arm(channel, "ws-home");
    const item = spec("n-unknown", "ws-home");
    assert.equal((await channel.approve(item)).ok, true);
    const result = await channel.send({ ...item, actorId: "ada-admin" });
    assert.equal(result.reason, "unknown");
    assert.equal(notes.some((note) => note.includes("unknown")), true);
    const next = spec("n-unknown-2", "ws-home", "Another synthetic note.");
    assert.equal((await channel.approve(next)).ok, true);
    assert.equal((await channel.send({ ...next, actorId: "ada-admin" })).reason, "daily-cap");
  } finally {
    close();
  }
});

test("a queued send returns without waiting", async () => {
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport: Transport = {
    async deliver(request) {
      release();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: "{}", finalUrl: null };
    },
  };
  const { channel, close } = harness("http://127.0.0.1:9", {}, { transport });
  try {
    await arm(channel, "ws-home");
    const first = spec("n-q1", "ws-home");
    assert.equal((await channel.approve(first)).ok, true);
    const inflight = channel.send({ ...first, actorId: "ada-admin" });
    await started;
    const second = spec("n-q2", "ws-home", "Queued synthetic note.");
    assert.equal((await channel.approve(second)).ok, true);
    const queued = await Promise.race([
      channel.enqueue({ ...second, actorId: "ada-admin" }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("hung")), 400)),
    ]);
    assert.equal(queued.reason, "queued");
    await channel.engageKill({ workspaceId: "ws-home" });
    assert.equal((await inflight).reason, "cancelled");
    assert.equal(channel.view("ws-home").queue.every((row) => row.state === "cancelled"), true);
  } finally {
    close();
  }
});

test("the queue has a bound", async () => {
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport: Transport = {
    async deliver(request) {
      release();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: "{}", finalUrl: null };
    },
  };
  const { channel, close } = harness("http://127.0.0.1:9", {}, { transport });
  try {
    await arm(channel, "ws-home");
    const first = spec("n-bound-0", "ws-home");
    assert.equal((await channel.approve(first)).ok, true);
    const inflight = channel.send({ ...first, actorId: "ada-admin" });
    await started;
    let last = { ok: true, reason: "" };
    for (let i = 1; i <= 21; i += 1) {
      const item = spec(`n-bound-${i}`, "ws-home", `Synthetic note ${i}.`);
      assert.equal((await channel.approve(item)).ok, true);
      last = await channel.enqueue({ ...item, actorId: "ada-admin" });
    }
    assert.equal(last.reason, "queue-full");
    await channel.engageKill({ workspaceId: "ws-home" });
    await inflight;
  } finally {
    close();
  }
});

test("a redirect is a challenge", async () => {
  const transport: Transport = {
    async deliver() {
      return { status: 302, body: "", finalUrl: "https://www.linkedin.com/checkpoint/challenge" };
    },
  };
  const { channel, close } = harness("http://127.0.0.1:9", {}, { transport });
  try {
    await arm(channel, "ws-home");
    const item = spec("n-redirect", "ws-home");
    assert.equal((await channel.approve(item)).ok, true);
    const result = await channel.send({ ...item, actorId: "ada-admin" });
    assert.equal(result.reason, "sender-paused");
    assert.equal(channel.view("ws-home").pauseReason, "challenge");
  } finally {
    close();
  }
});

test("recipient and size are checked up front", async () => {
  const { channel, calls, close } = harness("http://127.0.0.1:9");
  try {
    await arm(channel, "ws-home");
    const bad = spec("n-who", "ws-home");
    bad.recipient = "not-a-member";
    assert.equal((await channel.approve(bad)).ok, false);
    const huge = spec("n-huge", "ws-home", "x".repeat(5000));
    assert.equal((await channel.approve(huge)).ok, false);
    assert.equal(calls.length, 0);
  } finally {
    close();
  }
});

test("token actions are rate limited", async () => {
  const { channel, close } = harness("http://127.0.0.1:9");
  try {
    const calls = [];
    for (let i = 0; i < 3; i += 1) {
      calls.push(
        await handleLinkedInTokenRequest({
          method: "POST",
          role: "admin",
          userId: "ada-admin",
          sessionWorkspaceId: "ws-home",
          workspaceId: "ws-home",
          channel,
          action: "enable",
          body: { acknowledgement: RISK_NOTICE },
          ratePerMin: 2,
        } as unknown as HandlerInput),
      );
    }
    assert.equal(calls[2].status, 429);
    assert.equal(channel.view("ws-home").enabled, true);
  } finally {
    close();
  }
});
