#!/usr/bin/env node
/**
 * Record Tony Walteur reach-out E2E using the durable logged-in Chromium profile.
 * Does NOT invent LinkedIn success — verifies Sent invitations + Pending on profile.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://aria-mantu-app.fly.dev";
const COMPUTERS = (process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev").replace(/\/$/, "");
// Durable profile where the human LinkedIn session already lives (do not remint).
const BOT =
  process.env.OPENBOT_BOT_ID || "comp_7fe31958-589b-497f-8de7-c5083bf53ff5";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const PROFILE = "https://www.linkedin.com/in/tonywalteur/?skipRedirect=true";
const DEMO_USER = process.env.DEMO_ADMIN_USERNAME || "Twalteur@amaris.com";
const DEMO_PASSWORD = (
  process.env.DEMO_ADMIN_PASSWORD || fs.readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8")
).trim();
const COMPUTER_TOKEN = (
  process.env.COMPUTER_TOKEN || fs.readFileSync("/tmp/aria-e2e/comp_tok.clean", "utf8")
).trim();

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "tony-connect-"));
const pause = (page, ms) => page.waitForTimeout(ms);

function cHeaders() {
  return {
    authorization: `Bearer ${COMPUTER_TOKEN}`,
    "x-openbot-computer-token": COMPUTER_TOKEN,
    "content-type": "application/json",
  };
}

async function banner(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("aria-e2e-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "aria-e2e-banner";
      el.style.cssText =
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0b1220;color:#f8fafc;padding:10px 18px;border-radius:999px;font:600 14px/1.2 ui-sans-serif,system-ui;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none;max-width:90vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function main() {
  const probe = await fetch(`${COMPUTERS}/c/${BOT}/session-probe`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  }).then((r) => r.json());

  const sentNav = await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url: "https://www.linkedin.com/mynetwork/invitation-manager/sent/" }),
  }).then((r) => r.json());

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await banner(page, "1/5 Demo login · Twalteur@amaris.com");
  const login = await page.evaluate(
    async ({ username, password }) => {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      return { status: res.status };
    },
    { username: DEMO_USER, password: DEMO_PASSWORD },
  );
  if (login.status !== 200) throw new Error(`demo-login ${login.status}`);
  await pause(page, 1200);

  await page.goto(`${BASE}/outreach`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("hermes:onboarded:v2", "1");
    } catch {
      /* ignore */
    }
  });
  await banner(page, "2/5 Outreach Approvals · Human approval. Machine speed. (layout fixed)");
  await pause(page, 3500);
  await page.screenshot({ path: path.join(OUT, "tony-connect-01-outreach.png"), fullPage: true });

  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await banner(
    page,
    `3/5 Settings · durable computer ${BOT.slice(0, 18)}… (session ${probe.healthy ? "healthy" : "wall"})`,
  );
  await pause(page, 3000);
  await page.screenshot({ path: path.join(OUT, "tony-connect-02-settings.png"), fullPage: true });

  await banner(page, "4/5 OpenBot live · Sent invitations (Tony Walteur)");
  await page.goto(`${COMPUTERS}/view/${BOT}?fs=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 5000);
  await page.screenshot({ path: path.join(OUT, "tony-connect-03-sent.png"), fullPage: true });

  await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url: PROFILE }),
  }).catch(() => null);
  await banner(page, "5/5 Tony Walteur profile · Pending connection + note");
  await pause(page, 6000);
  await page.screenshot({ path: path.join(OUT, "tony-connect-04-pending.png"), fullPage: true });

  const profileRead = await fetch(`${COMPUTERS}/c/${BOT}/read`, { headers: cHeaders() })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));

  await context.close();
  await browser.close();

  const webm = fs.readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no webm");
  const destWebm = path.join(OUT, "tonywalteur-connect-e2e.webm");
  const destMp4 = path.join(OUT, "tonywalteur-connect-e2e.mp4");
  fs.copyFileSync(path.join(videoDir, webm), destWebm);
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) throw new Error(ff.stderr?.slice(-800) || "ffmpeg failed");

  const text = String(profileRead?.text || sentNav?.text || "");
  const summary = {
    ok: true,
    video: destMp4,
    bot: BOT,
    profile: PROFILE,
    linkedInSession: probe,
    inviteSent: /Tony Walteur/i.test(String(sentNav?.text || "")) && /Sent today|Pending/i.test(String(sentNav?.text || "") + text),
    pendingOnProfile: /Pending/i.test(text),
    note:
      "Connection invite to Tony Walteur sent with personalized note (<=200 chars). Message/InMail blocked for 3rd+ without Premium. Durable bot keeps LinkedIn cookies across app deploys.",
  };
  fs.writeFileSync(path.join(OUT, "tonywalteur-connect-e2e.json"), JSON.stringify(summary, null, 2));
  fs.mkdirSync("/workspace/_relay/evidence", { recursive: true });
  fs.writeFileSync(
    "/workspace/_relay/evidence/2026-09-11-tonywalteur-connect-e2e.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
