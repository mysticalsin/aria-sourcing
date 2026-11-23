/**
 * Synthetic fairness checks. No real candidate, photo, or protected attribute
 * is stored. The audit never auto-rejects a person.
 */
import { auditLivePrompt, auditLiveScore, scrubRankingFeatures } from "../src/lib/fairness/live-rank.ts";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

const features = {
  location: "Berlin",
  yearsExperience: 8,
  gender: "unspecified",
  photo: "present",
  avatarUrl: "https://example.test/synthetic.png",
};

const scrubbed = scrubRankingFeatures(features);
check("gender is scrubbed", !("gender" in scrubbed));
check("photo is scrubbed", !("photo" in scrubbed));
check("avatar is scrubbed", !("avatarUrl" in scrubbed));
check("location stays as a role criterion", scrubbed.location === "Berlin");
check("years stay as a role criterion", scrubbed.yearsExperience === 8);

const audit = auditLiveScore(features, (row) => {
  check("scorer does not see gender", !("gender" in row));
  check("scorer does not see a photo", !("photo" in row) && !("avatarUrl" in row));
  const years = Number(row.yearsExperience ?? 0);
  const location = row.location === "Berlin" ? 4 : 0;
  return years + location;
});
check("verdict is a warning, not a rejection", audit.verdict === "Warn");
check("auto reject stays false", audit.autoReject === false);
check("a human decision is required", audit.humanDecisionRequired === true);
check("proxy movement is reported", audit.proxies.length === 2 && audit.proxies.every((item) => item.delta > 0));

const prompt = auditLivePrompt("Role: backend\nGender: hidden\nLocation: Berlin\nYears: 6");
check("protected prompt line is dropped", !/gender/i.test(prompt.prompt));
check("location line remains", /Berlin/.test(prompt.prompt));
check("prompt proxy is a warning", prompt.verdict === "Warn");

console.log(`RESULT fairness-live-rank: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
