import { linkedInSourcingRunsWithoutErp } from "../src/lib/hire-connector";
import { mapWebSearchCandidates } from "../src/lib/sourcing/candidate-mappers";
import { readFileSync } from "node:fs";
import { envWithoutRecruiterCredentials, linkedInLeadsForSearch, sourceRecruiterSystemConnect } from "../src/lib/sourcing/linkedin-recruiter";
import { buildSeedState } from "../src/lib/seed";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const calls: { url: string; init?: RequestInit }[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      elements: [
        {
          firstName: "Ada",
          lastName: "Lovelace",
          headline: "Staff Engineer",
          company: "Analytical Engines",
          location: "London, United Kingdom",
          publicProfileUrl: "https://www.linkedin.com/in/ada-lovelace",
          summary: "Distributed systems and Kubernetes.",
        },
        {
          firstName: "Weak",
          lastName: "Profile",
          publicProfileUrl: "https://www.linkedin.com/in/weak-profile",
          summary: "Hello there.",
        },
      ],
    }),
  } as Response;
}) as typeof fetch;

const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const absent = await sourceRecruiterSystemConnect({ query: "engineer", count: 5 }, emptyEnv, fakeFetch);
ok("absent Odoo and SMART still leave Recruiter unconfigured", absent.configured === false && absent.leads.length === 0 && calls.length === 0);
ok("LinkedIn sourcing still runs without Odoo or SMART", linkedInSourcingRunsWithoutErp(emptyEnv) === true);

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LINKEDIN_RSC_URL: "https://api.linkedin.com/v2/recruiterSearch",
  LINKEDIN_RSC_TOKEN: "rsc-token",
};
const found = await linkedInLeadsForSearch(
  {
    query: "site:linkedin.com/in engineer",
    count: 8,
    publicHits: [{ title: "Grace Hopper - Compiler Engineer | LinkedIn", url: "https://www.linkedin.com/in/grace", snippet: "Compilers." }],
  },
  env,
  fakeFetch,
);
ok("official Recruiter search is requested when configured", calls.length === 1);
const body = JSON.parse(String(calls[0]?.init?.body)) as { source?: string; query?: string; count?: number };
const headers = new Headers(calls[0]?.init?.headers);
ok(
  "Recruiter request is the official bearer search, not a cookie session",
  calls[0]?.url === env.LINKEDIN_RSC_URL &&
    calls[0]?.init?.method === "POST" &&
    headers.get("authorization") === "Bearer rsc-token" &&
    body.source === "recruiter-system-connect" &&
    body.query === "site:linkedin.com/in engineer" &&
    body.count === 8 &&
    !headers.has("cookie"),
);
ok("public and Recruiter leads are both returned", found.recruiter === "recruiter-system-connect" && found.leads.length === 3);

const refused = await sourceRecruiterSystemConnect(
  { query: "engineer", count: 2 },
  { NODE_ENV: "test", LINKEDIN_RSC_URL: "https://www.linkedin.com/in/search", LINKEDIN_RSC_TOKEN: "rsc-token" },
  fakeFetch,
);
ok("a linkedin.com page is not used as the Recruiter API", refused.configured === true && refused.leads.length === 0 && calls.length === 1);

const metadata = await sourceRecruiterSystemConnect(
  { query: "engineer", count: 1 },
  { NODE_ENV: "test", LINKEDIN_RSC_URL: "https://169.254.169.254/latest", LINKEDIN_RSC_TOKEN: "rsc-token" },
  fakeFetch,
);
ok("Recruiter refuses a metadata endpoint", metadata.leads.length === 0 && calls.length === 1);

const lookalike = await sourceRecruiterSystemConnect(
  { query: "engineer", count: 1 },
  { NODE_ENV: "test", LINKEDIN_RSC_URL: "https://api.linkedin.com/v2/recruiterSearch", LINKEDIN_RSC_TOKEN: "rsc-token" },
  (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      elements: [
        { firstName: "Pat", lastName: "Example", headline: "Engineer", publicProfileUrl: "https://linkedin.com.evil.test/in/pat" },
        { firstName: "Ada", lastName: "Lovelace", headline: "Engineer", publicProfileUrl: "javascript:alert(1)" },
      ],
    }),
  }) as unknown as Response) as typeof fetch,
);
ok("Recruiter drops profile URLs that are not public LinkedIn profiles", lookalike.leads.length === 0);

const capped = await linkedInLeadsForSearch(
  {
    query: "engineer",
    count: 2,
    publicHits: [
      { title: "Grace Hopper - Compiler Engineer | LinkedIn", url: "https://www.linkedin.com/in/grace", snippet: "Compilers." },
      { title: "Alan Turing - Engineer | LinkedIn", url: "https://www.linkedin.com/in/alan", snippet: "Codes." },
    ],
  },
  env,
  fakeFetch,
);
ok("public plus Recruiter leads stay within the requested count", capped.leads.length === 2);

const stripped = envWithoutRecruiterCredentials({ ...env, ODOO_URL: "https://odoo.example.test" });
ok("demo search env drops Recruiter credentials", !stripped.LINKEDIN_RSC_URL && !stripped.LINKEDIN_RSC_TOKEN && stripped.ODOO_URL === "https://odoo.example.test");
const sourceRoute = readFileSync(new URL("../src/app/api/source/route.ts", import.meta.url), "utf8");
ok("demo source search does not spend the Recruiter token", sourceRoute.includes("envWithoutRecruiterCredentials(process.env)"));


console.log(`RESULT linkedin-recruiter: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
