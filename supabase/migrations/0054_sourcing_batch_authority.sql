-- 0054_sourcing_batch_authority.sql
--
-- Durable authority for deterministic GitHub sourcing batches. Anonymous is
-- the default; an explicitly configured worker may use authenticated mode.
-- The worker may derive one finite query and perform bounded GET requests,
-- but only this migration may reserve quota, open an egress fence, persist
-- candidate/source evidence, complete the leased job, or settle uncertainty.
-- No function in this migration scores, drafts, contacts, or stores a token.

-- A provider-policy pause is distinct from normal browser pause/resume state.
-- It records why the autonomous worker stopped before egress, without
-- overloading the completed-campaign stop reason.
alter table public.sourcing_campaigns
  add column if not exists sourcing_pause_reason text
  check (
    sourcing_pause_reason is null
    or sourcing_pause_reason = 'no_supported_query_terms'
  );

-- ---------------------------------------------------------------------------
-- Runtime contract identity. The legacy two-argument heartbeat remains valid
-- during an expand-compatible rollout, but it cannot make readiness green.
-- The new worker must call record_sourcing_loop_heartbeat with this exact hash.
-- ---------------------------------------------------------------------------
alter table public.loop_worker_heartbeats
  add column if not exists handler_contract_sha256 text
  check (
    handler_contract_sha256 is null
    or handler_contract_sha256 ~ '^[0-9a-f]{64}$'
  );

create or replace function public.expected_sourcing_loop_handler_contract_sha256()
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(
    'aria.sourcing-loop-handlers.v1|campaign_create|requisition_parse|sourcing_batch',
    'UTF8'
  )), 'hex');
$$;

revoke all on function public.expected_sourcing_loop_handler_contract_sha256()
  from public, anon, authenticated, service_role, authenticator;

-- Server-owned operational bounds for one autonomous sourcing pass. Nine is
-- a finite default, not a capacity or candidate-quality claim. Every batch is
-- still independently subject to workspace controls and provider quotas.
create or replace function public.sourcing_candidate_target()
returns integer
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select 9;
$$;

create or replace function public.sourcing_max_batch_ordinal()
returns integer
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select 4;
$$;

revoke all on function public.sourcing_candidate_target()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.sourcing_max_batch_ordinal()
  from public, anon, authenticated, service_role, authenticator;

-- The browser campaign lifecycle currently lives in workspace_state. Exactly
-- one well-formed campaign document is required before autonomous egress; a
-- missing, duplicated, or unknown lifecycle value is never interpreted as
-- active. This helper is RPC-internal and intentionally has no API grant.
create or replace function public.sourcing_campaign_document_status(
  p_state jsonb,
  p_campaign_id uuid
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  matching_campaigns integer;
  document_status text;
begin
  if p_campaign_id is null
     or p_state is null
     or jsonb_typeof(p_state) <> 'object'
     or jsonb_typeof(p_state -> 'campaigns') <> 'array' then
    return null;
  end if;
  select count(*), min(
    case when jsonb_typeof(campaign.value -> 'status') = 'string'
      then campaign.value ->> 'status' else null end
  )
    into matching_campaigns, document_status
    from jsonb_array_elements(p_state -> 'campaigns') campaign(value)
   where jsonb_typeof(campaign.value) = 'object'
     and campaign.value ->> 'id' = p_campaign_id::text;
  if matching_campaigns <> 1
     or document_status not in (
       'Intake', 'Sourcing', 'Outreach', 'Interviewing',
       'Closing', 'Filled', 'Paused'
     ) then
    return null;
  end if;
  return document_status;
exception when others then
  return null;
end;
$$;

revoke all on function public.sourcing_campaign_document_status(jsonb, uuid)
  from public, anon, authenticated, service_role, authenticator;

-- A lesson snapshot is self-authenticating at every process and persistence
-- boundary. This hash binds only immutable identifiers and the already
-- canonical GitHub query. It does not grant new query authority.
create or replace function public.sourcing_batch_lesson_snapshot_sha256(
  p_snapshot jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(
    'aria.sourcing-lesson-snapshot.v1' || E'\n'
    || (p_snapshot ->> 'workspace_id') || E'\n'
    || (p_snapshot ->> 'role_fingerprint') || E'\n'
    || (p_snapshot ->> 'lesson_id') || E'\n'
    || (p_snapshot ->> 'lesson_version') || E'\n'
    || (p_snapshot ->> 'promotion_review_id') || E'\n'
    || (p_snapshot ->> 'promoted_by') || E'\n'
    || (p_snapshot ->> 'graphify_export_id') || E'\n'
    || (p_snapshot ->> 'graphify_artifact_sha256') || E'\n'
    || (p_snapshot ->> 'graphify_image_digest') || E'\n'
    || (p_snapshot ->> 'graphify_commit') || E'\n'
    || (p_snapshot ->> 'graphify_cluster_ref') || E'\n'
    || (p_snapshot ->> 'query_hmac') || E'\n'
    || (p_snapshot ->> 'query_value') || E'\n'
    || (p_snapshot ->> 'query_sha256'),
    'UTF8'
  )), 'hex');
$$;

revoke all on function public.sourcing_batch_lesson_snapshot_sha256(jsonb)
  from public, anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- Durable claims, egress attempts, receipts, candidate evidence, and quotas.
