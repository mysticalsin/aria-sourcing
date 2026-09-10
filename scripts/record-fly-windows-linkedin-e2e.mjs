#!/usr/bin/env node
/**
 * Fly E2E video: password login → Settings (login-once for agents) →
 * Windows Desktop campaign (tenure + drafts) → OpenBot LinkedIn navigation.
 *
 * Usage:
 *   DEMO_ADMIN_PASSWORD=… ANON_KEY=… \
 *     node --import tsx scripts/record-fly-windows-linkedin-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const APP = process.env.BASE_URL || "https://aria-mantu-app.fly.dev";
const CAMP = "camp_mor1jp00097605_enterprise-windows-desktop-engineer";
const EMAIL = process.env.ARIA_OPERATOR_EMAIL || "Twalteur@amaris.com";
const PASSWORD = process.env.ARIA_OPERATOR_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || "";
const COMPUTERS = (process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev").replace(
  /\/$/,
  "",
);
const BOT = process.env.OPENBOT_BOT_ID || "comp_java_01";
const SUPERVISOR_TOKEN = process.env.COMPUTER_SUPERVISOR_TOKEN || "";
const COMPUTER_TOKEN = process.env.COMPUTER_TOKEN || process.env.OPENBOT_COMPUTER_TOKEN || "";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const CANDIDATE_LI =
  process.env.LINKEDIN_PROFILE_URL || "https://www.linkedin.com/in/zachary-maggard-b0a1b61b/";

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "aria-fly-li-e2e-"));

const dwell = (page, ms) => page.waitForTimeout(ms);

async function dismissModals(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const name of [/got it/i, /skip/i, /dismiss/i, /close/i, /start using/i, /continue/i]) {
    const b = page.getByRole("button", { name });
    if (await b.first().isVisible().catch(() => false)) {
      await b.first().click().catch(() => {});
      await dwell(page, 400);
    }
  }
}

async function ensureOpenBotLinkedIn() {
  if (!SUPERVISOR_TOKEN || !COMPUTER_TOKEN) {
    console.warn("No OpenBot tokens — skip remote navigate prep");
    return { ok: false };
  }
  const headers = {
    authorization: `Bearer ${SUPERVISOR_TOKEN}`,
    "content-type": "application/json",
  };
  const computerHeaders = {
    authorization: `Bearer ${COMPUTER_TOKEN}`,
    "x-openbot-computer-token": COMPUTER_TOKEN,
    "content-type": "application/json",
  };
  await fetch(`${COMPUTERS}/computers/${BOT}/ensure`, {
    method: "POST",
    headers,
    body: "{}",
  }).catch(() => null);
  await fetch(`${COMPUTERS}/c/${BOT}/control/release`, {
    method: "POST",
    headers: computerHeaders,
    body: "{}",
  }).catch(() => null);
  // Warm LinkedIn feed first, then a candidate profile (navigation story).
  for (const url of ["https://www.linkedin.com/feed/", CANDIDATE_LI]) {
    const nav = await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
      method: "POST",
      headers: computerHeaders,
      body: JSON.stringify({ url }),
    }).catch(() => null);
    const body = nav ? await nav.json().catch(() => ({})) : {};
    console.log(`navigate ${url} ->`, body.title || body.error || nav?.status);
    await new Promise((r) => setTimeout(r, 2200));
  }
  await fetch(`${COMPUTERS}/c/${BOT}/control/take`, {
    method: "POST",
    headers: computerHeaders,
    body: "{}",
  }).catch(() => null);
  return { ok: true, view: `${COMPUTERS}/view/${BOT}?fs=1` };
}

async function main() {
  if (!PASSWORD) throw new Error("ARIA_OPERATOR_PASSWORD / DEMO_ADMIN_PASSWORD required");

  const openbot = await ensureOpenBotLinkedIn();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  // 1) Password login
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.fill("#login-username", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.locator('#login-email-form button[type="submit"]').click();
  await dwell(page, 5000);
  await dismissModals(page);
  console.log("after login", page.url());

  // 2) Settings → Integrations → LinkedIn login-once
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle", timeout: 60_000 });
  await dwell(page, 2000);
  await dismissModals(page);
  const integ = page.getByRole("tab", { name: /integrations/i }).or(
    page.locator("button, a").filter({ hasText: /integrations/i }),
  );
  if (await integ.first().isVisible().catch(() => false)) {
    await integ.first().click().catch(() => {});
    await dwell(page, 1500);
  }
  // Expand LinkedIn stack if accordion
  const liStack = page.getByText(/Identity & outreach|LinkedIn stack|Login once/i).first();
  if (await liStack.isVisible().catch(() => false)) {
    await liStack.click().catch(() => {});
    await dwell(page, 1200);
  }
  await page
    .getByText(/Login once — agents use this account|Open LinkedIn login for agents/i)
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await dwell(page, 2500);
  await page.screenshot({ path: path.join(OUT, "fly-settings-linkedin-login-once.png") });

  // 3) Campaign: tenure + contact-ready
  await page.goto(`${APP}/campaigns/${CAMP}`, { waitUntil: "networkidle", timeout: 60_000 });
  await dwell(page, 3500);
  await dismissModals(page);
  await page.screenshot({ path: path.join(OUT, "fly-e2e-campaign-overview.png") });
  await dwell(page, 1800);

  const candTab = page.locator('[role="tab"]').filter({ hasText: /Candidates/i }).first();
  await candTab.click();
  await dwell(page, 1500);
  await page.getByText("Francois Lafond").first().scrollIntoViewIfNeeded().catch(() => {});
  await dwell(page, 2000);
  await page.screenshot({ path: path.join(OUT, "fly-e2e-candidates-tenure.png") });

  const outTab = page.locator('[role="tab"]').filter({ hasText: /Outreach/i }).first();
  await outTab.click();
  await dwell(page, 2000);
  await page.screenshot({ path: path.join(OUT, "fly-e2e-outreach-drafts.png") });

  // Agents tab if present
  const agentsTab = page.locator('[role="tab"]').filter({ hasText: /Agents/i }).first();
  if (await agentsTab.isVisible().catch(() => false)) {
    await agentsTab.click();
    await dwell(page, 2000);
    await page.screenshot({ path: path.join(OUT, "fly-e2e-agents.png") });
  }

  // 4) OpenBot LinkedIn navigation (separate tab in same recording context)
  const viewUrl = openbot.view || `${COMPUTERS}/view/${BOT}?fs=1`;
  const liPage = await context.newPage();
  await liPage.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dwell(liPage, 5000);
  await liPage.screenshot({ path: path.join(OUT, "fly-e2e-linkedin-vm.png") });
  // Show candidate profile hop again for the camera
  if (COMPUTER_TOKEN) {
    await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${COMPUTER_TOKEN}`,
        "x-openbot-computer-token": COMPUTER_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: CANDIDATE_LI }),
    }).catch(() => null);
    await dwell(liPage, 4000);
  }
  await dwell(liPage, 2500);
  await liPage.close();

  // Back to campaign outreach for closing beat
  await page.bringToFront();
  await page.locator('[role="tab"]').filter({ hasText: /Outreach/i }).first().click().catch(() => {});
  await dwell(page, 2500);

  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  const webm = videoPath && fs.existsSync(videoPath) ? videoPath : null;
  const outMp4 = path.join(OUT, "aria-fly-windows-linkedin-e2e.mp4");
  const outWebm = path.join(OUT, "aria-fly-windows-linkedin-e2e.webm");
  if (webm) {
    fs.copyFileSync(webm, outWebm);
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outMp4],
      { encoding: "utf8" },
    );
    console.log("ffmpeg", ff.status, ff.stderr?.slice(-200));
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        webm: outWebm,
        mp4: fs.existsSync(outMp4) ? outMp4 : null,
        openbot,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
