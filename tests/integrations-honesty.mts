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

ok(
  "the catalogue holds only wired integrations, no roadmap placeholders",
  ["int_linkedin_rsc", "int_twenty", "int_n8n", "int_calcom", "int_notify"].every((id) => !integrations.some((i) => i.id === id)),
);
ok("GitHub card remains connected", github?.status === "connected" && typeof github.lastSync === "string");
ok(
  "Apify is retired: no card for its profile search or its enrichment",
  !integrations.some((i) => i.id === "int_apify" || i.id === "int_enrichment" || /apify/i.test(`${i.name} ${i.description}`)),
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
// A version-20 workspace still holds the Apify cards: version 21 drops them.
const withApify = { ...buildSeedState(), version: 20, integrations: [...integrations, { ...integrations[0], id: "int_apify", name: "Apify (LinkedIn profile search)" }] };
ok("migration drops the retired Apify cards", !normalizeWorkspaceState(withApify).integrations.some((i) => i.id === "int_apify"));

// One count for every screen: a mock-mode integration is "Simulated", never "Connected".
const counts = integrationCounts(integrations);
ok("mock-mode connections count as simulated, not live", counts.live === 0 && counts.simulated === integrations.filter((i) => i.status === "connected").length);
ok("every integration lands in exactly one state", counts.live + counts.simulated + counts.degraded + counts.error + counts.notConfigured === counts.total);
const firstMock = integrations.find((i) => i.status === "connected");
ok("a mock-mode card reads Simulated", Boolean(firstMock) && integrationStateLabel(firstMock!) === "Simulated");
ok("the same card in live mode reads Live", Boolean(firstMock) && integrationStateLabel({ ...firstMock!, mode: "live" }) === "Live");

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
