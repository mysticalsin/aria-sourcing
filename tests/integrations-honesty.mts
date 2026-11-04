import { defaultIntegrations, integrationCounts, integrationStateLabel, testConnection } from "../src/lib/integrations";
import { buildSeedState } from "../src/lib/seed";
import { normalizeWorkspaceState } from "../src/lib/store/migrations";

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
const github = integrations.find((integration) => integration.id === "int_github");
const apify = integrations.find((integration) => integration.id === "int_apify");

ok(
  "the catalogue holds only wired integrations, no roadmap placeholders",
  ["int_linkedin_rsc", "int_twenty", "int_n8n", "int_calcom", "int_notify"].every((id) => !integrations.some((i) => i.id === id)),
);
ok("GitHub card remains connected", github?.status === "connected" && typeof github.lastSync === "string");
ok("Apify LinkedIn profile search card remains connected", apify?.status === "connected" && typeof apify.lastSync === "string");
ok(
  "Apify card's description names the third-party vendor and disclaims first-party LinkedIn automation",
  /apify/i.test(apify?.description ?? "") &&
    /third-party/i.test(apify?.description ?? "") &&
    /no direct linkedin login, scraping, or session automation/i.test(apify?.description ?? ""),
);
ok(
  "unconfigured connection tests fail closed",
  integrations.filter((i) => i.status === "not_configured").every((i) => testConnection(i).ok === false),
);

// A stored workspace from before the cleanup loses the removed placeholder cards.
// It goes through normalizeWorkspaceState, the path a workspace loaded from the database takes.
const legacy = { ...buildSeedState(), version: 19, integrations: [...integrations, { ...integrations[0], id: "int_n8n", name: "n8n" }] };
const migrated = normalizeWorkspaceState(legacy).integrations;
ok("migration drops cards no longer in the catalogue", !migrated.some((i) => i.id === "int_n8n"));
ok("migration keeps the catalogue cards", migrated.length === integrations.length);

// One count for every screen: a mock-mode integration is "Simulated", never "Connected".
const counts = integrationCounts(integrations);
ok("mock-mode connections count as simulated, not live", counts.live === 0 && counts.simulated === integrations.filter((i) => i.status === "connected").length);
ok("every integration lands in exactly one state", counts.live + counts.simulated + counts.degraded + counts.error + counts.notConfigured === counts.total);
const firstMock = integrations.find((i) => i.status === "connected");
ok("a mock-mode card reads Simulated", Boolean(firstMock) && integrationStateLabel(firstMock!) === "Simulated");
ok("the same card in live mode reads Live", Boolean(firstMock) && integrationStateLabel({ ...firstMock!, mode: "live" }) === "Live");

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
