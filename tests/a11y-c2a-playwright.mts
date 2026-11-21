/**
 * Playwright + axe-core checks for sweep C2A.
 *
 * Run against a local demo (`npm run dev`, no Supabase). Nothing is sent.
 *
 *   ARIA_A11Y_BASE_URL=http://127.0.0.1:3000 npx tsx tests/a11y-c2a-playwright.mts
 *
 * Set ARIA_A11Y_REPORT to write the JSON tally, and ARIA_A11Y_SHOTS=1 to
 * save screenshots under /opt/cursor/artifacts/c2a.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright";

const require = createRequire(import.meta.url);
const base = process.env.ARIA_A11Y_BASE_URL ?? "http://127.0.0.1:3000";
const widths = [1440, 768, 375] as const;
const routes = [
  "/",
  "/campaigns",
  "/campaigns/new",
  "/campaigns/camp_seed_backend",
  "/campaigns/camp_seed_frontend",
  "/campaigns/camp_seed_design",
  "/candidates",
  "/applicants",
  "/vivier",
  "/funnel",
  "/outreach",
  "/replies",
  "/calendar",
  "/exec",
  "/reports",
  "/winlog",
  "/trust",
  "/costs",
  "/fleet",
  "/skills",
  "/sessions",
  "/settings",
  "/linkedin",
];

type Impact = "minor" | "moderate" | "serious" | "critical" | null;
type AxeViolation = {
  id: string;
  impact: Impact;
  help: string;
  nodes: { target: string[]; html: string }[];
};

const failures: string[] = [];
function check(id: string, cond: boolean, detail = "") {
  if (cond) return;
  const line = `${id} ${detail}`.trim();
  failures.push(line);
  console.error(`FAIL ${line}`);
}

async function settle(page: Page) {
  await page.waitForSelector("#main-content", { timeout: 20000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading the synthetic demo"),
    null,
    { timeout: 20000 },
  );
  await page.locator("[data-tour='mode-chip']").waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations === Infinity) continue;
      try {
        animation.finish();
      } catch {
        /* A finite effect can still refuse finish. The resting frame is enough. */
      }
    }
  });
}

async function axe(page: Page): Promise<AxeViolation[]> {
  const path = require.resolve("axe-core");
  await page.addScriptTag({ path });
  return page.evaluate(async () => {
    const runner = (window as unknown as {
      axe: { run: (node: Document, options: unknown) => Promise<{ violations: AxeViolation[] }> };
    }).axe;
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html })),
    }));
  });
}

function serious(violations: AxeViolation[]) {
  return violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
}

async function assertFindings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/`, { waitUntil: "load" });
  await settle(page);
  await page.getByText(/\d+ messages are waiting for your approval/).first().waitFor({ timeout: 20000 });

  const tour = page.getByRole("dialog");
  const tourText = (await tour.count()) > 0 ? await tour.innerText() : "";
  check("C2A-03", !tourText.includes("finds matching people on LinkedIn"), "tour still claims LinkedIn matching");
  check("C2A-03", tourText.includes("does not automate or scrape LinkedIn"), "tour omits the LinkedIn boundary");
  check("C2A-03", tourText.includes("HeyReach is off by default"), "tour omits HeyReach");
  check("C2A-04", !/paste (?:a|your first) job/i.test(tourText), "tour still says to paste a job over the populated demo");
  check("C2A-04", /messages are waiting/.test(tourText), "tour does not mention the waiting messages");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "load" });
  await settle(page);
  const animation = await page.locator(".animate-spin-slow").evaluate((el) => getComputedStyle(el).animationName);
  check("C2A-02", animation === "none", `orb animation is ${animation}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  check("C2A-05", focused === "main-content", `focus stayed on ${focused || "nothing"}`);

  const searchCount = await page.getByRole("button", { name: /Search candidates, campaigns, pages/ }).count();
  check("C2A-06", searchCount > 0, "search button name misses the visible label");
  const userLabel = await page.getByRole("button", { name: /User menu/ }).first().getAttribute("aria-label");
  check("C2A-06", Boolean(userLabel && /User menu,\s*[A-Z]{1,3}/.test(userLabel)), `user menu name is ${userLabel}`);

  await page.goto(`${base}/campaigns`, { waitUntil: "load" });
  await settle(page);
  const campaignName = await page.evaluate(() => {
    const link = document.querySelector("a[href^='/campaigns/camp_seed']");
    if (!(link instanceof HTMLElement)) return "";
    return link.getAttribute("aria-label") || link.innerText;
  });
  check(
    "C2A-06",
    /sourced/i.test(campaignName) && /interviewing|outreach|sourcing/i.test(campaignName),
    campaignName.replace(/\s+/g, " ").slice(0, 160),
  );

  await page.goto(`${base}/candidates`, { waitUntil: "load" });
  await settle(page);
  await page.getByRole("button", { name: "Add candidate" }).click();
  const manual = page.getByRole("tab", { name: "Manual" });
  const manualDisabled = await manual.getAttribute("aria-disabled");
  const manualNote = await page.getByText("Manual entry needs a live workspace").count();
  check("C2A-07", manualDisabled === "true" && manualNote > 0, "manual add is still an enabled dead end");
  await page.keyboard.press("Escape");

  const unnamedPii = await page.locator("[aria-label='PII minimized (confidential)']").evaluateAll((els) =>
    els.filter((el) => !el.getAttribute("role") && !el.querySelector(".sr-only")).length,
  );
  check("C2A-12", unnamedPii === 0, `${unnamedPii} confidential marks have a name and no role`);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/settings`, { waitUntil: "load" });
  await settle(page);
  const mailboxes = page.getByRole("tab", { name: "Mailboxes" });
  check("C2A-09", (await mailboxes.count()) > 0, "settings tab is not named Mailboxes");
  if ((await mailboxes.count()) > 0) {
    const box = await mailboxes.boundingBox();
    check(
      "C2A-09",
      Boolean(box && box.x >= -1 && box.x + box.width <= 376),
      box ? `Mailboxes tab box ${Math.round(box.x)}+${Math.round(box.width)}` : "no box",
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/skills`, { waitUntil: "load" });
  await settle(page);
  const missingPanels = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("[role='tab'][aria-controls]"));
    return tabs.filter((tab) => !document.getElementById(tab.getAttribute("aria-controls") ?? "")).length;
  });
  check("C2A-10", missingPanels === 0, `${missingPanels} tabs point at a missing panel`);

  await page.goto(`${base}/calendar`, { waitUntil: "load" });
  await settle(page);
  const barNames = await page.getByRole("progressbar").evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || ""),
  );
  check("C2A-11", barNames.length >= 4 && barNames.every((name) => name.length > 0), `${barNames.length} bars, unnamed ${barNames.filter((name) => !name).length}`);
}

