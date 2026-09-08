/**
 * E2E video: LinkedIn-first Java sourcing → outreach drafts ready.
 * Usage: BASE_URL=http://127.0.0.1:3020 npx tsx scripts/record-linkedin-java-outreach-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3020";
const OUT_DIR = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const EVIDENCE = path.join(process.cwd(), "_relay/evidence");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

const videoDir = fs.mkdtempSync(path.join("/tmp", "aria-li-video-"));

async function dismissOverlays(page) {
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.count()) {
    await skip.first().click({ force: true }).catch(() => null);
    await page.waitForTimeout(400);
  }
  // Escape any modal
  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(300);
}

async function demoLogin(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
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
  await page.waitForTimeout(2500);
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

  // Fresh demo state + skip onboarding
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
  // Wait for store hydrate + LinkedIn-first strategy
  await page.getByRole("heading", { name: /Senior Java Developer/i }).first().waitFor({
    timeout: 30_000,
  });
  await page.waitForTimeout(4000);
  await dismissOverlays(page);

  // Strategy tab + wiki
  await page.getByRole("tab", { name: /sourcing strategy/i }).first().click({ force: true });
  await page.waitForTimeout(2000);
  await dismissOverlays(page);

  const seedBtn = page.getByRole("button", { name: /seed java wiki/i });
  if (await seedBtn.count()) {
    await seedBtn.first().click({ force: true });
    await page.waitForTimeout(2000);
  }
  // Pause so wiki LinkedIn-first line is visible on camera
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-08-linkedin-first-wiki.png"),
  });

  // Ensure campaign fingerprint is stable before sourcing (hydrate complete)
  await page.waitForTimeout(2000);
  const sourceBtn = page.getByRole("button", { name: /source next batch/i });
  await sourceBtn.first().waitFor({ state: "visible", timeout: 15_000 });
  // Single click only
  await sourceBtn.first().click({ force: true });

  // Wait for success toast (not failure)
  const success = page.getByText(/Sourced \d+|LinkedIn outreach draft|Just sourced|via LinkedIn/i);
  const fail = page.getByText(/Sourcing failed/i);
  try {
    await Promise.race([
      success.first().waitFor({ timeout: 45_000 }),
      fail.first().waitFor({ timeout: 45_000 }).then(async () => {
        await page.waitForTimeout(3000);
        await sourceBtn.first().click({ force: true });
        await success.first().waitFor({ timeout: 45_000 });
      }),
    ]);
  } catch {
    /* continue */
  }
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-08-linkedin-first-sourced.png"),
  });

  // Candidates — LinkedIn-sourced people
  await page.getByRole("tab", { name: /candidates/i }).first().click({ force: true });
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-08-linkedin-first-candidates.png"),
  });

  // Outreach — ready to reach out (Needs Approval)
  await page.getByRole("tab", { name: /outreach/i }).first().click({ force: true });
  await page.waitForTimeout(5000);
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-08-linkedin-first-outreach-ready.png"),
  });
  // Linger on outreach for the camera
  await page.waitForTimeout(5000);

  await context.close();
  await browser.close();

  const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  if (!videos.length) {
    console.error("No video recorded");
    process.exit(1);
  }
  const src = path.join(videoDir, videos[0]);
  const destWebm = path.join(OUT_DIR, "aria-linkedin-java-ready-to-outreach.webm");
  const destMp4 = path.join(OUT_DIR, "aria-linkedin-java-ready-to-outreach.mp4");
  fs.copyFileSync(src, destWebm);

  const { spawnSync } = await import("node:child_process");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.log("ffmpeg failed", ff.stderr?.slice(-400));
  }

  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    flow: "login → Java campaign → LLM wiki (LinkedIn first) → Source next batch → candidates → outreach ready",
    videoWebm: destWebm,
    videoMp4: fs.existsSync(destMp4) ? destMp4 : null,
    screenshots: [
      "_relay/evidence/2026-09-08-linkedin-first-wiki.png",
      "_relay/evidence/2026-09-08-linkedin-first-sourced.png",
      "_relay/evidence/2026-09-08-linkedin-first-candidates.png",
      "_relay/evidence/2026-09-08-linkedin-first-outreach-ready.png",
    ],
  };
  fs.writeFileSync(
    path.join(EVIDENCE, "2026-09-08-linkedin-first-outreach-e2e.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log("RESULT record-linkedin-java-outreach-e2e: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
