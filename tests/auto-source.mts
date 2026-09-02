import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { runAutoSourcePipeline } from "../src/lib/sourcing/auto-source";
import { EMPTY_PEOPLE_FIRST_HARVEST } from "../src/lib/sourcing/people-plugins";
import { formatHarvestEvidenceError } from "../src/lib/sourcing/harvest-evidence";
import { peopleFirstHarvestQueue } from "../src/lib/sourcing/multi-source-plan";
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

{
  let enrichCalls = 0;
  let stackCalls = 0;
  const queries: string[] = [];
  const runIds: string[] = [];
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async (step) => {
      queries.push(step.query + (step.currentJobTitles ?? []).join(","));
      runIds.push(`auto-${runIds.length + 1}`);
      const queue = peopleFirstHarvestQueue(financeJob());
      const last = queue.at(-1);
      const isLast = last?.query === step.query;
      const empty = formatHarvestEvidenceError(
        "empty",
        {
          query: step.query,
          runId: runIds[runIds.length - 1]!,
          status: "SUCCEEDED",
          itemCount: 0,
        },
        { startedSearches: 1 },
      );
      return {
        ok: false,
        error: isLast ? `${empty} enrich=enrich-run-1 github=github-run-1` : empty,
        source: "unavailable",
      };
    },
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
    mergeTechStack: async () => {
      stackCalls += 1;
    },
  });
  ok(
    "Auto source continues after an empty first harvest",
    queries.length >= 2 && peopleFirstHarvestQueue(financeJob()).length >= 2,
  );
  ok(
    "Auto source empty chain uses distinct harvest run ids",
    runIds.length >= 2 && runIds[0] !== runIds[1],
  );
  ok(
    "Auto source empty chain escalates past the 4 canned Calypso harvests",
    queries.length > 4 &&
      queries.some((query) => query.includes("Business Analyst Montreal")) &&
      queries.some((query) => query.includes("Calypso consultant")) &&
      queries.some((query) => /trading-platform BA/i.test(query)) &&
      queries.some((query) => /finance BA/i.test(query)),
  );
  ok(
    "empty LinkedIn search still attempts enrich and GitHub merge",
    enrichCalls >= 1 && stackCalls >= 1 && result.techStackMerged === true,
  );
  ok(
    "exhausted Auto source fails loud and does not invent people",
    result.ok === false &&
      "error" in result &&
      result.error === EMPTY_PEOPLE_FIRST_HARVEST &&
      result.enriched === true,
  );
  ok(
    "after 8 empty LinkedIn harvests the click logs enrich and GitHub run ids",
    result.enrichRunId === "enrich-run-1" && result.githubRunId === "github-run-1",
  );
  ok(
    "a click cannot return 0-and-stop as a success",
    result.ok === false,
  );
}

{
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async (step) => ({
      ok: false,
      error: formatHarvestEvidenceError(
        "empty",
        { query: step.query, runId: "search-only", status: "SUCCEEDED", itemCount: 0 },
        { startedSearches: 1 },
      ),
      source: "unavailable",
    }),
    enrich: async () => ({ ok: true }),
  });
  ok(
    "a click cannot return 0-and-stop success without a logged enrichment attempt",
    result.ok === false &&
      "error" in result &&
      /Enrichment must start/.test(result.error) &&
      result.enriched === false,
  );
}

{
  let enrichCalls = 0;
  let searches = 0;
  const result = await runAutoSourcePipeline({
    job: financeJob(),
    search: async () => {
      searches += 1;
      return searches === 1 ? accepted(0) : accepted(2);
    },
    enrich: async () => {
      enrichCalls += 1;
      return { ok: true };
    },
  });
  ok(
    "Auto source enriches after a later harvest hits",
    result.ok === true && searches === 2 && enrichCalls === 1 && result.enriched === true,
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
  "Auto source wires each chain step as its own harvestQuery POST",
  /runAutoSourcePipeline/.test(storeWiring) &&
    /harvestQuery:\s*step\.query/.test(storeWiring) &&
    /currentJobTitles:\s*step\.currentJobTitles/.test(storeWiring),
);
ok(
  "people-first Source next batch uses the Auto source chain",
  /sourcePeopleFirstBatch/.test(storeWiring) &&
    /sourceNextBatchRaw/.test(storeWiring) &&
    /isPeopleFirstRole\(campaign\.jobAnalysis\)/.test(storeWiring) &&
    /return autoSource\(campaignId, opts\)/.test(storeWiring),
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
