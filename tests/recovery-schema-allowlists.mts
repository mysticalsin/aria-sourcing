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

const requiredTables = [
  "agent_conversations",
  "agent_framework_run_memory_context",
  "agent_memories",
  "agent_memory_events",
  "agent_memory_legacy_quarantine",
  "agent_run_memory_context",
  "candidate_erasure_obligations",
  "candidate_erasure_receipts",
  "candidate_erasure_requests",
  "candidate_erasure_suppression_tombstones",
  "candidate_legal_holds",
  "email_connection_seat_mismatch_quarantine",
  "sourcing_run_results",
];

const inventory = readFileSync("docker/bootstrap/legacy-table-inventory.txt", "utf8")
  .trim()
  .split("\n");
const invariant = readFileSync("docker/bootstrap/legacy-baseline-invariants.sql", "utf8");
const invariantTables = [...invariant.matchAll(
  /expected(?:_[a-z]+)*_tables constant text :=\s*'([^']+)'/g,
)]
  .flatMap((match) => match[1].split(","))
  .sort();
ok(
  "one sorted inventory exactly matches the schema invariant table set",
  inventory.length > 0 &&
    inventory.join("\n") === [...new Set(inventory)].sort().join("\n") &&
    JSON.stringify(inventory) === JSON.stringify(invariantTables),
);
ok(
  "bootstrap, database proof, backup, and restore consume the canonical inventory",
  readFileSync("docker/bootstrap/run.fly.sh", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("scripts/test-db-privileges.sh", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("docker/bootstrap/Dockerfile.fly", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("scripts/backup.sh", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("scripts/restore-drill.sh", "utf8").includes("legacy-table-inventory.txt"),
);

for (const table of requiredTables) {
  ok(`canonical inventory binds ${table}`, inventory.includes(table));
}

console.log(`RESULT recovery-schema-allowlists: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
