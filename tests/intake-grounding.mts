import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  coalesceRequiredSkills,
  groundLiveIntakeFields,
  parseHermesIntakeJson,
  parseIntakeLive,
} from "../src/lib/ai/intake";
import { parseEmailAndJD } from "../src/lib/mock-ai";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";
import { buildSeedState } from "../src/lib/seed";

const TONY_AMACAN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/tony-calypso-amacan-need.txt"),
  "utf8",
);

const minimalNeed = "We need a Data Engineer.";

test("generic intake preserves unknown role facts instead of filling synthetic defaults", () => {
  const parsed = parseEmailAndJD({ email: minimalNeed });

  assert.equal(parsed.jobAnalysis.title, "Data Engineer");
  assert.equal(parsed.jobAnalysis.department, "Data");
  assert.equal(parsed.jobAnalysis.seniority, "Unspecified");
  assert.equal(parsed.jobAnalysis.employmentType, "Unspecified");
  assert.equal(parsed.jobAnalysis.locationType, "Unspecified");
  assert.deepEqual(parsed.jobAnalysis.requiredSkills, []);
  assert.deepEqual(parsed.jobAnalysis.companyStageTarget, []);
  assert.deepEqual(parsed.jobAnalysis.regions, []);
  assert.equal(parsed.jobAnalysis.timezone, "");
  assert.equal(parsed.jobAnalysis.currency, "");
  assert.equal(parsed.jobAnalysis.education, "");
  assert.equal(parsed.jobAnalysis.teamSize, "");
  assert.equal(parsed.jobAnalysis.reportingTo, "");
  assert.equal(parsed.sender.email, "");

  const readiness = evaluateNeedReadiness(parsed.jobAnalysis);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some((issue) => issue.field === "requiredSkills"));
  assert.ok(readiness.issues.some((issue) => issue.field === "seniority"));
});

test("missing cloud provider returns the same evidence-grounded incomplete need", async () => {
  const settings = buildSeedState().settings;
  const parsed = await parseIntakeLive(
    {
      ...settings,
      llmProviders: [],
      savedModels: [],
      defaultModels: {},
      hermesLiveMode: false,
    },
    { email: minimalNeed },
  );

  assert.deepEqual(parsed.jobAnalysis.requiredSkills, []);
  assert.deepEqual(parsed.jobAnalysis.companyStageTarget, []);
  assert.equal(parsed.jobAnalysis.teamSize, "");
  assert.equal(parsed.jobAnalysis.reportingTo, "");
  assert.equal(evaluateNeedReadiness(parsed.jobAnalysis).ready, false);
});

test("cloud extraction drops role facts that do not appear in the submitted need", () => {
  const model = parseHermesIntakeJson(
    JSON.stringify({
      title: "Data Engineer",
      seniority: "Senior",
      employmentType: "Full-time",
      locationType: "Remote",
      requiredSkills: ["TypeScript", "Node.js", "PostgreSQL"],
      companyStageTarget: ["Series A", "Series B"],
      teamSize: "6-10 engineers",
      reportingTo: "Engineering Manager",
    }),
  );
  assert.ok(model);
  const grounded = groundLiveIntakeFields(model, minimalNeed);

  assert.equal(grounded.title, "Data Engineer");
  assert.equal(grounded.seniority, undefined);
  assert.equal(grounded.employmentType, undefined);
  assert.equal(grounded.locationType, undefined);
  assert.deepEqual(grounded.requiredSkills, []);
  assert.deepEqual(grounded.companyStageTarget, []);
  assert.equal(grounded.teamSize, undefined);
  assert.equal(grounded.reportingTo, undefined);
});

test("explicit role facts remain executable and no unrelated defaults are added", () => {
  const parsed = parseEmailAndJD({
    email:
      "We need a Senior Data Engineer. Full-time, remote in Canada. Must have Python, SQL, and Airflow. Reports to Director of Data.",
  });

  assert.equal(parsed.jobAnalysis.seniority, "Senior");
  assert.equal(parsed.jobAnalysis.employmentType, "Full-time");
  assert.equal(parsed.jobAnalysis.locationType, "Remote");
  assert.deepEqual(parsed.jobAnalysis.requiredSkills.sort(), ["Airflow", "Python", "SQL"]);
  assert.deepEqual(parsed.jobAnalysis.companyStageTarget, []);
  assert.equal(parsed.jobAnalysis.teamSize, "");
  assert.equal(parsed.jobAnalysis.reportingTo, "Director of Data");
  assert.equal(evaluateNeedReadiness(parsed.jobAnalysis).ready, true);
});

