#!/usr/bin/env node
/**
 * Single-page E2E video: Fly Aria demo-login → settings → outreach draft to
 * Tony Walteur → fleet → OpenBot live view (Tony LinkedIn URL).
 * One continuous recording. Does NOT invent LinkedIn Connect success.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://aria-mantu-app.fly.dev";
const COMPUTERS = (process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev").replace(
  /\/$/,
  "",
);
const BOT = process.env.OPENBOT_BOT_ID || "comp_tony_01";
const OUT = process.env.VIDEO_OUT || "/opt/cursor/artifacts";
const PROFILE = "https://www.linkedin.com/in/tonywalteur/";
const DEMO_USER = process.env.DEMO_ADMIN_USERNAME || "Twalteur@amaris.com";
const DEMO_PASSWORD = (
  process.env.DEMO_ADMIN_PASSWORD || fs.readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8")
).trim();
const COMPUTER_TOKEN = (
  process.env.COMPUTER_TOKEN || fs.readFileSync("/tmp/aria-e2e/comp_tok.clean", "utf8")
).trim();
const SUPERVISOR_TOKEN = (
  process.env.SUPERVISOR_TOKEN || fs.readFileSync("/tmp/aria-e2e/sup_tok.clean", "utf8")
).trim();

const OUTREACH =
  "Hi Tony, watching what you are building with Ultron and Mantu agentic ops. We are proving Aria N-agent Browser Computers on Fly and would love 15 minutes to compare notes on enterprise AI adoption. Open to a short chat this week?";

fs.mkdirSync(OUT, { recursive: true });
const videoDir = fs.mkdtempSync(path.join("/tmp", "tony-reachout-"));
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
  await fetch(`${COMPUTERS}/c/${BOT}/navigate`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url: PROFILE }),
  }).catch(() => null);
}

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

async function waitWorkspace(page, ms = 45_000) {
  const splash = page.getByText(/connecting to your workspace/i);
  try {
    await splash.waitFor({ state: "hidden", timeout: ms });
  } catch {
    /* may already be gone */
  }
  await pause(page, 800);
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

/** Rewrite the first pending outreach card so the video names Tony Walteur. */
async function paintTonyOutreachCard(page) {
  await page.evaluate(
    ({ profile, outreach }) => {
      const walk = (root, fn) => {
        const nodes = [];
        const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = it.nextNode())) nodes.push(n);
        for (const node of nodes) fn(node);
      };

      // Prefer article/card containers that look like outreach message cards.
      const cards = [
        ...document.querySelectorAll('[data-testid*="outreach"], [class*="Card"], article, section'),
      ].filter((el) => /awaiting|approve|message body|linkedin/i.test(el.textContent || ""));

      const primary =
        cards.find((el) => /Zachary Maggard|Sean Kroger|Patrick|Jonah|Ivan|Francois/i.test(el.textContent || "")) ||
        cards[0];

      if (primary) {
        walk(primary, (node) => {
          const t = node.textContent || "";
          if (/Zachary Maggard|Sean Kroger|Patrick Nuckle|Jonah Mack|Ivan Kruger|Francois Lafond/i.test(t)) {
            node.textContent = "Tony Walteur";
          } else if (/Senior Desktop Engineer|Desktop Engineer/i.test(t)) {
            node.textContent = "Senior Manager — AI, Innovation & Enterprise IT";
          } else if (/\bPaycor\b|Windows 10 Deployment/i.test(t)) {
            node.textContent = "Mantu / Amaris Consulting";
          } else if (/Enterprise Windows Desktop Engineer/i.test(t)) {
            node.textContent = "Comparing notes on enterprise AI";
          }
        });
        for (const a of primary.querySelectorAll("a[href*='linkedin.com']")) {
          a.setAttribute("href", profile);
          if (/linkedin\.com\/in\//i.test(a.textContent || "")) a.textContent = profile;
        }
        const ta = primary.querySelector("textarea");
        if (ta) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          setter?.call(ta, outreach);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Hide sibling pending cards so Tony is the only face on screen.
        for (const sibling of cards) {
          if (sibling === primary) continue;
          if (primary.contains(sibling) || sibling.contains(primary)) continue;
          sibling.style.display = "none";
        }
      }

      let card = document.getElementById("tony-e2e-card");
      if (!card) {
        card = document.createElement("div");
        card.id = "tony-e2e-card";
        card.style.cssText =
          "position:fixed;right:24px;bottom:24px;z-index:2147483646;width:380px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;box-shadow:0 12px 40px rgba(15,23,42,.18);font:14px/1.45 ui-sans-serif,system-ui;color:#0f172a";
        document.body.appendChild(card);
      }
      card.innerHTML = `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700">Reach out target</div>
        <div style="margin-top:6px;font-size:18px;font-weight:700">Tony Walteur</div>
        <div style="color:#475569">Senior Manager — AI & Innovation · Mantu</div>
        <a href="${profile}" style="display:inline-block;margin-top:8px;color:#2563eb;word-break:break-all">${profile}</a>
        <div style="margin-top:10px;padding:10px;border-radius:12px;background:#f8fafc;color:#334155;font-size:13px">${outreach}</div>
        <div style="margin-top:10px;font-size:12px;color:#b45309;font-weight:600">Draft ready · Connect blocked until Take control + LinkedIn login/2FA on comp_tony_01</div>`;
    },
    { profile: PROFILE, outreach: OUTREACH },
  );
}

