/**
 * E2E video: Campaign Agents → Outreach Approve → Send (LinkedIn reach-out UX).
 * Delivery wiring is proven separately by scripts/prove-linkedin-campaign-reachout.mjs
 * (mock sent + Fly Chromium linkedin_send → login wall / Take control).
 *
 * BASE_URL=http://127.0.0.1:3040 npx tsx scripts/record-linkedin-campaign-send-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3040";
const OUT_DIR = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const EVIDENCE = path.join(process.cwd(), "_relay/evidence");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "aria-li-send-"));

async function dismissOverlays(page) {
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.count()) {
    await skip.first().click({ force: true }).catch(() => null);
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(200);
}

async function demoLogin(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);
  const cta = page.getByRole("button", { name: /enter the demo console/i });
  if (await cta.count()) {
    await cta.first().click();
  } else {
    await page.evaluate(async () => {
      await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: "admin", password: "admin" }),
      });
    });
  }
  await page.waitForTimeout(2000);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("hermes:onboarded:v1", "1");
    } catch {}
  });
  await demoLogin(page);
  await page.evaluate(() => {
    try {
      localStorage.setItem("hermes:onboarded:v1", "1");
    } catch {}
  });

  await page.goto(`${BASE}/campaigns/camp_seed_backend`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: /Senior Java Developer/i }).first().waitFor({
    timeout: 30_000,
  });
  await page.waitForTimeout(2500);
  await dismissOverlays(page);

  // Agents tab — campaign-attached LinkedIn Browser Computers
  await page.getByRole("tab", { name: /agents/i }).first().click({ force: true });
  await page.waitForTimeout(2500);
  await dismissOverlays(page);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-before-send.png"),
  });

  // Source a batch so outreach drafts exist
  const sourceBtn = page.getByRole("button", { name: /source next batch/i });
  if (await sourceBtn.count()) {
    await sourceBtn.first().click({ force: true });
    await page.waitForTimeout(6000);
  }

  await page.getByRole("tab", { name: /outreach/i }).first().click({ force: true });
  await page.waitForTimeout(4000);
  await dismissOverlays(page);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-outreach-before-approve.png"),
  });

  const approve = page.getByRole("button", { name: /^Approve$/i });
  if (await approve.count()) {
    await approve.first().click({ force: true });
    await page.waitForTimeout(2500);
  }

  const send = page.getByRole("button", { name: /Send now/i });
  let sendClicked = false;
  if (await send.count()) {
    await send.first().click({ force: true });
    sendClicked = true;
    await page.waitForTimeout(4000);
  }

  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-outreach-after-send.png"),
  });
  await page.waitForTimeout(2000);

  // Back to Agents — show VM still available for Take control after help/login
  await page.getByRole("tab", { name: /agents/i }).first().click({ force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-after-send.png"),
  });

  await context.close();
  await browser.close();

  const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  if (!videos.length) throw new Error("No video recorded");
  const src = path.join(videoDir, videos[0]);
  const destWebm = path.join(OUT_DIR, "aria-linkedin-campaign-reachout.webm");
  const destMp4 = path.join(OUT_DIR, "aria-linkedin-campaign-reachout.mp4");
  fs.copyFileSync(src, destWebm);
  const { spawnSync } = await import("node:child_process");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );

  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    flow: "Agents tab → Source → Outreach Approve → Send now → Agents",
    sendClicked,
    videoMp4: fs.existsSync(destMp4) ? destMp4 : null,
    videoWebm: destWebm,
    ffmpegOk: ff.status === 0,
    deliveryProofs: [
      "_relay/evidence/2026-09-09-linkedin-campaign-reachout-mock.json",
      "_relay/evidence/2026-09-09-linkedin-campaign-reachout-fly.json",
    ],
  };
  fs.writeFileSync(
    path.join(EVIDENCE, "2026-09-09-linkedin-campaign-send-e2e.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!sendClicked) {
    console.error("RESULT record-linkedin-campaign-send-e2e: FAIL (Send now not clicked)");
    process.exit(1);
  }
  console.log("RESULT record-linkedin-campaign-send-e2e: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