test("placeholder whitespace is never accepted as a real title or skill", () => {
  const parsed = parseEmailAndJD({
    email: "We need a Senior Data Engineer. Full-time, remote. Must have Go.",
  });
  parsed.jobAnalysis.title = " ";
  parsed.jobAnalysis.requiredSkills = ["   "];

  const readiness = evaluateNeedReadiness(parsed.jobAnalysis);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some((issue) => issue.field === "title"));
  assert.ok(readiness.issues.some((issue) => issue.field === "requiredSkills"));
});

test("complete VSS evidence is not emptied by a missing cloud parser", async () => {
  const settings = buildSeedState().settings;
  const parsed = await parseIntakeLive(
    {
      ...settings,
      hermesLiveMode: true,
    },
    { email: TONY_AMACAN },
  );
  assert.match(parsed.jobAnalysis.title, /calypso application support/i);
  assert.ok(parsed.jobAnalysis.requiredSkills.some((s) => /linux/i.test(s)));
  assert.ok(parsed.jobAnalysis.requiredSkills.some((s) => /calypso/i.test(s)));
  assert.equal(parsed.jobAnalysis.seniority, "Mid");
  assert.equal(parsed.jobAnalysis.locationType, "Hybrid");
  assert.equal(evaluateNeedReadiness(parsed.jobAnalysis).ready, true);
  assert.equal(parsed.providerWarning, undefined);
  assert.equal(parsed.extractionMode, "evidence");
});

test("cloud one-chip Skill (Must) cannot shrink a split VSS list", () => {
  const split = [
    "Linux",
    "Python",
    "Shell",
    "Oracle",
    "Grafana",
    "Dynatrace",
    "Linux Server",
    "Calypso",
  ];
  assert.deepEqual(
    coalesceRequiredSkills(split, ["Linux Python Shell Oracle Grafana Dynatrace Linux Server"]),
    split,
  );
  assert.ok(
    coalesceRequiredSkills(["Linux Python Shell Oracle Grafana Dynatrace Linux Server"]).includes("Python"),
  );
});

test("Parse JD path keeps Middle 4-6, Montreal, and no cloud-miss banner on VSS", async () => {
  const settings = buildSeedState().settings;
  const parsed = await parseIntakeLive(
    {
      ...settings,
      llmProviders: [],
      savedModels: [],
      defaultModels: {},
      hermesLiveMode: true,
    },
    { email: TONY_AMACAN },
  );
  assert.equal(parsed.jobAnalysis.seniority, "Mid");
  assert.equal(parsed.jobAnalysis.minYearsExperience, 4);
  assert.equal(parsed.jobAnalysis.maxYearsExperience, 6);
  assert.ok(
    /montreal/i.test(parsed.jobAnalysis.location ?? "") ||
      parsed.jobAnalysis.regions.some((r) => /montreal/i.test(r)),
  );
  assert.equal(parsed.jobAnalysis.language, "en");
  assert.equal(parsed.providerWarning, undefined);
  assert.equal(evaluateNeedReadiness(parsed.jobAnalysis).ready, true);
  assert.ok(
    !parsed.jobAnalysis.requiredSkills.some((s) => /Linux Python Shell/i.test(s)),
    "must-haves stay tokenized",
  );
});

test("partial remote grounds as Hybrid and CDI/consulting as Contract", () => {
  const grounded = groundLiveIntakeFields(
    {
      title: "Calypso Application Support",
      seniority: "Mid",
      employmentType: "Contract",
      locationType: "Hybrid",
      requiredSkills: ["Linux"],
    },
    "Title\nCalypso Application Support\nRemote\nPossible partially remote\nContract Type\nUndetermined Duration Contract (CDI)\nLevel of Experience\nMiddle - From 4 to 6 years",
  );
  assert.equal(grounded.title, "Calypso Application Support");
  assert.equal(grounded.seniority, "Mid");
  assert.equal(grounded.employmentType, "Contract");
  assert.equal(grounded.locationType, "Hybrid");
});
