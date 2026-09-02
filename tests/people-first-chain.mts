import assert from "node:assert/strict";
import { runPeopleFirstClickChain } from "../src/lib/sourcing/people-first-chain";
import { peopleFirstHarvestQueue, type PlannedSearch } from "../src/lib/sourcing/multi-source-plan";
import {
  formatFallthroughEvidence,
  parseEnrichmentRunIds,
  peopleFirstAlternateQuery,
  runPeopleFirstEmptyFallthrough,
} from "../src/lib/sourcing/people-first-fallthrough";
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

type Result = { ok: true; accepted: string[] } | { ok: false; error: string; resume?: PlannedSearch };

function captureHarvestLogs(): { logs: Array<Record<string, unknown>>; restore: () => void } {
  const logs: Array<Record<string, unknown>> = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (text.includes("aria_harvest")) {
      try {
        logs.push(JSON.parse(text) as Record<string, unknown>);
      } catch {
        // ignore non-JSON
      }
    }
    return originalWrite(chunk, ...(args as []));
  }) as typeof process.stdout.write;
  return { logs, restore: () => { process.stdout.write = originalWrite; } };
}

// The queue itself: never one harvest, first query stays, escalation past the canned set.
{
  const job = baJob();
  const queries = peopleFirstHarvestQueue(job).map((step) => step.query);
  ok("BA queue is never one harvest", queries.length >= 2);
  ok("first query stays Calypso Business Analyst", queries[0] === "Calypso Business Analyst");
  ok(
    "later harvests escalate past the 4 canned Calypso variants",
    queries.some((query) => query === "Business Analyst Montreal") &&
      queries.some((query) => query === "Calypso consultant") &&
      queries.some((query) => /trading-platform BA/i.test(query)) &&
      queries.some((query) => /finance BA/i.test(query)),
  );
  const canned = new Set(["Calypso Business Analyst", "Calypso", "Calypso Business Analysis"]);
  ok(
    "expansion harvests are not a loop of the same four Calypso strings",
    queries.filter((query) => !canned.has(query)).length >= 3,
  );
}

// One click = one POST. The server owns the chain. No resume: no second POST.
{
  const job = baJob();
  const posts: Array<PlannedSearch | null> = [];
  const chain = await runPeopleFirstClickChain<Result>({
    job,
    search: async (resume) => {
      posts.push(resume);
      return { ok: true, accepted: ["p-1", "p-2"] };
    },
  });
  ok("a hit is one POST, not 8", chain.requests === 1 && posts.length === 1 && posts[0] === null);
  ok("hit result is returned untouched", chain.result.ok === true && chain.resumes.length === 0);
}

// Continuation: the server ran out of chain budget and names the resume step.
// The same click re-POSTs that reviewed step and the server continues from it.
{
  const job = baJob();
  const queue = peopleFirstHarvestQueue(job);
  const posts: Array<PlannedSearch | null> = [];
  const chain = await runPeopleFirstClickChain<Result>({
    job,
    search: async (resume) => {
      posts.push(resume);
      if (resume === null) return { ok: false, error: "Harvest chain needs another request.", resume: queue[3] };
      if (resume.query === queue[3]!.query) {
        return { ok: false, error: "Harvest chain needs another request.", resume: queue[6] };
      }
      return { ok: true, accepted: ["p-late"] };
    },
  });
  ok(
    "CONTINUE re-POSTs the reviewed resume step in the same click",
    chain.requests === 3 &&
      posts[1]?.query === queue[3]!.query &&
      posts[2]?.query === queue[6]!.query &&
      chain.result.ok === true,
  );
  ok("resumes are recorded", chain.resumes.map((step) => step.query).join("|") === `${queue[3]!.query}|${queue[6]!.query}`);
}

// Desync guard: a resume step that is off-plan or moves backwards ends the click. No loop.
{
  const job = baJob();
  const queue = peopleFirstHarvestQueue(job);
  let posts = 0;
  const backwards = await runPeopleFirstClickChain<Result>({
    job,
    search: async (resume) => {
      posts += 1;
      if (resume === null) return { ok: false, error: "continue", resume: queue[5] };
      return { ok: false, error: "continue", resume: queue[2] };
    },
  });
  ok("a backwards resume step stops the click instead of looping", posts === 2 && backwards.result.ok === false);
  posts = 0;
  const offPlan = await runPeopleFirstClickChain<Result>({
    job,
    search: async () => {
      posts += 1;
      return { ok: false, error: "continue", resume: { platform: "Apify", query: "Calypso product page" } };
    },
  });
  ok("an off-plan resume step is ignored", posts === 1 && offPlan.result.ok === false);
  posts = 0;
  const sameStep = await runPeopleFirstClickChain<Result>({
    job,
    search: async () => {
      posts += 1;
      return { ok: false, error: "continue", resume: queue[0] };
    },
  });
  ok("resuming the first step again is a replay, not a second POST", posts === 1);
}

