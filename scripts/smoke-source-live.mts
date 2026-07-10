// LIVE smoke: proves the real paste→candidates loop end to end against the actual
// code + live network. NOT part of the offline gate (needs GITHUB_TOKEN + network
// to api.github.com). Run: npx tsx scripts/smoke-source-live.mts
// Exercises the SAME modules the app uses:
//   parseEmailAndJD (real regex parser) → roleProfile → real GitHub query →
//   searchGithubUsers (real GitHub Users Search API) → assert real people back.
import { readFileSync } from "node:fs";
import { parseEmailAndJD } from "../src/lib/mock-ai";
import { roleProfile } from "../src/lib/roles";
import { searchGithubUsers } from "../src/lib/sourcing/github";

// Load .env.local for GITHUB_TOKEN (same file the dev server reads).
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}

function fail(msg: string): never { console.error(`SMOKE FAIL: ${msg}`); process.exit(1); }

const REAL_JD = `From: Priya Nair <priya@brightloop.io>
Subject: Urgent — Senior Backend Engineer (Python) in London

Hi, we're hiring a Senior Backend Engineer to join our platform team in London.
Must have strong Python and distributed systems experience. Kubernetes a plus.
This is urgent — we'd like to move fast. Thanks, Priya`;

// 1) Parse the pasted need (REAL parser).
const parsed = parseEmailAndJD({ email: REAL_JD });
const jd = parsed.jobAnalysis;
console.log(`[1] Parsed need → title="${jd.title}" seniority="${jd.seniority}" skills=[${(jd.requiredSkills || []).join(", ")}] location="${jd.location ?? ""}"`);
if (!jd.title) fail("parser produced no title");

// 2) Derive role + platforms (REAL roleProfile).
const profile = roleProfile(jd);
console.log(`[2] Role family="${profile.family}" platforms=[${profile.platforms.join(", ")}]`);
if (!profile.platforms.includes("GitHub")) fail("role profile did not select GitHub");

// 3) Build the SAME query the client builds, then hit the REAL GitHub API.
const skill = (jd.requiredSkills?.[0] ?? "python").toLowerCase();
const loc = jd.location ? ` location:"${jd.location.split(",")[0].trim()}"` : "";
const query = `language:${skill}${loc}`;
const token = process.env.GITHUB_TOKEN ?? "";
console.log(`[3] GitHub query="${query}" token=${token ? "present" : "MISSING"} (type:user enforced in searchGithubUsers)`);
if (!token) fail("GITHUB_TOKEN not set — cannot prove authenticated live sourcing");

const users = await searchGithubUsers(query, 5, token);
console.log(`[4] REAL candidates returned: ${users.length}`);
for (const u of users.slice(0, 5)) {
  const url = (u as { profileUrl?: string; htmlUrl?: string }).profileUrl
    ?? (u as { htmlUrl?: string }).htmlUrl
    ?? `https://github.com/${u.login}`;
  console.log(`    - ${u.login}  ${url}`);
  if (!/^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/.test(u.login)) fail(`candidate login is not a GitHub user login: ${u.login}`);
  if (url !== `https://github.com/${u.login}`) fail(`candidate ${u.login} has non-canonical GitHub profile URL: ${url}`);
}

if (users.length < 3) fail(`expected >=3 real candidates, got ${users.length}`);
console.log(`SMOKE PASS: pasted need -> ${users.length} real GitHub candidates (live, zero synthetic).`);
process.exit(0);
