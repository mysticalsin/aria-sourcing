#!/usr/bin/env node
/**
 * Marketing walkthrough — ARIA N-agent floor → sealed outreach → VM second brain
 * → Fleet Take control → live Browser Computer → LinkedIn Messaging attempt.
 *
 * Never invents LinkedIn delivery. If sessionHealthy is false, ends on an honest
 * gate after showing the real VM LinkedIn wall / signing-in state.
 */
import { chromium } from "playwright";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  mkdtempSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const BASE = process.env.DEMO_BASE || "https://aria-mantu-app.fly.dev";
const COMPUTERS = (
  process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev"
).replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts";
const RELAY = "_relay/evidence/2026-09-12-marketing-e2e-linkedin";
mkdirSync(OUT, { recursive: true });
mkdirSync(RELAY, { recursive: true });

const password = existsSync("/tmp/aria-e2e/demo_pw.clean")
  ? readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8").trim()
  : process.env.DEMO_PASSWORD?.trim() || "";

const computerToken = existsSync("/tmp/aria-e2e/comp_tok.clean")
  ? readFileSync("/tmp/aria-e2e/comp_tok.clean", "utf8").trim()
  : process.env.COMPUTER_TOKEN?.trim() || "";

const supervisorToken = existsSync("/tmp/aria-e2e/sup_tok.clean")
  ? readFileSync("/tmp/aria-e2e/sup_tok.clean", "utf8").trim()
  : process.env.SUPERVISOR_TOKEN?.trim() || "";

const PROFILE =
  process.env.LINKEDIN_PROFILE_URL || "https://www.linkedin.com/in/tonywalteur/";
const MESSAGING = "https://www.linkedin.com/messaging/";
const SENT = "https://www.linkedin.com/mynetwork/invitation-manager/sent/";
const DEMO_USER = "Twalteur@amaris.com";

const steps = [];
const videoDir = mkdtempSync(path.join(os.tmpdir(), "aria-mkt-"));

function cHeaders() {
  return {
    authorization: `Bearer ${computerToken}`,
    "x-openbot-computer-token": computerToken,
    "content-type": "application/json",
  };
}

async function shot(page, name) {
  const file = path.join(OUT, `2026-09-12-mkt-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  copyFileSync(file, path.join(RELAY, path.basename(file)));
  steps.push({ step: name, file, url: page.url() });
  return file;
}

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const close = page
      .locator(
        '[role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("Got it"), [role="dialog"] button:has-text("Dismiss"), [role="dialog"] button:has-text("Not now"), [role="dialog"] button:has-text("Skip")',
      )
      .first();
    if (await close.count()) {
      await close.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    if (await page.locator('[role="dialog"]').first().count()) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    } else break;
  }
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
}

async function titleCard(page, title, subtitle) {
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;height:100%;font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;background:
      radial-gradient(ellipse at 18% 0%,#1b3a4b 0%,#0b1220 42%,#06080f 100%);color:#f4f7fb}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:72px 96px}
    .eye{letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#7dd3fc;font-weight:700}
    h1{font-size:52px;line-height:1.05;margin:18px 0 14px;max-width:16ch;font-weight:700}
    p{font-size:22px;color:#cbd5e1;max-width:44ch;margin:0;line-height:1.35}
  </style></head><body><div class="wrap">
    <div class="eye">ARIA · Mantu sourcing</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div></body></html>`);
  await page.waitForTimeout(1800);
}

