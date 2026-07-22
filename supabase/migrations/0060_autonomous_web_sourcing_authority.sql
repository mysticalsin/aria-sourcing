-- 0060_autonomous_web_sourcing_authority.sql
--
-- A separate, fail-closed authority for one real Tavily search over public
-- LinkedIn profile pages. 0054 remains the sole GitHub authority. This lane
-- accepts only leased sourcing_batch jobs whose canonical role has no 0054
-- query, derives the Tavily request in SQL, binds one freshly verified tenant
-- credential by immutable row/version identity, and permits one bounded attempt
-- at a time. Only classified read-only provider failures may append a new fence.
-- Provider secrets and raw response bodies never enter these tables.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

-- Atomically expand the worker identity with the autonomous handler in this
-- same migration. Readiness accepts no mixed three/four-handler rollout:
-- an exact-release worker must advertise this canonical four-handler digest.
create or replace function public.expected_sourcing_loop_handler_contract_sha256()
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(
    'aria.sourcing-loop-handlers.v1|autonomous_web_sourcing|campaign_create|requisition_parse|sourcing_batch',
    'UTF8'
  )), 'hex');
$$;

revoke all on function public.expected_sourcing_loop_handler_contract_sha256()
  from public, anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- Deterministic policy and immutable identities.
-- ---------------------------------------------------------------------------
create or replace function public.autonomous_web_sourcing_expected_query(
  p_role_basis jsonb,
  p_batch_ordinal integer
) returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  canonical_basis jsonb;
  role_title text;
  skill_count integer;
  selected_skill text;
  query_value text;
  policy_version constant text := 'tavily-linkedin-deterministic-v1';
  query_sha256 text;
begin
  if p_batch_ordinal is null or p_batch_ordinal not between 0 and 4 then
    return null;
  end if;
  begin
    canonical_basis := public.canonicalize_sourcing_role_basis(p_role_basis);
  exception when others then
    return null;
  end;
  if canonical_basis <> p_role_basis
     or public.sourcing_batch_expected_query(canonical_basis, p_batch_ordinal) is not null then
    return null;
  end if;

  role_title := canonical_basis ->> 'title';
  if role_title !~ '^[[:alnum:]][[:alnum:] .+#/&-]{1,199}$'
     or role_title ~ '[[:cntrl:]]' then
    return null;
  end if;
  skill_count := jsonb_array_length(canonical_basis -> 'skills');
  if skill_count < 1 then return null; end if;
  select skill.value into selected_skill
    from jsonb_array_elements_text(canonical_basis -> 'skills')
      with ordinality skill(value, ordinality)
   where skill.ordinality = (p_batch_ordinal % skill_count) + 1;
  if selected_skill is null
     or selected_skill !~ '^[[:alnum:]][[:alnum:] .+#/&-]{0,99}$'
     or selected_skill ~ '[[:cntrl:]]' then
    return null;
  end if;

  query_value := 'site:linkedin.com/in "' || role_title || '" "' || selected_skill || '"';
  query_sha256 := encode(sha256(convert_to(
    policy_version || E'\n' || query_value
      || E'\nmax_results:5\ninclude_domains:linkedin.com\nsearch_depth:basic',
    'UTF8'
  )), 'hex');
  return jsonb_build_object(
    'policyVersion', policy_version,
    'value', query_value,
    'maxResults', 5,
    'includeDomains', jsonb_build_array('linkedin.com'),
    'searchDepth', 'basic',
    'sha256', query_sha256
  );
end;
$$;

-- Lessons may reorder this finite set but can never create or widen a query.
create or replace function public.autonomous_web_sourcing_query_is_allowed(
  p_role_basis jsonb,
  p_query jsonb
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_query) = 'object'
    and exists (
      select 1
        from generate_series(0, 4) candidate_ordinal
       where public.autonomous_web_sourcing_expected_query(
         p_role_basis, candidate_ordinal
       ) is not null
         and public.autonomous_web_sourcing_expected_query(
           p_role_basis, candidate_ordinal
         ) = p_query
    ),
    false
  );
$$;

create or replace function public.autonomous_web_sourcing_credential_version(
  p_api_key_id uuid,
  p_workspace_id uuid,
  p_provider text,
  p_last4 text,
  p_last_tested_at timestamptz,
  p_verification_method text,
  p_verification_http_status integer
) returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(concat_ws(E'\n',
    'aria.autonomous-web-credential.v1',
    p_api_key_id::text,
    p_workspace_id::text,
    p_provider,
    p_last4,
    to_char(p_last_tested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p_verification_method,
    p_verification_http_status::text
  ), 'UTF8')), 'hex');
$$;

create or replace function public.autonomous_web_sourcing_request(
  p_query jsonb
) returns jsonb
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case when p_query is null then null else jsonb_build_object(
    'query', p_query ->> 'value',
    'search_depth', p_query ->> 'searchDepth',
    'max_results', (p_query ->> 'maxResults')::integer,
    'include_domains', p_query -> 'includeDomains',
    'include_answer', false,
    'include_images', false
  ) end;
$$;

create or replace function public.autonomous_web_sourcing_request_sha256(
  p_request jsonb
) returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(
    'aria.autonomous-web-request.v1' || E'\n' || p_request::text,
    'UTF8'
  )), 'hex');
$$;