async function sweep(browser: Browser) {
  const tally: Record<string, Record<string, { serious: number; critical: number; rules: string[] }>> = {};
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 } });
    const page = await context.newPage();
    for (const route of routes) {
      tally[route] ??= {};
      try {
        await page.goto(`${base}${route}`, { waitUntil: "load" });
        await settle(page);
        const violations = serious(await axe(page));
        const critical = violations.filter((violation) => violation.impact === "critical").length;
        tally[route][String(width)] = {
          serious: violations.length - critical,
          critical,
          rules: [...new Set(violations.map((violation) => `${violation.impact}:${violation.id}`))],
        };
        if (violations.length > 0) {
          console.error(`AXE ${route} @ ${width}: ${violations.map((violation) => `${violation.impact}:${violation.id}(${violation.nodes.length})`).join(", ")}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        tally[route][String(width)] = { serious: -1, critical: -1, rules: [`error:${message.slice(0, 180)}`] };
        console.error(`AXE ${route} @ ${width} ERROR ${message}`);
      }
    }
    await context.close();
  }
  return tally;
}

async function shots(browser: Browser) {
  if (process.env.ARIA_A11Y_SHOTS !== "1") return;
  mkdirSync("/opt/cursor/artifacts/c2a", { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "load" });
  await settle(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/c2a/home-1440.png", fullPage: true });
  await page.goto(`${base}/skills`, { waitUntil: "load" });
  await settle(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/c2a/skills-1440.png" });
  await page.goto(`${base}/calendar`, { waitUntil: "load" });
  await settle(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/c2a/calendar-1440.png" });
  await page.goto(`${base}/candidates`, { waitUntil: "load" });
  await settle(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/c2a/candidates-1440.png" });
  await context.close();
  const narrow = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await narrow.newPage();
  await phone.goto(`${base}/settings`, { waitUntil: "load" });
  await settle(phone);
  await phone.screenshot({ path: "/opt/cursor/artifacts/c2a/settings-375.png", fullPage: true });
  await narrow.close();
}

async function loadingWithoutJs(browser: Browser) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const response = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  const html = await response?.text();
  check("C2A-13", Boolean(html?.includes("Loading the synthetic demo")), "first paint has no synthetic-demo loading state");
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await loadingWithoutJs(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await assertFindings(page);
  } catch (error) {
    failures.push(`C2A findings threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  await context.close();
  const tally = await sweep(browser);
  const report = { base, routes: routes.length, widths, failures, tally };
  const encodedEarly = JSON.stringify(report, null, 2);
  if (process.env.ARIA_A11Y_REPORT) writeFileSync(process.env.ARIA_A11Y_REPORT, encodedEarly);
  try {
    await shots(browser);
  } catch (error) {
    failures.push(`screenshots: ${error instanceof Error ? error.message : String(error)}`);
  }
  const encoded = JSON.stringify(report, null, 2);
  if (process.env.ARIA_A11Y_REPORT) writeFileSync(process.env.ARIA_A11Y_REPORT, encoded);
  console.log(encoded);
  const blocked = Object.values(tally).some((byWidth) =>
    Object.values(byWidth).some((cell) => cell.serious + cell.critical > 0),
  );
  if (failures.length > 0 || blocked) process.exit(1);
} finally {
  await browser.close();
}