// Rate limit / quota is FAIL, never done, never a second POST that burns another run.
{
  const job = baJob();
  let posts = 0;
  const chain = await runPeopleFirstClickChain<Result>({
    job,
    search: async () => {
      posts += 1;
      return { ok: false, error: "The sourcing-agent rate limit was reached. Try again later." };
    },
  });
  ok(
    "sourcing-agent rate limit is a hard fail, not a retry loop",
    posts === 1 && chain.result.ok === false && /rate limit/.test(chain.result.ok ? "" : chain.result.error),
  );
}

// Fallthrough order: LinkedIn web discovery, then enrich the URLs we hold, then GitHub merge.
{
  const job = baJob();
  const capture = captureHarvestLogs();
  const calls: string[] = [];
  let enrichedUrls: string[] = [];
  const result = await runPeopleFirstEmptyFallthrough({
    job,
    poolUrls: ["https://www.linkedin.com/in/pool-person"],
    discoverLinkedin: async (query) => {
      calls.push(`web:${query}`);
      return { ok: true, urls: ["https://www.linkedin.com/in/web-person", "https://www.linkedin.com/in/pool-person"] };
    },
    enrichProfiles: async (urls) => {
      calls.push("enrich");
      enrichedUrls = urls;
      return { ok: true, runId: "enrich-live-1", status: "SUCCEEDED", itemCount: 2, started: true, acceptedCount: 1 };
    },
    githubHandles: () => ["https://github.com/web-person"],
    mergeGithub: async (handles) => {
      calls.push(`github:${handles.join(",")}`);
      return { ok: true, runId: "github-live-1", status: "SUCCEEDED", itemCount: 1, started: true };
    },
  });
  capture.restore();
  ok(
    "fallthrough order is web discovery, enrich, GitHub",
    calls.join("|") === "web:Business Analyst Montreal|enrich|github:https://github.com/web-person",
  );
  ok(
    "enrich POSTs every LinkedIn URL held once: harvest pool plus web hits, deduped",
    enrichedUrls.length === 2 &&
      enrichedUrls.includes("https://www.linkedin.com/in/pool-person") &&
      enrichedUrls.includes("https://www.linkedin.com/in/web-person"),
  );
  ok(
    "enrich and GitHub run ids and item counts are on the click evidence",
    /enrich=enrich-live-1 items=2/.test(result.logged) &&
      /github=github-live-1 items=1/.test(result.logged) &&
      /web=Business Analyst Montreal:2/.test(result.logged) &&
      result.acceptedCount === 1,
  );
  ok(
    "alternate source is LinkedIn web role+geo, not another Calypso harvestapi string",
    result.alternateQuery === "Business Analyst Montreal" && !/^Calypso\b/.test(result.alternateQuery) &&
      peopleFirstAlternateQuery(job) === "Business Analyst Montreal",
  );
  ok(
    "alternate search is on the aria_harvest trail",
    capture.logs.some((row) => row.phase === "alternate_search" && row.query === "Business Analyst Montreal" && row.items === 2),
  );
  const parsed = parseEnrichmentRunIds(result.logged);
  ok("run ids parse back from the evidence", parsed.enrichRunId === "enrich-live-1" && parsed.githubRunId === "github-live-1");
}

// Nothing to send: an empty-URL Apify POST is invalid-input (Fly 5728ad4), so the
// click logs an explicit skip with the reason instead of faking a run.
{
  const job = baJob();
  const capture = captureHarvestLogs();
  let enrichCalls = 0;
  let githubCalls = 0;
  const result = await runPeopleFirstEmptyFallthrough({
    job,
    poolUrls: [],
    discoverLinkedin: async () => ({ ok: false, urls: [], detail: "no Tavily key in Access & Keys" }),
    enrichProfiles: async () => {
      enrichCalls += 1;
      return { ok: true, runId: "should-not-run", status: "SUCCEEDED", itemCount: 0, started: true, acceptedCount: 0 };
    },
    githubHandles: () => [],
    mergeGithub: async () => {
      githubCalls += 1;
      return { ok: true, runId: "should-not-run", status: "SUCCEEDED", itemCount: 0, started: true };
    },
  });
  capture.restore();
  ok("no URLs means no enrich POST and no GitHub POST", enrichCalls === 0 && githubCalls === 0);
  ok(
    "skips are logged with their reason on the aria_harvest trail",
    capture.logs.some((row) => row.phase === "enrich_skipped" && String(row.detail).includes("invalid-input")) &&
      capture.logs.some((row) => row.phase === "github_skipped") &&
      capture.logs.some((row) => row.phase === "alternate_search" && row.started === false),
  );
  ok(
    "skipped steps are honest in the click evidence and never parse as run ids",
    /enrich=skipped/.test(result.logged) &&
      /github=skipped/.test(result.logged) &&
      /web=Business Analyst Montreal:not_started \(no Tavily key/.test(result.logged) &&
      parseEnrichmentRunIds(result.logged).enrichRunId === undefined &&
      parseEnrichmentRunIds(result.logged).githubRunId === undefined &&
      result.acceptedCount === 0,
  );
  ok("no invented people", result.acceptedCount === 0 && formatFallthroughEvidence(result) === result.logged);
}

assert.ok(pass > 0);
console.log(`RESULT people-first-chain: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
