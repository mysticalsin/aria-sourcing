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

const hidden = scrubRankingFeatures({
  Protected_Group: "declared-a",
  group_label: "declared-a",
  protected: "declared-a",
  skills: "synthetic",
});
check("protected group alias is scrubbed", !("Protected_Group" in hidden));
check("group label alias is scrubbed", !("group_label" in hidden));
check("protected alias is scrubbed", !("protected" in hidden));
check("skills stay beside a protected alias", hidden.skills === "synthetic");

auditLiveScore(
  {
    protectedGroup: "declared-a",
    groupLabel: "declared-b",
    protected: "declared-c",
    yearsExperience: 4,
  },
  (row) => {
    check("scorer does not see a protected label", !("protectedGroup" in row) && !("groupLabel" in row) && !("protected" in row));
    return 1;
  },
);

const stringYears = auditLiveScore({ yearsExperience: "8 years" }, (row) => {
  return typeof row.yearsExperience === "string" ? 5 : 0;
});
check(
  "string years are measured against the scrubbed score",
  stringYears.verdict === "Warn" &&
    stringYears.proxies.some((item) => item.feature === "yearsExperience" && item.delta > 0),
);

const nonFinite = auditLiveScore({ skills: "synthetic" }, () => Number.NaN);
check("non-finite score is not a pass", nonFinite.verdict === "Warn");
check("non-finite score is not a rejection", nonFinite.autoReject === false);

const leaked = auditLivePrompt(
  [
    "Role: backend",
    "Sex: group-a",
    "Age: 40",
    "Racial group: group-a",
    "ZIP: 10001",
    "Postal code: SYN-000",
    "Date of birth: 1990-01-01",
    "Graduation year: 2010",
    "Faith: none",
    "Handicap: none",
    "Avatar: https://example.test/synthetic.png",
    "Protected group: declared-a",
  ].join("\n"),
);
check("protected prompt lines are dropped and the role remains", leaked.prompt === "Role: backend");

console.log(`RESULT fairness-live-rank: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
