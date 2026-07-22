import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OLD_DEERFLOW = "fabadae4168db81f0eaaf62f209050f978e2f691";
const OLD_FLOWISE = "bb773ffa710bd22639c4ba2643413a0ea2b679d3";
const NEW_DEERFLOW = "3c0a45ad772cdba388009b8d5ecad5e48cd22429";
const NEW_FLOWISE = "ed9e100fb71643cd3922b005908f9732bc0e07dc";

const migrationPath = resolve(
  "supabase/migrations/0048_agent_framework_upstream_pin_rotation.sql",
);
const rollbackPath = resolve(
  "supabase/rollbacks/0048_agent_framework_upstream_pin_rotation.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

assert.doesNotMatch(
  migration,
  /^\s*(?:begin|commit|rollback)\s*;\s*$/im,
  "numbered migrations must leave transaction ownership to the bootstrap runner",
);
assert.match(migration, /set local lock_timeout\s*=\s*'[^']+';/i);
assert.match(migration, /set local statement_timeout\s*=\s*'[^']+';/i);
assert.match(migration, /set local idle_in_transaction_session_timeout\s*=\s*'[^']+';/i);

assert.ok(migration.includes(NEW_DEERFLOW), "new DeerFlow pin is absent");
assert.ok(migration.includes(NEW_FLOWISE), "new Flowise pin is absent");
assert.ok(
  migration.includes(OLD_DEERFLOW) && migration.includes(OLD_FLOWISE),
  "historical pins must remain represented by expand-safe constraints",
);

assert.match(
  migration,
  /update public\.agent_framework_controls[\s\S]*execution_enabled\s*=\s*false[\s\S]*kill_switch\s*=\s*true[\s\S]*required_deerflow_commit\s*=\s*required_deerflow_pin[\s\S]*required_flowise_commit\s*=\s*required_flowise_pin/i,
  "control rotation must be fail-closed and atomic",
);
assert.match(
  migration,
  /required_deerflow_instance_id\s*=\s*null[\s\S]*required_flowise_instance_id\s*=\s*null[\s\S]*configuration_sha256\s*=\s*null/i,
  "old runtime bindings must be invalidated during pin rotation",
);
assert.match(
  migration,
  /update public\.agent_framework_instances[\s\S]*status\s*=\s*'degraded'[\s\S]*source_commit in \(historical_deerflow_pin, historical_flowise_pin\)/i,
  "old instances must be retained as degraded history",
);

for (const functionName of [
  "configure_agent_framework_authority",
  "activate_agent_framework_authority",
  "import_agent_workflow_version",
  "review_agent_workflow_version",
  "list_agent_framework_heartbeat_targets",
  "record_agent_framework_readiness",
  "enforce_agent_framework_run_control_identity",
  "agent_framework_run_authority_is_active",
  "claim_agent_framework_run_v0029",
]) {
  assert.ok(
    migration.includes(`public.${functionName}(`),
    `${functionName} is absent from the shape-asserted rotation set`,
  );
}
assert.match(
  migration,
  /create function public\.rotate_agent_framework_function_definition_0048\(/i,
);
assert.match(
  migration,
  /drop function public\.rotate_agent_framework_function_definition_0048\(/i,
);

assert.match(
  migration,
  /agent_framework_instances_supported_source_commit_check/i,
);
assert.match(
  migration,
  /agent_framework_runs_supported_source_commit_pair_check/i,
);
assert.match(
  migration,
  /agent_framework_configuration_receipts_pin_pair_check/i,
);
assert.match(
  migration,
  /agent_framework_controls_required_deerflow_commit_pin_check/i,
);
assert.match(
  migration,
  /agent_framework_controls_required_flowise_commit_pin_check/i,
);

assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
assert.doesNotMatch(migration, /\btruncate\b/i);
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.agent_framework_/i);

assert.match(rollback, /^begin;$/m, "rollback must be transactional");
assert.match(rollback, /^commit;$/m, "rollback must commit explicitly");
assert.match(rollback, /set local lock_timeout\s*=\s*'[^']+';/i);
assert.match(rollback, /raise exception[\s\S]*new-pin effects/i);
assert.ok(rollback.includes(NEW_DEERFLOW));
assert.ok(rollback.includes(NEW_FLOWISE));
assert.ok(rollback.includes(OLD_DEERFLOW));
assert.ok(rollback.includes(OLD_FLOWISE));
assert.doesNotMatch(rollback, /\bdrop\s+table\b/i);
assert.doesNotMatch(rollback, /\btruncate\b/i);
assert.doesNotMatch(rollback, /\bdelete\s+from\s+public\.agent_framework_/i);

console.log("RESULT agent-framework-pin-rotation-static: passed");