-- Every table is RPC-only. Candidate evidence is the sole table here that may
-- be deleted, and only the erasure trigger below does so.
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_batch_claims (
  job_id uuid primary key references public.aria_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  batch_ordinal integer not null check (batch_ordinal between 0 and 4),
  lease_id uuid not null,
  claim_token uuid not null unique,
  fence_version bigint not null check (fence_version > 0),
  provider_mode text not null check (provider_mode in ('anonymous', 'authenticated')),
  role_basis jsonb not null check (
    jsonb_typeof(role_basis) = 'object' and pg_column_size(role_basis) <= 8192
  ),
  role_basis_sha256 text not null check (role_basis_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_query jsonb not null check (
    jsonb_typeof(canonical_query) = 'object'
    and canonical_query ?& array['policyVersion', 'value', 'page', 'sha256']
    and canonical_query - array['policyVersion', 'value', 'page', 'sha256'] = '{}'::jsonb
    and pg_column_size(canonical_query) <= 1024
    and canonical_query ->> 'sha256' ~ '^[0-9a-f]{64}$'
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
  workspace_updated_at timestamptz not null,
  state text not null check (
    state in ('authorized', 'begun', 'completed', 'retryable_failed', 'dead', 'ambiguous')
  ),
  egress_attempt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, job_id),
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade,
  check (
    (state in ('authorized', 'retryable_failed') and egress_attempt_id is null)
    or (state in ('begun', 'completed', 'dead', 'ambiguous') and egress_attempt_id is not null)
  )
);

create table if not exists public.sourcing_batch_egress_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  batch_ordinal integer not null check (batch_ordinal between 0 and 4),
  lease_id uuid not null,
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  provider text not null check (provider = 'github'),
  provider_mode text not null check (provider_mode in ('anonymous', 'authenticated')),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'begun'
    check (status in ('begun', 'completed', 'retryable_failed', 'dead', 'ambiguous')),
  error_code text check (
    error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  result_sha256 text check (
    result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'
  ),
  candidate_count integer check (candidate_count is null or candidate_count between 0 and 3),
  query_count integer check (query_count is null or query_count = 1),
  begun_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (job_id, fence_version),
  unique (workspace_id, id),
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade,
  check (
    (status = 'begun' and error_code is null and result_sha256 is null
      and candidate_count is null and query_count is null and settled_at is null)
    or (status = 'completed' and error_code is null and result_sha256 is not null
      and candidate_count is not null and query_count = 1 and settled_at is not null)
    or (status in ('retryable_failed', 'dead', 'ambiguous') and error_code is not null
      and result_sha256 is null and candidate_count is null and query_count is null
      and settled_at is not null)
  )
);

create index if not exists sourcing_batch_attempts_unsettled_idx
  on public.sourcing_batch_egress_attempts(status, begun_at, id)
  where status in ('begun', 'ambiguous');

create table if not exists public.sourcing_batch_source_receipts (
  egress_attempt_id uuid not null references public.sourcing_batch_egress_attempts(id) on delete cascade,
  ordinal integer not null check (ordinal between 0 and 3),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check (
    jsonb_typeof(receipt) = 'object' and pg_column_size(receipt) <= 4096
  ),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  primary key (egress_attempt_id, ordinal)
);

create table if not exists public.sourcing_candidate_evidence (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  candidate_id text not null check (
    candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  job_id uuid not null references public.aria_jobs(id) on delete restrict,
  egress_attempt_id uuid not null references public.sourcing_batch_egress_attempts(id) on delete restrict,
  provider text not null check (provider = 'github'),
  provider_external_id text not null check (provider_external_id ~ '^[1-9][0-9]{0,19}$'),
  github_url text not null check (char_length(github_url) between 20 and 255),
  raw_response_sha256 text not null check (raw_response_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_payload_sha256 text not null check (normalized_payload_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 8192
  ),
  observed_at timestamptz not null default now(),
  primary key (workspace_id, campaign_id, candidate_id),
  unique (workspace_id, campaign_id, provider, provider_external_id),
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade
);

create table if not exists public.sourcing_batch_receipts (
  job_id uuid primary key references public.aria_jobs(id) on delete restrict,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null,
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  batch_ordinal integer not null check (batch_ordinal between 0 and 4),
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  egress_attempt_id uuid not null unique references public.sourcing_batch_egress_attempts(id) on delete restrict,
  provider_mode text not null check (provider_mode in ('anonymous', 'authenticated')),
  canonical_query_sha256 text not null check (canonical_query_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_query jsonb not null check (
    jsonb_typeof(canonical_query) = 'object'
    and canonical_query ?& array['policyVersion', 'value', 'page', 'sha256']
    and canonical_query - array['policyVersion', 'value', 'page', 'sha256'] = '{}'::jsonb
    and canonical_query ->> 'sha256' = canonical_query_sha256
    and pg_column_size(canonical_query) <= 1024
  ),
  applied_lesson jsonb check (
    applied_lesson is null or (
      jsonb_typeof(applied_lesson) = 'object'
      and applied_lesson ->> 'workspace_id' = workspace_id::text
      and applied_lesson ->> 'query_value' = canonical_query ->> 'value'
      and applied_lesson ->> 'query_sha256' = canonical_query_sha256
      and applied_lesson ->> 'snapshot_sha256'
        = public.sourcing_batch_lesson_snapshot_sha256(applied_lesson)
      and pg_column_size(applied_lesson) <= 4096
    )
  ),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count between 0 and 3),
  query_count integer not null check (query_count = 1),
  completed_at timestamptz not null default now(),
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns(workspace_id, id) on delete cascade
);

create table if not exists public.sourcing_provider_quota_ledger (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.aria_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  claim_token uuid not null,
  fence_version bigint not null check (fence_version > 0),
  provider text not null check (provider = 'github'),
  provider_mode text not null check (provider_mode in ('anonymous', 'authenticated')),
  scope_kind text not null check (
    scope_kind in ('global_search_minute', 'global_core_hour', 'workspace_batch_day')
  ),
  window_start timestamptz not null,
  reserved_units integer not null check (reserved_units between 1 and 3),
  recorded_at timestamptz not null default now(),
  unique (job_id, fence_version, scope_kind)
);

create index if not exists sourcing_provider_quota_window_idx
  on public.sourcing_provider_quota_ledger(provider, provider_mode, scope_kind, window_start);
create index if not exists sourcing_provider_quota_workspace_window_idx
  on public.sourcing_provider_quota_ledger(workspace_id, scope_kind, window_start);

alter table public.sourcing_batch_claims enable row level security;
alter table public.sourcing_batch_claims force row level security;
revoke all on public.sourcing_batch_claims
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_batch_claims_postgres_all on public.sourcing_batch_claims;
create policy sourcing_batch_claims_postgres_all on public.sourcing_batch_claims
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.sourcing_batch_egress_attempts enable row level security;
alter table public.sourcing_batch_egress_attempts force row level security;
revoke all on public.sourcing_batch_egress_attempts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_batch_egress_attempts_postgres_all
  on public.sourcing_batch_egress_attempts;
create policy sourcing_batch_egress_attempts_postgres_all
  on public.sourcing_batch_egress_attempts
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.sourcing_batch_source_receipts enable row level security;
alter table public.sourcing_batch_source_receipts force row level security;
revoke all on public.sourcing_batch_source_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_batch_source_receipts_postgres_all
  on public.sourcing_batch_source_receipts;
create policy sourcing_batch_source_receipts_postgres_all
  on public.sourcing_batch_source_receipts
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.sourcing_candidate_evidence enable row level security;
alter table public.sourcing_candidate_evidence force row level security;
revoke all on public.sourcing_candidate_evidence
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_candidate_evidence_postgres_all
  on public.sourcing_candidate_evidence;
create policy sourcing_candidate_evidence_postgres_all
  on public.sourcing_candidate_evidence
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.sourcing_batch_receipts enable row level security;
alter table public.sourcing_batch_receipts force row level security;
revoke all on public.sourcing_batch_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_batch_receipts_postgres_all on public.sourcing_batch_receipts;
create policy sourcing_batch_receipts_postgres_all on public.sourcing_batch_receipts
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.sourcing_provider_quota_ledger enable row level security;
alter table public.sourcing_provider_quota_ledger force row level security;
revoke all on public.sourcing_provider_quota_ledger
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_provider_quota_ledger_postgres_all
  on public.sourcing_provider_quota_ledger;
create policy sourcing_provider_quota_ledger_postgres_all
  on public.sourcing_provider_quota_ledger
  for all to postgres, supabase_admin using (true) with check (true);

revoke all on sequence public.sourcing_provider_quota_ledger_id_seq
  from public, anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- Immutable validation helpers. They are intentionally not executable by API
-- roles; SECURITY DEFINER authorities below are their only callers.
-- ---------------------------------------------------------------------------
create or replace function public.sourcing_batch_expected_query(
  p_role_basis jsonb,
  p_batch_ordinal integer
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  supported_languages text[];
  language_name text;
  provider_page integer;
  query_value text;
  query_identity text;
begin
  if p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or public.canonicalize_sourcing_role_basis(p_role_basis) <> p_role_basis then
    return null;
  end if;

  select array_agg(mapped_language order by mapped_language)
    into supported_languages
    from (
      select distinct case skill
        when 'c#' then 'c#' when 'c sharp' then 'c#' when 'csharp' then 'c#'
        when 'c++' then 'c++' when 'c plus plus' then 'c++' when 'cplusplus' then 'c++'
        when 'clojure' then 'clojure' when 'dart' then 'dart' when 'elixir' then 'elixir'
        when 'erlang' then 'erlang' when 'go' then 'go' when 'golang' then 'go'
        when 'haskell' then 'haskell' when 'java' then 'java'
        when 'javascript' then 'javascript' when 'node js' then 'javascript'
        when 'node.js' then 'javascript' when 'nodejs' then 'javascript'
        when 'kotlin' then 'kotlin' when 'objective c' then 'objective-c'
        when 'objective-c' then 'objective-c' when 'perl' then 'perl'
        when 'php' then 'php' when 'python' then 'python' when 'r' then 'r'
        when 'ruby' then 'ruby' when 'rust' then 'rust' when 'scala' then 'scala'
        when 'shell' then 'shell' when 'swift' then 'swift'
        when 'typescript' then 'typescript' else null end as mapped_language
        from jsonb_array_elements_text(p_role_basis -> 'skills') skill
    ) mapped
   where mapped_language is not null;

  if coalesce(array_length(supported_languages, 1), 0) = 0 then
    return null;
  end if;
  language_name := supported_languages[
    (p_batch_ordinal % array_length(supported_languages, 1)) + 1
  ];
  provider_page := (
    p_batch_ordinal / array_length(supported_languages, 1)
  ) + 1;
  query_value := 'language:' || language_name || ' type:user';
  query_identity := 'github-deterministic-v2' || E'\n'
    || query_value || E'\npage:' || provider_page::text;
  return jsonb_build_object(
    'policyVersion', 'github-deterministic-v2',
    'value', query_value,
    'page', provider_page,
    'sha256', encode(sha256(convert_to(query_identity, 'UTF8')), 'hex')
  );
exception when sqlstate '22023' then
  return null;
end;
$$;

-- A learned query may reorder only the finite query variants that the server
-- already derives for this role and provider page. This predicate is reused
-- at every egress and settlement boundary so a lesson can never widen query
-- authority after the initial claim.
create or replace function public.sourcing_batch_query_is_allowed(
  p_role_basis jsonb,
  p_batch_ordinal integer,
  p_query jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  default_query jsonb;
  candidate_query jsonb;
  candidate_ordinal integer;
begin
  default_query := public.sourcing_batch_expected_query(
    p_role_basis,
    p_batch_ordinal
  );
  if default_query is null
     or p_query is null
     or jsonb_typeof(p_query) <> 'object' then
    return false;
  end if;

  for candidate_ordinal in 0..public.sourcing_max_batch_ordinal() loop
    candidate_query := public.sourcing_batch_expected_query(
      p_role_basis,
      candidate_ordinal
    );
    if candidate_query is not null
       and candidate_query ->> 'page' = default_query ->> 'page'
       and candidate_query = p_query then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- A role that cannot produce one server-owned, evidence-bearing provider
-- query must stop before quota reservation or HTTP. This authority updates
-- the relational campaign, browser projection, job, and audit event in one
-- transaction so the UI can never remain falsely active after a terminal
-- pre-egress policy decision.
create or replace function public.pause_sourcing_batch_pre_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  workspace_row public.workspace_state%rowtype;
  expected_payload jsonb;
  expected_campaign_sha text;
  document_campaign_status text;
  projected_campaign jsonb;
  projected_activity jsonb;
  merged_campaigns jsonb;
  matching_campaigns integer;
  pause_result jsonb;
  pause_result_sha text;
  wall_now timestamptz;
  updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or p_reason <> 'no_supported_query_terms' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  pause_result := jsonb_build_object(
    'status', 'campaign_paused',
    'job_id', p_job_id,
    'campaign_id', p_campaign_id,
    'reason', p_reason
  );
  pause_result_sha := encode(
    sha256(convert_to(pause_result::text, 'UTF8')),
    'hex'
  );

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  if job_row.kind <> 'sourcing_batch' then return jsonb_build_object('status', 'wrong_kind'); end if;
  if job_row.workspace_id <> p_workspace_id then return jsonb_build_object('status', 'wrong_workspace'); end if;
  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  if job_row.payload <> expected_payload
     or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  select * into campaign_row
    from public.sourcing_campaigns campaign
   where campaign.id = p_campaign_id
     and campaign.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'campaign_not_found'); end if;
  if campaign_row.campaign_sha256 <> p_campaign_sha256 then
    return jsonb_build_object('status', 'campaign_hash_mismatch');
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
    return jsonb_build_object('status', 'campaign_hash_mismatch');
  end if;

  select * into workspace_row from public.workspace_state state
   where state.workspace_id = p_workspace_id for update;
  if not found
     or jsonb_typeof(workspace_row.state) <> 'object'
     or jsonb_typeof(workspace_row.state -> 'campaigns') <> 'array' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  document_campaign_status := public.sourcing_campaign_document_status(
    workspace_row.state,
    p_campaign_id
  );

  -- A lost response is a strict no-op replay only when all three durable
  -- state surfaces already prove this exact policy pause.
  if job_row.status = 'succeeded'
     and job_row.result_sha256 = pause_result_sha
     and job_row.last_error is null then
    if campaign_row.status = 'paused'
       and campaign_row.sourcing_pause_reason = p_reason
       and document_campaign_status = 'Paused' then
      return pause_result;
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'lease_expired');
  end if;
  if campaign_row.status <> 'sourcing'
     or document_campaign_status <> 'Sourcing' then
    return jsonb_build_object('status', 'campaign_not_sourcing');
  end if;
  if public.sourcing_batch_expected_query(campaign_row.role_basis, p_batch_ordinal) is not null then
    return jsonb_build_object('status', 'role_supported');
  end if;

  select count(*)
    into matching_campaigns
    from jsonb_array_elements(workspace_row.state -> 'campaigns') item(value)
   where jsonb_typeof(item.value) = 'object'
     and item.value ->> 'id' = p_campaign_id::text;
  if matching_campaigns <> 1 then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  select item.value into projected_campaign
    from jsonb_array_elements(workspace_row.state -> 'campaigns') item(value)
   where jsonb_typeof(item.value) = 'object'
     and item.value ->> 'id' = p_campaign_id::text;
  if jsonb_typeof(projected_campaign -> 'activities') <> 'array' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;

  projected_activity := jsonb_build_object(
    'id', 'sourcing-policy-pause-' || p_job_id::text,
    'type', 'sourcing',
    'title', 'Automated sourcing paused',
    'notes', 'No provider-supported, evidence-grounded query terms were present. No provider request was made.',
    'outcome', p_reason,
    'campaignId', p_campaign_id::text,
    'linkedEntityType', 'campaign',
    'linkedEntityId', p_campaign_id::text,
    'createdAt', to_char(
      wall_now at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  projected_campaign := jsonb_set(
    jsonb_set(projected_campaign, '{status}', '"Paused"'::jsonb, true),
    '{activities}',
    (projected_campaign -> 'activities') || jsonb_build_array(projected_activity),
    true
  );
  select jsonb_agg(
    case when item.value ->> 'id' = p_campaign_id::text
      then projected_campaign else item.value end
    order by item.ordinality
  ) into merged_campaigns
  from jsonb_array_elements(workspace_row.state -> 'campaigns')
    with ordinality item(value, ordinality);

  update public.workspace_state
     set state = jsonb_set(workspace_row.state, '{campaigns}', merged_campaigns, true),
         updated_at = wall_now
   where workspace_id = p_workspace_id;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing policy pause workspace update lost' using errcode = '40001';
  end if;
  update public.sourcing_campaigns
     set status = 'paused', sourcing_pause_reason = p_reason,
         sourcing_stop_reason = null, sourcing_completed_at = null,
         updated_at = wall_now
   where workspace_id = p_workspace_id
     and id = p_campaign_id
     and status = 'sourcing';
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing policy pause campaign update lost' using errcode = '40001';
  end if;
  perform set_config('aria.sourcing_batch_policy_pause_job', p_job_id::text, true);
  update public.aria_jobs
     set status = 'succeeded', result_sha256 = pause_result_sha,
         lease_id = null, lease_expires_at = null,
         last_error = null, updated_at = wall_now
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > wall_now;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing policy pause job update lost' using errcode = '40001';
  end if;

  insert into public.loop_events(
    workspace_id, event_type, subject_kind, subject_id, job_id, payload
  ) values
    (
      p_workspace_id, 'sourcing.paused', 'sourcing_campaign',
      p_campaign_id::text, p_job_id, jsonb_build_object('reason', p_reason)
    ),
    (
      p_workspace_id, 'job.succeeded', 'aria_job', p_job_id::text,
      p_job_id, jsonb_build_object(
        'kind', 'sourcing_batch', 'attempts', job_row.attempt_count,
        'outcome', p_reason, 'result_sha256', pause_result_sha
      )
    );
  return pause_result;
end;
$$;

create or replace function public.validate_sourcing_batch_source_receipts(
  p_receipts jsonb,
  p_canonical_query_sha256 text,
  p_provider_page integer,
  p_require_success boolean,
  p_provider_mode text default 'anonymous'
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  receipt jsonb;
  rate_limit jsonb;
  receipt_ordinal integer;
  expected_ordinal integer := 0;
begin
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array'
     or jsonb_array_length(p_receipts) > 4
     or pg_column_size(p_receipts) > 16384
     or p_canonical_query_sha256 !~ '^[0-9a-f]{64}$'
     or p_provider_page is null
     or p_provider_mode is null
     or p_provider_mode not in ('anonymous', 'authenticated')
     or p_provider_page not between 1 and public.sourcing_max_batch_ordinal() + 1 then
    return false;
  end if;
  if p_require_success and jsonb_array_length(p_receipts) < 1 then
    return false;
  end if;

  for receipt in select value from jsonb_array_elements(p_receipts)
  loop
    if jsonb_typeof(receipt) <> 'object'
       or receipt - array[
         'provider', 'providerMode', 'ordinal', 'endpointTemplate',
         'providerPage', 'canonicalQuerySha256', 'outcome', 'statusCode', 'responseBytes',
         'responseSha256', 'requestIdSha256', 'rateLimit', 'retryAfterSeconds'
       ] <> '{}'::jsonb
       or not (receipt ?& array[
         'provider', 'providerMode', 'ordinal', 'endpointTemplate',
         'providerPage', 'canonicalQuerySha256', 'outcome', 'statusCode', 'responseBytes',
         'responseSha256'
       ])
       or receipt ->> 'provider' <> 'github'
       or receipt ->> 'providerMode' <> p_provider_mode
       or jsonb_typeof(receipt -> 'providerPage') <> 'number'
       or (receipt ->> 'providerPage') !~ '^[1-5]$'
       or (receipt ->> 'providerPage')::integer <> p_provider_page
       or jsonb_typeof(receipt -> 'ordinal') <> 'number'
       or (receipt ->> 'ordinal') !~ '^[0-3]$' then
      return false;
    end if;
    receipt_ordinal := (receipt ->> 'ordinal')::integer;
    if receipt_ordinal <> expected_ordinal
       or receipt ->> 'endpointTemplate' <> (
         case when expected_ordinal = 0 then '/search/users' else '/users/{login}' end
       )
       or receipt ->> 'canonicalQuerySha256' <> p_canonical_query_sha256
       or coalesce(receipt ->> 'outcome', '') !~ '^[a-z0-9_]{2,40}$'
       or jsonb_typeof(receipt -> 'responseBytes') <> 'number'
       or (receipt ->> 'responseBytes') !~ '^[0-9]{1,6}$'
       or (receipt ->> 'responseBytes')::integer > 128000 then
      return false;
    end if;
    if jsonb_typeof(receipt -> 'statusCode') not in ('number', 'null')
       or (jsonb_typeof(receipt -> 'statusCode') = 'number' and (
         (receipt ->> 'statusCode') !~ '^[1-5][0-9]{2}$'
       )) then
      return false;
    end if;
    if jsonb_typeof(receipt -> 'responseSha256') not in ('string', 'null')
       or (jsonb_typeof(receipt -> 'responseSha256') = 'string'
         and (receipt ->> 'responseSha256') !~ '^[0-9a-f]{64}$') then
      return false;
    end if;
    if receipt ? 'requestIdSha256' and (
      jsonb_typeof(receipt -> 'requestIdSha256') <> 'string'
      or (receipt ->> 'requestIdSha256') !~ '^[0-9a-f]{64}$'
    ) then
      return false;
    end if;
    if receipt ? 'retryAfterSeconds' and (
      jsonb_typeof(receipt -> 'retryAfterSeconds') <> 'number'
      or (receipt ->> 'retryAfterSeconds') !~ '^[0-9]{1,5}$'
      or (receipt ->> 'retryAfterSeconds')::integer > 86400
    ) then
      return false;
    end if;
    if receipt ? 'rateLimit' then
      rate_limit := receipt -> 'rateLimit';
      if jsonb_typeof(rate_limit) <> 'object'
         or rate_limit - array['limit', 'remaining', 'resetEpochSeconds', 'resource'] <> '{}'::jsonb
         or (rate_limit ? 'limit' and (
           jsonb_typeof(rate_limit -> 'limit') <> 'number'
           or (rate_limit ->> 'limit') !~ '^[0-9]{1,7}$'
         ))
         or (rate_limit ? 'remaining' and (
           jsonb_typeof(rate_limit -> 'remaining') <> 'number'
           or (rate_limit ->> 'remaining') !~ '^[0-9]{1,7}$'
         ))
         or (rate_limit ? 'resetEpochSeconds' and (
           jsonb_typeof(rate_limit -> 'resetEpochSeconds') <> 'number'
           or (rate_limit ->> 'resetEpochSeconds') !~ '^[0-9]{1,10}$'
         ))
         or (rate_limit ? 'resource' and rate_limit ->> 'resource' not in ('search', 'core')) then
        return false;
      end if;
    end if;
    if p_require_success and expected_ordinal = 0
       and (receipt ->> 'outcome' <> 'success' or (receipt ->> 'statusCode')::integer <> 200) then
      return false;
    end if;
    expected_ordinal := expected_ordinal + 1;
  end loop;
  return true;
end;
$$;

create or replace function public.sourcing_batch_result_sha256(
  p_workspace_id uuid,
  p_job_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_claim_token uuid,
  p_fence_version bigint,
  p_egress_attempt_id uuid,
  p_query jsonb,
  p_candidates jsonb,
  p_provider_mode text default 'anonymous'
) returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate_evidence text;
  canonical_payload text;
begin
  if p_provider_mode is null
     or p_provider_mode not in ('anonymous', 'authenticated') then
    return null;
  end if;

  select coalesce(
    '[' || string_agg(
      '{"id":' || to_json(item.value ->> 'id')::text
      || ',"externalId":' || to_json(item.value -> 'sourceEvidence' ->> 'externalId')::text
      || ',"rawResponseSha256":' || to_json(item.value -> 'sourceEvidence' ->> 'rawResponseSha256')::text
      || ',"normalizedPayloadSha256":' || to_json(item.value -> 'sourceEvidence' ->> 'normalizedPayloadSha256')::text
      || '}',
      ',' order by item.ordinality
    ) || ']',
    '[]'
  ) into candidate_evidence
  from jsonb_array_elements(p_candidates) with ordinality item(value, ordinality);

  canonical_payload := '{"version":"aria.sourcing-batch-result.v1"'
    || ',"workspaceId":' || to_json(p_workspace_id::text)::text
    || ',"jobId":' || to_json(p_job_id::text)::text
    || ',"campaignId":' || to_json(p_campaign_id::text)::text
    || ',"campaignSha256":' || to_json(p_campaign_sha256)::text
    || ',"batchOrdinal":' || p_batch_ordinal::text
    || ',"claimToken":' || to_json(p_claim_token::text)::text
    || ',"fenceVersion":' || p_fence_version::text
    || ',"egressAttemptId":' || to_json(p_egress_attempt_id::text)::text
    || ',"providerMode":' || to_json(p_provider_mode)::text
    || ',"query":{"policyVersion":' || to_json(p_query ->> 'policyVersion')::text
    || ',"value":' || to_json(p_query ->> 'value')::text
    || ',"page":' || (p_query ->> 'page')
    || ',"sha256":' || to_json(p_query ->> 'sha256')::text || '}'
    || ',"candidates":' || candidate_evidence || '}';
  return encode(sha256(convert_to(canonical_payload, 'UTF8')), 'hex');
end;
$$;

do $$
declare function_name text;
begin
  foreach function_name in array array[
    'sourcing_batch_expected_query(jsonb,integer)',
    'sourcing_batch_query_is_allowed(jsonb,integer,jsonb)',
    'validate_sourcing_batch_source_receipts(jsonb,text,integer,boolean,text)',
    'sourcing_batch_result_sha256(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb,text)'
  ]
  loop
    execute format(
      'revoke all on function public.%s from public, anon, authenticated, service_role, authenticator',
      function_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mutation and erasure guards.
-- ---------------------------------------------------------------------------
create or replace function public.reject_sourcing_batch_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'sourcing batch receipts are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_sourcing_batch_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists sourcing_batch_source_receipts_append_only
  on public.sourcing_batch_source_receipts;
create trigger sourcing_batch_source_receipts_append_only
  before update or delete on public.sourcing_batch_source_receipts
  for each row execute function public.reject_sourcing_batch_receipt_mutation();

drop trigger if exists sourcing_batch_receipts_append_only
  on public.sourcing_batch_receipts;
create trigger sourcing_batch_receipts_append_only
  before update or delete on public.sourcing_batch_receipts
  for each row execute function public.reject_sourcing_batch_receipt_mutation();

drop trigger if exists sourcing_provider_quota_ledger_append_only
  on public.sourcing_provider_quota_ledger;
create trigger sourcing_provider_quota_ledger_append_only
  before update or delete on public.sourcing_provider_quota_ledger
  for each row execute function public.reject_sourcing_batch_receipt_mutation();

create or replace function public.reject_sourcing_candidate_evidence_reimport()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    new.workspace_id, 'candidate_id', new.candidate_id
  ));
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    new.workspace_id, 'github', new.github_url
  ));
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    new.workspace_id, 'provider_external_id', new.provider_external_id
  ));

  if public.candidate_erasure_tombstone_exists(
       new.workspace_id, 'candidate_id', new.candidate_id
     )
     or public.candidate_erasure_tombstone_exists(
       new.workspace_id, 'github', new.github_url
     )
     or public.candidate_erasure_tombstone_exists(
       new.workspace_id, 'source_url', new.github_url
     )
     or public.candidate_erasure_tombstone_exists(
       new.workspace_id, 'source_external_id', new.provider_external_id
     )
     or public.candidate_erasure_tombstone_exists(
       new.workspace_id, 'provider_external_id', new.provider_external_id
     ) then
    raise exception 'candidate erasure tombstone blocks sourcing evidence reimport'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.suppression_list suppression
     where suppression.workspace_id = new.workspace_id
       and (suppression.expires_at is null or suppression.expires_at > clock_timestamp())
       and lower(btrim(suppression.value)) = lower(btrim(new.github_url))
  ) then
    raise exception 'suppression list blocks sourcing evidence reimport'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_sourcing_candidate_evidence_reimport()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists sourcing_candidate_evidence_reimport_guard
  on public.sourcing_candidate_evidence;
