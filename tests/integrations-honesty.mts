import { readFileSync } from "node:fs";
import { defaultIntegrations, defaultLiveIntegrations, testConnection } from "../src/lib/integrations";
import { integrationShowsLive, visiblePeopleFirstLearningReceipts } from "../src/lib/sourcing/people-plugins";
import type { JobAnalysis } from "../src/lib/types";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const integrations = defaultIntegrations();
const placeholders = integrations.filter((integration) => integration.real === false);
const realCards = integrations.filter((integration) => integration.real === true);
const github = integrations.find((integration) => integration.id === "int_github");
const apify = integrations.find((integration) => integration.id === "int_apify");
const linkedinRsc = integrations.find((integration) => integration.id === "int_linkedin_rsc");

ok("has roadmap placeholder integrations to audit", placeholders.length > 0);
ok(
  "no real:false integration claims connected",
  placeholders.every((integration) => integration.status !== "connected"),
);
ok(
  "every real:false integration has null lastSync",
  placeholders.every((integration) => integration.lastSync === null),
);
ok(
  "real:true cards still exist",
  realCards.length > 0,
);
ok(
  "GitHub real card remains connected",
  github?.real === true && github.status === "connected" && typeof github.lastSync === "string",
);
ok(
  "real:false connection tests fail closed",
  placeholders.every((integration) => testConnection(integration).ok === false),
);
ok(
  "Apify LinkedIn profile search is a truthfully real card, not a roadmap placeholder",
  apify?.real === true && apify.status === "connected" && typeof apify.lastSync === "string",
);
ok(
  "Apify card's description names the third-party vendor and disclaims first-party LinkedIn automation",
  /apify/i.test(apify?.description ?? "") &&
    /third-party/i.test(apify?.description ?? "") &&
    /no direct linkedin login, scraping, or session automation/i.test(apify?.description ?? ""),
);
ok(
  "Official LinkedIn Recruiter System Connect remains an honest, unbuilt placeholder",
  linkedinRsc?.real === false && linkedinRsc.status !== "connected",
);

const liveTenant = defaultLiveIntegrations();
const liveGithub = liveTenant.find((integration) => integration.id === "int_github");
ok(
  "live tenant GitHub starts not configured and not Live",
  liveGithub?.status === "not_configured" && liveGithub.mode !== "live",
);
ok(
  "GitHub Live+unconfigured does not display as Live",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "not_configured" },
    liveTenant,
  ),
);
const calypsoJob = {
  title: "Calypso Application Support",
  department: "IS&D - Applicative Support",
  requiredSkills: ["Linux", "Calypso"],
  industryExperience: ["Fintech"],
} as JobAnalysis;
ok(
  "GitHub does not display Live on a people-first need when LinkedIn and Apify are unkeyed",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
    calypsoJob,
  ),
);
ok(
  "GitHub does not display Live on Settings when people plugins are unkeyed and no need is loaded",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
  ),
);
const softwareJob = {
  title: "Senior Backend Engineer",
  department: "Engineering",
  requiredSkills: ["Go", "Kubernetes"],
  industryExperience: ["SaaS"],
} as JobAnalysis;
ok(
  "GitHub-first software need may still show GitHub Live without LinkedIn",
  integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
    softwareJob,
  ),
);
const settingsCard = readFileSync(new URL("../src/components/settings/integration-card.tsx", import.meta.url), "utf8");
ok(
  "Settings GitHub Live switch uses githubLiveAllowed, not raw mode",
  /githubLiveAllowed/.test(settingsCard) && /integrationShowsLive/.test(settingsCard),
);
ok(
  "people-first learning panel hides GitHub 0-row residue while LinkedIn and Apify are unkeyed",
  visiblePeopleFirstLearningReceipts(
    [{ platform: "GitHub", candidateCount: 0 }, { platform: "LinkedIn", candidateCount: 1 }],
    calypsoJob,
    liveTenant,
  ).every((receipt) => receipt.platform !== "GitHub"),
);

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
