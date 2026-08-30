import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://aria-mantu-app.fly.dev";
const KONG = "https://aria-mantu-kong.fly.dev";
const OUT = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";
const anon = process.env.ANON_KEY ?? "";
if (!email || !password || !anon) throw new Error("missing admin creds");

function shot(name: string) {
  return path.join(OUT, `quality-${name}.png`);
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);
  const show = page.getByRole("button", { name: /sign in with email/i });
  if (await show.count()) {
    await show.first().click().catch(() => null);
    await page.waitForTimeout(400);
  }
  await page.locator("#login-username, input[name='username'], input[type='email'], input[type='text']").first().fill(email);
  await page.locator("#login-password, input[name='password'], input[type='password']").first().fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);
  if (page.url().includes("/login")) {
    const tokenRes = await fetch(`${KONG}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const session = await tokenRes.json();
    if (!session?.access_token) throw new Error(`GoTrue login failed ${tokenRes.status}`);
    const raw = Buffer.from(JSON.stringify(session)).toString("base64url");
    const value = `base64-${raw}`;
    const cookies = [];
    const chunk = 3180;
    if (value.length <= chunk) {
      cookies.push({ name: "sb-auth-token", value, domain: "aria-mantu-app.fly.dev", path: "/" });
    } else {
      for (let i = 0, idx = 0; i < value.length; i += chunk, idx++) {
        cookies.push({
          name: `sb-auth-token.${idx}`,
          value: value.slice(i, i + chunk),
          domain: "aria-mantu-app.fly.dev",
          path: "/",
        });
      }
    }
    await page.context().addCookies(cookies.map((c) => ({ ...c, url: BASE })));
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
  }
  if (page.url().includes("/login")) throw new Error(`Still on login: ${page.url()}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync("/usr/local/bin/google-chrome")
    ? "/usr/local/bin/google-chrome"
    : undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);

await login(page);
await page.screenshot({ path: shot("00-after-login"), fullPage: false });
console.log("logged_in", page.url());

await page.goto(`${BASE}/candidates`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2500);
try {
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.isVisible({ timeout: 2000 })) await skip.click();
} catch {
  /* no tour */
}
await page.waitForTimeout(1000);
let bodyText = await page.locator("body").innerText();
const names = ["Amina Best", "Marc Tremblay", "Sophie Chen", "Julien Moreau", "Priya Nair", "Alex Rivera"];
let found = names.filter((n) => bodyText.includes(n));
console.log("candidates_found", found.length, found);
console.log("contact_status_visible", /contacted|Not contacted/i.test(bodyText));
await page.screenshot({ path: shot("01-candidates-quality-calypso"), fullPage: false });

if (found.length === 0) {
  // Force reload after login settle
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  bodyText = await page.locator("body").innerText();
  found = names.filter((n) => bodyText.includes(n));
  console.log("candidates_found_retry", found.length, found);
  await page.screenshot({ path: shot("01b-candidates-retry"), fullPage: false });
}

const amina = page.getByText("Amina Best").first();
if ((await amina.count()) > 0) {
  await amina.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("02-drawer-amina-evidence"), fullPage: false });
  const drawer = await page.locator("body").innerText();
  console.log(
    "drawer_evidence",
    /must-have|Calypso|MySQL|Business Analysis|Open to Work|match/i.test(drawer),
  );
}

await page.goto(`${BASE}/outreach`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2500);
const outreachText = await page.locator("body").innerText();
const outreachFound = names.filter((n) => outreachText.includes(n));
console.log("outreach_names", outreachFound.length, outreachFound);
await page.screenshot({ path: shot("03-outreach-contactable"), fullPage: false });

await page.goto(`${BASE}/intake`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1500);
const intakeText = await page.locator("body").innerText();
console.log("intake_calypso_json_btn", /calypso|json brief|consulting/i.test(intakeText));
await page.screenshot({ path: shot("04-intake"), fullPage: false });

await browser.close();
console.log(
  JSON.stringify({
    ok: found.length >= 5,
    candidatesFound: found.length,
    outreachFound: outreachFound.length,
  }),
);
