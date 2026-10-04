import assert from "node:assert/strict";
import test from "node:test";

import { SAMPLE_LAUNCH_BRIEF } from "../src/lib/launch/sample-brief";
import { parseEmailAndJD } from "../src/lib/mock-ai";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";

test("every labelled launch sample role is complete enough for sourcing", () => {
  const roles = SAMPLE_LAUNCH_BRIEF.split(/^\s*-{3,}\s*$/m).map((role) => role.trim()).filter(Boolean);
  assert.equal(roles.length, 6);
  for (const role of roles) {
    const parsed = parseEmailAndJD({ email: role });
    assert.deepEqual(
      evaluateNeedReadiness(parsed.jobAnalysis),
      { ready: true, issues: [] },
      `${parsed.jobAnalysis.title}: ${JSON.stringify(parsed.jobAnalysis)}`,
    );
  }
});
