import { mock } from "node:test";
import fs from "node:fs";

mock.module("server-only", { namedExports: {} });

const {
  analyzeLinkedInProfile,
  searchLinkedInProfiles,
  qualifyLeadAgainstIcp,
  runBrowserUseAction,
  listLinkedInBrowserAgentStatus,
} = await import("../src/lib/integrations/linkedin-browser-agents");
const { linkedinAgentToolProvider } = await import(
  "../src/lib/sourcing/providers/linkedin-agent-tool"
);

const profile = "https://www.linkedin.com/in/tonywalteur/";
const insight = await analyzeLinkedInProfile(profile);
const icp = await qualifyLeadAgainstIcp({
  profileUrl: profile,
  snippet: "AI agentic enterprise innovation Ultron Mantu Aria",
  icp: "Enterprise AI / agentic systems / innovation leadership",
});
const nav = await runBrowserUseAction({ type: "navigate", url: "https://example.com" });
const blocked = await runBrowserUseAction({
  type: "connect",
  profileUrl: profile,
  note: "hi",
});
const search = await searchLinkedInProfiles({
  keywords: ["Tony", "Walteur", "AI", "Mantu"],
  limit: 5,
  tavilyKey: process.env.TAVILY_API_KEY,
});
const providerAvail = linkedinAgentToolProvider.isAvailable({} as never);
const status = listLinkedInBrowserAgentStatus();

const proof = {
  at: new Date().toISOString(),
  analyze: {
    via: insight.via,
    headline: insight.headline,
    focusAreas: insight.focusAreas,
    trajectoryNotes: insight.trajectoryNotes.slice(0, 2),
    painPoints: insight.painPoints.slice(0, 2),
    evidenceChars: (insight.evidenceText || "").length,
  },
  qualify: icp,
  navigate: { ok: nav.ok, via: nav.via, title: nav.title, detail: nav.detail },
  connectBlocked: blocked,
  search: {
    ok: search.ok,
    detail: search.detail,
    hitCount: search.hits.length,
    hits: search.hits.map((h) => ({
      profileUrl: h.profileUrl,
      name: h.name,
      title: h.title,
      via: h.via,
      invented: /lead-\d+\/?$/i.test(h.profileUrl),
    })),
  },
  providerAlwaysAvailable: providerAvail,
  status: status.map((s) => ({ id: s.id, enabled: s.enabled, builtin: s.builtin })),
};

fs.mkdirSync("_relay/evidence", { recursive: true });
fs.writeFileSync(
  "_relay/evidence/2026-09-11-tonywalteur-toolkit-proof.json",
  JSON.stringify(proof, null, 2),
);
console.log(JSON.stringify(proof, null, 2));
