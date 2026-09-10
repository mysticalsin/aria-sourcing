#!/usr/bin/env node
/**
 * Showcase video: AriaBot reaching out on LinkedIn (live VM) + Settings login-to-test.
 *
 * Flow:
 *  1. Aria password login
 *  2. Settings → Log in with LinkedIn (test AriaBot)
 *  3. AriaBot Chromium VM navigates LinkedIn profile + composes outreach
 *  4. Campaign Candidates / Outreach → Approve (bots reaching out)
 *  5. Agents → Observe live AriaBot viewport
 *
 * Env:
 *   ARIA_OPERATOR_PASSWORD / DEMO_ADMIN_PASSWORD
 *   COMPUTER_SUPERVISOR_TOKEN, COMPUTER_TOKEN
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
const PROFILE =
  process.env.LINKEDIN_PROFILE_URL || "https://www.linkedin.com/in/zachary-maggard-b0a1b61b/";
const DEMO_COMPOSE = `${APP}/ariabot/linkedin-outreach.html?name=${encodeURIComponent(
  "Zachary Maggard",
)}&title=${encodeURIComponent("Senior Desktop Engineer · Montreal")}`;

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "ariabot-reachout-"));
const dwell = (page, ms) => page.waitForTimeout(ms);

function cHeaders() {
  return {
    authorization: `Bearer ${COMPUTER_TOKEN}`,
    "x-openbot-computer-token": COMPUTER_TOKEN,
    "content-type": "application/json",
  };
}

async function nav(url) {
  const res = await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  console.log("nav", url, "->", body.title || body.error || res?.status);
  await new Promise((r) => setTimeout(r, 2600));
  return body;
}

async function prepAriaBot() {
  if (!SUPERVISOR_TOKEN || !COMPUTER_TOKEN) return { ok: false };
  await fetch(`${COMPUTERS}/computers/${BOT}/ensure`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SUPERVISOR_TOKEN}`,
      "content-type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
  await fetch(`${COMPUTERS}/c/${BOT}/control/release`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  }).catch(() => null);
  await nav("https://www.linkedin.com/login");
  await nav(PROFILE);
  await nav(DEMO_COMPOSE);
  await fetch(`${COMPUTERS}/c/${BOT}/control/take`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  }).catch(() => null);
  return { ok: true, view: `${COMPUTERS}/view/${BOT}?fs=1` };
}

async function dismiss(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const name of [/got it/i, /skip/i, /dismiss/i, /close/i, /continue/i]) {
    const b = page.getByRole("button", { name });
    if (await b.first().isVisible().catch(() => false)) {
      await b.first().click().catch(() => {});
      await dwell(page, 250);
    }
  }
}

async function main() {
  if (!PASSWORD) throw new Error("ARIA_OPERATOR_PASSWORD required");
  const bot = await prepAriaBot();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  // 1) Login
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.fill("#login-username", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.locator('#login-email-form button[type="submit"]').click();
  await dwell(page, 4500);
  await dismiss(page);
  console.log("logged in", page.url());

  // 2) Settings — LinkedIn login for AriaBot test
  await page.goto(`${APP}/settings?tab=integrations`, { waitUntil: "networkidle", timeout: 60_000 });
  await dwell(page, 2500);
  await dismiss(page);
  const cta = page
    .getByRole("button", {
      name: /Log in with LinkedIn \(test AriaBot\)|Create AriaBot seat & log in with LinkedIn|Log in with LinkedIn to test AriaBot/i,
    })
    .or(page.getByText(/Log in with LinkedIn to test AriaBot/i));
  await cta.first().scrollIntoViewIfNeeded().catch(() => {});
  await dwell(page, 1800);
  await page.screenshot({ path: path.join(OUT, "ariabot-settings-linkedin-login.png") });
  const popupPromise = page.waitForEvent("popup", { timeout: 10_000 }).catch(() => null);
  await cta.first().click({ timeout: 8000 }).catch(async () => {
    // Fallback: click any LinkedIn login button in the AriaBot card
    await page.getByRole("button", { name: /LinkedIn/i }).first().click().catch(() => {});
  });
  const popup = await popupPromise;
  await dwell(page, 2000);

  // 3) AriaBot VM live — LinkedIn + compose
  const vm = popup || (await context.newPage());
  await vm.goto(bot.view || `${COMPUTERS}/view/${BOT}?fs=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await dwell(vm, 3500);
  await vm.screenshot({ path: path.join(OUT, "ariabot-vm-linkedin.png") });

  if (COMPUTER_TOKEN) {
    await fetch(`${COMPUTERS}/c/${BOT}/control/release`, {
      method: "POST",
      headers: cHeaders(),
      body: "{}",
    }).catch(() => null);
    await nav(PROFILE);
    await dwell(vm, 3000);
    await nav(DEMO_COMPOSE);
    await dwell(vm, 8000);
    await vm.screenshot({ path: path.join(OUT, "ariabot-vm-composing.png") });
  }

  // 4) Campaign — bots reaching out
  await page.bringToFront();
  await page.goto(`${APP}/campaigns/${CAMP}`, { waitUntil: "networkidle", timeout: 60_000 });
  await dwell(page, 2800);
  await dismiss(page);
  await page.screenshot({ path: path.join(OUT, "ariabot-campaign.png") });

  await page.locator('[role="tab"]').filter({ hasText: /Candidates/i }).first().click();
  await dwell(page, 1600);
  await page.screenshot({ path: path.join(OUT, "ariabot-candidates.png") });

  await page.locator('[role="tab"]').filter({ hasText: /Outreach/i }).first().click();
  await dwell(page, 2000);
  await page.screenshot({ path: path.join(OUT, "ariabot-outreach.png") });
  for (const name of [/approve/i, /send approved/i, /queue send/i, /dispatch/i]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await dwell(page, 1800);
    }
  }
  await page.screenshot({ path: path.join(OUT, "ariabot-outreach-approved.png") });

  // 5) Agents observe
  const agents = page.locator('[role="tab"]').filter({ hasText: /Agents/i }).first();
  if (await agents.isVisible().catch(() => false)) {
    await agents.click();
    await dwell(page, 1800);
    for (const name of [/observe/i, /start/i, /take control/i]) {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await dwell(page, 3000);
        break;
      }
    }
    await page.screenshot({ path: path.join(OUT, "ariabot-agents-observe.png") });
  }

  // Closing: VM composing
  await vm.bringToFront();
  if (COMPUTER_TOKEN) {
    await fetch(`${COMPUTERS}/c/${BOT}/control/release`, {
      method: "POST",
      headers: cHeaders(),
      body: "{}",
    }).catch(() => null);
    await nav(DEMO_COMPOSE);
    await dwell(vm, 7000);
  }
  await vm.screenshot({ path: path.join(OUT, "ariabot-vm-final-send.png") });

  await context.close();
  await browser.close();

  const webms = fs
    .readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(videoDir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  if (webms.length === 0) throw new Error("no video");

  let source = webms[0];
  if (webms.length > 1) {
    const list = path.join(videoDir, "concat.txt");
    fs.writeFileSync(list, webms.map((f) => `file '${f}'`).join("\n"));
    const joined = path.join(videoDir, "joined.webm");
    const c = spawnSync(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined],
      { encoding: "utf8" },
    );
    if (c.status === 0 && fs.existsSync(joined)) source = joined;
  }

  const outWebm = path.join(OUT, "ariabot-linkedin-reachout-showcase.webm");
  const outMp4 = path.join(OUT, "ariabot-linkedin-reachout-showcase.mp4");
  fs.copyFileSync(source, outWebm);

  const srt = path.join(videoDir, "captions.srt");
  fs.writeFileSync(
    srt,
    `1
00:00:00,500 --> 00:00:07,000
Aria password login

2
00:00:07,500 --> 00:00:18,000
Settings · Log in with LinkedIn to test AriaBot

3
00:00:18,500 --> 00:00:42,000
AriaBot VM · LinkedIn profile + composing outreach

4
00:00:42,500 --> 00:00:58,000
Campaign · Approve outreach · bots reaching out

5
00:00:58,500 --> 00:01:25,000
Agents Observe · AriaBot live on LinkedIn
`,
  );

  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      source,
      "-vf",
      `subtitles=${srt}:force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=28'`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { encoding: "utf8" },
  );
  console.log("ffmpeg", ff.status, (ff.stderr || "").slice(-250));
  console.log(
    JSON.stringify(
      {
        ok: true,
        mp4: fs.existsSync(outMp4) ? outMp4 : null,
        webm: outWebm,
        bot,
        shots: fs.readdirSync(OUT).filter((f) => f.startsWith("ariabot-")),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
