/**
 * Recorded E2E: AMACAN Calypso Application Support need in → scored shortlist out.
 * Evidence is this command + exit_code + path, not a self-report.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(root, "_relay/evidence/trading-need-e2e.json");
const command = "tsx tests/sourcing-engine.mts";

const result = spawnSync(process.execPath, ["--import", "tsx", "tests/sourcing-engine.mts"], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});

const exitCode = result.status ?? 1;
mkdirSync(dirname(evidencePath), { recursive: true });

let fromTest: Record<string, unknown> = {};
try {
  fromTest = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
} catch {
  fromTest = {};
}

writeFileSync(
  evidencePath,
  `${JSON.stringify(
    {
      command,
      exit_code: exitCode,
      path: "_relay/evidence/trading-need-e2e.json",
      need: fromTest.need ?? null,
      requiredSkills: fromTest.requiredSkills ?? [],
      shortlistCount: fromTest.shortlistCount ?? 0,
      scores: fromTest.scores ?? [],
      nameOnlyScore: fromTest.nameOnlyScore ?? null,
      nameOnlyPassedFloor: fromTest.nameOnlyPassedFloor ?? null,
      emptyPassedFloor: fromTest.emptyPassedFloor ?? null,
      secondNeed: fromTest.secondNeed ?? null,
      combinedNeedCount: fromTest.combinedNeedCount ?? 0,
      stdout_tail: (result.stdout || "").trim().split("\n").slice(-8),
      stderr_tail: (result.stderr || "").trim().split("\n").slice(-8),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
console.log(`RECORDED command=${command} exit_code=${exitCode} path=_relay/evidence/trading-need-e2e.json`);
process.exit(exitCode);
