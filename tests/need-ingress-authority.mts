import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/0049_need_ingress_authority.sql";
const credentialMigrationPath = "supabase/migrations/0056_need_ingress_credential_authority.sql";
const credentialRollbackPath = "supabase/rollbacks/0056_need_ingress_credential_authority.sql";
const routePath = "src/app/api/webhooks/needs/route.ts";
const servicePath = "src/lib/needs/ingress.ts";
const readinessRoutePath = "src/app/api/ready/route.ts";
const productionEnvironmentPath = ".env.production.example";
const flyAppPath = "fly.app.toml";
const operationsPath = "docs/operations/NEED_INGRESS.md";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const credentialMigration = existsSync(credentialMigrationPath)
  ? readFileSync(credentialMigrationPath, "utf8")
  : "";
const credentialRollback = existsSync(credentialRollbackPath)
  ? readFileSync(credentialRollbackPath, "utf8")
  : "";
const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const service = existsSync(servicePath) ? readFileSync(servicePath, "utf8") : "";
const readinessRoute = existsSync(readinessRoutePath)
  ? readFileSync(readinessRoutePath, "utf8")
  : "";
const productionEnvironment = existsSync(productionEnvironmentPath)
  ? readFileSync(productionEnvironmentPath, "utf8")
  : "";
const flyApp = existsSync(flyAppPath) ? readFileSync(flyAppPath, "utf8") : "";
const operations = existsSync(operationsPath) ? readFileSync(operationsPath, "utf8") : "";

function section(source: string, start: string, end?: string): string {
  const startAt = source.indexOf(start);
  if (startAt < 0) return "";
  const endAt = end ? source.indexOf(end, startAt + start.length) : source.length;
  return source.slice(startAt, endAt < 0 ? source.length : endAt);
}

test("migration creates a private, tenant-bound requisition input store", () => {
  assert.ok(migration.length > 0);
  assert.match(migration, /create table if not exists public\.requisition_inputs/i);
  assert.match(migration, /foreign key \(workspace_id, requisition_id\)[\s\S]*?references public\.requisitions \(workspace_id, id\)/i);
  assert.match(migration, /alter table public\.requisition_inputs force row level security/i);
  assert.match(
    migration,
    /revoke all on public\.requisition_inputs\s+from public, anon, authenticated, service_role, authenticator/i,
  );
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on public\.requisition_inputs/i);
});

test("atomic ingress is service-only, control-gated, and serializes the idempotency key", () => {
  const rpc = section(
    migration,
    "create or replace function public.ingest_requisition_and_enqueue(",
    "revoke all on function public.ingest_requisition_and_enqueue",
  );
  assert.match(rpc, /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?42501/i);
  assert.match(rpc, /pg_advisory_xact_lock/i);
  assert.match(rpc, /from public\.sourcing_loop_controls[\s\S]*?for share/i);
  assert.match(rpc, /kill_switch[\s\S]*?intake_enabled[\s\S]*?'intake_disabled'/i);
  assert.match(rpc, /char_length\(p_need_content\) not between 20 and 100000/i);
  assert.match(rpc, /p_content_type not in \('text\/plain', 'text\/markdown', 'application\/json'\)/i);
  assert.match(rpc, /p_need_content is json object/i);
});

