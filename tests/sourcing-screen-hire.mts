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

let liveCalls = 0;
const search = await hireFromSourcingScreen(
  { ...fixture, screen: "search" },
  { NODE_ENV: "test" },
  async () => {
    liveCalls += 1;
    throw new Error("live fetch");
  },
);
ok(
  "search hires on the fake Odoo when no connector is configured",
  liveCalls === 0 &&
    search.ok === true &&
    search.erp === "odoo" &&
    search.linkedIn === true &&
    search.transport === "fake" &&
    search.steps.map((step) => step.action).join(",") === "job,applicant,stage,hire" &&
    search.steps[2]?.skipped === true &&
    JSON.stringify(search.vacancyClose) === JSON.stringify([[11], { no_of_recruitment: 0 }]) &&
    JSON.stringify(search.vacancyKwargs) === "{}" &&
    search.hrJobStateSent === false,
);

for (const screen of ["shortlist", "candidate", "command"] as const) {
  const result = await hireFromSourcingScreen({ ...fixture, screen, idempotencyKey: `${screen}-fixture` }, { NODE_ENV: "test" });
  ok(
    `${screen} reaches the same fake hire`,
    result.transport === "fake" && result.ok === true && result.erp === "odoo" && result.linkedIn === true,
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
  "a configured public connector uses the live transport instead of the fake",
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
ok(
  "hire makes no request except the stubbed public host",
  route.includes("hireFromSourcingScreen") &&
    routeHosts.length === 0 &&
    panelHosts.length === 0 &&
    hireHosts.length > 0 &&
    hireHosts.every((host) => host === "odoo.example.test") &&
    liveCalls === 0 &&
    refusedCalls === 0 &&
    seenHosts.length > 0 &&
    seenHosts.every((host) => host === "203.0.113.50"),
);

console.log(`RESULT sourcing-screen-hire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
