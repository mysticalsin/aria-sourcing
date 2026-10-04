import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
}

const migrationPath = new URL(
  "../supabase/migrations/0027_sourcing_learning_authority.sql",
  import.meta.url,
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

ok("migration 0027 exists", migration.length > 0);

for (const table of [
  "sourcing_learning_secrets",
  "sourcing_learning_controls",
  "sourcing_runs",
  "sourcing_run_quota",
  "sourcing_query_receipts",
  "sourcing_query_feedback",
  "sourcing_graphify_exports",
  "sourcing_lessons",
  "sourcing_lesson_evidence",
  "sourcing_lesson_reviews",
]) {
  ok(`${table} exists`, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, "i").test(migration));
  ok(`${table} enables and forces RLS`,
    new RegExp(`alter table public\\.${table} enable row level security`, "i").test(migration) &&
    new RegExp(`alter table public\\.${table} force row level security`, "i").test(migration));
  ok(`${table} revokes direct API-role access`,
    new RegExp(`revoke all on public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role, authenticator`, "i").test(migration));
}

const runTable = migration.match(
  /create table if not exists public\.sourcing_runs\s*\(([\s\S]*?)\n\);/i,
)?.[1] ?? "";
const receiptTable = migration.match(
  /create table if not exists public\.sourcing_query_receipts\s*\(([\s\S]*?)\n\);/i,
)?.[1] ?? "";
const lessonTable = migration.match(
  /create table if not exists public\.sourcing_lessons\s*\(([\s\S]*?)\n\);/i,
)?.[1] ?? "";
const evidenceTable = migration.match(
  /create table if not exists public\.sourcing_lesson_evidence\s*\(([\s\S]*?)\n\);/i,
)?.[1] ?? "";
const authorityTables = `${runTable}\n${receiptTable}\n${lessonTable}\n${evidenceTable}`;

ok("run authority stores HMAC bindings instead of raw campaign or role JSON",
  /campaign_hmac\s+text\s+not null/i.test(runTable) &&
  /role_fingerprint\s+text\s+not null/i.test(runTable) &&
  !/\bcampaign_id\s+text/i.test(runTable) &&
  !/\brole_(?:basis|brief|json)\s+jsonb/i.test(runTable));
ok("lesson authority contains no candidate identity fields",
  !/\bcandidate_id\b|\bcandidate_email\b|\bprofile_(?:id|url|handle)\b|\blinkedin_url\b/i.test(authorityTables));
ok("query receipts are aggregate-only",
  /candidate_count\s+integer\s+not null/i.test(receiptTable) &&
  /skipped_count\s+integer\s+not null/i.test(receiptTable) &&
  !/\bresults?\s+jsonb\b|\bprofiles?\s+jsonb\b/i.test(receiptTable));
ok("role and query fingerprints use a workspace HMAC secret",
  /hmac\([\s\S]*hmac_key[\s\S]*'sha256'/i.test(migration) &&
  /gen_random_bytes\(32\)/i.test(migration));
ok("role basis is canonicalized and has an exact allowlist",
  /canonicalize_sourcing_role_basis/i.test(migration) &&
  /role basis contains unsupported fields/i.test(migration) &&
  /jsonb_agg\([\s\S]*order by/i.test(migration));
ok("stored query text rejects PII-shaped and prompt-injection content",
  /unsafe sourcing query/i.test(migration) &&
  /ignore previous|system prompt|@|https/i.test(migration));

for (const fn of [
  "begin_sourcing_run",
  "complete_sourcing_run",
  "fail_sourcing_run",
  "record_sourcing_query_feedback",
  "list_pending_sourcing_feedback",
  "export_graphify_sourcing_lessons",
  "complete_graphify_sourcing_export",
  "attach_graphify_sourcing_lesson",
  "review_sourcing_lesson",
  "list_promoted_sourcing_lessons",
  "configure_sourcing_learning",
  "cleanup_sourcing_learning_authority",
]) {
  const body = migration.match(
    new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\n\\$\\$;`, "i"),
  )?.[0] ?? "";
  ok(`${fn} is security definer with a fixed search_path`,
    /security definer/i.test(body) &&
    /set search_path = pg_catalog, public, extensions, pg_temp/i.test(body));
  ok(`${fn} asserts service_role in its body`, /auth\.role\(\)[\s\S]*service_role/i.test(body));
  ok(`${fn} revokes then grants only service_role execution`,
    new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated, service_role, authenticator`, "i").test(migration) &&
    new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, "i").test(migration));
}

