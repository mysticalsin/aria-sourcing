import assert from "node:assert/strict";
import test from "node:test";

import {
  groundLiveIntakeFields,
  parseIntakeJson,
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
  const parsed = await parseIntakeLive(
    {
      ...settings,
      llmProviders: [],
      savedModels: [],
      defaultModels: {},
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
  const model = parseIntakeJson(
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

test("brief extraction asks the extract task on Haiku and uses its grounded answer", async () => {
  const brief = "Senior Backend Engineer, remote. Must have TypeScript and PostgreSQL.";
  const sent: { task?: string; model?: string; provider?: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "{}"));
    const answer = {
      title: "Senior Backend Engineer",
      seniority: "Senior",
      locationType: "Remote",
      requiredSkills: ["TypeScript", "PostgreSQL", "Kubernetes"],
    };
    return new Response(JSON.stringify({ ok: true, text: JSON.stringify(answer) }), { status: 200 });
  }) as typeof fetch;
  try {
    const parsed = await parseIntakeLive(buildSeedState().settings, { email: brief });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.task, "extract");
    assert.equal(sent[0]?.provider, "anthropic");
    assert.equal(sent[0]?.model, "claude-haiku-5-5");
    assert.equal(parsed.extractionMode, "cloud");
    assert.equal(parsed.jobAnalysis.seniority, "Senior");
    // Grounding still drops a skill the brief never mentions.
    assert.deepEqual(parsed.jobAnalysis.requiredSkills, ["TypeScript", "PostgreSQL"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
