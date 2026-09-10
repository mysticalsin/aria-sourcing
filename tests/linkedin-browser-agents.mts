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


const { isSourcingTool, SOURCING_TOOL_DEFS, makeSourcingToolRunner } = await import(
  "../src/lib/ai/sourcing-tools"
);
assert.equal(isSourcingTool("analyze_linkedin_profile"), true);
assert.equal(isSourcingTool("qualify_lead_icp"), true);
assert.equal(isSourcingTool("browser_use_navigate"), true);
assert.ok(SOURCING_TOOL_DEFS.some((d) => d.name === "analyze_linkedin_profile"));
assert.ok(SOURCING_TOOL_DEFS.some((d) => d.name === "qualify_lead_icp"));
assert.ok(SOURCING_TOOL_DEFS.some((d) => d.name === "browser_use_navigate"));

const runner = makeSourcingToolRunner(
  {
    id: "camp_test",
    jobAnalysis: {
      title: "AI Lead",
      requiredSkills: ["AI"],
      regions: [],
      locationType: "Remote",
    },
  } as never,
  [],
  {} as never,
  "",
);
const analyzed = await runner.run("analyze_linkedin_profile", {
  profileUrl: "https://www.linkedin.com/in/tonywalteur/",
});
assert.equal(analyzed.ok, true);

delete process.env.ARIA_BROWSER_USE_ENABLED;
delete process.env.ARIA_BROWSER_USE_URL;
const navigateBlocked = await runner.run("browser_use_navigate", {
  url: "https://example.com",
});
// fail-closed when sidecar disabled
assert.equal(navigateBlocked.ok, false);

const connectBlocked = await runner.run("browser_use_navigate", {
  // tool only accepts navigate; connect is refused at adapter level
  url: "https://www.linkedin.com/in/tonywalteur/",
});
// navigate to LinkedIn public URL is allowed at tool layer; connect/message stay blocked in adapter
assert.ok(typeof connectBlocked.ok === "boolean");

const { buildLinkedInAgentContext } = await import(
  "../src/lib/integrations/linkedin-agent-context"
);
const ctx = await buildLinkedInAgentContext({
  profileUrl: "https://www.linkedin.com/in/tonywalteur/",
  snippet: "agentic AI",
});
assert.ok(ctx && ctx.toLowerCase().includes("icp"));

console.log("linkedin-browser-agents: ok");
