/**
 * UI prove: Campaign Agents tab shows N distinct live VMs from GET /api/fleet/computers.
 * Never invents sessionHealthy=true.
 *
 * Prerequisites: Next on APP_BASE with COMPUTER_SUPERVISOR_* pointed at OpenBot.
 *
 *   APP_BASE=http://127.0.0.1:3000 N=3 npx tsx scripts/prove-campaign-agents-ui.mts
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
const CAMPAIGN_ID = "camp_seed_backend";
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
    computer?: {
      computerId?: string;
      status?: string;
      sessionHealthy?: boolean | null;
      seatId?: string;
    };
    sessionHealthy?: boolean | null;
  };
}

async function main() {
  console.log(`Campaign Agents UI prove against ${APP} (N=${N})`);

  const started: { seatId: string; computerId: string }[] = [];
  for (let i = 1; i <= N; i++) {
    const seatId = `seat_camp_ui_n_${i}`;
    const ensured = await postComputer({
      action: "ensure",
      seatId,
      campaignId: CAMPAIGN_ID,
    });
    const computerId = String(ensured.computer?.computerId || "").trim();
    const startedRec = await postComputer({
      action: "start",
      seatId,
      computerId,
      campaignId: CAMPAIGN_ID,
    });
    const id = String(startedRec.computer?.computerId || computerId);
    ok(`start ${seatId}`, Boolean(id), startedRec.computer?.status);
    ok(
      `no invent healthy ${seatId}`,
      startedRec.sessionHealthy !== true && startedRec.computer?.sessionHealthy !== true,
    );
    started.push({ seatId, computerId: id });
  }

  const seed = buildSeedState();
  const template =
    seed.seats.find((s) => s.provider === "LinkedIn Browser Computer") ?? seed.seats[0];
  const uiSeats = started.map((s, i) => ({
    ...template,
    id: s.seatId,
    name: `Camp Agent ${i + 1}`,
    computerId: s.computerId,
    provider: "LinkedIn Browser Computer" as const,
    status: "active" as const,
    mode: "live" as const,
    sentToday: 0,
    assignedCampaignIds: [CAMPAIGN_ID],
  }));
  const hermes = {
    ...seed,
    version: STATE_VERSION,
    seats: uiSeats,
    activeCampaignId: CAMPAIGN_ID,
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.addInitScript(
    ({ key, state, onboardKey }) => {
      window.localStorage.setItem(key, JSON.stringify(state));
      window.localStorage.setItem(onboardKey, "1");
    },
    { key: "hermes-sourcing:v1", state: hermes, onboardKey: "hermes:onboarded:v2" },
  );

  await page.goto(`${APP}/campaigns/${CAMPAIGN_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  // Campaign page polls; don't wait for networkidle.
  await page.waitForSelector("body", { timeout: 30_000 });
  const skip = page.getByRole("button", { name: /skip tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(500);
  }

  // Tab label includes seat count badge ("Agents3") — match prefix, not exact.
  const agentsTab = page.getByRole("tab", { name: /^Agents/i });
  await agentsTab.waitFor({ state: "visible", timeout: 30_000 });
  await agentsTab.click();
  await page.waitForSelector("#campaign-agents-heading", { timeout: 30_000 });

  // Panel polls fleet every ~4s; wait for N/N with VM + monospace computer ids.
  await page.waitForFunction(
    ({ n, ids }) => {
      const text = document.body?.innerText || "";
      const badgeOk = new RegExp(`${n}/${n}\\s+with VM`, "i").test(text);
      const idsOk = ids.every((id) => text.includes(id));
      return badgeOk && idsOk && /Agents on this campaign/i.test(text);
    },
    { n: N, ids: started.map((s) => s.computerId) },
    { timeout: 45_000 },
  );

  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const screenshotPath = path.join(ART, "campaign-agents-n-ui.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  ok("campaign agents heading visible", /Agents on this campaign/i.test(bodyText));
  ok(
    "with VM badge is N/N",
    new RegExp(`${N}/${N}\\s+with VM`, "i").test(bodyText),
    bodyText.match(/[^\n]*with VM[^\n]*/)?.[0],
  );
  ok(
    "session healthy count is 0 (fail-closed)",
    /0\s+session healthy/i.test(bodyText),
    bodyText.match(/[^\n]*session healthy[^\n]*/)?.[0],
  );
  ok(
    "unverified or unhealthy shown — never invent green",
    /unverified|Session unhealthy/i.test(bodyText),
  );

  for (const s of started) {
    ok(`computer id visible ${s.computerId}`, bodyText.includes(s.computerId));
  }
  for (const s of uiSeats) {
    ok(`seat name visible ${s.name}`, bodyText.includes(s.name));
  }

  // API cross-check: campaign-filtered GET returns seat-owned rows only.
  const apiRes = await fetch(
    `${APP}/api/fleet/computers?campaignId=${encodeURIComponent(CAMPAIGN_ID)}`,
  );
  ok("fleet API ok", apiRes.ok, String(apiRes.status));
  const api = (await apiRes.json()) as {
    computers?: Array<{
      computerId: string;
      seatId: string | null;
      sessionHealthy: boolean | null;
      status: string;
    }>;
  };
  const owned = (api.computers ?? []).filter((c) =>
    started.some((s) => s.seatId === c.seatId && s.computerId === c.computerId),
  );
  ok("API returns N seat-owned VMs for campaign seats", owned.length === N, String(owned.length));
  ok(
    "API never invents sessionHealthy=true",
    owned.every((c) => c.sessionHealthy !== true),
    owned.map((c) => `${c.computerId}:${c.sessionHealthy}`).join(","),
  );

  await browser.close();

  // Free host slots after proof.
  if (process.env.KEEP_LIVE !== "1") {
    for (const s of started) {
      await postComputer({
        action: "stop",
        seatId: s.seatId,
        computerId: s.computerId,
      }).catch(() => null);
    }
  }

  const evidence = {
    at: new Date().toISOString(),
    mode: "campaign-agents-ui",
    app: APP,
    campaignId: CAMPAIGN_ID,
    n: N,
    started,
    screenshotPath,
    ok: true,
    note: "Campaign Agents panel wired to GET /api/fleet/computers?campaignId=…; sessionHealthy remains human-gated",
  };
  const outPath = path.join(OUT, "2026-10-02-campaign-agents-ui-prove.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  const evidenceShot = path.join(OUT, "2026-10-02-campaign-agents-n-ui.png");
  fs.copyFileSync(screenshotPath, evidenceShot);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`RESULT prove-campaign-agents-ui: ok`);
  console.log(`evidence: ${outPath}`);
  console.log(`screenshot: ${screenshotPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
