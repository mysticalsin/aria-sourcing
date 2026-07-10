// LIVE smoke: proves LinkedIn candidate discovery works end-to-end through the
// REAL pipeline with the configured Tavily key. NOT part of the offline gate
// (needs TAVILY_API_KEY + network). Run: npx tsx scripts/smoke-linkedin-live.mts
//   parseEmailAndJD (real parser) -> role -> buildWebQuery(site:linkedin.com/in)
//   -> runWebTool("web_search") -> Tavily -> extractLead -> real LinkedIn leads.
import { readFileSync } from "node:fs";
import { parseEmailAndJD } from "../src/lib/mock-ai";
import { roleProfile } from "../src/lib/roles";
import { buildWebQuery, extractLead, type WebSearchPlatform } from "../src/lib/sourcing/web-leads";
import { runWebTool } from "../src/lib/ai/web-tools";

// Load .env.local for TAVILY_API_KEY.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}

function fail(msg: string): never { console.error(`SMOKE FAIL: ${msg}`); process.exit(1); }

const REAL_JD = `From: Priya Nair <priya@brightloop.io>
Subject: Senior React Engineer — London

We're hiring a Senior React Engineer for our platform team in London.
Strong TypeScript and React experience required. Thanks, Priya`;

const parsed = parseEmailAndJD({ email: REAL_JD });
const jd = parsed.jobAnalysis;
console.log(`[1] Parsed → title="${jd.title}" skills=[${(jd.requiredSkills || []).join(", ")}] location="${jd.location ?? ""}"`);

const profile = roleProfile(jd);
if (!profile.platforms.includes("LinkedIn")) fail("role profile did not select LinkedIn");
console.log(`[2] Platforms=[${profile.platforms.join(", ")}] — LinkedIn selected`);

const key = process.env.TAVILY_API_KEY ?? "";
console.log(`[3] TAVILY_API_KEY=${key ? "present (" + key.slice(0, 9) + "…)" : "MISSING"}`);
if (!key) fail("TAVILY_API_KEY not set — cannot prove live LinkedIn discovery");

const platform: WebSearchPlatform = "LinkedIn";
const baseQuery = [jd.title, ...(jd.requiredSkills || []).slice(0, 2), jd.location].filter(Boolean).join(" ");
const query = buildWebQuery(platform, baseQuery);
console.log(`[4] LinkedIn query="${query}"`);

const res = await runWebTool("web_search", { query }, { tavilyKey: key });
if (!res.ok) fail(`web_search failed: ${res.error}`);
const content = res.content as { results?: { title: string; url: string; snippet: string }[]; source?: string };
const hits = content.results ?? [];
console.log(`[5] Tavily returned ${hits.length} hits (source=${content.source ?? "?"})`);
if (hits.length === 0) fail("Tavily returned zero hits for a LinkedIn people query");

const leads = hits.slice(0, 6).map((h) => extractLead(h, platform));
let linkedinLeads = 0;
for (const lead of leads) {
  const isLinkedIn = /linkedin\.com\/in\//i.test(lead.url);
  if (isLinkedIn) linkedinLeads++;
  console.log(`    - ${lead.name}${lead.title ? " · " + lead.title : ""}  ${lead.url}${isLinkedIn ? "  [linkedin.com/in ✓]" : ""}`);
}

if (linkedinLeads < 1) fail(`no real linkedin.com/in profile leads among ${leads.length} results`);
console.log(`SMOKE PASS: JD → ${linkedinLeads} real LinkedIn profile lead(s) via Tavily (live, no fabrication).`);
process.exit(0);