const begin = migration.match(
  /create or replace function public\.begin_sourcing_run[\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
ok("run begin checks idempotency before consuming serialized quota",
  begin.indexOf("idempotency_key = p_idempotency_key") > 0 &&
  begin.indexOf("idempotency_key = p_idempotency_key") < begin.indexOf("insert into public.sourcing_run_quota") &&
  /for update/i.test(begin));
ok("run begin applies per-workspace and per-user daily limits", /workspace_daily_limit/i.test(begin) && /user_daily_limit/i.test(begin));

const review = migration.match(
  /create or replace function public\.review_sourcing_lesson[\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
ok("promotion requires admin human review and optimistic concurrency",
  /role = 'admin'/i.test(review) && /p_expected_version/i.test(review));
ok("promotion requires independent evidence and reviewer separation",
  /min_evidence_runs/i.test(review) && /campaign_count/i.test(review) &&
  /feedback\.actor_id = p_reviewer_id/i.test(review) && /run\.actor_id = p_reviewer_id/i.test(review));
ok("promotion requires a pinned Graphify artifact but Graphify cannot change status",
  /graphify_artifact_sha256/i.test(review) && /required_graphify_commit/i.test(review) &&
  /sourcing_graphify_exports/i.test(review) &&
  !/update public\.sourcing_lessons[\s\S]*status\s*=/i.test(
    migration.match(/create or replace function public\.attach_graphify_sourcing_lesson[\s\S]*?\n\$\$;/i)?.[0] ?? "",
  ));
const completeArtifact = migration.match(
  /create or replace function public\.complete_graphify_sourcing_export[\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
ok("Graphify artifacts are digest-verified, image-bound, and stored before attachment",
  /digest\(convert_to\(p_graph_text/i.test(completeArtifact) &&
  /required_graphify_image_digest/i.test(completeArtifact) &&
  /graph_text = p_graph_text/i.test(completeArtifact) &&
  /manifest = p_manifest/i.test(completeArtifact));
ok("Graphify feedback counts are independent from candidate result counts",
  !/evidence\.reviewed_count\s*<=\s*evidence\.result_count/i.test(migration));
ok("runtime lesson ordering consumes Graphify communities for strategy diversity",
  /partition by lesson\.graphify_cluster_ref/i.test(migration) &&
  /'graphifyClusterRef',\s*candidate\.graphify_cluster_ref/i.test(migration));
ok("Graphify export matches the redacted worker schema and omits raw query text",
  /'schemaVersion',\s*1/i.test(migration) &&
  /'workspaceFingerprint',\s*workspace_fingerprint/i.test(migration) &&
  /'authorityVersion',\s*lesson\.version/i.test(migration) &&
  /'queryFingerprint',\s*lesson\.query_hmac/i.test(migration) &&
  /'sourcePlatform',\s*lower\(replace\(lesson\.platform/i.test(migration) &&
  !/'query',\s*lesson\.query_text/i.test(
    migration.match(/create or replace function public\.export_graphify_sourcing_lessons[\s\S]*?\n\$\$;/i)?.[0] ?? "",
  ));
ok("kill switch disables retrieval and suspends promoted lessons",
  /configure_sourcing_learning[\s\S]*not p_enabled[\s\S]*status = 'suspended'/i.test(migration) &&
  /list_promoted_sourcing_lessons[\s\S]*control\.enabled/i.test(migration));
ok("retention is bounded and cleanup cannot remove active promoted evidence",
  /interval '90 days'/i.test(migration) &&
  /cleanup_sourcing_learning_authority/i.test(migration) &&
  /not exists[\s\S]*status = 'promoted'/i.test(migration));
ok("lesson review history is append-only", /sourcing_lesson_reviews_append_only/i.test(migration));

console.log(`RESULT sourcing-learning-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