create or replace function public.autonomous_web_linkedin_external_id(
  p_linkedin_url text
) returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_linkedin_url ~ '^https://www\.linkedin\.com/in/[a-z0-9][a-z0-9-]{2,99}$'
      then encode(sha256(convert_to(p_linkedin_url, 'UTF8')), 'hex')
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Authority state. Attempts and receipts are immutable. Only staged normalized
-- provider results and candidate evidence contain personal data, and both are
-- bounded and erasure-aware.
-- ---------------------------------------------------------------------------
create table if not exists public.autonomous_web_sourcing_claims (
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  campaign_id uuid not null,
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  batch_ordinal integer not null check (batch_ordinal between 0 and 4),
  claim_token uuid not null unique,
  fence_version bigint not null check (fence_version > 0),
  provider text not null check (provider = 'tavily'),
  credential_id uuid not null,
  credential_version text not null check (credential_version ~ '^[0-9a-f]{64}$'),
  credential_verified_at timestamptz not null,
  query_policy_version text not null check (
    query_policy_version = 'tavily-linkedin-deterministic-v1'
  ),
  canonical_query jsonb not null check (
    jsonb_typeof(canonical_query) = 'object'
    and canonical_query ?& array[
      'policyVersion','value','maxResults','includeDomains','searchDepth','sha256'
    ]
    and canonical_query - array[
      'policyVersion','value','maxResults','includeDomains','searchDepth','sha256'
    ] = '{}'::jsonb
    and pg_column_size(canonical_query) <= 2048
  ),
  applied_lesson jsonb check (
    applied_lesson is null or (
      jsonb_typeof(applied_lesson) = 'object'
      and applied_lesson ?& array[
        'workspace_id', 'role_fingerprint', 'lesson_id', 'lesson_version',
        'promotion_review_id', 'promoted_by', 'graphify_export_id',
        'graphify_artifact_sha256', 'graphify_image_digest', 'graphify_commit',
        'graphify_cluster_ref', 'query_hmac', 'query_value', 'query_sha256',
        'snapshot_sha256'
      ]
      and applied_lesson - array[
        'workspace_id', 'role_fingerprint', 'lesson_id', 'lesson_version',
        'promotion_review_id', 'promoted_by', 'graphify_export_id',
        'graphify_artifact_sha256', 'graphify_image_digest', 'graphify_commit',
        'graphify_cluster_ref', 'query_hmac', 'query_value', 'query_sha256',
        'snapshot_sha256'
      ] = '{}'::jsonb
      and pg_column_size(applied_lesson) <= 4096
      and applied_lesson ->> 'workspace_id' = workspace_id::text
      and applied_lesson ->> 'query_value' = canonical_query ->> 'value'
      and applied_lesson ->> 'query_sha256' = canonical_query ->> 'sha256'
      and applied_lesson ->> 'snapshot_sha256'
        = public.sourcing_batch_lesson_snapshot_sha256(applied_lesson)
    )
  ),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  role_basis_sha256 text not null check (role_basis_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (job_id, fence_version),
  unique (claim_token),
  unique (workspace_id, job_id, fence_version),
  unique (job_id, claim_token, fence_version),
  foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade,
  foreign key (credential_id)
    references public.api_keys(id) on delete restrict,
  check (expires_at = authorized_at + interval '2 minutes'),
  check (canonical_query ->> 'policyVersion' = query_policy_version),
  check (canonical_query ->> 'sha256' = canonical_query_sha256)
);

create table if not exists public.autonomous_web_sourcing_attempts (
  id uuid primary key,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  campaign_id uuid not null,
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  provider text not null check (provider = 'tavily'),
  credential_id uuid not null,
  credential_version text not null check (credential_version ~ '^[0-9a-f]{64}$'),
  query_policy_version text not null check (
    query_policy_version = 'tavily-linkedin-deterministic-v1'
  ),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  begun_at timestamptz not null,
  egress_expires_at timestamptz not null,
  unique (workspace_id, id),
  unique (job_id, fence_version),
  foreign key (job_id, claim_token, fence_version)
    references public.autonomous_web_sourcing_claims(job_id, claim_token, fence_version)
    on delete cascade,
  foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade,
  check (egress_expires_at = begun_at + interval '30 seconds')
);

create table if not exists public.autonomous_web_sourcing_confirmations (
  egress_attempt_id uuid primary key
    references public.autonomous_web_sourcing_attempts(id) on delete cascade,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  credential_id uuid not null,
  credential_version text not null check (credential_version ~ '^[0-9a-f]{64}$'),
  query_policy_version text not null check (
    query_policy_version = 'tavily-linkedin-deterministic-v1'
  ),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz not null,
  must_start_by timestamptz not null,
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade,
  check (must_start_by = confirmed_at + interval '10 seconds')
);

create table if not exists public.autonomous_web_sourcing_results (
  egress_attempt_id uuid primary key
    references public.autonomous_web_sourcing_attempts(id) on delete cascade,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  raw_response_sha256 text not null check (raw_response_sha256 ~ '^[0-9a-f]{64}$'),
  raw_response_bytes integer not null check (raw_response_bytes between 2 and 1048576),
  normalized_results_sha256 text not null check (normalized_results_sha256 ~ '^[0-9a-f]{64}$'),
  provider_receipt_sha256 text not null check (provider_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text not null unique check (result_sha256 ~ '^[0-9a-f]{64}$'),
  result_count integer not null check (result_count between 0 and 5),
  recorded_at timestamptz not null default now()
);

create table if not exists public.autonomous_web_sourcing_staged_results (
  egress_attempt_id uuid primary key
    references public.autonomous_web_sourcing_results(egress_attempt_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_results jsonb not null check (
    jsonb_typeof(normalized_results) = 'array'
    and jsonb_array_length(normalized_results) <= 5
    and pg_column_size(normalized_results) <= 65536
  ),
  provider_receipt jsonb not null check (
    jsonb_typeof(provider_receipt) = 'object'
    and pg_column_size(provider_receipt) <= 4096
  ),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create table if not exists public.autonomous_web_candidate_evidence (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  candidate_id text not null check (candidate_id ~ '^linkedin-[0-9a-f]{32}$'),
  egress_attempt_id uuid not null
    references public.autonomous_web_sourcing_attempts(id) on delete restrict,
  provider text not null check (provider = 'tavily'),
  provider_external_id text not null check (provider_external_id ~ '^[0-9a-f]{64}$'),
  linkedin_url text not null check (
    linkedin_url ~ '^https://www\.linkedin\.com/in/[a-z0-9][a-z0-9-]{2,99}$'
  ),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  raw_response_sha256 text not null check (raw_response_sha256 ~ '^[0-9a-f]{64}$'),
  provider_result_sha256 text not null check (provider_result_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_payload_sha256 text not null check (normalized_payload_sha256 ~ '^[0-9a-f]{64}$'),
  role_evidence jsonb not null check (
    jsonb_typeof(role_evidence) = 'object' and pg_column_size(role_evidence) <= 12288
  ),
  recorded_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  primary key (workspace_id, campaign_id, candidate_id),
  unique (workspace_id, campaign_id, provider_external_id),
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade
);

create table if not exists public.autonomous_web_sourcing_receipts (
  job_id uuid primary key references public.aria_jobs(id) on delete restrict,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  campaign_id uuid not null,
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  egress_attempt_id uuid not null unique
    references public.autonomous_web_sourcing_attempts(id) on delete restrict,
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_query jsonb not null check (
    jsonb_typeof(canonical_query) = 'object'
    and canonical_query ?& array[
      'policyVersion','value','maxResults','includeDomains','searchDepth','sha256'
    ]
    and canonical_query - array[
      'policyVersion','value','maxResults','includeDomains','searchDepth','sha256'
    ] = '{}'::jsonb
    and canonical_query ->> 'sha256' = canonical_query_sha256
    and pg_column_size(canonical_query) <= 2048
  ),
  applied_lesson jsonb check (
    applied_lesson is null or (
      jsonb_typeof(applied_lesson) = 'object'
      and applied_lesson ?& array[
        'workspace_id', 'role_fingerprint', 'lesson_id', 'lesson_version',
        'promotion_review_id', 'promoted_by', 'graphify_export_id',
        'graphify_artifact_sha256', 'graphify_image_digest', 'graphify_commit',
        'graphify_cluster_ref', 'query_hmac', 'query_value', 'query_sha256',
        'snapshot_sha256'
      ]
      and applied_lesson - array[
        'workspace_id', 'role_fingerprint', 'lesson_id', 'lesson_version',
        'promotion_review_id', 'promoted_by', 'graphify_export_id',
        'graphify_artifact_sha256', 'graphify_image_digest', 'graphify_commit',
        'graphify_cluster_ref', 'query_hmac', 'query_value', 'query_sha256',
        'snapshot_sha256'
      ] = '{}'::jsonb
      and pg_column_size(applied_lesson) <= 4096
      and applied_lesson ->> 'workspace_id' = workspace_id::text
      and applied_lesson ->> 'query_value' = canonical_query ->> 'value'
      and applied_lesson ->> 'query_sha256' = canonical_query_sha256
      and applied_lesson ->> 'snapshot_sha256'
        = public.sourcing_batch_lesson_snapshot_sha256(applied_lesson)
    )
  ),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count between 0 and 5),
  completed_at timestamptz not null default now(),
  foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete restrict
);

create table if not exists public.autonomous_web_sourcing_failures (
  egress_attempt_id uuid primary key
    references public.autonomous_web_sourcing_attempts(id) on delete cascade,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  error_code text not null check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  retryable boolean not null,
  ambiguous boolean not null,
  disposition text not null check (disposition in ('retry_scheduled', 'dead', 'ambiguous')),
  failed_at timestamptz not null default now(),
  check (
    (disposition = 'retry_scheduled' and retryable and not ambiguous)
    or (disposition = 'ambiguous' and ambiguous and not retryable)
    or (disposition = 'dead' and not ambiguous)
  )
);

create table if not exists public.autonomous_web_sourcing_reconciliations (
  egress_attempt_id uuid primary key
    references public.autonomous_web_sourcing_attempts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  outcome text not null check (outcome in ('completed', 'result_ready', 'no_durable_response')),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  reconciled_at timestamptz not null default now(),
  check ((outcome in ('completed','result_ready')) = (result_sha256 is not null))
);

create table if not exists public.autonomous_web_sourcing_quota_ledger (
  id bigint generated always as identity primary key,
  egress_attempt_id uuid not null
    references public.autonomous_web_sourcing_attempts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider = 'tavily'),
  scope_kind text not null check (scope_kind in ('provider_minute','workspace_day')),
  window_start timestamptz not null,
  reserved_units integer not null check (reserved_units = 1),
  recorded_at timestamptz not null default now(),
  unique (egress_attempt_id, scope_kind)
);

create index if not exists autonomous_web_quota_provider_idx
  on public.autonomous_web_sourcing_quota_ledger(provider, scope_kind, window_start);
create index if not exists autonomous_web_quota_workspace_idx
  on public.autonomous_web_sourcing_quota_ledger(workspace_id, scope_kind, window_start);
create index if not exists autonomous_web_staged_expiry_idx
  on public.autonomous_web_sourcing_staged_results(expires_at, egress_attempt_id);
create index if not exists autonomous_web_evidence_expiry_idx
  on public.autonomous_web_candidate_evidence(expires_at, workspace_id, campaign_id);
create index if not exists autonomous_web_claims_latest_idx
  on public.autonomous_web_sourcing_claims(job_id, fence_version desc);
create index if not exists autonomous_web_attempts_job_idx
  on public.autonomous_web_sourcing_attempts(job_id, fence_version desc);
create index if not exists autonomous_web_failures_job_idx
  on public.autonomous_web_sourcing_failures(job_id, failed_at desc);

-- ---------------------------------------------------------------------------
-- RLS, direct ACL denial, and mutation guards.
-- ---------------------------------------------------------------------------
do $aria_web_rls$
declare table_name text;
begin
  foreach table_name in array array[
    'autonomous_web_sourcing_claims',
    'autonomous_web_sourcing_attempts',
    'autonomous_web_sourcing_confirmations',
    'autonomous_web_sourcing_results',
    'autonomous_web_sourcing_staged_results',
    'autonomous_web_candidate_evidence',
    'autonomous_web_sourcing_receipts',
    'autonomous_web_sourcing_failures',
    'autonomous_web_sourcing_reconciliations',
    'autonomous_web_sourcing_quota_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role, authenticator',
      table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to postgres, supabase_admin using (true) with check (true)',
      table_name || '_owner_all', table_name
    );
  end loop;
end;
$aria_web_rls$;
revoke all on sequence public.autonomous_web_sourcing_quota_ledger_id_seq
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.reject_autonomous_web_sourcing_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('aria.autonomous_web_retention_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'autonomous web sourcing evidence is immutable' using errcode = '42501';
end;
$$;

create or replace function public.guard_autonomous_web_staged_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('aria.autonomous_web_payload_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'autonomous web staged payload mutation denied' using errcode = '42501';
end;
$$;

do $aria_web_guards$
declare table_name text;
begin
  foreach table_name in array array[
    'autonomous_web_sourcing_claims',
    'autonomous_web_sourcing_attempts',
    'autonomous_web_sourcing_confirmations',
    'autonomous_web_sourcing_results',
    'autonomous_web_candidate_evidence',
    'autonomous_web_sourcing_receipts',
    'autonomous_web_sourcing_failures',
    'autonomous_web_sourcing_reconciliations',
    'autonomous_web_sourcing_quota_ledger'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_immutable', table_name);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_autonomous_web_sourcing_mutation()',
      table_name || '_immutable', table_name
    );
  end loop;
end;
$aria_web_guards$;
drop trigger if exists autonomous_web_staged_results_guard
  on public.autonomous_web_sourcing_staged_results;
create trigger autonomous_web_staged_results_guard
  before update or delete on public.autonomous_web_sourcing_staged_results
  for each row execute function public.guard_autonomous_web_staged_mutation();

-- The generic queue reaper cannot infer whether a begun web request crossed
-- the network boundary. This trigger runs before 0054's sourcing transition
-- guard and atomically converts an expired attempt without a durable result to
-- terminal ambiguity. A durable staged result keeps its original lease only
-- until that payload's fixed expiry, allowing exact receipt reconciliation and
-- commit without authorizing another fetch.
create or replace function public.guard_autonomous_web_sourcing_job_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  stage_expiry timestamptz;
begin
  if old.kind <> 'sourcing_batch' then return new; end if;
  -- Metadata has a bounded retention window, but the queue row retains this
  -- non-PII terminal marker. Never let generic maintenance resurrect a web
  -- job after its immutable attempt history has aged out.
  if old.status = 'dead' and new.status = 'queued'
     and old.last_error like 'autonomous web%' then
    raise exception 'autonomous web attempt cannot be generically requeued'
      using errcode = '42501';
  end if;
  select * into attempt_row from public.autonomous_web_sourcing_attempts attempt
   where attempt.job_id = old.id
   order by attempt.fence_version desc
   limit 1
   for share;
  if not found then return new; end if;

  if old.status = 'dead' and new.status = 'queued' then
    raise exception 'autonomous web attempt cannot be generically requeued'
      using errcode = '42501';
  end if;
  if old.status = 'leased' and new.status in ('queued','dead') then
    -- The authority inserts its immutable failure before intentionally
    -- dead-lettering a job. Preserve that exact outcome and message.
    if exists (
      select 1 from public.autonomous_web_sourcing_failures failure
       where failure.egress_attempt_id = attempt_row.id
    ) then
      return new;
    end if;
    select stage.expires_at into stage_expiry
      from public.autonomous_web_sourcing_staged_results stage
     where stage.egress_attempt_id = attempt_row.id;
    if stage_expiry is not null and stage_expiry > clock_timestamp() then
      new.status := 'leased';
      new.lease_id := old.lease_id;
      new.lease_expires_at := least(stage_expiry, clock_timestamp() + interval '2 minutes');
      new.last_error := 'durable autonomous web result awaiting exact commit';
      return new;
    end if;
    insert into public.autonomous_web_sourcing_failures(
      egress_attempt_id, job_id, workspace_id, error_code, retryable, ambiguous,
      disposition
    ) values (
      attempt_row.id, old.id, old.workspace_id,
      'lease_expired_after_web_begin', false, true, 'ambiguous'
    );
    new.status := 'dead';
    new.lease_id := null;
    new.lease_expires_at := null;
    new.last_error := 'autonomous web outcome ambiguous after lease expiry';
  end if;
  return new;
end;
$$;

drop trigger if exists aria_jobs_autonomous_web_transition_guard on public.aria_jobs;
create trigger aria_jobs_autonomous_web_transition_guard
  before update of status, lease_id, lease_expires_at on public.aria_jobs
  for each row execute function public.guard_autonomous_web_sourcing_job_transition();

-- ---------------------------------------------------------------------------
-- Strict normalized-provider evidence mapper. It accepts public search result
-- fields only and derives candidate identity and role evidence in SQL.
-- ---------------------------------------------------------------------------
create or replace function public.autonomous_web_sourcing_candidates(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_attempt_id uuid,
  p_role_basis jsonb,
  p_query jsonb,
  p_raw_response_sha256 text,
  p_normalized_results jsonb,
  p_created_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result_item jsonb;
  candidate jsonb;
  candidates jsonb := '[]'::jsonb;
  role_title text := p_role_basis ->> 'title';
  linkedin_url text;
  external_id text;
  candidate_id text;
  result_title text;
  result_content text;
  source_text text;
  source_normalized text;
  role_title_normalized text;
  title_observed boolean;
  matched_skills jsonb;
  matched_role_terms jsonb;
  result_sha text;
  normalized_sha text;
  ordinal integer := 0;
begin
  if p_workspace_id is null or p_campaign_id is null or p_attempt_id is null
     or p_raw_response_sha256 !~ '^[0-9a-f]{64}$'
     or p_normalized_results is null
     or jsonb_typeof(p_normalized_results) <> 'array'
     or jsonb_array_length(p_normalized_results) > 5
     or pg_column_size(p_normalized_results) > 65536
     or jsonb_typeof(p_query -> 'batchOrdinal') <> 'number'
     or (p_query ->> 'batchOrdinal')::integer not between 0 and 4
     or not public.autonomous_web_sourcing_query_is_allowed(
       p_role_basis, p_query - 'batchOrdinal'
     ) then
    raise exception 'invalid autonomous web normalized results' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct value ->> 'url')
        from jsonb_array_elements(p_normalized_results)) then
    raise exception 'duplicate autonomous web provider result' using errcode = '22023';
  end if;

  for result_item in select value from jsonb_array_elements(p_normalized_results)
  loop
    if jsonb_typeof(result_item) <> 'object'
       or result_item - array['url','title','content','score'] <> '{}'::jsonb
       or not (result_item ?& array['url','title','content','score'])
       or jsonb_typeof(result_item -> 'url') <> 'string'
       or jsonb_typeof(result_item -> 'title') <> 'string'
       or jsonb_typeof(result_item -> 'content') <> 'string'
       or jsonb_typeof(result_item -> 'score') <> 'number'
       or length(result_item ->> 'title') not between 1 and 300
       or length(result_item ->> 'content') not between 1 and 4000
       or result_item ->> 'title' ~ '[[:cntrl:]]'
       or result_item ->> 'content' ~ '[[:cntrl:]]'
       or (result_item ->> 'score')::numeric not between 0 and 1 then
      raise exception 'invalid autonomous web provider result' using errcode = '22023';
    end if;
    linkedin_url := lower(regexp_replace(result_item ->> 'url', '/$', ''));
    external_id := public.autonomous_web_linkedin_external_id(linkedin_url);
    if external_id is null then
      raise exception 'non-canonical LinkedIn result denied' using errcode = '22023';
    end if;
    candidate_id := 'linkedin-' || substr(encode(sha256(convert_to(
      p_workspace_id::text || E'\n' || p_campaign_id::text || E'\nlinkedin\n' || external_id,
      'UTF8'
    )), 'hex'), 1, 32);

    perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
      p_workspace_id, 'candidate_id', candidate_id
    ));
    perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
      p_workspace_id, 'linkedin', linkedin_url
    ));
    perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
      p_workspace_id, 'source_external_id', external_id
    ));
    if public.candidate_erasure_tombstone_exists(p_workspace_id, 'candidate_id', candidate_id)
       or public.candidate_erasure_tombstone_exists(p_workspace_id, 'linkedin', linkedin_url)
       or public.candidate_erasure_tombstone_exists(p_workspace_id, 'source_url', linkedin_url)
       or public.candidate_erasure_tombstone_exists(p_workspace_id, 'source_external_id', external_id)
       or public.candidate_erasure_tombstone_exists(p_workspace_id, 'provider_external_id', external_id) then
      raise exception 'candidate erasure tombstone blocks autonomous web result'
        using errcode = '23514';
    end if;

    result_title := result_item ->> 'title';
    result_content := result_item ->> 'content';
    source_text := lower(result_title || E'\n' || result_content);
    source_normalized := btrim(regexp_replace(
      source_text, '[^[:alnum:]+#&]+', ' ', 'g'
    ));
    role_title_normalized := btrim(regexp_replace(
      lower(role_title), '[^[:alnum:]+#&]+', ' ', 'g'
    ));
    title_observed := position(
      ' ' || role_title_normalized || ' ' in ' ' || source_normalized || ' '
    ) > 0;
    select coalesce(jsonb_agg(skill order by skill), '[]'::jsonb)
      into matched_skills
      from (
        select distinct skill.value as skill
          from jsonb_array_elements_text(p_role_basis -> 'skills') skill(value)
         where position(
           ' ' || btrim(regexp_replace(lower(skill.value), '[^[:alnum:]+#&]+', ' ', 'g')) || ' '
           in ' ' || source_normalized || ' '
         ) > 0
      ) matched;
    with raw_terms(term) as (
      select distinct btrim(regexp_replace(
        lower(skill.value), '[^[:alnum:]+#&]+', ' ', 'g'
      ))
        from jsonb_array_elements_text(p_role_basis -> 'skills') skill(value)
      union
      select distinct title_term[1]
        from regexp_matches(
          role_title_normalized, '[[:alnum:]+#&]{3,}', 'g'
        ) title_term
    ), matched_terms(term) as (
      select term from raw_terms
       where term <> ''
         and position(' ' || term || ' ' in ' ' || source_normalized || ' ') > 0
    )
    select coalesce(jsonb_agg(term order by term), '[]'::jsonb)
      into matched_role_terms
      from matched_terms matched
     where not exists (
       select 1 from matched_terms broader
        where broader.term <> matched.term
          and position(' ' || matched.term || ' ' in ' ' || broader.term || ' ') > 0
     );
    if not title_observed and jsonb_array_length(matched_role_terms) < 2 then
      raise exception 'provider result lacks grounded role evidence' using errcode = '23514';
    end if;

    result_sha := encode(sha256(convert_to(result_item::text, 'UTF8')), 'hex');
    normalized_sha := encode(sha256(convert_to(jsonb_build_object(
      'url', linkedin_url,
      'title', result_title,
      'content', result_content,
      'score', result_item -> 'score',
      'ordinal', ordinal,
      'externalId', external_id
    )::text, 'UTF8')), 'hex');
    candidate := jsonb_build_object(
      'id', candidate_id,
      'campaignId', p_campaign_id::text,
      'name', result_title,
      'email', '',
      'phone', '',
      'avatarInitials', upper(left(result_title, 1)),
      'currentTitle', '',
      'currentCompany', '',
      'location', '',
      'timezone', '',
      'linkedinUrl', linkedin_url,
      'githubUrl', '',
      'sourceUrl', linkedin_url,
      'sourceExternalId', external_id,
      'externalIds', jsonb_build_object('LinkedIn', external_id),
      'sourcePlatform', 'LinkedIn',
      'sourceQuery', p_query ->> 'value',
      'matchScore', 0,
      'matchBreakdown', '[]'::jsonb,
      'techStack', '[]'::jsonb,
      'experience', '[]'::jsonb,
      'education', '[]'::jsonb,
      'languages', '[]'::jsonb,
      'yearsExperience', null,
      'companyStageExperience', '[]'::jsonb,
      'industryExperience', '[]'::jsonb,
      'recentActivity', '',
      'stage', 'Sourced',
      'lastContactedAt', null,
      'outreachHistory', '[]'::jsonb,
      'replyHistory', '[]'::jsonb,
      'booking', null,
      'complianceFlags', jsonb_build_object(
        'doNotContact', false,
        'suppressed', false,
        'unsubscribed', false,
        'gdprExportRequested', false,
        'anonymized', false,
        'suppressedUntil', null
      ),
      'lawfulBasis', null,
      'lawfulBasisRecordedAt', null,
      'lawfulBasisRecordedBy', null,
      'lawfulBasisSource', null,
      'createdAt', to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'provenance', 'live',
      'sourceEvidence', jsonb_build_object(
        'provider', 'tavily',
        'attemptId', p_attempt_id::text,
        'providerResultOrdinal', ordinal,
        'providerResultTitle', result_title,
        'providerResultSnippet', result_content,
        'providerScore', result_item -> 'score',
        'linkedinUrl', linkedin_url,
        'externalId', external_id,
        'roleTitle', role_title,
        'roleTitleObserved', title_observed,
        'matchedRequiredSkills', matched_skills,
        'matchedRoleTerms', matched_role_terms,
        'querySha256', p_query ->> 'sha256',
        'rawResponseSha256', p_raw_response_sha256,
        'providerResultSha256', result_sha,
        'normalizedPayloadSha256', normalized_sha
      )
    );
    candidates := candidates || jsonb_build_array(candidate);
    ordinal := ordinal + 1;
  end loop;
  return candidates;
