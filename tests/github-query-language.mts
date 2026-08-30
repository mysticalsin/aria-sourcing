import { buildSourcingStrategy } from "../src/lib/mock-ai";
import { mapGithubCandidates } from "../src/lib/sourcing/candidate-mappers";
import { SOURCING_QUALITY_FLOOR } from "../src/lib/sourcing/candidate-fit";
import {
  buildGithubUserQueriesForSkills,
  githubLanguageForSkill,
  sanitizeGithubUserSearchQuery,
} from "../src/lib/sourcing/github-query-language";
import { validateSourcingQuery } from "../src/lib/sourcing/query-policy";
import type { Campaign, JobAnalysis } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("TypeScript skill maps to TypeScript", githubLanguageForSkill("TypeScript") === "TypeScript");
ok("React skill maps to JavaScript", githubLanguageForSkill("React") === "JavaScript");
ok("Node.js skill maps to JavaScript", githubLanguageForSkill("Node.js") === "JavaScript");
ok("PostgreSQL is not a GitHub language", githubLanguageForSkill("PostgreSQL") === null);
ok("GraphQL is not a GitHub language", githubLanguageForSkill("GraphQL") === null);
ok("AWS is not a GitHub language", githubLanguageForSkill("AWS") === null);
ok("permissive identifier fallback is gone", githubLanguageForSkill("SomethingOdd") === null);

const sanitized = sanitizeGithubUserSearchQuery(
  "language:PostgreSQL location:London followers:>40 repos:>5",
  ["TypeScript", "PostgreSQL", "GraphQL"],
);
ok(
  "sanitize rewrites language:PostgreSQL under TypeScript",
  /language:TypeScript/.test(sanitized) && /PostgreSQL/.test(sanitized) && !/language:PostgreSQL/i.test(sanitized),
);
ok(
  "sanitize strips repo-only qualifiers",
  !/\bforks:/.test(
    sanitizeGithubUserSearchQuery("language:TypeScript sort:updated forks:>5", ["TypeScript"]),
  ),
);

const built = buildGithubUserQueriesForSkills(
  ["TypeScript", "PostgreSQL", "GraphQL", "AWS"],
  { region: "London", max: 3 },
);
ok("builds at least one TypeScript language query", built.some((q) => /language:TypeScript/.test(q.query)));
ok(
  "never emits language:PostgreSQL/GraphQL/AWS",
  built.every((q) => !/language:(?:PostgreSQL|GraphQL|AWS)\b/i.test(q.query)),
);
ok(
  "non-language skills become keywords under primary language",
  built.some((q) => /PostgreSQL language:TypeScript/.test(q.query)),
);

const jd = {
  title: "Senior Typescript Consultant",
  requiredSkills: ["TypeScript", "PostgreSQL", "GraphQL", "AWS", "React", "Node.js", "Next.js"],
  niceToHaveSkills: [],
  location: "Paris, France",
  locationType: "Hybrid",
  regions: ["London", "UK"],
  minYearsExperience: 5,
  maxYearsExperience: null,
  companyStageTarget: ["Series B"],
  industryExperience: ["SaaS", "Consulting"],
  seniority: "Senior",
  department: "Engineering",
  employmentType: "Full-time",
  language: "fr",
  currency: "",
  education: "",
  equity: false,
  reportingTo: "",
  teamSize: "",
  timezone: "",
  salaryMin: null,
  salaryMax: null,
  urgency: "Urgent",
} as JobAnalysis;

const strategy = buildSourcingStrategy(jd);
ok(
  "buildSourcingStrategy avoids fake language tokens",
  strategy.githubQueries.every((q) => !/language:(?:PostgreSQL|GraphQL|AWS)\b/i.test(q.query)),
);
ok(
  "buildSourcingStrategy includes a real language query",
  strategy.githubQueries.some((q) => /language:(?:TypeScript|JavaScript)\b/.test(q.query)),
);

const campaign = {
  id: "c-e2e",
  jobAnalysis: jd,
  scoringWeights: {
    activity: 10,
    companyStage: 12,
    experience: 22,
    industry: 12,
    location: 10,
    skills: 34,
  },
  sourcingStrategy: { excludedCompanies: [] },
} as unknown as Campaign;

for (const q of strategy.githubQueries) {
  const policy = validateSourcingQuery("GitHub", q.query, campaign);
  ok(`strategy query policy ok: ${q.query}`, policy.ok);
}

const sparseUser = {
  login: "london-ts",
  name: "London TS Dev",
  email: null,
  company: "Acme",
  location: "London, UK",
  bio: null,
  blog: null,
  htmlUrl: "https://github.com/london-ts",
  publicRepos: 40,
  followers: 80,
  createdAt: "2016-01-01T00:00:00Z",
  topLanguage: "TypeScript",
};
const mapped = mapGithubCandidates(
  [sparseUser],
  campaign,
  "language:TypeScript location:London followers:>40 repos:>10",
  [],
);
ok(
  `sparse GitHub profile clears ${SOURCING_QUALITY_FLOOR}% floor (got ${mapped.accepted[0]?.matchScore ?? mapped.skipped[0]?.reason})`,
  (mapped.accepted[0]?.matchScore ?? 0) >= SOURCING_QUALITY_FLOOR,
);

console.log(`RESULT github-query-language: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
