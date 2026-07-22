#!/usr/bin/env bash
# Disposable PostgreSQL proof for 0055 AI runtime binding authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

migration="supabase/migrations/0055_ai_runtime_binding_authority.sql"
rollback="supabase/rollbacks/0055_ai_runtime_binding_authority.sql"
test -f "$migration"
test -f "$rollback"

project="aria-ai-binding-0055-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
tmp_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_query() {
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -Atq -h db -U postgres -d postgres -c "$1"
}

# Minimal real dependencies for this bounded context. 0055 independently
# guards the shared composite api_keys identity used by its foreign key.
psql_stdin -q < supabase/migrations/0001_init.sql
psql_stdin -q < supabase/migrations/0003_api_keys.sql

# Empty rollback and forward replay are both executable before any authority is
# staged. The shared api_keys composite key intentionally survives rollback.
psql_stdin --single-transaction -q < "$migration"
psql_stdin -q < "$rollback"
[[ "$(psql_query "select (to_regclass('public.ai_runtime_binding_sets') is null)::text")" == "true" ]]
psql_stdin --single-transaction -q < "$migration"
psql_stdin --single-transaction -q < "$migration"

psql_stdin -q <<'SQL'
create schema binding_test;
create table binding_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table binding_test.outputs (
  case_name text primary key,
  output jsonb not null
);

