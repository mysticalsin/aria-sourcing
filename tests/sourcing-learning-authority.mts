import { loadBaselineSchema } from "./lib/baseline-schema.mts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
}

// Sourcing-learning authority as it exists in the squashed baseline schema.
const schema = loadBaselineSchema();
const migration = schema.source;
const tableBody = (name: string) => schema.table(name).match(/\(([\s\S]*)\n\);/)?.[1] ?? "";

ok("baseline schema is present", migration.length > 0);

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
  ok(`${table} exists`, schema.table(table).length > 0);
  ok(`${table} enables and forces RLS`, schema.rls(table).enabled && schema.rls(table).forced);
  ok(`${table} has no direct API-role access`, Object.keys(schema.tableGrants(table)).length === 0);
}

const runTable = tableBody("sourcing_runs");
const receiptTable = tableBody("sourcing_query_receipts");
const lessonTable = tableBody("sourcing_lessons");
const evidenceTable = tableBody("sourcing_lesson_evidence");
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
  "review_sourcing_lesson",
  "list_promoted_sourcing_lessons",
  "configure_sourcing_learning",
  "cleanup_sourcing_learning_authority",
]) {
  const body = schema.fn(fn);
  ok(`${fn} is security definer with a fixed search_path`,
    /security definer/i.test(body) &&
    /SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'/.test(body));
  ok(`${fn} asserts service_role in its body`, /auth\.role\(\)[\s\S]*service_role/i.test(body));
  ok(`${fn} grants execution to service_role only`,
    JSON.stringify(schema.functionGrantees(fn)) === JSON.stringify(["service_role"]));
}

const begin = schema.fn("begin_sourcing_run");
ok("run begin checks idempotency before consuming serialized quota",
  begin.indexOf("idempotency_key = p_idempotency_key") > 0 &&
  begin.indexOf("idempotency_key = p_idempotency_key") < begin.indexOf("insert into public.sourcing_run_quota") &&
  /for update/i.test(begin));
ok("run begin applies per-workspace and per-user daily limits", /workspace_daily_limit/i.test(begin) && /user_daily_limit/i.test(begin));

const review = schema.fn("review_sourcing_lesson");
ok("promotion requires admin human review and optimistic concurrency",
  /role = 'admin'/i.test(review) && /p_expected_version/i.test(review));
ok("promotion requires independent evidence and reviewer separation",
  /min_evidence_runs/i.test(review) && /campaign_count/i.test(review) &&
  /feedback\.actor_id = p_reviewer_id/i.test(review) && /run\.actor_id = p_reviewer_id/i.test(review));
ok("promotion requires a pinned Graphify artifact",
  /graphify_artifact_sha256/i.test(review) && /required_graphify_commit/i.test(review) &&
  /sourcing_graphify_exports/i.test(review));
ok("Graphify feedback counts are independent from candidate result counts",
  !/evidence\.reviewed_count\s*<=\s*evidence\.result_count/i.test(migration));
ok("runtime lesson ordering consumes Graphify communities for strategy diversity",
  /partition by lesson\.graphify_cluster_ref/i.test(migration) &&
  /'graphifyClusterRef',\s*candidate\.graphify_cluster_ref/i.test(migration));
ok("kill switch disables retrieval and suspends promoted lessons",
  /configure_sourcing_learning[\s\S]*not p_enabled[\s\S]*status = 'suspended'/i.test(migration) &&
  /list_promoted_sourcing_lessons[\s\S]*control\.enabled/i.test(migration));
ok("retention is bounded and cleanup cannot remove active promoted evidence",
  /interval '90 days'/i.test(migration) &&
  /cleanup_sourcing_learning_authority/i.test(migration) &&
  /not exists[\s\S]*status = 'promoted'/i.test(migration));
ok("lesson review history is append-only",
  /CREATE TRIGGER sourcing_lesson_reviews_append_only BEFORE DELETE OR UPDATE ON public\.sourcing_lesson_reviews/i.test(migration));

console.log(`RESULT sourcing-learning-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
