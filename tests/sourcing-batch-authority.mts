import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/0054_sourcing_batch_authority.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollbacks/0054_sourcing_batch_authority.sql", import.meta.url),
  "utf8",
);

const authorityTables = [
  "sourcing_batch_claims",
  "sourcing_batch_egress_attempts",
  "sourcing_batch_source_receipts",
  "sourcing_candidate_evidence",
  "sourcing_batch_receipts",
  "sourcing_provider_quota_ledger",
];

const serviceFunctions = [
  "claim_due_sourcing_batch_jobs",
  "authorize_sourcing_batch",
  "begin_sourcing_batch_egress",
  "commit_sourcing_batch",
  "fail_sourcing_batch_egress",
  "record_sourcing_loop_heartbeat",
  "get_sourcing_loop_readiness",
];

test("0054 owns every durable sourcing-batch authority surface", () => {
  for (const table of authorityTables) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), table);
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"), table);
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"), table);
    assert.match(
      migration,
      new RegExp(`revoke all on public\\.${table}[\\s\\S]{0,180}service_role`, "i"),
      table,
    );
  }
});

test("only service_role can execute the bounded worker and readiness RPCs", () => {
  for (const name of serviceFunctions) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,500}?grant execute on function public\\.${name}\\([\\s\\S]{0,500}?to service_role`, "i"),
      name,
    );
  }
  assert.doesNotMatch(migration, /grant execute on function public\.(?:authorize_sourcing_batch|begin_sourcing_batch_egress|commit_sourcing_batch|fail_sourcing_batch_egress|get_sourcing_loop_readiness)\([^;]+\)\s+to authenticated/i);
});

test("the authority binds tenant, campaign, lease, claim, fence, attempt, and result", () => {
  for (const token of [
    "p_workspace_id",
    "p_campaign_id",
    "p_campaign_sha256",
    "p_batch_ordinal",
    "p_lease_id",
    "p_claim_token",
    "p_fence_version",
    "p_egress_attempt_id",
    "p_result_sha256",
  ]) {
    assert.match(migration, new RegExp(`\\b${token}\\b`), token);
  }
  assert.match(migration, /for update/i);
  assert.match(migration, /clock_timestamp\(\)/i);
  assert.match(migration, /already_begun/i);
  assert.match(migration, /no_op_replay/i);
  assert.match(migration, /replay_conflict/i);
});

test("GitHub provider mode is authority-bound without storing provider credentials", () => {
  assert.match(migration, /provider_mode\s+text\s+not null\s+check\s*\(provider_mode in \('anonymous', 'authenticated'\)\)/i);
  assert.match(migration, /p_provider_mode\s+text/i);
  assert.match(migration, /receipt\s*->>\s*'providerMode'\s*<>\s*p_provider_mode/i);
  assert.match(migration, /'\,"providerMode":'\s*\|\|\s*to_json\(p_provider_mode\)/i);
  assert.match(migration, /provider_mode, canonical_query_sha256, canonical_query/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /global_search_minute/i);
  assert.match(migration, /global_core_hour/i);
  assert.match(migration, /workspace_batch_day/i);
  assert.match(migration, /case\s+when p_provider_mode = 'anonymous' then 8 else 20 end/i);
  assert.match(migration, /case\s+when p_provider_mode = 'anonymous' then 48 else 300 end/i);
  assert.match(migration, /quota_exceeded/i);
  assert.doesNotMatch(migration, /github[_ ]token/i);
});

test("sourcing claims are tenant-fair and hard capped before parallel egress", () => {
  const claim = migration.match(
    /create or replace function public\.claim_due_sourcing_batch_jobs[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  assert.match(claim, /p_limit\s+not between 1 and 3/i);
  assert.match(claim, /row_number\(\) over\s*\(\s*partition by due\.workspace_id/i);
  assert.match(claim, /order by ranked\.workspace_rank/i);
  assert.match(claim, /for update[^;]+skip locked/i);
  assert.doesNotMatch(claim, /p_kinds/i);
});

test("server-owned policy bounds candidate collection and binds each ordinal to language plus page", () => {
  assert.match(migration, /create or replace function public\.sourcing_candidate_target\(\)/i);
  assert.match(migration, /select\s+9\s*;/i);
  assert.match(migration, /create or replace function public\.sourcing_max_batch_ordinal\(\)/i);
  assert.match(migration, /select\s+4\s*;/i);
  assert.match(
    migration,
    /sourcing_batch_expected_query\(\s*p_role_basis jsonb,\s*p_batch_ordinal integer\s*\)/i,
  );
  assert.match(migration, /github-deterministic-v2/i);
  assert.match(migration, /providerPage/);
  assert.match(migration, /p_batch_ordinal\s*\/\s*array_length\(supported_languages/i);
  assert.match(migration, /p_batch_ordinal\s*%\s*array_length\(supported_languages/i);
  assert.doesNotMatch(migration, /p_batch_ordinal is distinct from 0/i);
});

test("Graphify can reorder only the finite server-derived query variants", () => {
  const helper = migration.match(
    /create or replace function public\.sourcing_batch_query_is_allowed[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const authorize = migration.match(
    /create or replace function public\.authorize_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(helper, /0\.\.public\.sourcing_max_batch_ordinal\(\)/i);
  assert.match(helper, /candidate_query\s*->>\s*'page'\s*=\s*default_query\s*->>\s*'page'/i);
  assert.match(helper, /candidate_query\s*=\s*p_query/i);
  assert.match(authorize, /candidate\.canonical_query\s*->>\s*'page'\s*=\s*expected_query\s*->>\s*'page'/i);
  assert.match(authorize, /lesson\.query_text\s*=\s*candidate\.canonical_query\s*->>\s*'value'/i);
  assert.match(authorize, /prior_claim\.canonical_query\s*=\s*candidate\.canonical_query/i);
  assert.ok(
    (migration.match(/sourcing_batch_query_is_allowed\(/gi) ?? []).length >= 5,
    "every post-claim authority boundary must revalidate the selected query",
  );
});

test("only an exact current human-promoted Graphify lesson can be snapshotted", () => {
  const authorize = migration.match(
    /create or replace function public\.authorize_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(
    migration,
    /create or replace function public\.sourcing_batch_lesson_snapshot_sha256\(\s*p_snapshot jsonb\s*\)/i,
  );
  assert.match(migration, /canonical_query jsonb not null check/i);
  assert.match(migration, /applied_lesson jsonb check/i);
  assert.match(migration, /applied_lesson\s*->>\s*'snapshot_sha256'[\s\S]{0,120}sourcing_batch_lesson_snapshot_sha256\(applied_lesson\)/i);

  for (const requirement of [
    /control\.workspace_id = p_workspace_id[\s\S]{0,120}control\.enabled/i,
    /artifact\.workspace_id = lesson\.workspace_id/i,
    /artifact\.status = 'completed'/i,
    /artifact\.graph_sha256 = lesson\.graphify_artifact_sha256/i,
    /artifact\.graphify_commit = learning_control_row\.required_graphify_commit/i,
    /artifact\.image_digest = learning_control_row\.required_graphify_image_digest/i,
    /artifact\.expires_at > wall_now/i,
    /review\.reviewer_kind = 'human'/i,
    /review\.new_status = 'promoted'/i,
    /review\.reason_code = 'reviewed_useful'/i,
    /review\.lesson_version = lesson\.version/i,
    /lesson\.workspace_id = p_workspace_id/i,
    /lesson\.role_fingerprint = expected_role_fingerprint/i,
    /lesson\.platform = 'GitHub'/i,
    /lesson\.status = 'promoted'/i,
    /lesson\.promoted_by = review\.reviewer_id/i,
    /lesson\.expires_at > wall_now/i,
    /lesson\.query_text = candidate\.canonical_query ->> 'value'/i,
    /lesson\.query_hmac = public\.sourcing_authority_hmac\([\s\S]{0,160}'query:GitHub:' \|\| \(candidate\.canonical_query ->> 'value'\)/i,
  ]) {
    assert.match(authorize, requirement);
  }

  for (const snapshotField of [
    "workspace_id",
    "role_fingerprint",
    "lesson_id",
    "lesson_version",
    "promotion_review_id",
    "promoted_by",
    "graphify_export_id",
    "graphify_artifact_sha256",
    "graphify_image_digest",
    "graphify_commit",
    "graphify_cluster_ref",
    "query_hmac",
    "query_value",
    "query_sha256",
    "snapshot_sha256",
  ]) {
    assert.match(authorize, new RegExp(`'${snapshotField}'`), snapshotField);
  }
});

test("lesson authority is frozen in the claim before egress and copied into immutable completion evidence", () => {
  const authorize = migration.match(
    /create or replace function public\.authorize_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const retryUpdate = authorize.match(
    /update public\.sourcing_batch_claims[\s\S]+?where job_id = p_job_id[\s\S]+?returning \* into claim_row;/i,
  )?.[0] ?? "";
  const commit = migration.match(
    /create or replace function public\.commit_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(authorize, /if claim_exists then\s+applied_lesson := claim_row\.applied_lesson;/i);
  assert.match(authorize, /role_basis_sha256, canonical_query, applied_lesson,[\s\S]{0,320}role_sha, expected_query, applied_lesson/i);
  assert.match(authorize, /'canonical_query', claim_row\.canonical_query,[\s\S]{0,100}'applied_lesson', claim_row\.applied_lesson/i);
  assert.doesNotMatch(retryUpdate, /applied_lesson\s*=/i);
  assert.doesNotMatch(retryUpdate, /canonical_query\s*=/i);

  assert.match(commit, /expected_query := claim_row\.canonical_query/i);
  assert.match(commit, /insert into public\.sourcing_batch_receipts\([\s\S]{0,300}provider_mode, canonical_query_sha256, canonical_query, applied_lesson/i);
  assert.match(commit, /attempt_row\.provider_mode, attempt_row\.canonical_query_sha256, claim_row\.canonical_query,[\s\S]{0,100}claim_row\.applied_lesson/i);
  assert.match(migration, /create trigger sourcing_batch_receipts_append_only[\s\S]{0,160}reject_sourcing_batch_receipt_mutation\(\)/i);
  assert.match(authorize, /'status', 'no_op_replay'[\s\S]{0,500}'canonical_query', receipt_row\.canonical_query,[\s\S]{0,100}'applied_lesson', receipt_row\.applied_lesson/i);
});

test("commit alone decides one idempotent continuation and truthful campaign stop reason", () => {
  const commit = migration.match(
    /create or replace function public\.commit_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  assert.match(commit, /public\.enqueue_aria_job\(/i);
  assert.match(commit, /sourcing_batch:'\s*\|\|\s*p_campaign_id::text/i);
  assert.match(commit, /lpad\(\(p_batch_ordinal \+ 1\)::text, 6, '0'\)/i);
  assert.match(commit, /unique_candidate_total\s*<\s*public\.sourcing_candidate_target\(\)/i);
  assert.match(commit, /observed_candidate_count\s*>\s*0/i);
  assert.match(commit, /p_batch_ordinal\s*<\s*public\.sourcing_max_batch_ordinal\(\)/i);
  assert.match(commit, /target_reached/i);
  assert.match(commit, /provider_exhausted/i);
  assert.match(commit, /batch_bound_reached/i);
  assert.match(commit, /update public\.sourcing_campaigns/i);
  assert.match(commit, /'Outreach'/);
  assert.match(commit, /'Paused'/);
  assert.match(commit, /'activities'/);
});

test("document campaign lifecycle gates authorization, final egress, and continuation", () => {
  const authorize = migration.match(
    /create or replace function public\.authorize_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const begin = migration.match(
    /create or replace function public\.begin_sourcing_batch_egress[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const commit = migration.match(
    /create or replace function public\.commit_sourcing_batch[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  assert.match(authorize, /sourcing_campaign_document_status/i);
  assert.match(authorize, /campaign_not_sourcing/i);
  assert.match(begin, /sourcing_campaign_document_status/i);
  assert.match(begin, /campaign_not_sourcing/i);
  assert.match(commit, /document_campaign_status\s*=\s*'Sourcing'/i);
  assert.match(commit, /document_campaign_status\s*=\s*'Paused'/i);
  assert.match(commit, /set status = 'paused'/i);
  assert.match(commit, /document_campaign_status\s*=\s*'Filled'/i);
  assert.match(commit, /set status = 'cancelled'/i);
});

test("candidate evidence is bounded and guarded by suppression and erasure state", () => {
  assert.match(migration, /candidate_erasure_tombstone_exists/i);
  assert.match(migration, /suppression_list/i);
  assert.match(migration, /candidate_evidence_invalid/i);
  assert.match(migration, /cleanup_sourcing_candidate_evidence/i);
  assert.match(migration, /sourceEvidence/);
  assert.match(migration, /normalizedPayloadSha256/);
  assert.match(migration, /rawResponseSha256/);
  for (const required of [
    "matchScore",
    "matchBreakdown",
    "techStack",
    "yearsExperience",
    "complianceFlags",
    "createdAt",
  ]) {
    assert.match(migration, new RegExp(`'${required}'`), required);
  }
  assert.match(migration, /candidate\s*->\s*'matchScore'\s*<>\s*'0'::jsonb/i);
  assert.match(migration, /candidate\s*->\s*'matchBreakdown'\s*<>\s*'\[\]'::jsonb/i);
});

test("unrelated workspace writes cannot cause a post-egress retry loop", () => {
  assert.match(migration, /merge against the latest workspace document/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /insert into public\.candidates/i);
  assert.match(migration, /jsonb_set\(workspace_row\.state, '\{candidates\}'/i);
  assert.doesNotMatch(migration, /return jsonb_build_object\('status', 'state_conflict'\)/i);
  assert.doesNotMatch(migration, /public\.apply_workspace_patch\(/i);
});

test("begun egress cannot be generically completed and read-only retries stay fenced and bounded", () => {
  assert.match(migration, /guard_sourcing_batch_job_transition/i);
  assert.match(migration, /sourcing batch completion requires its dedicated authority/i);
  assert.match(migration, /GitHub discovery is[\s\S]*read-only/i);
  assert.match(migration, /retryable_failed/i);
  assert.match(migration, /attempt budget remains/i);
});

test("readiness is operational-only and fail-closes all loop hazards", () => {
  assert.match(migration, /expected_sourcing_loop_handler_contract_sha256/i);
  assert.match(migration, /heartbeat_status/i);
  assert.match(migration, /overdue_runnable_jobs/i);
  assert.match(migration, /dead_sourcing_jobs/i);
  assert.match(migration, /ambiguous_sourcing_attempts/i);
  assert.match(migration, /expected_handler_count\s*>\s*0/i);
  assert.match(migration, /freshest_heartbeat_age_seconds/i);
  assert.match(migration, /oldest_runnable_job_age_seconds\s*<=\s*120/i);
  assert.match(migration, /dead_sourcing_jobs\s*=\s*0/i);
  assert.match(migration, /ambiguous_sourcing_attempts\s*=\s*0/i);
  assert.match(migration, /where heartbeat\.release_sha = p_release_sha/i);
  assert.doesNotMatch(migration, /select\s+\*\s+from\s+public\.workspace_state/i);
});

test("an expected pre-egress policy pause completes its job without hiding real dead jobs", () => {
  const pause = migration.match(
    /create or replace function public\.pause_sourcing_batch_pre_egress[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const transitionGuard = migration.match(
    /create or replace function public\.guard_sourcing_batch_job_transition[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";
  const readiness = migration.match(
    /create or replace function public\.get_sourcing_loop_readiness[\s\S]+?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(pause, /set status = 'succeeded', result_sha256 = pause_result_sha/i);
  assert.match(pause, /set_config\('aria\.sourcing_batch_policy_pause_job'/i);
  assert.match(pause, /'job\.succeeded'/i);
  assert.doesNotMatch(pause, /set status = 'dead'/i);
  assert.doesNotMatch(pause, /'job\.dead'/i);
  assert.match(transitionGuard, /policy_pause_job = old\.id::text/i);
  assert.match(transitionGuard, /old\.status = 'leased'[\s\S]{0,240}not found/i);
  assert.match(readiness, /where job\.status = 'dead'/i);
  assert.doesNotMatch(readiness, /no_supported_query_terms/i);
});

test("rollback removes 0054 authority without deleting candidate or job data", () => {
  for (const name of serviceFunctions) {
    assert.match(rollback, new RegExp(`drop function if exists public\\.${name}\\(`, "i"), name);
  }
  for (const table of authorityTables) {
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}\\b`, "i"), table);
  }
  assert.match(rollback, /drop function if exists public\.sourcing_candidate_target\(\)/i);
  assert.match(rollback, /drop function if exists public\.sourcing_max_batch_ordinal\(\)/i);
  assert.match(rollback, /drop function if exists public\.sourcing_batch_lesson_snapshot_sha256\(jsonb\)/i);
  assert.doesNotMatch(rollback, /drop table if exists public\.(?:candidates|aria_jobs|workspace_state|sourcing_campaigns)\b/i);
});
