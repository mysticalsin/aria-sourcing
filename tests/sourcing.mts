import { existsSync, readFileSync } from "node:fs";
import { mock } from "node:test";
import { buildSeedState } from "../src/lib/seed";
import { mapApolloCandidates, mapGithubCandidates, mapWebSearchCandidates } from "../src/lib/mock-ai";
import type { ApolloSearchProfile } from "../src/lib/sourcing/apollo";
import type { GithubUser } from "../src/lib/sourcing/github";
import { extractLead, buildWebQuery, isWebSearchPlatform, type SearchHit } from "../src/lib/sourcing/web-leads";
import { dedupeCandidates } from "../src/lib/rules";

mock.module("server-only", { namedExports: {} });

const { searchGithubUsers } = await import("../src/lib/sourcing/github");
const { clearProviderProbe } = await import("../src/lib/sourcing/provider-egress");
const githubClearance = clearProviderProbe("GitHub");

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const s = buildSeedState();
const campaign = s.campaigns[0];
const W = campaign.scoringWeights;

const mapperModulePath = new URL("../src/lib/sourcing/candidate-mappers.ts", import.meta.url);
ok("live candidate mappers have a neutral sourcing module", existsSync(mapperModulePath));
const mockAiSource = readFileSync(new URL("../src/lib/mock-ai.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const sourcingToolsSource = readFileSync(new URL("../src/lib/ai/sourcing-tools.ts", import.meta.url), "utf8");
ok(
  "mock AI only re-exports live candidate mappers for compatibility",
  /export\s+\{[\s\S]*mapGithubCandidates[\s\S]*\}\s+from\s+["']\.\/sourcing\/candidate-mappers["']/.test(mockAiSource) &&
    !/export function map(?:Github|Apollo|Seamless|WebSearch)Candidates\s*\(/.test(mockAiSource),
);
ok(
  "live store and sourcing tools import candidate mappers from the neutral module",
  storeSource.includes('from "./sourcing/candidate-mappers"') &&
    sourcingToolsSource.includes('from "@/lib/sourcing/candidate-mappers"') &&
    !sourcingToolsSource.includes('from "@/lib/mock-ai"'),
);

const mk = (over: Partial<GithubUser> & { login: string; htmlUrl: string }): GithubUser => ({
  name: null,
  email: null,
  company: null,
  location: null,
  bio: null,
  blog: null,
  publicRepos: 0,
  followers: 0,
  createdAt: null,
  topLanguage: null,
  ...over,
});

// --- Mapping: real GitHub fields land on the Candidate ---------------------
const alice = mk({
  login: "alice",
  htmlUrl: "https://github.com/alice",
  name: "Alice Dev",
  email: "alice@corp.io",
  company: "@zzz-unique-co", // absurd company name so it cannot be in any exclude list
  location: "London",
  bio: "TypeScript and React engineer",
  publicRepos: 42,
  followers: 120,
  createdAt: "2018-01-01T00:00:00Z",
  topLanguage: "TypeScript",
});
const r = mapGithubCandidates([alice], campaign, "language:typescript", [], W);
const a = r.accepted[0];
ok("maps the user", r.accepted.length === 1);
ok("real github url kept", a?.githubUrl === "https://github.com/alice");
ok("real email kept", a?.email === "alice@corp.io");
ok("company strips leading @", a?.currentCompany === "zzz-unique-co");
ok("location kept", a?.location === "London");
ok("techStack includes the query language", !!a?.techStack.includes("TypeScript"));
ok("candidate is scored", typeof a?.matchScore === "number" && a.matchScore >= 0);
ok("sourcePlatform is GitHub", a?.sourcePlatform === "GitHub");
ok("stage is Sourced", a?.stage === "Sourced");
ok("GitHub account age is not presented as professional tenure", a?.yearsExperience === null);
ok("GitHub biography is not presented as a job title", a?.currentTitle === "");

const apolloProfile: ApolloSearchProfile = {
  targetId: "22222222-2222-4222-8222-222222222222",
  candidateId: "apollo-candidate",
  name: "Apollo Candidate",
  title: "Platform Engineer",
  company: "Example Corp",
  linkedinUrl: "https://www.linkedin.com/in/apollo-candidate",
  city: "Toronto",
  state: "Ontario",
  country: "Canada",
  headline: "Platform Engineer",
  seniority: "senior",
  departments: ["engineering"],
};
const apolloMapped = mapApolloCandidates([apolloProfile], campaign, "titles:Platform Engineer", [], W);
ok(
  "Apollo mapper preserves only the opaque enrichment authority",
  apolloMapped.accepted[0]?.sourceAuthorityId === apolloProfile.targetId &&
    apolloMapped.accepted[0]?.sourceExternalId === undefined,
);

// --- Name fallback + honest blank email ------------------------------------
const bob = mk({ login: "bob", htmlUrl: "https://github.com/bob" });
const rb = mapGithubCandidates([bob], campaign, "q", [], W);
ok("name falls back to login when GitHub name is null", rb.accepted[0]?.name === "bob");
ok("blank email stays blank (no fabricated address)", rb.accepted[0]?.email === "");

// --- The dedupe fix: blank emails are NOT collapsed together ----------------
const u1 = mk({ login: "noemail1", htmlUrl: "https://github.com/noemail1" });
const u2 = mk({ login: "noemail2", htmlUrl: "https://github.com/noemail2" });
const rd = mapGithubCandidates([u1, u2], campaign, "q", [], W);
ok("two email-less users both accepted (deduped by URL, not blank email)", rd.accepted.length === 2);

// Same github URL is still a real duplicate.
const rdup = mapGithubCandidates(
  [u1, mk({ login: "noemail1", htmlUrl: "https://github.com/noemail1" })],
  campaign,
  "q",
  [],
  W,
);
ok("same github URL is deduped", rdup.accepted.length === 1);

// --- GitHub: keyless by default (no Authorization header when token is "") -
{
  const originalFetch = globalThis.fetch;
  const seenAuth: (string | undefined)[] = [];
  const seenUrls: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seenUrls.push(String(url));
    seenAuth.push((init?.headers as Record<string, string> | undefined)?.Authorization);
    return {
      ok: true,
      json: async () => ({ items: [] }),
    } as Response;
  }) as typeof fetch;

  await searchGithubUsers(githubClearance, "language:typescript", 1, "");
  await searchGithubUsers(githubClearance, "language:typescript", 1, "tok_123");
  await searchGithubUsers(githubClearance, "language:typescript type:org", 1, "");
  globalThis.fetch = originalFetch;

  ok("anonymous call sends no Authorization header", seenAuth[0] === undefined);
  ok("token call sends Bearer Authorization header", seenAuth[1] === "Bearer tok_123");
  ok("GitHub user search appends type:user by default", decodeURIComponent(seenUrls[0] ?? "").includes("language:typescript type:user"));
  ok("GitHub user search does not duplicate caller type qualifier", decodeURIComponent(seenUrls[2] ?? "").includes("language:typescript type:org") && !decodeURIComponent(seenUrls[2] ?? "").includes("type:org type:user"));
}

// --- GitHub: partial detail transport failures are honest -----------------
{
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: unknown) => {
      const value = String(url);
      if (value.includes("/search/users")) {
        return {
          ok: true,
          json: async () => ({ items: [{ login: "unavailable" }, { login: "available" }] }),
        } as Response;
      }
      if (value.endsWith("/users/unavailable")) {
        return { ok: false, status: 502, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          login: "available",
          name: "Available Candidate",
          html_url: "https://github.com/available",
          public_repos: 3,
          followers: 7,
        }),
      } as Response;
    }) as typeof fetch;

    const partial = await searchGithubUsers(githubClearance, "language:typescript", 2, "");
    ok(
      "GitHub partial profile failure returns only profiles with completed evidence",
      partial.length === 1 && partial[0]?.login === "available",
    );

    globalThis.fetch = (async (url: unknown) => {
      const value = String(url);
      if (value.includes("/search/users")) {
        return {
          ok: true,
          json: async () => ({ items: [{ login: "unavailable-a" }, { login: "unavailable-b" }] }),
        } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as typeof fetch;

    let allProfilesFailed = false;
    try {
      await searchGithubUsers(githubClearance, "language:typescript", 2, "");
    } catch (error) {
      allProfilesFailed =
        error instanceof Error && error.message === "GitHub profile resolution failed.";
    }
    ok(
      "GitHub total profile failure is not misreported as a genuine zero-match search",
      allProfilesFailed,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- web-leads: platform classification --------------------------------
ok("LinkedIn is a web-search platform", isWebSearchPlatform("LinkedIn"));
ok("Stack Overflow is a web-search platform", isWebSearchPlatform("Stack Overflow"));
ok("Dribbble is a web-search platform", isWebSearchPlatform("Dribbble"));
ok("Behance is a web-search platform", isWebSearchPlatform("Behance"));
ok("GitHub is not routed through web-search", !isWebSearchPlatform("GitHub"));
ok("Talent Pool is not routed through web-search", !isWebSearchPlatform("Talent Pool"));
ok("Referral is not routed through web-search", !isWebSearchPlatform("Referral"));

ok(
  "buildWebQuery scopes to the platform domain",
  buildWebQuery("LinkedIn", "Senior Engineer") === "site:linkedin.com/in Senior Engineer",
);
ok(
  "buildWebQuery scopes Dribbble to its domain",
  buildWebQuery("Dribbble", "Product Designer") === "site:dribbble.com Product Designer",
);

// --- web-leads: extractLead never fabricates, falls back honestly -------
const liHit: SearchHit = {
  title: "Jane Doe - Senior Product Designer - Acme Corp | LinkedIn",
  url: "https://www.linkedin.com/in/jane-doe-4471",
  snippet: "Experience in Figma, design systems, and user research.",
};
const liLead = extractLead(liHit, "LinkedIn");
ok("LinkedIn lead: name parsed", liLead.name === "Jane Doe");
ok("LinkedIn lead: title parsed", liLead.title === "Senior Product Designer");
ok("LinkedIn lead: company parsed", liLead.company === "Acme Corp");
ok("LinkedIn lead: url kept verbatim", liLead.url === liHit.url);

const noisyHit: SearchHit = {
  title: "jane-doe-4471 | LinkedIn",
  url: "https://www.linkedin.com/in/jane-doe-4471",
  snippet: "",
};
const fallbackLead = extractLead(noisyHit, "LinkedIn");
// nameFromSlug strips a trailing numeric/hex id segment (LinkedIn commonly appends
// one to the slug), so "jane-doe-4471" cleans to "Jane Doe", not "Jane Doe 4471".
ok("unparseable title falls back to URL slug, title-cased", fallbackLead.name === "Jane Doe");
ok("no company fabricated when absent from result text", fallbackLead.company === "");

const dribbbleHit: SearchHit = {
  title: "Sam Rivera on Dribbble",
  url: "https://dribbble.com/samrivera",
  snippet: "Product designer specializing in mobile app design.",
};
const dribbbleLead = extractLead(dribbbleHit, "Dribbble");
ok("Dribbble suffix stripped from name", dribbbleLead.name === "Sam Rivera");

// --- mapWebSearchCandidates: honest mapping + dedupe by sourceUrl -------
const leads = [
  { name: "Sam Rivera", title: "Product Designer", company: "Acme Corp", url: "https://dribbble.com/samrivera", snippet: "Figma, design systems" },
  { name: "Sam Rivera", title: "Product Designer", company: "Acme Corp", url: "https://dribbble.com/samrivera", snippet: "Figma, design systems" },
];
const webResult = mapWebSearchCandidates(leads, campaign, "site:dribbble.com Product Designer", "Dribbble", [], W);
ok("web lead accepted once", webResult.accepted.length === 1);
ok("duplicate web lead (same profile URL) deduped", webResult.skipped.length === 1);
const w = webResult.accepted[0];
ok("sourceUrl kept", w?.sourceUrl === "https://dribbble.com/samrivera");
ok("sourcePlatform is Dribbble", w?.sourcePlatform === "Dribbble");
ok("linkedinUrl blank for non-LinkedIn platform", w?.linkedinUrl === "");
ok("email honestly blank (never fabricated)", w?.email === "");
ok("candidate is scored", typeof w?.matchScore === "number");

// LinkedIn leads populate linkedinUrl instead of sourceUrl, reusing existing dedupe.
const liResult = mapWebSearchCandidates(
  [{ name: "Jane Doe", title: "Senior Product Designer", company: "Acme Corp", url: "https://www.linkedin.com/in/jane-doe-4471", snippet: "" }],
  campaign,
  "site:linkedin.com/in Senior Product Designer",
  "LinkedIn",
  [],
  W,
);
ok("LinkedIn lead sets linkedinUrl", liResult.accepted[0]?.linkedinUrl === "https://www.linkedin.com/in/jane-doe-4471");
ok("LinkedIn lead leaves sourceUrl unset", liResult.accepted[0]?.sourceUrl === undefined);

// --- dedupeCandidates: sourceUrl is a dedupe key (Dribbble/Behance/SO) ---
const existingWithSourceUrl = [{ ...webResult.accepted[0]!, id: "existing_1" }];
const dupeAttempt = dedupeCandidates(
  [{ ...webResult.accepted[0]!, id: "new_1", email: "" }],
  existingWithSourceUrl,
  { excludedCompanies: [] },
);
ok("second batch dedupes an already-seen sourceUrl", dupeAttempt.accepted.length === 0 && dupeAttempt.skipped.length === 1);

console.log(`RESULT sourcing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