create trigger sourcing_candidate_evidence_reimport_guard
  before insert or update on public.sourcing_candidate_evidence
  for each row execute function public.reject_sourcing_candidate_evidence_reimport();

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results',
    'sourcing_candidate_evidence'
  ));

create or replace function public.cleanup_sourcing_candidate_evidence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  scrubbed integer := 0;
begin
  if new.status = 'blocked_legal_hold' then
    return null;
  end if;
  delete from public.sourcing_candidate_evidence evidence
   where evidence.workspace_id = new.workspace_id
     and evidence.campaign_id::text = new.campaign_id
     and evidence.candidate_id = new.candidate_id;
  get diagnostics scrubbed = row_count;
  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values (
    new.id, new.workspace_id, 'sourcing_candidate_evidence', scrubbed
  ) on conflict (request_id, store_name) do nothing;
  return null;
end;
$$;

revoke all on function public.cleanup_sourcing_candidate_evidence()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_erasure_requests_sourcing_evidence_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_sourcing_evidence_cleanup
  after insert or update of status on public.candidate_erasure_requests
  for each row execute function public.cleanup_sourcing_candidate_evidence();

-- Any generic completion after egress begins is unsafe. GitHub discovery is
-- read-only, however, so an expired begun GET may be retried under a new
-- quota reservation and fence. The reaper may requeue it only while the job's
-- bounded attempt budget remains; terminal exhaustion stays dead.
create or replace function public.guard_sourcing_batch_job_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  attempt_row public.sourcing_batch_egress_attempts%rowtype;
  authority_attempt text := current_setting('aria.sourcing_batch_commit_attempt', true);
  policy_pause_job text := current_setting('aria.sourcing_batch_policy_pause_job', true);
begin
  if old.kind <> 'sourcing_batch' then
    return new;
  end if;

  select * into attempt_row
    from public.sourcing_batch_egress_attempts attempt
   where attempt.job_id = old.id
   order by attempt.fence_version desc
   limit 1
   for update;

  if new.status = 'succeeded' then
    if old.status = 'leased'
       and not found
       and policy_pause_job = old.id::text
       and new.result_sha256 is not null
       and new.last_error is null
       and new.lease_id is null
       and new.lease_expires_at is null then
      return new;
    end if;
    if not found
       or attempt_row.status <> 'completed'
       or authority_attempt is null
       or authority_attempt <> attempt_row.id::text then
      raise exception 'sourcing batch completion requires its dedicated authority'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if found and attempt_row.status = 'begun'
     and old.status = 'leased'
     and new.status in ('queued', 'dead') then
    update public.sourcing_batch_egress_attempts
       set status = case when new.status = 'queued' then 'retryable_failed' else 'dead' end,
           error_code = 'lease_expired_after_egress',
           settled_at = clock_timestamp()
     where id = attempt_row.id;
    update public.sourcing_batch_claims
       set state = case when new.status = 'queued' then 'retryable_failed' else 'dead' end,
           egress_attempt_id = case when new.status = 'queued' then null else attempt_row.id end,
           updated_at = clock_timestamp()
     where job_id = old.id
       and egress_attempt_id = attempt_row.id;
    new.lease_id := null;
    new.lease_expires_at := null;
    new.last_error := case when new.status = 'queued'
      then 'lease expired after read-only sourcing egress; retry fenced'
      else 'lease expired after read-only sourcing egress; attempts exhausted' end;
  end if;

  if old.status = 'dead' and new.status = 'queued' and found
     and attempt_row.status in ('ambiguous', 'dead') then
    raise exception 'ambiguous or terminal sourcing egress cannot be generically requeued'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sourcing_batch_job_transition()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists aria_jobs_sourcing_batch_transition_guard on public.aria_jobs;
create trigger aria_jobs_sourcing_batch_transition_guard
  before update of status, lease_id, lease_expires_at on public.aria_jobs
  for each row execute function public.guard_sourcing_batch_job_transition();

-- ---------------------------------------------------------------------------
-- Fair bounded sourcing claims. One pass ranks jobs within each workspace,
-- then claims rank one across workspaces before rank two. The hard cap of
-- three is enforced in the database as well as worker configuration.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_sourcing_batch_jobs(
  p_worker_id text,
  p_lease_seconds integer,
  p_limit integer
) returns setof public.aria_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600
     or p_limit is null or p_limit not between 1 and 3 then
    return;
  end if;

  return query
  with ranked as materialized (
    select due.id,
           due.workspace_id,
           due.priority,
           due.next_run_at,
           row_number() over (
             partition by due.workspace_id
             order by due.priority, due.next_run_at, due.id
           ) as workspace_rank
      from public.aria_jobs due
     where due.status = 'queued'
       and due.kind = 'sourcing_batch'
       and due.next_run_at <= now()
  ), selected as (
    select job.id
      from ranked
      join public.aria_jobs job on job.id = ranked.id
     order by ranked.workspace_rank, ranked.priority, ranked.next_run_at,
              ranked.workspace_id, ranked.id
     limit p_limit
       for update of job skip locked
  )
  update public.aria_jobs job
     set status = 'leased',
         lease_id = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         claimed_by = p_worker_id,
         attempt_count = job.attempt_count + 1,
         updated_at = now()
   where job.id in (select selected.id from selected)
  returning job.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- authorize_sourcing_batch. Locks and validates the exact leased job and
