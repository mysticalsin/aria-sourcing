import {
  loadPublicCareerJobs,
  submitPublicCareerApplication,
  type CareerWorkspaceRepository,
} from "../src/lib/careers-service";
import type { PublicCareerApplicationInput } from "../src/lib/careers";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const publishedState = {
  campaigns: [
    {
      id: "campaign-public",
      title: "Public Engineer",
      department: "Engineering",
      status: "Sourcing",
      jobAnalysis: {
        seniority: "Senior",
        employmentType: "Full-time",
        locationType: "Hybrid",
        regions: ["Paris"],
        requiredSkills: ["TypeScript"],
        niceToHaveSkills: [],
        industryExperience: [],
      },
      jobAd: { status: "published", knightM: { passed: true }, screeningQuestions: [] },
    },
    {
      id: "campaign-private",
      title: "Private Engineer",
      department: "Engineering",
      status: "Sourcing",
      jobAnalysis: {},
      jobAd: { status: "draft", knightM: { passed: true } },
    },
  ],
  chatboxSubmissions: [],
};

function input(campaignId = "campaign-public"): PublicCareerApplicationInput {
  return {
    path: "A",
    campaignId,
    roleTitle: "untrusted title",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+33 6 12 34 56 78",
    detected: { phoneCountry: "+33" },
    contactPref: { time: "Morning" },
    answers: [
      { kind: "mobility", answer: "Yes" },
      { kind: "visa", answer: "No" },
      { kind: "keyexp", stars: 5 },
      { kind: "toolexp", stars: 5 },
      { kind: "project", answer: "Yes" },
    ],
  };
}

let state: Record<string, unknown> = structuredClone(publishedState);
let updatedAt = "2026-07-09T11:00:00.000Z";
let writes = 0;
const repository: CareerWorkspaceRepository = {
  async load(id) {
    return id === workspaceId ? { state, updatedAt } : null;
  },
  async compareAndSet(id, expectedUpdatedAt, nextState) {
    if (id !== workspaceId || expectedUpdatedAt !== updatedAt) return false;
    state = nextState;
    updatedAt = "2026-07-09T12:00:00.000Z";
    writes += 1;
    return true;
  },
};

const jobs = await loadPublicCareerJobs(repository, workspaceId);
ok("loads only the explicit public jobs", jobs?.length === 1 && jobs[0]?.id === "campaign-public");

const accepted = await submitPublicCareerApplication(repository, workspaceId, input(), "2026-07-09T11:30:00.000Z");
const saved = (state.chatboxSubmissions as { roleTitle?: string; score?: { total?: number } }[])[0];
ok("stores a server-rebuilt public application", accepted === "accepted" && writes === 1 && saved?.roleTitle === "Public Engineer" && saved.score?.total === 100);

const duplicate = await submitPublicCareerApplication(repository, workspaceId, input(), "2026-07-09T11:40:00.000Z");
ok("acknowledges a duplicate without another workspace write", duplicate === "duplicate" && writes === 1);

const privateResult = await submitPublicCareerApplication(repository, workspaceId, input("campaign-private"), "2026-07-09T11:45:00.000Z");
ok("rejects an attempt to target a non-public campaign", privateResult === "invalid" && writes === 1);

const missingCampaignResult = await submitPublicCareerApplication(
  repository,
  workspaceId,
  { ...input(), campaignId: null, roleTitle: "Invented role" },
  "2026-07-09T11:46:00.000Z",
);
ok("rejects a Path A submission without a current public campaign", missingCampaignResult === "invalid" && writes === 1);

const talentPoolResult = await submitPublicCareerApplication(
  repository,
  workspaceId,
  {
    ...input(),
    path: "B",
    campaignId: null,
    roleTitle: "Principal Platform Engineer",
    answers: [{ kind: "quickmatch", question: "Desired role", answer: "Platform engineering" }],
  },
  "2026-07-09T11:47:00.000Z",
);
const talentPoolSaved = (state.chatboxSubmissions as { campaignId?: string | null; roleTitle?: string }[])[0];
ok(
  "accepts an explicit Path B talent-pool application without binding it to a campaign",
  talentPoolResult === "accepted" && writes === 2 && talentPoolSaved?.campaignId === null && talentPoolSaved.roleTitle === "Principal Platform Engineer",
);

console.log(`RESULT careers-service: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
