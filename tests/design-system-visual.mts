import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EXACT_OUTREACH_MESSAGE } from "../src/design-system/approval/message.ts";
import { DesignSystemGallery } from "../src/design-system/gallery/gallery.tsx";
import type { ThemeName } from "../src/design-system/tokens.ts";

const css = readFileSync(new URL("../src/design-system/theme/aria-ds.css", import.meta.url), "utf8");
const fontCss = `
@font-face {
  font-family: "Carlito";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/carlito/carlito-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Carlito";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("/fonts/carlito/carlito-latin-700-normal.woff2") format("woff2");
}
body { margin: 0; }
`;

function page(theme: ThemeName): string {
  const body = renderToStaticMarkup(createElement(DesignSystemGallery, { initialTheme: theme }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aria design system</title><style>${fontCss}${css}</style></head><body>${body}</body></html>`;
}

/** Request paths never become filesystem paths. Each match returns a constant. */
function galleryFontFile(pathname: string): string | null {
  const fonts = join(process.cwd(), "public", "fonts", "carlito");
  if (pathname === "/fonts/carlito/carlito-latin-400-normal.woff2") {
    return join(fonts, "carlito-latin-400-normal.woff2");
  }
  if (pathname === "/fonts/carlito/carlito-latin-700-normal.woff2") {
    return join(fonts, "carlito-latin-700-normal.woff2");
  }
  return null;
}

function listen(html: Record<string, string>): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }
    const fontFile = galleryFontFile(pathname);
    if (fontFile) {
      try {
        const bytes = readFileSync(fontFile);
        res.writeHead(200, { "content-type": "font/woff2" });
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    const body = html[pathname];
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({ server, port: address.port });
    });
  });
}

test("gallery screenshots and keyboard focus", async () => {
  const { chromium } = await import("playwright");
  const { server, port } = await listen({
    "/": page("dark"),
    "/light": page("light"),
  });
  const outDir = "/opt/cursor/artifacts";
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const pageDark = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pageDark.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await pageDark.locator("h1").waitFor();
    const manual = pageDark.locator('input[name="aria-send-mode"][value="human"]');
    assert.equal(await manual.isChecked(), true);
    assert.ok((await pageDark.locator("[data-testid='exact-message']").innerText()).includes(EXACT_OUTREACH_MESSAGE.slice(0, 24)));
    await pageDark.screenshot({ path: join(outDir, "aria-ds-gallery-dark.png"), fullPage: true });
    await pageDark.locator(".ds-kanban").screenshot({ path: join(outDir, "aria-ds-pipeline.png") });
    await pageDark.locator(".ds-approval").screenshot({ path: join(outDir, "aria-ds-approval.png") });

    await pageDark.keyboard.press("Tab");
    const focused = await pageDark.evaluate(() => document.activeElement?.textContent ?? "");
    assert.match(focused, /Skip to the gallery/);
    const card = pageDark.locator("[aria-keyshortcuts='ArrowLeft ArrowRight']").first();
    await card.focus();
    const keyShortcuts = await card.getAttribute("aria-keyshortcuts");
    assert.equal(keyShortcuts, "ArrowLeft ArrowRight");
    await pageDark.keyboard.press("ArrowRight");
    await pageDark.close();

    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await narrow.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await narrow.screenshot({ path: join(outDir, "aria-ds-gallery-mobile.png"), fullPage: true });
    await narrow.close();

    const light = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await light.goto(`http://127.0.0.1:${port}/light`, { waitUntil: "networkidle" });
    await light.screenshot({ path: join(outDir, "aria-ds-gallery-light.png") });
    assert.equal(await light.locator(".aria-ds").getAttribute("data-theme"), "light");
    await light.close();

    for (const name of [
      "aria-ds-gallery-dark.png",
      "aria-ds-gallery-light.png",
      "aria-ds-pipeline.png",
      "aria-ds-approval.png",
      "aria-ds-gallery-mobile.png",
    ]) {
      const size = statSync(join(outDir, name)).size;
      assert.ok(size > 8_000, `${name} is ${size} bytes`);
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
