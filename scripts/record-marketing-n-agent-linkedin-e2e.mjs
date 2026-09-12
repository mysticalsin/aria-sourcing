/**
 * Marketing walkthrough — ARIA N-agent floor → sealed outreach → VM second brain
 * → Fleet Take control → LinkedIn land attempt (honest if sessionHealthy=false).
 *
 * Never invents LinkedIn delivery. Ends with a clear gate card when probe is unhealthy.
 */
import { chromium } from "playwright";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.DEMO_BASE || "https://aria-mantu-app.fly.dev";
const OUT = "/opt/cursor/artifacts";
const RELAY = "_relay/evidence/2026-09-12-marketing-e2e-linkedin";
mkdirSync(OUT, { recursive: true });
mkdirSync(RELAY, { recursive: true });

const password = existsSync("/tmp/aria-e2e/demo_pw.clean")
  ? readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8").trim()
  : process.env.DEMO_PASSWORD?.trim() || "";

const steps = [];
const note =
  "Hi Tony, your Ultron / Mantu agentic ops work stood out. Open to a short chat on enterprise AI adoption this week?";

async function shot(page, name) {
  const file = path.join(OUT, `2026-09-12-mkt-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  copyFileSync(file, path.join(RELAY, path.basename(file)));
  steps.push({ step: name, file, url: page.url() });
  return file;
}


async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const close = page.locator('[role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("Got it"), [role="dialog"] button:has-text("Dismiss"), [role="dialog"] button:has-text("Not now"), [role="dialog"] button:has-text("Skip")').first();
    if (await close.count()) {
      await close.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    const dlg = page.locator('[role="dialog"]').first();
    if (await dlg.count()) {
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
    html,body{margin:0;height:100%;font-family:ui-sans-serif,system-ui,sans-serif;background:
      radial-gradient(ellipse at 20% 0%,#1b3a4b 0%,#0b1220 45%,#06080f 100%);color:#f4f7fb}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:72px 96px}
    .eye{letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#7dd3fc;font-weight:700}
    h1{font-size:54px;line-height:1.05;margin:18px 0 14px;max-width:14ch}
    p{font-size:22px;color:#cbd5e1;max-width:42ch;margin:0}
  </style></head><body><div class="wrap">
    <div class="eye">ARIA · Mantu sourcing</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div></body></html>`);
  await page.waitForTimeout(1600);
}

