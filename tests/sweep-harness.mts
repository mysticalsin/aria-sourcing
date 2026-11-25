import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertHarnessUrls, isLoopbackRequestUrl } from "../e2e/integration/loopback-url.mjs";

type Service = {
  name: string;
  image: boolean;
  build: boolean;
  mem?: string;
  swap?: string;
};

function services(path: string): Service[] {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const lines = text.split("\n");
  let inServices = false;
  const found: Service[] = [];
  let current: Service | null = null;
  for (const line of lines) {
    if (!inServices) {
      if (line === "services:") inServices = true;
      continue;
    }
    if (/^[A-Za-z]/.test(line)) break;
    const name = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (name) {
      current = { name: name[1], image: false, build: false };
      found.push(current);
      continue;
    }
    if (!current) continue;
    if (/^    image:/.test(line)) current.image = true;
    if (/^    build:/.test(line)) current.build = true;
    const mem = /^    mem_limit:\s*(\S+)/.exec(line);
    const swap = /^    memswap_limit:\s*(\S+)/.exec(line);
    if (mem) current.mem = mem[1];
    if (swap) current.swap = swap[1];
  }
  return found;
}

function mib(raw: string): number {
  const match = /^(\d+)([kmg])$/i.exec(raw);
  assert.ok(match, raw);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "k") return value / 1024;
  if (unit === "m") return value;
  return value * 1024;
}

test("overlay caps this stack's services and does not invent a gateway", () => {
  const base = services("docker-compose.yml");
  const overlay = services("e2e/integration/compose.overlay.yml");
  const baseNames = new Set(base.map((service) => service.name));
  const problems: string[] = [];
  for (const service of overlay) {
    if (!service.image && !service.build && !baseNames.has(service.name)) {
      problems.push(`${service.name} is not a service on this stack and has no image`);
    }
    if (!service.mem) problems.push(`${service.name} has no mem_limit`);
    else if (service.swap !== service.mem) problems.push(`${service.name} swap cap is ${service.swap}`);
  }
  for (const service of base) {
    const cap = overlay.find((item) => item.name === service.name);
    if (!cap?.mem) problems.push(`${service.name} is missing from the overlay memory caps`);
  }
  if (overlay.some((service) => service.name === "gateway")) problems.push("overlay still names gateway");
  if (overlay.find((service) => service.name === "kong")?.mem !== "96m") problems.push("kong cap is not 96m");
  const capped = overlay.filter((service) => service.mem);
  const sum = capped.reduce((total, service) => total + mib(service.mem!), 0);
  if (sum >= 6 * 1024) problems.push(`memory caps sum to ${sum} MiB`);
  assert.deepEqual(problems, []);
});

test("compose project name lowercases on a POSIX shell", () => {
  const script = readFileSync(new URL("../scripts/integration-e2e.sh", import.meta.url), "utf8");
  const line = script.split("\n").find((row) => row.startsWith("COMPOSE_PROJECT="));
  assert.ok(line);
  const out = execFileSync("sh", ["-c", `STAMP='20261125T120000Z'; ${line}; printf '%s' "$COMPOSE_PROJECT"`], {
    encoding: "utf8",
  });
  assert.equal(out, "aria-int-20261125t120000z");
});

test("the sandbox bridge rule does not open the FORWARD policy", () => {
  const script = readFileSync(new URL("../scripts/integration-e2e.sh", import.meta.url), "utf8");
  assert.doesNotMatch(script, /iptables-legacy\s+-P\s+FORWARD\s+ACCEPT/);
  assert.match(script, /iptables-legacy\s+-I\s+FORWARD\s+-s\s+172\.16\.0\.0\/12\s+-d\s+172\.16\.0\.0\/12\s+-j\s+ACCEPT/);
  assert.match(script, /\[ "\$BRIDGE" = "apply" \]/);
});

test("daily-cap SQL does not cite a missing migration as its own body", () => {
  const sql = readFileSync(new URL("../stress/sql/daily-cap.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /function body matches/);
  const cited = [...sql.matchAll(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g)].map((match) => match[0]);
  assert.ok(cited.length > 0);
  for (const rel of cited) {
    const body = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    assert.equal(body.includes("consume_outreach_channel_daily_cap"), false, rel);
  }
});

test("send and harness URLs require a loopback host", () => {
  assert.equal(isLoopbackRequestUrl("http://localhost.evil.test/api/outreach/send"), false);
  assert.equal(isLoopbackRequestUrl("http://127.0.0.1.evil.example/api/outreach/send"), false);
  assert.equal(isLoopbackRequestUrl("http://evil.example/api/outreach/send?next=http://127.0.0.1"), false);
  assert.equal(isLoopbackRequestUrl("http://user:secret@127.0.0.1/api/outreach/send"), false);
  assert.equal(isLoopbackRequestUrl("http://127.0.0.1:3000/api/outreach/send"), true);
  assert.equal(isLoopbackRequestUrl("http://localhost:3000/api/outreach/send"), true);
  assert.equal(isLoopbackRequestUrl("http://[::1]:3000/api/outreach/send"), true);
  assert.doesNotThrow(() => assertHarnessUrls({ appUrl: "http://127.0.0.1:3000", odooUrl: "" }));
  assert.throws(() => assertHarnessUrls({ appUrl: "https://aria.example", odooUrl: "" }), /APP_URL/);
  assert.throws(
    () => assertHarnessUrls({ appUrl: "http://127.0.0.1:3000", odooUrl: "http://odoo.example/aria/pipeline?via=127.0.0.1" }),
    /ODOO_URL/,
  );
});

test("the bridge rule never changes a Mac firewall and skips outside a sandbox", () => {
  const script = new URL("../scripts/sandbox-bridge.sh", import.meta.url);
  const run = (env: Record<string, string>) =>
    execFileSync("sh", [script.pathname], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    }).trim();
  assert.match(run({ SANDBOX_UNAME: "Darwin", CI: "true", CURSOR_AGENT: "1" }), /skip:.*macOS/);
  assert.match(run({ SANDBOX_UNAME: "Linux" }), /skip:.*sandbox/);
  assert.equal(run({ SANDBOX_UNAME: "Linux", CI: "true" }), "apply");
  assert.equal(run({ SANDBOX_UNAME: "Linux", CURSOR_AGENT: "1" }), "apply");
});
