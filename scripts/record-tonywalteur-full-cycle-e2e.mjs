#!/usr/bin/env node
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
const DEMO_PASSWORD = (process.env.DEMO_ADMIN_PASSWORD || fs.readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8")).trim();
const COMPUTER_TOKEN = (process.env.COMPUTER_TOKEN || fs.readFileSync("/tmp/aria-e2e/comp_tok.clean", "utf8")).trim();
const SUPERVISOR_TOKEN = (process.env.SUPERVISOR_TOKEN || fs.readFileSync("/tmp/aria-e2e/sup_tok.clean", "utf8")).trim();

const OUTREACH =
  "Hi Tony, watching what you are building with Ultron and Mantu's agentic operating model. We are running Aria end-to-end sourcing on Fly OpenBot Chromium and would love 15 minutes to compare notes on enterprise AI adoption. Open to a short chat this week?";

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "tonywalteur-e2e-"));
const pause = (page, ms) => page.waitForTimeout(ms);

function cHeaders() {
  return {
    authorization: `Bearer ${COMPUTER_TOKEN}`,
    "x-openbot-computer-token": COMPUTER_TOKEN,
    "content-type": "application/json",
  };
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
    headers: cHeaders(),
    body: JSON.stringify({ url }),
  }).catch(() => null);
  return res ? res.json().catch(() => ({})) : {};
}

async function botTake() {
  await fetch(`${COMPUTERS}/c/${BOT}/control/take`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  }).catch(() => null);
}

async function botNewTab(url) {
  await fetch(`${COMPUTERS}/c/${BOT}/tabs/new`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url }),
  }).catch(() => null);
}

async function dismiss(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const name of [/got it/i, /skip/i, /dismiss/i, /close/i, /continue/i, /accept/i]) {
    const b = page.getByRole("button", { name });
    if (await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {});
  }
}

async function clickText(page, re) {
  const loc = page.getByText(re).first();
  if (await loc.count()) {
    await loc.click({ force: true }).catch(() => {});
    return true;
  }
  return false;
}

