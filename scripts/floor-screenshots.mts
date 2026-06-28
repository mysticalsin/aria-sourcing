import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "tmp", "floor-screenshots");
const BASE = "http://localhost:3000";

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const res = await context.request.post(`${BASE}/api/auth/demo-login`, {
    data: { username: "admin", password: "admin" },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    console.error("Demo login failed:", res.status(), await res.text());
    await browser.close();
    process.exit(1);
  }
  await res.dispose();

  const page = await context.newPage();
  await page.goto(`${BASE}/floor`);

  // Dismiss the welcome tour if it shows up.
  const skipTour = page.getByRole("button", { name: "Skip tour" });
  try {
    await skipTour.waitFor({ state: "visible", timeout: 5_000 });
    await skipTour.click();
    await skipTour.waitFor({ state: "hidden", timeout: 5_000 });
  } catch {
    // No tour shown.
  }

  // Switch to the 3D floor view.
  const toggle3d = page.getByRole("button", { name: "3D floor" });
  await toggle3d.waitFor({ state: "visible", timeout: 10_000 });
  await toggle3d.click();

  try {
    await page.waitForSelector("canvas", { timeout: 60_000 });
  } catch (e) {
    console.error("Canvas not found. Current URL:", page.url());
    await page.screenshot({ path: path.join(OUT, "debug-page.png") });
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(4_000);

  const canvas = await page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not found");

  const snap = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), clip: box });

  await snap("default");

  // rotate left
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(1_500);
  await snap("rotate-left");

  // rotate right
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(1_500);
  await snap("rotate-right");

  // look back
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.85, { steps: 20 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(1_500);
  await snap("look-back");

  console.log("Screenshots saved to", OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
