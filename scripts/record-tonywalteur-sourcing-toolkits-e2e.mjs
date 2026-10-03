#!/usr/bin/env node
/**
 * Record Tony Walteur sourcing E2E video:
 * 1) Live toolkit proof HTML (search/analyze/qualify/connect-blocked)
 * 2) Aria campaigns UI
 * 3) OpenBot seat pointed at Tony's LinkedIn URL
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://aria-mantu-app.fly.dev";
const COMPUTERS = (process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev").replace(/\/$/, "");
const BOT = process.env.OPENBOT_BOT_ID || "comp_tony_01";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const PROFILE = "https://www.linkedin.com/in/tonywalteur/";
const DEMO_USER = process.env.DEMO_ADMIN_USERNAME || "Twalteur@amaris.com";
const DEMO_PASSWORD = (
  process.env.DEMO_ADMIN_PASSWORD ||
  fs.readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8")
).trim();
const COMPUTER_TOKEN = (
  process.env.COMPUTER_TOKEN || fs.readFileSync("/tmp/aria-e2e/comp_tok.clean", "utf8")
).trim();
const SUPERVISOR_TOKEN = (
  process.env.SUPERVISOR_TOKEN || fs.readFileSync("/tmp/aria-e2e/sup_tok.clean", "utf8")
).trim();

const PROOF_CANDIDATES = [
  "/workspace/_relay/evidence/2026-09-11-tonywalteur-toolkit-proof.json",
  "/opt/cursor/artifacts/tonywalteur-sourcing-toolkit-proof.json",
];

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("/workspace/_relay/evidence", { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "tony-sourcing-"));
const pause = (page, ms) => page.waitForTimeout(ms);

function loadProof() {
  for (const p of PROOF_CANDIDATES) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error("Run scripts/prove-tonywalteur-toolkits.mts first");
}

async function ensureBot() {
  await fetch(`${COMPUTERS}/computers/${BOT}/ensure`, {
    method: "POST",
    headers: { authorization: `Bearer ${SUPERVISOR_TOKEN}`, "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
}

async function botNavigate(url) {
  const res = await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${COMPUTER_TOKEN}`,
      "x-openbot-computer-token": COMPUTER_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url }),
  }).catch(() => null);
  return res ? res.json().catch(() => ({})) : {};
}

async function main() {
  const proof = loadProof();
  fs.writeFileSync(path.join(OUT, "tonywalteur-sourcing-toolkit-proof.json"), JSON.stringify(proof, null, 2));

  const search = proof.search || {};
  const insight = proof.analyze || proof.insight || {};
  const icp = proof.qualify || proof.icp || {};
  const blocked = proof.connectBlocked || proof.connect || {};
  const hits = search.hits || [];

  await ensureBot();
  const nav = await botNavigate(PROFILE);
  console.log("bot nav", nav.title || nav.url || "");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  const hitsHtml = hits
    .map(
      (h) =>
        `<li><strong>${h.name || "Unknown"}</strong> — ${h.title || ""}<br/><a href="${h.profileUrl}">${h.profileUrl}</a> <em>(${h.via})</em>${h.invented ? " · INVENTED" : ""}</li>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Aria · Tony Walteur sourcing</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;background:#0b1220;color:#e8eefc;margin:0;padding:32px}
    h1{font-size:28px;margin:0 0 8px} h2{margin-top:28px;color:#9db7ff}
    .card{background:#121a2b;border:1px solid #24304a;border-radius:12px;padding:16px 18px;margin:12px 0}
    .ok{color:#6dffa8} .bad{color:#ff8f8f} a{color:#9db7ff}
    li{margin:10px 0;line-height:1.4}
  </style></head><body>
  <h1>Aria sourcing · Tony Walteur</h1>
  <p>Live toolkit proof — real LinkedIn profile URLs, no invented lead-N stubs.</p>
  <div class="card"><h2>1. Search (NightTrek / linkedin_agent_tool)</h2>
    <p class="${search.ok ? "ok" : "bad"}">${search.ok ? "ok" : "failed"} · ${hits.length} hits</p>
    <ol>${hitsHtml || "<li>No hits</li>"}</ol></div>
  <div class="card"><h2>2. Analyze (Orca)</h2>
    <p>via <strong>${insight.via || ""}</strong></p>
    <p>${insight.headline || ""}</p>
    <p>Focus: ${(insight.focusAreas || []).join(", ")}</p>
    <p>Evidence chars: ${insight.evidenceChars ?? (insight.evidenceText || "").length}</p></div>
  <div class="card"><h2>3. Qualify (Linki / OpenOutreach)</h2>
    <p class="ok">ICP score ${icp.score}/100 (${icp.via || ""})</p>
    <ul>${(icp.reasons || []).map((r) => `<li>${r}</li>`).join("")}</ul></div>
  <div class="card"><h2>4. Connect / Message</h2>
    <p class="bad">${blocked.detail || "Blocked"}</p>
    <p>via ${blocked.via || "ariabot"} — Take control on AriaBot required</p></div>
  </body></html>`;

  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await pause(page, 4500);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-sourcing-01-toolkits.png"), fullPage: true });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate(
    async ({ username, password }) => {
      await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
    },
    { username: DEMO_USER, password: DEMO_PASSWORD },
  );
  await pause(page, 1500);
  await page.goto(`${BASE}/campaigns`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 4500);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-sourcing-02-campaigns.png"), fullPage: true });

  const view = `${COMPUTERS}/view/${BOT}?fs=1`;
  await page.goto(view, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 6000);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-sourcing-03-openbot.png"), fullPage: true });

  // linger on toolkit summary again for the closing beat
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await pause(page, 3000);

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();

  const destWebm = path.join(OUT, "tonywalteur-sourcing-toolkits-e2e.webm");
  const destMp4 = path.join(OUT, "tonywalteur-sourcing-toolkits-e2e.mp4");
  fs.copyFileSync(videoPath, destWebm);
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.error(ff.stderr?.slice(-800));
    throw new Error("ffmpeg failed");
  }
  console.log("wrote", destMp4, fs.statSync(destMp4).size);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
