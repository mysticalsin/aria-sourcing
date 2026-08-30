import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

const {
  toSmartResumeHit,
  selectBestSmartMatches,
  mockSmartCorpus,
  mockMatchResumes,
  scoreMockAgainstQuery,
} = await import("../src/lib/sourcing/smart-contract");
const { mapSmartCandidates } = await import("../src/lib/sourcing/smart-map");
const { searchSmartResumes, writebackSmartCandidate, smartLiveConfigured, smartRuntimeMode } =
  await import("../src/lib/sourcing/smart");
const { clearProviderProbe } = await import("../src/lib/sourcing/provider-egress");
const { providersForCampaign } = await import("../src/lib/sourcing/providers/index");
const { smartProvider } = await import("../src/lib/sourcing/providers/smart");
const { githubProvider } = await import("../src/lib/sourcing/providers/github");
const { buildSeedState } = await import("../src/lib/seed");
const { SOURCE_PLATFORMS, API_KEY_PROVIDERS } = await import("../src/lib/types");
const { defaultIntegrations } = await import("../src/lib/integrations");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const seed = buildSeedState();
const campaign = seed.campaigns[0];

ok("SOURCE_PLATFORMS includes SMART", (SOURCE_PLATFORMS as readonly string[]).includes("SMART"));
ok("API_KEY_PROVIDERS includes SMART", (API_KEY_PROVIDERS as readonly string[]).includes("SMART"));

const smartCard = defaultIntegrations().find((i) => i.id === "int_smart_ats");
ok("SMART integration card is real wiring", smartCard?.real === true);
ok("SMART card points at Access & Keys", smartCard?.setupHref === "/settings?tab=access");
ok("SMART card starts mock/unconfigured", smartCard?.mode === "mock" && smartCard.status === "not_configured");

{
  const hit = toSmartResumeHit({
    id: "r1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    current_title: "Mathematician",
    skills: ["Algorithms", "Analysis"],
    ocr_text: "Ada Lovelace — Algorithms Analysis",
    match_score: 91,
  });
  ok("toSmartResumeHit maps snake_case", Boolean(hit && hit.firstName === "Ada" && hit.matchScore === 91));
  ok("toSmartResumeHit rejects missing id", toSmartResumeHit({ name: "No Id" }) === null);
}

{
  const ranked = selectBestSmartMatches(
    [
      { ...mockSmartCorpus()[2]!, matchScore: 10 },
      { ...mockSmartCorpus()[0]!, matchScore: 99 },
      { ...mockSmartCorpus()[1]!, matchScore: 50 },
    ],
    2,
  );
  ok("selectBestSmartMatches keeps top 2", ranked.length === 2);
  ok("selectBestSmartMatches orders by score desc", ranked[0]!.matchScore >= ranked[1]!.matchScore);
  ok("selectBestSmartMatches best is 99", ranked[0]!.matchScore === 99);
}

{
  const mapped = mapSmartCandidates(
    mockSmartCorpus().slice(0, 2),
    campaign,
    campaign.jobAnalysis.title,
    [],
    campaign.scoringWeights,
  );
  ok("mapper stamps provenance=live", mapped.accepted.every((c) => c.provenance === "live"));
  ok("mapper stamps sourcePlatform=SMART", mapped.accepted.every((c) => c.sourcePlatform === "SMART"));
  ok("mapper seeds externalIds.SMART", mapped.accepted.every((c) => Boolean(c.externalIds?.SMART)));
  ok("mapper produces scored candidates", mapped.accepted.every((c) => typeof c.matchScore === "number"));
  ok(
    "mapper extracts skills from OCR/haystack",
    mapped.accepted.some((c) => c.techStack.length > 0),
  );
}

{
  const prevMock = process.env.SMART_FORCE_MOCK;
  const prevBase = process.env.SMART_API_BASE_URL;
  const prevKey = process.env.SMART_API_KEY;
  delete process.env.SMART_FORCE_MOCK;
  delete process.env.SMART_API_BASE_URL;
  delete process.env.SMART_API_KEY;

  ok("liveConfigured false without base+key", smartLiveConfigured("tok") === false);
  ok("runtime unavailable without config", smartRuntimeMode(null) === "unavailable");

  const clearance = clearProviderProbe("SMART");
  const failed = await searchSmartResumes(
    clearance,
    {
      title: campaign.jobAnalysis.title,
      requiredSkills: campaign.jobAnalysis.requiredSkills,
      limit: 20,
    },
    null,
  );
  ok("search fail-closed without keys", failed.ok === false && failed.status === 503);
  ok("search fail-closed does not invent hits", failed.ok === false);

  const wb = await writebackSmartCandidate(
    clearance,
    {
      smartResumeId: "x",
      ariaCandidateId: "cand_1",
      campaignId: campaign.id,
      status: "shortlisted",
    },
    null,
  );
  ok("writeback fail-closed without keys", wb.ok === false && wb.status === 503);

  process.env.SMART_FORCE_MOCK = "true";
  ok("runtime mock when SMART_FORCE_MOCK", smartRuntimeMode("anything") === "mock");
  const mocked = await searchSmartResumes(
    clearance,
    {
      title: "Platform Engineer",
      requiredSkills: ["Kubernetes", "TypeScript", "Go"],
      limit: 50,
    },
    null,
  );
  ok("mock search succeeds", mocked.ok === true && mocked.mode === "mock");
  if (mocked.ok) {
    ok("mock returns ranked window (> tiny N)", mocked.data.results.length >= 3);
    ok(
      "mock best-of keeps descending scores",
      mocked.data.results.every(
        (hit, i, arr) => i === 0 || arr[i - 1]!.matchScore >= hit.matchScore,
      ),
    );
  }
  const wbMock = await writebackSmartCandidate(
    clearance,
    {
      smartResumeId: "smart_mock_001",
      ariaCandidateId: "cand_1",
      campaignId: campaign.id,
      status: "sourced",
    },
    null,
  );
  ok("mock writeback returns receipt", wbMock.ok === true && wbMock.mode === "mock");

  if (prevMock === undefined) delete process.env.SMART_FORCE_MOCK;
  else process.env.SMART_FORCE_MOCK = prevMock;
  if (prevBase === undefined) delete process.env.SMART_API_BASE_URL;
  else process.env.SMART_API_BASE_URL = prevBase;
  if (prevKey === undefined) delete process.env.SMART_API_KEY;
  else process.env.SMART_API_KEY = prevKey;
}

{
  process.env.SMART_FORCE_MOCK = "true";
  const available = [smartProvider, githubProvider];
  const plan = providersForCampaign(available, ["GitHub"]);
  ok("SMART prepended when available on GitHub plan", plan[0]?.id === "smart");
  const smartFirst = providersForCampaign(available, ["SMART"]);
  ok("SMART primary plan starts with smart", smartFirst[0]?.id === "smart");
  delete process.env.SMART_FORCE_MOCK;
}

{
  const base = mockSmartCorpus()[0]!;
  const scored = scoreMockAgainstQuery(base, {
    title: "Platform Engineer",
    requiredSkills: ["Kubernetes", "Go"],
    limit: 10,
  });
  const weak = scoreMockAgainstQuery(base, {
    title: "Dental Hygienist",
    requiredSkills: ["Flossing"],
    limit: 10,
  });
  ok("mock scorer boosts skill overlap", scored > weak);
  const matched = mockMatchResumes({
    title: "Platform Engineer",
    requiredSkills: ["Kubernetes", "TypeScript"],
    limit: 3,
  });
  ok("mockMatchResumes respects keep window", matched.length === 3);
}

console.log(`smart-sourcing: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
