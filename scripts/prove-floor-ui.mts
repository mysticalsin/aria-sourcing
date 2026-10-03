/**
 * UI prove: /floor shows N distinct live VM suffixes from GET /api/fleet/computers.
 * Never invents sessionHealthy=true.
 *
 * Prerequisites: Next on APP_BASE with COMPUTER_SUPERVISOR_* pointed at OpenBot;
 * seats already started (or this script will ensure+start).
 *
 *   APP_BASE=http://127.0.0.1:3000 N=3 npx tsx scripts/prove-floor-ui.mts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildSeedState } from "../src/lib/seed.ts";
import { STATE_VERSION } from "../src/lib/seed.ts";

const N = Math.max(2, Math.min(Number(process.env.N || 3) || 3, 5));
const APP = (process.env.APP_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = process.env.EVIDENCE_OUT || path.join(process.cwd(), "_relay/evidence");
const ART = process.env.ARTIFACTS_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

function ok(name: string, cond: boolean, detail = "") {
  if (!cond) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function postComputer(body: Record<string, unknown>) {
  const res = await fetch(`${APP}/api/fleet/computers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${body.action} ${res.status} ${JSON.stringify(json)}`);
  return json as {
    computer?: { computerId?: string; status?: string; sessionHealthy?: boolean | null };
    sessionHealthy?: boolean | null;
  };
}

async function main() {
  console.log(`Floor UI prove against ${APP} (N=${N})`);

  const started: { seatId: string; computerId: string }[] = [];
  for (let i = 1; i <= N; i++) {
    const seatId = `seat_ui_n_${i}`;
    const ensured = await postComputer({ action: "ensure", seatId });
    const computerId = String(ensured.computer?.computerId || "").trim();
    const startedRec = await postComputer({ action: "start", seatId, computerId });
    const id = String(startedRec.computer?.computerId || computerId);
    ok(`start ${seatId}`, Boolean(id), startedRec.computer?.status);
    ok(`no invent healthy ${seatId}`, startedRec.sessionHealthy !== true && startedRec.computer?.sessionHealthy !== true);
    started.push({ seatId, computerId: id });
  }

  const seed = buildSeedState();
  const template =
    seed.seats.find((s) => s.provider === "LinkedIn Browser Computer") ?? seed.seats[0];
  const uiSeats = started.map((s, i) => ({
    ...template,
    id: s.seatId,
    name: `UI Floor ${i + 1}`,
    computerId: s.computerId,
    provider: "LinkedIn Browser Computer" as const,
    status: "active" as const,
    mode: "live" as const,
    sentToday: 0,
  }));
  // Keep seed fleet small so floor copy is about our N seats (cap still applies).
  const hermes = {
    ...seed,
    version: STATE_VERSION,
    seats: uiSeats,
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.addInitScript(
    ({ key, state }) => {
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    { key: "hermes-sourcing:v1", state: hermes },
  );

  await page.goto(`${APP}/floor`, { waitUntil: "networkidle", timeout: 60_000 });
  // Dismiss first-run tour if present.
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(500);
  }
  // Floor polls fleet every ~5s; wait for live VM copy + suffixes.
  await page.waitForFunction(
    (n) => {
      const text = document.body?.innerText || "";
      return (
        text.includes("with live VM") &&
        (text.match(/…[0-9a-zA-Z_-]{4,}/g) || []).length >= n
      );
    },
    N,
    { timeout: 45_000 },
  );

  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const screenshotPath = path.join(ART, "floor-n-agent-ui.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  ok("floor copy mentions seats on the floor", /seats on the floor/i.test(bodyText));
  ok("floor copy mentions live VM count", /with live VM/i.test(bodyText), bodyText.match(/[^\n]*live VM[^\n]*/)?.[0]);
  const liveMatch = bodyText.match(/(\d+)\s+with live VM/i);
  ok("live VM count >= N", Number(liveMatch?.[1] || 0) >= N, liveMatch?.[0]);

  for (const s of started) {
    const suffix = s.computerId.slice(-8);
    ok(`page text includes VM suffix ${suffix}`, bodyText.includes(suffix) || bodyText.includes(`…${suffix}`), s.computerId);
  }
  ok("no theatrical healthy claim without probe", !/session healthy/i.test(bodyText) || /unverified/i.test(bodyText));

  // Grid/list names from injected seats
  for (const s of uiSeats) {
    ok(`seat name visible ${s.name}`, bodyText.includes(s.name));
  }

  await browser.close();

  const evidence = {
    at: new Date().toISOString(),
    mode: "floor-ui",
    app: APP,
    n: N,
    started,
    liveVmCopy: liveMatch?.[0] ?? null,
    screenshotPath,
    ok: true,
    note: "UI floor wired to GET /api/fleet/computers; sessionHealthy remains human-gated",
  };
  const outPath = path.join(OUT, "2026-10-02-floor-ui-prove.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  // Also copy screenshot into evidence folder for PR artifacts
  const evidenceShot = path.join(OUT, "2026-10-02-floor-n-agent-ui.png");
  fs.copyFileSync(screenshotPath, evidenceShot);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`RESULT prove-floor-ui: ok`);
  console.log(`evidence: ${outPath}`);
  console.log(`screenshot: ${screenshotPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
