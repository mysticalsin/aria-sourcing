import { buildSeedState } from "../src/lib/seed";
import { mapApifyCandidates } from "../src/lib/store/sourcing-helpers";
import type { ApifyProfile } from "../src/lib/sourcing/apify";
import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

const {
  startProfileSearchRun,
  getRunStatus,
  fetchDatasetItems,
  testApifyConnection,
  runProfileSearchAndWait,
  harvestapiActorInput,
} = await import("../src/lib/sourcing/apify");
const { clearProviderProbe } = await import("../src/lib/sourcing/provider-egress");
const apifyClearance = clearProviderProbe("Apify");

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const s = buildSeedState();
const campaign = s.campaigns[0];
const W = campaign.scoringWeights;

// A realistic "Full + email search" harvestapi/linkedin-profile-search dataset
// item — shape validated live against the actor (docs/superpowers/plans/
// 2026-07-15-apify-linkedin-source.md), NOT the actor's published docs (which
// were inaccurate). All names/emails/companies below are synthetic.
const sampleFullRawItem = {
  id: "abc123",
  publicIdentifier: "test-candidate-dev",
  linkedinUrl: "https://www.linkedin.com/in/test-candidate-dev",
  firstName: "Test",
  lastName: "Candidate",
  headline: "Senior Go Engineer at Acme Corp",
  about: "Distributed systems engineer working on Kubernetes and gRPC platforms.",
  emails: [
    {
      email: "test@example.com",
      deliverable: true,
      catchAllDomain: false,
      validEmailServer: true,
      free: false,
      status: "valid",
      qualityScore: 80,
    },
  ],
  phones: [{ phoneNumber: "+33 6 12 34 56 78" }],
  location: {
    linkedinText: "Paris, France",
    countryCode: "FR",
    parsed: { city: "Paris", country: "France", countryCode: "FR" },
  },
  connectionsCount: 500,
  followerCount: 1200,
  currentPosition: [
    {
      position: "Senior Go Engineer",
      companyName: "Acme Corp",
      duration: "1 yr 6 mos",
      startDate: { month: "Jan", year: 2025, text: "Jan 2025" },
      endDate: { text: "Present" },
    },
  ],
  experience: [
    {
      position: "Senior Go Engineer",
      companyName: "Acme Corp",
      duration: "1 yr 6 mos",
      startDate: { month: "Jan", year: 2025, text: "Jan 2025" },
      endDate: { text: "Present" },
    },
    {
      position: "Software Engineer",
      companyName: "Prior Co",
      duration: "2 yrs",
      startDate: { year: 2021, text: "2021" },
      endDate: { year: 2023, text: "2023" },
    },
  ],
  education: [
    {
      schoolName: "EPITA",
      degree: "MSc Computer Science",
      fieldOfStudy: "Computer Science",
      period: "2012 - 2017",
      startDate: { year: 2012, text: "2012" },
      endDate: { year: 2017, text: "2017" },
    },
  ],
  // Observed live: topSkills items are plain strings, not {name} objects —
  // mapProfile's topSkillNames() stays defensive for both shapes regardless.
  topSkills: ["Go", "Kubernetes"],
  skills: [
    { name: "Go", endorsements: "5 endorsements" },
    { name: "Kubernetes" },
    { name: "gRPC" },
    { name: "Distributed Systems" },
  ],
  languages: [
    { name: "English", proficiency: "Native or bilingual proficiency" },
    { name: "French", proficiency: "Professional working proficiency" },
  ],
  openToWork: false,
  hiring: false,
  premium: true,
  verified: true,
  objectUrn: "999999",
  registeredAt: "2015-01-01T00:00:00.000Z",
};