-- immutable campaign, then reserves conservative mode-specific GitHub capacity.
-- Repeating the same lease returns the same token/fence. Only a deliberately
-- settled retryable attempt may advance to a new fence on a new lease.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_sourcing_batch(
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
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  profile_row public.profiles%rowtype;
  workspace_row public.workspace_state%rowtype;
  claim_row public.sourcing_batch_claims%rowtype;
  receipt_row public.sourcing_batch_receipts%rowtype;
  learning_control_row public.sourcing_learning_controls%rowtype;
  lesson_selection record;
  expected_payload jsonb;
  expected_payload_sha text;
  expected_campaign_sha text;
  expected_query jsonb;
  applied_lesson jsonb;
  role_sha text;
  expected_role_fingerprint text;
  wall_now timestamptz;
  minute_bucket timestamptz;
  hour_bucket timestamptz;
  day_bucket timestamptz;
  used_units integer;
  next_fence bigint;
  next_token uuid;
  document_campaign_status text;
  claim_exists boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or p_provider_mode is null
     or p_provider_mode not in ('anonymous', 'authenticated') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  if job_row.kind <> 'sourcing_batch' then return jsonb_build_object('status', 'wrong_kind'); end if;
  if job_row.workspace_id <> p_workspace_id then return jsonb_build_object('status', 'wrong_workspace'); end if;

  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  expected_payload_sha := encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex');
  if job_row.payload <> expected_payload or job_row.payload_sha256 <> expected_payload_sha then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  if job_row.status = 'succeeded'
     and job_row.result_sha256 = encode(sha256(convert_to(jsonb_build_object(
       'status', 'campaign_paused',
       'job_id', p_job_id,
       'campaign_id', p_campaign_id,
       'reason', 'no_supported_query_terms'
     )::text, 'UTF8')), 'hex')
     and job_row.last_error is null then
    return public.pause_sourcing_batch_pre_egress(
      p_job_id, p_lease_id, p_workspace_id, p_campaign_id,
      p_campaign_sha256, p_batch_ordinal, 'no_supported_query_terms'
    );
  end if;

  if job_row.status = 'succeeded' then
    select * into receipt_row from public.sourcing_batch_receipts where job_id = p_job_id;
    if found
       and receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.campaign_id = p_campaign_id
       and receipt_row.campaign_sha256 = p_campaign_sha256
       and receipt_row.batch_ordinal = p_batch_ordinal
       and receipt_row.result_sha256 = job_row.result_sha256
       and exists (
         select 1 from public.sourcing_batch_egress_attempts attempt
          where attempt.id = receipt_row.egress_attempt_id
            and attempt.job_id = p_job_id
            and attempt.status = 'completed'
            and attempt.result_sha256 = receipt_row.result_sha256
            and attempt.candidate_count = receipt_row.candidate_count
            and attempt.query_count = receipt_row.query_count
            and attempt.canonical_query_sha256 = receipt_row.canonical_query_sha256
       ) then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'job_id', p_job_id,
        'workspace_id', p_workspace_id,
        'campaign_id', p_campaign_id,
        'campaign_sha256', p_campaign_sha256,
        'batch_ordinal', p_batch_ordinal,
        'candidate_count', receipt_row.candidate_count,
        'query_count', receipt_row.query_count,
        'result_sha256', receipt_row.result_sha256,
        'provider_mode', receipt_row.provider_mode,
        'canonical_query', receipt_row.canonical_query,
        'applied_lesson', receipt_row.applied_lesson
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  select * into campaign_row
    from public.sourcing_campaigns campaign
   where campaign.id = p_campaign_id
     and campaign.workspace_id = p_workspace_id
   for share;
  if not found then return jsonb_build_object('status', 'campaign_not_found'); end if;
  if campaign_row.campaign_sha256 <> p_campaign_sha256 then
    return jsonb_build_object('status', 'campaign_hash_mismatch');
  end if;
  if campaign_row.status <> 'sourcing' then
    return jsonb_build_object('status', 'campaign_not_sourcing');
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
    return jsonb_build_object('status', 'campaign_hash_mismatch');
  end if;

  select * into control_row
    from public.sourcing_loop_controls control
   where control.workspace_id = p_workspace_id
   for share;
  if not found or control_row.kill_switch or not control_row.sourcing_enabled
     or control_row.max_sourcing_runs_per_day <= 0 or control_row.updated_by is null then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;
  if control_row.updated_by <> campaign_row.activation_actor_id then
    return jsonb_build_object('status', 'activation_actor_invalid');
  end if;
  select * into profile_row from public.profiles profile
   where profile.workspace_id = p_workspace_id
     and profile.id = campaign_row.activation_actor_id
   for share;
  if not found or profile_row.role <> 'admin' then
    return jsonb_build_object('status', 'activation_actor_invalid');
  end if;

  select * into workspace_row from public.workspace_state state
   where state.workspace_id = p_workspace_id for share;
  if not found
     or jsonb_typeof(workspace_row.state) <> 'object'
     or not exists (
    select 1 from public.sourcing_learning_secrets secret
     where secret.workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  document_campaign_status := public.sourcing_campaign_document_status(
    workspace_row.state,
    p_campaign_id
  );
  if document_campaign_status is null then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  if document_campaign_status <> 'Sourcing' then
    return jsonb_build_object('status', 'campaign_not_sourcing');
  end if;
  expected_query := public.sourcing_batch_expected_query(
    campaign_row.role_basis,
    p_batch_ordinal
  );
  if expected_query is null then
    return public.pause_sourcing_batch_pre_egress(
      p_job_id, p_lease_id, p_workspace_id, p_campaign_id,
      p_campaign_sha256, p_batch_ordinal, 'no_supported_query_terms'
    );
  end if;
  role_sha := encode(sha256(convert_to(campaign_row.role_basis::text, 'UTF8')), 'hex');
  expected_role_fingerprint := public.sourcing_authority_hmac(
    p_workspace_id,
    campaign_row.role_basis::text
  );

  select * into claim_row from public.sourcing_batch_claims claim
   where claim.job_id = p_job_id for update;
  claim_exists := found;
  if claim_exists and claim_row.lease_id = p_lease_id then
    if claim_row.workspace_id <> p_workspace_id
       or claim_row.campaign_id <> p_campaign_id
       or claim_row.campaign_sha256 <> p_campaign_sha256
       or claim_row.batch_ordinal <> p_batch_ordinal
       or claim_row.role_basis <> campaign_row.role_basis
       or claim_row.role_basis_sha256 <> role_sha
       or not public.sourcing_batch_query_is_allowed(
         campaign_row.role_basis,
         p_batch_ordinal,
         claim_row.canonical_query
       )
       or claim_row.provider_mode <> p_provider_mode
       or claim_row.state not in ('authorized', 'begun') then
      return jsonb_build_object('status', 'replay_conflict');
    end if;
    expected_query := claim_row.canonical_query;
    return jsonb_build_object(
      'status', 'authorized', 'job_id', p_job_id, 'lease_id', p_lease_id,
      'workspace_id', p_workspace_id, 'campaign_id', p_campaign_id,
      'campaign_sha256', p_campaign_sha256, 'batch_ordinal', p_batch_ordinal,
      'activation_actor_id', campaign_row.activation_actor_id,
      'claim_token', claim_row.claim_token, 'fence_version', claim_row.fence_version,
      'provider_mode', claim_row.provider_mode, 'role_basis', campaign_row.role_basis,
      'canonical_query', claim_row.canonical_query,
      'applied_lesson', claim_row.applied_lesson,
      'workspace_updated_at', to_char(
        claim_row.workspace_updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );
  end if;
  if claim_exists and claim_row.state <> 'retryable_failed' then
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if claim_exists and not public.sourcing_batch_query_is_allowed(
    campaign_row.role_basis,
    p_batch_ordinal,
    claim_row.canonical_query
  ) then
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if claim_exists then
    expected_query := claim_row.canonical_query;
  end if;

  -- A current human-promoted Graphify lesson may reorder the finite query
  -- variants already derived by the server for this role and provider page.
  -- The chosen query and full lesson identity are snapshotted before egress.
  if claim_exists then
    applied_lesson := claim_row.applied_lesson;
  else
    select * into learning_control_row
      from public.sourcing_learning_controls control
     where control.workspace_id = p_workspace_id
       and control.enabled
       and control.required_graphify_image_digest is not null
     for share;
    if found then
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
          select public.sourcing_batch_expected_query(
            campaign_row.role_basis,
            candidate_ordinal
          ) as canonical_query
          from generate_series(
            0,
            public.sourcing_max_batch_ordinal()
          ) candidate_ordinal
        ) candidate
       where lesson.workspace_id = p_workspace_id
         and lesson.role_fingerprint = expected_role_fingerprint
         and lesson.platform = 'GitHub'
         and lesson.status = 'promoted'
         and lesson.promoted_by = review.reviewer_id
         and lesson.expires_at > wall_now
         and lesson.graphify_artifact_sha256 is not null
         and lesson.graphify_cluster_ref is not null
         and lesson.graphify_commit is not null
         and lesson.graphify_export_id is not null
         and candidate.canonical_query is not null
         and candidate.canonical_query ->> 'page' = expected_query ->> 'page'
         and lesson.query_text = candidate.canonical_query ->> 'value'
         and lesson.query_hmac = public.sourcing_authority_hmac(
           p_workspace_id,
           'query:GitHub:' || (candidate.canonical_query ->> 'value')
         )
         and not exists (
           select 1
             from public.sourcing_batch_claims prior_claim
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
        expected_query := lesson_selection.canonical_query;
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
          'query_value', expected_query ->> 'value',
          'query_sha256', expected_query ->> 'sha256'
        );
        applied_lesson := applied_lesson || jsonb_build_object(
          'snapshot_sha256', public.sourcing_batch_lesson_snapshot_sha256(applied_lesson)
        );
      end if;
    end if;

    -- If learning reordered an earlier batch, do not fall back to a query
    -- already claimed for this campaign. Select the first remaining variant
    -- on the same server-owned page; no lesson can expand this set.
    if exists (
      select 1
        from public.sourcing_batch_claims prior_claim
       where prior_claim.workspace_id = p_workspace_id
         and prior_claim.campaign_id = p_campaign_id
         and prior_claim.campaign_sha256 = p_campaign_sha256
         and prior_claim.job_id <> p_job_id
         and prior_claim.applied_lesson is not null
         and prior_claim.canonical_query = expected_query
    ) then
      select candidate.canonical_query
        into expected_query
        from (
          select candidate_ordinal,
                 public.sourcing_batch_expected_query(
                   campaign_row.role_basis,
                   candidate_ordinal
                 ) as canonical_query
            from generate_series(
              0,
              public.sourcing_max_batch_ordinal()
            ) candidate_ordinal
        ) candidate
       where candidate.canonical_query is not null
         and candidate.canonical_query ->> 'page' = (
           public.sourcing_batch_expected_query(
             campaign_row.role_basis,
             p_batch_ordinal
           ) ->> 'page'
         )
         and not exists (
           select 1
             from public.sourcing_batch_claims prior_claim
            where prior_claim.workspace_id = p_workspace_id
              and prior_claim.campaign_id = p_campaign_id
              and prior_claim.campaign_sha256 = p_campaign_sha256
              and prior_claim.job_id <> p_job_id
              and prior_claim.applied_lesson is not null
              and prior_claim.canonical_query = candidate.canonical_query
         )
       order by candidate.candidate_ordinal
       limit 1;
      if not found then
        return jsonb_build_object('status', 'query_variants_exhausted');
      end if;
      applied_lesson := null;
    end if;
  end if;

  next_fence := case when claim_exists then claim_row.fence_version + 1 else 1 end;
  next_token := gen_random_uuid();
  minute_bucket := date_trunc('minute', wall_now);
  hour_bucket := date_trunc('hour', wall_now);
  day_bucket := date_trunc('day', wall_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'github:' || p_provider_mode || ':global_search_minute:' || minute_bucket::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'github:' || p_provider_mode || ':global_core_hour:' || hour_bucket::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'github:workspace_batch_day:'
      || p_workspace_id::text || ':' || day_bucket::text, 0
  ));

  select coalesce(sum(quota.reserved_units), 0) into used_units
    from public.sourcing_provider_quota_ledger quota
   where quota.provider = 'github' and quota.provider_mode = p_provider_mode
     and quota.scope_kind = 'global_search_minute' and quota.window_start = minute_bucket;
  if used_units + 1 > (case when p_provider_mode = 'anonymous' then 8 else 20 end) then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;
  select coalesce(sum(quota.reserved_units), 0) into used_units
    from public.sourcing_provider_quota_ledger quota
   where quota.provider = 'github' and quota.provider_mode = p_provider_mode
     and quota.scope_kind = 'global_core_hour' and quota.window_start = hour_bucket;
  if used_units + 3 > (case when p_provider_mode = 'anonymous' then 48 else 300 end) then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;
  select coalesce(sum(quota.reserved_units), 0) into used_units
    from public.sourcing_provider_quota_ledger quota
   where quota.workspace_id = p_workspace_id and quota.provider = 'github'
     and quota.scope_kind = 'workspace_batch_day'
     and quota.window_start = day_bucket;
  if used_units + 1 > control_row.max_sourcing_runs_per_day then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;

  if not claim_exists then
    insert into public.sourcing_batch_claims(
      job_id, workspace_id, campaign_id, campaign_sha256, batch_ordinal,
      lease_id, claim_token, fence_version, provider_mode, role_basis,
      role_basis_sha256, canonical_query, applied_lesson,
      workspace_updated_at, state
    ) values (
      p_job_id, p_workspace_id, p_campaign_id, p_campaign_sha256, p_batch_ordinal,
      p_lease_id, next_token, next_fence, p_provider_mode, campaign_row.role_basis,
      role_sha, expected_query, applied_lesson, workspace_row.updated_at, 'authorized'
    ) returning * into claim_row;
  else
    update public.sourcing_batch_claims
       set lease_id = p_lease_id, claim_token = next_token,
           fence_version = next_fence, provider_mode = p_provider_mode,
           role_basis = campaign_row.role_basis,
           role_basis_sha256 = role_sha, workspace_updated_at = workspace_row.updated_at,
           state = 'authorized', egress_attempt_id = null, updated_at = wall_now
     where job_id = p_job_id
     returning * into claim_row;
  end if;

  insert into public.sourcing_provider_quota_ledger(
    job_id, workspace_id, claim_token, fence_version, provider, provider_mode,
    scope_kind, window_start, reserved_units
  ) values
    (p_job_id, p_workspace_id, next_token, next_fence, 'github', p_provider_mode,
     'global_search_minute', minute_bucket, 1),
    (p_job_id, p_workspace_id, next_token, next_fence, 'github', p_provider_mode,
     'global_core_hour', hour_bucket, 3),
    (p_job_id, p_workspace_id, next_token, next_fence, 'github', p_provider_mode,
     'workspace_batch_day', day_bucket, 1);

  return jsonb_build_object(
    'status', 'authorized', 'job_id', p_job_id, 'lease_id', p_lease_id,
    'workspace_id', p_workspace_id, 'campaign_id', p_campaign_id,
    'campaign_sha256', p_campaign_sha256, 'batch_ordinal', p_batch_ordinal,
    'activation_actor_id', campaign_row.activation_actor_id,
    'claim_token', next_token, 'fence_version', next_fence,
    'provider_mode', claim_row.provider_mode, 'role_basis', campaign_row.role_basis,
    'canonical_query', claim_row.canonical_query,
    'applied_lesson', claim_row.applied_lesson,
    'workspace_updated_at', to_char(
      workspace_row.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- begin_sourcing_batch_egress. Exactly one caller can turn an authorized
-- claim into a begun attempt. A duplicate receives already_begun and must do
-- no HTTP. Quota was already reserved under the same claim/fence.
-- ---------------------------------------------------------------------------
create or replace function public.begin_sourcing_batch_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_claim_token uuid,
  p_fence_version bigint,
  p_provider_mode text,
  p_canonical_query_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.sourcing_batch_claims%rowtype;
  attempt_row public.sourcing_batch_egress_attempts%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  profile_row public.profiles%rowtype;
  workspace_row public.workspace_state%rowtype;
  expected_payload jsonb;
  expected_query jsonb;
  expected_campaign_sha text;
  wall_now timestamptz;
  quota_rows integer;
  document_campaign_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_provider_mode is null
     or p_provider_mode not in ('anonymous', 'authenticated')
     or p_canonical_query_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  if job_row.kind <> 'sourcing_batch' then return jsonb_build_object('status', 'wrong_kind'); end if;
  if job_row.workspace_id <> p_workspace_id then return jsonb_build_object('status', 'wrong_workspace'); end if;
  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  if job_row.payload <> expected_payload
     or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  select * into claim_row from public.sourcing_batch_claims claim
   where claim.job_id = p_job_id for update;
  if not found or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.campaign_id <> p_campaign_id
     or claim_row.campaign_sha256 <> p_campaign_sha256
     or claim_row.batch_ordinal <> p_batch_ordinal
     or claim_row.provider_mode <> p_provider_mode then
    return jsonb_build_object('status', 'claim_mismatch');
  end if;
  if claim_row.claim_token <> p_claim_token then
    return jsonb_build_object('status', 'claim_mismatch');
  end if;
  if claim_row.fence_version <> p_fence_version then
    return jsonb_build_object('status', 'fence_mismatch');
  end if;
  expected_query := claim_row.canonical_query;
  if expected_query is null
     or not public.sourcing_batch_query_is_allowed(
       claim_row.role_basis,
       p_batch_ordinal,
       expected_query
     )
     or expected_query ->> 'sha256' <> p_canonical_query_sha256 then
    return jsonb_build_object('status', 'query_mismatch');
  end if;

  if claim_row.state = 'begun' then
    select * into attempt_row from public.sourcing_batch_egress_attempts attempt
     where attempt.job_id = p_job_id
       and attempt.fence_version = p_fence_version;
    if found and attempt_row.claim_token = p_claim_token
       and attempt_row.lease_id = p_lease_id
       and attempt_row.provider_mode = p_provider_mode
       and attempt_row.canonical_query_sha256 = p_canonical_query_sha256
       and attempt_row.status = 'begun' then
      return jsonb_build_object('status', 'already_begun');
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if claim_row.state <> 'authorized' then
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  -- Authorization and egress are separate calls. Re-lock every stop-control
  -- authority at the final pre-egress boundary so an administrator engaging
  -- the kill switch, disabling sourcing, changing the campaign, or losing the
  -- activation role between those calls prevents the external request.
  select * into campaign_row
    from public.sourcing_campaigns campaign
   where campaign.id = p_campaign_id
     and campaign.workspace_id = p_workspace_id
   for share;
  if not found or campaign_row.status <> 'sourcing'
     or campaign_row.campaign_sha256 <> p_campaign_sha256
     or campaign_row.role_basis <> claim_row.role_basis then
    return jsonb_build_object('status', 'campaign_changed');
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
    return jsonb_build_object('status', 'campaign_changed');
  end if;
  select * into control_row
    from public.sourcing_loop_controls control
   where control.workspace_id = p_workspace_id
   for share;
  if not found or control_row.kill_switch or not control_row.sourcing_enabled
     or control_row.max_sourcing_runs_per_day <= 0 or control_row.updated_by is null then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;
  if control_row.updated_by <> campaign_row.activation_actor_id then
    return jsonb_build_object('status', 'activation_actor_invalid');
  end if;
  select * into profile_row
    from public.profiles profile
   where profile.workspace_id = p_workspace_id
     and profile.id = campaign_row.activation_actor_id
   for share;
  if not found or profile_row.role <> 'admin' then
    return jsonb_build_object('status', 'activation_actor_invalid');
  end if;

  select * into workspace_row
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  if not found or jsonb_typeof(workspace_row.state) <> 'object' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  document_campaign_status := public.sourcing_campaign_document_status(
    workspace_row.state,
    p_campaign_id
  );
  if document_campaign_status is null then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  if document_campaign_status <> 'Sourcing' then
    return jsonb_build_object('status', 'campaign_not_sourcing');
  end if;

  select count(*) into quota_rows
    from public.sourcing_provider_quota_ledger quota
   where quota.job_id = p_job_id
     and quota.workspace_id = p_workspace_id
     and quota.claim_token = p_claim_token
     and quota.fence_version = p_fence_version
     and quota.provider = 'github'
     and quota.provider_mode = p_provider_mode
     and quota.scope_kind in (
       'global_search_minute', 'global_core_hour', 'workspace_batch_day'
     );
  if quota_rows <> 3 then
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  insert into public.sourcing_batch_egress_attempts(
    job_id, workspace_id, campaign_id, campaign_sha256, batch_ordinal,
    lease_id, claim_token, fence_version, provider, provider_mode,
    canonical_query_sha256, status
  ) values (
    p_job_id, p_workspace_id, p_campaign_id, p_campaign_sha256, p_batch_ordinal,
    p_lease_id, p_claim_token, p_fence_version, 'github', p_provider_mode,
    p_canonical_query_sha256, 'begun'
  ) returning * into attempt_row;

  update public.sourcing_batch_claims
     set state = 'begun', egress_attempt_id = attempt_row.id, updated_at = wall_now
   where job_id = p_job_id;

  return jsonb_build_object(
    'status', 'begun', 'job_id', p_job_id, 'workspace_id', p_workspace_id,
    'campaign_id', p_campaign_id, 'claim_token', p_claim_token,
    'fence_version', p_fence_version, 'egress_attempt_id', attempt_row.id,
    'provider_mode', p_provider_mode,
    'canonical_query_sha256', p_canonical_query_sha256
  );
exception when unique_violation then
  return jsonb_build_object('status', 'already_begun');
end;
$$;

-- Internal insertion helper. Validation is complete before the first INSERT,
-- so a false result never leaves a partial source-receipt ledger.
create or replace function public.persist_sourcing_batch_source_receipts(
  p_egress_attempt_id uuid,
  p_workspace_id uuid,
  p_job_id uuid,
  p_canonical_query_sha256 text,
  p_provider_page integer,
  p_receipts jsonb,
  p_require_success boolean,
  p_provider_mode text default 'anonymous'
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare receipt jsonb;
begin
  if not public.validate_sourcing_batch_source_receipts(
    p_receipts, p_canonical_query_sha256, p_provider_page,
    p_require_success, p_provider_mode
  ) then
    return false;
  end if;
  for receipt in select value from jsonb_array_elements(p_receipts)
  loop
    insert into public.sourcing_batch_source_receipts(
      egress_attempt_id, ordinal, workspace_id, job_id,
      canonical_query_sha256, receipt, receipt_sha256
    ) values (
      p_egress_attempt_id, (receipt ->> 'ordinal')::integer,
      p_workspace_id, p_job_id, p_canonical_query_sha256, receipt,
      encode(sha256(convert_to(receipt::text, 'UTF8')), 'hex')
    );
  end loop;
  return true;
end;
$$;

revoke all on function public.persist_sourcing_batch_source_receipts(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text
) from public, anon, authenticated, service_role, authenticator;

create or replace function public.validate_sourcing_batch_candidates(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_query jsonb,
  p_candidates jsonb,
  p_source_receipts jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate jsonb;
  evidence jsonb;
  candidate_id text;
  external_id text;
  login_name text;
  github_url text;
  normalized_payload text;
  expected_normalized_sha text;
  seen_external_ids text[] := array[]::text[];
  seen_search_ordinals integer[] := array[]::integer[];
  matched_language text;
  search_result_ordinal integer;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array'
     or jsonb_array_length(p_candidates) > 3
     or pg_column_size(p_candidates) > 65536 then
    return false;
  end if;

  for candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(candidate) <> 'object'
       or candidate - array[
         'id', 'campaignId', 'name', 'email', 'phone', 'avatarInitials',
         'currentTitle', 'currentCompany', 'location', 'timezone', 'linkedinUrl',
         'githubUrl', 'sourceUrl', 'sourceExternalId', 'externalIds',
         'sourcePlatform', 'sourceQuery', 'matchScore', 'matchBreakdown',
         'techStack', 'experience', 'education', 'languages', 'yearsExperience',
         'companyStageExperience', 'industryExperience', 'recentActivity',
         'stage', 'lastContactedAt', 'outreachHistory', 'replyHistory',
         'booking', 'complianceFlags', 'createdAt', 'provenance', 'sourceEvidence'
       ] <> '{}'::jsonb
       or not (candidate ?& array[
         'id', 'campaignId', 'name', 'email', 'phone', 'avatarInitials',
         'currentTitle', 'currentCompany', 'location', 'timezone', 'linkedinUrl',
         'githubUrl', 'sourceUrl', 'sourceExternalId', 'externalIds',
         'sourcePlatform', 'sourceQuery', 'matchScore', 'matchBreakdown',
         'techStack', 'experience', 'education', 'languages', 'yearsExperience',
         'companyStageExperience', 'industryExperience', 'recentActivity',
         'stage', 'lastContactedAt', 'outreachHistory', 'replyHistory',
         'booking', 'complianceFlags', 'createdAt', 'provenance', 'sourceEvidence'
       ]) then
      return false;
    end if;
    if jsonb_typeof(candidate -> 'id') <> 'string'
       or jsonb_typeof(candidate -> 'campaignId') <> 'string'
       or jsonb_typeof(candidate -> 'name') <> 'string'
       or jsonb_typeof(candidate -> 'email') <> 'string'
       or jsonb_typeof(candidate -> 'phone') <> 'string'
       or jsonb_typeof(candidate -> 'avatarInitials') <> 'string'
       or jsonb_typeof(candidate -> 'currentTitle') <> 'string'
       or jsonb_typeof(candidate -> 'currentCompany') <> 'string'
       or jsonb_typeof(candidate -> 'location') <> 'string'
       or jsonb_typeof(candidate -> 'timezone') <> 'string'
       or jsonb_typeof(candidate -> 'linkedinUrl') <> 'string'
       or jsonb_typeof(candidate -> 'githubUrl') <> 'string'
       or jsonb_typeof(candidate -> 'sourceUrl') <> 'string'
       or jsonb_typeof(candidate -> 'sourceExternalId') <> 'string'
       or jsonb_typeof(candidate -> 'externalIds') <> 'object'
       or jsonb_typeof(candidate -> 'sourcePlatform') <> 'string'
       or jsonb_typeof(candidate -> 'sourceQuery') <> 'string'
       or jsonb_typeof(candidate -> 'matchScore') <> 'number'
       or jsonb_typeof(candidate -> 'matchBreakdown') <> 'array'
       or jsonb_typeof(candidate -> 'techStack') <> 'array'
       or jsonb_typeof(candidate -> 'experience') <> 'array'
       or jsonb_typeof(candidate -> 'education') <> 'array'
       or jsonb_typeof(candidate -> 'languages') <> 'array'
       or jsonb_typeof(candidate -> 'yearsExperience') <> 'null'
       or jsonb_typeof(candidate -> 'companyStageExperience') <> 'array'
       or jsonb_typeof(candidate -> 'industryExperience') <> 'array'
       or jsonb_typeof(candidate -> 'recentActivity') <> 'string'
       or jsonb_typeof(candidate -> 'stage') <> 'string'
       or jsonb_typeof(candidate -> 'lastContactedAt') <> 'null'
       or jsonb_typeof(candidate -> 'outreachHistory') <> 'array'
       or jsonb_typeof(candidate -> 'replyHistory') <> 'array'
       or jsonb_typeof(candidate -> 'booking') <> 'null'
       or jsonb_typeof(candidate -> 'complianceFlags') <> 'object'
       or jsonb_typeof(candidate -> 'createdAt') <> 'string'
       or jsonb_typeof(candidate -> 'provenance') <> 'string'
       or jsonb_typeof(candidate -> 'sourceEvidence') <> 'object' then
      return false;
    end if;

    evidence := candidate -> 'sourceEvidence';
    if evidence - array[
         'provider', 'externalId', 'login', 'displayName', 'company',
         'location', 'bio', 'githubUrl', 'publicRepoCount', 'followerCount',
         'accountCreatedAt', 'matchedLanguage', 'searchResultOrdinal',
         'searchResponseSha256', 'rawResponseSha256', 'normalizedPayloadSha256'
       ] <> '{}'::jsonb
       or not (evidence ?& array[
         'provider', 'externalId', 'login', 'displayName', 'company',
         'location', 'bio', 'githubUrl', 'publicRepoCount', 'followerCount',
         'accountCreatedAt', 'matchedLanguage', 'searchResultOrdinal',
         'searchResponseSha256', 'rawResponseSha256', 'normalizedPayloadSha256'
       ]) then
      return false;
    end if;

    candidate_id := candidate ->> 'id';
    external_id := evidence ->> 'externalId';
    login_name := evidence ->> 'login';
    github_url := evidence ->> 'githubUrl';
    matched_language := substring(p_query ->> 'value' from '^language:([^ ]+) type:user$');
    if jsonb_typeof(evidence -> 'searchResultOrdinal') <> 'number'
       or (evidence ->> 'searchResultOrdinal') !~ '^[0-2]$' then
      return false;
    end if;
    search_result_ordinal := (evidence ->> 'searchResultOrdinal')::integer;
    if candidate ->> 'campaignId' <> p_campaign_id::text
       or candidate_id !~ '^github-[0-9a-f]{32}$'
       or candidate_id <> 'github-' || substr(encode(sha256(convert_to(
         p_workspace_id::text || E'\n' || p_campaign_id::text || E'\ngithub\n' || external_id,
         'UTF8'
       )), 'hex'), 1, 32)
       or external_id !~ '^[1-9][0-9]{0,19}$'
       or external_id = any(seen_external_ids)
       or login_name !~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$'
       or github_url <> 'https://github.com/' || login_name
       or candidate ->> 'githubUrl' <> github_url
       or candidate ->> 'sourceUrl' <> github_url
       or candidate ->> 'sourceExternalId' <> external_id
       or candidate -> 'externalIds' <> jsonb_build_object('GitHub', external_id)
       or candidate ->> 'sourcePlatform' <> 'GitHub'
       or candidate ->> 'sourceQuery' <> p_query ->> 'value'
       or candidate ->> 'email' <> ''
       or candidate ->> 'phone' <> ''
       or char_length(candidate ->> 'avatarInitials') not between 1 and 8
       or candidate ->> 'avatarInitials' ~ '[[:cntrl:]]'
       or candidate ->> 'currentTitle' <> ''
       or candidate ->> 'timezone' <> ''
       or candidate ->> 'linkedinUrl' <> ''
       or candidate -> 'matchScore' <> '0'::jsonb
       or candidate -> 'matchBreakdown' <> '[]'::jsonb
       or matched_language is null
       or evidence ->> 'matchedLanguage' <> matched_language
       or evidence ->> 'searchResponseSha256' !~ '^[0-9a-f]{64}$'
       or search_result_ordinal = any(seen_search_ordinals)
       or candidate -> 'techStack' <> '[]'::jsonb
       or candidate -> 'experience' <> '[]'::jsonb
       or candidate -> 'education' <> '[]'::jsonb
       or candidate -> 'languages' <> '[]'::jsonb
       or candidate -> 'yearsExperience' <> 'null'::jsonb
       or candidate -> 'companyStageExperience' <> '[]'::jsonb
       or candidate -> 'industryExperience' <> '[]'::jsonb
       or candidate ->> 'recentActivity' <> ''
       or candidate ->> 'stage' <> 'Sourced'
       or candidate -> 'lastContactedAt' <> 'null'::jsonb
       or candidate -> 'outreachHistory' <> '[]'::jsonb
       or candidate -> 'replyHistory' <> '[]'::jsonb
       or candidate -> 'booking' <> 'null'::jsonb
       or candidate -> 'complianceFlags' <> '{
         "doNotContact":false,
         "suppressed":false,
         "unsubscribed":false,
         "gdprExportRequested":false,
         "anonymized":false,
         "suppressedUntil":null
       }'::jsonb
       or candidate ->> 'createdAt'
         !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
       or candidate ->> 'provenance' <> 'live'
       or evidence ->> 'provider' <> 'github'
       or jsonb_typeof(evidence -> 'externalId') <> 'string'
       or jsonb_typeof(evidence -> 'login') <> 'string'
       or jsonb_typeof(evidence -> 'displayName') <> 'string'
       or jsonb_typeof(evidence -> 'githubUrl') <> 'string'
       or jsonb_typeof(evidence -> 'accountCreatedAt') <> 'string'
       or jsonb_typeof(evidence -> 'rawResponseSha256') <> 'string'
       or jsonb_typeof(evidence -> 'normalizedPayloadSha256') <> 'string'
       or evidence ->> 'rawResponseSha256' !~ '^[0-9a-f]{64}$'
       or evidence ->> 'normalizedPayloadSha256' !~ '^[0-9a-f]{64}$'
       or evidence ->> 'accountCreatedAt'
         !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.000Z$'
       or jsonb_typeof(evidence -> 'publicRepoCount') <> 'number'
       or (evidence ->> 'publicRepoCount') !~ '^[0-9]{1,8}$'
       or (evidence ->> 'publicRepoCount')::bigint > 10000000
       or jsonb_typeof(evidence -> 'followerCount') <> 'number'
       or (evidence ->> 'followerCount') !~ '^[0-9]{1,10}$'
       or (evidence ->> 'followerCount')::bigint > 1000000000 then
      return false;
    end if;
    if jsonb_typeof(evidence -> 'company') not in ('string', 'null')
       or jsonb_typeof(evidence -> 'location') not in ('string', 'null')
       or jsonb_typeof(evidence -> 'bio') not in ('string', 'null')
       or char_length(evidence ->> 'displayName') not between 1 and 255
       or evidence ->> 'displayName' ~ '[[:cntrl:]]'
       or char_length(candidate ->> 'name') not between 1 and 255
       or candidate ->> 'name' <> evidence ->> 'displayName'
       or char_length(coalesce(evidence ->> 'company', '')) > 255
       or char_length(coalesce(evidence ->> 'location', '')) > 255
       or char_length(coalesce(evidence ->> 'bio', '')) > 2000
       or coalesce(evidence ->> 'company', '') ~ '[[:cntrl:]]'
       or coalesce(evidence ->> 'location', '') ~ '[[:cntrl:]]'
       or coalesce(evidence ->> 'bio', '') ~ '[[:cntrl:]]'
       or candidate ->> 'currentCompany' <> coalesce(evidence ->> 'company', '')
       or candidate ->> 'location' <> coalesce(evidence ->> 'location', '') then
      return false;
    end if;

    normalized_payload := '{"externalId":' || to_json(external_id)::text
      || ',"login":' || to_json(login_name)::text
      || ',"displayName":' || to_json(evidence ->> 'displayName')::text
      || ',"company":' || coalesce(to_json(evidence ->> 'company')::text, 'null')
      || ',"location":' || coalesce(to_json(evidence ->> 'location')::text, 'null')
      || ',"bio":' || coalesce(to_json(evidence ->> 'bio')::text, 'null')
      || ',"githubUrl":' || to_json(github_url)::text
      || ',"publicRepoCount":' || (evidence ->> 'publicRepoCount')
      || ',"followerCount":' || (evidence ->> 'followerCount')
      || ',"accountCreatedAt":' || to_json(evidence ->> 'accountCreatedAt')::text
      || ',"matchedLanguage":' || to_json(evidence ->> 'matchedLanguage')::text
      || ',"searchResultOrdinal":' || search_result_ordinal::text
      || ',"searchResponseSha256":' || to_json(evidence ->> 'searchResponseSha256')::text
      || '}';
    expected_normalized_sha := encode(sha256(convert_to(normalized_payload, 'UTF8')), 'hex');
    if expected_normalized_sha <> evidence ->> 'normalizedPayloadSha256'
       or not exists (
         select 1 from jsonb_array_elements(p_source_receipts) source_receipt(value)
          where source_receipt.value ->> 'endpointTemplate' = '/users/{login}'
            and source_receipt.value ->> 'outcome' = 'success'
            and source_receipt.value ->> 'statusCode' = '200'
            and source_receipt.value ->> 'responseSha256' = evidence ->> 'rawResponseSha256'
       )
       or not exists (
         select 1 from jsonb_array_elements(p_source_receipts) source_receipt(value)
          where source_receipt.value ->> 'endpointTemplate' = '/search/users'
            and source_receipt.value ->> 'outcome' = 'success'
            and source_receipt.value ->> 'statusCode' = '200'
            and source_receipt.value ->> 'responseSha256' = evidence ->> 'searchResponseSha256'
       ) then
      return false;
    end if;

    if public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'candidate_id', candidate_id
       )
       or public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'github', github_url
       )
       or public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'source_url', github_url
       )
       or public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'source_external_id', external_id
       )
       or public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'provider_external_id', external_id
       )
       or exists (
         select 1 from public.suppression_list suppression
          where suppression.workspace_id = p_workspace_id
            and (suppression.expires_at is null or suppression.expires_at > clock_timestamp())
            and lower(btrim(suppression.value)) = lower(btrim(github_url))
       ) then
      return false;
    end if;
    seen_external_ids := array_append(seen_external_ids, external_id);
    seen_search_ordinals := array_append(seen_search_ordinals, search_result_ordinal);
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.validate_sourcing_batch_candidates(
  uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- commit_sourcing_batch. Candidate append, normalized source evidence,
-- source receipts, attempt settlement, job completion, and completion receipt
-- are one transaction. A lost response is replayed only by exact result hash.
-- ---------------------------------------------------------------------------
create or replace function public.commit_sourcing_batch(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_claim_token uuid,
  p_fence_version bigint,
  p_egress_attempt_id uuid,
  p_query jsonb,
  p_candidates jsonb,
  p_source_receipts jsonb,
  p_result_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.sourcing_batch_claims%rowtype;
  attempt_row public.sourcing_batch_egress_attempts%rowtype;
  receipt_row public.sourcing_batch_receipts%rowtype;
  campaign_row public.sourcing_campaigns%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  profile_row public.profiles%rowtype;
  workspace_row public.workspace_state%rowtype;
  expected_payload jsonb;
  expected_query jsonb;
  expected_campaign_sha text;
  expected_result_sha text;
  novel_candidates jsonb;
  merged_candidates jsonb;
  merged_campaigns jsonb;
  projected_campaign jsonb;
  projected_activity jsonb;
  next_payload jsonb;
  enqueue_result jsonb;
  candidate jsonb;
  observed_candidate_count integer;
  unique_candidate_total integer;
  document_candidate_total integer;
  campaign_document_count integer;
  next_batch_ordinal integer;
  stop_reason text;
  document_campaign_status text;
  continuation_authorized boolean := false;
  wall_now timestamptz;
  updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_egress_attempt_id is null or p_result_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  if job_row.kind <> 'sourcing_batch' then return jsonb_build_object('status', 'wrong_kind'); end if;
  if job_row.workspace_id <> p_workspace_id then return jsonb_build_object('status', 'wrong_workspace'); end if;
  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  if job_row.payload <> expected_payload
     or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  select * into receipt_row from public.sourcing_batch_receipts receipt
   where receipt.job_id = p_job_id;
  if found then
    if receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.campaign_id = p_campaign_id
       and receipt_row.campaign_sha256 = p_campaign_sha256
       and receipt_row.batch_ordinal = p_batch_ordinal
       and receipt_row.claim_token = p_claim_token
       and receipt_row.fence_version = p_fence_version
       and receipt_row.egress_attempt_id = p_egress_attempt_id
       and receipt_row.result_sha256 = p_result_sha256 then
      return jsonb_build_object(
        'status', 'no_op_replay', 'job_id', p_job_id,
        'candidate_count', receipt_row.candidate_count,
        'query_count', receipt_row.query_count,
        'result_sha256', receipt_row.result_sha256
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  select * into claim_row from public.sourcing_batch_claims claim
   where claim.job_id = p_job_id for update;
  if not found or claim_row.state <> 'begun'
     or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.campaign_id <> p_campaign_id
     or claim_row.campaign_sha256 <> p_campaign_sha256
     or claim_row.batch_ordinal <> p_batch_ordinal
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or claim_row.egress_attempt_id <> p_egress_attempt_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  select * into attempt_row from public.sourcing_batch_egress_attempts attempt
   where attempt.id = p_egress_attempt_id for update;
  if not found or attempt_row.status <> 'begun'
     or attempt_row.job_id <> p_job_id
     or attempt_row.lease_id <> p_lease_id
     or attempt_row.workspace_id <> p_workspace_id
     or attempt_row.campaign_id <> p_campaign_id
     or attempt_row.campaign_sha256 <> p_campaign_sha256
     or attempt_row.batch_ordinal <> p_batch_ordinal
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version
     or attempt_row.provider <> 'github'
     or attempt_row.provider_mode <> claim_row.provider_mode then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;

  expected_query := claim_row.canonical_query;
  if expected_query is null or p_query is null or jsonb_typeof(p_query) <> 'object'
     or not public.sourcing_batch_query_is_allowed(
       claim_row.role_basis,
       p_batch_ordinal,
       expected_query
     )
     or p_query <> expected_query
     or p_query ->> 'sha256' <> attempt_row.canonical_query_sha256 then
    return jsonb_build_object('status', 'query_invalid');
  end if;
  if not public.validate_sourcing_batch_source_receipts(
    p_source_receipts, attempt_row.canonical_query_sha256,
    (expected_query ->> 'page')::integer, true, attempt_row.provider_mode
  ) then
    return jsonb_build_object('status', 'candidate_evidence_invalid');
  end if;
  if not public.validate_sourcing_batch_candidates(
    p_workspace_id, p_campaign_id, p_query, p_candidates, p_source_receipts
  ) then
    return jsonb_build_object('status', 'candidate_evidence_invalid');
  end if;
  observed_candidate_count := jsonb_array_length(p_candidates);
  expected_result_sha := public.sourcing_batch_result_sha256(
    p_workspace_id, p_job_id, p_campaign_id, p_campaign_sha256,
    p_batch_ordinal, p_claim_token, p_fence_version, p_egress_attempt_id,
    p_query, p_candidates, attempt_row.provider_mode
  );
  if expected_result_sha <> p_result_sha256 then
    return jsonb_build_object('status', 'result_hash_invalid');
  end if;

  -- Persistence of the already-observed page is independent from whether a
  -- future page is still authorized. Lock every continuation authority here
  -- so the decision to create the next job cannot race a stop-control change.
  select * into campaign_row
    from public.sourcing_campaigns campaign
   where campaign.workspace_id = p_workspace_id
     and campaign.id = p_campaign_id
   for update;
  if not found
     or campaign_row.campaign_sha256 <> p_campaign_sha256
     or campaign_row.role_basis <> claim_row.role_basis then
    return jsonb_build_object('status', 'campaign_changed');
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
    return jsonb_build_object('status', 'campaign_changed');
  end if;
  select * into control_row
    from public.sourcing_loop_controls control
   where control.workspace_id = p_workspace_id
   for share;
  if found and not control_row.kill_switch and control_row.sourcing_enabled
     and control_row.max_sourcing_runs_per_day > 0
     and control_row.updated_by = campaign_row.activation_actor_id
     and campaign_row.status = 'sourcing' then
    select * into profile_row
      from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = campaign_row.activation_actor_id
     for share;
    continuation_authorized := found and profile_row.role = 'admin';
  end if;

  -- Lock and merge against the latest workspace document. The authorization
  -- timestamp is evidence returned to the worker, not an optimistic commit
  -- token: an unrelated UI write must never force a second provider egress.
  select * into workspace_row from public.workspace_state state
   where state.workspace_id = p_workspace_id for update;
  if not found
     or jsonb_typeof(workspace_row.state) <> 'object'
     or (workspace_row.state ? 'candidates'
       and jsonb_typeof(workspace_row.state -> 'candidates') <> 'array')
     or jsonb_typeof(workspace_row.state -> 'campaigns') <> 'array' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;

  document_campaign_status := public.sourcing_campaign_document_status(
    workspace_row.state,
    p_campaign_id
  );
  if document_campaign_status is null then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  select count(*) into campaign_document_count
    from jsonb_array_elements(workspace_row.state -> 'campaigns') item(value)
   where item.value ->> 'id' = p_campaign_id::text;
  if campaign_document_count <> 1 then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  select item.value into projected_campaign
    from jsonb_array_elements(workspace_row.state -> 'campaigns') item(value)
   where item.value ->> 'id' = p_campaign_id::text;
  if jsonb_typeof(projected_campaign -> 'metrics') <> 'object'
     or jsonb_typeof(projected_campaign -> 'activities') <> 'array' then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;
  continuation_authorized := continuation_authorized
    and document_campaign_status = 'Sourcing';

  select count(*) into unique_candidate_total
    from public.candidates existing
   where existing.workspace_id = p_workspace_id
     and existing.campaign_id = p_campaign_id::text;
  select count(*) into document_candidate_total
    from jsonb_array_elements(coalesce(workspace_row.state -> 'candidates', '[]'::jsonb)) item(value)
   where item.value ->> 'campaignId' = p_campaign_id::text;
  if unique_candidate_total <> document_candidate_total
     or exists (
       select 1
         from jsonb_array_elements(coalesce(workspace_row.state -> 'candidates', '[]'::jsonb)) item(value)
        where item.value ->> 'campaignId' = p_campaign_id::text
        group by item.value ->> 'id'
       having count(*) <> 1
     )
     or exists (
       select 1
         from jsonb_array_elements(p_candidates) incoming(value)
        where (
          exists (
            select 1
              from jsonb_array_elements(coalesce(workspace_row.state -> 'candidates', '[]'::jsonb)) live(value)
             where live.value ->> 'campaignId' = p_campaign_id::text
               and live.value ->> 'id' = incoming.value ->> 'id'
          )
        ) <> (
          exists (
            select 1 from public.candidates existing
             where existing.workspace_id = p_workspace_id
               and existing.campaign_id = p_campaign_id::text
               and existing.id = incoming.value ->> 'id'
          )
        )
     ) then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;

  select coalesce(jsonb_agg(incoming.value order by incoming.ordinality), '[]'::jsonb)
    into novel_candidates
    from jsonb_array_elements(p_candidates) with ordinality incoming(value, ordinality)
   where not exists (
     select 1 from public.candidates existing
      where existing.workspace_id = p_workspace_id
        and existing.campaign_id = p_campaign_id::text
        and existing.id = incoming.value ->> 'id'
   );
  merged_candidates := coalesce(workspace_row.state -> 'candidates', '[]'::jsonb)
    || novel_candidates;

  for candidate in select value from jsonb_array_elements(novel_candidates)
  loop
    insert into public.candidates(
      workspace_id, campaign_id, id, github_url, source_url,
      source_external_id, source_platform, name, current_company,
      location, stage, provenance, payload, mirrored_at
    ) values (
      p_workspace_id, p_campaign_id::text, candidate ->> 'id',
      candidate ->> 'githubUrl', candidate ->> 'sourceUrl',
      candidate ->> 'sourceExternalId', candidate ->> 'sourcePlatform',
      candidate ->> 'name', nullif(candidate ->> 'currentCompany', ''),
      nullif(candidate ->> 'location', ''), candidate ->> 'stage',
      candidate ->> 'provenance', candidate, wall_now
    );
    insert into public.sourcing_candidate_evidence(
      workspace_id, campaign_id, candidate_id, job_id, egress_attempt_id,
      provider, provider_external_id, github_url, raw_response_sha256,
      normalized_payload_sha256, evidence
    ) values (
      p_workspace_id, p_campaign_id, candidate ->> 'id', p_job_id, p_egress_attempt_id,
      'github', candidate -> 'sourceEvidence' ->> 'externalId',
      candidate -> 'sourceEvidence' ->> 'githubUrl',
      candidate -> 'sourceEvidence' ->> 'rawResponseSha256',
      candidate -> 'sourceEvidence' ->> 'normalizedPayloadSha256',
      candidate -> 'sourceEvidence'
    );
  end loop;

  select count(*) into unique_candidate_total
    from public.candidates existing
   where existing.workspace_id = p_workspace_id
     and existing.campaign_id = p_campaign_id::text;
  stop_reason := case
    when unique_candidate_total >= public.sourcing_candidate_target()
      then 'target_reached'
    when observed_candidate_count = 0
      then 'provider_exhausted'
    when p_batch_ordinal >= public.sourcing_max_batch_ordinal()
      then 'batch_bound_reached'
    else null
  end;

  -- A browser lifecycle transition that won the workspace lock is
  -- authoritative. Evidence already observed through read-only egress may be
  -- retained, but the normalized campaign must stop and no later page may be
  -- scheduled. Never rewrite the browser's Paused or Filled state.
  if document_campaign_status = 'Paused' and campaign_row.status = 'sourcing' then
    update public.sourcing_campaigns
       set status = 'paused', sourcing_stop_reason = null,
           sourcing_completed_at = null, updated_at = wall_now
     where workspace_id = p_workspace_id
       and id = p_campaign_id
       and status = 'sourcing';
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'sourcing campaign pause sync lost mid-commit' using errcode = '40001';
    end if;
    campaign_row.status := 'paused';
  elsif document_campaign_status = 'Filled' and campaign_row.status = 'sourcing' then
    update public.sourcing_campaigns
       set status = 'cancelled', sourcing_stop_reason = null,
           sourcing_completed_at = null, updated_at = wall_now
     where workspace_id = p_workspace_id
       and id = p_campaign_id
       and status = 'sourcing';
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'sourcing campaign filled sync lost mid-commit' using errcode = '40001';
    end if;
    campaign_row.status := 'cancelled';
  end if;

  projected_campaign := jsonb_set(
    projected_campaign,
    '{metrics,sourced}',
    to_jsonb(unique_candidate_total),
    true
  );
  if stop_reason is not null then
    projected_activity := jsonb_build_object(
      'id', 'sourcing-stop-' || p_job_id::text,
      'type', 'sourcing',
      'title', case stop_reason
        when 'target_reached' then 'Automated sourcing target reached'
        when 'provider_exhausted' then 'GitHub sourcing exhausted'
        else 'Automated sourcing batch limit reached'
      end,
      'notes', format('Observed %s unique candidates.', unique_candidate_total),
      'outcome', stop_reason,
      'campaignId', p_campaign_id::text,
      'linkedEntityType', 'campaign',
      'linkedEntityId', p_campaign_id::text,
      'createdAt', to_char(
        wall_now at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );
    projected_campaign := jsonb_set(
      projected_campaign,
      '{activities}',
      (projected_campaign -> 'activities') || jsonb_build_array(projected_activity),
      true
    );
    if campaign_row.status = 'sourcing'
       and document_campaign_status = 'Sourcing' then
      projected_campaign := jsonb_set(
        projected_campaign,
        '{status}',
        to_jsonb(case when unique_candidate_total > 0 then 'Outreach' else 'Paused' end),
        true
      );
      update public.sourcing_campaigns
         set status = 'completed', sourcing_stop_reason = stop_reason,
             sourcing_completed_at = wall_now, updated_at = wall_now
       where workspace_id = p_workspace_id
         and id = p_campaign_id
         and status = 'sourcing';
      get diagnostics updated = row_count;
      if updated <> 1 then
        raise exception 'sourcing campaign completion lost mid-commit' using errcode = '40001';
      end if;
    end if;
  elsif continuation_authorized
    and unique_candidate_total < public.sourcing_candidate_target()
    and observed_candidate_count > 0
    and p_batch_ordinal < public.sourcing_max_batch_ordinal() then
    next_batch_ordinal := p_batch_ordinal + 1;
  end if;

  select jsonb_agg(
    case when item.value ->> 'id' = p_campaign_id::text
      then projected_campaign else item.value end
    order by item.ordinality
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
  if updated <> 1 then
    raise exception 'sourcing workspace projection lost mid-commit' using errcode = '40001';
  end if;

  if not public.persist_sourcing_batch_source_receipts(
    p_egress_attempt_id, p_workspace_id, p_job_id,
    attempt_row.canonical_query_sha256, (expected_query ->> 'page')::integer,
    p_source_receipts, true, attempt_row.provider_mode
  ) then
    raise exception 'validated sourcing receipts could not be persisted' using errcode = 'P0001';
  end if;

  update public.sourcing_batch_egress_attempts
     set status = 'completed', result_sha256 = p_result_sha256,
         candidate_count = observed_candidate_count, query_count = 1, settled_at = wall_now
   where id = p_egress_attempt_id and status = 'begun';
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing egress attempt lost mid-commit' using errcode = '40001';
  end if;
  update public.sourcing_batch_claims
     set state = 'completed', updated_at = wall_now
   where job_id = p_job_id and state = 'begun';
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing claim lost mid-commit' using errcode = '40001';
  end if;

  insert into public.sourcing_batch_receipts(
    job_id, lease_id, workspace_id, campaign_id, campaign_sha256,
    batch_ordinal, claim_token, fence_version, egress_attempt_id,
    provider_mode, canonical_query_sha256, canonical_query, applied_lesson,
    result_sha256, candidate_count, query_count
  ) values (
    p_job_id, p_lease_id, p_workspace_id, p_campaign_id, p_campaign_sha256,
    p_batch_ordinal, p_claim_token, p_fence_version, p_egress_attempt_id,
    attempt_row.provider_mode, attempt_row.canonical_query_sha256, claim_row.canonical_query,
    claim_row.applied_lesson, p_result_sha256, observed_candidate_count, 1
  );

  perform set_config('aria.sourcing_batch_commit_attempt', p_egress_attempt_id::text, true);
  update public.aria_jobs
     set status = 'succeeded', result_sha256 = p_result_sha256,
         lease_id = null, lease_expires_at = null, last_error = null,
         updated_at = wall_now
   where id = p_job_id and status = 'leased' and lease_id = p_lease_id
     and lease_expires_at > wall_now;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sourcing job lease lost mid-commit' using errcode = '40001';
  end if;

  if next_batch_ordinal is not null then
    next_payload := jsonb_build_object(
      'campaign_id', p_campaign_id::text,
      'campaign_sha256', p_campaign_sha256,
      'batch_ordinal', next_batch_ordinal
    );
    enqueue_result := public.enqueue_aria_job(
      p_workspace_id,
      'sourcing_batch',
      'sourcing_batch:' || p_campaign_id::text || ':'
        || lpad((p_batch_ordinal + 1)::text, 6, '0'),
      next_payload,
      wall_now,
      100
    );
    if enqueue_result ->> 'status' <> 'enqueued'
       or (enqueue_result ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'next sourcing batch enqueue failed: %', enqueue_result ->> 'status'
        using errcode = '22023';
    end if;
  end if;

  insert into public.loop_events(
    workspace_id, event_type, subject_kind, subject_id, job_id, payload
  ) values (
    p_workspace_id, 'sourcing.batch_completed', 'sourcing_campaign',
    p_campaign_id::text, p_job_id,
    jsonb_strip_nulls(jsonb_build_object(
      'batch_ordinal', p_batch_ordinal,
      'candidate_count', observed_candidate_count,
      'new_unique_candidate_count', jsonb_array_length(novel_candidates),
      'unique_candidate_total', unique_candidate_total,
      'query_count', 1,
      'applied_lesson_id', claim_row.applied_lesson ->> 'lesson_id',
      'applied_lesson_version', claim_row.applied_lesson -> 'lesson_version',
      'applied_lesson_snapshot_sha256', claim_row.applied_lesson ->> 'snapshot_sha256',
      'next_batch_ordinal', next_batch_ordinal,
      'sourcing_stop_reason', stop_reason
    ))
  );

  return jsonb_build_object(
    'status', 'completed', 'job_id', p_job_id,
    'candidate_count', observed_candidate_count, 'query_count', 1,
    'result_sha256', p_result_sha256
  );
exception when unique_violation or check_violation then
  return jsonb_build_object('status', 'candidate_evidence_invalid');
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_sourcing_batch_egress. This is the only post-begin failure path. A
-- known retry advances through a later claim/fence. Unknown GitHub GET or
-- commit-response outcomes are also safe to retry because provider egress is
-- read-only and an uncertain commit is reconciled against the exact durable
-- receipt first. Attempt limits still bound retries.
-- ---------------------------------------------------------------------------
create or replace function public.fail_sourcing_batch_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_sha256 text,
  p_batch_ordinal integer,
  p_claim_token uuid,
  p_fence_version bigint,
  p_egress_attempt_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_ambiguous boolean,
  p_source_receipts jsonb,
  p_result_sha256 text,
  p_candidate_count integer,
  p_query_count integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.sourcing_batch_claims%rowtype;
  attempt_row public.sourcing_batch_egress_attempts%rowtype;
  receipt_row public.sourcing_batch_receipts%rowtype;
  expected_payload jsonb;
  expected_query jsonb;
  wall_now timestamptz;
  new_job_status text;
  new_attempt_status text;
  response_status text;
  backoff interval;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_campaign_id is null or p_campaign_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_ordinal is null
     or p_batch_ordinal not between 0 and public.sourcing_max_batch_ordinal()
     or p_claim_token is null
     or p_fence_version is null or p_fence_version <= 0
     or p_egress_attempt_id is null
     or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'
     or p_retryable is null or p_ambiguous is null
     or (p_ambiguous and p_retryable)
     or ((p_result_sha256 is null) <> (p_candidate_count is null))
     or ((p_result_sha256 is null) <> (p_query_count is null))
     or (p_result_sha256 is not null and p_result_sha256 !~ '^[0-9a-f]{64}$')
     or (p_candidate_count is not null and p_candidate_count not between 0 and 3)
     or (p_query_count is not null and p_query_count <> 1) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'job_not_found'); end if;
  if job_row.kind <> 'sourcing_batch' then return jsonb_build_object('status', 'wrong_kind'); end if;
  if job_row.workspace_id <> p_workspace_id then return jsonb_build_object('status', 'wrong_workspace'); end if;
  expected_payload := jsonb_build_object(
    'campaign_id', p_campaign_id::text,
    'campaign_sha256', p_campaign_sha256,
    'batch_ordinal', p_batch_ordinal
  );
  if job_row.payload <> expected_payload
     or job_row.payload_sha256 <> encode(sha256(convert_to(expected_payload::text, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  select * into claim_row from public.sourcing_batch_claims claim
   where claim.job_id = p_job_id for update;
  select * into attempt_row from public.sourcing_batch_egress_attempts attempt
   where attempt.id = p_egress_attempt_id for update;
  if claim_row.job_id is null or attempt_row.id is null
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.campaign_id <> p_campaign_id
     or claim_row.campaign_sha256 <> p_campaign_sha256
     or claim_row.batch_ordinal <> p_batch_ordinal
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or attempt_row.job_id <> p_job_id
     or attempt_row.workspace_id <> p_workspace_id
     or attempt_row.campaign_id <> p_campaign_id
     or attempt_row.campaign_sha256 <> p_campaign_sha256
     or attempt_row.batch_ordinal <> p_batch_ordinal
     or attempt_row.lease_id <> p_lease_id
     or attempt_row.claim_token <> p_claim_token
     or attempt_row.fence_version <> p_fence_version then
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  -- Lost commit response: return success only when every caller-provided
  -- expected value matches the append-only completion receipt.
  select * into receipt_row from public.sourcing_batch_receipts receipt
   where receipt.job_id = p_job_id;
  if found then
    if receipt_row.egress_attempt_id = p_egress_attempt_id
       and receipt_row.claim_token = p_claim_token
       and receipt_row.fence_version = p_fence_version
       and receipt_row.result_sha256 = p_result_sha256
       and receipt_row.candidate_count = p_candidate_count
       and receipt_row.query_count = p_query_count
       and attempt_row.status = 'completed'
       and attempt_row.result_sha256 = receipt_row.result_sha256 then
      return jsonb_build_object(
        'status', 'completed', 'job_id', p_job_id,
        'egress_attempt_id', p_egress_attempt_id,
        'candidate_count', receipt_row.candidate_count,
        'query_count', receipt_row.query_count,
        'result_sha256', receipt_row.result_sha256
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  if attempt_row.status <> 'begun' then
    if attempt_row.error_code = p_error_code
       and attempt_row.status in ('retryable_failed', 'dead', 'ambiguous') then
      response_status := case attempt_row.status
        when 'retryable_failed' then 'retry_scheduled'
        when 'ambiguous' then 'ambiguous_dead_lettered'
        else 'dead_lettered' end;
      return jsonb_build_object(
        'status', response_status, 'job_id', p_job_id,
        'egress_attempt_id', p_egress_attempt_id, 'error_code', p_error_code
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id
     or claim_row.state <> 'begun' or claim_row.lease_id <> p_lease_id
     or claim_row.egress_attempt_id <> p_egress_attempt_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
    return jsonb_build_object('status', 'lease_expired');
  end if;
  expected_query := claim_row.canonical_query;
  if expected_query is null
     or not public.sourcing_batch_query_is_allowed(
       claim_row.role_basis,
       p_batch_ordinal,
       expected_query
     )
     or expected_query ->> 'sha256' <> attempt_row.canonical_query_sha256 then
    return jsonb_build_object('status', 'query_mismatch');
  end if;
  if not public.validate_sourcing_batch_source_receipts(
    p_source_receipts, attempt_row.canonical_query_sha256,
    (expected_query ->> 'page')::integer, false, attempt_row.provider_mode
  ) then
    return jsonb_build_object('status', 'candidate_evidence_invalid');
  end if;
  if not public.persist_sourcing_batch_source_receipts(
    p_egress_attempt_id, p_workspace_id, p_job_id,
    attempt_row.canonical_query_sha256, (expected_query ->> 'page')::integer,
    p_source_receipts, false, attempt_row.provider_mode
  ) then
    raise exception 'validated failure receipts could not be persisted' using errcode = 'P0001';
  end if;

  if (p_retryable or p_ambiguous) and job_row.attempt_count < job_row.max_attempts then
    new_attempt_status := 'retryable_failed';
    new_job_status := 'queued';
    response_status := 'retry_scheduled';
  else
    new_attempt_status := 'dead';
    new_job_status := 'dead';
    response_status := 'dead_lettered';
  end if;

  update public.sourcing_batch_egress_attempts
     set status = new_attempt_status, error_code = p_error_code, settled_at = wall_now
   where id = p_egress_attempt_id and status = 'begun';
  update public.sourcing_batch_claims
     set state = new_attempt_status,
         egress_attempt_id = case when new_attempt_status = 'retryable_failed'
           then null else p_egress_attempt_id end,
         updated_at = wall_now
   where job_id = p_job_id and state = 'begun';

  if new_job_status = 'queued' then
    backoff := least(
      make_interval(mins => 1) * power(2, job_row.attempt_count),
      make_interval(hours => 4)
    ) + make_interval(secs => floor(random() * 30)::integer);
  end if;
  update public.aria_jobs
     set status = new_job_status, lease_id = null, lease_expires_at = null,
         next_run_at = case when new_job_status = 'queued' then wall_now + backoff else next_run_at end,
         last_error = left(p_error_code, 2000), updated_at = wall_now
   where id = p_job_id and status = 'leased' and lease_id = p_lease_id;

  if new_job_status = 'dead' then
    insert into public.loop_events(
      workspace_id, event_type, subject_kind, subject_id, job_id, payload
    ) values (
      p_workspace_id, 'job.dead', 'aria_job', p_job_id::text, p_job_id,
      jsonb_build_object(
        'kind', 'sourcing_batch', 'attempts', job_row.attempt_count,
        'reason', case when p_ambiguous then 'read_only_egress_retry_exhausted' else 'egress_failed' end
      )
    );
  end if;
  return jsonb_build_object(
    'status', response_status, 'job_id', p_job_id,
    'egress_attempt_id', p_egress_attempt_id, 'error_code', p_error_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Runtime heartbeat and bounded readiness. No tenant data, candidate data,
-- job payload, error text, worker id, or release SHA leaves this RPC.
-- ---------------------------------------------------------------------------
create or replace function public.record_sourcing_loop_heartbeat(
  p_worker_id text,
  p_release_sha text,
  p_handler_contract_sha256 text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
     or p_handler_contract_sha256 is null
     or p_handler_contract_sha256 !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  insert into public.loop_worker_heartbeats(
    worker_id, release_sha, handler_contract_sha256
  ) values (
    p_worker_id, p_release_sha, p_handler_contract_sha256
  ) on conflict (worker_id) do update
    set release_sha = excluded.release_sha,
        handler_contract_sha256 = excluded.handler_contract_sha256,
        tick_count = public.loop_worker_heartbeats.tick_count + 1,
        last_seen_at = clock_timestamp();
  return true;
end;
$$;

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
  expected_handler_count constant integer := 3;
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
    when fresh_known_workers = 0 then 'contract_mismatch'
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
  select count(*) into dead_sourcing_jobs
    from public.aria_jobs job
   where job.status = 'dead'
     and job.kind in ('requisition_parse', 'campaign_create', 'sourcing_batch');
  select count(*) into ambiguous_sourcing_attempts
    from public.sourcing_batch_egress_attempts attempt
   where attempt.status = 'ambiguous';
  select count(*) into overdue_begun_attempts
    from public.sourcing_batch_egress_attempts attempt
   where attempt.status = 'begun'
     and attempt.begun_at < wall_now - interval '5 minutes';

  healthy := expected_handler_count > 0
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

-- ---------------------------------------------------------------------------
-- Ownership and least privilege.
-- ---------------------------------------------------------------------------
alter function public.expected_sourcing_loop_handler_contract_sha256() owner to postgres;
alter function public.sourcing_candidate_target() owner to postgres;
alter function public.sourcing_max_batch_ordinal() owner to postgres;
alter function public.sourcing_campaign_document_status(jsonb, uuid) owner to postgres;
alter function public.sourcing_batch_lesson_snapshot_sha256(jsonb) owner to postgres;
alter function public.sourcing_batch_expected_query(jsonb, integer) owner to postgres;
alter function public.sourcing_batch_query_is_allowed(jsonb, integer, jsonb) owner to postgres;
alter function public.pause_sourcing_batch_pre_egress(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
alter function public.validate_sourcing_batch_source_receipts(jsonb, text, integer, boolean, text) owner to postgres;
alter function public.sourcing_batch_result_sha256(
  uuid, uuid, uuid, text, integer, uuid, bigint, uuid, jsonb, jsonb, text
) owner to postgres;
alter function public.reject_sourcing_batch_receipt_mutation() owner to postgres;
alter function public.reject_sourcing_candidate_evidence_reimport() owner to postgres;
alter function public.cleanup_sourcing_candidate_evidence() owner to postgres;
alter function public.guard_sourcing_batch_job_transition() owner to postgres;
alter function public.claim_due_sourcing_batch_jobs(text, integer, integer) owner to postgres;
alter function public.persist_sourcing_batch_source_receipts(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text
) owner to postgres;
alter function public.validate_sourcing_batch_candidates(
  uuid, uuid, jsonb, jsonb, jsonb
) owner to postgres;
alter function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
alter function public.begin_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, text, text
) owner to postgres;
alter function public.commit_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  jsonb, jsonb, jsonb, text
) owner to postgres;
alter function public.fail_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  text, boolean, boolean, jsonb, text, integer, integer
) owner to postgres;
alter function public.record_sourcing_loop_heartbeat(text, text, text) owner to postgres;
alter function public.get_sourcing_loop_readiness(text) owner to postgres;

revoke all on function public.pause_sourcing_batch_pre_egress(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.pause_sourcing_batch_pre_egress(
  uuid, uuid, uuid, uuid, text, integer, text
) to service_role;

revoke all on function public.claim_due_sourcing_batch_jobs(text, integer, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_due_sourcing_batch_jobs(text, integer, integer)
  to service_role;

revoke all on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) to service_role;

revoke all on function public.begin_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, text, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.begin_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, text, text
) to service_role;

revoke all on function public.commit_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.commit_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  jsonb, jsonb, jsonb, text
) to service_role;

revoke all on function public.fail_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  text, boolean, boolean, jsonb, text, integer, integer
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.fail_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  text, boolean, boolean, jsonb, text, integer, integer
) to service_role;

revoke all on function public.record_sourcing_loop_heartbeat(text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_sourcing_loop_heartbeat(text, text, text)
  to service_role;

revoke all on function public.get_sourcing_loop_readiness(text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_sourcing_loop_readiness(text)
  to service_role;
