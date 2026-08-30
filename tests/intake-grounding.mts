import assert from "node:assert/strict";
import test from "node:test";

import {
  groundLiveIntakeFields,
  parseHermesIntakeJson,
  parseIntakeLive,
} from "../src/lib/ai/intake";
import { parseEmailAndJD } from "../src/lib/mock-ai";
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
  assert.equal(parsed.sender.email, "");

  const readiness = evaluateNeedReadiness(parsed.jobAnalysis);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some((issue) => issue.field === "requiredSkills"));
  assert.ok(readiness.issues.some((issue) => issue.field === "seniority"));
});

test("missing cloud provider returns the same evidence-grounded incomplete need", async () => {
  const settings = buildSeedState().settings;
  const bare = {
    ...settings,
    llmProviders: [],
    savedModels: [],
    defaultModels: {},
    hermesLiveMode: false,
  };
  // Live/enterprise tenants (supabase enabled, demo login off) must not invent a
  // successful heuristic intake when no cloud parser is configured.
  const liveTenant =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN !== "true";
  if (liveTenant) {
    await assert.rejects(() => parseIntakeLive(bare, { email: minimalNeed }), /live_intake_llm_required/);
    return;
  }
  const parsed = await parseIntakeLive(bare, { email: minimalNeed });

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
