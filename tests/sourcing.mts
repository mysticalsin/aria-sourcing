import { buildSeedState } from "../src/lib/seed";
import { mapGithubCandidates } from "../src/lib/mock-ai";
import type { GithubUser } from "../src/lib/sourcing/github";

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

const mk = (over: Partial<GithubUser> & { login: string; htmlUrl: string }): GithubUser => ({
  login: over.login,
  name: null,
  email: null,
  company: null,
  location: null,
  bio: null,
  blog: null,
  htmlUrl: over.htmlUrl,
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

console.log(`RESULT sourcing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