create function binding_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, binding_test
as $$
begin
  insert into binding_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function binding_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, binding_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform binding_test.expect(
      p_case_name,
      caught = any(p_expected),
      format('sqlstate=%s expected=%s', caught, p_expected::text)
    );
    return;
  end;
  perform binding_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function binding_test.set_claims(
  p_subject uuid,
  p_role text
) returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_subject, 'role', p_role)::text,
    true
  );
  perform set_config('request.jwt.claim.sub', coalesce(p_subject::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end;
$$;

create function binding_test.stage_ai_runtime_binding_set(
  p_idempotency_key uuid,
  p_parse_provider_slug text,
  p_parse_model_name text,
  p_parse_api_key_id uuid,
  p_sourcing_provider_slug text,
  p_sourcing_model_name text,
  p_sourcing_api_key_id uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, binding_test
as $$
declare
  parse_evidence_id uuid;
  sourcing_evidence_id uuid;
begin
  select evidence.id into parse_evidence_id
    from public.ai_runtime_model_evidence evidence
   where evidence.workspace_id = p_expected_workspace_id
     and evidence.api_key_id = p_parse_api_key_id
     and evidence.provider_slug = p_parse_provider_slug
     and evidence.model_name = p_parse_model_name
     and evidence.purpose = 'requisition_parse'
   order by evidence.id
   limit 1;
  select evidence.id into sourcing_evidence_id
    from public.ai_runtime_model_evidence evidence
   where evidence.workspace_id = p_expected_workspace_id
     and evidence.api_key_id = p_sourcing_api_key_id
     and evidence.provider_slug = p_sourcing_provider_slug
     and evidence.model_name = p_sourcing_model_name
     and evidence.purpose = 'sourcing'
   order by evidence.id
   limit 1;
  return public.stage_ai_runtime_binding_set(
    p_idempotency_key,
    p_parse_provider_slug, p_parse_model_name, p_parse_api_key_id,
    coalesce(parse_evidence_id, gen_random_uuid()),
    p_sourcing_provider_slug, p_sourcing_model_name, p_sourcing_api_key_id,
    coalesce(sourcing_evidence_id, gen_random_uuid()),
    p_expected_workspace_id
  );
end;
$$;

create function binding_test.activate_ai_runtime_binding_set(
  p_binding_set_id uuid,
  p_idempotency_key uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, binding_test
as $$
declare
  parse_evidence_id uuid;
  sourcing_evidence_id uuid;
begin
  select evidence.id into parse_evidence_id
    from public.ai_runtime_bindings binding
    join public.ai_runtime_model_evidence evidence
      on evidence.workspace_id = binding.workspace_id
     and evidence.api_key_id = binding.api_key_id
     and evidence.provider_slug = binding.provider_slug
     and evidence.credential_provider = binding.credential_provider
     and evidence.endpoint_profile = binding.endpoint_profile
     and evidence.catalog_revision = binding.catalog_revision
     and evidence.model_name = binding.model_name
     and evidence.purpose = binding.purpose
     and evidence.id <> binding.proposal_model_evidence_id
   where binding.binding_set_id = p_binding_set_id
     and binding.workspace_id = p_expected_workspace_id
     and binding.purpose = 'requisition_parse'
   order by evidence.id
   limit 1;
  select evidence.id into sourcing_evidence_id
    from public.ai_runtime_bindings binding
    join public.ai_runtime_model_evidence evidence
      on evidence.workspace_id = binding.workspace_id
     and evidence.api_key_id = binding.api_key_id
     and evidence.provider_slug = binding.provider_slug
     and evidence.credential_provider = binding.credential_provider
     and evidence.endpoint_profile = binding.endpoint_profile
     and evidence.catalog_revision = binding.catalog_revision
     and evidence.model_name = binding.model_name
     and evidence.purpose = binding.purpose
     and evidence.id <> binding.proposal_model_evidence_id
   where binding.binding_set_id = p_binding_set_id
     and binding.workspace_id = p_expected_workspace_id
     and binding.purpose = 'sourcing'
   order by evidence.id
   limit 1;
  return public.activate_ai_runtime_binding_set(
    p_binding_set_id,
    p_idempotency_key,
    coalesce(parse_evidence_id, gen_random_uuid()),
    coalesce(sourcing_evidence_id, gen_random_uuid()),
    p_expected_workspace_id
  );
end;
$$;

grant usage on schema binding_test to anon, authenticated, service_role;
grant select, insert on binding_test.results to anon, authenticated, service_role;
grant select, insert on binding_test.outputs to authenticated, service_role;
grant execute on all functions in schema binding_test to anon, authenticated, service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'proposer@example.test', '', now(), '{}', '{}', now(), now()),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@example.test', '', now(), '{}', '{}', now(), now()),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'foreign-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('a5000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reviewer@example.test', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, allowed_domain) values
  ('b1000000-0000-4000-8000-000000000001', 'Binding workspace', 'binding.example.test'),
  ('b2000000-0000-4000-8000-000000000002', 'Foreign workspace', 'foreign-binding.example.test');

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'proposer@example.test', 'Proposer', 'b1000000-0000-4000-8000-000000000001', 'admin'),
  ('a2000000-0000-4000-8000-000000000002', 'member@example.test', 'Member', 'b1000000-0000-4000-8000-000000000001', 'member'),
  ('a4000000-0000-4000-8000-000000000004', 'foreign-admin@example.test', 'Foreign Admin', 'b2000000-0000-4000-8000-000000000002', 'admin'),
  ('a5000000-0000-4000-8000-000000000005', 'reviewer@example.test', 'Reviewer', 'b1000000-0000-4000-8000-000000000001', 'admin');

insert into public.api_keys(
  id, workspace_id, name, provider, secret, last4, status, last_tested_at,
  verification_method, verification_http_status, created_by
) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Parse key', 'Anthropic', 'synthetic-parse-secret-marker', 'p001', 'valid', now(), 'provider_models_list_v1', 200, 'test'),
  ('c2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Source key', 'OpenAI', 'synthetic-source-secret-marker', 's002', 'valid', now(), 'provider_models_list_v1', 200, 'test'),
  ('c3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'Revoked key', 'Mistral', 'synthetic-revoked-secret-marker', 'r003', 'invalid', now(), 'provider_models_list_v1', 200, 'test'),
  ('c4000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000002', 'Foreign key', 'OpenAI', 'synthetic-foreign-secret-marker', 'f004', 'valid', now(), 'provider_models_list_v1', 200, 'test'),
  ('c9000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000001', 'Unbound key', 'Groq', 'synthetic-unbound-secret-marker', 'u009', 'valid', now(), 'provider_models_list_v1', 200, 'test');
SQL

# Service-only attestations represent successful, nonce-bound provider
# capability probes. Each selected model gets distinct proposal and activation
# evidence so the four-eyes activation cannot replay the proposer's probe.
psql_stdin -q <<'SQL'
begin;
set local role service_role;
select binding_test.set_claims(null, 'service_role');
insert into binding_test.outputs(case_name, output)
select 'parse evidence 1', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Anthropic', 'claude-sonnet-4-6', 'requisition_parse'
);
insert into binding_test.outputs(case_name, output)
select 'parse evidence 2', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Anthropic', 'claude-sonnet-4-6', 'requisition_parse'
);
insert into binding_test.outputs(case_name, output)
select 'source evidence 1', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000002',
  'OpenAI', 'gpt-4o-mini', 'sourcing'
);
insert into binding_test.outputs(case_name, output)
select 'source evidence 2', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000002',
  'OpenAI', 'gpt-4o-mini', 'sourcing'
);
insert into binding_test.outputs(case_name, output)
select 'next parse evidence 1', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Anthropic', 'claude-next', 'requisition_parse'
);
insert into binding_test.outputs(case_name, output)
select 'next parse evidence 2', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Anthropic', 'claude-next', 'requisition_parse'
);
insert into binding_test.outputs(case_name, output)
select 'next source evidence 1', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000002',
  'OpenAI', 'gpt-next', 'sourcing'
);
insert into binding_test.outputs(case_name, output)
select 'next source evidence 2', public.record_ai_runtime_model_evidence(
  'b1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000002',
  'OpenAI', 'gpt-next', 'sourcing'
);
commit;
SQL

