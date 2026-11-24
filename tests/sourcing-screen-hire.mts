import { readFileSync } from "node:fs";
import { odooExecuteResponse } from "../src/lib/fake-odoo";
import { hireFromSourcingScreen, type SourcingScreen } from "../src/lib/sourcing-screen-hire";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const fixture = {
  idempotencyKey: "screen-fixture",
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
};

function fixtureOutcome(result: Awaited<ReturnType<typeof hireFromSourcingScreen>>) {
  const byErp = Object.fromEntries((result.connectors ?? []).map((connector) => [connector.erp, connector]));
  return {
    transport: result.transport,
    ok: result.ok,
    unset: result.unset,
    smart: byErp.smart,
    api: byErp.api,
    mcp: byErp.mcp,
  };
}

let liveCalls = 0;
const search = await hireFromSourcingScreen(
  { ...fixture, screen: "search" },
  { NODE_ENV: "test" },
  async () => {
    liveCalls += 1;
    throw new Error("live fetch");
  },
);
const searchOutcome = fixtureOutcome(search);
ok(
  "search uses fixture SMART, API, and MCP, and unset stays skipped",
  liveCalls === 0 &&
    searchOutcome.transport === "fixture" &&
    searchOutcome.ok === true &&
    searchOutcome.unset?.ok === true &&
    searchOutcome.unset?.erp === "skipped" &&
    searchOutcome.unset?.linkedIn === true &&
    searchOutcome.unset?.fetchCount === 0 &&
    searchOutcome.smart?.hired === true &&
    searchOutcome.api?.hired === true &&
    searchOutcome.mcp?.hired === true &&
    (searchOutcome.smart?.hosts ?? []).every((host) => host.startsWith("https://smart.example.test/")) &&
    (searchOutcome.api?.hosts ?? []).every((host) => host.startsWith("https://hire-api.example.test/")) &&
    (searchOutcome.mcp?.hosts ?? []).every((host) => host.startsWith("https://hire-mcp.example.test/")),
);

for (const screen of ["shortlist", "candidate", "command"] as const) {
  const result = await hireFromSourcingScreen({ ...fixture, screen, idempotencyKey: `${screen}-fixture` }, { NODE_ENV: "test" });
  const outcome = fixtureOutcome(result);
  ok(
    `${screen} reaches the same fixture hire`,
    outcome.transport === "fixture" &&
      outcome.ok === true &&
      outcome.unset?.erp === "skipped" &&
      outcome.unset?.fetchCount === 0 &&
      outcome.smart?.hired === true &&
      outcome.api?.hired === true &&
      outcome.mcp?.hired === true,
  );
}

const liveEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://203.0.113.50/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};
const seen: string[] = [];
const live = await hireFromSourcingScreen({ ...fixture, screen: "command" }, liveEnv, (async (url: string, init?: RequestInit) => {
  seen.push(url);
  const body = JSON.parse(String(init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } };
  return odooExecuteResponse(body, () => 11);
}) as typeof fetch);
ok(
  "a configured public connector uses the live transport instead of the fixture",
  live.transport === "live" && live.ok === true && live.erp === "odoo" && seen.every((url) => url === "https://203.0.113.50/jsonrpc"),
);

let refusedCalls = 0;
const refused = await hireFromSourcingScreen(
  { ...fixture, screen: "candidate" },
  { ...liveEnv, ODOO_URL: "http://10.0.0.8/" },
  async () => {
    refusedCalls += 1;
    throw new Error("private fetch");
  },
);
ok(
  "a non-https private host is refused before fetch",
  refused.ok === false && refused.transport === "live" && refusedCalls === 0,
);

const screens = ["search", "shortlist", "candidate", "command"] as const;
const files: Record<SourcingScreen, string> = {
  search: readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8"),
  shortlist: readFileSync(new URL("../src/components/tania/vivier-view.tsx", import.meta.url), "utf8"),
  candidate: readFileSync(new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url), "utf8"),
  command: readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
};
for (const screen of screens) {
  ok(`${screen} screen renders the hire panel`, files[screen].includes(`screen="${screen}"`) && files[screen].includes("SourcingHirePanel"));
}
function absoluteHosts(source: string): string[] {
  const hosts: string[] = [];
  for (const match of source.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    hosts.push(new URL(match[0]).hostname);
  }
  return hosts;
}
const route = readFileSync(new URL("../src/app/api/hire/sourcing/route.ts", import.meta.url), "utf8");
const hireLib = readFileSync(new URL("../src/lib/sourcing-screen-hire.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/hire/sourcing-hire-panel.tsx", import.meta.url), "utf8");
const routeHosts = absoluteHosts(route);
const hireHosts = absoluteHosts(hireLib);
const panelHosts = absoluteHosts(panel);
const seenHosts = seen.map((url) => new URL(url).hostname);
const allowedFixtureHosts = new Set(["smart.example.test", "hire-api.example.test", "hire-mcp.example.test"]);
ok(
  "hire makes no request except fixture hosts or the stubbed public host",
  route.includes("hireFromSourcingScreen") &&
    routeHosts.length === 0 &&
    panelHosts.length === 0 &&
    hireHosts.every((host) => allowedFixtureHosts.has(host)) &&
    liveCalls === 0 &&
    refusedCalls === 0 &&
    seenHosts.length > 0 &&
    seenHosts.every((host) => host === "203.0.113.50"),
);

console.log(`RESULT sourcing-screen-hire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