test("one transaction persists the need and enqueues exactly one parse job", () => {
  const rpc = section(
    migration,
    "create or replace function public.ingest_requisition_and_enqueue(",
    "revoke all on function public.ingest_requisition_and_enqueue",
  );
  assert.match(rpc, /insert into public\.requisitions/i);
  assert.match(rpc, /insert into public\.requisition_inputs/i);
  assert.match(rpc, /public\.enqueue_aria_job\([\s\S]*?'requisition_parse'/i);
  assert.match(rpc, /jsonb_build_object\('requisition_id', requisition_id::text\)/i);
  assert.match(rpc, /if enqueue_result->>'status' <> 'enqueued' then[\s\S]*?raise exception/i);
  assert.doesNotMatch(rpc, /exception when others/i);
});

test("exact retries return the original rows and changed material conflicts", () => {
  const rpc = section(
    migration,
    "create or replace function public.ingest_requisition_and_enqueue(",
    "revoke all on function public.ingest_requisition_and_enqueue",
  );
  assert.match(rpc, /need_sha256[\s\S]*?is distinct from request_hash[\s\S]*?'idempotency_conflict'/i);
  assert.match(rpc, /from public\.aria_jobs[\s\S]*?kind = 'requisition_parse'/i);
  assert.match(rpc, /'status', 'accepted'[\s\S]*?'replay', true/i);
  assert.match(rpc, /'status', 'inconsistent_state'/i);
});

test("the parse worker can retrieve only the workspace-bound, service-scoped input", () => {
  const rpc = section(
    migration,
    "create or replace function public.get_requisition_input(",
    "revoke all on function public.get_requisition_input",
  );
  assert.match(rpc, /auth\.role\(\)[\s\S]*?<> 'service_role'/i);
  assert.match(rpc, /p_workspace_id uuid,\s*\n\s*p_requisition_id uuid/i);
  assert.match(rpc, /where input\.requisition_id = p_requisition_id\s*\n\s*and input\.workspace_id = p_workspace_id/i);
  assert.match(
    migration,
    /grant execute on function public\.get_requisition_input\(uuid, uuid\) to service_role;/i,
  );
});

test("credential authority stores only digests and keeps lifecycle evidence immutable", () => {
  assert.ok(credentialMigration.length > 0);
  assert.match(credentialMigration, /create table if not exists public\.need_ingress_credentials/i);
  assert.match(credentialMigration, /key_sha256 text not null/i);
  assert.match(credentialMigration, /expires_at timestamptz not null/i);
  assert.match(credentialMigration, /label text not null/i);
  assert.match(credentialMigration, /status in \('active', 'revoked'\)/i);
  assert.match(credentialMigration, /create table if not exists public\.need_ingress_credential_receipts/i);
  assert.match(credentialMigration, /receipts are append-only/i);
  assert.match(credentialMigration, /alter table public\.need_ingress_credentials force row level security/i);
  assert.match(credentialMigration, /revoke all on public\.need_ingress_credentials[\s\S]*?authenticated, service_role/i);
  assert.doesNotMatch(credentialMigration, /raw_key|secret_value|credential_value/i);
});

test("only tenant administrators can create or revoke credentials", () => {
  const createCredential = section(
    credentialMigration,
    "create or replace function public.create_need_ingress_credential(",
    "create or replace function public.revoke_need_ingress_credential(",
  );
  const revokeCredential = section(
    credentialMigration,
    "create or replace function public.revoke_need_ingress_credential(",
    "create or replace function public.resolve_need_ingress_credential(",
  );
  for (const rpc of [createCredential, revokeCredential]) {
    assert.match(rpc, /auth\.role\(\)[\s\S]*?'authenticated'/i);
    assert.match(rpc, /public\.current_workspace_id\(\)/i);
    assert.match(rpc, /p_expected_workspace_id uuid/i);
    assert.match(rpc, /caller_workspace is distinct from p_expected_workspace_id[\s\S]*?workspace_conflict/i);
    assert.match(rpc, /profile\.workspace_id = caller_workspace/i);
    assert.match(rpc, /profile\.id = caller_id/i);
    assert.match(rpc, /profile\.role = 'admin'/i);
    assert.match(rpc, /pg_advisory_xact_lock/i);
    assert.match(rpc, /aria\.need-ingress-workspace\.v1[\s\S]*?caller_workspace/i);
  }
  assert.match(createCredential, /p_expires_at > clock_timestamp\(\) \+ interval '90 days'/i);
  assert.match(createCredential, /request_sha256[\s\S]*?idempotency_conflict/i);
  assert.match(createCredential, /expires_at > clock_timestamp\(\)[\s\S]*?>= 100[\s\S]*?active_limit_reached/i);
  assert.match(revokeCredential, /credential\.workspace_id = caller_workspace[\s\S]*?for update/i);
  assert.match(
    credentialMigration,
    /grant execute on function public\.create_need_ingress_credential\(text, text, timestamptz, uuid, uuid\)[\s\S]*?to authenticated/i,
  );
  assert.match(
    credentialMigration,
    /grant execute on function public\.revoke_need_ingress_credential\(uuid, uuid, uuid\)[\s\S]*?to authenticated/i,
  );
});

test("service resolution returns tenant identity and atomic ingest revalidates it", () => {
  const resolver = section(
    credentialMigration,
    "create or replace function public.resolve_need_ingress_credential(",
    "create or replace function public.ingest_requisition_with_credential(",
  );
  const credentialIngest = section(
    credentialMigration,
    "create or replace function public.ingest_requisition_with_credential(",
    "alter function public.create_need_ingress_credential",
  );
  assert.match(resolver, /auth\.role\(\)[\s\S]*?<> 'service_role'/i);
  assert.match(resolver, /credential\.key_sha256 = p_key_sha256/i);
  assert.match(resolver, /credential\.status = 'active'/i);
  assert.match(resolver, /credential\.expires_at > clock_timestamp\(\)/i);
  assert.match(resolver, /'credential_id', credential_row\.id[\s\S]*?'workspace_id', credential_row\.workspace_id/i);
  assert.match(credentialIngest, /where credential\.id = p_credential_id[\s\S]*?for update/i);
  assert.match(credentialIngest, /credential_row\.key_sha256 is distinct from p_key_sha256/i);
  assert.match(credentialIngest, /credential_row\.expires_at <= clock_timestamp\(\)/i);
  assert.match(credentialIngest, /credential_row\.workspace_id[\s\S]*?derived_source_ref/i);
  assert.match(
    credentialMigration,
    /revoke execute on function public\.ingest_requisition_and_enqueue\(uuid, text, text, text\)[\s\S]*?from service_role/i,
  );
});

test("rollback refuses to delete issued credential or receipt evidence", () => {
  assert.ok(credentialRollback.length > 0);
  assert.match(credentialRollback, /pg_advisory_xact_lock\(560056202607210056::bigint\)/i);
  assert.match(credentialRollback, /exists \(select 1 from public\.need_ingress_credential_receipts\)/i);
  assert.match(credentialRollback, /exists \(select 1 from public\.need_ingress_credentials\)/i);
  assert.match(credentialRollback, /refusing 0056 rollback/i);
});

test("the route is a thin server-only adapter and exposes no outbound-send path", () => {
  assert.ok(route.length > 0);
  assert.match(route, /handleNeedIngressRequest/i);
  assert.match(route, /getServiceSupabase/i);
  assert.match(route, /needIngressSharedThrottleConfigured/i);
  assert.doesNotMatch(route, /ARIA_NEED_INGRESS_HMAC_SECRET/i);
  assert.doesNotMatch(`${route}\n${service}`, /dispatchDue|performEmailSend|messages_outbound|outreach\/send/i);
  assert.match(service, /readBoundedBody/i);
  assert.match(service, /timingSafeEqual/i);
  assert.match(service, /x-aria-need-key/i);
  assert.match(service, /x-aria-need-timestamp/i);
  assert.match(service, /idempotency-key/i);
  assert.match(service, /rpc\("resolve_need_ingress_credential"/i);
  assert.match(service, /rpc\("ingest_requisition_with_credential"/i);
  assert.doesNotMatch(service, /workspaceId|p_workspace_id/i);
});

test("public need ingress is locally throttled before database access and production readiness requires shared protection", () => {
  const handler = section(service, "export async function handleNeedIngressRequest(");
  assert.match(service, /checkNeedIngressPreAuthThrottle/i);
  assert.match(service, /rateLimitKey\(req,\s*"need-ingress-preauth"\)/i);
  assert.match(service, /Cache-Control["']?:\s*["']no-store/i);
  assert.match(
    handler,
    /checkPreAuthThrottle[\s\S]*?if \(!preAuthThrottle\.ok\)[\s\S]*?dependencies\.getServiceClient\(\)/i,
  );
  assert.match(service, /ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED/i);
  assert.match(service, /ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256/i);
  assert.match(readinessRoute, /needIngressSharedThrottleConfigured/i);
  assert.match(productionEnvironment, /ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED=false/i);
  assert.match(flyApp, /ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED\s*=\s*"false"/i);
  assert.match(flyApp, /ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256\s*=\s*""/i);
  assert.match(operations, /per-process/i);
  assert.match(operations, /every public origin/i);
  assert.match(operations, /two web machines/i);
  assert.match(operations, /Retry-After/i);
  assert.match(operations, /HMAC/i);
  assert.match(operations, /evidence digest/i);
});
