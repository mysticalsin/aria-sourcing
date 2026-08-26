import { defaultIntegrations, testConnection } from "../src/lib/integrations";

let pass = 0,
  fail = 0;
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
ok("real:true cards still exist", realCards.length > 0);
ok(
  "GitHub real card starts honestly unconfigured (no fake connected)",
  github?.real === true && github.status === "not_configured" && github.lastSync === null,
);
ok(
  "no real card seeds a fake connected+mock lastSync",
  realCards.every(
    (i) =>
      i.status !== "connected" ||
      i.id === "int_supabase" /* runtime-derived */ ||
      false,
  ),
);
ok(
  "real:false connection tests fail closed",
  placeholders.every((integration) => testConnection(integration).ok === false),
);
ok(
  "LinkedIn profile search is a truthfully real card, not a roadmap placeholder",
  apify?.real === true && apify.status === "not_configured",
);
ok(
  "LinkedIn profile search card uses neutral operator-facing name",
  apify?.name === "LinkedIn profile search",
);
ok(
  "LinkedIn profile search points operators at Apify vault / Access & Keys",
  /apify/i.test(apify?.description ?? "") && apify?.setupHref === "/settings?tab=access",
);
ok(
  "Official LinkedIn messaging card is real and starts unconfigured",
  linkedinRsc?.real === true && linkedinRsc.status === "not_configured",
);
ok(
  "LinkedIn messaging card mentions OpenID Connect / Sign in",
  /openid|sign in with linkedin/i.test(linkedinRsc?.description ?? ""),
);

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