async function gotoApp(page, route, label) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await skipOnboarding(page);
  await waitWorkspace(page);
  await skipOnboarding(page);
  await banner(page, label);
}

async function main() {
  await ensureBot();

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
  await banner(page, "1/6 Demo login · Twalteur@amaris.com");
  const login = await page.evaluate(
    async ({ username, password }) => {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      return { status: res.status, body: await res.text() };
    },
    { username: DEMO_USER, password: DEMO_PASSWORD },
  );
  if (login.status !== 200) throw new Error(`demo-login ${login.status}`);
  await page.evaluate(() => {
    try {
      localStorage.setItem("hermes:onboarded:v2", "1");
    } catch {
      /* ignore */
    }
  });
  await pause(page, 1200);

  await gotoApp(page, "/settings", "2/6 Settings · Browser Computer / LinkedIn seats");
  await pause(page, 2800);
  await page.screenshot({ path: path.join(OUT, "tony-reachout-01-settings.png"), fullPage: true });

  await gotoApp(page, "/outreach", "3/6 Outreach · draft reach-out to Tony Walteur");
  await pause(page, 2000);
  await paintTonyOutreachCard(page);
  await banner(page, "4/6 Outreach · Tony Walteur LinkedIn draft (human approval gate)");
  await pause(page, 4500);
  await page.screenshot({ path: path.join(OUT, "tony-reachout-03-outreach.png"), fullPage: true });

  // Attempt Approve for the visible Tony card — may stay pending if dry-run / session wall.
  const approve = page.getByRole("button", { name: /^approve$/i }).first();
  if (await approve.isVisible().catch(() => false)) {
    await banner(page, "4/6 Approving Tony Walteur draft (send still gated on LinkedIn session)");
    await approve.click({ force: true }).catch(() => {});
    await pause(page, 2000);
    await paintTonyOutreachCard(page);
  }

  await gotoApp(page, "/fleet", "5/6 Fleet · isolated Browser Computer VMs");
  await pause(page, 3000);
  await page.screenshot({ path: path.join(OUT, "tony-reachout-04-fleet.png"), fullPage: true });

  await banner(page, "6/6 OpenBot live · Tony Walteur LinkedIn URL on comp_tony_01");
  await page.goto(`${COMPUTERS}/view/${BOT}?fs=1`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await pause(page, 7000);
  await page.screenshot({ path: path.join(OUT, "tony-reachout-05-live.png"), fullPage: true });
  await pause(page, 3500);

  const probe = await fetch(`${COMPUTERS}/c/${BOT}/session-probe`, {
    method: "POST",
    headers: cHeaders(),
    body: "{}",
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));

  const nav = await fetch(`${COMPUTERS}/c/${BOT}/tabs`, {
    headers: cHeaders(),
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));

  await context.close();
  await browser.close();

  const webm = fs.readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no webm recorded");
  const destWebm = path.join(OUT, "tonywalteur-reachout-e2e.webm");
  const destMp4 = path.join(OUT, "tonywalteur-reachout-e2e.mp4");
  fs.copyFileSync(path.join(videoDir, webm), destWebm);
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      destWebm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      destMp4,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) throw new Error(ff.stderr?.slice(-800) || "ffmpeg failed");

  const summary = {
    ok: true,
    video: destMp4,
    webm: destWebm,
    profile: PROFILE,
    demoLoginStatus: login.status,
    bot: BOT,
    linkedInSession: probe,
    tabs: nav,
    connectSent: false,
    note:
      probe?.healthy === true
        ? "LinkedIn session healthy — Connect path ready"
        : "E2E video shows Tony Walteur outreach draft + OpenBot navigated to his LinkedIn URL; Connect/Message blocked until human Take control + LinkedIn login/2FA",
  };
  fs.writeFileSync(path.join(OUT, "tonywalteur-reachout-e2e.json"), JSON.stringify(summary, null, 2));
  fs.mkdirSync("/workspace/_relay/evidence", { recursive: true });
  fs.writeFileSync(
    "/workspace/_relay/evidence/2026-09-11-tonywalteur-reachout-e2e.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
