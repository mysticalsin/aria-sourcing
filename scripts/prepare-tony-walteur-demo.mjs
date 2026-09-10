#!/usr/bin/env node
/**
 * Seed Tony Walteur into local demo state and leave Aria on the campaign Agents tab
 * ready for the walkthrough recording.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3060";
const DEMO_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "admin";
const VIEW =
  process.env.OPENBOT_VIEW_URL ||
  "https://aria-mantu-computers.fly.dev/view/comp_java_01?fs=1";
const COMPUTERS =
  process.env.OPENBOT_PUBLIC_BASE || "https://aria-mantu-computers.fly.dev";

async function loadTokensFromView() {
  if (process.env.SUPERVISOR_TOKEN && process.env.COMPUTER_TOKEN) {
    return {
      supervisor: process.env.SUPERVISOR_TOKEN,
      computer: process.env.COMPUTER_TOKEN,
    };
  }
  const html = await (await fetch(VIEW)).text();
  const computer = html.match(/const token = "([a-f0-9]+)"/)?.[1];
  const supervisor = html.match(/const supervisorToken = "([a-f0-9]+)"/)?.[1];
  if (!computer || !supervisor) throw new Error("Could not read OpenBot tokens from view HTML");
  return { supervisor, computer };
}

async function ensureLinkedInPointedAtTony() {
  const { supervisor, computer } = await loadTokensFromView();
  await fetch(`${COMPUTERS}/computers/comp_java_01/ensure`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${supervisor}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  await fetch(`${COMPUTERS}/c/comp_java_01/navigate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${computer}`,
      "x-openbot-computer-token": computer,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: "https://www.linkedin.com/in/tonywalteur" }),
  });
}

async function main() {
  await ensureLinkedInPointedAtTony();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("hermes:onboarded:v2", "1");
      localStorage.setItem("hermes:onboarded:v1", "1");
    } catch {}
  });

  const cta = page.getByRole("button", { name: /enter the (demo )?console/i });
  if (await cta.count()) {
    await cta.first().click();
  } else {
    await page.evaluate(async (demoPassword) => {
      await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: "admin", password: demoPassword }),
      });
    }, DEMO_PASSWORD);
  }
  await page.waitForTimeout(2000);

  // Inject Tony Walteur into persisted demo workspace.
  await page.evaluate(() => {
    const KEY = "hermes-sourcing:v1";
    let state;
    try {
      state = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      state = null;
    }
    if (!state || typeof state !== "object") {
      // Soft no-op — seed hydrate may still be in memory; UI walkthrough can add via intake.
      return { ok: false, reason: "no-local-state" };
    }

    const now = new Date().toISOString();
    const campaignId = "camp_seed_backend";
    const candidateId = "cand_tony_walteur";
    const messageId = "msg_tony_walteur_li";

    const tony = {
      id: candidateId,
      campaignId,
      name: "Tony Walteur",
      firstName: "Tony",
      lastName: "Walteur",
      title: "Senior Manager — AI, Innovation & Enterprise IT",
      company: "Mantu / Amaris Consulting",
      location: "Montreal, Canada",
      email: null,
      phone: null,
      linkedinUrl: "https://www.linkedin.com/in/tonywalteur",
      stage: "Sourced",
      matchScore: 92,
      score: 92,
      stars: "A",
      summary:
        "Enterprise AI & innovation transformation leader at Mantu. Strong fit for strategic AI outreach.",
      skills: ["AI strategy", "Enterprise IT", "Agentic AI", "Change management"],
      source: "LinkedIn",
      createdAt: now,
      updatedAt: now,
    };

    const outreach = {
      id: messageId,
      candidateId,
      campaignId,
      channel: "LinkedIn",
      status: "Needs Approval",
      subject: "Quick note — Aria × Mantu AI",
      body:
        "Hi Tony — watching what you're building with Ultron and Mantu's agentic operating model. We're running Aria end-to-end sourcing on Fly OpenBot Chromium and would love 15 minutes to compare notes on enterprise AI adoption. Open to a short chat this week?",
      tone: "Peer",
      sequenceStep: 1,
      createdAt: now,
      updatedAt: now,
      dryRun: false,
    };

    const candidates = Array.isArray(state.candidates) ? state.candidates.filter((c) => c.id !== candidateId) : [];
    candidates.unshift(tony);
    const messages = Array.isArray(state.outreach) ? state.outreach.filter((m) => m.id !== messageId) : [];
    messages.unshift(outreach);

    // Prefer live dry-run off so Send looks real (still gated by seat/session).
    if (state.settings) {
      state.settings.dryRunMode = false;
    }

    state.candidates = candidates;
    state.outreach = messages;
    state.activeCampaignId = campaignId;
    localStorage.setItem(KEY, JSON.stringify(state));
    return { ok: true, candidateId, messageId };
  });

  await page.goto(`${BASE}/campaigns/camp_seed_backend?tab=agents`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  fs.writeFileSync(
    "/tmp/tony-demo-ready.json",
    JSON.stringify(
      {
        ok: true,
        base: BASE,
        campaignUrl: `${BASE}/campaigns/camp_seed_backend?tab=agents`,
        outreachUrl: `${BASE}/campaigns/camp_seed_backend?tab=outreach`,
        viewUrl: VIEW,
        linkedin: "https://www.linkedin.com/in/tonywalteur",
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({ ok: true, campaign: `${BASE}/campaigns/camp_seed_backend?tab=agents`, view: VIEW }));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
