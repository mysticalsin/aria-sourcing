/* tests/fairness-live-rank.mts
 * The live ranker and the outreach prompt must go through the fairness gate.
 * Synthetic groups only. Run: tsx tests/fairness-live-rank.mts
 */
import { readFileSync } from "node:fs";

import { auditLivePrompt, auditLiveScore, scrubRankingFeatures } from "../src/lib/fairness/live-rank";
import { scoreCandidate, DEFAULT_SCORING_WEIGHTS } from "../src/lib/scoring";
import { buildSeedState } from "../src/lib/seed";
import { candidatesForCampaign } from "../src/lib/metrics";
import type { Candidate } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const scrubbed = scrubRankingFeatures({
  skills: "synthetic",
  gender: "group-a",
  ethnicity: "group-a",
  postcode: "SYN-000",
  photoPresent: true,
  location: "EU",
  yearsExperience: 6,
});
ok("scrub drops gender", !("gender" in scrubbed));
ok("scrub drops ethnicity", !("ethnicity" in scrubbed));
ok("scrub drops postcode", !("postcode" in scrubbed));
ok("scrub drops photo", !("photoPresent" in scrubbed));
ok("scrub keeps a job skill", scrubbed.skills === "synthetic");

const spy = auditLiveScore(
  { skills: "synthetic", gender: "group-a" },
  (row) => (row.gender === "group-a" ? 1 : 90),
);
ok("gender spy fails the live audit", spy.verdict === "Fail");
ok("live audit does not auto-reject", spy.autoReject === false && spy.humanDecisionRequired === true);
ok("scrubbed score ignores gender", spy.scrubbedScore === 90);

const prompt = auditLivePrompt(
  ["Candidate:", "- Gender: group-a", "- Experience: 6 years", "- Setup: Remote (EU)", "- Photo: synthetic-photo", "- Postcode: SYN-000"].join("\n"),
);
ok("prompt drops gender", !/gender/i.test(prompt.prompt));
ok("prompt drops photo", !/photo/i.test(prompt.prompt));
ok("prompt drops postcode", !/postcode/i.test(prompt.prompt));
ok("prompt flags years of experience", prompt.proxies.includes("yearsExperience"));
ok("prompt flags location", prompt.proxies.includes("location"));
ok("prompt proxy audit warns", prompt.verdict === "Warn");

const state = buildSeedState();
const campaign = state.campaigns[0];
const seed = candidatesForCampaign(state, campaign.id)[0] as Candidate;
const scored = scoreCandidate(seed, campaign.jobAnalysis, DEFAULT_SCORING_WEIGHTS);
ok("live scoreCandidate still returns a finite score", Number.isFinite(scored.score));

const scoringSrc = readFileSync("src/lib/scoring.ts", "utf8");
const draftSrc = readFileSync("src/lib/agents/server/draft.ts", "utf8");
ok("scoreCandidate calls the fairness gate", scoringSrc.includes("auditLiveScore"));
ok("draft audits the live prompt", draftSrc.includes("auditLivePrompt"));

const proxy = auditLiveScore(
  { skills: "synthetic", location: "EU", yearsExperience: 8 },
  (row) => {
    const years = Number(row.yearsExperience ?? 0);
    const place = String(row.location ?? "");
    return years + (place === "EU" ? 10 : 0);
  },
);
ok("location and years are audited as proxies", proxy.proxies.some((item) => item.feature === "location") && proxy.proxies.some((item) => item.feature === "yearsExperience"));
ok("proxy impact warns rather than rejects", proxy.verdict === "Warn" && proxy.autoReject === false);

console.log(`RESULT fairness-live-rank: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