// A realistic "Short" mode dataset item (cheap discovery) — no headline/about/
// skills/emails/publicIdentifier, obfuscated linkedinUrl, plural currentPositions
// with a different item shape than Full's currentPosition/experience.
const sampleShortRawItem = {
  id: "short123",
  linkedinUrl: "https://www.linkedin.com/in/ACwAAB1234567890abcdefghijklmnopqrstuvwx",
  firstName: "Sample",
  lastName: "Short",
  openProfile: false,
  premium: false,
  currentPositions: [
    {
      title: "Staff Engineer",
      companyName: "Beta Inc",
      description: null,
      tenureAtPosition: { numYears: 2, numMonths: 3 },
      startedOn: { month: 4, year: 2024 },
      current: true,
    },
  ],
  location: { linkedinText: "Berlin, Germany" },
  _meta: { searchId: "search-1" },
  profileIdInSearch: 0,
};

const originalFetch = globalThis.fetch;

try {
  // --- startProfileSearchRun: builds correct actor input + parses ids -------
  {
    let seenUrl = "";
    let seenAuth: string | undefined;
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      seenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse(201, {
        data: { id: "run_1", defaultDatasetId: "dataset_1", status: "READY" },
      });
    }) as typeof fetch;

    const res = await startProfileSearchRun(apifyClearance, "apify_api_tok123", {
      searchQuery: "Senior Go Engineer",
      profileScraperMode: "Short",
      maxItems: 10,
      locations: ["Paris, France"],
      currentJobTitles: ["Senior Go Engineer"],
    });

    ok("start hits the actor run path with the ~ actor id", seenUrl.includes("/actors/harvestapi~linkedin-profile-search/runs"));
    ok("start sends Bearer auth", seenAuth === "Bearer apify_api_tok123");
    ok("start sends only the set actor input fields", seenBody.searchQuery === "Senior Go Engineer" && seenBody.profileScraperMode === "Short" && seenBody.maxItems === 10 && Array.isArray(seenBody.locations) && !("takePages" in seenBody) && !("startPage" in seenBody));
    ok(
      "harvestapi actor input field is searchQuery, not keywords or q",
      harvestapiActorInput({ searchQuery: "Calypso Business Analyst" }).searchQuery ===
        "Calypso Business Analyst" &&
        !("keywords" in harvestapiActorInput({ searchQuery: "Calypso Business Analyst" })) &&
        !("query" in harvestapiActorInput({ searchQuery: "Calypso Business Analyst" })),
    );
    ok("start result is ok", res.ok === true);
    if (res.ok) {
      ok("start parses runId", res.data.runId === "run_1");
      ok("start parses datasetId", res.data.datasetId === "dataset_1");
      ok("start parses status", res.data.status === "READY");
    }
  }

  // --- startProfileSearchRun: caps maxItems server-side at 50 ----------------
  {
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse(201, { data: { id: "run_2", defaultDatasetId: "dataset_2", status: "READY" } });
    }) as typeof fetch;
    await startProfileSearchRun(apifyClearance, "tok", { searchQuery: "q", maxItems: 500 });
    ok("start caps maxItems at the server-side ceiling", seenBody.maxItems === 50);
  }

  // --- getRunStatus: parses status -------------------------------------------
  {
    globalThis.fetch = (async () => jsonResponse(200, { data: { status: "SUCCEEDED" } })) as typeof fetch;
    const res = await getRunStatus(apifyClearance, "tok", "run_1");
    ok("getRunStatus result is ok", res.ok === true);
    if (res.ok) ok("getRunStatus parses SUCCEEDED", res.data.status === "SUCCEEDED");

    globalThis.fetch = (async () => jsonResponse(200, { data: { status: "RUNNING" } })) as typeof fetch;
    const res2 = await getRunStatus(apifyClearance, "tok", "run_1");
    if (res2.ok) ok("getRunStatus parses RUNNING", res2.data.status === "RUNNING");
  }

  // --- getRunStatus: error path -----------------------------------------------
  {
    globalThis.fetch = (async () => jsonResponse(404, { error: { type: "run-not-found", message: "Run not found" } })) as typeof fetch;
    const res = await getRunStatus(apifyClearance, "tok", "missing_run");
    ok("getRunStatus surfaces a 404 as not-ok", res.ok === false && res.status === 404);
  }

  // --- fetchDatasetItems: normalizes a Full-mode item -------------------------
  {
    let seenUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      seenUrl = String(url);
      return jsonResponse(200, [sampleFullRawItem]);
    }) as typeof fetch;
    const res = await fetchDatasetItems(apifyClearance, "tok", "dataset_1", 10);
    ok("fetchDatasetItems hits the datasets items path", seenUrl.includes("/datasets/dataset_1/items") && seenUrl.includes("format=json") && seenUrl.includes("limit=10"));
    ok("fetchDatasetItems result is ok", res.ok === true);
    if (res.ok) {
      const p = res.data[0];
      ok("fetchDatasetItems returns one profile", res.data.length === 1);
      ok("normalizes id", p?.id === "abc123");
      ok("normalizes publicIdentifier", p?.publicIdentifier === "test-candidate-dev");
      ok("normalizes linkedinUrl", p?.linkedinUrl === "https://www.linkedin.com/in/test-candidate-dev");
      ok("normalizes firstName/lastName", p?.firstName === "Test" && p?.lastName === "Candidate");
      ok("normalizes headline", p?.headline === "Senior Go Engineer at Acme Corp");
      ok("normalizes about", p?.about === sampleFullRawItem.about);
      ok("normalizes email from emails[] (status===valid)", p?.email === "test@example.com");
      ok("normalizes phone from phones[] without inventing", p?.phone === "+33 6 12 34 56 78");
      ok("normalizes nested location (text + countryCode)", p?.location?.text === "Paris, France" && p?.location?.countryCode === "FR");
      ok(
        "normalizes currentPosition from the Full array (position -> title, startDate/endDate -> dateRange)",
        p?.currentPosition[0]?.title === "Senior Go Engineer" &&
          p?.currentPosition[0]?.companyName === "Acme Corp" &&
          p?.currentPosition[0]?.dateRange === "Jan 2025 - Present",
      );
      ok(
        "normalizes experience (position/duration/startDate/endDate)",
        p?.experience[0]?.title === "Senior Go Engineer" &&
          p?.experience[0]?.dateRange === "Jan 2025 - Present" &&
          p?.experience[1]?.title === "Software Engineer" &&
          p?.experience[1]?.dateRange === "2021 - 2023",
      );
      ok(
        "normalizes education (schoolName/degree/period)",
        p?.education[0]?.schoolName === "EPITA" && p?.education[0]?.degree === "MSc Computer Science" && p?.education[0]?.dateRange === "2012 - 2017",
      );
      ok("normalizes topSkills to a string[] of names", Array.isArray(p?.topSkills) && p?.topSkills.join(",") === "Go,Kubernetes");
      ok("normalizes skills to a string[] of names", !!p?.skills.includes("Kubernetes") && !!p?.skills.includes("gRPC"));
      ok("normalizes languages to a string[] of names", !!p?.languages.includes("English") && !!p?.languages.includes("French"));
      ok("normalizes openToWork/hiring/premium", p?.openToWork === false && p?.hiring === false && p?.premium === true);
    }
  }

  // --- fetchDatasetItems: topSkills is defensive for the {name} object shape,
  // even though live observation shows plain strings (ground-truth spec calls
  // for handling both — some actor runs may still emit the object form) -------
  {
    globalThis.fetch = (async () =>
      jsonResponse(200, [{ ...sampleFullRawItem, id: "objshape1", topSkills: [{ name: "Rust" }, "Postgres"] }])) as typeof fetch;
    const res = await fetchDatasetItems(apifyClearance, "tok", "dataset_objshape", 10);
    if (res.ok) {
      const p = res.data[0];
      ok(
        "topSkills normalizes a mixed array of {name} objects and plain strings",
        Array.isArray(p?.topSkills) && p?.topSkills.join(",") === "Rust,Postgres",
      );
    }
  }

  // --- fetchDatasetItems: normalizes a Short-mode item ------------------------
  {
    globalThis.fetch = (async () => jsonResponse(200, [sampleShortRawItem])) as typeof fetch;
    const res = await fetchDatasetItems(apifyClearance, "tok", "dataset_short", 10);
    ok("fetchDatasetItems (Short) result is ok", res.ok === true);
    if (res.ok) {
      const p = res.data[0];
      ok("Short: normalizes id/firstName/lastName", p?.id === "short123" && p?.firstName === "Sample" && p?.lastName === "Short");
      ok("Short: linkedinUrl carries the obfuscated urn form through unchanged", p?.linkedinUrl === sampleShortRawItem.linkedinUrl);
      ok("Short: publicIdentifier defaults blank (field doesn't exist in Short mode)", p?.publicIdentifier === "");
      ok("Short: headline/about default blank (fields don't exist in Short mode)", p?.headline === "" && p?.about === "");
      ok(
        "Short: currentPositions (plural) normalizes into currentPosition[]",
        p?.currentPosition[0]?.title === "Staff Engineer" &&
          p?.currentPosition[0]?.companyName === "Beta Inc" &&
          p?.currentPosition[0]?.dateRange === "Apr 2024 - Present",
      );
      ok("Short: no email (field doesn't exist in Short mode)", p?.email === null);
      ok("Short: no skills/topSkills/languages (fields don't exist in Short mode)", p?.skills.length === 0 && p?.topSkills.length === 0 && p?.languages.length === 0);
      ok("Short: location.text carried through, no countryCode available", p?.location?.text === "Berlin, Germany" && p?.location?.countryCode === null);
      ok("Short: premium/openToWork/hiring honestly reflect the raw item", p?.premium === false && p?.openToWork === false && p?.hiring === false);
    }
  }

  // --- fetchDatasetItems: honestly returns empty, never fabricates ----------
  {
    globalThis.fetch = (async () => jsonResponse(200, [])) as typeof fetch;
    const res = await fetchDatasetItems(apifyClearance, "tok", "dataset_empty", 10);
    ok("fetchDatasetItems returns an honest empty array", res.ok === true && res.ok && res.data.length === 0);
  }

  // --- testApifyConnection: 200 -> valid / 401 -> invalid --------------------
  {
    let seenUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      seenUrl = String(url);
      return jsonResponse(200, { data: { id: "user_1" } });
    }) as typeof fetch;
    const res = await testApifyConnection(apifyClearance, "apify_api_valid");
    ok("testApifyConnection hits /users/me", seenUrl.includes("/users/me"));
    ok("testApifyConnection: 200 maps to ok:true (valid)", res.ok === true);

    globalThis.fetch = (async () => jsonResponse(401, { error: { type: "token-not-provided", message: "no token" } })) as typeof fetch;
    const bad = await testApifyConnection(apifyClearance, "apify_api_bad");
    ok("testApifyConnection: 401 maps to ok:false (invalid)", bad.ok === false && bad.status === 401);
  }

  {
    globalThis.fetch = (async (url: unknown) => {
      const href = String(url);
      if (href.includes("/actors/harvestapi~linkedin-profile-search/runs") && !href.includes("actor-runs")) {
        return jsonResponse(201, { data: { id: "run_running", defaultDatasetId: "ds_running", status: "RUNNING" } });
      }
      return jsonResponse(200, { data: { status: "RUNNING" } });
    }) as typeof fetch;
    const res = await runProfileSearchAndWait(
      apifyClearance,
      "tok",
      { searchQuery: "Calypso Linux Python" },
      { timeoutMs: 4_000 },
    );
    ok(
      "wait elapsed while RUNNING is still_running, not 0 items",
      res.ok === false &&
        res.harvest.started &&
        res.harvest.runId === "run_running" &&
        res.harvest.status === "RUNNING" &&
        res.harvest.itemCount < 0 &&
        /still running/i.test(res.title),
    );
  }
} finally {
  globalThis.fetch = originalFetch;
}

