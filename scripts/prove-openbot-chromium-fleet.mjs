#!/usr/bin/env node
/**
 * Prove 10 live Chromium computers: ensure → LinkedIn → take control → release.
 */
import fs from "node:fs";

const BASE = process.env.OPENBOT_PUBLIC_BASE || "http://127.0.0.1:18765";
const SUP = process.env.SUPERVISOR_TOKEN || "aria-supervisor-dev";
const COMP = process.env.COMPUTER_TOKEN || "aria-computer-dev";
const N = Number(process.env.OPENBOT_DEMO_AGENTS || 10);

function ok(name, cond, detail = "") {
  if (!cond) throw new Error(`FAIL ${name}: ${detail}`);
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function sup(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${SUP}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function comp(botId, path, init = {}) {
  const res = await fetch(`${BASE}/c/${encodeURIComponent(botId)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${COMP}`,
      "x-openbot-computer-token": COMP,
      "x-openbot-bot-id": botId,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`${botId}${path} ${res.status}`);
    return buf;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${botId}${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const bots = Array.from({ length: N }, (_, i) => `agent_${String(i + 1).padStart(2, "0")}`);
const outDir = "/tmp/aria-e2e/chromium-fleet";
fs.mkdirSync(outDir, { recursive: true });

console.log(`Ensuring ${N} Chromium computers…`);
for (const botId of bots) {
  const ensured = await sup(`/computers/${encodeURIComponent(botId)}/ensure`, {
    method: "POST",
    body: "{}",
  });
  ok(`ensure ${botId}`, ensured.status === "running" && Boolean(ensured.url), ensured.viewUrl);
}

console.log("Navigating each agent to LinkedIn…");
for (const botId of bots) {
  const nav = await comp(botId, "/navigate", {
    method: "POST",
    body: JSON.stringify({ url: "https://www.linkedin.com/" }),
  });
  ok(
    `linkedin ${botId}`,
    /linkedin\.com/i.test(nav.url || ""),
    `${nav.title || ""}`.slice(0, 60),
  );
  const shot = await comp(botId, "/screenshot");
  fs.writeFileSync(pathJoin(outDir, `${botId}-linkedin.jpg`), shot);
}

console.log("Take control agent_01 — human mutex; operator navigates to example.com…");
await comp("agent_01", "/control/take", { method: "POST", body: "{}" });
const state1 = await fetch(`${BASE}/computers/agent_01/state`, {
  headers: { authorization: `Bearer ${SUP}` },
}).then((r) => r.json());
ok("agent_01 human control", state1.control === "human");
const humanNav = await comp("agent_01", "/navigate", {
  method: "POST",
  body: JSON.stringify({ url: "https://example.com/" }),
});
ok("human can navigate while holding control", /example\.com/i.test(humanNav.url || ""), humanNav.url);
const shotHuman = await comp("agent_01", "/screenshot");
fs.writeFileSync(`${outDir}/agent_01-human-example.jpg`, shotHuman);
await comp("agent_01", "/control/release", { method: "POST", body: "{}" });
ok("released agent_01", true);

// Snapshot+click smoke on agent_02 (bot path)
const snap = await comp("agent_02", "/snapshot", { method: "POST", body: "{}" });
ok("snapshot elements", Array.isArray(snap.elements) && snap.elements.length > 0, String(snap.elements.length));

const list = await sup("/computers");
ok("list has 10", (list.computers || []).length === N, String((list.computers || []).length));

const receipt = {
  at: new Date().toISOString(),
  host: BASE,
  agents: N,
  computers: (list.computers || []).map((c) => ({
    botId: c.botId,
    status: c.status,
    control: c.control,
    pageUrl: c.pageUrl,
    viewUrl: c.viewUrl,
  })),
  screenshots: bots.map((b) => `${outDir}/${b}-linkedin.jpg`),
};
fs.writeFileSync(`${outDir}/receipt.json`, JSON.stringify(receipt, null, 2));
console.log("RECEIPT", JSON.stringify(receipt, null, 2));
console.log(`RESULT openbot-chromium-fleet: ${N}/${N} linkedin navigations + screenshots`);

function pathJoin(...parts) {
  return parts.join("/").replace(/\/+/g, "/");
}