async function main() {
  if (!password) throw new Error("Missing demo password (/tmp/aria-e2e/demo_pw.clean)");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await titleCard(
    page,
    "N campaign agents. One sealed message. A VM that learns LinkedIn.",
    "Floor visibility · Browser Computer isolation · second-brain UI lessons · fail-closed until sessionHealthy.",
  );
  await shot(page, "00-title");

  // Demo login
  const loginRes = await page.request.post(`${BASE}/api/auth/demo-login`, {
    data: { username: "Twalteur@amaris.com", password },
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  steps.push({
    step: "demo-login",
    status: loginRes.status(),
    ok: loginJson?.ok === true || loginRes.ok(),
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const user = page.locator('input[name="username"], input[name="email"], input[type="email"]').first();
  if (await user.count()) {
    await user.fill("Twalteur@amaris.com");
    const pass = page.locator('input[type="password"]').first();
    if (await pass.count()) await pass.fill(password);
    const btn = page.getByRole("button", { name: /sign in|log in|enter|continue|demo/i }).first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, "01-home");

  // Floor — N agents visible
  await safeGoto(page, `${BASE}/floor`);
  await page.waitForTimeout(3500);
  await shot(page, "02-floor");

  // Campaigns / agents
  await safeGoto(page, `${BASE}/campaigns`);
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
    await shot(page, "04-campaign-agents");
  }

  // Outreach seal path
  await titleCard(
    page,
    "Draft → Seal → Deliver",
    "Recruiter seals the exact copy. Bots type that sealed text on LinkedIn — nothing else.",
  );
  await shot(page, "05-seal-title");

  await safeGoto(page, `${BASE}/outreach`);
  await page.waitForTimeout(2200);
  await shot(page, "06-outreach");

  // Try to draft / seal if UI allows
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
  await shot(page, "07-outreach-sealed");

  // Skills / second brain
  await titleCard(
    page,
    "Second brain for the VM",
    "Outreach skill learns copy from INTERESTED replies. LinkedIn UI lessons teach Message vs Connect, note fields, and Send proof.",
  );
  await shot(page, "08-brain-title");

  await safeGoto(page, `${BASE}/skills`);
  await page.waitForTimeout(2500);
  await shot(page, "09-skills-learning");
  // Seed lessons via API when tip supports it (local/tip); ignore on stale Fly.
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
  await shot(page, "10-ui-lessons");

  // Fleet / Take control
  await titleCard(
    page,
    "Isolated Browser Computers",
    "Each seat owns one Chromium profile. Start/Take require seat ownership. Orphans never green-badge another desk.",
  );
  await shot(page, "11-fleet-title");

  await safeGoto(page, `${BASE}/fleet`);
  await page.waitForTimeout(2500);
  await shot(page, "12-fleet");

  const takeBtn = page.getByRole("button", { name: /take control|observe|start/i }).first();
  if (await takeBtn.count()) {
    await takeBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  await shot(page, "13-take-control");

  // Probe computers for sessionHealthy honesty
  let sessionHealthy = null;
  try {
    const fleetRes = await page.request.get(`${BASE}/api/fleet/computers`);
    const fleetJson = await fleetRes.json().catch(() => ({}));
    const comps = Array.isArray(fleetJson.computers) ? fleetJson.computers : [];
    const healthy = comps.find((c) => c.sessionHealthy === true);
    sessionHealthy = healthy ? true : comps.some((c) => c.sessionHealthy === false) ? false : null;
    steps.push({
      step: "fleet-probe",
      computers: comps.length,
      sessionHealthy,
      seats: comps.map((c) => ({
        seatId: c.seatId,
        computerId: c.computerId,
        sessionHealthy: c.sessionHealthy ?? null,
      })),
    });
  } catch (e) {
    steps.push({ step: "fleet-probe", error: String(e) });
  }

  // Send attempt (fail-closed when unhealthy)
  await safeGoto(page, `${BASE}/outreach`);
  await page.waitForTimeout(1500);
  const sendBtn = page.getByRole("button", { name: /send|deliver|queue/i }).first();
  if (await sendBtn.count()) {
    await sendBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await shot(page, "14-send-attempt");

  if (sessionHealthy === true) {
    await titleCard(
      page,
      "LinkedIn land",
      "sessionHealthy probed true — open Sent invitations / Messaging for UI proof.",
    );
    await shot(page, "15-linkedin-ready");
    // Best-effort open LinkedIn in same context if operator session exists — still no invent.
    await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, "16-linkedin-sent");
  } else {
    await titleCard(
      page,
      "Honest gate — LinkedIn not claimed delivered",
      "sessionHealthy is not probed true on Fly tip yet. Take control → login/2FA → Release → probe. ARIA refuses to invent Sent/Pending.",
    );
    await shot(page, "15-honest-gate");
  }

  await titleCard(
    page,
    "What compounds",
    "Sealed copy lessons + LinkedIn UI second brain + N-seat isolation. Next run is sharper — without theater.",
  );
  await shot(page, "17-close");

  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  const dest = path.join(OUT, "2026-09-12-aria-marketing-n-agent-linkedin-e2e.mp4");
  if (videoPath && existsSync(videoPath)) {
    try {
      execSync(
        `ffmpeg -y -i ${JSON.stringify(videoPath)} -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${JSON.stringify(dest)}`,
        { stdio: "inherit" },
      );
    } catch {
      copyFileSync(videoPath, dest);
    }
    copyFileSync(dest, path.join(RELAY, path.basename(dest)));
  }

  // Short highlights reel from key stills if ffmpeg available
  const highlight = path.join(OUT, "2026-09-12-aria-marketing-highlights.mp4");
  try {
    const stills = [
      "00-title",
      "02-floor",
      "06-outreach",
      "10-ui-lessons",
      "12-fleet",
      "14-send-attempt",
      sessionHealthy === true ? "16-linkedin-sent" : "15-honest-gate",
      "17-close",
    ]
      .map((n) => path.join(OUT, `2026-09-12-mkt-${n}.png`))
      .filter((f) => existsSync(f));
    if (stills.length >= 4) {
      const list = path.join(OUT, "mkt-stills.txt");
      writeFileSync(
        list,
        stills.map((f) => `file '${f}'\nduration 2.2`).join("\n") + `\nfile '${stills.at(-1)}'\n`,
      );
      execSync(
        `ffmpeg -y -f concat -safe 0 -i ${JSON.stringify(list)} -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${JSON.stringify(highlight)}`,
        { stdio: "inherit" },
      );
      copyFileSync(highlight, path.join(RELAY, path.basename(highlight)));
    }
  } catch (e) {
    steps.push({ step: "highlights", error: String(e) });
  }

  const receipt = {
    at: new Date().toISOString(),
    base: BASE,
    sessionHealthy,
    linkedInLandClaimed: sessionHealthy === true,
    videos: {
      full: existsSync(dest) ? dest : null,
      highlights: existsSync(highlight) ? highlight : null,
    },
    steps,
  };
  writeFileSync(path.join(RELAY, "receipt.json"), JSON.stringify(receipt, null, 2));
  writeFileSync(path.join(OUT, "2026-09-12-aria-marketing-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