// --- mapApifyCandidates: scored, deduped Candidates with compliance ---------
{
  const profile: ApifyProfile = {
    id: "abc123",
    publicIdentifier: "test-candidate-dev",
    linkedinUrl: "https://www.linkedin.com/in/test-candidate-dev",
    firstName: "Test",
    lastName: "Candidate",
    headline: "Senior Go Engineer at Acme Corp",
    about: "Distributed systems engineer working on Kubernetes and gRPC platforms.",
    location: { text: "Paris, France", countryCode: "FR" },
    connectionsCount: 500,
    followerCount: 1200,
    currentPosition: [{ title: "Senior Go Engineer", companyName: "Acme Corp", dateRange: "Jan 2025 - Present" }],
    experience: [{ title: "Senior Go Engineer", companyName: "Acme Corp", dateRange: "Jan 2025 - Present" }],
    education: [{ schoolName: "EPITA", degree: "MSc Computer Science", dateRange: "2012 - 2017" }],
    topSkills: ["Go", "Kubernetes"],
    skills: ["Go", "Kubernetes", "gRPC", "Distributed Systems"],
    languages: ["English", "French"],
    openToWork: false,
    hiring: false,
    premium: true,
    email: "test@example.com",
    phone: "+33 6 12 34 56 78",
  };

  const result = mapApifyCandidates([profile], campaign, "Senior Go Engineer", [], W);
  const c = result.accepted[0];
  ok("mapApifyCandidates accepts the profile", result.accepted.length === 1);
  ok("name built from first+last", c?.name === "Test Candidate");
  ok("linkedinUrl carried through", c?.linkedinUrl === "https://www.linkedin.com/in/test-candidate-dev");
  ok("sourcePlatform is Apify", c?.sourcePlatform === "Apify");
  ok("sourceQuery is the search criteria", c?.sourceQuery === "Senior Go Engineer");
  ok("currentCompany from currentPosition[0]", c?.currentCompany === "Acme Corp");
  ok("currentTitle from headline", c?.currentTitle === "Senior Go Engineer at Acme Corp");
  ok("location from nested location.text", c?.location === "Paris, France");
  ok("techStack picked up from job skills present in the profile's skills/topSkills", !!c?.techStack.includes("Go") && !!c?.techStack.includes("Kubernetes"));
  ok("candidate is scored", typeof c?.matchScore === "number" && c.matchScore >= 0);
  ok("stage is Sourced", c?.stage === "Sourced");
  ok("email carried through from the normalized profile (emails[] resolved upstream)", c?.email === "test@example.com");
  ok("phone carried through when harvestapi supplied it", c?.phone === "+33 6 12 34 56 78");
  ok("sourceExternalId set for dedupe/reference", c?.sourceExternalId === "test-candidate-dev");
  ok("provenance is live (real vendor data, not synthetic)", c?.provenance === "live");

  // GDPR / third-party provenance is recorded via a candidate note, per the
  // linkedin-policy reconciliation: real vendor data, recruiter owns consent review.
  const note = c?.notes?.[0]?.text ?? "";
  ok("compliance note records the Apify/third-party provenance", note.includes("Apify") && note.includes("harvestapi"));
  ok("compliance note records the GDPR/lawful-basis responsibility", note.toLowerCase().includes("gdpr") && note.toLowerCase().includes("recruiter"));

  ok("complianceFlags initialized honestly (not pre-suppressed)", c?.complianceFlags.doNotContact === false && c?.complianceFlags.suppressed === false);

  // --- dedupe: same linkedinUrl across two mapping calls is skipped ---------
  const second = mapApifyCandidates([profile], campaign, "Senior Go Engineer", result.accepted, W);
  ok("re-sourcing the same profile is deduped by linkedinUrl", second.accepted.length === 0 && second.skipped.length === 1);

  // --- honest blank email/name fallback for a Short-mode-shaped sparse profile
  const sparse: ApifyProfile = {
    ...profile,
    id: "sparse1",
    publicIdentifier: "",
    linkedinUrl: "https://www.linkedin.com/in/ACwAABsparseObfuscatedUrn",
    firstName: "",
    lastName: "",
    headline: "",
    about: "",
    currentPosition: [],
    topSkills: [],
    skills: [],
    languages: [],
    email: null,
  };
  const sparseResult = mapApifyCandidates([sparse], campaign, "q", [], W);
  const sc = sparseResult.accepted[0];
  ok("name falls back to Unknown when both first/last are blank", sc?.name === "Unknown");
  ok("blank email stays blank (no fabricated address)", sc?.email === "");
  ok("currentCompany blank when no currentPosition (Short mode with no positions)", sc?.currentCompany === "");
  ok("empty headline does not stamp the JD title as currentTitle", sc?.currentTitle === "" && sc?.currentTitle !== campaign.jobAnalysis.title);

  const shortMode: ApifyProfile = {
    ...profile,
    id: "short-calypso",
    publicIdentifier: "",
    linkedinUrl: "https://www.linkedin.com/in/ACwAABshortCalypsoUrn",
    headline: "",
    about: "",
    currentPosition: [{ title: "Calypso Production Support", companyName: "BNPP CIB", dateRange: "Present" }],
    experience: [],
    topSkills: [],
    skills: [],
    email: null,
  };
  const financeCampaign = {
    ...campaign,
    jobAnalysis: {
      ...campaign.jobAnalysis,
      title: "Calypso Application Support",
      requiredSkills: ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server", "Calypso"],
    },
  };
  const shortMapped = mapApifyCandidates([shortMode], financeCampaign, "Calypso Linux Python", [], W);
  const shortRow = shortMapped.accepted[0];
  ok(
    "Short-mode currentTitle is the position, not the JD title",
    shortRow?.currentTitle === "Calypso Production Support" && shortRow.currentTitle !== financeCampaign.jobAnalysis.title,
  );
  ok("Short-mode position titles are skill evidence", Boolean(shortRow?.techStack.includes("Calypso")));
}