end;
$$;

-- ---------------------------------------------------------------------------
-- Provider-lane arbitration. Rename the 0054 GitHub authorizer behind a
-- revoked internal boundary, then retain its public RPC signature through a
-- wrapper that shares the aria_jobs lock order with the web lane. The job-row
-- lock makes both claim checks mutually exclusive even under concurrent RPCs.
-- ---------------------------------------------------------------------------
alter function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) rename to authorize_sourcing_batch_0054;

alter function public.authorize_sourcing_batch_0054(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
revoke all on function public.authorize_sourcing_batch_0054(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;

create function public.authorize_sourcing_batch(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_provider_mode text default 'anonymous'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_found boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  -- The internal 0054 function takes the same lock again before validation;
  -- row locks are transaction-scoped and re-entrant for this session.
  perform 1 from public.aria_jobs job where job.id = p_job_id for update;
  job_found := found;
  if job_found and exists (
    select 1 from public.autonomous_web_sourcing_claims web_claim
     where web_claim.job_id = p_job_id
  ) then
    return jsonb_build_object('status', 'provider_lane_conflict');
  end if;
  if job_found and exists (
    select 1 from public.sourcing_campaigns campaign
     where campaign.workspace_id = p_workspace_id
       and campaign.id = p_campaign_id
       and campaign.campaign_sha256 = p_campaign_sha256
       and public.autonomous_web_sourcing_expected_query(
         campaign.role_basis, p_batch_ordinal
       ) is not null
  ) then
    return jsonb_build_object('status', 'provider_lane_conflict');
  end if;

  return public.authorize_sourcing_batch_0054(
    p_job_id, p_lease_id, p_workspace_id, p_campaign_id, p_campaign_sha256,
    p_batch_ordinal, p_provider_mode
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-only authorize and begin fence. The caller sends only the returned
-- locator to the later route; provider, query, credential, and HTTP request are
-- resolved again inside begin immediately before egress.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_autonomous_web_sourcing(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  failure_row public.autonomous_web_sourcing_failures%rowtype;
  receipt_row public.autonomous_web_sourcing_receipts%rowtype;
  credential_row public.api_keys%rowtype;
  credential_count integer;
  query_value jsonb;
  request_value jsonb;
  wall_now timestamptz;
  expected_payload jsonb;
  expected_campaign_sha text;
  role_hash text;
  expected_role_fingerprint text;
  credential_version text;
  learning_control_row public.sourcing_learning_controls%rowtype;
  lesson_selection record;
  applied_lesson jsonb;
  token uuid;
  next_fence bigint := 1;
  reuse_prior_authority boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null or p_batch_ordinal not between 0 and 4 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  wall_now := clock_timestamp();
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  select * into receipt_row from public.autonomous_web_sourcing_receipts
   where job_id = p_job_id;
  if found then
    if job_row.workspace_id <> p_workspace_id
       or job_row.kind <> 'sourcing_batch'
       or job_row.payload <> expected_payload
       or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex')
       or receipt_row.lease_id <> p_lease_id
       or receipt_row.workspace_id <> p_workspace_id
       or receipt_row.campaign_id <> p_campaign_id then
      return jsonb_build_object('status', 'job_lease_invalid');
    end if;
    return jsonb_build_object(
      'status', 'no_op_replay',
      'jobId', p_job_id,
      'resultSha256', receipt_row.result_sha256,
      'candidateCount', receipt_row.candidate_count,
      'queryCount', 1
    );
  end if;
  if job_row.workspace_id <> p_workspace_id or job_row.kind <> 'sourcing_batch'
     or job_row.payload <> expected_payload
     or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex')
     or job_row.status <> 'leased' or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;
  if exists (
    select 1 from public.sourcing_batch_claims github_claim
     where github_claim.job_id = p_job_id
  ) then
    return jsonb_build_object('status', 'provider_lane_conflict');
  end if;

  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
   order by claim.fence_version desc
   limit 1
   for update;
  if found then
    select * into attempt_row from public.autonomous_web_sourcing_attempts attempt
     where attempt.job_id = p_job_id
       and attempt.claim_token = claim_row.claim_token
       and attempt.fence_version = claim_row.fence_version;
    if found then
      select * into failure_row from public.autonomous_web_sourcing_failures failure
       where failure.egress_attempt_id = attempt_row.id;
      if claim_row.lease_id = p_lease_id or not found
         or failure_row.disposition <> 'retry_scheduled' then
        return jsonb_build_object(
          'status', 'attempt_already_started',
          'egressAttemptId', attempt_row.id,
          'locator', jsonb_build_object(
            'jobId', claim_row.job_id,
            'leaseId', claim_row.lease_id,
            'workspaceId', claim_row.workspace_id,
            'campaignId', claim_row.campaign_id,
            'claimToken', claim_row.claim_token,
            'fenceVersion', claim_row.fence_version
          )
        );
      end if;
      reuse_prior_authority := true;
    end if;
    if attempt_row.id is null
       and claim_row.lease_id = p_lease_id and claim_row.expires_at > wall_now then
      return jsonb_build_object(
        'status', 'authorized',
        'locator', jsonb_build_object(
          'jobId', claim_row.job_id,
          'leaseId', claim_row.lease_id,
          'workspaceId', claim_row.workspace_id,
          'campaignId', claim_row.campaign_id,
          'claimToken', claim_row.claim_token,
          'fenceVersion', claim_row.fence_version
        )
      );
    end if;
    if attempt_row.id is null and claim_row.expires_at > wall_now then
      return jsonb_build_object(
        'status', 'claim_conflict',
        'retryAfter', claim_row.expires_at
      );
    end if;
    -- Both a pre-begin expiry and one explicitly retry-scheduled read-only
    -- provider failure advance by appending a new immutable claim. No prior
    -- token, fence, attempt, quota reservation, or failure row is rewritten.
    reuse_prior_authority := true;
    next_fence := claim_row.fence_version + 1;
  end if;

  select * into campaign_row from public.sourcing_campaigns
   where workspace_id = p_workspace_id and id = p_campaign_id for share;
  if not found or campaign_row.campaign_sha256 <> p_campaign_sha256
     or campaign_row.status <> 'sourcing' then
    return jsonb_build_object('status', 'campaign_invalid');
  end if;
  expected_campaign_sha := encode(sha256(convert_to(jsonb_build_object(
    'campaign_id', campaign_row.id::text,
    'workspace_id', campaign_row.workspace_id::text,
    'requisition_id', campaign_row.requisition_id::text,
    'activation_actor_id', campaign_row.activation_actor_id::text,
    'role_basis', campaign_row.role_basis,
    'parse_input_sha256', campaign_row.parse_input_sha256,
    'parse_result_sha256', campaign_row.parse_result_sha256
  )::text, 'UTF8')), 'hex');
  if expected_campaign_sha <> campaign_row.campaign_sha256 then
    return jsonb_build_object('status', 'campaign_invalid');
  end if;
  if not exists (
    select 1 from public.sourcing_loop_controls control
    join public.profiles activation
      on activation.workspace_id = control.workspace_id
     and activation.id = control.updated_by
     and activation.role = 'admin'
    join public.workspace_state state on state.workspace_id = control.workspace_id
   where control.workspace_id = p_workspace_id
     and not control.kill_switch and control.sourcing_enabled
     and control.max_sourcing_runs_per_day > 0
     and control.updated_by = campaign_row.activation_actor_id
     and public.sourcing_campaign_document_status(state.state, p_campaign_id) = 'Sourcing'
  ) then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;

  role_hash := encode(sha256(convert_to(campaign_row.role_basis::text, 'UTF8')), 'hex');
  if reuse_prior_authority then
    if claim_row.workspace_id <> p_workspace_id
       or claim_row.requisition_id <> campaign_row.requisition_id
       or claim_row.campaign_id <> p_campaign_id
       or claim_row.campaign_sha256 <> p_campaign_sha256
       or claim_row.batch_ordinal <> p_batch_ordinal
       or claim_row.provider <> 'tavily'
       or claim_row.role_basis_sha256 <> role_hash
       or not public.autonomous_web_sourcing_query_is_allowed(
         campaign_row.role_basis, claim_row.canonical_query
       )
       or claim_row.canonical_query ->> 'sha256' <> claim_row.canonical_query_sha256
       or public.autonomous_web_sourcing_request_sha256(
         public.autonomous_web_sourcing_request(claim_row.canonical_query)
       ) <> claim_row.request_sha256 then
      return jsonb_build_object('status', 'prior_authority_invalid');
    end if;
    query_value := claim_row.canonical_query;
    applied_lesson := claim_row.applied_lesson;
  else
    query_value := public.autonomous_web_sourcing_expected_query(
      campaign_row.role_basis, p_batch_ordinal
    );
    if query_value is null then
      return jsonb_build_object('status', 'role_not_approved_for_web');
    end if;
  end if;

  -- Learning can only reorder SQL-derived LinkedIn variants for this exact
  -- role. The immutable claim binds the human promotion, Graphify artifact,
  -- lesson version, exact query, and snapshot hash before provider egress.
  if not reuse_prior_authority then
    select * into learning_control_row
    from public.sourcing_learning_controls control
   where control.workspace_id = p_workspace_id
     and control.enabled
     and control.required_graphify_image_digest is not null
   for share;
    if found and exists (
    select 1 from public.sourcing_learning_secrets secret
     where secret.workspace_id = p_workspace_id
  ) then
    expected_role_fingerprint := public.sourcing_authority_hmac(
      p_workspace_id,
      campaign_row.role_basis::text
    );
    select lesson.id as lesson_id,
           lesson.version as lesson_version,
           lesson.graphify_cluster_ref,
           lesson.query_hmac,
           artifact.id as graphify_export_id,
           artifact.graph_sha256 as graphify_artifact_sha256,
           artifact.image_digest as graphify_image_digest,
           artifact.graphify_commit,
           review.id as promotion_review_id,
           review.reviewer_id as promoted_by,
           candidate.canonical_query
      into lesson_selection
      from public.sourcing_lessons lesson
      join public.sourcing_graphify_exports artifact
        on artifact.workspace_id = lesson.workspace_id
       and artifact.id = lesson.graphify_export_id
       and artifact.status = 'completed'
       and artifact.graph_sha256 = lesson.graphify_artifact_sha256
       and artifact.graphify_commit = lesson.graphify_commit
       and artifact.graphify_commit = learning_control_row.required_graphify_commit
       and artifact.image_digest = learning_control_row.required_graphify_image_digest
       and artifact.expires_at > wall_now
      join public.sourcing_lesson_reviews review
        on review.workspace_id = lesson.workspace_id
       and review.lesson_id = lesson.id
       and review.reviewer_kind = 'human'
       and review.reviewer_id is not null
       and review.new_status = 'promoted'
       and review.reason_code = 'reviewed_useful'
       and review.lesson_version = lesson.version
      cross join lateral (
        select public.autonomous_web_sourcing_expected_query(
          campaign_row.role_basis,
          candidate_ordinal
        ) as canonical_query
          from generate_series(0, 4) candidate_ordinal
      ) candidate
     where lesson.workspace_id = p_workspace_id
       and lesson.role_fingerprint = expected_role_fingerprint
       and lesson.platform = 'LinkedIn'
       and lesson.status = 'promoted'
       and lesson.promoted_by = review.reviewer_id
       and lesson.expires_at > wall_now
       and lesson.graphify_artifact_sha256 is not null
       and lesson.graphify_cluster_ref is not null
       and lesson.graphify_commit is not null
       and lesson.graphify_export_id is not null
       and candidate.canonical_query is not null
       and lesson.query_text = candidate.canonical_query ->> 'value'
       and lesson.query_hmac = public.sourcing_authority_hmac(
         p_workspace_id,
         'query:LinkedIn:' || (candidate.canonical_query ->> 'value')
       )
       and not exists (
         select 1
           from public.autonomous_web_sourcing_claims prior_claim
          where prior_claim.workspace_id = p_workspace_id
            and prior_claim.campaign_id = p_campaign_id
            and prior_claim.campaign_sha256 = p_campaign_sha256
            and prior_claim.job_id <> p_job_id
            and prior_claim.applied_lesson is not null
            and prior_claim.canonical_query = candidate.canonical_query
       )
     order by lesson.useful_feedback_count desc,
              lesson.evidence_run_count desc,
              lesson.updated_at desc,
              lesson.id,
              review.created_at desc,
              review.id
     limit 1
     for share of lesson, artifact;
      if found then
      query_value := lesson_selection.canonical_query;
      applied_lesson := jsonb_build_object(
        'workspace_id', p_workspace_id::text,
        'role_fingerprint', expected_role_fingerprint,
        'lesson_id', lesson_selection.lesson_id::text,
        'lesson_version', lesson_selection.lesson_version,
        'promotion_review_id', lesson_selection.promotion_review_id::text,
        'promoted_by', lesson_selection.promoted_by::text,
        'graphify_export_id', lesson_selection.graphify_export_id::text,
        'graphify_artifact_sha256', lesson_selection.graphify_artifact_sha256,
        'graphify_image_digest', lesson_selection.graphify_image_digest,
        'graphify_commit', lesson_selection.graphify_commit,
        'graphify_cluster_ref', lesson_selection.graphify_cluster_ref,
        'query_hmac', lesson_selection.query_hmac,
        'query_value', query_value ->> 'value',
        'query_sha256', query_value ->> 'sha256'
      );
      applied_lesson := applied_lesson || jsonb_build_object(
        'snapshot_sha256', public.sourcing_batch_lesson_snapshot_sha256(applied_lesson)
      );
      end if;
    end if;
  end if;

  select count(*) into credential_count from public.api_keys key_row
   where key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours';
  if credential_count <> 1 then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;
  select * into credential_row from public.api_keys key_row
   where key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours'
   for share;
  credential_version := public.autonomous_web_sourcing_credential_version(
    credential_row.id, credential_row.workspace_id, credential_row.provider,
    credential_row.last4, credential_row.last_tested_at,
    credential_row.verification_method, credential_row.verification_http_status
  );
  request_value := public.autonomous_web_sourcing_request(query_value);
  token := gen_random_uuid();
  insert into public.autonomous_web_sourcing_claims(
    job_id, lease_id, workspace_id, requisition_id, campaign_id, campaign_sha256,
    batch_ordinal, claim_token, fence_version, provider, credential_id,
    credential_version, credential_verified_at, query_policy_version,
    canonical_query, applied_lesson, canonical_query_sha256, request_sha256,
    role_basis_sha256,
    authorized_at, expires_at
  ) values (
    p_job_id, p_lease_id, p_workspace_id, campaign_row.requisition_id,
    p_campaign_id, p_campaign_sha256, p_batch_ordinal, token, next_fence, 'tavily',
    credential_row.id, credential_version, credential_row.last_tested_at,
    query_value ->> 'policyVersion', query_value, applied_lesson,
    query_value ->> 'sha256',
    public.autonomous_web_sourcing_request_sha256(request_value), role_hash,
    wall_now, wall_now + interval '2 minutes'
  );
  return jsonb_build_object(
    'status', 'authorized',
    'locator', jsonb_build_object(
      'jobId', p_job_id,
      'leaseId', p_lease_id,
      'workspaceId', p_workspace_id,
      'campaignId', p_campaign_id,
      'claimToken', token,
      'fenceVersion', next_fence
    )
  );
end;
$$;

create or replace function public.begin_autonomous_web_sourcing_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_claim_token uuid,
  p_fence_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  credential_row public.api_keys%rowtype;
  credential_count integer;
  control_row public.sourcing_loop_controls%rowtype;
  query_value jsonb;
  request_value jsonb;
  version_value text;
  wall_now timestamptz;
  minute_window timestamptz;
  day_window timestamptz;
  provider_used integer;
  workspace_used integer;
  attempt_id uuid;
  resume_unconfirmed boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  wall_now := clock_timestamp();
  if not found or job_row.workspace_id <> p_workspace_id
     or job_row.status <> 'leased' or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;
  if exists (select 1 from public.autonomous_web_sourcing_receipts where job_id = p_job_id) then
    return jsonb_build_object('status', 'no_op_replay');
  end if;
  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token
     and claim.fence_version = p_fence_version
     and not exists (
       select 1 from public.autonomous_web_sourcing_claims newer
        where newer.job_id = claim.job_id
          and newer.fence_version > claim.fence_version
     )
   for share;
  if not found or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id or claim_row.campaign_id <> p_campaign_id
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or claim_row.expires_at <= wall_now then
    return jsonb_build_object('status', 'claim_invalid');
  end if;
  select * into attempt_row from public.autonomous_web_sourcing_attempts attempt
   where attempt.job_id = p_job_id
     and attempt.claim_token = p_claim_token
     and attempt.fence_version = p_fence_version;
  if found then
    -- Losing the first begin response is still provably pre-egress: the
    -- runtime cannot fetch until the separate confirmation row exists. Reissue
    -- only this exact live authority. Once confirmation exists, retries are
    -- reconciliation-only and can never receive provider request authority.
    if exists (
      select 1 from public.autonomous_web_sourcing_confirmations confirmation
       where confirmation.egress_attempt_id = attempt_row.id
    ) or exists (
      select 1 from public.autonomous_web_sourcing_results result
       where result.egress_attempt_id = attempt_row.id
    ) or exists (
      select 1 from public.autonomous_web_sourcing_failures failure
       where failure.egress_attempt_id = attempt_row.id
    ) or exists (
      select 1 from public.autonomous_web_sourcing_receipts receipt
       where receipt.egress_attempt_id = attempt_row.id
    ) then
      return jsonb_build_object(
        'status', 'already_begun',
        'egressAttemptId', attempt_row.id
      );
    end if;
    if attempt_row.lease_id <> p_lease_id
       or attempt_row.workspace_id <> p_workspace_id
       or attempt_row.campaign_id <> p_campaign_id
       or attempt_row.claim_token <> p_claim_token
       or attempt_row.fence_version <> p_fence_version
       or attempt_row.provider <> claim_row.provider
       or attempt_row.credential_id <> claim_row.credential_id
       or attempt_row.credential_version <> claim_row.credential_version
       or attempt_row.query_policy_version <> claim_row.query_policy_version
       or attempt_row.canonical_query_sha256 <> claim_row.canonical_query_sha256
       or attempt_row.request_sha256 <> claim_row.request_sha256
       or attempt_row.egress_expires_at <= wall_now then
      return jsonb_build_object(
        'status', 'already_begun',
        'egressAttemptId', attempt_row.id
      );
    end if;
    resume_unconfirmed := true;
  end if;
  select * into campaign_row from public.sourcing_campaigns
   where workspace_id = p_workspace_id and id = p_campaign_id for share;
  select * into control_row from public.sourcing_loop_controls
   where workspace_id = p_workspace_id for share;
  if campaign_row.id is null or control_row.workspace_id is null
     or campaign_row.campaign_sha256 <> claim_row.campaign_sha256
     or campaign_row.requisition_id <> claim_row.requisition_id
     or campaign_row.status <> 'sourcing'
     or control_row.kill_switch or not control_row.sourcing_enabled
     or control_row.max_sourcing_runs_per_day <= 0
     or control_row.updated_by <> campaign_row.activation_actor_id
     or not exists (
       select 1 from public.profiles profile
        where profile.workspace_id = p_workspace_id
          and profile.id = campaign_row.activation_actor_id
          and profile.role = 'admin' for share
     )
     or not exists (
       select 1 from public.workspace_state state
        where state.workspace_id = p_workspace_id
          and public.sourcing_campaign_document_status(state.state, p_campaign_id) = 'Sourcing'
        for share
     ) then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;
  query_value := claim_row.canonical_query;
  request_value := public.autonomous_web_sourcing_request(query_value);
  if not public.autonomous_web_sourcing_query_is_allowed(
       campaign_row.role_basis, query_value
     )
     or query_value ->> 'sha256' <> claim_row.canonical_query_sha256
     or public.autonomous_web_sourcing_request_sha256(request_value) <> claim_row.request_sha256
     or encode(sha256(convert_to(campaign_row.role_basis::text, 'UTF8')), 'hex')
       <> claim_row.role_basis_sha256 then
    return jsonb_build_object('status', 'query_invalid');
  end if;

  select count(*) into credential_count from public.api_keys key_row
   where key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours';
  if credential_count <> 1 then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;
  select * into credential_row from public.api_keys key_row
   where key_row.id = claim_row.credential_id
     and key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours'
   for share;
  if not found then return jsonb_build_object('status', 'credential_unavailable'); end if;
  version_value := public.autonomous_web_sourcing_credential_version(
    credential_row.id, credential_row.workspace_id, credential_row.provider,
    credential_row.last4, credential_row.last_tested_at,
    credential_row.verification_method, credential_row.verification_http_status
  );
  if version_value <> claim_row.credential_version
     or credential_row.last_tested_at <> claim_row.credential_verified_at then
    return jsonb_build_object('status', 'credential_changed');
  end if;

  if resume_unconfirmed then
    if (
      select count(*) = 2
         and count(*) filter (where ledger.scope_kind = 'provider_minute') = 1
         and count(*) filter (where ledger.scope_kind = 'workspace_day') = 1
        from public.autonomous_web_sourcing_quota_ledger ledger
       where ledger.egress_attempt_id = attempt_row.id
         and ledger.workspace_id = p_workspace_id
         and ledger.provider = 'tavily'
         and ledger.reserved_units = 1
    ) then
      return jsonb_build_object(
        'status', 'begun',
        'egressAttemptId', attempt_row.id,
        'provider', attempt_row.provider,
        'credentialId', attempt_row.credential_id,
        'credentialVersion', attempt_row.credential_version,
        'queryPolicyVersion', attempt_row.query_policy_version,
        'canonicalQuerySha256', attempt_row.canonical_query_sha256,
        'requestSha256', attempt_row.request_sha256,
        'request', request_value,
        'egressExpiresAt', attempt_row.egress_expires_at
      );
    end if;
    return jsonb_build_object(
      'status', 'already_begun',
      'egressAttemptId', attempt_row.id
    );
  end if;

  minute_window := date_trunc('minute', wall_now);
  day_window := date_trunc('day', wall_now at time zone 'UTC') at time zone 'UTC';
  perform pg_advisory_xact_lock(hashtextextended('tavily:provider-minute:' || minute_window::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'tavily:workspace-day:' || p_workspace_id::text || ':' || day_window::text, 0
  ));
  select coalesce(sum(reserved_units), 0) into provider_used
    from public.autonomous_web_sourcing_quota_ledger
   where provider = 'tavily' and scope_kind = 'provider_minute'
     and window_start = minute_window;
  select coalesce(sum(reserved_units), 0) into workspace_used
    from public.autonomous_web_sourcing_quota_ledger
   where workspace_id = p_workspace_id and scope_kind = 'workspace_day'
     and window_start = day_window;
  if provider_used >= 30 or workspace_used >= control_row.max_sourcing_runs_per_day then
    return jsonb_build_object('status', 'quota_exhausted');
  end if;

  attempt_id := gen_random_uuid();
  insert into public.autonomous_web_sourcing_attempts(
    id, job_id, lease_id, workspace_id, requisition_id, campaign_id,
    claim_token, fence_version, provider, credential_id, credential_version,
    query_policy_version, canonical_query_sha256, request_sha256,
    begun_at, egress_expires_at
  ) values (
    attempt_id, p_job_id, p_lease_id, p_workspace_id, claim_row.requisition_id,
    p_campaign_id, p_claim_token, p_fence_version, 'tavily',
    claim_row.credential_id, claim_row.credential_version,
    claim_row.query_policy_version, claim_row.canonical_query_sha256,
    claim_row.request_sha256, wall_now, wall_now + interval '30 seconds'
  );
  insert into public.autonomous_web_sourcing_quota_ledger(
    egress_attempt_id, workspace_id, provider, scope_kind, window_start, reserved_units
  ) values
    (attempt_id, p_workspace_id, 'tavily', 'provider_minute', minute_window, 1),
    (attempt_id, p_workspace_id, 'tavily', 'workspace_day', day_window, 1);
  return jsonb_build_object(
    'status', 'begun',
    'egressAttemptId', attempt_id,
    'provider', 'tavily',
    'credentialId', claim_row.credential_id,
    'credentialVersion', claim_row.credential_version,
    'queryPolicyVersion', claim_row.query_policy_version,
    'canonicalQuerySha256', claim_row.canonical_query_sha256,
    'requestSha256', claim_row.request_sha256,
    'request', request_value,
    'egressExpiresAt', wall_now + interval '30 seconds'
  );
end;
$$;

create or replace function public.confirm_autonomous_web_sourcing_egress(
  p_egress_attempt_id uuid,
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_claim_token uuid,
  p_fence_version bigint,
  p_credential_id uuid,
  p_credential_version text,
  p_query_policy_version text,
  p_canonical_query_sha256 text,
  p_request_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  confirmation_row public.autonomous_web_sourcing_confirmations%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  credential_row public.api_keys%rowtype;
  credential_count integer;
  control_row public.sourcing_loop_controls%rowtype;
  current_version text;
  expected_query jsonb;
  expected_request jsonb;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_egress_attempt_id is null or p_job_id is null or p_lease_id is null
     or p_workspace_id is null or p_campaign_id is null or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_credential_id is null or p_credential_version !~ '^[0-9a-f]{64}$'
     or p_query_policy_version <> 'tavily-linkedin-deterministic-v1'
     or p_canonical_query_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  -- Serialize confirmation retries before testing the immutable confirmation
  -- row. A lost response can then be retried without a unique-key exception.
  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-web-confirm:' || p_egress_attempt_id::text, 0
  ));
  select * into confirmation_row from public.autonomous_web_sourcing_confirmations
   where egress_attempt_id = p_egress_attempt_id;
  if found then
    if exists (
      select 1 from public.autonomous_web_sourcing_claims newer
       where newer.job_id = p_job_id
         and newer.fence_version > p_fence_version
    ) then
      return jsonb_build_object('status', 'attempt_binding_invalid');
    end if;
    if confirmation_row.job_id = p_job_id
       and confirmation_row.lease_id = p_lease_id
       and confirmation_row.workspace_id = p_workspace_id
       and confirmation_row.campaign_id = p_campaign_id
       and confirmation_row.claim_token = p_claim_token
       and confirmation_row.fence_version = p_fence_version
       and confirmation_row.credential_id = p_credential_id
       and confirmation_row.credential_version = p_credential_version
       and confirmation_row.query_policy_version = p_query_policy_version
       and confirmation_row.canonical_query_sha256 = p_canonical_query_sha256
       and confirmation_row.request_sha256 = p_request_sha256 then
      return jsonb_build_object(
        'status', 'already_confirmed',
        'egressAttemptId', p_egress_attempt_id,
        'mustStartBy', confirmation_row.must_start_by
      );
    end if;
    return jsonb_build_object('status', 'confirmation_conflict');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  wall_now := clock_timestamp();
  if not found or job_row.workspace_id <> p_workspace_id
     or job_row.status <> 'leased' or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = p_egress_attempt_id for share;
  if not found or attempt_row.job_id <> p_job_id or attempt_row.lease_id <> p_lease_id
     or attempt_row.workspace_id <> p_workspace_id
     or attempt_row.campaign_id <> p_campaign_id
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version
     or attempt_row.credential_id <> p_credential_id
     or attempt_row.credential_version <> p_credential_version
     or attempt_row.query_policy_version <> p_query_policy_version
     or attempt_row.canonical_query_sha256 <> p_canonical_query_sha256
     or attempt_row.request_sha256 <> p_request_sha256
     or attempt_row.egress_expires_at <= wall_now then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  if exists (select 1 from public.autonomous_web_sourcing_results result
              where result.egress_attempt_id = p_egress_attempt_id)
     or exists (select 1 from public.autonomous_web_sourcing_failures failure
                where failure.egress_attempt_id = p_egress_attempt_id)
     or exists (select 1 from public.autonomous_web_sourcing_receipts receipt
                where receipt.egress_attempt_id = p_egress_attempt_id) then
    return jsonb_build_object('status', 'attempt_settled');
  end if;
  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token
     and claim.fence_version = p_fence_version
     and not exists (
       select 1 from public.autonomous_web_sourcing_claims newer
        where newer.job_id = claim.job_id
          and newer.fence_version > claim.fence_version
     )
   for share;
  if not found or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.campaign_id <> p_campaign_id
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or claim_row.credential_id <> p_credential_id
     or claim_row.credential_version <> p_credential_version
     or claim_row.query_policy_version <> p_query_policy_version
     or claim_row.canonical_query_sha256 <> p_canonical_query_sha256
     or claim_row.request_sha256 <> p_request_sha256 then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  select * into campaign_row from public.sourcing_campaigns
   where workspace_id = p_workspace_id and id = p_campaign_id for share;
  select * into control_row from public.sourcing_loop_controls
   where workspace_id = p_workspace_id for share;
  if campaign_row.id is null or control_row.workspace_id is null
     or campaign_row.requisition_id <> attempt_row.requisition_id
     or campaign_row.campaign_sha256 <> claim_row.campaign_sha256
     or campaign_row.status <> 'sourcing'
     or control_row.kill_switch or not control_row.sourcing_enabled
     or control_row.max_sourcing_runs_per_day <= 0
     or control_row.updated_by <> campaign_row.activation_actor_id
     or not exists (
       select 1 from public.profiles profile
        where profile.workspace_id = p_workspace_id
          and profile.id = campaign_row.activation_actor_id
          and profile.role = 'admin' for share
     )
     or not exists (
       select 1 from public.workspace_state state
        where state.workspace_id = p_workspace_id
          and public.sourcing_campaign_document_status(state.state, p_campaign_id) = 'Sourcing'
        for share
     ) then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;
  expected_query := claim_row.canonical_query;
  expected_request := public.autonomous_web_sourcing_request(expected_query);
  if not public.autonomous_web_sourcing_query_is_allowed(
       campaign_row.role_basis, expected_query
     )
     or expected_query ->> 'sha256' <> p_canonical_query_sha256
     or public.autonomous_web_sourcing_request_sha256(expected_request) <> p_request_sha256
     or encode(sha256(convert_to(campaign_row.role_basis::text, 'UTF8')), 'hex')
       <> claim_row.role_basis_sha256 then
    return jsonb_build_object('status', 'query_invalid');
  end if;
  select count(*) into credential_count from public.api_keys key_row
   where key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours';
  if credential_count <> 1 then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;
  select * into credential_row from public.api_keys key_row
   where key_row.id = p_credential_id and key_row.workspace_id = p_workspace_id
     and key_row.provider = 'Tavily'
     and public.ai_execution_credential_verified(
       key_row.provider, key_row.status, key_row.last_tested_at,
       key_row.verification_method, key_row.verification_http_status
     )
     and key_row.last_tested_at > wall_now - interval '24 hours'
   for share;
  if not found then return jsonb_build_object('status', 'credential_unavailable'); end if;
  current_version := public.autonomous_web_sourcing_credential_version(
    credential_row.id, credential_row.workspace_id, credential_row.provider,
    credential_row.last4, credential_row.last_tested_at,
    credential_row.verification_method, credential_row.verification_http_status
  );
  if current_version <> p_credential_version then
    return jsonb_build_object('status', 'credential_changed');
  end if;
  insert into public.autonomous_web_sourcing_confirmations(
    egress_attempt_id, job_id, lease_id, workspace_id, campaign_id,
    claim_token, fence_version, credential_id, credential_version,
    query_policy_version, canonical_query_sha256, request_sha256,
    confirmed_at, must_start_by
  ) values (
    p_egress_attempt_id, p_job_id, p_lease_id, p_workspace_id, p_campaign_id,
    p_claim_token, p_fence_version, p_credential_id, p_credential_version,
    p_query_policy_version, p_canonical_query_sha256, p_request_sha256,
    wall_now, wall_now + interval '10 seconds'
  );
  return jsonb_build_object(
    'status', 'confirmed',
    'egressAttemptId', p_egress_attempt_id,
    'mustStartBy', wall_now + interval '10 seconds'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Durable response registration. This is called only after a real provider
-- response has been received. Raw bytes are hashed and counted, never stored.
-- ---------------------------------------------------------------------------
create or replace function public.record_autonomous_web_sourcing_result(
  p_egress_attempt_id uuid,
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_claim_token uuid,
  p_fence_version bigint,
  p_provider text,
  p_credential_id uuid,
  p_credential_version text,
  p_query_policy_version text,
  p_canonical_query_sha256 text,
  p_request_sha256 text,
  p_raw_response_sha256 text,
  p_raw_response_bytes integer,
  p_provider_receipt jsonb,
  p_normalized_results jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  confirmation_row public.autonomous_web_sourcing_confirmations%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  existing_result public.autonomous_web_sourcing_results%rowtype;
  candidates jsonb;
  normalized_sha text;
  receipt_sha text;
  result_sha text;
  expected_receipt jsonb;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_egress_attempt_id is null or p_job_id is null or p_lease_id is null
     or p_workspace_id is null or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_provider <> 'tavily' or p_credential_id is null
     or p_credential_version !~ '^[0-9a-f]{64}$'
     or p_query_policy_version <> 'tavily-linkedin-deterministic-v1'
     or p_canonical_query_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_sha256 !~ '^[0-9a-f]{64}$'
     or p_raw_response_sha256 !~ '^[0-9a-f]{64}$'
     or p_raw_response_bytes not between 2 and 1048576
     or p_provider_receipt is null or jsonb_typeof(p_provider_receipt) <> 'object'
     or p_normalized_results is null or jsonb_typeof(p_normalized_results) <> 'array'
     or jsonb_array_length(p_normalized_results) > 5 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  -- Serialize durable-result registration with failure settlement and the
  -- generic lease reaper. Without the queue-row lock, both sides could observe
  -- an unsettled attempt and append contradictory immutable outcomes.
  select * into job_row from public.aria_jobs job
   where job.id = p_job_id for update;
  if not found or job_row.workspace_id <> p_workspace_id
     or job_row.kind <> 'sourcing_batch'
     or job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = p_egress_attempt_id for share;
  if not found or attempt_row.job_id <> p_job_id or attempt_row.lease_id <> p_lease_id
     or attempt_row.workspace_id <> p_workspace_id
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version
     or attempt_row.provider <> p_provider
     or attempt_row.credential_id <> p_credential_id
     or attempt_row.credential_version <> p_credential_version
     or attempt_row.query_policy_version <> p_query_policy_version
     or attempt_row.canonical_query_sha256 <> p_canonical_query_sha256
     or attempt_row.request_sha256 <> p_request_sha256 then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  wall_now := clock_timestamp();
  select * into confirmation_row from public.autonomous_web_sourcing_confirmations
   where egress_attempt_id = p_egress_attempt_id;
  if not found
     or confirmation_row.job_id <> p_job_id
     or confirmation_row.lease_id <> p_lease_id
     or confirmation_row.workspace_id <> p_workspace_id
     or confirmation_row.claim_token <> p_claim_token
     or confirmation_row.fence_version <> p_fence_version
     or confirmation_row.credential_id <> p_credential_id
     or confirmation_row.credential_version <> p_credential_version
     or confirmation_row.query_policy_version <> p_query_policy_version
     or confirmation_row.canonical_query_sha256 <> p_canonical_query_sha256
     or confirmation_row.request_sha256 <> p_request_sha256
     or confirmation_row.confirmed_at > wall_now
     -- The runtime has ten seconds to start its fixed 15-second request. Give
     -- the local record RPC five bounded seconds to arrive, but never accept a
     -- provider result from an arbitrarily delayed service-role caller.
     or wall_now > confirmation_row.must_start_by + interval '20 seconds' then
    return jsonb_build_object('status', 'egress_not_confirmed');
  end if;
  if exists (
    select 1 from public.autonomous_web_sourcing_failures failure
     where failure.egress_attempt_id = p_egress_attempt_id
  ) then return jsonb_build_object('status', 'outcome_conflict'); end if;
  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token
     and claim.fence_version = p_fence_version
     and not exists (
       select 1 from public.autonomous_web_sourcing_claims newer
        where newer.job_id = claim.job_id
          and newer.fence_version > claim.fence_version
     );
  if not found then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  candidates := public.autonomous_web_sourcing_candidates(
    p_workspace_id, attempt_row.campaign_id, p_egress_attempt_id,
    (select role_basis from public.sourcing_campaigns
      where workspace_id = p_workspace_id and id = attempt_row.campaign_id),
    claim_row.canonical_query || jsonb_build_object('batchOrdinal', claim_row.batch_ordinal),
    p_raw_response_sha256, p_normalized_results, attempt_row.begun_at
  );
  expected_receipt := jsonb_build_object(
    'provider', 'tavily',
    'providerRequestId', coalesce(p_provider_receipt ->> 'providerRequestId', ''),
    'responseTimeMs', (p_provider_receipt ->> 'responseTimeMs')::integer,
    'resultCount', jsonb_array_length(p_normalized_results),
    'querySha256', p_canonical_query_sha256,
    'requestSha256', p_request_sha256,
    'rawResponseSha256', p_raw_response_sha256,
    'rawResponseBytes', p_raw_response_bytes
  );
  if p_provider_receipt <> expected_receipt
     or p_provider_receipt - array[
       'provider','providerRequestId','responseTimeMs','resultCount','querySha256',
       'requestSha256','rawResponseSha256','rawResponseBytes'
     ] <> '{}'::jsonb
     or coalesce(p_provider_receipt ->> 'providerRequestId', '')
        !~ '^[A-Za-z0-9._:-]{0,160}$'
     or (p_provider_receipt ->> 'responseTimeMs') !~ '^[0-9]{1,9}$' then
    return jsonb_build_object('status', 'provider_receipt_invalid');
  end if;
  normalized_sha := encode(sha256(convert_to(p_normalized_results::text, 'UTF8')), 'hex');
  receipt_sha := encode(sha256(convert_to(expected_receipt::text, 'UTF8')), 'hex');
  result_sha := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.autonomous-web-result.v1',
    p_egress_attempt_id::text,
    p_job_id::text,
    p_workspace_id::text,
    attempt_row.campaign_id::text,
    p_canonical_query_sha256,
    p_request_sha256,
    p_raw_response_sha256,
    p_raw_response_bytes::text,
    normalized_sha,
    receipt_sha,
    jsonb_array_length(candidates)::text
  ), 'UTF8')), 'hex');
  select * into existing_result from public.autonomous_web_sourcing_results
   where egress_attempt_id = p_egress_attempt_id;
  if found then
    if existing_result.result_sha256 = result_sha then
      return jsonb_build_object(
        'status', 'recorded',
        'resultSha256', result_sha,
        'candidateCount', existing_result.result_count
      );
    end if;
    return jsonb_build_object('status', 'result_conflict');
  end if;
  insert into public.autonomous_web_sourcing_results(
    egress_attempt_id, job_id, workspace_id, raw_response_sha256,
    raw_response_bytes, normalized_results_sha256, provider_receipt_sha256,
    result_sha256, result_count
  ) values (
    p_egress_attempt_id, p_job_id, p_workspace_id, p_raw_response_sha256,
    p_raw_response_bytes, normalized_sha, receipt_sha, result_sha,
    jsonb_array_length(candidates)
  );
  insert into public.autonomous_web_sourcing_staged_results(
    egress_attempt_id, workspace_id, normalized_results, provider_receipt
  ) values (
    p_egress_attempt_id, p_workspace_id, p_normalized_results, expected_receipt
  );
  return jsonb_build_object(
    'status', 'recorded',
    'resultSha256', result_sha,
    'candidateCount', jsonb_array_length(candidates)
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('status', 'provider_receipt_invalid');
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic candidate projection, evidence receipt, and job completion.
-- ---------------------------------------------------------------------------
create or replace function public.commit_autonomous_web_sourcing(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_claim_token uuid,
  p_fence_version bigint,
  p_egress_attempt_id uuid,
  p_result_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  result_row public.autonomous_web_sourcing_results%rowtype;
  stage_row public.autonomous_web_sourcing_staged_results%rowtype;
  receipt_row public.autonomous_web_sourcing_receipts%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  workspace_row public.workspace_state%rowtype;
  candidates jsonb;
  novel_candidates jsonb;
  merged_candidates jsonb;
  merged_campaigns jsonb;
  projected_campaign jsonb;
  activity jsonb;
  candidate jsonb;
  evidence jsonb;
  document_status text;
  unique_candidate_total integer;
  wall_now timestamptz;
  updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_egress_attempt_id is null or p_result_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into receipt_row from public.autonomous_web_sourcing_receipts
   where job_id = p_job_id;
  if found then
    if receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.campaign_id = p_campaign_id
       and receipt_row.claim_token = p_claim_token
       and receipt_row.fence_version = p_fence_version
       and receipt_row.egress_attempt_id = p_egress_attempt_id
       and receipt_row.result_sha256 = p_result_sha256 then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'resultSha256', p_result_sha256,
        'candidateCount', receipt_row.candidate_count
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  wall_now := clock_timestamp();
  if not found or job_row.workspace_id <> p_workspace_id
     or job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;
  -- Candidate erasure takes workspace_state before candidate identity locks
  -- and staged-payload deletion. Take the same leading lock here so commit and
  -- erasure cannot form workspace/identity or workspace/stage deadlocks.
  select * into workspace_row from public.workspace_state
   where workspace_id = p_workspace_id for update;
  if not found or jsonb_typeof(workspace_row.state) <> 'object'
     or jsonb_typeof(workspace_row.state -> 'campaigns') <> 'array'
     or (workspace_row.state ? 'candidates'
       and jsonb_typeof(workspace_row.state -> 'candidates') <> 'array') then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token
     and claim.fence_version = p_fence_version
     and not exists (
       select 1 from public.autonomous_web_sourcing_claims newer
        where newer.job_id = claim.job_id
          and newer.fence_version > claim.fence_version
     )
   for share;
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = p_egress_attempt_id for share;
  select * into result_row from public.autonomous_web_sourcing_results
   where egress_attempt_id = p_egress_attempt_id for share;
  select * into stage_row from public.autonomous_web_sourcing_staged_results
   where egress_attempt_id = p_egress_attempt_id for update;
  if claim_row.job_id is null or attempt_row.id is null
     or result_row.egress_attempt_id is null or stage_row.egress_attempt_id is null
     or claim_row.claim_token <> p_claim_token or claim_row.fence_version <> p_fence_version
     or claim_row.workspace_id <> p_workspace_id or claim_row.campaign_id <> p_campaign_id
     or attempt_row.job_id <> p_job_id or attempt_row.lease_id <> p_lease_id
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version
     or result_row.job_id <> p_job_id or result_row.workspace_id <> p_workspace_id
     or result_row.result_sha256 <> p_result_sha256
     or stage_row.workspace_id <> p_workspace_id
     or stage_row.expires_at <= wall_now then
    return jsonb_build_object('status', 'result_binding_invalid');
  end if;
  if exists (
    select 1 from public.autonomous_web_sourcing_failures failure
     where failure.egress_attempt_id = p_egress_attempt_id
  ) then return jsonb_build_object('status', 'outcome_conflict'); end if;

  select * into campaign_row from public.sourcing_campaigns
   where workspace_id = p_workspace_id and id = p_campaign_id for update;
  if not found or campaign_row.requisition_id <> claim_row.requisition_id
     or campaign_row.campaign_sha256 <> claim_row.campaign_sha256 then
    return jsonb_build_object('status', 'campaign_changed');
  end if;
  candidates := public.autonomous_web_sourcing_candidates(
    p_workspace_id, p_campaign_id, p_egress_attempt_id, campaign_row.role_basis,
    claim_row.canonical_query || jsonb_build_object('batchOrdinal', claim_row.batch_ordinal),
    result_row.raw_response_sha256, stage_row.normalized_results, attempt_row.begun_at
  );
  if jsonb_array_length(candidates) <> result_row.result_count
     or encode(sha256(convert_to(stage_row.normalized_results::text, 'UTF8')), 'hex')
       <> result_row.normalized_results_sha256
     or encode(sha256(convert_to(stage_row.provider_receipt::text, 'UTF8')), 'hex')
       <> result_row.provider_receipt_sha256 then
    return jsonb_build_object('status', 'result_binding_invalid');
  end if;
  document_status := public.sourcing_campaign_document_status(
    workspace_row.state, p_campaign_id
  );
  if document_status is null then return jsonb_build_object('status', 'workspace_unavailable'); end if;
  select value into projected_campaign
    from jsonb_array_elements(workspace_row.state -> 'campaigns') item(value)
   where item.value ->> 'id' = p_campaign_id::text;
  if projected_campaign is null
     or jsonb_typeof(projected_campaign -> 'metrics') <> 'object'
     or jsonb_typeof(projected_campaign -> 'activities') <> 'array' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
    into novel_candidates
    from jsonb_array_elements(candidates) with ordinality item(value, ordinality)
   where not exists (
     select 1 from public.candidates existing
      where existing.workspace_id = p_workspace_id
        and existing.campaign_id = p_campaign_id::text
        and existing.id = item.value ->> 'id'
   );
  merged_candidates := coalesce(workspace_row.state -> 'candidates', '[]'::jsonb)
    || novel_candidates;
  for candidate in select value from jsonb_array_elements(novel_candidates)
  loop
    evidence := candidate -> 'sourceEvidence';
    insert into public.candidates(
      workspace_id, campaign_id, id, linkedin_url, source_url,
      source_external_id, source_platform, name, current_title,
      current_company, location, match_score, stage, provenance, payload, mirrored_at
    ) values (
      p_workspace_id, p_campaign_id::text, candidate ->> 'id',
      candidate ->> 'linkedinUrl', candidate ->> 'sourceUrl',
      candidate ->> 'sourceExternalId', candidate ->> 'sourcePlatform',
      candidate ->> 'name', nullif(candidate ->> 'currentTitle', ''),
      nullif(candidate ->> 'currentCompany', ''), nullif(candidate ->> 'location', ''),
      0, 'Sourced', candidate ->> 'provenance', candidate, wall_now
    );
    insert into public.autonomous_web_candidate_evidence(
      workspace_id, campaign_id, candidate_id, egress_attempt_id, provider,
      provider_external_id, linkedin_url, canonical_query_sha256,
      raw_response_sha256, provider_result_sha256, normalized_payload_sha256,
      role_evidence
    ) values (
      p_workspace_id, p_campaign_id, candidate ->> 'id', p_egress_attempt_id,
      'tavily', candidate ->> 'sourceExternalId', candidate ->> 'linkedinUrl',
      claim_row.canonical_query_sha256, result_row.raw_response_sha256,
      evidence ->> 'providerResultSha256', evidence ->> 'normalizedPayloadSha256',
      evidence
    );
  end loop;
  select count(*) into unique_candidate_total from public.candidates
   where workspace_id = p_workspace_id and campaign_id = p_campaign_id::text;
  projected_campaign := jsonb_set(
    projected_campaign, '{metrics,sourced}', to_jsonb(unique_candidate_total), true
  );
  activity := jsonb_build_object(
    'id', 'autonomous-web-sourcing-' || p_job_id::text,
    'type', 'sourcing',
    'title', case when result_row.result_count > 0
      then 'Public LinkedIn candidates sourced' else 'Public LinkedIn search completed' end,
    'notes', format('Observed %s provider-backed candidates.', result_row.result_count),
    'outcome', case when result_row.result_count > 0 then 'batch_bound_reached' else 'provider_exhausted' end,
    'campaignId', p_campaign_id::text,
    'linkedEntityType', 'campaign',
    'linkedEntityId', p_campaign_id::text,
    'createdAt', to_char(wall_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  projected_campaign := jsonb_set(
    projected_campaign, '{activities}',
    (projected_campaign -> 'activities') || jsonb_build_array(activity), true
  );
  if document_status = 'Sourcing' and campaign_row.status = 'sourcing' then
    projected_campaign := jsonb_set(
      projected_campaign, '{status}',
      to_jsonb(case when result_row.result_count > 0 then 'Outreach' else 'Paused' end), true
    );
    update public.sourcing_campaigns
       set status = 'completed',
           sourcing_stop_reason = case when result_row.result_count > 0
             then 'batch_bound_reached' else 'provider_exhausted' end,
           sourcing_completed_at = wall_now,
           updated_at = wall_now
     where workspace_id = p_workspace_id and id = p_campaign_id and status = 'sourcing';
  elsif document_status = 'Paused' and campaign_row.status = 'sourcing' then
    update public.sourcing_campaigns set status = 'paused', updated_at = wall_now
     where workspace_id = p_workspace_id and id = p_campaign_id and status = 'sourcing';
  elsif document_status = 'Filled' and campaign_row.status = 'sourcing' then
    update public.sourcing_campaigns set status = 'cancelled', updated_at = wall_now
     where workspace_id = p_workspace_id and id = p_campaign_id and status = 'sourcing';
  end if;
  select jsonb_agg(
    case when item.value ->> 'id' = p_campaign_id::text
      then projected_campaign else item.value end order by item.ordinality
  ) into merged_campaigns
    from jsonb_array_elements(workspace_row.state -> 'campaigns')
      with ordinality item(value, ordinality);
  update public.workspace_state
     set state = jsonb_set(
       jsonb_set(workspace_row.state, '{candidates}', merged_candidates, true),
       '{campaigns}', merged_campaigns, true
     )
   where workspace_id = p_workspace_id;
  get diagnostics updated = row_count;
  if updated <> 1 then raise exception 'autonomous web projection lost' using errcode = '40001'; end if;

  insert into public.autonomous_web_sourcing_receipts(
    job_id, lease_id, workspace_id, requisition_id, campaign_id,
    claim_token, fence_version, egress_attempt_id, canonical_query_sha256,
    canonical_query, applied_lesson, result_sha256, candidate_count
  ) values (
    p_job_id, p_lease_id, p_workspace_id, claim_row.requisition_id,
    p_campaign_id, p_claim_token, p_fence_version, p_egress_attempt_id,
    claim_row.canonical_query_sha256, claim_row.canonical_query,
    claim_row.applied_lesson, p_result_sha256, result_row.result_count
  );
  perform set_config('aria.sourcing_batch_policy_pause_job', p_job_id::text, true);
  update public.aria_jobs
     set status = 'succeeded', result_sha256 = p_result_sha256,
         lease_id = null, lease_expires_at = null, last_error = null,
         updated_at = wall_now
   where id = p_job_id and status = 'leased' and lease_id = p_lease_id;
  get diagnostics updated = row_count;
  if updated <> 1 then raise exception 'autonomous web job completion lost' using errcode = '40001'; end if;
  perform set_config('aria.autonomous_web_payload_cleanup', 'on', true);
  delete from public.autonomous_web_sourcing_staged_results
   where egress_attempt_id = p_egress_attempt_id;
  insert into public.loop_events(
    workspace_id, event_type, subject_kind, subject_id, job_id, payload
  ) values (
    p_workspace_id, 'sourcing.web_completed', 'sourcing_campaign',
    p_campaign_id::text, p_job_id,
    jsonb_build_object(
      'candidate_count', result_row.result_count,
      'query_count', 1,
      'provider', 'tavily',
      'query_policy_version', claim_row.query_policy_version,
      'applied_lesson_id', claim_row.applied_lesson ->> 'lesson_id',
      'applied_lesson_version', claim_row.applied_lesson -> 'lesson_version',
      'applied_lesson_snapshot_sha256', claim_row.applied_lesson ->> 'snapshot_sha256'
    )
  );
  return jsonb_build_object(
    'status', 'completed', 'resultSha256', p_result_sha256,
    'candidateCount', result_row.result_count
  );
exception when unique_violation or check_violation then
  return jsonb_build_object('status', 'candidate_evidence_invalid');
end;
$$;

-- ---------------------------------------------------------------------------
-- Failure and uncertainty. Only explicitly classified, read-only provider
-- failures may consume another bounded queue attempt. Every retry appends a new
-- claim/token/fence and a new attempt; ambiguous outcomes remain terminal.
-- ---------------------------------------------------------------------------
create or replace function public.fail_autonomous_web_sourcing(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_claim_token uuid,
  p_fence_version bigint,
  p_egress_attempt_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_ambiguous boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.autonomous_web_sourcing_claims%rowtype;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  failure_row public.autonomous_web_sourcing_failures%rowtype;
  disposition_value text;
  response_status text;
  backoff interval;
  wall_now timestamptz;
  updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_claim_token is null or p_fence_version is null or p_fence_version <= 0
     or p_egress_attempt_id is null or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'
     or p_retryable is null or p_ambiguous is null
     or (p_ambiguous and p_retryable)
     or p_retryable is distinct from (p_error_code in (
       'search_rate_limited', 'search_provider_error', 'search_response_read_unknown'
     ))
     or p_ambiguous is distinct from (p_error_code in (
       'search_transport_unknown', 'record_state_unconfirmed', 'record_response_invalid'
     )) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Lock the queue row first. Every settlement and lease transition in this
  -- lane uses this order, preventing fail/claim/reaper inversions.
  select * into job_row from public.aria_jobs job
   where job.id = p_job_id for update;
  wall_now := clock_timestamp();
  if not found or job_row.workspace_id <> p_workspace_id
     or job_row.kind <> 'sourcing_batch' then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = p_egress_attempt_id for share;
  if not found or attempt_row.job_id <> p_job_id or attempt_row.lease_id <> p_lease_id
     or attempt_row.workspace_id <> p_workspace_id
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  select * into claim_row from public.autonomous_web_sourcing_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token
     and claim.fence_version = p_fence_version
     and not exists (
       select 1 from public.autonomous_web_sourcing_claims newer
        where newer.job_id = claim.job_id
          and newer.fence_version > claim.fence_version
     )
   for share;
  if not found or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.campaign_id <> attempt_row.campaign_id then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  if (p_retryable or p_ambiguous) and not exists (
    select 1 from public.autonomous_web_sourcing_confirmations confirmation
     where confirmation.egress_attempt_id = p_egress_attempt_id
       and confirmation.job_id = p_job_id
       and confirmation.lease_id = p_lease_id
       and confirmation.workspace_id = p_workspace_id
       and confirmation.claim_token = p_claim_token
       and confirmation.fence_version = p_fence_version
  ) then
    return jsonb_build_object('status', 'attempt_binding_invalid');
  end if;
  if exists (
    select 1 from public.autonomous_web_sourcing_receipts receipt
     where receipt.job_id = p_job_id
       and receipt.lease_id = p_lease_id
       and receipt.workspace_id = p_workspace_id
       and receipt.claim_token = p_claim_token
       and receipt.fence_version = p_fence_version
       and receipt.egress_attempt_id = p_egress_attempt_id
  ) then return jsonb_build_object('status', 'completed'); end if;
  select * into failure_row from public.autonomous_web_sourcing_failures failure
   where failure.egress_attempt_id = p_egress_attempt_id;
  if found then
    if failure_row.job_id <> p_job_id
       or failure_row.workspace_id <> p_workspace_id
       or failure_row.error_code <> p_error_code
       or failure_row.retryable <> p_retryable
       or failure_row.ambiguous <> p_ambiguous then
      return jsonb_build_object('status', 'failure_conflict');
    end if;
    return jsonb_build_object(
      'status', case failure_row.disposition
        when 'retry_scheduled' then 'retry_scheduled'
        when 'ambiguous' then 'ambiguous'
        else 'dead' end
    );
  end if;
  if exists (
    select 1
      from public.autonomous_web_sourcing_results result
      join public.autonomous_web_sourcing_staged_results stage
        on stage.egress_attempt_id = result.egress_attempt_id
     where result.egress_attempt_id = p_egress_attempt_id
       and stage.expires_at > clock_timestamp()
  ) then return jsonb_build_object('status', 'result_ready'); end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'job_lease_invalid');
  end if;

  if p_ambiguous then
    disposition_value := 'ambiguous';
    response_status := 'ambiguous';
  -- The shared queue permits broader retry budgets for other job kinds. Web
  -- provider authority is deliberately narrower: one initial try plus three
  -- classified retries, matching the activation proof's per-job bound.
  elsif p_retryable
        and job_row.attempt_count < least(job_row.max_attempts, 4) then
    disposition_value := 'retry_scheduled';
    response_status := 'retry_scheduled';
  else
    disposition_value := 'dead';
    response_status := 'dead';
  end if;
  insert into public.autonomous_web_sourcing_failures(
    egress_attempt_id, job_id, workspace_id, error_code, retryable, ambiguous,
    disposition
  ) values (
    p_egress_attempt_id, p_job_id, p_workspace_id, p_error_code, p_retryable,
    p_ambiguous, disposition_value
  );

  if disposition_value = 'retry_scheduled' then
    backoff := least(
      make_interval(mins => 1) * power(2, job_row.attempt_count),
      make_interval(hours => 4)
    ) + make_interval(secs => floor(random() * 30)::integer);
  end if;
  update public.aria_jobs
     set status = case when disposition_value = 'retry_scheduled' then 'queued' else 'dead' end,
         last_error = 'autonomous web sourcing failed: ' || p_error_code,
         next_run_at = case when disposition_value = 'retry_scheduled'
           then wall_now + backoff else next_run_at end,
         lease_id = null, lease_expires_at = null, updated_at = wall_now
   where id = p_job_id and status = 'leased' and lease_id = p_lease_id;
  get diagnostics updated = row_count;
  if updated <> 1 then raise exception 'autonomous web failure settlement lost' using errcode = '40001'; end if;
  return jsonb_build_object('status', response_status);
end;
$$;

create or replace function public.reconcile_autonomous_web_sourcing(
  p_job_id uuid,
  p_workspace_id uuid,
  p_egress_attempt_id uuid,
  p_result_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  receipt_row public.autonomous_web_sourcing_receipts%rowtype;
  result_row public.autonomous_web_sourcing_results%rowtype;
  failure_row public.autonomous_web_sourcing_failures%rowtype;
  outcome_value text;
  candidate_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_workspace_id is null or p_egress_attempt_id is null
     or (p_result_sha256 is not null and p_result_sha256 !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into receipt_row from public.autonomous_web_sourcing_receipts
   where job_id = p_job_id and workspace_id = p_workspace_id
     and egress_attempt_id = p_egress_attempt_id;
  if found then
    if p_result_sha256 is not null and p_result_sha256 <> receipt_row.result_sha256 then
      return jsonb_build_object('status', 'replay_conflict');
    end if;
    outcome_value := 'completed';
    p_result_sha256 := receipt_row.result_sha256;
    candidate_count := receipt_row.candidate_count;
  else
    select * into failure_row from public.autonomous_web_sourcing_failures
     where job_id = p_job_id and workspace_id = p_workspace_id
       and egress_attempt_id = p_egress_attempt_id;
    if found then
      if not failure_row.ambiguous then
        return jsonb_build_object('status', 'not_reconcilable');
      end if;
      outcome_value := 'no_durable_response';
      p_result_sha256 := null;
      candidate_count := null;
    else
      select result.* into result_row
        from public.autonomous_web_sourcing_results result
        join public.autonomous_web_sourcing_staged_results stage
          on stage.egress_attempt_id = result.egress_attempt_id
       where result.job_id = p_job_id and result.workspace_id = p_workspace_id
         and result.egress_attempt_id = p_egress_attempt_id
         and stage.expires_at > clock_timestamp();
      if not found then
        return jsonb_build_object('status', 'not_reconcilable');
      end if;
      if p_result_sha256 is not null and p_result_sha256 <> result_row.result_sha256 then
        return jsonb_build_object('status', 'replay_conflict');
      end if;
      outcome_value := 'result_ready';
      p_result_sha256 := result_row.result_sha256;
      candidate_count := result_row.result_count;
    end if;
  end if;
  insert into public.autonomous_web_sourcing_reconciliations(
    egress_attempt_id, workspace_id, outcome, result_sha256
  ) values (
    p_egress_attempt_id, p_workspace_id, outcome_value, p_result_sha256
  ) on conflict (egress_attempt_id) do nothing;
  if outcome_value in ('completed', 'result_ready') then
    return jsonb_build_object(
      'status', outcome_value,
      'resultSha256', p_result_sha256,
      'candidateCount', candidate_count
    );
  end if;
  return jsonb_build_object('status', outcome_value, 'resultSha256', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Erasure and bounded retention.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_autonomous_web_from_tombstone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform set_config('aria.autonomous_web_retention_cleanup', 'on', true);
  perform set_config('aria.autonomous_web_payload_cleanup', 'on', true);
  delete from public.autonomous_web_candidate_evidence evidence
   where evidence.workspace_id = new.workspace_id
     and (
       (new.identifier_kind = 'candidate_id' and new.identifier_hmac =
         public.candidate_erasure_identifier_hmac(new.workspace_id, 'candidate_id', evidence.candidate_id))
       or (new.identifier_kind in ('linkedin','source_url') and new.identifier_hmac =
         public.candidate_erasure_identifier_hmac(new.workspace_id, new.identifier_kind, evidence.linkedin_url))
       or (new.identifier_kind in ('source_external_id','provider_external_id') and new.identifier_hmac =
         public.candidate_erasure_identifier_hmac(new.workspace_id, new.identifier_kind, evidence.provider_external_id))
     );
  delete from public.autonomous_web_sourcing_staged_results stage
   where stage.workspace_id = new.workspace_id
     and exists (
       select 1 from jsonb_array_elements(stage.normalized_results) item(value)
        where new.identifier_kind in ('linkedin','source_url')
          and new.identifier_hmac = public.candidate_erasure_identifier_hmac(
            new.workspace_id, new.identifier_kind,
            lower(regexp_replace(item.value ->> 'url', '/$', ''))
          )
     );
  return null;
end;
$$;

drop trigger if exists candidate_erasure_tombstones_autonomous_web_cleanup
  on public.candidate_erasure_suppression_tombstones;
create trigger candidate_erasure_tombstones_autonomous_web_cleanup
  after insert on public.candidate_erasure_suppression_tombstones
  for each row execute function public.cleanup_autonomous_web_from_tombstone();

create or replace function public.cleanup_autonomous_web_sourcing_retention(
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  staged_deleted integer := 0;
  evidence_deleted integer := 0;
  quota_deleted integer := 0;
  metadata_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform set_config('aria.autonomous_web_payload_cleanup', 'on', true);
  perform set_config('aria.autonomous_web_retention_cleanup', 'on', true);
  delete from public.autonomous_web_sourcing_staged_results stage
   where stage.egress_attempt_id in (
     select candidate.egress_attempt_id
       from public.autonomous_web_sourcing_staged_results candidate
      where candidate.expires_at <= clock_timestamp()
      order by candidate.expires_at, candidate.egress_attempt_id limit p_limit
   );
  get diagnostics staged_deleted = row_count;
  delete from public.autonomous_web_candidate_evidence evidence
   where (evidence.workspace_id, evidence.campaign_id, evidence.candidate_id) in (
     select candidate.workspace_id, candidate.campaign_id, candidate.candidate_id
       from public.autonomous_web_candidate_evidence candidate
      where candidate.expires_at <= clock_timestamp()
        and not exists (
          select 1 from public.candidate_legal_holds hold
           where hold.workspace_id = candidate.workspace_id
             and hold.campaign_id = candidate.campaign_id::text
             and hold.candidate_id = candidate.candidate_id
             and hold.status = 'active'
             and (hold.expires_at is null or hold.expires_at > clock_timestamp())
        )
      order by candidate.expires_at, candidate.workspace_id, candidate.campaign_id, candidate.candidate_id
      limit p_limit
   );
  get diagnostics evidence_deleted = row_count;
  delete from public.autonomous_web_sourcing_quota_ledger quota
   where quota.id in (
     select candidate.id from public.autonomous_web_sourcing_quota_ledger candidate
      where candidate.recorded_at < clock_timestamp() - interval '2 days'
      order by candidate.id limit p_limit
   );
  get diagnostics quota_deleted = row_count;
  -- Metadata is retained for 180 days, then removed only after personal
  -- evidence and staged payloads are gone. Child rows are removed first.
  delete from public.autonomous_web_sourcing_reconciliations row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = attempt.id)
      order by attempt.begun_at, attempt.id limit p_limit
   );
  delete from public.autonomous_web_sourcing_receipts row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = attempt.id)
      order by attempt.begun_at, attempt.id limit p_limit
   );
  delete from public.autonomous_web_sourcing_failures row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = attempt.id)
      order by attempt.begun_at, attempt.id limit p_limit
   );
  delete from public.autonomous_web_sourcing_results row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = attempt.id)
      order by attempt.begun_at, attempt.id limit p_limit
   );
  delete from public.autonomous_web_sourcing_confirmations row_to_delete
   where row_to_delete.egress_attempt_id in (
     select attempt.id
       from public.autonomous_web_sourcing_attempts attempt
       join public.aria_jobs job on job.id = attempt.job_id
      where attempt.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = attempt.id)
      order by attempt.begun_at, attempt.id limit p_limit
   );
  delete from public.autonomous_web_sourcing_attempts attempt
   where attempt.id in (
     select candidate.id
       from public.autonomous_web_sourcing_attempts candidate
       join public.aria_jobs job on job.id = candidate.job_id
      where candidate.begun_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (select 1 from public.autonomous_web_candidate_evidence evidence
                         where evidence.egress_attempt_id = candidate.id)
      order by candidate.begun_at, candidate.id limit p_limit
   );
  get diagnostics metadata_deleted = row_count;
  delete from public.autonomous_web_sourcing_claims claim
   where (claim.job_id, claim.fence_version) in (
     select candidate.job_id, candidate.fence_version
       from public.autonomous_web_sourcing_claims candidate
       join public.aria_jobs job on job.id = candidate.job_id
      where candidate.authorized_at < clock_timestamp() - interval '180 days'
        and job.status in ('succeeded', 'dead')
        and not exists (
          select 1 from public.autonomous_web_sourcing_attempts attempt
           where attempt.job_id = candidate.job_id
             and attempt.claim_token = candidate.claim_token
             and attempt.fence_version = candidate.fence_version
        )
      order by candidate.authorized_at, candidate.job_id, candidate.fence_version
      limit p_limit
   );
  return jsonb_build_object(
    'status', 'completed',
    'stagedDeleted', staged_deleted,
    'evidenceDeleted', evidence_deleted,
    'quotaDeleted', quota_deleted,
    'metadataDeleted', metadata_deleted
  );
end;
$$;

-- Readiness is the combined operational contract for both deterministic GitHub
-- and autonomous Tavily sourcing. Preserve the public JSON shape introduced by
-- 0054 while folding autonomous attempts and failures into the same unhealthy
-- counters, so the new lane cannot disappear behind a healthy GitHub lane.
create or replace function public.get_sourcing_loop_readiness(p_release_sha text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  expected_contract text := public.expected_sourcing_loop_handler_contract_sha256();
  wall_now timestamptz := clock_timestamp();
  freshest_heartbeat timestamptz;
  active_workers integer := 0;
  fresh_known_workers integer := 0;
  expected_handler_count constant integer := 4;
  oldest_runnable_job_age_seconds bigint := 0;
  overdue_runnable_jobs integer := 0;
  dead_sourcing_jobs integer := 0;
  ambiguous_sourcing_attempts integer := 0;
  overdue_begun_attempts integer := 0;
  heartbeat_status text;
  heartbeat_age_seconds integer;
  healthy boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$' then
    return jsonb_build_object(
      'healthy', false,
      'status', 'not_ready',
      'heartbeat_status', 'release_invalid',
      'active_workers', 0,
      'expected_handler_count', expected_handler_count,
      'freshest_heartbeat_age_seconds', null,
      'oldest_runnable_job_age_seconds', 0,
      'overdue_runnable_jobs', 0,
      'dead_sourcing_jobs', 0,
      'ambiguous_sourcing_attempts', 0,
      'overdue_begun_attempts', 0
    );
  end if;

  select max(heartbeat.last_seen_at),
         count(*) filter (where heartbeat.last_seen_at > wall_now - interval '90 seconds'),
         count(*) filter (
           where heartbeat.last_seen_at > wall_now - interval '90 seconds'
             and heartbeat.handler_contract_sha256 = expected_contract
         )
    into freshest_heartbeat, active_workers, fresh_known_workers
    from public.loop_worker_heartbeats heartbeat
   where heartbeat.release_sha = p_release_sha;

  heartbeat_age_seconds := case when freshest_heartbeat is null then null else
    greatest(0, floor(extract(epoch from wall_now - freshest_heartbeat))::integer) end;
  heartbeat_status := case
    when freshest_heartbeat is null then 'missing'
    when freshest_heartbeat <= wall_now - interval '90 seconds' then 'stale'
    when fresh_known_workers <> active_workers then 'contract_mismatch'
    else 'fresh'
  end;

  select count(*) filter (
           where job.next_run_at < wall_now - interval '120 seconds'
         ),
         coalesce(
           greatest(0, floor(extract(epoch from wall_now - min(job.next_run_at)))::bigint),
           0
         )
    into overdue_runnable_jobs, oldest_runnable_job_age_seconds
    from public.aria_jobs job
   where job.status = 'queued'
     and job.kind in ('requisition_parse', 'campaign_create', 'sourcing_batch')
     and job.next_run_at <= wall_now;

  -- A terminal autonomous failure normally has a dead queue row in the same
  -- transaction. UNION makes the readiness fence fail closed if either side is
  -- present, without counting one failed job twice.
  select count(*)::integer into dead_sourcing_jobs
    from (
      select job.id as job_id
        from public.aria_jobs job
       where job.status = 'dead'
         and job.kind in ('requisition_parse', 'campaign_create', 'sourcing_batch')
      union
      select failure.job_id
        from public.autonomous_web_sourcing_failures failure
       where failure.disposition in ('dead', 'ambiguous')
    ) unhealthy_job;

  select count(*)::integer into ambiguous_sourcing_attempts
    from (
      select attempt.id as attempt_id
        from public.sourcing_batch_egress_attempts attempt
       where attempt.status = 'ambiguous'
      union all
      select failure.egress_attempt_id
        from public.autonomous_web_sourcing_failures failure
       where failure.disposition = 'ambiguous'
    ) ambiguous_attempt;

  -- Any autonomous request older than the existing five-minute SLO and lacking
  -- both a receipt and a failure is unsettled. This includes a durable result
  -- whose exact commit stalled, which must keep readiness red until settled.
  select count(*)::integer into overdue_begun_attempts
    from (
      select attempt.id as attempt_id
        from public.sourcing_batch_egress_attempts attempt
       where attempt.status = 'begun'
         and attempt.begun_at < wall_now - interval '5 minutes'
      union all
      select attempt.id
        from public.autonomous_web_sourcing_attempts attempt
       where attempt.begun_at < wall_now - interval '5 minutes'
         and not exists (
           select 1 from public.autonomous_web_sourcing_receipts receipt
            where receipt.egress_attempt_id = attempt.id
         )
         and not exists (
           select 1 from public.autonomous_web_sourcing_failures failure
            where failure.egress_attempt_id = attempt.id
         )
    ) overdue_attempt;

  healthy := expected_handler_count = 4
    and active_workers > 0
    and fresh_known_workers = active_workers
    and heartbeat_status = 'fresh'
    and oldest_runnable_job_age_seconds <= 120
    and overdue_runnable_jobs = 0
    and dead_sourcing_jobs = 0
    and ambiguous_sourcing_attempts = 0
    and overdue_begun_attempts = 0;
  return jsonb_build_object(
    'healthy', healthy,
    'status', case when healthy then 'ready' else 'not_ready' end,
    'heartbeat_status', heartbeat_status,
    'active_workers', active_workers,
    'expected_handler_count', expected_handler_count,
    'freshest_heartbeat_age_seconds', heartbeat_age_seconds,
    'oldest_runnable_job_age_seconds', oldest_runnable_job_age_seconds,
    'overdue_runnable_jobs', overdue_runnable_jobs,
    'dead_sourcing_jobs', dead_sourcing_jobs,
    'ambiguous_sourcing_attempts', ambiguous_sourcing_attempts,
    'overdue_begun_attempts', overdue_begun_attempts
  );
end;
$$;

-- Bounded service-only proof used by the protected activation canary. It
-- exposes provider authority and immutable receipt identities, never candidate
-- payloads, provider response bodies, credential material, or tenant content.
create or replace function public.autonomous_web_activation_counts_are_valid(
  p_attempt_count integer,
  p_confirmation_count integer,
  p_receipt_count integer,
  p_failure_count integer
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    p_receipt_count between 1 and 5
    and p_attempt_count between p_receipt_count and p_receipt_count * 4
    and p_failure_count between 0 and p_receipt_count * 3
    and p_attempt_count = p_receipt_count + p_failure_count
    and p_confirmation_count = p_attempt_count,
    false
  );
$$;

create or replace function public.autonomous_web_activation_job_counts_are_valid(
  p_attempt_count integer,
  p_confirmation_count integer,
  p_receipt_count integer,
  p_failure_count integer
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    p_attempt_count between 1 and 4
    and p_receipt_count = 1
    and p_failure_count = p_attempt_count - 1
    and p_confirmation_count = p_attempt_count,
    false
  );
$$;

create or replace function public.get_autonomous_web_sourcing_activation_proof(
  p_workspace_id uuid,
  p_campaign_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  attempt_count integer := 0;
  confirmation_count integer := 0;
  receipt_count integer := 0;
  failure_count integer := 0;
  invalid_failure_count integer := 0;
  invalid_job_count integer := 0;
  credential_identity_count integer := 0;
  credential_id_value uuid;
  credential_version_value text;
  credential_verified_at_value timestamptz;
  verification_method_value text;
  verification_http_status_value integer;
  credential_current boolean := false;
  receipt_rows jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_campaign_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select count(*)::integer into attempt_count
    from public.autonomous_web_sourcing_attempts attempt
   where attempt.workspace_id = p_workspace_id
     and attempt.campaign_id = p_campaign_id;
  select count(*)::integer into confirmation_count
    from public.autonomous_web_sourcing_confirmations confirmation
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = confirmation.egress_attempt_id
   where attempt.workspace_id = p_workspace_id
     and attempt.campaign_id = p_campaign_id;
  select count(*)::integer into receipt_count
    from public.autonomous_web_sourcing_receipts receipt
   where receipt.workspace_id = p_workspace_id
     and receipt.campaign_id = p_campaign_id;
  select count(*)::integer into failure_count
    from public.autonomous_web_sourcing_failures failure
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = failure.egress_attempt_id
   where attempt.workspace_id = p_workspace_id
     and attempt.campaign_id = p_campaign_id;
  select count(*)::integer into invalid_failure_count
    from public.autonomous_web_sourcing_failures failure
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = failure.egress_attempt_id
   where attempt.workspace_id = p_workspace_id
     and attempt.campaign_id = p_campaign_id
     and failure.disposition <> 'retry_scheduled';

  -- Campaign totals cannot let one completed job mask a different job whose
  -- retry is still pending. Every observed job must close independently with
  -- one exact latest-fence receipt; all prior attempts must be retry history.
  select count(*)::integer into invalid_job_count
    from (
      select attempt.job_id
        from public.autonomous_web_sourcing_attempts attempt
        left join public.autonomous_web_sourcing_confirmations confirmation
          on confirmation.egress_attempt_id = attempt.id
        left join public.autonomous_web_sourcing_failures failure
          on failure.egress_attempt_id = attempt.id
        left join public.autonomous_web_sourcing_receipts receipt
          on receipt.egress_attempt_id = attempt.id
       where attempt.workspace_id = p_workspace_id
         and attempt.campaign_id = p_campaign_id
       group by attempt.job_id
      having not public.autonomous_web_activation_job_counts_are_valid(
               count(*)::integer,
               count(confirmation.egress_attempt_id)::integer,
               count(receipt.egress_attempt_id)::integer,
               count(failure.egress_attempt_id)::integer
             )
         or count(*) filter (
              where receipt.egress_attempt_id is not null
                and receipt.job_id = attempt.job_id
                and receipt.lease_id = attempt.lease_id
                and receipt.workspace_id = attempt.workspace_id
                and receipt.campaign_id = attempt.campaign_id
                and receipt.claim_token = attempt.claim_token
                and receipt.fence_version = attempt.fence_version
                and not exists (
                  select 1
                    from public.autonomous_web_sourcing_attempts newer
                   where newer.job_id = attempt.job_id
                     and newer.fence_version > attempt.fence_version
                )
            ) <> 1
         or count(failure.egress_attempt_id) filter (
              where failure.disposition = 'retry_scheduled'
            ) <> count(failure.egress_attempt_id)
         or count(*) filter (
              where receipt.egress_attempt_id is not null
                and failure.egress_attempt_id is not null
            ) <> 0
         or count(*) filter (
              where receipt.egress_attempt_id is null
                and failure.egress_attempt_id is null
            ) <> 0
    ) invalid_job;

  if receipt_count = 0 then
    return jsonb_build_object('status', 'pending');
  end if;
  if not public.autonomous_web_activation_counts_are_valid(
       attempt_count, confirmation_count, receipt_count, failure_count
     )
     or invalid_failure_count <> 0
     or invalid_job_count <> 0 then
    return jsonb_build_object('status', 'proof_invalid');
  end if;

  select count(distinct attempt.credential_id::text || ':' || attempt.credential_version)::integer
    into credential_identity_count
    from public.autonomous_web_sourcing_receipts receipt
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = receipt.egress_attempt_id
   where receipt.workspace_id = p_workspace_id
     and receipt.campaign_id = p_campaign_id;
  if credential_identity_count <> 1 then
    return jsonb_build_object('status', 'proof_invalid');
  end if;

  select attempt.credential_id,
         attempt.credential_version,
         claim.credential_verified_at,
         key_row.verification_method,
         key_row.verification_http_status,
         public.ai_execution_credential_verified(
           key_row.provider, key_row.status, key_row.last_tested_at,
           key_row.verification_method, key_row.verification_http_status
         )
         and key_row.provider = 'Tavily'
         and key_row.last_tested_at = claim.credential_verified_at
         and key_row.last_tested_at > clock_timestamp() - interval '24 hours'
         and public.autonomous_web_sourcing_credential_version(
           key_row.id, key_row.workspace_id, key_row.provider, key_row.last4,
           key_row.last_tested_at, key_row.verification_method,
           key_row.verification_http_status
         ) = attempt.credential_version
    into credential_id_value,
         credential_version_value,
         credential_verified_at_value,
         verification_method_value,
         verification_http_status_value,
         credential_current
    from public.autonomous_web_sourcing_receipts receipt
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = receipt.egress_attempt_id
    join public.autonomous_web_sourcing_claims claim
      on claim.job_id = attempt.job_id
     and claim.claim_token = attempt.claim_token
     and claim.fence_version = attempt.fence_version
    join public.api_keys key_row
      on key_row.id = attempt.credential_id
     and key_row.workspace_id = attempt.workspace_id
   where receipt.workspace_id = p_workspace_id
     and receipt.campaign_id = p_campaign_id
   order by receipt.completed_at, receipt.job_id
   limit 1;
  if not found or credential_current is distinct from true then
    return jsonb_build_object('status', 'proof_invalid');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'jobId', receipt.job_id,
           'egressAttemptId', receipt.egress_attempt_id,
           'canonicalQuerySha256', receipt.canonical_query_sha256,
           'resultSha256', receipt.result_sha256,
           'candidateCount', receipt.candidate_count,
           'completedAt', receipt.completed_at
         ) order by receipt.job_id), '[]'::jsonb)
    into receipt_rows
    from public.autonomous_web_sourcing_receipts receipt
   where receipt.workspace_id = p_workspace_id
     and receipt.campaign_id = p_campaign_id;

  return jsonb_build_object(
    'status', 'completed',
    'provider', 'tavily',
    'providerMode', 'workspace_credential',
    'attemptCount', attempt_count,
    'confirmationCount', confirmation_count,
    'receiptCount', receipt_count,
    'failureCount', failure_count,
    'credentialId', credential_id_value,
    'credentialVersion', credential_version_value,
    'credentialVerifiedAt', credential_verified_at_value,
    'verificationMethod', verification_method_value,
    'verificationHttpStatus', verification_http_status_value,
    'receipts', receipt_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and least privilege.
-- ---------------------------------------------------------------------------
alter function public.expected_sourcing_loop_handler_contract_sha256() owner to postgres;
alter function public.get_sourcing_loop_readiness(text) owner to postgres;
alter function public.autonomous_web_activation_counts_are_valid(
  integer, integer, integer, integer
) owner to postgres;
alter function public.autonomous_web_activation_job_counts_are_valid(
  integer, integer, integer, integer
) owner to postgres;
alter function public.get_autonomous_web_sourcing_activation_proof(uuid, uuid)
  owner to postgres;
alter function public.autonomous_web_sourcing_expected_query(jsonb, integer) owner to postgres;
alter function public.autonomous_web_sourcing_query_is_allowed(jsonb, jsonb) owner to postgres;
alter function public.autonomous_web_sourcing_credential_version(
  uuid, uuid, text, text, timestamptz, text, integer
) owner to postgres;
alter function public.autonomous_web_sourcing_request(jsonb) owner to postgres;
alter function public.autonomous_web_sourcing_request_sha256(jsonb) owner to postgres;
alter function public.autonomous_web_linkedin_external_id(text) owner to postgres;
alter function public.reject_autonomous_web_sourcing_mutation() owner to postgres;
alter function public.guard_autonomous_web_staged_mutation() owner to postgres;
alter function public.guard_autonomous_web_sourcing_job_transition() owner to postgres;
alter function public.autonomous_web_sourcing_candidates(
  uuid, uuid, uuid, jsonb, jsonb, text, jsonb, timestamptz
) owner to postgres;
alter function public.authorize_sourcing_batch_0054(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
alter function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
alter function public.authorize_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, text, integer
) owner to postgres;
alter function public.begin_autonomous_web_sourcing_egress(
  uuid, uuid, uuid, uuid, uuid, bigint
) owner to postgres;
alter function public.confirm_autonomous_web_sourcing_egress(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, text
) owner to postgres;
alter function public.record_autonomous_web_sourcing_result(
  uuid, uuid, uuid, uuid, uuid, bigint, text, uuid, text, text,
  text, text, text, integer, jsonb, jsonb
) owner to postgres;
alter function public.commit_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
) owner to postgres;
alter function public.fail_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, bigint, uuid, text, boolean, boolean
) owner to postgres;
alter function public.reconcile_autonomous_web_sourcing(uuid, uuid, uuid, text) owner to postgres;
alter function public.cleanup_autonomous_web_from_tombstone() owner to postgres;
alter function public.cleanup_autonomous_web_sourcing_retention(integer) owner to postgres;

