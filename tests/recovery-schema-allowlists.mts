import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", name);
  }
}

const allowlistFiles = [
  "docker/bootstrap/run.fly.sh",
  "docker/bootstrap/legacy-baseline-invariants.sql",
  "scripts/test-db-privileges.sh",
  "scripts/backup.sh",
  "scripts/restore-drill.sh",
  "tests/bootstrap-contract.mts",
  "tests/restore-drill-contract.mts",
];

const requiredTables = [
  "agent_conversations",
  "agent_memories",
  "agent_memory_events",
  "agent_memory_legacy_quarantine",
  "agent_run_memory_context",
];

for (const file of allowlistFiles) {
  const source = readFileSync(file, "utf8");
  for (const table of requiredTables) {
    ok(`${file} binds ${table}`, source.includes(table));
  }
}

console.log(`RESULT recovery-schema-allowlists: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