# Human mutations require authenticated JWT actor identity. The service role
# retains resolver access only and cannot forge either approval actor.
psql_stdin -q <<'SQL'
begin;
set local role anon;
select binding_test.set_claims(null, 'anon');
select binding_test.expect_sqlstate(
  'anonymous cannot stage',
  $statement$select binding_test.stage_ai_runtime_binding_set(
    'd0000000-0000-4000-8000-000000000001',
    'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
    'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$,
  array['42501']
);
commit;

begin;
set local role service_role;
select binding_test.set_claims(null, 'service_role');
select binding_test.expect_sqlstate(
  'service role cannot stage',
  $statement$select binding_test.stage_ai_runtime_binding_set(
    'd0000000-0000-4000-8000-000000000002',
    'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
    'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$,
  array['42501']
);
select binding_test.expect_sqlstate(
  'service role cannot activate',
  $statement$select binding_test.activate_ai_runtime_binding_set(
    'd0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$,
  array['42501']
);
select binding_test.expect_sqlstate(
  'service role cannot read authority tables directly',
  $statement$select count(*) from public.ai_runtime_binding_sets$statement$,
  array['42501']
);
select binding_test.expect_sqlstate(
  'service role cannot execute internal structural helper',
  $statement$select public.ai_runtime_binding_set_structurally_valid(
    'd0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$,
  array['42501']
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a2000000-0000-4000-8000-000000000002', 'authenticated');
select binding_test.expect_sqlstate(
  'member cannot stage',
  $statement$select binding_test.stage_ai_runtime_binding_set(
    'd0000000-0000-4000-8000-000000000003',
    'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
    'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$,
  array['42501']
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
select binding_test.expect_sqlstate(
  'admin cannot mint model capability evidence',
  $statement$select public.record_ai_runtime_model_evidence(
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'Anthropic', 'forged-model', 'requisition_parse'
  )$statement$,
  array['42501']
);
select binding_test.expect_sqlstate(
  'admin cannot insert a credential already marked valid',
  $statement$insert into public.api_keys(
    id, workspace_id, name, provider, secret, last4, status, created_by
  ) values (
    'ca000000-0000-4000-8000-000000000010',
    'b1000000-0000-4000-8000-000000000001',
    'Bypass key', 'OpenAI', 'synthetic-bypass-secret-marker', 'b010', 'valid', 'test'
  )$statement$,
  array['55000']
);
commit;

select binding_test.expect(
  'standard Tavily usage proof is activatable while legacy Enterprise proof remains valid',
  public.ai_execution_credential_verified(
    'Tavily', 'valid', clock_timestamp(), 'tavily_usage_v1', 200
  )
  and public.ai_execution_credential_verified(
    'Tavily', 'valid', clock_timestamp(), 'tavily_key_info_v1', 200
  )
  and not public.ai_execution_credential_verified(
    'Tavily', 'valid', clock_timestamp(), 'unreviewed', 200
  )
);

select binding_test.expect(
  'caller supplied actor overloads are absent',
  to_regprocedure('public.stage_ai_runtime_binding_set(uuid,uuid,uuid,text,text,uuid,text,text,uuid)') is null
  and to_regprocedure('public.activate_ai_runtime_binding_set(uuid,uuid,uuid,uuid)') is null
  and to_regprocedure('public.stage_ai_runtime_binding_set(uuid,text,text,uuid,text,text,uuid)') is null
  and to_regprocedure('public.activate_ai_runtime_binding_set(uuid,uuid)') is null
  and to_regprocedure('public.stage_ai_runtime_binding_set(uuid,text,text,uuid,uuid,text,text,uuid,uuid,uuid)') is not null
  and to_regprocedure('public.activate_ai_runtime_binding_set(uuid,uuid,uuid,uuid,uuid)') is not null
  and to_regprocedure('public.record_ai_runtime_model_evidence(uuid,uuid,text,text,text)') is not null
);
SQL

# Staging tests tenant isolation, valid-key binding, exact replay, and missing /
# revoked credential indistinguishability.
psql_stdin -q <<'SQL'
begin;
set local role authenticated;
select binding_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');

insert into binding_test.outputs(case_name, output)
select 'mismatched model evidence', public.stage_ai_runtime_binding_set(
  'd9000000-0000-4000-8000-000000000009',
  'anthropic', 'text-embedding-only-model', 'c1000000-0000-4000-8000-000000000001',
  (select (output->>'evidence_id')::uuid from binding_test.outputs
    where case_name = 'parse evidence 1'),
  'openai', 'gpt-4o-mini', 'c2000000-0000-4000-8000-000000000002',
  (select (output->>'evidence_id')::uuid from binding_test.outputs
    where case_name = 'source evidence 1'),
  'b1000000-0000-4000-8000-000000000001'
);

insert into binding_test.outputs(case_name, output)
select 'stage', binding_test.stage_ai_runtime_binding_set(
  'd1000000-0000-4000-8000-000000000001',
  'anthropic', 'claude-sonnet-4-6', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-4o-mini', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'stage replay', binding_test.stage_ai_runtime_binding_set(
  'd1000000-0000-4000-8000-000000000001',
  'anthropic', 'claude-sonnet-4-6', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-4o-mini', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'stage conflict', binding_test.stage_ai_runtime_binding_set(
  'd1000000-0000-4000-8000-000000000001',
  'anthropic', 'changed-model', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-4o-mini', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'foreign key', binding_test.stage_ai_runtime_binding_set(
  'd2000000-0000-4000-8000-000000000002',
  'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-test', 'c4000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'revoked key', binding_test.stage_ai_runtime_binding_set(
  'd3000000-0000-4000-8000-000000000003',
  'mistral', 'mistral-test', 'c3000000-0000-4000-8000-000000000003',
  'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'missing key', binding_test.stage_ai_runtime_binding_set(
  'd4000000-0000-4000-8000-000000000004',
  'anthropic', 'claude-test', 'cf000000-0000-4000-8000-000000000099',
  'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);

insert into binding_test.outputs(case_name, output)
select 'stage workspace conflict', binding_test.stage_ai_runtime_binding_set(
  'd7000000-0000-4000-8000-000000000007',
  'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000002'
);
insert into binding_test.outputs(case_name, output)
select 'activate workspace conflict', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e7000000-0000-4000-8000-000000000007',
  'b2000000-0000-4000-8000-000000000002'
);

select binding_test.set_claims('a4000000-0000-4000-8000-000000000004', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'foreign actor', binding_test.stage_ai_runtime_binding_set(
  'd5000000-0000-4000-8000-000000000005',
  'anthropic', 'claude-test', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-test', 'c2000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000002'
);
commit;

select binding_test.expect(
  'stage creates one complete dark set and one immutable receipt',
  (select output->>'status' = 'staged' and output->>'replay' = 'false'
     from binding_test.outputs where case_name = 'stage')
  and (select count(*) = 1 from public.ai_runtime_binding_sets where idempotency_key = 'd1000000-0000-4000-8000-000000000001' and status = 'staged')
  and (select count(*) = 2 from public.ai_runtime_bindings binding join public.ai_runtime_binding_sets binding_set on binding_set.id = binding.binding_set_id where binding_set.idempotency_key = 'd1000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.ai_runtime_binding_receipts where idempotency_key = 'd1000000-0000-4000-8000-000000000001' and event_type = 'staged')
  and (select proposed_by = 'a1000000-0000-4000-8000-000000000001'
       and workspace_id = 'b1000000-0000-4000-8000-000000000001'
       from public.ai_runtime_binding_sets
      where idempotency_key = 'd1000000-0000-4000-8000-000000000001')
);
select binding_test.expect(
  'stage replay is exact and changed input conflicts',
  (select output->>'status' = 'staged' and output->>'replay' = 'true'
     from binding_test.outputs where case_name = 'stage replay')
  and (select output = '{"status":"idempotency_conflict"}'::jsonb
     from binding_test.outputs where case_name = 'stage conflict')
  and (select a.output - 'replay' = b.output - 'replay'
     from binding_test.outputs a cross join binding_test.outputs b
    where a.case_name = 'stage' and b.case_name = 'stage replay')
);
select binding_test.expect(
  'foreign actor and unavailable credentials fail without authority rows',
  (select count(*) = 4 from binding_test.outputs
    where case_name in ('foreign key', 'revoked key', 'missing key', 'foreign actor')
      and output = '{"status":"credential_unavailable"}'::jsonb)
  and not exists (select 1 from public.ai_runtime_binding_sets where idempotency_key in (
    'd2000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000003',
    'd4000000-0000-4000-8000-000000000004',
    'd5000000-0000-4000-8000-000000000005'
  ))
);
select binding_test.expect(
  'a valid key cannot stage a model that its purpose evidence did not prove',
  (select output = '{"status":"model_evidence_unavailable"}'::jsonb
     from binding_test.outputs where case_name = 'mismatched model evidence')
  and not exists (
    select 1 from public.ai_runtime_binding_sets
     where idempotency_key = 'd9000000-0000-4000-8000-000000000009'
  )
);
select binding_test.expect(
  'expected-workspace fences reject before every staging or activation write',
  (select output = '{"status":"workspace_conflict"}'::jsonb
     from binding_test.outputs where case_name = 'stage workspace conflict')
  and (select output = '{"status":"workspace_conflict"}'::jsonb
     from binding_test.outputs where case_name = 'activate workspace conflict')
  and not exists (
    select 1 from public.ai_runtime_binding_sets
     where idempotency_key = 'd7000000-0000-4000-8000-000000000007'
  )
  and not exists (
    select 1 from public.ai_runtime_binding_receipts
     where idempotency_key in (
       'd7000000-0000-4000-8000-000000000007',
       'e7000000-0000-4000-8000-000000000007'
     )
  )
  and (select status = 'staged' from public.ai_runtime_binding_sets
        where id = (select (output->>'binding_set_id')::uuid
                      from binding_test.outputs where case_name = 'stage'))
);
SQL

# Four-eyes activation: proposer cannot review; reviewer must be another admin
# in the same tenant; the exact activation is replay-safe.
psql_stdin -q <<'SQL'
begin;
set local role authenticated;
select binding_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');

insert into binding_test.outputs(case_name, output)
select 'self review', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001'
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a2000000-0000-4000-8000-000000000002', 'authenticated');
select binding_test.expect_sqlstate(
  'member cannot review',
  format($statement$select binding_test.activate_ai_runtime_binding_set(
    %L,
    'e2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001'
  )$statement$, (select output->>'binding_set_id' from binding_test.outputs where case_name = 'stage')),
  array['42501']
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a4000000-0000-4000-8000-000000000004', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'foreign reviewer', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e3000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000002'
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a5000000-0000-4000-8000-000000000005', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'activation reuses proposal evidence', public.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e9000000-0000-4000-8000-000000000009',
  least(
    (select (output->>'evidence_id')::uuid from binding_test.outputs where case_name = 'parse evidence 1'),
    (select (output->>'evidence_id')::uuid from binding_test.outputs where case_name = 'parse evidence 2')
  ),
  least(
    (select (output->>'evidence_id')::uuid from binding_test.outputs where case_name = 'source evidence 1'),
    (select (output->>'evidence_id')::uuid from binding_test.outputs where case_name = 'source evidence 2')
  ),
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'activate', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e4000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001'
);
insert into binding_test.outputs(case_name, output)
select 'activate replay', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e4000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001'
);

select binding_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'activation replay conflict', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'stage'),
  'e4000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000001'
);
commit;

begin;
set local role service_role;
select binding_test.set_claims(null, 'service_role');
insert into binding_test.outputs(case_name, output)
select 'resolve parse', public.resolve_active_ai_runtime_binding(
  'b1000000-0000-4000-8000-000000000001', 'requisition_parse'
);
insert into binding_test.outputs(case_name, output)
select 'resolve source', public.resolve_active_ai_runtime_binding(
  'b1000000-0000-4000-8000-000000000001', 'sourcing'
);
insert into binding_test.outputs(case_name, output)
select 'resolve foreign workspace', public.resolve_active_ai_runtime_binding(
  'b2000000-0000-4000-8000-000000000002', 'sourcing'
);
commit;

select binding_test.expect(
  'independent review activates exactly once',
  (select output = '{"status":"independent_reviewer_required"}'::jsonb from binding_test.outputs where case_name = 'self review')
  and (select output = '{"status":"not_found"}'::jsonb from binding_test.outputs where case_name = 'foreign reviewer')
  and (select output = '{"status":"model_evidence_unavailable"}'::jsonb from binding_test.outputs where case_name = 'activation reuses proposal evidence')
  and (select output->>'status' = 'activated' and output->>'replay' = 'false' from binding_test.outputs where case_name = 'activate')
  and (select output->>'status' = 'activated' and output->>'replay' = 'true' from binding_test.outputs where case_name = 'activate replay')
  and (select output = '{"status":"idempotency_conflict"}'::jsonb from binding_test.outputs where case_name = 'activation replay conflict')
  and (select count(*) = 1 from public.ai_runtime_binding_sets where status = 'active' and reviewed_by = 'a5000000-0000-4000-8000-000000000005')
  and (select count(*) = 1 from public.ai_runtime_binding_receipts where event_type = 'activated' and idempotency_key = 'e4000000-0000-4000-8000-000000000004')
  and (select actor_id = 'a5000000-0000-4000-8000-000000000005'
       from public.ai_runtime_binding_receipts
      where event_type = 'activated'
        and idempotency_key = 'e4000000-0000-4000-8000-000000000004')
);
select binding_test.expect(
  'resolver is tenant and purpose bound',
  (select output->>'status' = 'configured' and output->>'workspace_id' = 'b1000000-0000-4000-8000-000000000001' and output->>'purpose' = 'requisition_parse' from binding_test.outputs where case_name = 'resolve parse')
  and (select output->>'status' = 'configured' and output->>'workspace_id' = 'b1000000-0000-4000-8000-000000000001' and output->>'purpose' = 'sourcing' from binding_test.outputs where case_name = 'resolve source')
  and (select output = '{"status":"not_configured"}'::jsonb from binding_test.outputs where case_name = 'resolve foreign workspace')
);
SQL

# Revocation immediately closes the complete active set. Bound key identity and
# append-only evidence cannot be deleted or rewritten; an unbound key can be.
psql_stdin -q <<'SQL'
select binding_test.expect_sqlstate(
  'active credential secret substitution is rejected',
  $statement$update public.api_keys
                set secret = 'synthetic-substituted-secret-marker'
              where id = 'c2000000-0000-4000-8000-000000000002'$statement$,
  array['55000']
);
select binding_test.expect_sqlstate(
  'unbound credential secret substitution is rejected',
  $statement$update public.api_keys
                set secret = 'synthetic-substituted-unbound-secret-marker'
              where id = 'c9000000-0000-4000-8000-000000000009'$statement$,
  array['55000']
);
select binding_test.expect_sqlstate(
  'credential tenant substitution is rejected',
  $statement$update public.api_keys
                set workspace_id = 'b2000000-0000-4000-8000-000000000002'
              where id = 'c2000000-0000-4000-8000-000000000002'$statement$,
  array['55000']
);
select binding_test.expect_sqlstate(
  'credential provider substitution is rejected',
  $statement$update public.api_keys
                set provider = 'Groq'
              where id = 'c2000000-0000-4000-8000-000000000002'$statement$,
  array['55000']
);

update public.api_keys set status = 'invalid'
 where id = 'c2000000-0000-4000-8000-000000000002';

begin;
set local role service_role;
select binding_test.set_claims(null, 'service_role');
insert into binding_test.outputs(case_name, output)
select 'resolve after revoke', public.resolve_active_ai_runtime_binding(
  'b1000000-0000-4000-8000-000000000001', 'requisition_parse'
);
commit;

select binding_test.expect(
  'revocation fails the complete active set closed',
  (select output = '{"status":"credential_unavailable"}'::jsonb
     from binding_test.outputs where case_name = 'resolve after revoke')
  and (select verification_method is null and verification_http_status is null
         from public.api_keys
        where id = 'c2000000-0000-4000-8000-000000000002')
);
select binding_test.expect_sqlstate(
  'bound key cannot be deleted',
  $statement$delete from public.api_keys where id = 'c1000000-0000-4000-8000-000000000001'$statement$,
  array['23503']
);
select binding_test.expect_sqlstate(
  'binding identity is immutable',
  $statement$update public.ai_runtime_bindings set model_name = 'changed'$statement$,
  array['55000']
);
select binding_test.expect_sqlstate(
  'receipt is immutable',
  $statement$delete from public.ai_runtime_binding_receipts$statement$,
  array['55000']
);
select binding_test.expect_sqlstate(
  'direct lifecycle update is denied',
  $statement$update public.ai_runtime_binding_sets set status = 'superseded', superseded_at = now(), superseded_by_set_id = id where status = 'active'$statement$,
  array['55000']
);
delete from public.api_keys where id = 'c9000000-0000-4000-8000-000000000009';
select binding_test.expect(
  'unbound key deletion remains available',
  not exists (select 1 from public.api_keys where id = 'c9000000-0000-4000-8000-000000000009')
);
select binding_test.expect_sqlstate(
  'ordinary SQL cannot restore a revoked credential to valid',
  $statement$update public.api_keys
                set status = 'valid', last_tested_at = now()
              where id = 'c2000000-0000-4000-8000-000000000002'$statement$,
  array['55000']
);

begin;
set local role service_role;
select binding_test.set_claims(null, 'service_role');
select binding_test.expect_sqlstate(
  'format-only service evidence cannot restore an execution credential',
  $statement$update public.api_keys
                set status = 'valid', last_tested_at = now()
              where id = 'c2000000-0000-4000-8000-000000000002'$statement$,
  array['55000']
);
update public.api_keys
   set status = 'valid',
       last_tested_at = now(),
       verification_method = 'provider_models_list_v1',
       verification_http_status = 200
 where id = 'c2000000-0000-4000-8000-000000000002';
commit;
select binding_test.expect(
  'verified service workflow can restore a tested credential',
  (select status = 'valid'
          and last_tested_at is not null
          and verification_method = 'provider_models_list_v1'
          and verification_http_status = 200
     from public.api_keys
    where id = 'c2000000-0000-4000-8000-000000000002')
);
SQL

# A second independently reviewed set atomically supersedes the first and keeps
# immutable receipts for both lifecycle effects.
psql_stdin -q <<'SQL'
begin;
set local role authenticated;
select binding_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'second stage', binding_test.stage_ai_runtime_binding_set(
  'd6000000-0000-4000-8000-000000000006',
  'anthropic', 'claude-next', 'c1000000-0000-4000-8000-000000000001',
  'openai', 'gpt-next', 'c2000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001'
);
commit;

begin;
set local role authenticated;
select binding_test.set_claims('a5000000-0000-4000-8000-000000000005', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'second activate', binding_test.activate_ai_runtime_binding_set(
  (select (output->>'binding_set_id')::uuid from binding_test.outputs where case_name = 'second stage'),
  'e6000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000001'
);
commit;

select binding_test.expect(
  'new review supersedes old authority atomically',
  (select count(*) = 1 from public.ai_runtime_binding_sets where workspace_id = 'b1000000-0000-4000-8000-000000000001' and status = 'active')
  and (select count(*) = 1 from public.ai_runtime_binding_sets where workspace_id = 'b1000000-0000-4000-8000-000000000001' and status = 'superseded' and superseded_by_set_id is not null)
  and (select count(*) = 1 from public.ai_runtime_binding_receipts where idempotency_key = 'e6000000-0000-4000-8000-000000000006' and event_type = 'activated')
  and (select count(*) = 1 from public.ai_runtime_binding_receipts where idempotency_key = 'e6000000-0000-4000-8000-000000000006' and event_type = 'superseded')
);
select binding_test.expect(
  'receipt hashes independently recompute',
  not exists (
    select 1 from public.ai_runtime_binding_receipts receipt
     where receipt.receipt_sha256 <> encode(sha256(convert_to(concat_ws(E'\n',
       'aria.ai-runtime-binding-receipt.v1', receipt.id::text,
       receipt.workspace_id::text, receipt.binding_set_id::text,
       receipt.idempotency_key::text, receipt.event_type, receipt.actor_id::text,
       coalesce(receipt.related_binding_set_id::text, ''), receipt.set_sha256
     ), 'UTF8')), 'hex')
  )
);
select binding_test.expect(
  'RPC output contains no credential values or key display metadata',
  not exists (
    select 1 from binding_test.outputs
     where output::text ~* '(synthetic-[a-z]+-secret-marker|last4|p001|s002|r003|f004)'
  )
);
SQL

# The API-visible staged lifecycle is bounded. The workspace advisory lock in
# the RPC serializes this count with both staging and activation mutations.
psql_stdin -q <<'SQL'
insert into public.ai_runtime_binding_sets(
  id, workspace_id, proposed_by, idempotency_key, request_sha256, set_sha256
)
select
  gen_random_uuid(),
  'b2000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000004'::uuid,
  gen_random_uuid(),
  repeat('a', 64),
  repeat('b', 64)
from generate_series(1, 99);

begin;
set local role authenticated;
select binding_test.set_claims('a4000000-0000-4000-8000-000000000004', 'authenticated');
insert into binding_test.outputs(case_name, output)
select 'staged limit', binding_test.stage_ai_runtime_binding_set(
  'd8000000-0000-4000-8000-000000000008',
  'openai', 'gpt-parse', 'c4000000-0000-4000-8000-000000000004',
  'openai', 'gpt-source', 'c4000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000002'
);
commit;

select binding_test.expect(
  'workspace cannot stage a hundredth dark binding set',
  (select output = '{"status":"staged_limit_reached"}'::jsonb
     from binding_test.outputs where case_name = 'staged limit')
  and (select count(*) = 99 from public.ai_runtime_binding_sets
        where workspace_id = 'b2000000-0000-4000-8000-000000000002'
          and status = 'staged')
  and not exists (
    select 1 from public.ai_runtime_binding_sets
     where idempotency_key = 'd8000000-0000-4000-8000-000000000008'
  )
  and not exists (
    select 1 from public.ai_runtime_binding_receipts
     where idempotency_key = 'd8000000-0000-4000-8000-000000000008'
  )
);
SQL

# Production-shaped lookup proof. The data is rolled back and never enters the
# migration fixture permanently.
psql_stdin -q <<'SQL'
begin;
set local statement_timeout = '60s';
insert into public.ai_runtime_binding_sets(
  id, workspace_id, proposed_by, idempotency_key, request_sha256, set_sha256
)
select
  (substr(md5('set-' || g::text), 1, 8) || '-' || substr(md5('set-' || g::text), 9, 4) || '-4' || substr(md5('set-' || g::text), 14, 3) || '-8' || substr(md5('set-' || g::text), 18, 3) || '-' || substr(md5('set-' || g::text), 21, 12))::uuid,
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  (substr(md5('op-' || g::text), 1, 8) || '-' || substr(md5('op-' || g::text), 9, 4) || '-4' || substr(md5('op-' || g::text), 14, 3) || '-8' || substr(md5('op-' || g::text), 18, 3) || '-' || substr(md5('op-' || g::text), 21, 12))::uuid,
  repeat('a', 64), repeat('b', 64)
from generate_series(1, 50000) g;
analyze public.ai_runtime_binding_sets;
set local enable_seqscan = off;
do $$
declare
  point_plan json;
  active_plan json;
begin
  execute $explain$explain (format json)
    select id from public.ai_runtime_binding_sets
     where workspace_id = 'b1000000-0000-4000-8000-000000000001'
       and idempotency_key = '40000000-0000-4000-8000-000000000001'$explain$
    into point_plan;
  if point_plan::text !~ 'ai_runtime_binding_sets_workspace_id_idempotency_key' then
    raise exception '50k idempotency lookup missed its index';
  end if;
  execute $explain$explain (format json)
    select id from public.ai_runtime_binding_sets
     where workspace_id = 'b1000000-0000-4000-8000-000000000001'
       and status = 'active'$explain$
    into active_plan;
  if active_plan::text !~ 'ai_runtime_binding_sets_one_active_workspace_idx' then
    raise exception '50k active lookup missed its partial index';
  end if;
end;
$$;
rollback;
SQL

# Non-empty rollback must refuse and preserve authority evidence.
if psql_stdin --set VERBOSITY=verbose < "$rollback" > "$tmp_dir/rollback.log" 2>&1; then
  echo "0055 rollback unexpectedly removed non-empty authority" >&2
  exit 1
fi
grep -Eq '55000|contains rows|refus' "$tmp_dir/rollback.log"

failed="$(psql_query "select count(*) from binding_test.results where not passed")"
if [[ "$failed" != "0" ]]; then
  psql_query "select case_name || ': ' || coalesce(detail, '') from binding_test.results where not passed order by case_name" >&2
  exit 1
fi
passed="$(psql_query "select count(*) from binding_test.results where passed")"
echo "AI runtime binding database outcomes: ${passed}/${passed} passed"
