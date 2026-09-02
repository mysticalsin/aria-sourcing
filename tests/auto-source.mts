import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { runAutoSourcePipeline } from "../src/lib/sourcing/auto-source";
import { EMPTY_PEOPLE_FIRST_HARVEST } from "../src/lib/sourcing/people-plugins";
import { formatHarvestEvidenceError } from "../src/lib/sourcing/harvest-evidence";
import type { JobAnalysis } from "../src/lib/types";
import type { SourceNextBatchResult } from "../src/lib/store/contracts";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function financeJob(title = "Senior Calypso Business Analyst"): JobAnalysis {
  return {
    title,
    department: "IS&D - Business Analysis",
    seniority: "Senior",
    employmentType: "Contract",
    locationType: "Hybrid",
    location: "Montreal",
    regions: ["Montreal"],
    timezone: "America/Montreal",
    salaryMin: null,
    salaryMax: null,
    currency: "CAD",
    equity: false,
    requiredSkills: ["Calypso", "Business Analysis"],
    niceToHaveSkills: [],
    minYearsExperience: 5,
    maxYearsExperience: null,
    education: "",
    industryExperience: ["Finance"],
    companyStageTarget: [],
    teamSize: "",
    reportingTo: "",
    urgency: "Standard",
    validationWarnings: [],
  };
}

function softwareJob(): JobAnalysis {
  return {
    ...financeJob("Senior Backend Engineer"),
    department: "Engineering",
    requiredSkills: ["Python", "Linux"],
    industryExperience: [],
  };
}

function accepted(n: number): SourceNextBatchResult {
  return {
    ok: true,
    source: "web",
    accepted: Array.from({ length: n }, (_, i) => ({ id: `p-${i}` })) as never,
    skipped: [],
  };
}

{
  let searches = 0;
  let enrichCalls = 0;
  let stackCalls = 0;
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => {
      searches += 1;
      return accepted(2);
    },
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
    mergeTechStack: async () => {
      stackCalls += 1;
    },
  });
  ok("BA Auto source is one click chain, then enrich", searches === 1 && result.ok === true && enrichCalls === 1 && result.enriched === true);
  ok(
    "BA Auto source merges GitHub onto the same LinkedIn people, not as the shortlist",
    stackCalls === 1 &&
      result.techStackMerged === true &&
      result.ok === true &&
      !JSON.stringify(result.accepted).includes("github.com"),
  );
}

{
  let stackCalls = 0;
  const result = await runAutoSourcePipeline({
    job: softwareJob(),
    search: async () => accepted(1),
    enrich: async () => ({ ok: true }),
    mergeTechStack: async () => {
      stackCalls += 1;
    },
  });
  ok("software Auto source merges GitHub tech-stack onto the same people", result.ok === true && stackCalls === 1 && result.techStackMerged === true);
}

// The server ran every planned harvest, LinkedIn web, enrich, and GitHub and
// still found nobody. The click is a fail with the run ids on it. Nothing
// here pretends an "enriched" banner over 0 people.
{
  let enrichCalls = 0;
  let stackCalls = 0;
  const empty = formatHarvestEvidenceError(
    "empty",
    { query: "finance BA", runId: "6IKfh6X9GYVa2HBkO", status: "SUCCEEDED", itemCount: 0 },
    { startedSearches: 8 },
  );
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => ({
      ok: false,
      error: `${empty} web=Business Analyst Montreal:3 enrich=enrich-run-1 items=3 github=github-run-1 items=1`,
      source: "unavailable",
    }),
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
    mergeTechStack: async () => {
      stackCalls += 1;
    },
  });
  ok(
    "exhausted chain fails loud, keeps the evidence, and does not invent people",
    result.ok === false &&
      "error" in result &&
      /Every planned search was tried/.test(result.error) &&
      /run=6IKfh6X9GYVa2HBkO/.test(result.error),
  );
  ok(
    "the click carries the enrich and GitHub run ids the server logged",
    result.enrichRunId === "enrich-run-1" && result.githubRunId === "github-run-1",
  );
  ok(
    "0 people is never dressed as enriched",
    result.enriched === false && result.techStackMerged === false && enrichCalls === 0 && stackCalls === 0,
  );
}

