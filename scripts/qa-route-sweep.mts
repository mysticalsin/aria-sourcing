/**
 * Full-app authenticated route sweep for local Next (demo login).
 * Usage: npx tsx scripts/qa-route-sweep.mts
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

const ROUTES = [
  "/",
  "/intake",
  "/campaigns",
  "/candidates",
  "/outreach",
  "/replies",
  "/floor",
  "/fleet",
  "/funnel",
  "/exec",
  "/calendar",
  "/vivier",
  "/applicants",
  "/chat",
  "/memory",
  "/skills",
  "/sessions",
  "/soul",
  "/curator",
  "/trust",
  "/winlog",
  "/reports",
  "/replay",
  "/settings",
  "/launch",
  "/studio",
];

const CRASH_PATTERNS = [
  /Something went wrong/i,
  /critical error/i,
  /Application error/i,
  /Cannot read properties of undefined/i,
  /TypeError:/i,
  /Unhandled Runtime Error/i,
  /global-error/i,
];

type Result = { route: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };

async function demoLogin(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90_000 });
  // One-click CTA
  const demoBtn = page.getByRole("button", { name: /Enter the demo console/i });
  if (await demoBtn.count()) {
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 }).catch(() => null),
      demoBtn.first().click(),
    ]);
  } else {
    await page.locator("#login-username").fill("admin");
    await page.locator("#login-password").fill("admin");
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 }).catch(() => null),
      page.getByRole("button", { name: /^Sign in$/i }).click(),
    ]);
  }
  // Full navigation after demo-login uses window.location.href
  await page.waitForTimeout(2000);
  if (page.url().includes("/login")) {
    // API fallback: set cookie via request context then reload home
    const res = await page.request.post(`${BASE}/api/auth/demo-login`, {
      data: { username: "admin", password: "admin" },
    });
    if (!res.ok()) throw new Error(`demo-login API ${res.status()}`);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
  }
}

async function checkRoute(page: Page, route: string): Promise<Result> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  const onPageError = (err: Error) => pageErrors.push(err.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const status = res?.status() ?? 0;
    if (status >= 500) {
      return { route, status: "FAIL", detail: `HTTP ${status}` };
    }
    if (page.url().includes("/login")) {
      return { route, status: "FAIL", detail: "redirected to login" };
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    for (const pat of CRASH_PATTERNS) {
      if (pat.test(bodyText)) {
        return { route, status: "FAIL", detail: `crash UI: ${pat}` };
      }
    }
    // Filter noisy 3rd-party / expected demo noise from console
    const fatal = [...pageErrors, ...consoleErrors].filter(
      (t) =>
        /TypeError|ReferenceError|Cannot read properties|is not a function|Hydration/i.test(t)
        && !/ResizeObserver|THREE|WebGL|favicon|sourcemap|net::ERR/i.test(t),
    );
    if (fatal.length) {
      return { route, status: "FAIL", detail: fatal[0]!.slice(0, 200) };
    }
    return { route, status: "PASS", detail: `HTTP ${status}` };
  } catch (e) {
    return { route, status: "FAIL", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const results: Result[] = [];

  try {
    await demoLogin(page);
    if (page.url().includes("/login")) {
      console.error("FAIL: could not demo-login");
      process.exitCode = 1;
      await browser.close();
      return;
    }
    console.log("Logged in as", page.url());

    for (const route of ROUTES) {
      const r = await checkRoute(page, route);
      results.push(r);
      console.log(`${r.status} ${r.route} — ${r.detail}`);
    }
  } finally {
    await browser.close();
  }

  const fail = results.filter((r) => r.status === "FAIL");
  const pass = results.filter((r) => r.status === "PASS");
  console.log(`\nSUMMARY: ${pass.length}/${results.length} PASS, ${fail.length} FAIL`);
  if (fail.length) {
    for (const f of fail) console.log(`  FAIL ${f.route}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
