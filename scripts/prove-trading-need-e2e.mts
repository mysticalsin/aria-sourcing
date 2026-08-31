/**
 * Recorded E2E: trading-platform need in → scored shortlist out.
 * Evidence is this command + exit_code + path, not a self-report.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
writeFileSync(
  evidencePath,
  `${JSON.stringify(
    {
      command,
      exit_code: exitCode,
      path: evidencePath,
      stdout_tail: (result.stdout || "").trim().split("\n").slice(-8),
      stderr_tail: (result.stderr || "").trim().split("\n").slice(-8),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
console.log(`RECORDED command=${command} exit_code=${exitCode} path=${evidencePath}`);
process.exit(exitCode);
