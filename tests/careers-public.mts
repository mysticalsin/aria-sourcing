import { readFileSync } from "node:fs";
import { buildPublicCareerSubmission, publicCareerJobsFromState } from "../src/lib/careers";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const jobs = publicCareerJobsFromState({
  campaigns: [
    {
      id: "campaign-published",
      title: "Senior Platform Engineer",
      department: "Engineering",
      status: "Sourcing",
      hiringManager: "Private manager",
      hiringManagerEmail: "private@example.com",
      metrics: { contacted: 99 },
      jobAnalysis: {
        seniority: "Senior",
        employmentType: "Full-time",
        locationType: "Hybrid",
        regions: ["Paris", "France"],
        requiredSkills: ["TypeScript", "PostgreSQL"],
        niceToHaveSkills: ["Kubernetes"],
        industryExperience: ["SaaS"],
      },
      jobAd: {
        status: "published",
        knightM: { passed: true },
        screeningQuestions: ["Can you work from Paris?"],
      },
    },
    {
      id: "campaign-draft",
      title: "Confidential role",
      department: "M&A",
      status: "Sourcing",
      jobAnalysis: {},
      jobAd: { status: "draft", knightM: { passed: true } },
    },
    {
      id: "campaign-paused",
      title: "Paused role",
      department: "Engineering",
      status: "Paused",
      jobAnalysis: {},
      jobAd: { status: "published", knightM: { passed: true } },
    },
  ],
});

ok("returns only a published, compliance-passed active role", jobs.length === 1 && jobs[0]?.id === "campaign-published");
ok("does not expose manager or operational campaign fields", jobs.length === 1 && !("hiringManagerEmail" in jobs[0]!) && !("metrics" in jobs[0]!));

const submission = buildPublicCareerSubmission(
  {
    path: "A",
    campaignId: "campaign-published",
    roleTitle: "Attacker supplied title",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ADA@EXAMPLE.COM",
    phone: "+33 (0) 6 12 34 56 78",
    cvFileName: "ada-cv.pdf",
    detected: { location: "Paris, France", phoneCountry: "+33", skills: ["TypeScript"] },
    answers: [
      { kind: "mobility", answer: "Yes" },
      { kind: "visa", answer: "No" },
      { kind: "keyexp", stars: 5 },
      { kind: "toolexp", stars: 5 },
      { kind: "project", answer: "Yes" },
    ],
    contactPref: { time: "Morning", day: "Monday" },
  },
  jobs,
  "2026-07-09T12:00:00.000Z",
);

ok("binds an application to the server-approved public role", submission?.roleTitle === "Senior Platform Engineer");
ok("normalizes public applicant contact details", submission?.email === "ada@example.com" && submission.phone === "+33612345678");
ok("derives score and rating server-side", submission?.score.total === 100 && submission.starRating === "TopGun");
ok(
  "rejects an application targeting a role that was not published",
  buildPublicCareerSubmission(
    { ...submission!, campaignId: "campaign-draft", roleTitle: "Confidential role" },
    jobs,
    "2026-07-09T12:00:00.000Z",
  ) === null,
);
ok(
  "Path A requires a current public campaign instead of accepting an arbitrary role title",
  buildPublicCareerSubmission(
    { ...submission!, path: "A", campaignId: null, roleTitle: "Invented confidential role" },
    jobs,
    "2026-07-09T12:00:00.000Z",
  ) === null,
);
const talentPoolSubmission = buildPublicCareerSubmission(
  {
    path: "B",
    campaignId: null,
    roleTitle: "Principal Platform Engineer",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+33 6 12 34 56 78",
    detected: { phoneCountry: "+33" },
    answers: [{ kind: "quickmatch", question: "Desired role", answer: "Platform engineering" }],
  },
  jobs,
  "2026-07-09T12:00:00.000Z",
);
ok(
  "Path B remains the explicit talent-pool route for an arbitrary candidate-described role",
  talentPoolSubmission?.campaignId === null && talentPoolSubmission.roleTitle === "Principal Platform Engineer",
);

const chatbox = readFileSync(new URL("../src/components/careers/chatbox.tsx", import.meta.url), "utf8");
const providers = readFileSync(new URL("../src/components/app/providers.tsx", import.meta.url), "utf8");
ok("career chatbox does not import the authenticated workspace store", !chatbox.includes('from "@/lib/store"'));
ok("career route remains outside the authenticated workspace provider", providers.includes('pathname.startsWith("/careers")'));

console.log(`RESULT careers-public: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
