import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

const { mergePreferringRicher } = await import("../src/lib/sourcing/providers/merge");
const { providersForCampaign } = await import("../src/lib/sourcing/providers/index");
const { githubProvider } = await import("../src/lib/sourcing/providers/github");
const { linkedinWebProvider } = await import("../src/lib/sourcing/providers/web");
const { linkedinProfilesProvider } = await import("../src/lib/sourcing/providers/linkedin-profiles");
const { buildSeedState } = await import("../src/lib/seed");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const s = buildSeedState();
const campaign = s.campaigns[0];

function cand(partial: {
  id: string;
  name: string;
  linkedinUrl?: string;
  githubUrl?: string;
  matchScore?: number;
  sourcePlatform?: "LinkedIn" | "GitHub";
}) {
  return {
    id: partial.id,
    campaignId: campaign.id,
    name: partial.name,
    email: "",
    avatarInitials: "XX",
    currentTitle: "Systems Designer",
    currentCompany: "Acme",
    location: "Montreal",
    timezone: "",
    linkedinUrl: partial.linkedinUrl ?? "",
    githubUrl: partial.githubUrl ?? "",
    sourcePlatform: partial.sourcePlatform ?? "LinkedIn",
    sourceQuery: "q",
    matchScore: partial.matchScore ?? 90,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "Systems Designer",
    stage: "Sourced" as const,
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    provenance: "live" as const,
    notes: [],
  };
}

{
  const profileHit = cand({
    id: "p1",
    name: "Ada Profile",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    matchScore: 88,
  });
  const serpHit = cand({
    id: "s1",
    name: "Ada Serp",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    matchScore: 95,
  });
  const merged = mergePreferringRicher([
    { provider: linkedinWebProvider, candidates: [serpHit] },
    { provider: linkedinProfilesProvider, candidates: [profileHit] },
  ]);
  ok("merge keeps a single LinkedIn identity", merged.length === 1);
  ok("profile provider wins over SERP for the same LinkedIn URL", merged[0]?.id === "p1");
  ok("operator-facing platform stays LinkedIn", merged[0]?.sourcePlatform === "LinkedIn");
}

{
  const available = [linkedinProfilesProvider, linkedinWebProvider, githubProvider];
  const linkedInPlan = providersForCampaign(available, ["LinkedIn"]);
  ok(
    "LinkedIn-first plan starts with profile search then web then GitHub",
    linkedInPlan.map((p) => p.id).join(",") === "linkedin_profiles,linkedin_web,github",
  );
  const githubPlan = providersForCampaign(available, ["GitHub"]);
  ok(
    "GitHub-first plan includes GitHub then LinkedIn backends",
    githubPlan.map((p) => p.id).join(",") === "github,linkedin_profiles,linkedin_web",
  );
}

{
  ok(
    "linkedin_profiles unavailable without connector token",
    linkedinProfilesProvider.isAvailable({
      campaign,
      existing: [],
      weights: campaign.scoringWeights,
      githubToken: "",
      linkedInProfileToken: null,
    }) === false,
  );
  ok(
    "linkedin_profiles available when connector token present",
    linkedinProfilesProvider.isAvailable({
      campaign,
      existing: [],
      weights: campaign.scoringWeights,
      githubToken: "",
      linkedInProfileToken: "apify_api_test",
    }) === true,
  );
}

{
  const withoutProfiles = providersForCampaign(
    [linkedinWebProvider, githubProvider],
    ["LinkedIn"],
  );
  ok(
    "missing profile connector still sources via LinkedIn web + GitHub",
    withoutProfiles.map((p) => p.id).join(",") === "linkedin_web,github",
  );
}

{
  // Pin deepen + expanded GitHub query generation (top-10 shortlist supply).
  const orchSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/sourcing/orchestrator.ts", import.meta.url), "utf8"),
  );
  ok(
    "orchestrator deepens GitHub on quality shortfall",
    /Deepen GitHub \+ LinkedIn web/.test(orchSrc)
      && /qualityPassingCount/.test(orchSrc)
      && /p\.id === "github"/.test(orchSrc),
  );
  ok(
    "orchestrator expands GitHub query variants for top-10 supply",
    /followers:>20 repos:>3/.test(orchSrc) && /configured\.slice\(0, 6\)/.test(orchSrc),
  );
  const routeSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url), "utf8"),
  );
  ok(
    "sourcing-agent selects from found hits not draft count alone",
    /draftByCandidateId/.test(routeSrc)
      && /found\.slice\(0, count\)/.test(routeSrc)
      && !/: \(drafts \?\? \[\]\)\.map\(\(draft\) => \(\{/.test(routeSrc),
  );
}

console.log(`RESULT multi-provider-sourcing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
