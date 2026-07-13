/* ============================================================================
   tests/web-leads.mts
   Area: compliant web-lead discovery for LinkedIn.
   ========================================================================== */

import { readFileSync } from "fs";
import { buildSeedState } from "../src/lib/seed";
import { checkLinkedInPolicy } from "../src/lib/linkedin-policy";
import { mapWebSearchCandidates } from "../src/lib/mock-ai";
import {
  buildWebQuery,
  ensureWebQueryScope,
  extractLead,
  type SearchHit,
} from "../src/lib/sourcing/web-leads";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const linkedInQuery = buildWebQuery("LinkedIn", "Senior React Engineer Paris");
ok("buildWebQuery scopes LinkedIn to public profile search", linkedInQuery.startsWith("site:linkedin.com/in "));
ok("buildWebQuery keeps the base query text", linkedInQuery === "site:linkedin.com/in Senior React Engineer Paris");
ok("ensureWebQueryScope does not double-prefix an already scoped query", ensureWebQueryScope("LinkedIn", linkedInQuery) === linkedInQuery);

const hit: SearchHit = {
  title: "Ari Candidate - Senior React Engineer - Example Labs | LinkedIn",
  url: "https://www.linkedin.com/in/ari-candidate",
  snippet: "Senior React Engineer working with TypeScript, Next.js, accessibility, and design systems.",
};
const lead = extractLead(hit, "LinkedIn") as ReturnType<typeof extractLead> & Record<string, unknown>;
ok("extractLead keeps the public LinkedIn profile url as the handle", lead.url === "https://www.linkedin.com/in/ari-candidate");
ok("extractLead populates title from SERP title text", lead.title === "Senior React Engineer");
ok("extractLead populates name from SERP title text", lead.name === "Ari Candidate");
ok("extractLead does not fabricate email", !("email" in lead));
ok("extractLead does not fabricate location", !("location" in lead));

const state = buildSeedState();
const campaign = state.campaigns[0]!;
const mapped = mapWebSearchCandidates([lead], campaign, linkedInQuery, "LinkedIn", [], campaign.scoringWeights);
const candidate = mapped.accepted[0];
ok("mapWebSearchCandidates accepts the LinkedIn web lead", mapped.accepted.length === 1);
ok("mapWebSearchCandidates marks real web leads as live provenance", candidate?.provenance === "live");
ok("mapWebSearchCandidates sets linkedinUrl for LinkedIn", candidate?.linkedinUrl === hit.url);
ok("mapWebSearchCandidates keeps email blank", candidate?.email === "");
ok("mapWebSearchCandidates keeps location blank", candidate?.location === "");
ok("mapWebSearchCandidates keeps source query site-scoped", candidate?.sourceQuery === linkedInQuery);
ok("web search does not invent professional tenure", candidate?.yearsExperience === null);

const discoveryText = [
  linkedInQuery,
  lead.name,
  lead.title,
  lead.company,
  lead.url,
  lead.snippet,
  candidate?.sourceQuery ?? "",
  candidate?.linkedinUrl ?? "",
].join(" ");
ok("LinkedIn discovery artifacts do not emit scraping or automation instructions", checkLinkedInPolicy(discoveryText).ok === true);
ok("LinkedIn policy still blocks scraping instructions", checkLinkedInPolicy("scrape LinkedIn profiles with a headless browser").ok === false);

const sourceRoute = readFileSync(new URL("../src/app/api/source/route.ts", import.meta.url), "utf8");
const sourcingTools = readFileSync(new URL("../src/lib/ai/sourcing-tools.ts", import.meta.url), "utf8");
const webLeads = readFileSync(new URL("../src/lib/sourcing/web-leads.ts", import.meta.url), "utf8");
ok("source route scopes web-search queries before dispatch", /ensureWebQueryScope\(platform,\s*query\)/.test(sourceRoute));
ok("agent sourcing tool scopes web-search queries before dispatch", /ensureWebQueryScope\(platform,\s*query\)/.test(sourcingTools));
ok("web-leads module never fetches LinkedIn profile pages", !/fetch\s*\(/.test(webLeads));
ok("source route never dispatches fetch_page for LinkedIn leads", !/fetch_page/.test(sourceRoute));
ok("agent sourcing tool never dispatches fetch_page for LinkedIn leads", !/fetch_page/.test(sourcingTools));

console.log(`RESULT web-leads: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
