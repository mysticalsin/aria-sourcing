#!/usr/bin/env node
/**
 * source-idle-campaigns.mjs — throughput / idle-sourcing dry log
 *
 * Lists campaigns that look idle for sourcing (status Sourcing, few/no
 * progressed candidates) and logs what Aria WOULD source next.
 *
 * SAFETY (hard rules — do not weaken):
 *   - Does NOT send outreach.
 *   - Does NOT call live sourcing providers.
 *   - Does NOT create candidates.
 *   - Must NOT send without approval. Dry-run / approval gates still apply
 *     before any real contact in the product.
 *
 * Usage:
 *   npx tsx scripts/source-idle-campaigns.mjs
 *   node scripts/source-idle-campaigns.mjs   # plan-only stub without seed
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

async function loadSeedState() {
  try {
    const mod = await import(pathToFileURL(path.join(process.cwd(), "src/lib/seed.ts")).href);
    return mod.buildSeedState();
  } catch {
    try {
      const require = createRequire(import.meta.url);
      // Fallback if compiled; usually tsx handles .ts import above.
      return require("../src/lib/seed.ts").buildSeedState();
    } catch {
      return null;
    }
  }
}

async function listIdleCampaigns() {
  const state = await loadSeedState();
  if (!state) {
    return [
      {
        id: "(filter)",
        title: "status === Sourcing && (0 candidates || all Sourced)",
        status: "Sourcing",
        candidates: 0,
        progressed: 0,
      },
    ];
  }
  return state.campaigns
    .filter((c) => c.status === "Sourcing")
    .map((c) => {
      const cands = state.candidates.filter((x) => x.campaignId === c.id);
      const noneSourced = cands.length === 0;
      const noneProgressed = !noneSourced && cands.every((x) => x.stage === "Sourced");
      if (!noneSourced && !noneProgressed) return null;
      return {
        id: c.id,
        title: c.title,
        status: c.status,
        candidates: cands.length,
        progressed: cands.filter((x) => x.stage !== "Sourced").length,
      };
    })
    .filter(Boolean);
}

function planFor(c) {
  return {
    campaignId: c.id,
    title: c.title,
    candidates: c.candidates,
    wouldSource: true,
    batchSizeHint: 25,
    notes:
      "Would run sourcing only (no outreach). Human approval required before any Send.",
    mustNot: ["send", "approve-without-human", "bypass-dry-run"],
  };
}

const idle = await listIdleCampaigns();
const plans = idle.map(planFor);

console.log(
  JSON.stringify(
    {
      event: "source_idle_campaigns_plan",
      at: new Date().toISOString(),
      idleCount: idle.length,
      plans,
      disclaimer:
        "DRY LOG ONLY — this script must NOT send without approval. It never contacts candidates.",
    },
    null,
    2,
  ),
);
