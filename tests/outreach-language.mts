import { resolveOutreachLanguage } from "../src/lib/outreach-language";
import type { Campaign, Candidate } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const frCandidate = { languages: ["French - Fluent", "English"] } as Pick<Candidate, "languages">;
const enCampaign = {
  jobAnalysis: { language: "en", localeContext: { primaryLanguage: "en" } },
} as Pick<Campaign, "jobAnalysis">;
const frCampaign = {
  jobAnalysis: {
    language: "en",
    localeContext: { primaryLanguage: "fr", workCity: "Paris" },
  },
} as Pick<Campaign, "jobAnalysis">;

ok(
  "candidate French beats need English locale",
  resolveOutreachLanguage({ candidate: frCandidate, campaign: enCampaign }) === "fr",
);
ok(
  "need locale when candidate has no languages",
  resolveOutreachLanguage({ candidate: {}, campaign: frCampaign }) === "fr",
);
ok(
  "seat language when need has no locale or language",
  resolveOutreachLanguage({ candidate: {}, campaign: { jobAnalysis: {} }, seatLanguage: "de", defaultLanguage: "en" }) === "de",
);
ok(
  "workspace default fallback",
  resolveOutreachLanguage({ candidate: {}, campaign: { jobAnalysis: {} }, defaultLanguage: "it" }) === "it",
);

console.log(`RESULT outreach-language: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
