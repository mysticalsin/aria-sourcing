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
    regions: ["Europe"],
    timezone: "Europe/Paris",
    salaryMin: null,
    salaryMax: null,
    currency: "EUR",
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
  let enrichCalls = 0;
  let stackCalls = 0;
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => accepted(2),
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
    mergeTechStack: async () => {
      stackCalls += 1;
    },
  });
  ok("BA Auto source searches then enriches", result.ok === true && enrichCalls === 1 && result.enriched === true);
  ok("BA Auto source does not merge GitHub leftovers", stackCalls === 0 && result.techStackMerged !== true);
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

{
  let enrichCalls = 0;
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => accepted(0),
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
  });
  ok(
    "empty Auto source harvest fails loud and does not invent people",
    result.ok === false &&
      enrichCalls === 0 &&
      "error" in result &&
      result.error === EMPTY_PEOPLE_FIRST_HARVEST,
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
