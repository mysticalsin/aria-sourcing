/**
 * LinkedIn session-token channel. Red-first coverage for the off-by-default
 * port of the existing Voyager send, plus Devin's gate checklist and Forge's
 * four checks. Synthetic tokens only. No live network.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { approvalHash } from "../src/lib/outreach-content.ts";
import {
  COMPLIANCE_168_ALLOWLIST,
  RISK_NOTICE,
  flagDefaultsOff,
} from "../src/channels/linkedin-token/notice.ts";
import { decryptToken, encryptToken } from "../src/channels/linkedin-token/crypto.ts";
import {
  LinkedInTokenChannel,
  RedactedToken,
  type Auditor,
  type Env,
  type MailMessage,
  type Transport,
  type TransportRequest,
} from "../src/channels/linkedin-token/channel.ts";
import { handleLinkedInTokenRequest } from "../src/channels/linkedin-token/handlers.ts";

const ROOT = process.cwd();
const WORKSPACE = "ws-synthetic";
const TOKEN = "fake-li-token-000";
const RECIPIENT = "ACoAASyntheticAda01";
const SENDER = "sender-synthetic";
const DAY = 24 * 60 * 60 * 1000;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function memEnv(initial: Record<string, string> = {}): Env & { set(key: string, value: string): void } {
  const vars = { ...initial };
  return {
    lookup(key) {
      return vars[key];
    },
    set(key, value) {
      vars[key] = value;
    },
  };
}

function keyEnv(extra: Record<string, string> = {}): Env & { set(key: string, value: string): void } {
  return memEnv({
    ARIA_LINKEDIN_TOKEN_KEY: randomBytes(32).toString("base64"),
    ARIA_LINKEDIN_TOKEN_DAILY_CAP: "5",
    ARIA_LINKEDIN_TOKEN_MIN_GAP_MS: "0",
    ARIA_LINKEDIN_TOKEN_BASE_URL: "http://127.0.0.1:9",
    ...extra,
  });
}

function recordingAuditor(): Auditor & { messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    messages,
    async postChatter(msg) {
      messages.push(msg);
    },
  };
}

function actions(auditor: { messages: MailMessage[] }): string[] {
  return auditor.messages.map((msg) => msg.subject.replace(/^Outreach /, ""));
}

function harness(options?: {
  env?: Env & { set(key: string, value: string): void };
  transport?: Transport;
  now?: number;
  logs?: string[];
}): {
  channel: LinkedInTokenChannel;
  env: Env & { set(key: string, value: string): void };
  auditor: Auditor & { messages: MailMessage[] };
  logs: string[];
  clock: { now(): number; set(value: number): void };
} {
  const env = options?.env ?? keyEnv();
  const auditor = recordingAuditor();
  const logs = options?.logs ?? [];
  let now = options?.now ?? Date.UTC(2026, 10, 20, 12, 0, 0);
  const clock = {
    now: () => now,
    set(value: number) {
      now = value;
    },
  };
  const channel = new LinkedInTokenChannel({
    env,
    auditor,
    transport: options?.transport,
    clock,
    logger: (line) => logs.push(line),
  });
  return { channel, env, auditor, logs, clock };
}

async function arm(
  channel: LinkedInTokenChannel,
  role: "admin" | "owner" | "member" = "admin",
): Promise<void> {
  const enabled = await channel.enable({
    workspaceId: WORKSPACE,
    role,
    actorId: "ada-admin",
    acknowledgement: RISK_NOTICE,
  });
  assert.equal(enabled.ok, true, enabled.reason);
  const stored = await channel.putToken({
    workspaceId: WORKSPACE,
    role: "member",
    actorId: "ada-user",
    token: TOKEN,
  });
  assert.equal(stored.ok, true, stored.reason);
}

function approval(nonce: string, body = "Hello Ada, this is a synthetic note.") {
  const issuedAt = Date.UTC(2026, 10, 20, 12, 0, 0);
  return {
    workspaceId: WORKSPACE,
    nonce,
    recipient: RECIPIENT,
    subject: "Synthetic note",
    body,
    mode: "manual" as const,
    qcPass: false,
    autoOptIn: false,
    senderId: SENDER,
    issuedAt,
    expiresAt: issuedAt + 60 * 60 * 1000,
  };
}

async function approveAndSend(
  channel: LinkedInTokenChannel,
  nonce: string,
  body?: string,
): Promise<{ ok: boolean; reason: string; infrastructure?: boolean }> {
  const spec = approval(nonce, body);
  const recorded = await channel.approve(spec);
  assert.equal(recorded.ok, true, recorded.reason);
  return channel.send({ ...spec, actorId: "ada-user" });
}

function okTransport(status = 200, body = '{"id":"fake-msg"}'): Transport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    async deliver(request) {
      calls.push(request);
      return { status, body, finalUrl: request.url };
    },
  };
}

test("the flag defaults OFF in dev, test, demo, and prod config", () => {
  for (const name of ["development", "test", "demo", "production"]) {
    assert.equal(flagDefaultsOff(name), false, name);
    const { channel } = harness({ env: keyEnv({ NODE_ENV: name }) });
    assert.equal(channel.view(WORKSPACE).enabled, false, name);
    assert.equal(channel.view(WORKSPACE).tokenStored, false, name);
  }
  const configFiles = [
    ".env.local.example",
    "docker-compose.yml",
    "docker-compose.dev.yml",
    ".github/workflows/ci.yml",
    "next.config.mjs",
  ];
  for (const file of configFiles) {
    const text = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(
      text,
      /ARIA_LINKEDIN_TOKEN_ENABLED\s*=\s*['"]?(?:true|1|on)\b/i,
      file,
    );
  }
});

test("non-admin enable is refused", async () => {
  const { channel } = harness();
  const result = await channel.enable({
    workspaceId: WORKSPACE,
    role: "member",
    actorId: "ada-member",
    acknowledgement: RISK_NOTICE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "role");
  assert.equal(channel.view(WORKSPACE).enabled, false);
});

test("admin enable requires the risk acknowledgement", async () => {
  const { channel, auditor } = harness();
  const missing = await channel.enable({
    workspaceId: WORKSPACE,
    role: "admin",
    actorId: "ada-admin",
    acknowledgement: "",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "acknowledgement");
  const wrong = await channel.enable({
    workspaceId: WORKSPACE,
    role: "owner",
    actorId: "ada-owner",
    acknowledgement: "I accept the risk",
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "acknowledgement");
  assert.equal(channel.view(WORKSPACE).enabled, false);
  const enabled = await channel.enable({
    workspaceId: WORKSPACE,
    role: "admin",
    actorId: "ada-admin",
    acknowledgement: RISK_NOTICE,
  });
  assert.equal(enabled.ok, true);
  assert.equal(channel.view(WORKSPACE).acknowledgement, RISK_NOTICE);
  assert.match(RISK_NOTICE, /User Agreement prohibits third-party session-token tools/);
  assert.match(RISK_NOTICE, /restricted or banned/);
  assert.ok(auditor.messages.some((msg) => msg.body.includes(RISK_NOTICE)));
});

test("a send without an exact-text approval is refused", async () => {
  const transport = okTransport();
  const { channel } = harness({ transport });
  await arm(channel);
  const spec = approval("nonce-missing");
  const refused = await channel.send({ ...spec, actorId: "ada-user" });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "approval-token");
  assert.equal(transport.calls.length, 0);
  const recorded = await channel.approve(spec);
  assert.equal(recorded.ok, true);
  const mismatched = await channel.send({ ...spec, body: "A different body.", actorId: "ada-user" });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, "binding-mismatch");
  assert.equal(approvalHash(spec.subject, spec.body), approvalHash(spec.subject, spec.body));
  assert.notEqual(approvalHash(spec.subject, spec.body), approvalHash(spec.subject, "A different body."));
});

test("daily cap allows the send at the limit and refuses limit plus one", async () => {
  const transport = okTransport();
  const { channel, env } = harness({ transport });
  env.set("ARIA_LINKEDIN_TOKEN_DAILY_CAP", "2");
  env.set("ARIA_LINKEDIN_TOKEN_MIN_GAP_MS", "0");
  await arm(channel);
  const first = await approveAndSend(channel, "cap-1", "Note one.");
  const second = await approveAndSend(channel, "cap-2", "Note two.");
  const third = await approveAndSend(channel, "cap-3", "Note three.");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.reason, "daily-cap");
  assert.equal(transport.calls.length, 2);
});

test("pacing gap edges", async () => {
  const transport = okTransport();
  const { channel, env, clock } = harness({ transport });
  env.set("ARIA_LINKEDIN_TOKEN_DAILY_CAP", "5");
  env.set("ARIA_LINKEDIN_TOKEN_MIN_GAP_MS", "1000");
  await arm(channel);
  const start = clock.now();
  assert.equal((await approveAndSend(channel, "gap-1", "Gap one.")).ok, true);
  clock.set(start + 999);
  const early = await approveAndSend(channel, "gap-2", "Gap two.");
  assert.equal(early.ok, false);
  assert.equal(early.reason, "pacing");
  clock.set(start + 1000);
  const onEdge = await approveAndSend(channel, "gap-3", "Gap three.");
  assert.equal(onEdge.ok, true);
  assert.equal(transport.calls.length, 2);
});

test("approval token lifetime edges", async () => {
  const transport = okTransport();
  const { channel, clock } = harness({ transport });
  await arm(channel);
  const issuedAt = clock.now();
  const exact = await channel.approve({
    ...approval("life-exact"),
    issuedAt,
    expiresAt: issuedAt + DAY,
  });
  assert.equal(exact.ok, true);
  const tooLong = await channel.approve({
    ...approval("life-long", "Too long."),
    issuedAt,
    expiresAt: issuedAt + DAY + 1,
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "approval-lifetime");
  clock.set(issuedAt + DAY - 1);
  assert.equal((await channel.send({ ...approval("life-exact"), actorId: "ada-user" })).ok, true);
  const edgeNonce = "life-edge";
  await channel.approve({ ...approval(edgeNonce, "Edge."), issuedAt, expiresAt: issuedAt + 5_000 });
  clock.set(issuedAt + 5_000);
  const expired = await channel.send({ ...approval(edgeNonce, "Edge."), actorId: "ada-user" });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "approval-expired");
  clock.set(issuedAt);
  const atSkew = await channel.approve({
    ...approval("life-skew", "Skew."),
    issuedAt: issuedAt + 120_000,
    expiresAt: issuedAt + 120_000 + 1_000,
  });
  assert.equal(atSkew.ok, true);
  const future = await channel.approve({
    ...approval("life-future", "Future."),
    issuedAt: issuedAt + 120_000 + 1,
    expiresAt: issuedAt + 120_000 + 1 + 1_000,
  });
  assert.equal(future.ok, false);
  assert.equal(future.reason, "approval-lifetime");
});

test("the kill switch blocks a send", async () => {
  const transport = okTransport();
  const { channel, env } = harness({ transport });
  await arm(channel);
  env.set("ARIA_SEND_KILL_SWITCH", "on");
  const blocked = await approveAndSend(channel, "kill-1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "kill-switch");
  assert.equal(transport.calls.length, 0);
  env.set("ARIA_SEND_KILL_SWITCH", "off");
  assert.equal((await approveAndSend(channel, "kill-2", "After the switch.")).ok, true);
});

test("auto-pause on a 429 and a challenge", async () => {
  const transport = okTransport(429, '{"message":"slow down"}');
  const { channel } = harness({ transport });
  await arm(channel);
  const throttled = await approveAndSend(channel, "pause-429");
  assert.equal(throttled.ok, false);
  assert.equal(throttled.reason, "sender-paused");
  assert.equal(channel.view(WORKSPACE).paused, true);
  const next = await approveAndSend(channel, "pause-next", "Should not leave.");
  assert.equal(next.ok, false);
  assert.equal(next.reason, "sender-paused");
  assert.equal(transport.calls.length, 1);

  const challenge = okTransport(200, "<html>security check</html>");
  const second = harness({ transport: challenge });
  await arm(second.channel);
  const challenged = await approveAndSend(second.channel, "pause-challenge", "Challenge note.");
  assert.equal(challenged.ok, false);
  assert.equal(second.channel.view(WORKSPACE).paused, true);
  assert.equal(second.channel.view(WORKSPACE).pauseReason, "challenge");
});

test("an Odoo audit entry is written for enable, disable, purge, send, refusal, and pause", async () => {
  const transport = okTransport();
  const { channel, auditor } = harness({ transport });
  await channel.enable({
    workspaceId: WORKSPACE,
    role: "admin",
    actorId: "ada-admin",
    acknowledgement: RISK_NOTICE,
  });
  await channel.putToken({ workspaceId: WORKSPACE, role: "member", actorId: "ada-user", token: TOKEN });
  const refused = await channel.send({ ...approval("audit-refuse"), actorId: "ada-user" });
  assert.equal(refused.reason, "approval-token");
  assert.equal((await approveAndSend(channel, "audit-send")).ok, true);
  transport.deliver = async (request) => {
    transport.calls.push(request);
    return { status: 429, body: "{}", finalUrl: request.url };
  };
  await approveAndSend(channel, "audit-pause", "Pause note.");
  await channel.disable({ workspaceId: WORKSPACE, role: "admin", actorId: "ada-admin" });
  const seen = actions(auditor);
  for (const action of ["enable", "refusal", "send", "pause", "disable", "purge"]) {
    assert.ok(seen.includes(action), `missing ${action} in ${seen.join(",")}`);
  }
  assert.ok(auditor.messages.every((msg) => msg.message_type === "notification"));
  assert.ok(auditor.messages.every((msg) => msg.subtype_xmlid === "mail.mt_note"));
});

test("AES-GCM uses a unique nonce and the key comes from the env only", () => {
  const env = keyEnv({ DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
  const first = encryptToken(TOKEN, env);
  const second = encryptToken(TOKEN, env);
  assert.notEqual(first, second);
  assert.equal(decryptToken(first, env), TOKEN);
  assert.equal(decryptToken(second, env), TOKEN);
  const without = memEnv({ DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
  assert.throws(() => encryptToken(TOKEN, without), /ARIA_LINKEDIN_TOKEN_KEY/);
  const source = readFileSync(join(ROOT, "src/channels/linkedin-token/crypto.ts"), "utf8");
  assert.match(source, /ARIA_LINKEDIN_TOKEN_KEY/);
  assert.doesNotMatch(source, /DATA_ENCRYPTION_KEY/);
  const flipped = Buffer.from(first, "utf8");
  flipped[flipped.length - 2] = flipped[flipped.length - 2] === 65 ? 66 : 65;
  assert.throws(() => decryptToken(flipped.toString("utf8"), env));
});

test("the token never appears in logs, error messages, or snapshots", async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const capture = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => String(item)).join(" "));
  };
  console.debug = capture;
  try {
    const transport = okTransport(500, `{"echo":"${TOKEN}"}`);
    const { channel, auditor } = harness({ transport, logs });
    await arm(channel);
    const result = await approveAndSend(channel, "redact-1");
    const view = channel.view(WORKSPACE);
    const blob = JSON.stringify({ result, view, audit: auditor.messages, logs, errors });
    assert.equal(blob.includes(TOKEN), false);
    const redacted = new RedactedToken(TOKEN);
    assert.equal(String(redacted), "[redacted]");
    assert.equal(JSON.stringify(redacted), '"[redacted]"');
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  }
});

test("verifier property: any token string never appears in output", async () => {
  const samples = ["tok~alpha", "tok~beta", "session~gamma", "li~delta~999"];
  for (const sample of samples) {
    const logs: string[] = [];
    const transport: Transport = {
      async deliver() {
        return { status: 401, body: sample, finalUrl: null, error: sample };
      },
    };
    const { channel, auditor } = harness({ transport, logs });
    await channel.enable({
      workspaceId: WORKSPACE,
      role: "owner",
      actorId: "ada-owner",
      acknowledgement: RISK_NOTICE,
    });
    await channel.putToken({ workspaceId: WORKSPACE, role: "member", actorId: "ada-user", token: sample });
    let thrown = "";
    try {
      await approveAndSend(channel, `prop-${digest(sample).slice(0, 8)}`, `Body ${digest(sample).slice(0, 6)}`);
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }
    const blob = JSON.stringify({
      view: channel.view(WORKSPACE),
      audit: auditor.messages,
      logs,
      thrown,
    });
    assert.equal(blob.includes(sample), false);
  }
});

test("revoke clears the stored token", async () => {
  const transport = okTransport();
  const { channel } = harness({ transport });
  await arm(channel);
  assert.equal(channel.view(WORKSPACE).tokenStored, true);
  const revoked = await channel.revoke({ workspaceId: WORKSPACE, role: "member", actorId: "ada-user" });
  assert.equal(revoked.ok, true);
  assert.equal(channel.view(WORKSPACE).tokenStored, false);
  assert.equal(channel.view(WORKSPACE).enabled, true);
  const refused = await approveAndSend(channel, "revoke-send");
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "no-token");
  assert.equal(transport.calls.length, 0);
});

test("OFF purges the token and cancels an in-flight send atomically", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const transport: Transport = {
    async deliver(request) {
      calls += 1;
      entered();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: '{"id":"late"}' };
    },
  };
  const { channel } = harness({ transport });
  await arm(channel);
  const spec = approval("inflight-1");
  assert.equal((await channel.approve(spec)).ok, true);
  const inflight = channel.send({ ...spec, actorId: "ada-user" });
  await started;
  const queuedSpec = approval("queued-2", "Queued synthetic note.");
  assert.equal((await channel.approve(queuedSpec)).ok, true);
  const queued = channel.enqueue({ ...queuedSpec, actorId: "ada-user" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(channel.view(WORKSPACE).queue.some((item) => item.state === "queued"), true);
  const disabled = await channel.disable({ workspaceId: WORKSPACE, role: "admin", actorId: "ada-admin" });
  assert.equal(disabled.ok, true);
  assert.equal(channel.view(WORKSPACE).enabled, false);
  assert.equal(channel.view(WORKSPACE).tokenStored, false);
  assert.equal(channel.view(WORKSPACE).queue.every((item) => item.state === "cancelled"), true);
  const sent = await inflight;
  const waiting = await queued;
  assert.equal(sent.ok, false);
  assert.equal(sent.reason, "cancelled");
  assert.equal(waiting.ok, false);
  assert.equal(waiting.reason, "cancelled");
  assert.equal(calls, 1);
});

test("fakes only: a non-loopback dial is refused before any fetch", async () => {
  const dials: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    dials.push(url.hostname);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
      throw new Error("non-loopback dial");
    }
    return new Response('{"id":"unused"}', { status: 200 });
  }) as typeof fetch;
  try {
    const env = keyEnv({ ARIA_LINKEDIN_TOKEN_BASE_URL: "https://www.linkedin.com" });
    const { channel } = harness({ env });
    await arm(channel);
    const refused = await approveAndSend(channel, "remote-1");
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "config");
    assert.deepEqual(dials, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("a loopback fake server receives the ported send and nothing else is dialed", async () => {
  const seen: { host: string; path: string; csrf: string; cookie: string; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      seen.push({
        host: req.headers.host ?? "",
        path: req.url ?? "",
        csrf: String(req.headers["csrf-token"] ?? ""),
        cookie: String(req.headers.cookie ?? ""),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"id":"fake-msg"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const dials: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    dials.push(url.hostname);
    if (url.hostname !== "127.0.0.1") throw new Error("non-loopback dial");
    return original(input, init);
  }) as typeof fetch;
  try {
    const env = keyEnv({ ARIA_LINKEDIN_TOKEN_BASE_URL: `http://127.0.0.1:${address.port}` });
    const { channel } = harness({ env });
    await arm(channel);
    const result = await approveAndSend(channel, "loop-1", "Synthetic body for the fake server.");
    assert.equal(result.ok, true);
    assert.deepEqual(dials, ["127.0.0.1"]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage");
    assert.equal(digest(seen[0].csrf), digest(TOKEN));
    assert.equal(digest(seen[0].cookie), digest(`li_at=${TOKEN}`));
    assert.match(seen[0].body, /Synthetic body for the fake server/);
  } finally {
    globalThis.fetch = original;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("the token channel is unreachable while the flag is OFF", async () => {
  let calls = 0;
  const transport: Transport = {
    async deliver() {
      calls += 1;
      return { status: 200, body: "{}" };
    },
  };
  const { channel } = harness({ transport });
  const result = await approveAndSend(channel, "off-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "disabled");
  assert.equal(calls, 0);
});

test("the #168 allowlist is exactly one entry", () => {
  assert.equal(COMPLIANCE_168_ALLOWLIST.length, 1);
  assert.deepEqual([...COMPLIANCE_168_ALLOWLIST], ["src/channels/linkedin-token/"]);
});

test("server-side session cookie sends stay inside that one allowlisted path", () => {
  const hits: string[] = [];
  const roots = ["src", "extensions", "scripts"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const child = join(dir, entry);
      if (statSync(child).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(child);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs|mts)$/.test(entry)) continue;
      const text = readFileSync(child, "utf8");
      if (text.includes("li_at=")) hits.push(relative(ROOT, child).replaceAll("\\", "/"));
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  const allow = COMPLIANCE_168_ALLOWLIST[0];
  assert.ok(hits.length > 0);
  for (const hit of hits) assert.ok(hit.startsWith(allow), hit);
});

test("a timeout is an infrastructure error after one retry", async () => {
  let calls = 0;
  const transport: Transport = {
    async deliver() {
      calls += 1;
      return { status: 0, body: "", timeout: true, error: "timeout" };
    },
  };
  const { channel } = harness({ transport });
  await arm(channel);
  const result = await approveAndSend(channel, "timeout-1");
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "infrastructure-timeout");
  assert.equal(result.infrastructure, true);
});

test("skip gate: this suite does not skip or xfail without a reason", () => {
  const files = [join(ROOT, "tests/linkedin-token.mts"), join(ROOT, "e2e/linkedin-token.spec.ts")];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const skips = source.match(/\b(?:test|it)\.skip\s*\(([^)]*)\)/g) ?? [];
    for (const skip of skips) {
      assert.match(skip, /reason\s*:/, `${file} has a skip without a reason`);
    }
    assert.doesNotMatch(source, /\b(?:test|it)\.(?:todo|xfail)\s*\(/);
  }
  const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
  assert.match(config, /retries:\s*0/);
});

test("one changed character in the approved text is refused", async () => {
  const transport = okTransport();
  const { channel } = harness({ transport });
  await arm(channel);
  const spec = approval("char-1", "Hello Ada, this is a synthetic note.");
  assert.equal((await channel.approve(spec)).ok, true);
  const edited = { ...spec, body: "Hello Ada, this is a synthetic note!", actorId: "ada-user" };
  const refused = await channel.send(edited);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "binding-mismatch");
  assert.equal(transport.calls.length, 0);
});

test("a non-admin cannot read token status or ciphertext", async () => {
  const { channel } = harness();
  await arm(channel);
  const denied = await handleLinkedInTokenRequest({
    method: "GET",
    role: "member",
    workspaceId: WORKSPACE,
    channel,
  });
  assert.equal(denied.status, 403);
  const body = JSON.stringify(denied.body);
  assert.equal(body.includes(TOKEN), false);
  assert.equal(body.includes("ciphertext"), false);
  assert.equal(denied.body.tokenStored, undefined);
  const allowed = await handleLinkedInTokenRequest({
    method: "GET",
    role: "admin",
    workspaceId: WORKSPACE,
    channel,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.tokenStored, true);
  assert.equal(JSON.stringify(allowed.body).includes(TOKEN), false);
  assert.equal(JSON.stringify(allowed.body).includes("ciphertext"), false);
});

test("OFF deletes the token ciphertext and cancels queued rows in the database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "li-token-"));
  const dbPath = join(dir, "token.sqlite");
  let releaseEntered!: () => void;
  const started = new Promise<void>((resolve) => {
    releaseEntered = resolve;
  });
  const transport: Transport = {
    async deliver(request) {
      releaseEntered();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: "{}" };
    },
  };
  const env = keyEnv();
  const auditor = recordingAuditor();
  const channel = new LinkedInTokenChannel({
    env,
    auditor,
    transport,
    dbPath,
    clock: { now: () => Date.UTC(2026, 10, 20, 12, 0, 0) },
  });
  await arm(channel);
  const spec = approval("db-inflight");
  assert.equal((await channel.approve(spec)).ok, true);
  const inflight = channel.send({ ...spec, actorId: "ada-user" });
  await started;
  const queuedSpec = approval("db-queued", "Queued database note.");
  assert.equal((await channel.approve(queuedSpec)).ok, true);
  const queued = channel.enqueue({ ...queuedSpec, actorId: "ada-user" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const db = new DatabaseSync(dbPath);
  const before = db.prepare("select token_ciphertext from linkedin_token_workspace where workspace_id = ?").get(WORKSPACE) as {
    token_ciphertext: string;
  };
  assert.equal(typeof before.token_ciphertext, "string");
  assert.equal(before.token_ciphertext.includes(TOKEN), false);
  assert.equal((await channel.disable({ workspaceId: WORKSPACE, role: "owner", actorId: "ada-owner" })).ok, true);
  const after = db.prepare("select token_ciphertext from linkedin_token_workspace where workspace_id = ?").get(WORKSPACE) as {
    token_ciphertext: string | null;
  };
  assert.equal(after.token_ciphertext, null);
  const rows = db.prepare("select status from linkedin_token_queue where workspace_id = ?").all(WORKSPACE) as { status: string }[];
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((row) => row.status === "cancelled"));
  db.close();
  assert.equal((await inflight).reason, "cancelled");
  assert.equal((await queued).reason, "cancelled");
  rmSync(dir, { recursive: true, force: true });
});

test("the kill switch flipped mid-queue stops queued sends and does not double-send", async () => {
  let calls = 0;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const transport: Transport = {
    async deliver(request) {
      calls += 1;
      entered();
      await new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail, { once: true });
      });
      return { status: 200, body: '{"id":"late"}' };
    },
  };
  const { channel, env } = harness({ transport });
  await arm(channel);
  const first = approval("killq-1");
  const second = approval("killq-2", "Second synthetic note.");
  assert.equal((await channel.approve(first)).ok, true);
  assert.equal((await channel.approve(second)).ok, true);
  const inflight = channel.send({ ...first, actorId: "ada-user" });
  await started;
  const queued = channel.enqueue({ ...second, actorId: "ada-user" });
  env.set("ARIA_SEND_KILL_SWITCH", "on");
  const stopped = await channel.applyKillSwitch({ workspaceId: WORKSPACE });
  assert.equal(stopped.ok, true);
  assert.equal((await inflight).reason, "cancelled");
  assert.equal((await queued).reason, "cancelled");
  assert.equal(calls, 1);
  env.set("ARIA_SEND_KILL_SWITCH", "off");
  const again = await channel.send({ ...first, actorId: "ada-user" });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "token-used");
  assert.equal(calls, 1);
});

test("exact-text approval is single use", async () => {
  const transport = okTransport();
  const { channel } = harness({ transport });
  await arm(channel);
  const spec = approval("once-1");
  assert.equal((await channel.approve(spec)).ok, true);
  assert.equal((await channel.send({ ...spec, actorId: "ada-user" })).ok, true);
  const again = await channel.send({ ...spec, actorId: "ada-user" });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "token-used");
});
