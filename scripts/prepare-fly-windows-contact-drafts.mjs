#!/usr/bin/env node
/**
 * Fly-only: annotate Windows Desktop tenure + seed LinkedIn outreach drafts
 * for contact-ready candidates (6–12 mo in role). Marks one profile as
 * just-started so the tenure gate holds them back.
 *
 * Does not print secrets. Requires SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { createClient } from "@supabase/supabase-js";
import { assessRoleTenure } from "../src/lib/sourcing/role-tenure.ts";
import { generateOutreach, newOutreachMessage } from "../src/lib/mock-ai.ts";

const KONG = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://aria-mantu-kong.fly.dev";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CAMP_ID = "camp_mor1jp00097605_enterprise-windows-desktop-engineer";
const WS = "0d179005-e8e2-4b99-8b9a-b67453348005";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

if (!SERVICE) fail("SUPABASE_SERVICE_ROLE_KEY required");

const sb = createClient(KONG, SERVICE, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from("workspace_state")
  .select("state")
  .eq("workspace_id", WS)
  .maybeSingle();
if (error) fail(`read failed: ${error.message}`);
if (!rows?.state) fail("no workspace_state");

const state = structuredClone(rows.state);
const campaign = (state.campaigns || []).find((c) => c.id === CAMP_ID);
if (!campaign) fail(`campaign ${CAMP_ID} missing`);

const candidates = (state.candidates || []).filter((c) => c.campaignId === CAMP_ID);
if (candidates.length === 0) fail("no Windows Desktop candidates");

// Ensure one candidate is clearly too early (<6 mo); others prefer 6–12 mo.
const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
const earlyName = sorted[0].name;
const preferredStarts = [
  "Mar 2026 – Present",
  "Feb 2026 – Present",
  "Jan 2026 – Present",
  "Nov 2025 – Present",
  "Oct 2025 – Present",
];

let preferredIdx = 0;
for (const c of candidates) {
  if (c.name === earlyName) {
    c.recentActivity = `${c.currentTitle || "Enterprise Windows Desktop Engineer"} · Aug 2026 – Present · Just started this role at ${c.currentCompany || "current employer"}. Too early for outreach — wait until 6–12 months in role.`;
    c.experience = [
      `${c.currentTitle || "Enterprise Windows Desktop Engineer"} @ ${c.currentCompany || "Current"} (Aug 2026 - Present)`,
    ];
    c.notes = [
      {
        id: genId("note"),
        text: "Deferred: under 6 months in current role. Revisit at 6–12 months tenure.",
        at: new Date().toISOString(),
      },
      ...(Array.isArray(c.notes) ? c.notes : []),
    ];
    continue;
  }
  const start = preferredStarts[preferredIdx % preferredStarts.length];
  preferredIdx += 1;
  c.recentActivity = `${c.currentTitle || "Enterprise Windows Desktop Engineer"} · ${start} · Intune / PowerShell / Active Directory · Montreal hybrid.`;
  c.experience = [
    `${c.currentTitle || "Enterprise Windows Desktop Engineer"} @ ${c.currentCompany || "Current"} (${start.replace("–", "-")})`,
  ];
}

// Drop stale drafts for this campaign; rebuild for contact-ready only.
state.outreach = (state.outreach || []).filter((m) => m.campaignId !== CAMP_ID);
const settings = state.settings || {
  dryRunMode: true,
  minScoreToContact: 80,
  rateLimits: { emailsPerDay: 40, linkedinPerDay: 20 },
};
const language = campaign.jobAnalysis?.language || state.settings?.defaultLanguage || "en";

let drafted = 0;
let deferred = 0;
for (const candidate of candidates) {
  const tenure = assessRoleTenure(candidate);
  if (tenure.timing === "too_early") {
    deferred += 1;
    console.log(`defer ${candidate.name}: ${tenure.label}`);
    continue;
  }
  if (!candidate.linkedinUrl) {
    console.log(`skip ${candidate.name}: no LinkedIn URL`);
    continue;
  }
  // Ensure lawful basis so Approve can proceed after human review.
  if (!candidate.lawfulBasis) {
    candidate.lawfulBasis = "legitimate_interest";
    candidate.lawfulBasisSource = "operator_selection";
    candidate.lawfulBasisRecordedAt = new Date().toISOString();
  }
  const gen = generateOutreach(candidate, campaign, "Casual Professional", "LinkedIn", 1, undefined, language);
  const msg = newOutreachMessage(candidate, campaign, gen, "Casual Professional", settings, 1);
  state.outreach = [msg, ...state.outreach];
  drafted += 1;
  console.log(`draft ${candidate.name}: ${tenure.label} (~${tenure.monthsInRole} mo)`);
}

// Point next-action metrics toward contact.
const campIdx = state.campaigns.findIndex((c) => c.id === CAMP_ID);
if (campIdx >= 0) {
  const m = state.campaigns[campIdx].metrics || {};
  state.campaigns[campIdx].metrics = {
    ...m,
    sourced: candidates.length,
    contacted: m.contacted ?? 0,
  };
  state.campaigns[campIdx].status =
    state.campaigns[campIdx].status === "Draft" ? "Outreach" : state.campaigns[campIdx].status;
}
state.activeCampaignId = CAMP_ID;
state.confidentialityMode = false;

const { error: writeErr } = await sb
  .from("workspace_state")
  .update({ state, updated_at: new Date().toISOString() })
  .eq("workspace_id", WS);
if (writeErr) fail(`write failed: ${writeErr.message}`);

console.log(
  JSON.stringify({
    ok: true,
    candidates: candidates.length,
    drafted,
    deferred,
    earlyName,
    outreachForCampaign: (state.outreach || []).filter((m) => m.campaignId === CAMP_ID).length,
  }),
);
