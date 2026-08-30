import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://aria-mantu-app.fly.dev";
const OUT = "/opt/cursor/artifacts/screenshots";
const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
const show = page.getByRole("button", { name: /sign in with email/i });
if (await show.count()) await show.first().click();
await page.locator("#login-username, input[type='text']").first().fill(email);
await page.locator("#login-password").fill(password);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(1500);

async function dismissTour() {
  for (const name of [/skip/i, /close/i, /got it/i]) {
    const btn = page.getByRole("button", { name });
    if (await btn.count()) {
      await btn.first().click().catch(() => null);
      await page.waitForTimeout(400);
    }
  }
  const dlg = page.getByRole("dialog");
  if (await dlg.count()) {
    await dlg.getByRole("button", { name: /close|skip/i }).first().click().catch(() => null);
    await page.keyboard.press("Escape").catch(() => null);
  }
  await page.waitForTimeout(500);
}

await page.goto(`${BASE}/candidates`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await dismissTour();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, "quality-01c-candidates-clean.png"), fullPage: false });
const body = await page.locator("body").innerText();
const names = ["Amina Best", "Marc Tremblay", "Sophie Chen", "Julien Moreau", "Priya Nair", "Alex Rivera"];
console.log(
  "found",
  names.filter((n) => body.includes(n) || body.includes(n.split(" ")[0])),
);

const amina = page.getByText(/Amina/i).first();
if (await amina.count()) {
  await amina.click();
  await page.waitForTimeout(1200);
  await dismissTour();
  await page.screenshot({ path: path.join(OUT, "quality-02-drawer-amina.png"), fullPage: false });
  const d = await page.locator("body").innerText();
  console.log("drawer_has_email", /amina\.best\.calypso@example\.com/i.test(d));
  console.log("drawer_has_li", /linkedin\.com\/in\/amina/i.test(d));
  console.log("drawer_has_evidence", /Calypso|MySQL|must-have|Match evidence|Open to Work/i.test(d));
  console.log("drawer_contact", /Not contacted|Contacted/i.test(d));
}

await page.goto(`${BASE}/outreach`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await dismissTour();
await page.screenshot({ path: path.join(OUT, "quality-03b-outreach-clean.png"), fullPage: false });

const pick = page.getByText(/Pick a contactable candidate/i);
console.log("picker_visible", (await pick.count()) > 0);
if (await pick.count()) {
  await pick.first().click().catch(() => null);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "quality-03c-outreach-picker.png"), fullPage: false });
}

// Try opening the draft candidate select
const selects = page.locator("select");
console.log("selects", await selects.count());
if ((await selects.count()) > 0) {
  const opts = await selects.first().locator("option").allTextContents();
  console.log("first_select_options", opts.slice(0, 12));
}

await browser.close();
console.log("done");