revoke all on function public.autonomous_web_sourcing_expected_query(jsonb, integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.get_sourcing_loop_readiness(text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_sourcing_loop_readiness(text)
  to service_role;
revoke all on function public.autonomous_web_activation_counts_are_valid(
  integer, integer, integer, integer
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_activation_job_counts_are_valid(
  integer, integer, integer, integer
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.get_autonomous_web_sourcing_activation_proof(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_autonomous_web_sourcing_activation_proof(uuid, uuid)
  to service_role;
revoke all on function public.autonomous_web_sourcing_query_is_allowed(jsonb, jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_sourcing_credential_version(
  uuid, uuid, text, text, timestamptz, text, integer
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_sourcing_request(jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_sourcing_request_sha256(jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_linkedin_external_id(text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_autonomous_web_sourcing_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.guard_autonomous_web_staged_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.guard_autonomous_web_sourcing_job_transition()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.autonomous_web_sourcing_candidates(
  uuid, uuid, uuid, jsonb, jsonb, text, jsonb, timestamptz
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.authorize_sourcing_batch_0054(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) to service_role;
revoke all on function public.cleanup_autonomous_web_from_tombstone()
  from public, anon, authenticated, service_role, authenticator;

do $aria_web_grants$
begin
  revoke all on function public.authorize_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, text, integer
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.authorize_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, text, integer
  ) to service_role;
  revoke all on function public.begin_autonomous_web_sourcing_egress(
    uuid, uuid, uuid, uuid, uuid, bigint
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.begin_autonomous_web_sourcing_egress(
    uuid, uuid, uuid, uuid, uuid, bigint
  ) to service_role;
  revoke all on function public.confirm_autonomous_web_sourcing_egress(
    uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, text
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.confirm_autonomous_web_sourcing_egress(
    uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, text
  ) to service_role;
  revoke all on function public.record_autonomous_web_sourcing_result(
    uuid, uuid, uuid, uuid, uuid, bigint, text, uuid, text, text,
    text, text, text, integer, jsonb, jsonb
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.record_autonomous_web_sourcing_result(
    uuid, uuid, uuid, uuid, uuid, bigint, text, uuid, text, text,
    text, text, text, integer, jsonb, jsonb
  ) to service_role;
  revoke all on function public.commit_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.commit_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
  ) to service_role;
  revoke all on function public.fail_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, bigint, uuid, text, boolean, boolean
  ) from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.fail_autonomous_web_sourcing(
    uuid, uuid, uuid, uuid, bigint, uuid, text, boolean, boolean
  ) to service_role;
  revoke all on function public.reconcile_autonomous_web_sourcing(uuid, uuid, uuid, text)
    from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.reconcile_autonomous_web_sourcing(uuid, uuid, uuid, text)
    to service_role;
  revoke all on function public.cleanup_autonomous_web_sourcing_retention(integer)
    from public, anon, authenticated, service_role, authenticator;
  grant execute on function public.cleanup_autonomous_web_sourcing_retention(integer)
    to service_role;
end;
$aria_web_grants$;
