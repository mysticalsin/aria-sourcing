import assert from "node:assert/strict";
import test from "node:test";

import {
  groundLiveIntakeFields,
  parseHermesIntakeJson,
  parseIntakeLive,
} from "../src/lib/ai/intake";
import { createCampaign, parseEmailAndJD } from "../src/lib/mock-ai";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";
import { buildSeedState } from "../src/lib/seed";

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
  assert.equal(parsed.jobAnalysis.equity, false);
  assert.equal(parsed.jobAnalysis.equityKnown, false);
  assert.equal(parsed.jobAnalysis.urgency, "Standard");
  assert.equal(parsed.jobAnalysis.urgencyKnown, false);
  assert.equal(parsed.jobAnalysis.expectedStartDate, undefined);
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

test("manual campaign construction never invents dates, provider estimates, or excluded companies", () => {
  const parsed = parseEmailAndJD({
    email:
      "We need a Senior Data Engineer. Full-time, remote in Canada. Must have Python, SQL, and Airflow. Reports to Director of Data.",
  });
  const campaign = createCampaign(parsed.jobAnalysis, {
    hiringManager: "",
    hiringManagerEmail: "",
  });

  assert.equal(campaign.targetStartDate, "");
  assert.deepEqual(campaign.sourcingStrategy.excludedCompanies, []);
  assert.ok(campaign.sourcingStrategy.githubQueries.length > 0);
  assert.ok(campaign.sourcingStrategy.githubQueries.every((query) => query.estimatedResults === null));
  assert.ok(campaign.sourcingStrategy.githubQueries.every((query) => query.query.endsWith(" type:user")));
});

test("explicit urgency and negative equity evidence remain distinguishable from unknown defaults", () => {
  const parsed = parseEmailAndJD({
    email:
      "We need a Senior Data Engineer. Full-time, remote. Must have Python, SQL, and Airflow. Normal priority. No equity.",
  });

  assert.equal(parsed.jobAnalysis.urgency, "Standard");
  assert.equal(parsed.jobAnalysis.urgencyKnown, true);
  assert.equal(parsed.jobAnalysis.equity, false);
  assert.equal(parsed.jobAnalysis.equityKnown, true);
});

test("unrecognized priority labels remain unknown instead of laundering Standard into a stated fact", () => {
  const generic = parseEmailAndJD({
    email:
      "We need a Senior Data Engineer. Full-time, remote. Must have Python, SQL, and Airflow. Priority: Banana.",
  });
  assert.equal(generic.jobAnalysis.urgency, "Standard");
  assert.equal(generic.jobAnalysis.urgencyKnown, false);

  const mantu = parseEmailAndJD({
    email: [
      "This need is now ACTIVE: Senior Data Engineer",
      "Priority: Banana",
      "Skills: Python, SQL, Airflow",
    ].join("\n"),
  });
  assert.equal(mantu.jobAnalysis.urgency, "Standard");
  assert.equal(mantu.jobAnalysis.urgencyKnown, false);
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
  assert.equal(grounded.urgency, undefined);
  assert.equal(grounded.urgencyKnown, false);
  assert.equal(grounded.equity, undefined);
  assert.equal(grounded.equityKnown, false);
});

test("cloud grounding derives urgency and equity only from submitted evidence", () => {
  const model = parseHermesIntakeJson(JSON.stringify({ urgency: "ASAP", equity: true }));
  assert.ok(model);

  const unknown = groundLiveIntakeFields(model, minimalNeed);
  assert.equal(unknown.urgency, undefined);
  assert.equal(unknown.urgencyKnown, false);
  assert.equal(unknown.equity, undefined);
  assert.equal(unknown.equityKnown, false);

  const explicit = groundLiveIntakeFields(model, "Normal priority. This role has no equity.");
  assert.equal(explicit.urgency, "Standard");
  assert.equal(explicit.urgencyKnown, true);
  assert.equal(explicit.equity, false);
  assert.equal(explicit.equityKnown, true);
});

test("cloud grounding requires evidence boundaries for short titles and skills", () => {
  const hallucinated = parseHermesIntakeJson(
    JSON.stringify({
      title: "Go",
      seniority: "Senior",
      employmentType: "Full-time",
      locationType: "Remote",
      requiredSkills: ["Go", "R", "C"],
    }),
  );
  assert.ok(hallucinated);
  const rejected = groundLiveIntakeFields(
    hallucinated,
    "Google is hiring a Senior full-time remote researcher reporting to the CTO.",
  );
  assert.equal(rejected.title, undefined);
  assert.deepEqual(rejected.requiredSkills, []);

  const explicit = groundLiveIntakeFields(
    hallucinated,
    "Role: Go. Senior full-time remote engineer. Required skills: Go, R, and C.",
  );
  assert.equal(explicit.title, "Go");
  assert.deepEqual(explicit.requiredSkills, ["Go", "R", "C"]);
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
