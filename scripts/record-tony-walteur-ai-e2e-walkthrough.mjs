#!/usr/bin/env node
/**
 * Continuous video: Fly Aria → need/campaign → Tony Walteur outreach draft
 * (≤200 humanized Connect note) → fleet/session honesty → Connect surface.
 * Does NOT invent LinkedIn delivery when sessionHealthy is false.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://aria-mantu-app.fly.dev";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const PROFILE = "https://www.linkedin.com/in/tonywalteur/";
const DEMO_USER = process.env.DEMO_ADMIN_USERNAME || "Twalteur@amaris.com";
const DEMO_PASSWORD = (
  process.env.DEMO_ADMIN_PASSWORD ||
  fs.readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8")
).trim();

const NOTE =
  "Hi Tony, your Ultron / Mantu agentic ops work stood out. Open to a short chat on enterprise AI adoption this week?";

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "tony-e2e-ai-"));
const pause = (page, ms) => page.waitForTimeout(ms);

async function skipOnboarding(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("hermes:onboarded:v2", "1");
    } catch {
      /* ignore */
    }
  });
  for (const name of [/skip tour/i, /got it/i, /get started/i, /dismiss/i, /close/i]) {
    const b = page.getByRole("button", { name });
    if (await b.first().isVisible().catch(() => false)) {
      await b.first().click({ force: true }).catch(() => {});
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function waitWorkspace(page, ms = 60_000) {
  const splash = page.getByText(/connecting to your workspace/i);
  try {
    await splash.waitFor({ state: "hidden", timeout: ms });
  } catch {
    /* continue */
  }
}

async function demoLogin(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 1500);
  // Demo login uses username field (not email)
  const user = page.locator('input[name="username"], input#username, input[type="text"]').first();
  const pass = page.locator('input[name="password"], input#password, input[type="password"]').first();
  await user.fill(DEMO_USER);
  await pass.fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in|continue|enter demo/i }).first().click();
  await pause(page, 4000);
  await waitWorkspace(page);
  await skipOnboarding(page);
}

async function go(page, pathName) {
  await page.goto(`${BASE}${pathName}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await pause(page, 2500);
  await skipOnboarding(page);
}

async function main() {
  console.log(JSON.stringify({ base: BASE, noteLen: NOTE.length, out: OUT }));
  if (NOTE.length > 200) throw new Error("Demo note must be ≤200 chars");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const receipt = {
    at: new Date().toISOString(),
    base: BASE,
    note: NOTE,
    noteLength: NOTE.length,
    steps: [],
  };

  try {
    await demoLogin(page);
    receipt.steps.push({ step: "login", url: page.url() });
    await pause(page, 2000);

    // Get started / settings stack
    await go(page, "/settings?tab=setup");
    receipt.steps.push({ step: "settings-setup", url: page.url() });
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-01-setup.png"), fullPage: false });
    await pause(page, 2500);

    await go(page, "/settings?tab=integrations");
    await page.locator("#linkedin-outreach-stack, [id*='linkedin']").first().scrollIntoViewIfNeeded().catch(() => {});
    receipt.steps.push({ step: "settings-integrations", url: page.url() });
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-02-linkedin-stack.png"), fullPage: false });
    await pause(page, 3000);

    // Campaigns / agents
    await go(page, "/campaigns");
    receipt.steps.push({ step: "campaigns", url: page.url() });
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-03-campaigns.png"), fullPage: false });
    await pause(page, 2500);

    const firstCampaign = page.locator('a[href*="/campaigns/"]').first();
    if (await firstCampaign.isVisible().catch(() => false)) {
      await firstCampaign.click();
      await pause(page, 3000);
      await skipOnboarding(page);
      receipt.steps.push({ step: "campaign-detail", url: page.url() });
      await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-04-campaign.png"), fullPage: false });

      // Agents tab if present
      const agentsTab = page.getByRole("tab", { name: /agents/i }).or(page.getByRole("link", { name: /agents/i }));
      if (await agentsTab.first().isVisible().catch(() => false)) {
        await agentsTab.first().click();
        await pause(page, 2500);
        receipt.steps.push({ step: "campaign-agents", url: page.url() });
        await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-05-agents.png"), fullPage: false });
      }
    }

    // Outreach
    await go(page, "/outreach");
    receipt.steps.push({ step: "outreach", url: page.url() });
    // Inject a visible draft card via clipboard paste into any textarea if present
    const ta = page.locator("textarea").first();
    if (await ta.isVisible().catch(() => false)) {
      await ta.fill(NOTE);
      receipt.steps.push({ step: "draft-note", length: NOTE.length });
    }
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-06-outreach.png"), fullPage: false });
    await pause(page, 3000);

    // Fleet / computers — show session honesty
    await go(page, "/fleet");
    receipt.steps.push({ step: "fleet", url: page.url() });
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-07-fleet.png"), fullPage: false });
    await pause(page, 3500);

    // Floor
    await go(page, "/floor");
    receipt.steps.push({ step: "floor", url: page.url() });
    await page.screenshot({ path: path.join(OUT, "2026-09-12-tony-08-floor.png"), fullPage: false });
    await pause(page, 3500);

    // Final title card via evaluate overlay
    await page.evaluate(
      ({ note, profile }) => {
        const el = document.createElement("div");
        el.style.cssText =
          "position:fixed;inset:0;z-index:99999;background:#0b1220;color:#f8fafc;display:flex;flex-direction:column;justify-content:center;padding:64px;font-family:ui-sans-serif,system-ui";
        el.innerHTML = `<h1 style="font-size:42px;margin:0 0 16px">Tony Walteur — Aria e2e</h1>
          <p style="font-size:20px;opacity:.85;max-width:900px">Connect note (${note.length}/200): ${note}</p>
          <p style="font-size:18px;opacity:.7;margin-top:24px">Profile: ${profile}</p>
          <p style="font-size:16px;opacity:.55;margin-top:32px">Delivery only claims success with sessionHealthy + Sent/Pending UI proof. Invitations surface under My Network → Invitations (not Messaging).</p>`;
        document.body.appendChild(el);
      },
      { note: NOTE, profile: PROFILE },
    );
    await pause(page, 5000);
    receipt.steps.push({ step: "closing-card" });
  } catch (err) {
    receipt.error = String(err?.stack || err);
    console.error(receipt.error);
  }

  const vidPath = await page.video().path();
  await context.close();
  await browser.close();

  const dest = path.join(OUT, "2026-09-12-tony-walteur-ai-e2e-walkthrough.webm");
  fs.copyFileSync(vidPath, dest);
  // Prefer mp4 for sharing
  const mp4 = path.join(OUT, "2026-09-12-tony-walteur-ai-e2e-walkthrough.mp4");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", dest, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { encoding: "utf8" },
  );
  receipt.videoWebm = dest;
  receipt.videoMp4 = ff.status === 0 ? mp4 : null;
  receipt.ffmpeg = ff.status;
  fs.writeFileSync(
    path.join(OUT, "2026-09-12-tony-walteur-ai-e2e-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  fs.writeFileSync(
    path.join("/workspace/_relay/evidence", "2026-09-12-tony-walteur-ai-e2e-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.error) process.exitCode = 1;
}

main();
