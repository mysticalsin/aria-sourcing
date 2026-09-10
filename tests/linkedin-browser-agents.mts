import { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const {
  analyzeLinkedInProfile,
  searchLinkedInProfiles,
  runBrowserUseAction,
  qualifyLeadAgainstIcp,
  listLinkedInBrowserAgentStatus,
} = await import("../src/lib/integrations/linkedin-browser-agents");

const { linkedinAgentToolProvider } = await import(
  "../src/lib/sourcing/providers/linkedin-agent-tool"
);
const { providersForCampaign } = await import("../src/lib/sourcing/providers/index");
const { linkedinWebProvider } = await import("../src/lib/sourcing/providers/web");
const { githubProvider } = await import("../src/lib/sourcing/providers/github");
const { linkedinProfilesProvider } = await import(
  "../src/lib/sourcing/providers/linkedin-profiles"
);

delete process.env.ARIA_LINKEDIN_AGENT_TOOL_ENABLED;
delete process.env.ARIA_LINKEDIN_AGENT_TOOL_URL;
const disabled = await searchLinkedInProfiles({ keywords: ["AI"] });
assert.equal(disabled.ok, false);
assert.ok((disabled.detail || "").toLowerCase().includes("not enabled"));

delete process.env.ARIA_ORCA_ENABLED;
const insight = await analyzeLinkedInProfile("https://www.linkedin.com/in/tonywalteur/");
assert.equal(insight.via, "orca-style");
assert.ok(insight.focusAreas.length > 0);
assert.ok(insight.trajectoryNotes.length > 0);
assert.ok((insight.headline || "").toLowerCase().includes("tony"));

const blocked = await runBrowserUseAction({
  type: "connect",
  profileUrl: "https://www.linkedin.com/in/tonywalteur/",
  note: "Hello",
});
assert.equal(blocked.ok, false);
assert.equal(blocked.via, "ariabot");

const icp = await qualifyLeadAgainstIcp({
  profileUrl: "https://www.linkedin.com/in/tonywalteur/",
  snippet: "agentic AI innovation",
  icp: "Enterprise AI leadership",
});
assert.equal(icp.ok, true);
assert.ok(icp.score >= 70);

assert.equal(linkedinAgentToolProvider.isAvailable({} as never), false);
process.env.ARIA_LINKEDIN_AGENT_TOOL_ENABLED = "1";
assert.equal(linkedinAgentToolProvider.isAvailable({} as never), true);
delete process.env.ARIA_LINKEDIN_AGENT_TOOL_ENABLED;

const withAgent = providersForCampaign(
  [linkedinProfilesProvider, linkedinAgentToolProvider, linkedinWebProvider, githubProvider],
  ["LinkedIn"],
);
assert.equal(
  withAgent.map((p) => p.id).join(","),
  "linkedin_profiles,linkedin_agent_tool,linkedin_web,github",
);

const withoutAgent = providersForCampaign(
  [linkedinProfilesProvider, linkedinWebProvider, githubProvider],
  ["LinkedIn"],
);
assert.equal(
  withoutAgent.map((p) => p.id).join(","),
  "linkedin_profiles,linkedin_web,github",
);

const status = listLinkedInBrowserAgentStatus();
assert.ok(status.some((s) => s.id === "linkedin-agent-tool"));
assert.ok(status.some((s) => s.id === "browser-use"));

console.log("linkedin-browser-agents: ok");
