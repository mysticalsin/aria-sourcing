import { chromium } from 'playwright';
import fs from 'fs';

const OUT = '/tmp/msourcing-floor';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
  const jsUrls = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.endsWith('.js')) jsUrls.push(url);
  });

  // Dev demo login
  const login = await page.request.post('http://localhost:3000/api/auth/demo-login', {
    data: { username: 'admin', password: 'admin' },
  });
  if (!login.ok()) {
    console.error('Demo login failed', await login.text());
    process.exit(1);
  }

  await page.goto('http://localhost:3000/floor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Force a fresh compile/load after the dev server has picked up file changes.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/page-load.png` });

  // Close any onboarding/demo modal that overlays the page
  const closeBtn = page.locator('[role="dialog"] button, .modal-close, button[aria-label="Close"]').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // Switch to 3D floor
  const btn3d = page.locator('button', { hasText: '3D floor' });
  if (await btn3d.isVisible().catch(() => false)) {
    await btn3d.click();
    await page.waitForTimeout(3000);
  }

  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible' });

  // Default view
  await page.screenshot({ path: `${OUT}/default.png` });

  // Drag to rotate left (orbit camera)
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 300, cy - 80, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/rotate-left.png` });

  // Drag to rotate right / around
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 500, cy + 40, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/rotate-right.png` });

  // Drag to look from above / behind-ish
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 260, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/look-back.png` });

  // Click first agent
  await page.mouse.click(cx, cy - 30);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/agent-detail.png` });

  const checks = await page.evaluate(() => ({
    canvas: !!document.querySelector('canvas'),
    scripts: [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean),
    detailOpen: !!document.querySelector('[role="dialog"]'),
  }));
  console.log('checks', checks);
  console.log('js urls', [...new Set(jsUrls)].filter(u => u.includes('floor') || u.includes('retro') || u.includes('office')));

  await browser.close();
})();
