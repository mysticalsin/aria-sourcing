/**
 * E2E: campaign Agents tab → Start VM → Observe → Take control → Release
 *
 * BASE_URL=http://127.0.0.1:3040 npx tsx scripts/record-campaign-agents-vm-e2e.mjs
 *
 * Optional: COMPUTER_SUPERVISOR_URL + COMPUTER_SUPERVISOR_TOKEN to free slots
 * before Start (local OpenBot supervisor max is usually 10).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3040";
const OUT_DIR = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const EVIDENCE = path.join(process.cwd(), "_relay/evidence");
const SUPERVISOR = (process.env.COMPUTER_SUPERVISOR_URL || "http://127.0.0.1:18765").replace(
  /\/$/,
  "",
);
const SUPERVISOR_TOKEN =
  process.env.COMPUTER_SUPERVISOR_TOKEN || process.env.OPENBOT_SUPERVISOR_TOKEN || "";

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "aria-campaign-vm-"));

async function freeSupervisorSlotsForCampaign(need = 3) {
  if (!SUPERVISOR_TOKEN) {
    console.warn("No COMPUTER_SUPERVISOR_TOKEN — skipping capacity free");
    return;
  }
  const headers = { Authorization: `Bearer ${SUPERVISOR_TOKEN}` };
  const listRes = await fetch(`${SUPERVISOR}/computers`, { headers });
  if (!listRes.ok) {
    console.warn(`supervisor list failed: ${listRes.status}`);
    return;
  }
  const body = await listRes.json();
  const computers = body.computers || [];
  const keep = new Set(["comp_java_01", "comp_java_02", "comp_java_03"]);
  const healthRes = await fetch(`${SUPERVISOR}/health`, { headers });
  const health = healthRes.ok ? await healthRes.json() : { computers: computers.length, max: 10 };
  const free = (health.max ?? 10) - (health.computers ?? computers.length);
  if (free >= need) {
    console.log(`supervisor capacity ok: free=${free} need=${need}`);
    return;
  }
  const stoppable = computers
    .map((c) => c.botId || c.computerId || c.id)
    .filter((id) => id && !keep.has(id));
  let stopped = 0;
  for (const id of stoppable) {
    if ((health.max ?? 10) - ((health.computers ?? computers.length) - stopped) >= need) break;
    const r = await fetch(`${SUPERVISOR}/computers/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      headers,
    });
    console.log(`stop ${id} -> ${r.status}`);
    if (r.ok) stopped += 1;
  }
  const after = await fetch(`${SUPERVISOR}/health`, { headers });
  console.log("supervisor after free:", await after.text());
}

async function main() {
  await freeSupervisorSlotsForCampaign(3);

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

  const cta = page.getByRole("button", { name: /enter the demo console/i });
  if (await cta.count()) await cta.first().click();
  else {
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
  await page.evaluate(() => localStorage.setItem("hermes:onboarded:v1", "1"));

  await page.goto(`${BASE}/campaigns/camp_seed_backend`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: /Senior Java Developer/i }).first().waitFor({
    timeout: 30_000,
  });
  await page.waitForTimeout(3000);
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.count()) await skip.first().click({ force: true }).catch(() => null);

  // Agents tab
  await page.getByRole("tab", { name: /agents/i }).first().click({ force: true });
  await page.waitForTimeout(4000);
  await page.getByText(/VMs working this campaign/i).first().waitFor({ timeout: 15_000 });
  await page.getByText(/Java · Agent 01/i).first().waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-tab.png"),
    fullPage: false,
  });

  // Start first VM (must become ready/live — not max-computers error)
  const startBtn = page.getByRole("button", { name: /start vm/i }).first();
  if (!(await startBtn.count())) {
    // Already running — click Observe path still valid
    console.log("Start VM not shown — computer may already be live");
  } else {
    await startBtn.click({ force: true });
    await page.waitForTimeout(10_000);
  }

  // Assert at least one campaign VM is live (ignore stale audit log text).
  const liveBadge = page.getByText(/^[1-9]\d* live$/i);
  await liveBadge.first().waitFor({ timeout: 25_000 }).catch(() => null);
  const agentReady = page.locator("li").filter({ hasText: /Java · Agent 01/i }).getByText(/\bready\b|\bbusy\b/i);
  const liveCount = await liveBadge.count();
  const readyCount = await agentReady.count();
  if (liveCount === 0 && readyCount === 0) {
    await page.screenshot({
      path: path.join(EVIDENCE, "2026-09-09-campaign-agents-start-failed.png"),
      fullPage: false,
    });
    throw new Error("Start VM did not bring Java · Agent 01 live (ready/busy)");
  }

  // Observe
  const observe = page.getByRole("button", { name: /^observe$/i }).first();
  if (await observe.count()) {
    await observe.click({ force: true });
    await page.waitForTimeout(3000);
  } else {
    // Hide view means already observing
    console.log("Observe already active or unavailable");
  }
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-observe.png"),
    fullPage: false,
  });

  // Take control — must flip agent badge to exact "Human control" + Release
  const take = page.getByRole("button", { name: /take control/i }).first();
  if (!(await take.count())) throw new Error("Take control button missing");
  await take.click({ force: true });
  await page.waitForTimeout(5000);
  await page.getByText("Human control", { exact: true }).first().waitFor({ timeout: 25_000 });
  await page.getByRole("button", { name: /^release$/i }).first().waitFor({ timeout: 10_000 });
  // Summary badge should reflect at least one human-held seat
  await page.getByText(/^[1-9]\d* human control$/i).first().waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-take-control.png"),
    fullPage: false,
  });
  await page.waitForTimeout(3000);

  // Release — back to Bot
  const release = page.getByRole("button", { name: /^release$/i }).first();
  if (!(await release.count())) throw new Error("Release button missing after Take control");
  await release.click({ force: true });
  await page.waitForTimeout(4000);
  // Take control should return
  await page.getByRole("button", { name: /take control/i }).first().waitFor({ timeout: 15_000 });
  await page.screenshot({
    path: path.join(EVIDENCE, "2026-09-09-campaign-agents-release.png"),
    fullPage: false,
  });
  await page.waitForTimeout(2000);

  await context.close();
  await browser.close();

  const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  if (!videos.length) throw new Error("no video");
  const src = path.join(videoDir, videos[0]);
  const destWebm = path.join(OUT_DIR, "aria-campaign-agents-vm-take-control.webm");
  const destMp4 = path.join(OUT_DIR, "aria-campaign-agents-vm-take-control.mp4");
  fs.copyFileSync(src, destWebm);
  const { spawnSync } = await import("node:child_process");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destMp4],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.warn("ffmpeg warn:", ff.stderr?.slice?.(0, 400));
  }

  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    flow: "campaign → Agents tab → Start VM → Observe → Take control → Release",
    asserted: ["no start_failed", "Human control visible", "Release restores Take control"],
    videoMp4: fs.existsSync(destMp4) ? destMp4 : null,
    videoWebm: destWebm,
  };
  fs.writeFileSync(
    path.join(EVIDENCE, "2026-09-09-campaign-agents-vm-e2e.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log("RESULT record-campaign-agents-vm-e2e: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
