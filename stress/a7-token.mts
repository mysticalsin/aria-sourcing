/**
 * A7. The token channel against a loopback transport. The fixture token must
 * not show up in the logger output.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LinkedInTokenChannel } from "../src/channels/linkedin-token/channel.ts";
import { RISK_NOTICE } from "../src/channels/linkedin-token/notice.ts";

const FIXTURE = "synthetic-li-token-a7-not-a-secret";

class MapEnv {
  constructor(private readonly values: Record<string, string>) {}
  lookup(name: string): string | undefined {
    return this.values[name];
  }
}

test("A7 expire, revoke and one token use path", async () => {
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "aria-a7-"));
  const logPath = join(dir, "channel.log");
  const lines: string[] = [];
  let delivers = 0;
  const env = new MapEnv({
    ARIA_LINKEDIN_TOKEN_KEY: randomBytes(32).toString("base64"),
    ARIA_LINKEDIN_TOKEN_BASE_URL: "http://127.0.0.1:9",
    ARIA_LINKEDIN_TOKEN_DAILY_CAP: "40",
    ARIA_LINKEDIN_TOKEN_MIN_GAP_MS: "0",
    ARIA_E2E: "1",
  });
  const channel = new LinkedInTokenChannel({
    env,
    dbPath: join(dir, "token.sqlite"),
    auditor: { async postChatter() {} },
    logger: (line) => {
      lines.push(line);
      writeFileSync(logPath, lines.join("\n"));
    },
    transport: {
      async deliver(request) {
        const target = new URL(request.url);
        if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
          console.error("non-loopback transport aborted");
          process.exit(2);
        }
        delivers += 1;
        return { status: 201, body: '{"ok":true}' };
      },
    },
  });
  const workspaceId = "ws-synthetic-a7";
  const actorId = "operator-synthetic";
  assert.equal((await channel.enable({ workspaceId, role: "admin", actorId, acknowledgement: RISK_NOTICE })).ok, true);
  assert.equal((await channel.putToken({ workspaceId, role: "admin", actorId, token: FIXTURE })).ok, true);
  const now = Date.now();
  const base = {
    workspaceId,
    actorId,
    recipient: "ada-example-member",
    subject: "Synthetic note",
    body: "Synthetic body bound to this exact text.",
    senderId: "sender-synthetic",
    mode: "manual" as const,
    qcPass: false,
    autoOptIn: false,
    issuedAt: now,
    expiresAt: now + 60_000,
  };
  for (let i = 0; i < 20; i += 1) {
    const approved = await channel.approve({ ...base, nonce: `nonce-a7-${i}` });
    assert.equal(approved.ok, true, approved.reason);
  }
  const expired = await channel.approve({ ...base, nonce: "nonce-a7-expired", issuedAt: now - 120_000, expiresAt: now - 60_000 });
  assert.equal(expired.ok, true, expired.reason);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => channel.send({ ...base, nonce: `nonce-a7-${i}` })),
  );
  const sent = results.filter((item) => item.ok).length;
  assert.equal(sent, 20);
  assert.equal(delivers, 20);
  const afterExpire = await channel.send({ ...base, nonce: "nonce-a7-expired", issuedAt: now - 120_000, expiresAt: now - 60_000 });
  assert.equal(afterExpire.ok, false);
  assert.equal((await channel.revoke({ workspaceId, role: "admin", actorId })).ok, true);
  const afterRevoke = await channel.send({ ...base, nonce: "nonce-a7-revoked" });
  assert.equal(afterRevoke.ok, false);
  assert.equal(delivers, 20);
  const blob = readFileSync(logPath, "utf8");
  assert.equal(blob.includes(FIXTURE), false);
  rmSync(dir, { recursive: true, force: true });
  if (Date.now() - started > 60_000) throw new Error("A7 exceeded 60s");
});
