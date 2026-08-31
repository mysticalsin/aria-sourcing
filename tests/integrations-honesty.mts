import { defaultIntegrations, testConnection } from "../src/lib/integrations";

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
  "LinkedIn profile search is a truthfully real card, not a roadmap placeholder",
  apify?.real === true && apify.status === "connected" && typeof apify.lastSync === "string",
);
ok(
  "LinkedIn profile search card uses neutral connector copy and disclaims first-party LinkedIn automation",
  /linkedin profile/i.test(apify?.name ?? "") &&
    /third-party/i.test(apify?.description ?? "") &&
    /no direct linkedin login, scraping, or session automation/i.test(apify?.description ?? "") &&
    /source next batch/i.test(apify?.description ?? "") &&
    typeof apify?.setupHref === "string" &&
    /api-keys-panel/.test(apify.setupHref),
);
ok(
  "Official LinkedIn Recruiter System Connect remains an honest, unbuilt placeholder",
  linkedinRsc?.real === false && linkedinRsc.status !== "connected",
);

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
