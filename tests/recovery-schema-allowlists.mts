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
  "docker/bootstrap/legacy-table-inventory.txt",
  "docker/bootstrap/legacy-baseline-invariants.sql",
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

const inventory = readFileSync("docker/bootstrap/legacy-table-inventory.txt", "utf8")
  .trim()
  .split("\n");
const invariant = readFileSync("docker/bootstrap/legacy-baseline-invariants.sql", "utf8");
const invariantTables = invariant
  .match(/expected_tables constant text :=\s*'([^']+)'/)?.[1]
  ?.split(",") ?? [];
ok(
  "one sorted inventory exactly matches the schema invariant table set",
  inventory.length > 0 &&
    inventory.join("\n") === [...new Set(inventory)].sort().join("\n") &&
    JSON.stringify(inventory) === JSON.stringify(invariantTables),
);
ok(
  "bootstrap and database proof consume the canonical inventory",
  readFileSync("docker/bootstrap/run.fly.sh", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("scripts/test-db-privileges.sh", "utf8").includes("legacy-table-inventory.txt") &&
    readFileSync("docker/bootstrap/Dockerfile.fly", "utf8").includes("legacy-table-inventory.txt"),
);

for (const file of allowlistFiles) {
  const source = readFileSync(file, "utf8");
  for (const table of requiredTables) {
    ok(`${file} binds ${table}`, source.includes(table));
  }
}

console.log(`RESULT recovery-schema-allowlists: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
