import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/0029_agent_framework_authority.sql";
assert.equal(existsSync(migrationPath), true, "framework authority migration must exist");
const migration = readFileSync(migrationPath, "utf8");
const specsRoute = readFileSync("src/app/api/agents/specs/route.ts", "utf8");
const proxyRoute = readFileSync("src/app/api/flowise/[...path]/route.ts", "utf8");
const adminRoute = readFileSync("src/app/api/admin/agent-frameworks/workflows/route.ts", "utf8");
const runRoute = readFileSync("src/app/api/agents/run/route.ts", "utf8");

const checks: Array<[string, boolean]> = [
  ["legacy browser-owned Flowise bindings are invalidated", /update public\.agent_specs[\s\S]*?set flowise_chatflow_id = null/.test(migration)],
  ["authenticated users lose the legacy Flowise column grant", /revoke update \(flowise_chatflow_id\)[\s\S]*?from authenticated/.test(migration)],
  ["framework controls exist and default disabled with kill active", /create table if not exists public\.agent_framework_controls/.test(migration) && /execution_enabled\s+boolean not null default false/.test(migration) && /kill_switch\s+boolean not null default true/.test(migration)],
  ["framework instances are exact-image records", /create table if not exists public\.agent_framework_instances/.test(migration) && /source_commit/.test(migration) && /image_digest/.test(migration)],
  ["framework heartbeat inventory is service-owned and configuration-bound", /create or replace function public\.list_agent_framework_heartbeat_targets/.test(migration) && /configuration_sha256/.test(migration) && /auth\.role\(\)[\s\S]*?service_role/.test(migration)],
  ["readiness updates bind immutable identity and clear stale health on failure", /create or replace function public\.record_agent_framework_readiness/.test(migration) && /identity_mismatch/.test(migration) && /status = case when p_ready then 'ready' else 'degraded' end/.test(migration) && /last_ready_at = case when p_ready then now\(\) else null end/.test(migration)],
  ["audited DeerFlow commit is database-pinned", migration.includes("fabadae4168db81f0eaaf62f209050f978e2f691")],
  ["audited Flowise commit is database-pinned", migration.includes("bb773ffa710bd22639c4ba2643413a0ea2b679d3")],
  ["workflow versions bind workspace owner and spec", /agent_workflow_versions_workspace_owner_spec_fkey[\s\S]*?foreign key \(workspace_id, owner_id, spec_id\)/.test(migration)],
  ["workflow JSON is bound to its canonical SHA-256", /agent_workflow_versions_json_sha256_check[\s\S]*?digest\(workflow_json::text, 'sha256'\)/.test(migration)],
  ["runs bind workspace owner spec actor campaign workflow and instance", /create table if not exists public\.agent_framework_runs/.test(migration) && /campaign_fingerprint/.test(migration) && /idempotency_key/.test(migration) && /lease_id/.test(migration)],
  ["runs snapshot DeerFlow and Flowise image, isolation, and readiness provenance", /deerflow_readiness_sha256/.test(migration) && /flowise_instance_id/.test(migration) && /flowise_image_digest/.test(migration) && /flowise_isolation_mode/.test(migration) && /flowise_readiness_sha256/.test(migration)],
  ["framework instance identity cannot be rewritten", /enforce_agent_framework_instance_identity_immutable[\s\S]*?new\.image_digest is distinct from old\.image_digest/.test(migration) && /agent_framework_instances_identity_immutable/.test(migration)],
  ["step receipts store hashes rather than prompt or candidate payloads", /create table if not exists public\.agent_framework_step_receipts/.test(migration) && /request_sha256/.test(migration) && /response_sha256/.test(migration) && !/agent_framework_step_receipts[\s\S]{0,1200}\b(?:prompt|candidate|body|payload)\b/.test(migration)],
  ["framework sourcing effects use one-time hash-bound durable authorization", /create table if not exists public\.agent_framework_sourcing_authorizations/.test(migration) && /capability_sha256/.test(migration) && /sourcing_run_id/.test(migration) && /status in \('authorized', 'claimed', 'ready', 'completed', 'failed'\)/.test(migration)],
  ["all framework tables force RLS", (migration.match(/force row level security/g) ?? []).length >= 5],
  ["API roles have no direct framework-table DML", /revoke all on public\.agent_framework_controls[\s\S]*?from public, anon, authenticated, service_role, authenticator/.test(migration)],
  ["run claim is service-only and serializes control plus idempotency", /create or replace function public\.claim_agent_framework_run/.test(migration) && /auth\.role\(\)[\s\S]*?service_role/.test(migration) && /for share/.test(migration) && /pg_advisory_xact_lock/.test(migration)],
  ["run claim checks both execution switch and kill switch", /not control\.execution_enabled[\s\S]*?control\.kill_switch/.test(migration)],
  ["unexpired active idempotency replay returns in-progress without a reusable lease", /existing\.status in \('claimed', 'running'\)[\s\S]*?existing\.lease_expires_at > now\(\)[\s\S]*?'in_progress'/.test(migration)],
  ["Flowise imports are service-owned, hash-bound, idempotent drafts", /create or replace function public\.import_agent_workflow_version/.test(migration) && /digest\(p_workflow_json::text, 'sha256'\)/.test(migration) && /'idempotency_conflict'/.test(migration)],
  ["workflow approval requires an independent admin reviewer", /create or replace function public\.review_agent_workflow_version/.test(migration) && /workflow\.created_by = p_actor_id[\s\S]*?'reviewer_conflict'/.test(migration)],
  ["owners list only their latest approved workflow versions", /create or replace function public\.list_agent_framework_workflows/.test(migration) && /p_owner_id is distinct from p_actor_id/.test(migration) && /distinct on \(workflow\.spec_id\)/.test(migration)],
  ["authoring RPCs are revoked from browser roles and granted only to service role", /revoke all on function public\.import_agent_workflow_version[\s\S]*?from public, anon, authenticated, authenticator/.test(migration) && /grant execute on function public\.review_agent_workflow_version[\s\S]*?to service_role/.test(migration)],
  ["run claim requires approved workflow and fresh release-pinned instances", /workflow\.status <> 'approved'/.test(migration) && /deerflow\.status <> 'ready'/.test(migration) && /flowise\.status <> 'ready'/.test(migration) && /required_deerflow_image_digest/.test(migration) && /required_flowise_image_digest/.test(migration) && /last_ready_at < now\(\) - interval '5 minutes'/.test(migration)],
  ["step and completion operations require the active lease", /record_agent_framework_step_receipt[\s\S]*?lease_id is distinct from p_lease_id/.test(migration) && /complete_agent_framework_run[\s\S]*?lease_id is distinct from p_lease_id/.test(migration)],
  ["proposal completion atomically creates exact sourcing authority", /complete_agent_framework_run\([\s\S]*?p_sourcing_capability_sha256[\s\S]*?insert into public\.agent_framework_sourcing_authorizations/.test(migration)],
  ["framework sourcing claim consumes the exact capability and links the sourcing run", /create or replace function public\.begin_agent_framework_sourcing_run/.test(migration) && /digest\(convert_to\(p_sourcing_capability_token/.test(migration) && /begin_sourcing_run\(/.test(migration) && /sourcing_run_id/.test(migration)],
  ["framework sourcing completion verifies the durable completed sourcing receipt", /create or replace function public\.complete_agent_framework_sourcing_effect/.test(migration) && /sourcing\.status <> 'completed'/.test(migration)],
  ["all mutable run paths recheck centralized framework authority", /agent_framework_run_authority_is_active\([\s\S]*?not control\.execution_enabled[\s\S]*?control\.kill_switch[\s\S]*?workflow\.status <> 'approved'[\s\S]*?spec\.status <> 'active'[\s\S]*?deerflow\.status <> 'ready'[\s\S]*?flowise\.status <> 'ready'/.test(migration) && /claim_agent_framework_run[\s\S]*?agent_framework_run_authority_is_active\(existing\.id\)/.test(migration) && /record_agent_framework_step_receipt[\s\S]*?agent_framework_run_authority_is_active\(run\.id\)/.test(migration) && /complete_agent_framework_run[\s\S]*?agent_framework_run_authority_is_active\(run\.id\)/.test(migration)],
  ["browser spec schemas no longer accept external Flowise IDs", !specsRoute.includes("flowise_chatflow_id")],
  ["public Flowise route performs no upstream fetch", proxyRoute.includes("FLOWISE_PUBLIC_PROXY_DISABLED") && !proxyRoute.includes("await fetch(")],
  ["private admin import revalidates authority after Flowise egress", /importFlowiseWorkflow\([\s\S]*?const current = await adminContext/.test(adminRoute) && /AGENT_FRAMEWORK_AUTHORITY_CHANGED/.test(adminRoute)],
  ["run revalidates the exact campaign-to-spec role binding after DeerFlow egress", /revalidateAuthority:[\s\S]*?latestSpec\.data\?\.role_brief[\s\S]*?latest\.value\.campaign\.jobAnalysis\.title/.test(runRoute)],
];

let failed = 0;
for (const [name, condition] of checks) {
  if (condition) console.log(`PASS: ${name}`);
  else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

console.log(`RESULT agent-framework-authority: ${checks.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