{
  const { logAriaHarvest, HARVEST_LOG_PREFIX } = await import("../src/lib/sourcing/harvest-evidence");
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return originalWrite(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  try {
    logAriaHarvest("request_entry", {
      query: "Calypso Linux Python",
      campaign: "Calypso Application Support",
      apifyKeyPresent: true,
      started: false,
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  const line = chunks.find((chunk) => chunk.includes("aria_harvest") && chunk.includes("request_entry")) ?? "";
  const parsed = line.trim() ? JSON.parse(line.trim()) as Record<string, unknown> : {};
  ok("harvest log is JSON on stdout", parsed.event === "aria_harvest" && parsed.tag === HARVEST_LOG_PREFIX);
  ok("request_entry has apifyKeyPresent boolean, never a key", parsed.apifyKeyPresent === true && !JSON.stringify(parsed).includes("apify_api_"));
  ok("request_entry carries actor and query", parsed.actor === "harvestapi~linkedin-profile-search" && parsed.query === "Calypso Linux Python");
}

{
  const { logAriaHarvest, formatHarvestEvidenceError } = await import("../src/lib/sourcing/harvest-evidence");
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return originalWrite(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  try {
    logAriaHarvest("request_entry", {
      query: "Calypso Linux Python",
      campaign: "Calypso Application Support",
      apifyKeyPresent: false,
      started: false,
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  const line = chunks.find((chunk) => chunk.includes("aria_harvest") && chunk.includes("request_entry")) ?? "";
  const parsed = line.trim() ? JSON.parse(line.trim()) as Record<string, unknown> : {};
  ok("Mock request_entry has apifyKeyPresent false and started false", parsed.apifyKeyPresent === false && parsed.started === false && parsed.query === "Calypso Linux Python");
  ok(
    "Mock harvest toast names mock and a real key",
    /Mock mode/.test(formatHarvestEvidenceError("mock", { query: "Calypso Linux Python" })) &&
      /Connect a real Apify key/.test(formatHarvestEvidenceError("mock", { query: "Calypso Linux Python" })),
  );
}

console.log(`RESULT apify-sourcing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
