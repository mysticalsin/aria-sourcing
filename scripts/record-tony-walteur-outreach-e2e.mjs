#!/usr/bin/env node
/**
 * Showcase E2E video: Aria → Tony Walteur candidate/outreach → Agents →
 * OpenBot LinkedIn on Tony's profile → back to Approve-ready.
 *
 * Do NOT click in-app Take control (fullscreen overlay hijacks the recording).
 * Jump to the OpenBot /view URL instead.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3060";
const VIEW =
  process.env.OPENBOT_VIEW_URL ||
  "https://aria-mantu-computers.fly.dev/view/comp_java_01?fs=1";
const COMPUTERS =
  process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev";
const BOT = process.env.OPENBOT_BOT_ID || "comp_java_01";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });

const dwell = (page, ms) => page.waitForTimeout(ms);

async function tokens() {
  const html = await (await fetch(VIEW)).text();
  const computer = html.match(/const token = "([a-f0-9]+)"/)?.[1];
  const supervisor = html.match(/const supervisorToken = "([a-f0-9]+)"/)?.[1];
  if (!computer || !supervisor) throw new Error("missing OpenBot tokens");
  return { computer, supervisor };
}

async function prepLinkedInTony() {
  const { computer, supervisor } = await tokens();
  await fetch(`${COMPUTERS}/computers/${BOT}/ensure`, {
    method: "POST",
    headers: { authorization: `Bearer ${supervisor}`, "content-type": "application/json" },
    body: "{}",
  });
  await fetch(`${COMPUTERS}/c/${BOT}/control/release`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${computer}`,
      "x-openbot-computer-token": computer,
      "content-type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
  // One navigate only — a second hop often collapses to a blank authwall.
  const nav = await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${computer}`,
      "x-openbot-computer-token": computer,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: "https://www.linkedin.com/in/tonywalteur" }),
  });
  const body = await nav.json().catch(() => ({}));
  await new Promise((r) => setTimeout(r, 2500));
  await fetch(`${COMPUTERS}/c/${BOT}/control/take`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${computer}`,
      "x-openbot-computer-token": computer,
      "content-type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
  return {
    title: body.title || "",
    hasTony: /Tony Walteur/i.test(`${body.title || ""} ${body.text || ""}`),
  };
}

async function clickCampaignTab(page, name) {
  const id = `campaign-camp_seed_backend-${name}`;
  for (let i = 0; i < 8; i++) {
    const tab = page.locator(`#${id}`);
    if (await tab.count()) {
      await tab.click({ force: true }).catch(async () => {
        await page.evaluate((elId) => document.getElementById(elId)?.click(), id);
      });
      await dwell(page, 1600);
      return true;
    }
    await dwell(page, 500);
  }
  return false;
}

async function injectTony(page) {
  return page.evaluate(() => {
    const KEY = "hermes-sourcing:v1";
    const state = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!state || typeof state !== "object") return { ok: false };
    const now = new Date().toISOString();
    const campaignId = "camp_seed_backend";
    const candidateId = "cand_tony_walteur";
    const messageId = "msg_tony_walteur_li";
    const sample = Array.isArray(state.candidates) && state.candidates[0] ? state.candidates[0] : {};
    const sampleMsg =
      (Array.isArray(state.outreach) &&
        state.outreach.find((m) => m.channel === "LinkedIn")) ||
      (Array.isArray(state.outreach) && state.outreach[0]) ||
      null;

    const tony = {
      ...sample,
      id: candidateId,
      campaignId,
      name: "Tony Walteur",
      firstName: "Tony",
      lastName: "Walteur",
      title: "Senior Manager — AI, Innovation & Enterprise IT",
      company: "Mantu / Amaris Consulting",
      location: "Montreal, Canada",
      linkedinUrl: "https://www.linkedin.com/in/tonywalteur",
      stage: "Sourced",
      matchScore: 92,
      score: 92,
      source: "LinkedIn",
      createdAt: now,
      updatedAt: now,
    };

    const outreach = sampleMsg
      ? {
          ...sampleMsg,
          id: messageId,
          candidateId,
          campaignId,
          channel: "LinkedIn",
          status: "Needs Approval",
          subject: "Quick note — Aria × Mantu AI",
          body:
            "Hi Tony — watching what you're building with Ultron and Mantu's agentic operating model. We're running Aria end-to-end sourcing on Fly OpenBot Chromium and would love 15 minutes to compare notes on enterprise AI adoption. Open to a short chat this week?",
          dryRun: false,
          createdAt: now,
          updatedAt: now,
        }
      : {
          id: messageId,
          candidateId,
          campaignId,
          channel: "LinkedIn",
          status: "Needs Approval",
          subject: "Quick note — Aria × Mantu AI",
          body:
            "Hi Tony — watching what you're building with Ultron and Mantu's agentic operating model. We're running Aria end-to-end sourcing on Fly OpenBot Chromium and would love 15 minutes to compare notes on enterprise AI adoption. Open to a short chat this week?",
          dryRun: false,
          createdAt: now,
          updatedAt: now,
        };

    state.candidates = [
      tony,
      ...(Array.isArray(state.candidates) ? state.candidates.filter((c) => c.id !== candidateId) : []),
    ];
    state.outreach = [
      outreach,
      ...(Array.isArray(state.outreach) ? state.outreach.filter((m) => m.id !== messageId) : []),
    ];
    if (state.settings) state.settings.dryRunMode = false;
    state.activeCampaignId = campaignId;
    localStorage.setItem(KEY, JSON.stringify(state));
    return { ok: true, hasOutreach: true };
  });
}

async function main() {
  const prep = await prepLinkedInTony();
  const videoDir = fs.mkdtempSync(path.join("/tmp", "aria-tony-showcase-"));
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("hermes:onboarded:v2", "1");
    localStorage.setItem("hermes:onboarded:v1", "1");
  });
  const cta = page.getByRole("button", { name: /enter the (demo )?console/i });
  if (await cta.count()) await cta.first().click();
  else {
    await page.evaluate(async () => {
      await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: "admin", password: "admin" }),
      });
    });
  }
  await dwell(page, 3000);

  await page.goto(`${BASE}/campaigns/camp_seed_backend`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await dwell(page, 3500);
  await page.keyboard.press("Escape").catch(() => null);
  const injected = await injectTony(page);
  if (!injected.ok) throw new Error("Tony injection failed — hermes-sourcing:v1 missing");
  await page.reload({ waitUntil: "domcontentloaded" });
  await dwell(page, 3000);
  await page.keyboard.press("Escape").catch(() => null);
  await dwell(page, 2000);
  await page.screenshot({ path: path.join(OUT, "tony-final-01-campaign.png") });
  await dwell(page, 2500);

  await clickCampaignTab(page, "candidates");
  await dwell(page, 2000);
  const tonyCand = page.getByText("Tony Walteur").first();
  await tonyCand.waitFor({ state: "visible", timeout: 20_000 });
  await tonyCand.scrollIntoViewIfNeeded();
  await dwell(page, 1500);
  await tonyCand.click({ force: true }).catch(() => null);
  await dwell(page, 2800);
  await page.screenshot({ path: path.join(OUT, "tony-final-02-candidate.png") });
  await dwell(page, 2500);

  await clickCampaignTab(page, "outreach");
  await dwell(page, 2400);
  const tonyOut = page.getByText(/Tony Walteur|Ultron|agentic operating model/i).first();
  if (await tonyOut.count()) await tonyOut.scrollIntoViewIfNeeded();
  await dwell(page, 2000);
  const approve = page.getByRole("button", { name: /approve|send|approve & send/i }).first();
  if (await approve.count()) {
    await approve.scrollIntoViewIfNeeded().catch(() => null);
    await approve.hover().catch(() => null);
  }
  await dwell(page, 3200);
  await page.screenshot({ path: path.join(OUT, "tony-final-03-outreach.png") });
  await dwell(page, 2800);

  await clickCampaignTab(page, "agents");
  await dwell(page, 3200);
  await page.screenshot({ path: path.join(OUT, "tony-final-04-agents.png") });
  await dwell(page, 2200);
  const start = page.getByRole("button", { name: /^start$/i }).first();
  if (await start.count()) {
    await start.scrollIntoViewIfNeeded().catch(() => null);
    await start.click({ force: true }).catch(() => null);
    await dwell(page, 2500);
  }
  await page.evaluate(() => window.scrollBy(0, 380));
  await dwell(page, 2000);
  const take = page.getByRole("button", { name: /take control/i }).first();
  if (await take.count()) {
    await take.scrollIntoViewIfNeeded().catch(() => null);
    await take.hover().catch(() => null);
  }
  await dwell(page, 2800);
  await page.screenshot({ path: path.join(OUT, "tony-final-05-take-control.png") });
  await dwell(page, 2200);

  await page.goto(VIEW, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dwell(page, 4500);
  await page.screenshot({ path: path.join(OUT, "tony-final-06-linkedin.png") });
  // If live LinkedIn lost the public Tony preview, splice the known-good still into the video later.
  await dwell(page, 6000);

  await page.goto(`${BASE}/campaigns/camp_seed_backend`, { waitUntil: "domcontentloaded" });
  await dwell(page, 2200);
  await clickCampaignTab(page, "outreach");
  await dwell(page, 2600);
  const tonyAgain = page.getByText(/Tony Walteur|Ultron/i).first();
  if (await tonyAgain.count()) await tonyAgain.scrollIntoViewIfNeeded().catch(() => null);
  if (await approve.count()) await approve.hover().catch(() => null);
  await dwell(page, 3500);
  await page.screenshot({ path: path.join(OUT, "tony-final-07-ready.png") });
  await dwell(page, 3000);

  await context.close();
  await browser.close();

  const webmName = fs.readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webmName) throw new Error("no webm");
  const webm = path.join(OUT, "aria-tony-walteur-live-walkthrough.webm");
  const mp4 = path.join(OUT, "aria-tony-walteur-live-walkthrough.mp4");
  fs.copyFileSync(path.join(videoDir, webmName), webm);
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4],
    { encoding: "utf8" },
  );

  for (const [src, dest] of [
    ["tony-final-02-candidate.png", "tony-walteur-in-candidates.png"],
    ["tony-final-03-outreach.png", "tony-walteur-outreach-draft.png"],
    ["tony-final-04-agents.png", "tony-walteur-agents-take-control.png"],
    ["tony-final-06-linkedin.png", "tony-walteur-linkedin-openbot-view.png"],
    ["tony-final-07-ready.png", "tony-walteur-ready-to-reach-out.png"],
  ]) {
    const a = path.join(OUT, src);
    if (fs.existsSync(a)) fs.copyFileSync(a, path.join(OUT, dest));
  }

  const meta = {
    ok: ff.status === 0,
    prep,
    injected,
    mp4: ff.status === 0 ? mp4 : null,
    webm,
    linkedin: "https://www.linkedin.com/in/tonywalteur",
    frames: fs.readdirSync(OUT).filter((f) => f.startsWith("tony-final-")),
    note: "OpenBot LinkedIn may show authwall without operator login; showcase montage keeps the Tony profile still.",
  };
  fs.writeFileSync(path.join(OUT, "aria-tony-walteur-live-walkthrough.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
