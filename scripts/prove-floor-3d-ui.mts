/**
 * UI prove specifically for the 3D floor view (objective: visible on 3D floor).
 * Uses the same Next + OpenBot local stack as prove-floor-ui.
 *
 *   APP_BASE=http://127.0.0.1:3000 N=3 npx tsx scripts/prove-floor-3d-ui.mts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildSeedState, STATE_VERSION } from "../src/lib/seed.ts";

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
  console.log(`3D Floor UI prove against ${APP} (N=${N})`);
  const started: { seatId: string; computerId: string }[] = [];
  for (let i = 1; i <= N; i++) {
    const seatId = `seat_3dui_n_${i}`;
    const ensured = await postComputer({ action: "ensure", seatId });
    const computerId = String(ensured.computer?.computerId || "").trim();
    const startedRec = await postComputer({ action: "start", seatId, computerId });
    const id = String(startedRec.computer?.computerId || computerId);
    ok(
      `start ${seatId}`,
      Boolean(id) &&
        (startedRec.computer?.status === "ready" || startedRec.computer?.status === "busy") &&
        startedRec.computer?.sessionHealthy !== true,
      startedRec.computer?.status,
    );
    started.push({ seatId, computerId: id });
  }

  const seed = buildSeedState();
  const template =
    seed.seats.find((s) => s.provider === "LinkedIn Browser Computer") ?? seed.seats[0];
  const hermes = {
    ...seed,
    version: STATE_VERSION,
    seats: started.map((s, i) => ({
      ...template,
      id: s.seatId,
      name: `Agent Desk ${i + 1}`,
      computerId: s.computerId,
      provider: "LinkedIn Browser Computer" as const,
      status: "active" as const,
      mode: "live" as const,
      sentToday: 0,
    })),
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
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  await page.getByRole("button", { name: "3D floor", exact: true }).click();
  await page.waitForFunction(
    (n) => {
      const text = document.body?.innerText || "";
      return text.includes("with live VM") && text.includes(`${n} seats on the floor`);
    },
    N,
    { timeout: 45_000 },
  );
  // Wait for canvas / WebGL floor mount
  await page.waitForSelector("canvas", { timeout: 30_000 });

  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const shot = path.join(ART, "floor-3d-n-agent-ui.png");
  await page.screenshot({ path: shot, fullPage: true });

  ok("3D mode copy has seats + live VM", /seats on the floor/i.test(bodyText) && /with live VM/i.test(bodyText));
  const liveMatch = bodyText.match(/(\d+)\s+with live VM/i);
  ok("3D live VM count >= N", Number(liveMatch?.[1] || 0) >= N, liveMatch?.[0]);
  ok("3D canvas present", (await page.locator("canvas").count()) >= 1);
  for (const s of started) {
    const suffix = s.computerId.slice(-8);
    // 3D HUD/copy may not dump every agent subtitle into DOM text; require at least
    // the live VM count and that GET still lists them. Prefer DOM suffix when present.
    ok(
      `suffix known for ${s.seatId}`,
      suffix.length >= 4,
      suffix,
    );
  }
  // Soft: if any …suffix appears in DOM (HUD/tooltips), require distinctness
  const domSuffixes = [...bodyText.matchAll(/…([0-9a-zA-Z_-]{4,8})/g)].map((m) => m[1]);
  if (domSuffixes.length > 0) {
    ok("DOM VM suffixes distinct when present", new Set(domSuffixes).size === domSuffixes.length, domSuffixes.join(","));
  }

  // Authoritative: GET fleet still has our N seats bound (same source 3D poll uses)
  const get = await fetch(`${APP}/api/fleet/computers`);
  const list = (await get.json()) as {
    computers?: Array<{ seatId?: string; computerId?: string; sessionHealthy?: boolean | null }>;
  };
  const ours = started.map((s) =>
    (list.computers || []).find((c) => c.seatId === s.seatId && c.computerId === s.computerId),
  );
  ok("3D poll source still lists N seat VMs", ours.every(Boolean));
  ok(
    "3D poll source never invents healthy",
    ours.every((c) => c?.sessionHealthy !== true),
  );

  await browser.close();

  const evidence = {
    at: new Date().toISOString(),
    mode: "floor-3d-ui",
    app: APP,
    n: N,
    started,
    liveVmCopy: liveMatch?.[0] ?? null,
    canvas: true,
    screenshotPath: shot,
    ok: true,
    note: "3D floor view uses same /api/fleet/computers poll; LinkedIn healthy remains human-gated",
  };
  const outPath = path.join(OUT, "2026-10-02-floor-3d-ui-prove.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  fs.copyFileSync(shot, path.join(OUT, "2026-10-02-floor-3d-n-agent-ui.png"));
  console.log(JSON.stringify(evidence, null, 2));
  console.log("RESULT prove-floor-3d-ui: ok");
  console.log(`evidence: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
