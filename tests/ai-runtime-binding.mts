import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/0055_ai_runtime_binding_authority.sql";
const rollbackPath = "supabase/rollbacks/0055_ai_runtime_binding_authority.sql";
const servicePath = "src/lib/ai/runtime-binding.ts";
const keyTestRoutePath = "src/app/api/keys/test/route.ts";
const storePath = "src/lib/store.ts";
const keyPanelPath = "src/components/settings/api-keys-panel.tsx";

const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const rollback = existsSync(rollbackPath) ? readFileSync(rollbackPath, "utf8") : "";
const service = existsSync(servicePath) ? readFileSync(servicePath, "utf8") : "";
const keyTestRoute = existsSync(keyTestRoutePath) ? readFileSync(keyTestRoutePath, "utf8") : "";
const store = existsSync(storePath) ? readFileSync(storePath, "utf8") : "";
const keyPanel = existsSync(keyPanelPath) ? readFileSync(keyPanelPath, "utf8") : "";

function functionBody(name: string, nextMarker?: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return "";
  const end = nextMarker ? migration.indexOf(nextMarker, start) : migration.length;
  return migration.slice(start, end < 0 ? migration.length : end);
}

test("0055 forward, rollback, and runtime resolver files exist", () => {
  assert.ok(migration.length > 0, `${migrationPath} is missing`);
  assert.ok(rollback.length > 0, `${rollbackPath} is missing`);
  assert.ok(service.length > 0, `${servicePath} is missing`);
});

test("binding authority is normalized, complete, and tenant-key constrained", () => {
  const tables = [...migration.matchAll(/create table if not exists public\.(ai_[a-z_]+)/gi)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(tables, [
    "ai_provider_catalog",
    "ai_runtime_binding_receipts",
    "ai_runtime_binding_sets",
    "ai_runtime_bindings",
    "ai_runtime_model_evidence",
  ]);
  assert.match(migration, /unique \(binding_set_id, purpose\)/i);
  assert.match(
    migration,
    /foreign key \(api_key_id, workspace_id, credential_provider\)[\s\S]*?references public\.api_keys\(id, workspace_id, provider\)[\s\S]*?on delete restrict/i,
  );
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/i);
  assert.match(migration, /where status = 'active'/i);
  assert.match(migration, /reviewed_by[\s\S]*?reviewed_at[\s\S]*?reviewed_by <> proposed_by/i);
});

