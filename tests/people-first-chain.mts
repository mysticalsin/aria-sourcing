import assert from "node:assert/strict";
import { runPeopleFirstHarvestChain } from "../src/lib/sourcing/people-first-chain";
import { peopleFirstHarvestQueue } from "../src/lib/sourcing/multi-source-plan";
import type { JobAnalysis } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
}

function baJob(): JobAnalysis {
  return {
    title: "Senior Calypso Business Analyst",
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

{
  const job = baJob();
  const queue = peopleFirstHarvestQueue(job);
  ok("BA queue is never one harvest", queue.length >= 2);
  const runIds: string[] = [];
  const result = await runPeopleFirstHarvestChain({
    job,
    search: async (step) => {
      const runId = `harvestapi-${runIds.length + 1}`;
      runIds.push(runId);
      return {
        runId,
        started: true,
        itemCount: 0,
        status: "SUCCEEDED",
        accepted: [],
      };
    },
  });
  ok("empty items=0 starts a second harvest, not a toast", runIds.length >= 2);
  ok(
    "second harvest has a distinct run id",
    runIds[0] !== runIds[1] && new Set(runIds).size === runIds.length,
  );
  ok(
    "empty chain escalates past the 4 canned Calypso harvests",
    runIds.length > 4 && new Set(runIds).size === runIds.length,
  );
  ok(
    "empty chain runs role+geo+synonym harvests",
    result.attempts.some((attempt) => attempt.step.query === "Business Analyst Montreal") &&
      result.attempts.some((attempt) => attempt.step.query === "Calypso consultant") &&
      result.attempts.some((attempt) => /trading-platform BA/i.test(attempt.step.query)) &&
      result.attempts.some((attempt) => /finance BA/i.test(attempt.step.query)),
  );
  ok("empty chain does not invent people", result.accepted.length === 0);
  ok(
    "first query stays Calypso Business Analyst",
    result.attempts[0]?.step.query === "Calypso Business Analyst",
  );
  ok(
    "harvest 2 is a broader query or next actor-input",
    result.attempts[1]?.step.query !== "Calypso Business Analyst" ||
      (result.attempts[1]?.step.currentJobTitles ?? []).includes("Business Analyst"),
  );
}

{
  const job = baJob();
  let calls = 0;
  const result = await runPeopleFirstHarvestChain({
    job,
    search: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          runId: "run-empty-1",
          started: true,
          itemCount: 0,
          status: "SUCCEEDED",
          accepted: [],
        };
      }
      return {
        runId: "run-hit-2",
        started: true,
        itemCount: 2,
        status: "SUCCEEDED",
        accepted: [{ id: "p-1" }, { id: "p-2" }],
      };
    },
  });
  ok("chain stops once a real shortlist lands", calls === 2 && result.accepted.length === 2);
  ok(
    "hit harvest is a distinct second run id",
    result.attempts[0]?.runId === "run-empty-1" && result.attempts[1]?.runId === "run-hit-2",
  );
}

{
  const job = baJob();
  let calls = 0;
  await runPeopleFirstHarvestChain({
    job,
    search: async () => {
      calls += 1;
      return {
        runId: "",
        started: false,
        itemCount: 0,
        status: "NOT_STARTED",
        accepted: [],
        stop: true,
      };
    },
  });
  ok("hard stop does not fake a second run id", calls === 1);
}

{
  const job = baJob();
  const queries = peopleFirstHarvestQueue(job).map((step) => step.query);
  ok("first query stays Calypso Business Analyst", queries[0] === "Calypso Business Analyst");
  ok(
    "later harvests escalate past the 4 canned Calypso variants",
    queries.some((query) => query === "Business Analyst Montreal") &&
      queries.some((query) => query === "Calypso consultant") &&
      queries.some((query) => /trading-platform BA/i.test(query)) &&
      queries.some((query) => /finance BA/i.test(query)),
  );
  const canned = new Set([
    "Calypso Business Analyst",
    "Calypso",
    "Calypso Business Analysis",
  ]);
  ok(
    "expansion harvests are not a loop of the same four Calypso strings",
    queries.filter((query) => !canned.has(query)).length >= 3,
  );
}

{
  const { isLastPeopleFirstHarvest, peopleFirstAlternateQuery, runPeopleFirstEmptyFallthrough } =
    await import("../src/lib/sourcing/people-first-fallthrough");
  const job = baJob();
  const queue = peopleFirstHarvestQueue(job);
  const logs: Array<{ phase: string; actor?: string; runId?: string }> = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (text.includes("aria_harvest")) {
      try {
        logs.push(JSON.parse(text) as { phase: string; actor?: string; runId?: string });
      } catch {
        // ignore non-JSON
      }
    }
    return originalWrite(chunk, ...(args as []));
  }) as typeof process.stdout.write;
  let enrichStarts = 0;
  let githubStarts = 0;
  let alternateQuery = "";
  const fallthrough = await runPeopleFirstEmptyFallthrough({
    job,
    startEnrich: async () => {
      enrichStarts += 1;
      return { ok: true, runId: "enrich-live-1", status: "READY" };
    },
    startGithub: async () => {
      githubStarts += 1;
      return { ok: true, runId: "github-live-1", status: "READY" };
    },
    alternateSearch: async (query) => {
      alternateQuery = query;
      return { acceptedCount: 0 };
    },
  });
  process.stdout.write = originalWrite;
  ok(
    "first harvest is not the last planned harvest",
    !isLastPeopleFirstHarvest(job, queue[0]!) && isLastPeopleFirstHarvest(job, queue.at(-1)!),
  );
  ok(
    "after 8 empty LinkedIn harvests enrich and GitHub runs start",
    enrichStarts === 1 && githubStarts === 1 && fallthrough.enrich.started && fallthrough.github.started,
  );
  ok(
    "enrich and GitHub run ids are logged on the harvest trail",
    logs.some((row) => row.actor === "harvestapi~linkedin-profile-scraper" && row.runId === "enrich-live-1") &&
      logs.some((row) => row.actor === "apivault_labs~github-profile-scraper" && row.runId === "github-live-1") &&
      /enrich=enrich-live-1/.test(fallthrough.logged) &&
      /github=github-live-1/.test(fallthrough.logged),
  );
  ok(
    "alternate source is not another Calypso harvestapi string",
    alternateQuery === "Business Analyst Montreal" &&
      !/^Calypso\b/.test(alternateQuery) &&
      fallthrough.alternateQuery === "Business Analyst Montreal",
  );
}

assert.ok(pass > 0);
console.log(`RESULT people-first-chain: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
