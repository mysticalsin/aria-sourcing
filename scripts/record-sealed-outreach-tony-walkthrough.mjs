/**
 * Full sealed outreach walkthrough for Tony Walteur.
 * Draft → Seal → Send attempt → Fleet/Floor. Honest about LinkedIn land gates.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.DEMO_BASE || "http://127.0.0.1:3060";
const OUT = "/opt/cursor/artifacts";
const RELAY = "_relay/evidence/2026-09-12-sealed-outreach-demo";
mkdirSync(OUT, { recursive: true });
mkdirSync(RELAY, { recursive: true });

const steps = [];
const note =
  "Hi Tony, your Ultron / Mantu agentic ops work stood out. Open to a short chat on enterprise AI adoption this week?";
const password = readFileSync("/tmp/aria-e2e/demo_pw.clean", "utf8").trim();

async function shot(page, name) {
  const file = path.join(OUT, `2026-09-12-sealed-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  copyFileSync(file, path.join(RELAY, path.basename(file)));
  steps.push({ step: name, file, url: page.url() });
  return file;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await shot(page, "01-home");

  // Prefer demo-login API for reliability, then reload app session cookies if any.
  const loginRes = await page.request.post(`${BASE}/api/auth/demo-login`, {
    data: { username: "Twalteur@amaris.com", password },
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  steps.push({ step: "demo-login", status: loginRes.status(), ok: loginJson?.ok === true || loginRes.ok() });

  // Also fill UI if still on login
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const user = page.locator('input[name="username"], input[name="email"], input[type="email"]').first();
  if (await user.count()) {
    await user.fill("Twalteur@amaris.com");
    const pass = page.locator('input[type="password"]').first();
    if (await pass.count()) await pass.fill(password);
    const btn = page.getByRole("button", { name: /sign in|log in|enter|continue|demo/i }).first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, "02-logged-in");

  await page.goto(`${BASE}/outreach`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}/outreach`));
  await page.waitForTimeout(2000);
  await shot(page, "03-outreach-pipeline");

  // Quick draft Tony if picker exists
  const candidateSelect = page.locator("select").first();
  if (await candidateSelect.count()) {
    const options = await candidateSelect.locator("option").allTextContents();
    const tonyIdx = options.findIndex((o) => /tony|walteur|walter/i.test(o));
    if (tonyIdx >= 0) {
      await candidateSelect.selectOption({ index: tonyIdx });
    } else if (options.length > 1) {
      await candidateSelect.selectOption({ index: 1 });
    }
    const channel = page.locator("select").nth(1);
    if (await channel.count()) {
      const chOpts = await channel.locator("option").allTextContents();
      const li = chOpts.findIndex((o) => /linkedin/i.test(o));
      if (li >= 0) await channel.selectOption({ index: li });
    }
    const draftBtn = page.getByRole("button", { name: /draft|generate|create/i }).first();
    if (await draftBtn.count()) {
      await draftBtn.click();
      await page.waitForTimeout(2500);
    }
  }
  await shot(page, "04-drafted");

  // Edit body to Tony note if textarea present
  const body = page.locator("textarea").first();
  if (await body.count()) {
    await body.fill(note);
    await page.waitForTimeout(400);
    const save = page.getByRole("button", { name: /save/i }).first();
    if (await save.count()) await save.click().catch(() => {});
  }
  await shot(page, "05-edited-note");

  const approve = page.getByRole("button", { name: /approve|seal/i }).first();
  if (await approve.count()) {
    await approve.click();
    await page.waitForTimeout(2000);
  }
  await shot(page, "06-sealed");

  const send = page.getByRole("button", { name: /^send$|send now|deliver/i }).first();
  if (await send.count()) {
    await send.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, "07-send-attempt");

  await page.goto(`${BASE}/fleet`).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "08-fleet");

  await page.goto(`${BASE}/floor`).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "09-floor");

  await page.setContent(`<!doctype html><html><body style="margin:0;font-family:Georgia,serif;background:linear-gradient(160deg,#0b1220,#162033);color:#e8eefc;display:grid;place-items:center;min-height:100vh">
  <div style="max-width:760px;padding:48px">
    <p style="letter-spacing:.2em;text-transform:uppercase;opacity:.55;font-size:12px;font-family:ui-sans-serif,system-ui">ARIA · sealed outreach</p>
    <h1 style="font-size:40px;line-height:1.15;margin:10px 0 14px">What you seal is what LinkedIn gets.</h1>
    <p style="opacity:.88;line-height:1.55;font-family:ui-sans-serif,system-ui;font-size:15px">Draft with outreach skill + humanizer → Approve &amp; seal → Browser Computer types that exact note → positive replies teach the skill. Live Connect land still needs tip release + healthy LinkedIn session.</p>
    <pre style="margin-top:28px;padding:18px 20px;border-radius:14px;background:#101827;border:1px solid #2a3a55;white-space:pre-wrap;font-family:ui-sans-serif,system-ui;font-size:14px;line-height:1.45">${note.replace(/</g,"&lt;")}\n\n(${note.length}/200)</pre>
  </div></body></html>`);
  await shot(page, "10-closing");

  const vid = page.video();
  await context.close();
  await browser.close();
  const webm = vid ? await vid.path() : null;
  const mp4 = path.join(OUT, "2026-09-12-sealed-outreach-tony-walkthrough.mp4");
  let ffmpeg = -1;
  if (webm && existsSync(webm)) {
    try {
      execSync(`ffmpeg -y -i "${webm}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${mp4}"`, { stdio: "inherit" });
      ffmpeg = 0;
      copyFileSync(webm, path.join(OUT, "2026-09-12-sealed-outreach-tony-walkthrough.webm"));
    } catch {
      ffmpeg = 1;
    }
  }
  const receipt = {
    at: new Date().toISOString(),
    base: BASE,
    note,
    noteLength: note.length,
    steps,
    videoMp4: mp4,
    ffmpeg,
    honest:
      "Shows sealed Outreach path for Tony note. Does not invent LinkedIn Connect delivery without healthy session + tip release.",
  };
  writeFileSync(path.join(OUT, "2026-09-12-sealed-outreach-receipt.json"), JSON.stringify(receipt, null, 2));
  writeFileSync(path.join(RELAY, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
