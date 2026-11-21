/**
 * Visual and accessibility checks for Tony's processing flow.
 * Retries: 0. A failure is a failure; this file does not re-run a check.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import axe from "axe-core";
import { chromium, type Browser, type Page } from "playwright";

import { ProcessingGallery } from "../src/components/dashboard/processing-gallery.tsx";

const SECTIONS = [
  { id: "command-center", name: "Command Center" },
  { id: "pipeline", name: "pipeline" },
  { id: "composer", name: "composer" },
  { id: "channel-picker", name: "channel picker" },
] as const;

type Session = { server: Server; browser: Browser; page: Page; origin: string };

let opening: Promise<Session> | null = null;

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    try {
      return await chromium.launch({ headless: true });
    } catch {
      execFileSync(process.execPath, ["node_modules/playwright/cli.js", "install", "chromium"], {
        stdio: "inherit",
      });
      return chromium.launch({ headless: true });
    }
  }
}

function compileCss(dir: string): string {
  const out = join(dir, "aria.css");
  execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "src/styles/globals.css", "-o", out], {
    stdio: "inherit",
  });
  return readFileSync(out, "utf8");
}

async function session(): Promise<Session> {
  opening ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "aria-processing-"));
    const css = compileCss(dir);
    const body = renderToStaticMarkup(createElement(ProcessingGallery, null));
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Aria processing flow</title>
  <link rel="stylesheet" href="/aria.css" />
</head>
<body>${body}</body>
</html>`;
    const server = createServer((req, res) => {
      const url = req.url?.split("?")[0];
      if (url === "/aria.css") {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(css);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("visual server did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(origin, { waitUntil: "load" });
    await page.addScriptTag({ content: axe.source });
    const shotDir = process.env.ARIA_SCREENSHOT_DIR;
    if (shotDir) {
      writeFileSync(join(shotDir, "processing-flow.html"), html);
    }
    return { server, browser, page, origin };
  })();
  return opening;
}

test.after(async () => {
  if (!opening) return;
  const current = await opening.catch(() => null);
  if (!current) return;
  await current.page.close().catch(() => undefined);
  await current.browser.close().catch(() => undefined);
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
});

for (const section of SECTIONS) {
  test(`${section.name} has no serious or critical accessibility violations`, async () => {
    const current = await session();
    const locator = current.page.locator(`#${section.id}`);
    await locator.waitFor({ state: "visible" });
    const shot = await locator.screenshot({ animations: "disabled" });
    assert.ok(shot.byteLength > 8_000, `${section.name} screenshot is empty`);
    const violations = await current.page.evaluate(async (selector) => {
      const runner = (window as unknown as { axe: typeof axe }).axe;
      const result = await runner.run(selector, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });
      return result.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => `${violation.id}: ${violation.help}`);
    }, `#${section.id}`);
    assert.deepEqual(violations, []);
    const shotDir = process.env.ARIA_SCREENSHOT_DIR;
    if (shotDir) writeFileSync(join(shotDir, `${section.id}.png`), shot);
  });
}

test("the channel picker section shows HeyReach and the LinkedIn token as off", async () => {
  const current = await session();
  const text = await current.page.locator("#channel-picker").innerText();
  assert.match(text, /HeyReach/);
  assert.match(text, /LinkedIn token/);
  assert.match(text, /Off/);
  const flags = await current.page.locator("#channel-picker [data-flag='off']").count();
  assert.equal(flags, 2);
});
