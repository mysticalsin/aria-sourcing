import { defaultIntegrations, integrationCounts, integrationStateLabel, testConnection } from "../src/lib/integrations";

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

// One count for every screen: a mock-mode integration is "Simulated", never "Connected".
const seeded = defaultIntegrations();
const counts = integrationCounts(seeded);
ok("mock-mode connections count as simulated, not live", counts.live === 0 && counts.simulated === seeded.filter((i) => i.real && i.status === "connected").length);
ok("counts cover built integrations only", counts.total === seeded.filter((i) => i.real).length && counts.concepts === seeded.length - counts.total);
ok("every built integration lands in exactly one state", counts.live + counts.simulated + counts.degraded + counts.error + counts.notConfigured === counts.total);
const firstMock = seeded.find((i) => i.real && i.status === "connected");
ok("a mock-mode card reads Simulated", Boolean(firstMock) && integrationStateLabel(firstMock!) === "Simulated");
ok("the same card in live mode reads Live", Boolean(firstMock) && integrationStateLabel({ ...firstMock!, mode: "live" }) === "Live");
ok("a roadmap card reads Concept", seeded.filter((i) => !i.real).every((i) => integrationStateLabel(i) === "Concept"));

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