async function main() {
  if (/[\u2014\u2013]/.test(OUTREACH)) throw new Error("outreach has em/en dash");

  await ensureBot();
  const nav = await botNavigate(PROFILE);
  await botTake();
  console.log("bot nav title", nav.title || nav.url || "");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const loginStatus = await page.evaluate(async ({ username, password }) => {
    const res = await fetch("/api/auth/demo-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.text() };
  }, { username: DEMO_USER, password: DEMO_PASSWORD });
  console.log("demo-login", loginStatus.status);
  if (loginStatus.status !== 200) throw new Error(`demo-login failed: ${loginStatus.status}`);

  
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 2000);
  await dismiss(page);
  await clickText(page, /skills|agent skills|humanizer/i);
  await pause(page, 1500);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-00-skills.png"), fullPage: true });

await page.goto(`${BASE}/campaigns`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 4000);
  await dismiss(page);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-01-campaigns.png"), fullPage: true });

  // Try create campaign via UI affordances
  const newBtn = page.getByRole("button", { name: /new campaign|create campaign|start campaign|\+/i }).first();
  if (await newBtn.count()) {
    await newBtn.click({ force: true }).catch(() => {});
    await pause(page, 1500);
  } else {
    await clickText(page, /new campaign|create campaign/i);
    await pause(page, 1500);
  }

  // Fill any visible textboxes with JD / name hints
  const boxes = page.locator("textarea, input[type='text']");
  const count = await boxes.count();
  for (let i = 0; i < Math.min(count, 6); i++) {
    const el = boxes.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const ph = ((await el.getAttribute("placeholder")) || "").toLowerCase();
    const name = ((await el.getAttribute("name")) || "").toLowerCase();
    if (/job|role|description|jd|brief/.test(ph + name) || i === 0) {
      await el.fill(
        "Senior AI / Innovation leader in Montreal. Partner with engineering on agentic systems, enterprise IT transformation, and applied LLM programs. Target profile: Tony Walteur style AI and innovation leadership.",
      ).catch(() => {});
    }
    if (/name|title|campaign/.test(ph + name)) {
      await el.fill("Tony Walteur Aria E2E").catch(() => {});
    }
  }
  const submit = page.getByRole("button", { name: /create|continue|analyze|start|save|next/i }).first();
  if (await submit.count()) await submit.click({ force: true }).catch(() => {});
  await pause(page, 5000);
  await dismiss(page);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-02-campaign-create.png"), fullPage: true });

  // Candidate / LinkedIn URL entry
  await clickText(page, /candidates|pipeline|people/i);
  await pause(page, 1500);
  const addCand = page.getByRole("button", { name: /add candidate|import|linkedin|manual|add/i }).first();
  if (await addCand.count()) await addCand.click({ force: true }).catch(() => {});
  await pause(page, 1000);
  const urlBox = page.locator("input[placeholder*='linkedin' i], input[name*='linkedin' i], input[type='url'], textarea").first();
  if (await urlBox.count()) {
    await urlBox.fill(PROFILE).catch(() => {});
    const add = page.getByRole("button", { name: /add|import|save|submit/i }).first();
    if (await add.count()) await add.click({ force: true }).catch(() => {});
  }
  await pause(page, 3000);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-03-candidate.png"), fullPage: true });

  // Outreach
  await clickText(page, /outreach|messages|sequences/i);
  await pause(page, 2000);
  const gen = page.getByRole("button", { name: /generate|draft|compose|write/i }).first();
  if (await gen.count()) await gen.click({ force: true }).catch(() => {});
  await pause(page, 4000);

  // If a composer is open, ensure humanized body
  const area = page.locator("textarea").first();
  if (await area.count()) {
    const current = await area.inputValue().catch(() => "");
    const cleaned = (current || OUTREACH).replace(/[\u2014\u2013]/g, ", ");
    await area.fill(cleaned).catch(() => {});
  }
  await page.screenshot({ path: path.join(OUT, "tonywalteur-04-outreach.png"), fullPage: true });
  {
    const bodies = await page.locator("textarea").allTextContents();
    for (const b of bodies) {
      if (/[\u2014\u2013]/.test(b)) throw new Error("em/en dash still visible in outreach editor");
    }
  }

  const approve = page.getByRole("button", { name: /approve|send|approve & send|queue/i }).first();
  if (await approve.count()) {
    await approve.click({ force: true }).catch(() => {});
    await pause(page, 2500);
  }
  await page.screenshot({ path: path.join(OUT, "tonywalteur-05-approved.png"), fullPage: true });

  // Agents / live view
  await clickText(page, /agents|fleet|computers|ariabot|openbot/i);
  await pause(page, 2500);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-06-agents.png"), fullPage: true });

  const view = await context.newPage();
  await view.goto(`${COMPUTERS}/view/${BOT}?fs=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(view, 5000);
  await view.screenshot({ path: path.join(OUT, "tonywalteur-07-live-view.png"), fullPage: true });
  await botNewTab(PROFILE);
  await pause(view, 4000);
  await view.screenshot({ path: path.join(OUT, "tonywalteur-08-multitab.png"), fullPage: true });

  const canvas = view.locator("canvas, #canvas, #shot, img").first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      await view.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
      await pause(view, 600);
      await view.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.48);
      await pause(view, 600);
    }
  }
  await pause(view, 3000);
  await view.screenshot({ path: path.join(OUT, "tonywalteur-09-live-interact.png"), fullPage: true });

  // Capture LinkedIn wall/session screenshot via bot screenshot endpoint if present
  try {
    const shot = await fetch(`${COMPUTERS}/c/${BOT}/screenshot`, { headers: cHeaders() });
    if (shot.ok) {
      const buf = Buffer.from(await shot.arrayBuffer());
      fs.writeFileSync(path.join(OUT, "tonywalteur-10-linkedin-session.jpg"), buf);
    }
  } catch {}

  await page.bringToFront();
  await pause(page, 2000);
  await page.screenshot({ path: path.join(OUT, "tonywalteur-11-final.png"), fullPage: true });

  await context.close();
  await browser.close();

  const webm = fs.readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no webm");
  const destWebm = path.join(OUT, "tonywalteur-full-cycle-e2e.webm");
  const destMp4 = path.join(OUT, "tonywalteur-full-cycle-e2e.mp4");
  fs.copyFileSync(path.join(videoDir, webm), destWebm);
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) throw new Error(ff.stderr?.slice(-800) || "ffmpeg failed");

  const probe = await fetch(`${COMPUTERS}/c/${BOT}/session-probe`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));

  const summary = {
    ok: true,
    video: destMp4,
    webm: destWebm,
    outreachHasEmDash: false,
    linkedInSession: probe,
    liveView: `${COMPUTERS}/view/${BOT}?fs=1`,
    profile: PROFILE,
    demoLoginStatus: loginStatus.status,
    note:
      probe?.healthy === true
        ? "LinkedIn session healthy; Connect/Message path ready"
        : "LinkedIn login required once via Take control; session persists on openbot_profiles volume",
  };
  fs.writeFileSync(path.join(OUT, "tonywalteur-full-cycle-e2e.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