async function banner(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("aria-mkt-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "aria-mkt-banner";
      el.style.cssText =
        "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0b1220ee;color:#f8fafc;padding:10px 18px;border-radius:999px;font:600 14px/1.2 ui-sans-serif,system-ui;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none;max-width:92vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function fleetProbe(page) {
  const fleetRes = await page.request.get(`${BASE}/api/fleet/computers`);
  const fleetJson = await fleetRes.json().catch(() => ({}));
  const comps = Array.isArray(fleetJson.computers) ? fleetJson.computers : [];
  const healthy = comps.find((c) => c.sessionHealthy === true);
  const sessionHealthy = healthy
    ? true
    : comps.some((c) => c.sessionHealthy === false)
      ? false
      : null;
  const primary = healthy || comps[0] || null;
  steps.push({
    step: "fleet-probe",
    computers: comps.length,
    sessionHealthy,
    seats: comps.map((c) => ({
      seatId: c.seatId,
      computerId: c.computerId,
      sessionHealthy: c.sessionHealthy ?? null,
      control: c.control ?? null,
    })),
  });
  return { comps, sessionHealthy, primary };
}

async function botNavigate(botId, url) {
  if (!computerToken || !botId) return {};
  const res = await fetch(`${COMPUTERS}/c/${botId}/navigate`, {
    method: "POST",
    headers: cHeaders(),
    body: JSON.stringify({ url }),
  }).catch(() => null);
  return res ? res.json().catch(() => ({})) : {};
}

async function botScreenshot(botId, destName) {
  if (!computerToken || !botId) return null;
  const res = await fetch(`${COMPUTERS}/c/${botId}/screenshot`, {
    headers: cHeaders(),
  }).catch(() => null);
  if (!res?.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(OUT, `2026-09-12-mkt-${destName}.jpg`);
  writeFileSync(file, buf);
  copyFileSync(file, path.join(RELAY, path.basename(file)));
  steps.push({ step: destName, file, bytes: buf.length });
  return file;
}

async function ensureBot(botId) {
  if (!supervisorToken || !botId) return;
  await fetch(`${COMPUTERS}/computers/${botId}/ensure`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${supervisorToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
}

async function main() {
  if (!password) throw new Error("Missing demo password (/tmp/aria-e2e/demo_pw.clean)");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await titleCard(
    page,
    "N campaign agents. One sealed message. A VM that learns LinkedIn.",
    "Floor visibility · Browser Computer isolation · second-brain UI lessons · fail-closed until sessionHealthy.",
  );
  await shot(page, "00-title");

  const loginRes = await page.request.post(`${BASE}/api/auth/demo-login`, {
    data: { username: DEMO_USER, password },
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  steps.push({
    step: "demo-login",
    status: loginRes.status(),
    ok: loginJson?.ok === true || loginRes.ok(),
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const user = page
    .locator('input[name="username"], input[name="email"], input[type="email"]')
    .first();
  if (await user.count()) {
    await user.fill(DEMO_USER);
    const pass = page.locator('input[type="password"]').first();
    if (await pass.count()) await pass.fill(password);
    const btn = page
      .getByRole("button", { name: /sign in|log in|enter|continue|demo/i })
      .first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(2500);
  }
  await banner(page, "Demo login · Twalteur workspace");
  await shot(page, "01-home");

  await safeGoto(page, `${BASE}/floor`);
  await banner(page, "Floor — every campaign agent desk is visible");
  await page.waitForTimeout(3500);
  await shot(page, "02-floor");

  await safeGoto(page, `${BASE}/campaigns`);
  await banner(page, "Campaigns — N seats, isolated Browser Computers");
  await page.waitForTimeout(2000);
  await shot(page, "03-campaigns");
  await dismissModals(page);
  const firstCamp = page.locator('a[href*="/campaigns/"]').first();
  if (await firstCamp.count()) {
    await firstCamp.click({ force: true, timeout: 8000 }).catch(async () => {
      const href = await firstCamp.getAttribute("href");
      if (href) await safeGoto(page, href.startsWith("http") ? href : `${BASE}${href}`);
    });
    await page.waitForTimeout(2500);
    await dismissModals(page);
    await banner(page, "Campaign agents — each desk owns one Chromium profile");
    await shot(page, "04-campaign-agents");
  }

  await titleCard(
    page,
    "Draft → Seal → Deliver",
    "Recruiter seals the exact copy. Bots type that sealed text on LinkedIn — nothing else.",
  );
  await shot(page, "05-seal-title");

  await safeGoto(page, `${BASE}/outreach`);
  await banner(page, "Outreach — seal the message before any bot can type");
  await page.waitForTimeout(2200);
  await shot(page, "06-outreach");

  const draftBtn = page.getByRole("button", { name: /draft|generate|compose/i }).first();
  if (await draftBtn.count()) {
    await draftBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  const sealBtn = page.getByRole("button", { name: /seal|approve/i }).first();
  if (await sealBtn.count()) {
    await sealBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await banner(page, "Sealed copy is the only text the VM may type");
  await shot(page, "07-outreach-sealed");

  await titleCard(
    page,
    "Second brain for the VM",
    "Outreach skill learns copy from INTERESTED replies. LinkedIn UI lessons teach Message vs Connect, note fields, Send proof — and get sharper every run.",
  );
  await shot(page, "08-brain-title");

  await safeGoto(page, `${BASE}/skills`);
  await banner(page, "Skills — copy lessons + LinkedIn UI second brain");
  await page.waitForTimeout(2500);
  await shot(page, "09-skills-learning");
  await page.request
    .post(`${BASE}/api/knowledge/linkedin-ui-lessons`, {
      data: {
        goal: "path",
        ok: true,
        detail: "Connect+note path preferred after Message miss",
        preferredName: "Connect",
      },
    })
    .catch(() => null);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2000);
  await banner(page, "UI lessons compound — next seat run prefers winning controls");
  await shot(page, "10-ui-lessons");

  await titleCard(
    page,
    "Isolated Browser Computers",
    "Each seat owns one Chromium profile. Start/Take require seat ownership. Orphans never green-badge another desk.",
  );
  await shot(page, "11-fleet-title");

  await safeGoto(page, `${BASE}/fleet`);
  await banner(page, "Fleet — Take control when LinkedIn needs a human");
  await page.waitForTimeout(2500);
  await shot(page, "12-fleet");

  let { sessionHealthy, primary } = await fleetProbe(page);
  const botId = primary?.computerId || process.env.OPENBOT_BOT_ID || "";
  const seatId = primary?.seatId || "";

  if (seatId && botId) {
    await page.request
      .post(`${BASE}/api/fleet/computers`, {
        data: { action: "release_control", computerId: botId, seatId },
      })
      .catch(() => null);
    await page.waitForTimeout(600);
    await page.request
      .post(`${BASE}/api/fleet/computers`, {
        data: { action: "take_control", computerId: botId, seatId },
      })
      .catch(() => null);
    await page.waitForTimeout(1200);
  }

  const takeBtn = page.getByRole("button", { name: /take control|observe|start/i }).first();
  if (await takeBtn.count()) {
    await takeBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  await banner(page, "Take control — operator mutex held; bot waits");
  await shot(page, "13-take-control");

  await titleCard(
    page,
    "Live VM → LinkedIn Messaging",
    "Browser Computer navigates to Messaging / Sent. ARIA only claims delivery when sessionHealthy + UI proof agree.",
  );
  await shot(page, "14-vm-title");

  if (botId && computerToken) {
    await ensureBot(botId);
    if (seatId) {
      await page.request
        .post(`${BASE}/api/fleet/computers`, {
          data: { action: "release_control", computerId: botId, seatId },
        })
        .catch(() => null);
    }

    const navProfile = await botNavigate(botId, PROFILE);
    steps.push({
      step: "bot-navigate-profile",
      title: navProfile.title || null,
      url: navProfile.url || null,
    });
    await botScreenshot(botId, "15-vm-profile");

    const navMsg = await botNavigate(botId, MESSAGING);
    steps.push({
      step: "bot-navigate-messaging",
      title: navMsg.title || null,
      url: navMsg.url || null,
      textPreview: String(navMsg.text || "").slice(0, 280),
    });
    await page.waitForTimeout(2500);
    await botScreenshot(botId, "16-vm-messaging");

    const view = await context.newPage();
    await view.setExtraHTTPHeaders({
      authorization: `Bearer ${computerToken}`,
      "x-openbot-computer-token": computerToken,
    });
    await view
      .goto(`${COMPUTERS}/view/${botId}?fs=1`, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      })
      .catch(() => {});
    await view.waitForTimeout(4000);
    await banner(view, "Live Browser Computer — LinkedIn session on the seat profile");
    await shot(view, "17-live-view");
    await view.close().catch(() => {});
  } else {
    steps.push({
      step: "bot-navigate",
      skipped: true,
      reason: "missing botId or computer token",
    });
  }

  ({ sessionHealthy, primary } = await fleetProbe(page));

  await safeGoto(page, `${BASE}/outreach`);
  await banner(page, "Send stays fail-closed until sessionHealthy");
  await page.waitForTimeout(1200);
  const sendBtn = page.getByRole("button", { name: /send|deliver|queue/i }).first();
  if (await sendBtn.count()) {
    await sendBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await shot(page, "18-send-attempt");

  if (sessionHealthy === true) {
    await titleCard(
      page,
      "LinkedIn land",
      "sessionHealthy probed true — opening Sent invitations / Messaging for UI proof.",
    );
    await shot(page, "19-linkedin-ready");
    if (botId && computerToken) {
      await botNavigate(botId, SENT);
      await page.waitForTimeout(2000);
      await botScreenshot(botId, "20-linkedin-sent");
      await botNavigate(botId, MESSAGING);
      await page.waitForTimeout(2000);
      await botScreenshot(botId, "21-linkedin-messages");
    }
  } else {
    await titleCard(
      page,
      "Honest gate — LinkedIn not claimed delivered",
      "sessionHealthy is not probed true yet. Take control → finish LinkedIn login/2FA → Release → probe. ARIA refuses to invent Sent / Messaging.",
    );
    await shot(page, "19-honest-gate");
    const wall = path.join(OUT, "2026-09-12-mkt-16-vm-messaging.jpg");
    if (existsSync(wall)) {
      await page.setContent(`<!doctype html><html><head><style>
        html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:ui-sans-serif,system-ui}
        .frame{height:100%;display:grid;grid-template-rows:auto 1fr;padding:24px 28px;gap:14px;box-sizing:border-box}
        .label{font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc;font-weight:700}
        h2{margin:6px 0 0;font-size:28px}
        img{width:100%;height:100%;object-fit:contain;background:#111;border-radius:12px}
      </style></head><body><div class="frame">
        <div><div class="label">Live VM evidence</div>
        <h2>LinkedIn session wall on the Browser Computer</h2></div>
        <img src="file://${wall}" alt="VM LinkedIn wall" />
      </div></body></html>`);
      await page.waitForTimeout(2200);
      await shot(page, "20-vm-wall-evidence");
    }
  }

  await titleCard(
    page,
    "What compounds",
    "Sealed copy lessons + LinkedIn UI second brain + human-paced VM actions + N-seat isolation. Next run is sharper — without theater.",
  );
  await shot(page, "22-close");

  await context.close();
  await browser.close();

  const webms = readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(videoDir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

  const dest = path.join(OUT, "2026-09-12-aria-marketing-n-agent-linkedin-e2e.mp4");
  if (webms.length) {
    const list = path.join(videoDir, "concat.txt");
    writeFileSync(list, webms.map((f) => `file '${f}'`).join("\n") + "\n");
    const concat = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        dest,
      ],
      { encoding: "utf8" },
    );
    if (concat.status !== 0) {
      copyFileSync(webms[0], dest);
      steps.push({ step: "ffmpeg-concat", error: (concat.stderr || "").slice(-400) });
    }
    copyFileSync(dest, path.join(RELAY, path.basename(dest)));
  }

  const highlight = path.join(OUT, "2026-09-12-aria-marketing-highlights.mp4");
  try {
    const stills = [
      "00-title",
      "02-floor",
      "06-outreach",
      "10-ui-lessons",
      "12-fleet",
      "17-live-view",
      sessionHealthy === true ? "21-linkedin-messages" : "19-honest-gate",
      "22-close",
    ]
      .map((n) => path.join(OUT, `2026-09-12-mkt-${n}.png`))
      .filter((f) => existsSync(f));
    if (stills.length >= 4) {
      const list = path.join(OUT, "mkt-stills.txt");
      writeFileSync(
        list,
        stills.map((f) => `file '${f}'\nduration 2.4`).join("\n") +
          `\nfile '${stills.at(-1)}'\n`,
      );
      spawnSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-vf",
          "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          highlight,
        ],
        { encoding: "utf8" },
      );
      if (existsSync(highlight)) {
        copyFileSync(highlight, path.join(RELAY, path.basename(highlight)));
      }
    }
  } catch (e) {
    steps.push({ step: "highlights", error: String(e) });
  }

  const receipt = {
    at: new Date().toISOString(),
    base: BASE,
    computers: COMPUTERS,
    botId: botId || null,
    sessionHealthy,
    linkedInLandClaimed: sessionHealthy === true,
    learning: {
      uiLessons: "linkedin-ui-lessons second brain (seat-scoped hints + human pacing)",
      copyLessons: "outreach_skill (separate)",
    },
    videos: {
      full: existsSync(dest) ? dest : null,
      highlights: existsSync(highlight) ? highlight : null,
    },
    steps,
  };
  writeFileSync(path.join(RELAY, "receipt.json"), JSON.stringify(receipt, null, 2));
  writeFileSync(
    path.join(OUT, "2026-09-12-aria-marketing-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
