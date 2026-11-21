// Console hand-off for voice screening. The flag is off unless
// ARIA_INTERVIEWER_ENABLED is exactly true/TRUE/True/1. Off must render a
// disabled state (not a 404). On must offer a hand-off action on the calendar.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = resolve(root, "node_modules/next/dist/bin/next");

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitForHttp(url, child) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 120000) {
    if (child.exitCode != null) {
      throw new Error(`next exited ${child.exitCode} before ready\n${last}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timed out waiting for ${url}\n${last}`);
}

function startNext(port, enabled) {
  const env = { ...process.env };
  for (const key of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    delete env[key];
  }
  env.ARIA_INTERVIEWER_ENABLED = enabled ? "true" : "false";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.BROWSER = "none";
  const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const keep = (chunk) => {
    log = (log + chunk.toString()).slice(-4000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.log = () => log;
  return child;
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function checkBrowser(browserType, name, base, enabled) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const interviewer = await page.goto(`${base}/interviewer`, { waitUntil: "domcontentloaded" });
    assert(interviewer, `${name}: no response for /interviewer`);
    assert(interviewer.status() !== 404, `${name}: /interviewer is 404 while flag ${enabled ? "on" : "off"}`);
    if (!enabled) {
      await page.getByTestId("interviewer-disabled").waitFor({ timeout: 30000 });
      assert(await page.getByTestId("interviewer-handoff-action").count() === 0, `${name}: hand-off action visible while off`);
    } else {
      await page.getByTestId("interviewer-handoff-action").waitFor({ timeout: 30000 });
    }

    const calendar = await page.goto(`${base}/calendar`, { waitUntil: "domcontentloaded" });
    assert(calendar, `${name}: no response for /calendar`);
    assert(calendar.status() !== 404, `${name}: /calendar is 404`);
    if (!enabled) {
      await page.getByTestId("calendar-handoff-disabled").waitFor({ timeout: 30000 });
      assert(await page.getByTestId("calendar-handoff-action").count() === 0, `${name}: calendar action visible while off`);
    } else {
      const action = page.getByTestId("calendar-handoff-action");
      await action.waitFor({ timeout: 30000 });
      await action.click();
      await page.getByTestId("calendar-handoff-ready").waitFor({ timeout: 10000 });
      const text = await page.getByTestId("calendar-handoff-ready").innerText();
      assert(/stage is unchanged/i.test(text), `${name}: hand-off did not say the stage is unchanged`);
    }
  } finally {
    await browser.close();
  }
}

async function scenario(enabled, port) {
  const base = `http://127.0.0.1:${port}`;
  let child = startNext(port, enabled);
  try {
    try {
      await waitForHttp(`${base}/interviewer`, child);
    } catch (error) {
      const log = child.log();
      await stop(child);
      if (!/Retry the same command/i.test(log)) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${detail}\n${log}`);
      }
      child = startNext(port, enabled);
      await waitForHttp(`${base}/interviewer`, child);
    }
    for (const [type, name] of [[chromium, "chromium"], [webkit, "webkit"]]) {
      await checkBrowser(type, name, base, enabled);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\n${child.log()}`);
  } finally {
    await stop(child);
  }
}

await scenario(false, 4180);
await scenario(true, 4181);
console.log("interviewer console hand-off ok");