test("proposal and activation each require short-lived exact-model purpose evidence", () => {
  assert.match(migration, /create table if not exists public\.ai_runtime_model_evidence/i);
  assert.match(migration, /provider_model_capability_v1/i);
  assert.match(migration, /purpose in \('requisition_parse', 'sourcing'\)/i);
  assert.match(migration, /expires_at[\s\S]*?verified_at \+ interval '10 minutes'/i);
  assert.match(migration, /proposal_model_evidence_id uuid not null/i);
  assert.match(migration, /activation_model_evidence_id uuid/i);
  assert.match(migration, /record_ai_runtime_model_evidence/i);
  assert.match(migration, /auth\.role\(\)[\s\S]*?<> 'service_role'/i);
  const stage = functionBody(
    "stage_ai_runtime_binding_set",
    "create or replace function public.activate_ai_runtime_binding_set(",
  );
  assert.match(stage, /p_parse_model_evidence_id uuid/i);
  assert.match(stage, /p_sourcing_model_evidence_id uuid/i);
  assert.match(stage, /ai_runtime_model_evidence_matches\([\s\S]*?'requisition_parse'[\s\S]*?true/i);
  assert.match(stage, /ai_runtime_model_evidence_matches\([\s\S]*?'sourcing'[\s\S]*?true/i);
  const activation = functionBody(
    "activate_ai_runtime_binding_set",
    "create or replace function public.resolve_active_ai_runtime_binding(",
  );
  assert.match(activation, /p_parse_model_evidence_id uuid/i);
  assert.match(activation, /p_sourcing_model_evidence_id uuid/i);
  assert.match(activation, /activation_model_evidence_id/i);
  assert.match(activation, /ai_runtime_model_evidence_matches\([\s\S]*?true/i);
});

test("catalog fixes the six supported provider identities behind exact-model capability evidence", () => {
  for (const [slug, credential, parse, sourcing] of [
    ["anthropic", "Anthropic", "true", "true"],
    ["openai", "OpenAI", "true", "true"],
    ["groq", "Groq", "true", "true"],
    ["xai", "xAI", "true", "true"],
    ["mistral", "Mistral", "true", "true"],
    ["kimi", "Kimi (Moonshot)", "true", "true"],
  ]) {
    assert.match(
      migration,
      new RegExp(
        `\\('${slug}',\\s*'${credential.replace(/[()]/g, "\\$&")}',\\s*'[a-z0-9_]+'\\s*,\\s*${parse},\\s*${sourcing}`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(migration, /\('(?:apify|tavily|google|openrouter|local\/custom)'/i);
});

test("staging is admin-bound, idempotent, key-validating, and never activates", () => {
  const body = functionBody(
    "stage_ai_runtime_binding_set",
    "create or replace function public.activate_ai_runtime_binding_set(",
  );
  assert.match(body, /security definer/i);
  assert.match(body, /auth\.role\(\)[\s\S]*?<> 'authenticated'[\s\S]*?42501/i);
  assert.match(body, /caller_id uuid := auth\.uid\(\)/i);
  assert.match(body, /caller_workspace := public\.current_workspace_id\(\)/i);
  assert.match(body, /p_expected_workspace_id uuid/i);
  assert.match(body, /caller_workspace is distinct from p_expected_workspace_id[\s\S]*?workspace_conflict/i);
  assert.match(body, /from public\.profiles[\s\S]*?proposer\.id = caller_id[\s\S]*?proposer\.workspace_id = caller_workspace[\s\S]*?role = 'admin'/i);
  assert.doesNotMatch(body.slice(0, body.indexOf(") returns jsonb")), /p_proposer_id/i);
  assert.match(body, /aria\.ai-runtime-binding-workspace\.v1[\s\S]*?caller_workspace/i);
  assert.match(body, /status = 'staged'[\s\S]*?>= 99[\s\S]*?staged_limit_reached/i);
  assert.match(body, /public\.ai_execution_credential_verified\([\s\S]*?verification_method[\s\S]*?verification_http_status/i);
  assert.match(body, /credential_unavailable/i);
  assert.match(body, /idempotency_conflict/i);
  assert.match(body, /insert into public\.ai_runtime_binding_sets/i);
  assert.match(body, /insert into public\.ai_runtime_bindings/i);
  assert.match(body, /event_type[\s\S]*?'staged'/i);
  assert.doesNotMatch(body, /set status = 'active'/i);
});

test("activation enforces a distinct same-tenant administrator and revalidates keys", () => {
  const body = functionBody(
    "activate_ai_runtime_binding_set",
    "create or replace function public.resolve_active_ai_runtime_binding(",
  );
  assert.match(body, /security definer/i);
  assert.match(body, /auth\.role\(\)[\s\S]*?<> 'authenticated'/i);
  assert.match(body, /caller_id uuid := auth\.uid\(\)/i);
  assert.match(body, /caller_workspace := public\.current_workspace_id\(\)/i);
  assert.match(body, /p_expected_workspace_id uuid/i);
  assert.match(body, /caller_workspace is distinct from p_expected_workspace_id[\s\S]*?workspace_conflict/i);
  assert.match(body, /reviewer[\s\S]*?reviewer\.id = caller_id[\s\S]*?reviewer\.workspace_id = caller_workspace[\s\S]*?role = 'admin'/i);
  assert.match(body, /caller_id = target_set\.proposed_by[\s\S]*?independent_reviewer_required/i);
  assert.doesNotMatch(body.slice(0, body.indexOf(") returns jsonb")), /p_reviewer_id/i);
  assert.match(body, /aria\.ai-runtime-binding-workspace\.v1[\s\S]*?caller_workspace/i);
  assert.match(body, /public\.ai_execution_credential_verified\([\s\S]*?verification_method[\s\S]*?verification_http_status/i);
  assert.match(body, /credential_unavailable/i);
  assert.match(body, /idempotency_conflict/i);
  assert.match(body, /set status = 'superseded'/i);
  assert.match(body, /set status = 'active'/i);
  assert.match(body, /event_type[\s\S]*?'activated'/i);
  assert.match(body, /event_type[\s\S]*?'superseded'/i);
});

test("resolver returns active metadata only and fails closed on revoked credentials", () => {
  const body = functionBody(
    "resolve_active_ai_runtime_binding",
    "alter function public.stage_ai_runtime_binding_set(",
  );
  assert.match(body, /security definer/i);
  assert.match(body, /p_purpose not in \('requisition_parse', 'sourcing'\)/i);
  assert.match(body, /status = 'active'/i);
  assert.match(body, /public\.ai_execution_credential_verified\([\s\S]*?verification_method[\s\S]*?verification_http_status/i);
  assert.match(body, /credential_unavailable/i);
  assert.match(body, /'workspace_id', p_workspace_id/i);
  assert.match(body, /'api_key_id', requested_binding\.api_key_id/i);
  assert.doesNotMatch(body, /select[^;]*\bsecret\b/i);
  assert.doesNotMatch(body, /jsonb_build_object\([\s\S]*?'secret'/i);
  assert.doesNotMatch(body, /last4/i);
});

test("receipts and configuration identity are immutable and contain no secret material", () => {
  assert.match(migration, /receipt_sha256 text not null/i);
  assert.match(migration, /aria\.ai-runtime-binding-receipt\.v1/i);
  assert.match(migration, /before update or delete on public\.ai_runtime_binding_receipts/i);
  assert.match(migration, /before update or delete on public\.ai_runtime_bindings/i);
  assert.match(migration, /before update or delete on public\.ai_runtime_binding_sets/i);
  const hashInputs = [...migration.matchAll(/sha256\(convert_to\(([\s\S]*?),\s*'UTF8'\)\)/gi)]
    .map((match) => match[1])
    .join("\n");
  assert.doesNotMatch(hashInputs, /\bsecret\b|last4|prompt|response_body|workspace_state/i);
});

test("bound credential material is append-only and only verified service checks can restore validity", () => {
  const body = functionBody(
    "enforce_ai_bound_credential_lifecycle",
    "alter function public.reject_ai_provider_catalog_mutation()",
  );
  assert.match(body, /returns trigger/i);
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = pg_catalog, public, auth, pg_temp/i);
  assert.match(body, /old\.id[\s\S]*?old\.workspace_id[\s\S]*?old\.provider[\s\S]*?old\.secret[\s\S]*?old\.last4/i);
  assert.match(body, /credential identity is immutable/i);
  assert.match(body, /new\.status in \('invalid', 'untested'\)/i);
  assert.match(body, /public\.ai_execution_credential_verified\(/i);
  assert.match(body, /only the verified key-test workflow may write provider evidence/i);
  assert.match(body, /auth\.role\(\)[\s\S]*?= 'service_role'/i);
  assert.match(body, /new\.last_tested_at is not null/i);
  assert.match(migration, /before insert or update on public\.api_keys/i);
  assert.match(
    rollback,
    /drop trigger if exists ai_bound_credential_enforce_lifecycle on public\.api_keys/i,
  );
  assert.match(
    rollback,
    /drop function if exists public\.enforce_ai_bound_credential_lifecycle\(\)/i,
  );
  assert.match(
    rollback,
    /drop function if exists public\.ai_execution_credential_verified\(text, text, timestamptz, text, integer\)/i,
  );
  assert.match(rollback, /drop column if exists verification_http_status/i);
  assert.match(rollback, /drop column if exists verification_method/i);
});

test("verified key testing fails explicitly when credential status evidence cannot persist", () => {
  assert.match(keyTestRoute, /verifyExecutionCredential/i);
  assert.match(keyTestRoute, /verification_method/i);
  assert.match(keyTestRoute, /verification_http_status/i);
  assert.match(migration, /verification_method/i);
  assert.match(migration, /provider_models_list_v1/i);
  assert.match(migration, /tavily_usage_v1/i);
  assert.match(migration, /tavily_key_info_v1/i);
  assert.match(migration, /ai_execution_credential_verified/i);
  assert.match(migration, /ai_execution_credential_verified[\s\S]*?select coalesce\([\s\S]*?false/i);
  assert.match(keyTestRoute, /const \{ error: statusUpdateError \} = await svc/i);
  assert.match(keyTestRoute, /if \(statusUpdateError\)/i);
  assert.match(keyTestRoute, /could not persist API key test evidence/i);
  assert.match(keyTestRoute, /status:\s*503/i);
  assert.match(store, /if \(!json\.ok\)[\s\S]*?status: k\?\.status \?\? "untested"/i);
  assert.match(keyPanel, /Credential test could not complete/i);
  assert.match(keyPanel, />\s*Test key\s*</i);
  assert.doesNotMatch(keyPanel, />\s*Format check\s*</i);
});

test("all authority tables force RLS and API roles get RPC-only access", () => {
  for (const table of [
    "ai_provider_catalog",
    "ai_runtime_binding_sets",
    "ai_runtime_model_evidence",
    "ai_runtime_bindings",
    "ai_runtime_binding_receipts",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
    assert.match(
      migration,
      new RegExp(
        `revoke all on public\\.${table}\\s+from public, anon, authenticated, service_role, authenticator`,
        "i",
      ),
    );
  }
  for (const signature of [
    "stage_ai_runtime_binding_set\\(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid\\)",
    "activate_ai_runtime_binding_set\\(uuid, uuid, uuid, uuid, uuid\\)",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?grant execute on function public\\.${signature} to authenticated`, "i"),
    );
  }
  assert.match(
    migration,
    /revoke all on function public\.resolve_active_ai_runtime_binding\(uuid, text\)[\s\S]*?grant execute on function public\.resolve_active_ai_runtime_binding\(uuid, text\) to service_role/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.record_ai_runtime_model_evidence\(uuid, uuid, text, text, text\)[\s\S]*?grant execute on function public\.record_ai_runtime_model_evidence\(uuid, uuid, text, text, text\) to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.(?:stage|activate)_ai_runtime_binding_set\([^;]+\) to service_role/i,
  );
});

test("rollback is quiesced, data-guarded, and removes only 0055 objects", () => {
  assert.match(rollback, /pg_advisory_xact_lock\(/i);
  assert.match(rollback, /refus|contains rows|non-empty/i);
  assert.match(rollback, /ai_runtime_binding_receipts in access exclusive mode/i);
  assert.match(rollback, /drop function if exists public\.activate_ai_runtime_binding_set/i);
  assert.match(rollback, /drop table if exists public\.ai_runtime_binding_receipts/i);
  assert.match(rollback, /drop table if exists public\.ai_runtime_bindings/i);
  assert.match(rollback, /drop table if exists public\.ai_runtime_model_evidence/i);
  assert.match(rollback, /drop table if exists public\.ai_runtime_binding_sets/i);
  assert.match(rollback, /drop table if exists public\.ai_provider_catalog/i);
  assert.doesNotMatch(rollback, /drop table[^;]*(?:api_keys|workspace_state|requisitions|sourcing_campaigns)/i);
});

test("runtime service validates the SQL response before exposing binding metadata", () => {
  assert.match(service, /\.strict\(\)/i);
  assert.match(service, /data\.workspace_id !== workspaceId/i);
  assert.match(service, /data\.purpose !== purpose/i);
  assert.match(service, /resolve_active_ai_runtime_binding/i);
  assert.doesNotMatch(service, /decryptSecret|\.select\([^)]*secret|console\./i);
});