// Skipped steps are not run ids.
{
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => ({
      ok: false,
      error: `${EMPTY_PEOPLE_FIRST_HARVEST} web=Business Analyst Montreal:not_started (no Tavily key) enrich=skipped (nobody to enrich) github=skipped`,
      source: "unavailable",
    }),
    enrich: async () => ({ ok: true }),
  });
  ok(
    "a skipped enrich is honest: no run id, no enriched banner",
    result.ok === false && result.enrichRunId === undefined && result.githubRunId === undefined && result.enriched === false,
  );
}

// Rate limit / quota is FAIL. Never done, never a banner.
{
  let enrichCalls = 0;
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => ({
      ok: false,
      error: "The sourcing-agent rate limit was reached. Try again later.",
      source: "unavailable",
    }),
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
  });
  ok(
    "sourcing-agent rate limit is never treated as success",
    result.ok === false &&
      "error" in result &&
      /rate limit/.test(result.error) &&
      result.enriched === false &&
      enrichCalls === 0,
  );
}

// A 200 with 0 people is not a shortlist.
{
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => accepted(0),
    enrich: async () => ({ ok: true }),
  });
  ok(
    "a click cannot return 0-and-stop as a success",
    result.ok === false && "error" in result && result.error === EMPTY_PEOPLE_FIRST_HARVEST && result.enriched === false,
  );
}

{
  const empty = formatHarvestEvidenceError("empty", {
    query: "Calypso Business Analyst",
    runId: "run-1",
    status: "SUCCEEDED",
    itemCount: 0,
  });
  ok(
    "user-facing harvest error has no actor id or actor name",
    /query=Calypso Business Analyst/.test(empty) &&
      /run=run-1/.test(empty) &&
      !/actor=/.test(empty) &&
      !/harvestapi/.test(empty) &&
      !/M2FMdjR/.test(empty) &&
      !/Source via Apify/.test(empty),
  );
}

const chromeFiles = [
  "src/app/page.tsx",
  "src/app/campaigns/[id]/page.tsx",
  "src/app/candidates/page.tsx",
  "src/lib/sourcing/harvest-evidence.ts",
  "src/lib/sourcing/people-plugins.ts",
  "src/components/candidates/source-apify-dialog.tsx",
];
const chrome = chromeFiles.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
ok(
  "user chrome has Source next batch and Auto source",
  /Source next batch/.test(chrome) &&
    /Auto source/.test(readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8")) &&
    /Auto source/.test(readFileSync(new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url), "utf8")) &&
    /Auto source/.test(readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8")),
);
ok(
  "user chrome has no Source via Apify or actor-named buttons",
  !/Source via Apify/.test(chrome) &&
    !/M2FMdjRVeF1HPGFcc/.test(chrome) &&
    !/LpVuK3Zozwuipa5bp/.test(chrome) &&
    !/HCPOl6k3LqnOVdFns/.test(chrome) &&
    !/Run sourcing agent/.test(chrome),
);

const storeWiring = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
ok(
  "Auto source is one POST per click; the server owns the harvest chain",
  /runAutoSourcePipeline/.test(storeWiring) &&
    /search: \(\) => sourceNextBatchRaw\(campaignId, opts\)/.test(storeWiring) &&
    !/harvestQuery:\s*step\.query/.test(storeWiring),
);
ok(
  "people-first Source next batch uses the Auto source chain",
  /sourcePeopleFirstBatch/.test(storeWiring) &&
    /sourceNextBatchRaw/.test(storeWiring) &&
    /isPeopleFirstRole\(campaign\.jobAnalysis\)/.test(storeWiring) &&
    /return autoSource\(campaignId, opts\)/.test(storeWiring),
);
const actions = readFileSync(new URL("../src/lib/store/sourcing-actions.ts", import.meta.url), "utf8");
ok(
  "reviewed-batch action re-POSTs only on a server resume step, never a client-side 8-harvest loop",
  /runPeopleFirstClickChain/.test(actions) &&
    !/for \(const step of peopleFirstHarvestQueue/.test(actions) &&
    /resume: reviewed\.resume/.test(actions),
);

const campaigns = readFileSync(new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url), "utf8");
ok(
  "campaign sourcing chrome is two clicks only",
  /handleAutoSource/.test(campaigns) &&
    !/SourceApifyButton/.test(campaigns) &&
    !/SourceSillageButton/.test(campaigns) &&
    !/SourceApolloButton/.test(campaigns) &&
    !/SourceSeamlessButton/.test(campaigns) &&
    !/Run Aria/.test(campaigns),
);

assert.ok(pass > 0);
console.log(`RESULT auto-source: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
