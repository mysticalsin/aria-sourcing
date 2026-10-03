-- Server-owned sourcing receipts and privacy-bounded lesson authority.
--
-- Graphify consumes aggregate query evidence. It cannot authorize sourcing,
-- alter a campaign need, or promote a lesson. Candidate names, handles, URLs,
-- profiles, and result payloads are deliberately absent from this schema.

create table if not exists public.sourcing_learning_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  hmac_key bytea not null check (octet_length(hmac_key) = 32),
  created_at timestamptz not null default now()
);

create table if not exists public.sourcing_learning_controls (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  workspace_daily_limit integer not null default 100
    check (workspace_daily_limit between 1 and 1000),
  user_daily_limit integer not null default 25
    check (user_daily_limit between 1 and 250),
  min_evidence_runs integer not null default 2
    check (min_evidence_runs between 2 and 10),
  lesson_ttl_days integer not null default 90
    check (lesson_ttl_days between 7 and 365),
  required_graphify_commit text not null
    default '94d3099540550d58dd121ec3e67cf93e80364079'
    check (required_graphify_commit ~ '^[0-9a-f]{40}$'),
  required_graphify_image_digest text check (
    required_graphify_image_digest is null
    or required_graphify_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
  ),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  campaign_hmac text not null check (campaign_hmac ~ '^[0-9a-f]{64}$'),
  role_fingerprint text not null check (role_fingerprint ~ '^[0-9a-f]{64}$'),
  configuration_fingerprint text not null
    check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  mode text not null check (mode in ('cloud', 'deterministic')),
  provider text check (provider is null or provider ~ '^[A-Za-z0-9._:-]{1,64}$'),
  model text check (model is null or model ~ '^[A-Za-z0-9._:/-]{1,160}$'),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),
  completion_hmac text check (completion_hmac is null or completion_hmac ~ '^[0-9a-f]{64}$'),
  query_count integer not null default 0 check (query_count between 0 and 20),
  candidate_count integer not null default 0 check (candidate_count between 0 and 1000),
  skipped_count integer not null default 0 check (skipped_count between 0 and 1000),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  unique (workspace_id, actor_id, idempotency_key),
  unique (workspace_id, id),
  constraint sourcing_runs_state_coherence check (
    (status = 'in_progress' and completion_hmac is null and completed_at is null and failed_at is null and error_code is null)
    or
    (status = 'completed' and completion_hmac is not null and completed_at is not null and failed_at is null and error_code is null)
    or
    (status = 'failed' and completion_hmac is null and completed_at is null and failed_at is not null and error_code is not null)
  )
);

create index if not exists sourcing_runs_workspace_role_idx
  on public.sourcing_runs (workspace_id, role_fingerprint, created_at desc);
create index if not exists sourcing_runs_workspace_expiry_idx
  on public.sourcing_runs (workspace_id, expires_at, id);
create index if not exists sourcing_runs_feedback_lookup_idx
  on public.sourcing_runs (workspace_id, actor_id, campaign_hmac, status, created_at desc);

create table if not exists public.sourcing_run_quota (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket_date date not null,
  scope_key text not null check (scope_key ~ '^(workspace|user:[0-9a-f-]{36})$'),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, bucket_date, scope_key)
);

create table if not exists public.sourcing_query_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 19),
  platform text not null
    check (platform in ('GitHub', 'LinkedIn', 'Stack Overflow', 'Dribbble', 'Behance')),
  query_text text not null check (length(query_text) between 3 and 256),
  query_hmac text not null check (query_hmac ~ '^[0-9a-f]{64}$'),
  succeeded boolean not null,
  candidate_count integer not null check (candidate_count between 0 and 100),
  skipped_count integer not null check (skipped_count between 0 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  unique (workspace_id, run_id, ordinal),
  unique (workspace_id, id),
  unique (workspace_id, id, run_id),
  constraint sourcing_query_receipts_run_fkey
    foreign key (workspace_id, run_id)
    references public.sourcing_runs (workspace_id, id) on delete cascade
);

create table if not exists public.sourcing_query_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  receipt_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  verdict text not null check (verdict in ('useful', 'dead_end', 'corrected')),
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, receipt_id, actor_id),
  unique (workspace_id, request_id),
  constraint sourcing_query_feedback_receipt_fkey
    foreign key (workspace_id, receipt_id)
    references public.sourcing_query_receipts (workspace_id, id) on delete cascade
);

create table if not exists public.sourcing_graphify_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  export_payload jsonb not null,
  status text not null default 'exported' check (status in ('exported', 'completed')),
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),
  graph_sha256 text check (graph_sha256 is null or graph_sha256 ~ '^[0-9a-f]{64}$'),
  graph_text text check (graph_text is null or octet_length(graph_text) between 2 and 5242880),
  manifest jsonb,
  image_digest text check (
    image_digest is null
    or image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
  ),
  graphify_commit text check (graphify_commit is null or graphify_commit ~ '^[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '180 days'),
  unique (workspace_id, id),
  constraint sourcing_graphify_exports_state_coherence check (
    (status = 'exported' and input_sha256 is null and graph_sha256 is null
      and graph_text is null and manifest is null and image_digest is null
      and graphify_commit is null and completed_at is null)
    or
    (status = 'completed' and input_sha256 is not null and graph_sha256 is not null
      and graph_text is not null and manifest is not null and image_digest is not null
      and graphify_commit is not null and completed_at is not null)
  )
);

create table if not exists public.sourcing_lessons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_fingerprint text not null check (role_fingerprint ~ '^[0-9a-f]{64}$'),
  platform text not null
    check (platform in ('GitHub', 'LinkedIn', 'Stack Overflow', 'Dribbble', 'Behance')),
  query_hmac text not null check (query_hmac ~ '^[0-9a-f]{64}$'),
  query_text text not null check (length(query_text) between 3 and 256),
  status text not null default 'draft'
    check (status in ('draft', 'promoted', 'suspended', 'retired')),
  version bigint not null default 1 check (version > 0),
  evidence_run_count integer not null default 0 check (evidence_run_count >= 0),
  evidence_campaign_count integer not null default 0 check (evidence_campaign_count >= 0),
  useful_feedback_count integer not null default 0 check (useful_feedback_count >= 0),
  dead_end_feedback_count integer not null default 0 check (dead_end_feedback_count >= 0),
  corrected_feedback_count integer not null default 0 check (corrected_feedback_count >= 0),
  graphify_artifact_sha256 text
    check (graphify_artifact_sha256 is null or graphify_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  graphify_cluster_ref text
    check (graphify_cluster_ref is null or graphify_cluster_ref ~ '^[A-Za-z0-9._:-]{1,100}$'),
  graphify_commit text
    check (graphify_commit is null or graphify_commit ~ '^[0-9a-f]{40}$'),
  graphify_export_id uuid,
  graphified_at timestamptz,
  graphified_by uuid references auth.users(id) on delete restrict,
  promoted_at timestamptz,
  promoted_by uuid references auth.users(id) on delete restrict,
  suspended_at timestamptz,
  retired_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, role_fingerprint, platform, query_hmac),
  unique (workspace_id, id),
  constraint sourcing_lessons_graphify_export_fkey
    foreign key (workspace_id, graphify_export_id)
    references public.sourcing_graphify_exports (workspace_id, id) on delete restrict,
  constraint sourcing_lessons_graphify_coherence check (
    (graphify_artifact_sha256 is null and graphify_cluster_ref is null and graphify_commit is null
      and graphify_export_id is null and graphified_at is null and graphified_by is null)
    or
    (graphify_artifact_sha256 is not null and graphify_cluster_ref is not null and graphify_commit is not null
      and graphify_export_id is not null and graphified_at is not null and graphified_by is not null)
  )
);

create index if not exists sourcing_lessons_runtime_idx
  on public.sourcing_lessons
  (workspace_id, role_fingerprint, status, useful_feedback_count desc, evidence_run_count desc);

create table if not exists public.sourcing_lesson_evidence (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lesson_id uuid not null,
  receipt_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (lesson_id, receipt_id),
  unique (workspace_id, receipt_id),
  constraint sourcing_lesson_evidence_lesson_fkey
    foreign key (workspace_id, lesson_id)
    references public.sourcing_lessons (workspace_id, id) on delete cascade,
  constraint sourcing_lesson_evidence_receipt_fkey
    foreign key (workspace_id, receipt_id)
    references public.sourcing_query_receipts (workspace_id, id) on delete restrict
);

create table if not exists public.sourcing_lesson_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lesson_id uuid not null,
  reviewer_id uuid references auth.users(id) on delete restrict,
  reviewer_kind text not null default 'human' check (reviewer_kind in ('human', 'system')),
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  prior_status text not null check (prior_status in ('draft', 'promoted', 'suspended', 'retired')),
  new_status text not null check (new_status in ('promoted', 'suspended', 'retired')),
  reason_code text not null check (
    reason_code in ('reviewed_useful', 'quality_hold', 'security_hold', 'operator_disabled', 'expired', 'superseded')
  ),
  lesson_version bigint not null check (lesson_version > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, request_id),
  constraint sourcing_lesson_reviews_actor_coherence check (
    (reviewer_kind = 'human' and reviewer_id is not null)
    or (reviewer_kind = 'system' and reviewer_id is null)
  ),
  constraint sourcing_lesson_reviews_lesson_fkey
    foreign key (workspace_id, lesson_id)
    references public.sourcing_lessons (workspace_id, id) on delete cascade
);

-- API roles never receive direct DML. SECURITY DEFINER routines below are the
-- only mutation and read surface for sourcing authority.
do $sourcing_learning_table_security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sourcing_learning_secrets',
    'sourcing_learning_controls',
    'sourcing_runs',
    'sourcing_run_quota',
    'sourcing_query_receipts',
    'sourcing_query_feedback',
    'sourcing_graphify_exports',
    'sourcing_lessons',
    'sourcing_lesson_evidence',
    'sourcing_lesson_reviews'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role, authenticator',
      table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_postgres_all', table_name);
    execute format(
      'create policy %I on public.%I for all to postgres, supabase_admin using (true) with check (true)',
      table_name || '_postgres_all',
      table_name
    );
  end loop;
end
$sourcing_learning_table_security$;

-- Static privilege checks intentionally require explicit statements as well
-- as the reconciliation loop above.
alter table public.sourcing_learning_secrets enable row level security;
alter table public.sourcing_learning_secrets force row level security;
revoke all on public.sourcing_learning_secrets from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_learning_controls enable row level security;
alter table public.sourcing_learning_controls force row level security;
revoke all on public.sourcing_learning_controls from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_runs enable row level security;
alter table public.sourcing_runs force row level security;
revoke all on public.sourcing_runs from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_run_quota enable row level security;
alter table public.sourcing_run_quota force row level security;
revoke all on public.sourcing_run_quota from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_query_receipts enable row level security;
alter table public.sourcing_query_receipts force row level security;
revoke all on public.sourcing_query_receipts from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_query_feedback enable row level security;
alter table public.sourcing_query_feedback force row level security;
revoke all on public.sourcing_query_feedback from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_graphify_exports enable row level security;
alter table public.sourcing_graphify_exports force row level security;
revoke all on public.sourcing_graphify_exports from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_lessons enable row level security;
alter table public.sourcing_lessons force row level security;
revoke all on public.sourcing_lessons from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_lesson_evidence enable row level security;
alter table public.sourcing_lesson_evidence force row level security;
revoke all on public.sourcing_lesson_evidence from public, anon, authenticated, service_role, authenticator;
alter table public.sourcing_lesson_reviews enable row level security;
alter table public.sourcing_lesson_reviews force row level security;
revoke all on public.sourcing_lesson_reviews from public, anon, authenticated, service_role, authenticator;

create or replace function public.reject_sourcing_lesson_review_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.sourcing_cleanup', true) = 'enabled' then
    return old;
  end if;
  raise exception 'sourcing lesson reviews are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_sourcing_lesson_review_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists sourcing_lesson_reviews_append_only on public.sourcing_lesson_reviews;
create trigger sourcing_lesson_reviews_append_only
  before update or delete on public.sourcing_lesson_reviews
  for each row execute function public.reject_sourcing_lesson_review_mutation();

create or replace function public.canonicalize_sourcing_role_basis(p_basis jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  canonical_skills jsonb;
  field_name text;
  field_value text;
begin
  if p_basis is null or jsonb_typeof(p_basis) <> 'object' then
    raise exception 'invalid sourcing role basis' using errcode = '22023';
  end if;
  if p_basis - array[
    'title', 'seniority', 'employmentType', 'locationType', 'region', 'timezone', 'skills'
  ] <> '{}'::jsonb then
    raise exception 'role basis contains unsupported fields' using errcode = '22023';
  end if;
  if jsonb_typeof(p_basis -> 'title') <> 'string'
     or length(btrim(p_basis ->> 'title')) not between 2 and 200
     or p_basis ->> 'title' ~* '(@|https?://|www\.)' then
    raise exception 'invalid sourcing role title' using errcode = '22023';
  end if;
  if jsonb_typeof(p_basis -> 'skills') <> 'array'
     or jsonb_array_length(p_basis -> 'skills') not between 1 and 200
     or exists (
       select 1 from jsonb_array_elements(p_basis -> 'skills') as item(value)
       where jsonb_typeof(item.value) <> 'string'
          or length(btrim(item.value #>> '{}')) not between 1 and 100
          or item.value #>> '{}' ~* '(@|https?://|www\.)'
     ) then
    raise exception 'invalid sourcing role skills' using errcode = '22023';
  end if;
  foreach field_name in array array[
    'seniority', 'employmentType', 'locationType', 'region', 'timezone'
  ]
  loop
    if p_basis ? field_name then
      if jsonb_typeof(p_basis -> field_name) <> 'string' then
        raise exception 'invalid sourcing role field' using errcode = '22023';
      end if;
      field_value := btrim(p_basis ->> field_name);
      if length(field_value) not between 1 and 200 or field_value ~* '(@|https?://|www\.)' then
        raise exception 'invalid sourcing role field' using errcode = '22023';
      end if;
    end if;
  end loop;

  select jsonb_agg(skill order by skill)
    into canonical_skills
    from (
      select distinct lower(btrim(value)) as skill
      from jsonb_array_elements_text(p_basis -> 'skills') as source(value)
    ) as normalized;

  return jsonb_strip_nulls(jsonb_build_object(
    'title', lower(btrim(p_basis ->> 'title')),
    'seniority', nullif(lower(btrim(p_basis ->> 'seniority')), ''),
    'employmentType', nullif(lower(btrim(p_basis ->> 'employmentType')), ''),
    'locationType', nullif(lower(btrim(p_basis ->> 'locationType')), ''),
    'region', nullif(lower(btrim(p_basis ->> 'region')), ''),
    'timezone', nullif(lower(btrim(p_basis ->> 'timezone')), ''),
    'skills', canonical_skills
  ));
end;
$$;

revoke all on function public.canonicalize_sourcing_role_basis(jsonb)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.validate_sourcing_learning_query(
  p_platform text,
  p_query text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  normalized text := regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g');
begin
  if p_platform not in ('GitHub', 'LinkedIn', 'Stack Overflow', 'Dribbble', 'Behance')
     or length(normalized) not between 3 and 256
     or normalized ~ '[[:cntrl:]]'
     or normalized ~* '(@|https?://|www\.|linkedin\.com/in/|ignore previous|system prompt|developer message|reveal instructions)'
     or normalized ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
    raise exception 'unsafe sourcing query' using errcode = '22023';
  end if;
  return normalized;
end;
$$;

revoke all on function public.validate_sourcing_learning_query(text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.sourcing_authority_hmac(
  p_workspace_id uuid,
  p_value text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  secret_value bytea;
begin
  select hmac_key into secret_value
  from public.sourcing_learning_secrets
  where workspace_id = p_workspace_id;
  if secret_value is null then
    raise exception 'sourcing authority secret unavailable' using errcode = '55000';
  end if;
  return encode(hmac(convert_to(p_value, 'UTF8'), secret_value, 'sha256'), 'hex');
end;
$$;

revoke all on function public.sourcing_authority_hmac(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.begin_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_role_basis jsonb,
  p_configuration_fingerprint text,
  p_mode text,
  p_provider text,
  p_model text,
  p_idempotency_key uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  canonical_role jsonb;
  role_hash text;
  campaign_hash text;
  existing_run public.sourcing_runs%rowtype;
  control public.sourcing_learning_controls%rowtype;
  workspace_quota integer;
  user_quota integer;
  user_scope text := 'user:' || p_actor_id::text;
  run_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_idempotency_key is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
     or p_configuration_fingerprint is null
     or p_configuration_fingerprint !~ '^[0-9a-f]{64}$'
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_mode is null
     or p_mode not in ('cloud', 'deterministic')
     or (p_mode = 'cloud' and (
       p_provider !~ '^[A-Za-z0-9._:-]{1,64}$'
       or p_model !~ '^[A-Za-z0-9._:/-]{1,160}$'
     ))
     or (p_mode = 'deterministic' and (p_provider is not null or p_model is not null)) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
  from public.profiles
  where id = p_actor_id
    and workspace_id = p_workspace_id
    and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.sourcing_learning_secrets (workspace_id, hmac_key)
  values (p_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;
  insert into public.sourcing_learning_controls (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  canonical_role := public.canonicalize_sourcing_role_basis(p_role_basis);
  role_hash := public.sourcing_authority_hmac(p_workspace_id, canonical_role::text);
  campaign_hash := public.sourcing_authority_hmac(p_workspace_id, 'campaign:' || p_campaign_id);

  -- Idempotency is resolved before quota rows are created or consumed.
  select * into existing_run
  from public.sourcing_runs
  where workspace_id = p_workspace_id
    and actor_id = p_actor_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_run.campaign_hmac <> campaign_hash
       or existing_run.role_fingerprint <> role_hash
       or existing_run.configuration_fingerprint <> p_configuration_fingerprint
       or existing_run.mode <> p_mode
       or existing_run.provider is distinct from p_provider
       or existing_run.model is distinct from p_model then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', existing_run.status,
      'run_id', existing_run.id,
      'role_fingerprint', existing_run.role_fingerprint
    );
  end if;

  select * into control
  from public.sourcing_learning_controls
  where workspace_id = p_workspace_id
  for update;

  insert into public.sourcing_run_quota (workspace_id, bucket_date, scope_key)
  values
    (p_workspace_id, current_date, 'workspace'),
    (p_workspace_id, current_date, user_scope)
  on conflict do nothing;

  perform 1
  from public.sourcing_run_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key in ('workspace', user_scope)
  order by scope_key
  for update;

  select used into workspace_quota
  from public.sourcing_run_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key = 'workspace';
  select used into user_quota
  from public.sourcing_run_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key = user_scope;
  if workspace_quota >= control.workspace_daily_limit
     or user_quota >= control.user_daily_limit then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;

  update public.sourcing_run_quota
  set used = used + 1,
      updated_at = now()
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key in ('workspace', user_scope);

  insert into public.sourcing_runs (
    workspace_id,
    actor_id,
    idempotency_key,
    request_id,
    campaign_hmac,
    role_fingerprint,
    configuration_fingerprint,
    mode,
    provider,
    model
  ) values (
    p_workspace_id,
    p_actor_id,
    p_idempotency_key,
    p_request_id,
    campaign_hash,
    role_hash,
    p_configuration_fingerprint,
    p_mode,
    p_provider,
    p_model
  ) returning id into run_id;

  return jsonb_build_object(
    'status', 'claimed',
    'run_id', run_id,
    'role_fingerprint', role_hash,
    'lessons_enabled', control.enabled
  );
end;
$$;

create or replace function public.complete_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_query_receipts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  run public.sourcing_runs%rowtype;
  receipt jsonb;
  canonical_receipts jsonb := '[]'::jsonb;
  canonical_receipt jsonb;
  normalized_query text;
  receipt_hash text;
  completion_hash text;
  receipt_id uuid;
  lesson_id uuid;
  receipt_summaries jsonb := '[]'::jsonb;
  ordinal integer := 0;
  total_candidates integer := 0;
  total_skipped integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_query_receipts is null
     or jsonb_typeof(p_query_receipts) <> 'array'
     or jsonb_array_length(p_query_receipts) not between 1 and 20 then
    return jsonb_build_object('status', 'invalid_receipts');
  end if;
  perform 1
  from public.profiles
  where id = p_actor_id
    and workspace_id = p_workspace_id
    and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into run
  from public.sourcing_runs
  where id = p_run_id
    and workspace_id = p_workspace_id
    and actor_id = p_actor_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  for receipt in select value from jsonb_array_elements(p_query_receipts)
  loop
    if jsonb_typeof(receipt) <> 'object'
       or receipt - array['platform', 'query', 'ok', 'candidateCount', 'skippedCount'] <> '{}'::jsonb
       or jsonb_typeof(receipt -> 'platform') <> 'string'
       or jsonb_typeof(receipt -> 'query') <> 'string'
       or jsonb_typeof(receipt -> 'ok') <> 'boolean'
       or jsonb_typeof(receipt -> 'candidateCount') <> 'number'
       or jsonb_typeof(receipt -> 'skippedCount') <> 'number'
       or receipt ->> 'candidateCount' !~ '^[0-9]{1,3}$'
       or receipt ->> 'skippedCount' !~ '^[0-9]{1,3}$'
       or (receipt ->> 'candidateCount')::integer not between 0 and 100
       or (receipt ->> 'skippedCount')::integer not between 0 and 100 then
      return jsonb_build_object('status', 'invalid_receipts');
    end if;
    begin
      normalized_query := public.validate_sourcing_learning_query(
        receipt ->> 'platform',
        receipt ->> 'query'
      );
    exception when sqlstate '22023' then
      return jsonb_build_object('status', 'invalid_receipts');
    end;
    canonical_receipt := jsonb_build_object(
      'platform', receipt ->> 'platform',
      'query', normalized_query,
      'ok', (receipt ->> 'ok')::boolean,
      'candidateCount', (receipt ->> 'candidateCount')::integer,
      'skippedCount', (receipt ->> 'skippedCount')::integer
    );
    canonical_receipts := canonical_receipts || jsonb_build_array(canonical_receipt);
    total_candidates := total_candidates + (receipt ->> 'candidateCount')::integer;
    total_skipped := total_skipped + (receipt ->> 'skippedCount')::integer;
  end loop;

  if total_candidates > 1000 or total_skipped > 1000 then
    return jsonb_build_object('status', 'invalid_receipts');
  end if;
  completion_hash := public.sourcing_authority_hmac(
    p_workspace_id,
    'completion:' || canonical_receipts::text
  );
  if run.status = 'completed' then
    if run.completion_hmac = completion_hash then
      select coalesce(jsonb_agg(jsonb_build_object(
        'receiptId', completed_receipt.id,
        'platform', completed_receipt.platform,
        'candidateCount', completed_receipt.candidate_count
      ) order by completed_receipt.ordinal), '[]'::jsonb)
      into receipt_summaries
      from public.sourcing_query_receipts as completed_receipt
      where completed_receipt.workspace_id = p_workspace_id
        and completed_receipt.run_id = p_run_id
        and completed_receipt.succeeded;
      return jsonb_build_object(
        'status', 'completed',
        'run_id', run.id,
        'query_count', run.query_count,
        'candidate_count', run.candidate_count,
        'receipts', receipt_summaries
      );
    end if;
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  if run.status <> 'in_progress' then
    return jsonb_build_object('status', 'completion_conflict');
  end if;

  ordinal := 0;
  for receipt in select value from jsonb_array_elements(canonical_receipts)
  loop
    normalized_query := receipt ->> 'query';
    receipt_hash := public.sourcing_authority_hmac(
      p_workspace_id,
      'query:' || (receipt ->> 'platform') || ':' || normalized_query
    );
    insert into public.sourcing_query_receipts (
      workspace_id,
      run_id,
      ordinal,
      platform,
      query_text,
      query_hmac,
      succeeded,
      candidate_count,
      skipped_count
    ) values (
      p_workspace_id,
      p_run_id,
      ordinal,
      receipt ->> 'platform',
      normalized_query,
      receipt_hash,
      (receipt ->> 'ok')::boolean,
      (receipt ->> 'candidateCount')::integer,
      (receipt ->> 'skippedCount')::integer
    ) returning id into receipt_id;
    if (receipt ->> 'ok')::boolean then
      receipt_summaries := receipt_summaries || jsonb_build_array(jsonb_build_object(
        'receiptId', receipt_id,
        'platform', receipt ->> 'platform',
        'candidateCount', (receipt ->> 'candidateCount')::integer
      ));

      insert into public.sourcing_lessons (
        workspace_id,
        role_fingerprint,
        platform,
        query_hmac,
        query_text
      ) values (
        p_workspace_id,
        run.role_fingerprint,
        receipt ->> 'platform',
        receipt_hash,
        normalized_query
      )
      on conflict (workspace_id, role_fingerprint, platform, query_hmac) do update
        set updated_at = now()
      returning id into lesson_id;

      insert into public.sourcing_lesson_evidence (
        workspace_id,
        lesson_id,
        receipt_id
      ) values (
        p_workspace_id,
        lesson_id,
        receipt_id
      ) on conflict do nothing;
    end if;
    ordinal := ordinal + 1;
  end loop;

  update public.sourcing_lessons as lesson
  set evidence_run_count = aggregates.run_count,
      evidence_campaign_count = aggregates.campaign_count,
      updated_at = now()
  from (
    select evidence.lesson_id,
           count(distinct receipt.run_id)::integer as run_count,
           count(distinct evidence_run.campaign_hmac)::integer as campaign_count
    from public.sourcing_lesson_evidence as evidence
    join public.sourcing_query_receipts as receipt
      on receipt.workspace_id = evidence.workspace_id
     and receipt.id = evidence.receipt_id
    join public.sourcing_runs as evidence_run
      on evidence_run.workspace_id = receipt.workspace_id
     and evidence_run.id = receipt.run_id
    where evidence.workspace_id = p_workspace_id
      and evidence.lesson_id in (
        select current_evidence.lesson_id
        from public.sourcing_lesson_evidence as current_evidence
        join public.sourcing_query_receipts as current_receipt
          on current_receipt.workspace_id = current_evidence.workspace_id
         and current_receipt.id = current_evidence.receipt_id
        where current_receipt.run_id = p_run_id
      )
    group by evidence.lesson_id
  ) as aggregates
  where lesson.workspace_id = p_workspace_id
    and lesson.id = aggregates.lesson_id;

  update public.sourcing_runs
  set status = 'completed',
      completion_hmac = completion_hash,
      query_count = jsonb_array_length(canonical_receipts),
      candidate_count = total_candidates,
      skipped_count = total_skipped,
      completed_at = now()
  where id = p_run_id
    and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'status', 'completed',
    'run_id', p_run_id,
    'query_count', jsonb_array_length(canonical_receipts),
    'candidate_count', total_candidates,
    'receipts', receipt_summaries
  );
end;
$$;

create or replace function public.fail_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  run public.sourcing_runs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id and workspace_id = p_workspace_id and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into run
  from public.sourcing_runs
  where id = p_run_id and workspace_id = p_workspace_id and actor_id = p_actor_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if run.status = 'failed' and run.error_code = p_error_code then
    return jsonb_build_object('status', 'failed', 'run_id', run.id);
  end if;
  if run.status <> 'in_progress' then
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  update public.sourcing_runs
  set status = 'failed',
      error_code = p_error_code,
      failed_at = now(),
      expires_at = least(expires_at, now() + interval '30 days')
  where id = p_run_id and workspace_id = p_workspace_id;
  return jsonb_build_object('status', 'failed', 'run_id', p_run_id);
end;
$$;

create or replace function public.record_sourcing_query_feedback(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_receipt_id uuid,
  p_verdict text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  existing_feedback public.sourcing_query_feedback%rowtype;
  receipt public.sourcing_query_receipts%rowtype;
  run public.sourcing_runs%rowtype;
  resolved_lesson_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_verdict not in ('useful', 'dead_end', 'corrected')
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id
    and workspace_id = p_workspace_id
    and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into existing_feedback
  from public.sourcing_query_feedback
  where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if existing_feedback.actor_id = p_actor_id
       and existing_feedback.receipt_id = p_receipt_id
       and existing_feedback.verdict = p_verdict then
      return jsonb_build_object('status', 'recorded', 'feedback_id', existing_feedback.id);
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into receipt
  from public.sourcing_query_receipts
  where id = p_receipt_id and workspace_id = p_workspace_id
  for share;
  if not found or not receipt.succeeded then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into run
  from public.sourcing_runs
  where id = receipt.run_id and workspace_id = p_workspace_id and status = 'completed'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select evidence.lesson_id into resolved_lesson_id
  from public.sourcing_lesson_evidence as evidence
  where evidence.workspace_id = p_workspace_id
    and evidence.receipt_id = p_receipt_id;
  if resolved_lesson_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into existing_feedback
  from public.sourcing_query_feedback
  where workspace_id = p_workspace_id
    and receipt_id = p_receipt_id
    and actor_id = p_actor_id
  for update;
  if found then
    if existing_feedback.verdict = p_verdict then
      return jsonb_build_object('status', 'recorded', 'feedback_id', existing_feedback.id);
    end if;
    return jsonb_build_object('status', 'feedback_conflict');
  end if;

  insert into public.sourcing_query_feedback (
    workspace_id, receipt_id, actor_id, verdict, request_id
  ) values (
    p_workspace_id, p_receipt_id, p_actor_id, p_verdict, p_request_id
  ) returning id into existing_feedback.id;

  update public.sourcing_lessons
  set useful_feedback_count = useful_feedback_count + case when p_verdict = 'useful' then 1 else 0 end,
      dead_end_feedback_count = dead_end_feedback_count + case when p_verdict = 'dead_end' then 1 else 0 end,
      corrected_feedback_count = corrected_feedback_count + case when p_verdict = 'corrected' then 1 else 0 end,
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = resolved_lesson_id;

  return jsonb_build_object('status', 'recorded', 'feedback_id', existing_feedback.id);
end;
$$;

create or replace function public.list_pending_sourcing_feedback(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  campaign_hash text;
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_campaign_id is null
     or length(p_campaign_id) not between 1 and 100
     or p_campaign_id ~ '[[:cntrl:]]'
     or p_limit not between 1 and 20 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id
    and workspace_id = p_workspace_id
    and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1 from public.sourcing_learning_controls
    where workspace_id = p_workspace_id and enabled
  ) or not exists (
    select 1 from public.sourcing_learning_secrets where workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('status', 'learning_disabled', 'receipts', '[]'::jsonb);
  end if;
  campaign_hash := public.sourcing_authority_hmac(p_workspace_id, 'campaign:' || p_campaign_id);
  select coalesce(jsonb_agg(item order by item ->> 'createdAt' desc, item ->> 'receiptId'), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'receiptId', receipt.id,
      'platform', receipt.platform,
      'candidateCount', receipt.candidate_count,
      'createdAt', receipt.created_at
    ) as item
    from public.sourcing_query_receipts as receipt
    join public.sourcing_runs as run
      on run.workspace_id = receipt.workspace_id
     and run.id = receipt.run_id
    left join public.sourcing_query_feedback as feedback
      on feedback.workspace_id = receipt.workspace_id
     and feedback.receipt_id = receipt.id
     and feedback.actor_id = p_actor_id
    where receipt.workspace_id = p_workspace_id
      and run.actor_id = p_actor_id
      and run.campaign_hmac = campaign_hash
      and run.status = 'completed'
      and receipt.succeeded
      and receipt.expires_at > now()
      and feedback.id is null
    order by receipt.created_at desc, receipt.id
    limit p_limit
  ) as pending;
  return jsonb_build_object('status', 'ready', 'receipts', result);
end;
$$;

create or replace function public.export_graphify_sourcing_lessons(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  result jsonb;
  payload jsonb;
  export_id uuid;
  workspace_fingerprint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id and workspace_id = p_workspace_id and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1 from public.sourcing_learning_controls
    where workspace_id = p_workspace_id and enabled
  ) then
    return jsonb_build_object('status', 'learning_disabled');
  end if;

  workspace_fingerprint := public.sourcing_authority_hmac(
    p_workspace_id,
    'workspace'
  );
  select coalesce(jsonb_agg(item order by item ->> 'roleFingerprint', item ->> 'platform', item ->> 'lessonId'), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'lessonId', lesson.id,
      'authorityVersion', lesson.version,
      'roleFingerprint', lesson.role_fingerprint,
      'queryFingerprint', lesson.query_hmac,
      'sourcePlatform', lower(replace(lesson.platform, ' ', '_')),
      'strategy', case
        when lesson.query_text ~* '(^|\s)language:' and lesson.query_text ~* '(^|\s)location:' then 'combined'
        when lesson.query_text ~* '(^|\s)language:' then 'language'
        when lesson.query_text ~* '(^|\s)location:' then 'location'
        else 'keyword'
      end,
      'outcome', case
        when evidence.corrected_count > greatest(evidence.useful_count, evidence.dead_end_count) then 'corrected'
        when evidence.dead_end_count > evidence.useful_count then 'dead_end'
        else 'useful'
      end,
      'promotionStatus', lesson.status,
      'evidence', jsonb_build_object(
        'independentRuns', lesson.evidence_run_count,
        'independentReviewerCount', evidence.reviewer_count,
        'resultCount', evidence.result_count,
        'reviewedCount', evidence.reviewed_count,
        'positiveCount', evidence.useful_count,
        'negativeCount', evidence.dead_end_count + evidence.corrected_count
      )
    ) as item
    from public.sourcing_lessons as lesson
    cross join lateral (
      select count(distinct feedback.actor_id)::integer as reviewer_count,
             (
               select coalesce(sum(result_receipt.candidate_count), 0)::integer
               from public.sourcing_lesson_evidence as result_evidence
               join public.sourcing_query_receipts as result_receipt
                 on result_receipt.workspace_id = result_evidence.workspace_id
                and result_receipt.id = result_evidence.receipt_id
               where result_evidence.workspace_id = lesson.workspace_id
                 and result_evidence.lesson_id = lesson.id
             ) as result_count,
             count(feedback.id)::integer as reviewed_count,
             count(feedback.id) filter (where feedback.verdict = 'useful')::integer as useful_count,
             count(feedback.id) filter (where feedback.verdict = 'dead_end')::integer as dead_end_count,
             count(feedback.id) filter (where feedback.verdict = 'corrected')::integer as corrected_count
      from public.sourcing_lesson_evidence as lesson_evidence
      join public.sourcing_query_receipts as receipt
        on receipt.workspace_id = lesson_evidence.workspace_id
       and receipt.id = lesson_evidence.receipt_id
      left join public.sourcing_query_feedback as feedback
        on feedback.workspace_id = lesson_evidence.workspace_id
       and feedback.receipt_id = lesson_evidence.receipt_id
      where lesson_evidence.workspace_id = lesson.workspace_id
        and lesson_evidence.lesson_id = lesson.id
    ) as evidence
    where lesson.workspace_id = p_workspace_id
      and lesson.status in ('draft', 'promoted', 'suspended')
      and lesson.evidence_run_count >= 2
      and evidence.reviewer_count >= 1
    order by lesson.updated_at, lesson.id
    limit p_limit
  ) as bounded;
  payload := jsonb_build_object(
    'schemaVersion', 1,
    'workspaceFingerprint', workspace_fingerprint,
    'lessons', result
  );
  if jsonb_array_length(result) = 0 then
    return jsonb_build_object('status', 'exported', 'payload', payload);
  end if;
  insert into public.sourcing_graphify_exports (
    workspace_id, actor_id, export_payload
  ) values (
    p_workspace_id, p_actor_id, payload
  ) returning id into export_id;
  return jsonb_build_object(
    'status', 'exported',
    'exportId', export_id,
    'payload', payload
  );
end;
$$;

create or replace function public.complete_graphify_sourcing_export(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_export_id uuid,
  p_input_text text,
  p_graph_text text,
  p_manifest jsonb,
  p_image_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  export_row public.sourcing_graphify_exports%rowtype;
  control public.sourcing_learning_controls%rowtype;
  parsed_input jsonb;
  parsed_graph jsonb;
  input_sha text;
  graph_sha text;
  attachment_count integer;
  expected_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_input_text is null or octet_length(p_input_text) not between 2 and 2097152
     or p_graph_text is null or octet_length(p_graph_text) not between 2 and 5242880
     or p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or p_image_digest is null
     or p_image_digest !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id and workspace_id = p_workspace_id and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into control from public.sourcing_learning_controls
  where workspace_id = p_workspace_id
  for share;
  if not found or not control.enabled then
    return jsonb_build_object('status', 'learning_disabled');
  end if;
  if control.required_graphify_image_digest is null
     or p_image_digest <> control.required_graphify_image_digest then
    return jsonb_build_object('status', 'image_version_rejected');
  end if;
  select * into export_row from public.sourcing_graphify_exports
  where id = p_export_id and workspace_id = p_workspace_id
  for update;
  if not found or export_row.expires_at <= now() then
    return jsonb_build_object('status', 'not_found');
  end if;
  begin
    parsed_input := p_input_text::jsonb;
    parsed_graph := p_graph_text::jsonb;
  exception when others then
    return jsonb_build_object('status', 'invalid_artifact');
  end;
  input_sha := encode(digest(convert_to(p_input_text, 'UTF8'), 'sha256'), 'hex');
  graph_sha := encode(digest(convert_to(p_graph_text, 'UTF8'), 'sha256'), 'hex');
  if export_row.status = 'completed' then
    if export_row.input_sha256 = input_sha
       and export_row.graph_sha256 = graph_sha
       and export_row.image_digest = p_image_digest then
      return jsonb_build_object(
        'status', 'completed', 'exportId', export_row.id,
        'graphSha256', export_row.graph_sha256
      );
    end if;
    return jsonb_build_object('status', 'conflict');
  end if;
  if parsed_input <> export_row.export_payload
     or p_graph_text ~* '(@|https?://|linkedin\.com/in/|candidate[_ -]?id|profile[_ -]?(url|id|handle))'
     or p_manifest ->> 'status' <> 'ok'
     or p_manifest ->> 'schemaVersion' <> '1'
     or p_manifest ->> 'inputSchemaVersion' <> '1'
     or p_manifest ->> 'workspaceFingerprint'
        <> (export_row.export_payload ->> 'workspaceFingerprint')
     or p_manifest ->> 'inputSha256' <> input_sha
     or p_manifest ->> 'graphSha256' <> graph_sha
     or p_manifest #>> '{graphify,commit}' <> control.required_graphify_commit
     or p_manifest #>> '{graphify,semanticLlmUsed}' <> 'false'
     or p_manifest #>> '{graphify,queryLoggingDisabled}' <> 'true'
     or parsed_graph ->> 'built_at_commit' <> control.required_graphify_commit
     or parsed_graph ->> 'directed' <> 'true'
     or jsonb_typeof(p_manifest -> 'attachments') <> 'array' then
    return jsonb_build_object('status', 'invalid_artifact');
  end if;
  expected_count := jsonb_array_length(export_row.export_payload -> 'lessons');
  attachment_count := jsonb_array_length(p_manifest -> 'attachments');
  if p_manifest ->> 'lessonCount' <> expected_count::text
     or attachment_count <> expected_count
     or exists (
       select 1
       from jsonb_array_elements(export_row.export_payload -> 'lessons') as expected(item)
       where not exists (
         select 1
         from jsonb_array_elements(p_manifest -> 'attachments') as attached(item)
         where attached.item ->> 'lessonId' = expected.item ->> 'lessonId'
           and attached.item ->> 'expectedVersion' = expected.item ->> 'authorityVersion'
           and attached.item ->> 'clusterRef' ~ '^[A-Za-z0-9._:-]{1,100}$'
       )
     ) then
    return jsonb_build_object('status', 'invalid_artifact');
  end if;
  update public.sourcing_graphify_exports
  set status = 'completed',
      input_sha256 = input_sha,
      graph_sha256 = graph_sha,
      graph_text = p_graph_text,
      manifest = p_manifest,
      image_digest = p_image_digest,
      graphify_commit = control.required_graphify_commit,
      completed_at = now()
  where id = p_export_id and workspace_id = p_workspace_id;
  return jsonb_build_object(
    'status', 'completed', 'exportId', p_export_id, 'graphSha256', graph_sha
  );
end;
$$;

create or replace function public.attach_graphify_sourcing_lesson(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_lesson_id uuid,
  p_expected_version bigint,
  p_export_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  lesson public.sourcing_lessons%rowtype;
  export_row public.sourcing_graphify_exports%rowtype;
  control public.sourcing_learning_controls%rowtype;
  attachment jsonb;
  new_version bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_export_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id and workspace_id = p_workspace_id and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into control from public.sourcing_learning_controls
  where workspace_id = p_workspace_id
  for share;
  if not found or not control.enabled then
    return jsonb_build_object('status', 'learning_disabled');
  end if;
  select * into lesson from public.sourcing_lessons
  where id = p_lesson_id and workspace_id = p_workspace_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if lesson.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', lesson.version);
  end if;
  if lesson.status = 'retired' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into export_row from public.sourcing_graphify_exports
  where id = p_export_id
    and workspace_id = p_workspace_id
    and status = 'completed'
    and graphify_commit = control.required_graphify_commit
    and expires_at > now()
  for share;
  if not found then
    return jsonb_build_object('status', 'artifact_not_found');
  end if;
  select item into attachment
  from jsonb_array_elements(export_row.manifest -> 'attachments') as attached(item)
  where item ->> 'lessonId' = p_lesson_id::text
    and item ->> 'expectedVersion' = p_expected_version::text
  limit 1;
  if attachment is null
     or attachment ->> 'clusterRef' !~ '^[A-Za-z0-9._:-]{1,100}$' then
    return jsonb_build_object('status', 'artifact_mismatch');
  end if;

  update public.sourcing_lessons
  set graphify_artifact_sha256 = export_row.graph_sha256,
      graphify_cluster_ref = attachment ->> 'clusterRef',
      graphify_commit = export_row.graphify_commit,
      graphify_export_id = export_row.id,
      graphified_at = now(),
      graphified_by = p_actor_id,
      version = version + 1,
      updated_at = now()
  where id = p_lesson_id and workspace_id = p_workspace_id
  returning version into new_version;
  return jsonb_build_object('status', 'attached', 'version', new_version);
end;
$$;

create or replace function public.review_sourcing_lesson(
  p_workspace_id uuid,
  p_reviewer_id uuid,
  p_lesson_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_reason_code text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  lesson public.sourcing_lessons%rowtype;
  control public.sourcing_learning_controls%rowtype;
  replay public.sourcing_lesson_reviews%rowtype;
  new_version bigint;
  new_expiry timestamptz;
  actual_run_count integer;
  actual_campaign_count integer;
  actual_useful_receipt_count integer;
  actual_dead_end_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_decision not in ('promoted', 'suspended', 'retired')
     or p_reason_code not in ('reviewed_useful', 'quality_hold', 'security_hold', 'operator_disabled', 'expired', 'superseded')
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_reviewer_id and workspace_id = p_workspace_id and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into replay from public.sourcing_lesson_reviews
  where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if replay.lesson_id = p_lesson_id
       and replay.reviewer_id = p_reviewer_id
       and replay.new_status = p_decision
       and replay.reason_code = p_reason_code then
      return jsonb_build_object('status', 'reviewed', 'version', replay.lesson_version);
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into control from public.sourcing_learning_controls
  where workspace_id = p_workspace_id
  for share;
  select * into lesson from public.sourcing_lessons
  where id = p_lesson_id and workspace_id = p_workspace_id
  for update;
  if not found or lesson.status = 'retired' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if lesson.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', lesson.version);
  end if;

  select count(distinct receipt.run_id)::integer,
         count(distinct evidence_run.campaign_hmac)::integer,
         count(distinct feedback.receipt_id) filter (where feedback.verdict = 'useful')::integer,
         count(feedback.id) filter (where feedback.verdict = 'dead_end')::integer
    into actual_run_count, actual_campaign_count, actual_useful_receipt_count, actual_dead_end_count
  from public.sourcing_lesson_evidence as evidence
  join public.sourcing_query_receipts as receipt
    on receipt.workspace_id = evidence.workspace_id
   and receipt.id = evidence.receipt_id
  join public.sourcing_runs as evidence_run
    on evidence_run.workspace_id = receipt.workspace_id
   and evidence_run.id = receipt.run_id
  left join public.sourcing_query_feedback as feedback
    on feedback.workspace_id = evidence.workspace_id
   and feedback.receipt_id = evidence.receipt_id
  where evidence.workspace_id = p_workspace_id
    and evidence.lesson_id = p_lesson_id;

  if p_decision = 'promoted' then
    if not control.enabled then
      return jsonb_build_object('status', 'learning_disabled');
    end if;
    if p_reason_code <> 'reviewed_useful'
       or lesson.graphify_artifact_sha256 is null
       or lesson.graphify_commit <> control.required_graphify_commit
       or not exists (
         select 1 from public.sourcing_graphify_exports as artifact
         where artifact.workspace_id = p_workspace_id
           and artifact.id = lesson.graphify_export_id
           and artifact.status = 'completed'
           and artifact.graph_sha256 = lesson.graphify_artifact_sha256
           and artifact.graphify_commit = lesson.graphify_commit
       )
       or actual_run_count < control.min_evidence_runs
       or actual_campaign_count < control.min_evidence_runs
       or actual_useful_receipt_count < control.min_evidence_runs
       or actual_useful_receipt_count <= actual_dead_end_count then
      return jsonb_build_object('status', 'insufficient_evidence');
    end if;
    if exists (
      select 1
      from public.sourcing_lesson_evidence as evidence
      join public.sourcing_query_receipts as receipt
        on receipt.workspace_id = evidence.workspace_id
       and receipt.id = evidence.receipt_id
      join public.sourcing_runs as run
        on run.workspace_id = receipt.workspace_id
       and run.id = receipt.run_id
      where evidence.workspace_id = p_workspace_id
        and evidence.lesson_id = p_lesson_id
        and run.actor_id = p_reviewer_id
    ) or exists (
      select 1
      from public.sourcing_lesson_evidence as evidence
      join public.sourcing_query_feedback as feedback
        on feedback.workspace_id = evidence.workspace_id
       and feedback.receipt_id = evidence.receipt_id
      where evidence.workspace_id = p_workspace_id
        and evidence.lesson_id = p_lesson_id
        and feedback.actor_id = p_reviewer_id
    ) then
      return jsonb_build_object('status', 'reviewer_conflict');
    end if;
    new_expiry := now() + make_interval(days => control.lesson_ttl_days);
  end if;

  update public.sourcing_lessons
  set status = p_decision,
      promoted_at = case when p_decision = 'promoted' then now() else promoted_at end,
      promoted_by = case when p_decision = 'promoted' then p_reviewer_id else promoted_by end,
      suspended_at = case when p_decision = 'suspended' then now() else suspended_at end,
      retired_at = case when p_decision = 'retired' then now() else retired_at end,
      expires_at = case when p_decision = 'promoted' then new_expiry else expires_at end,
      version = version + 1,
      updated_at = now()
  where id = p_lesson_id and workspace_id = p_workspace_id
  returning version into new_version;

  insert into public.sourcing_lesson_reviews (
    workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    p_workspace_id, p_lesson_id, p_reviewer_id, 'human', p_request_id,
    lesson.status, p_decision, p_reason_code, new_version
  );
  return jsonb_build_object('status', 'reviewed', 'version', new_version);
end;
$$;

create or replace function public.list_promoted_sourcing_lessons(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_role_basis jsonb,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  role_hash text;
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 20 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id
    and workspace_id = p_workspace_id
    and role in ('admin', 'member')
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1 from public.sourcing_learning_controls as control
    where control.workspace_id = p_workspace_id and control.enabled
  ) or not exists (
    select 1 from public.sourcing_learning_secrets where workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('status', 'learning_disabled', 'lessons', '[]'::jsonb);
  end if;
  begin
    role_hash := public.sourcing_authority_hmac(
      p_workspace_id,
      public.canonicalize_sourcing_role_basis(p_role_basis)::text
    );
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid_request');
  end;

  select coalesce(jsonb_agg(item order by (item ->> 'rank')::integer, item ->> 'lessonId'), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'lessonId', candidate.id,
      'platform', candidate.platform,
      'query', candidate.query_text,
      'graphifyClusterRef', candidate.graphify_cluster_ref,
      'graphifyClusterRank', candidate.cluster_rank,
      'evidenceRunCount', candidate.evidence_run_count,
      'evidenceCampaignCount', candidate.evidence_campaign_count,
      'usefulFeedbackCount', candidate.useful_feedback_count,
      'expiresAt', candidate.expires_at,
      'rank', row_number() over (
        order by candidate.cluster_rank,
                 candidate.useful_feedback_count desc,
                 candidate.evidence_run_count desc,
                 candidate.updated_at desc,
                 candidate.id
      )
    ) as item
    from (
      select lesson.*,
             row_number() over (
               partition by lesson.graphify_cluster_ref
               order by lesson.useful_feedback_count desc,
                        lesson.evidence_run_count desc,
                        lesson.updated_at desc,
                        lesson.id
             ) as cluster_rank
      from public.sourcing_lessons as lesson
      where lesson.workspace_id = p_workspace_id
        and lesson.role_fingerprint = role_hash
        and lesson.status = 'promoted'
        and lesson.expires_at > now()
        and lesson.graphify_cluster_ref is not null
    ) as candidate
    order by candidate.cluster_rank,
             candidate.useful_feedback_count desc,
             candidate.evidence_run_count desc,
             candidate.updated_at desc,
             candidate.id
    limit p_limit
  ) as ranked;
  return jsonb_build_object('status', 'ready', 'role_fingerprint', role_hash, 'lessons', result);
end;
$$;

create or replace function public.configure_sourcing_learning(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_enabled boolean,
  p_workspace_daily_limit integer,
  p_user_daily_limit integer,
  p_min_evidence_runs integer,
  p_lesson_ttl_days integer,
  p_required_graphify_image_digest text,
  p_expected_version bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  control public.sourcing_learning_controls%rowtype;
  new_version bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_enabled is null
     or p_workspace_daily_limit not between 1 and 1000
     or p_user_daily_limit not between 1 and 250
     or p_min_evidence_runs not between 2 and 10
     or p_lesson_ttl_days not between 7 and 365
     or p_required_graphify_image_digest is null
     or p_required_graphify_image_digest !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where id = p_actor_id and workspace_id = p_workspace_id and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  insert into public.sourcing_learning_controls (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;
  select * into control from public.sourcing_learning_controls
  where workspace_id = p_workspace_id
  for update;
  if control.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', control.version);
  end if;
  update public.sourcing_learning_controls
  set enabled = p_enabled,
      workspace_daily_limit = p_workspace_daily_limit,
      user_daily_limit = p_user_daily_limit,
      min_evidence_runs = p_min_evidence_runs,
      lesson_ttl_days = p_lesson_ttl_days,
      required_graphify_image_digest = p_required_graphify_image_digest,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where workspace_id = p_workspace_id
  returning version into new_version;

  if not p_enabled then
    with suspended as (
      update public.sourcing_lessons
      set status = 'suspended',
          suspended_at = now(),
          version = version + 1,
          updated_at = now()
      where workspace_id = p_workspace_id
        and status = 'promoted'
      returning id, version
    )
    insert into public.sourcing_lesson_reviews (
      workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
      prior_status, new_status, reason_code, lesson_version
    )
    select p_workspace_id, suspended.id, p_actor_id, 'human',
           left(p_request_id, 55) || ':' || suspended.id::text,
           'promoted', 'suspended', 'operator_disabled', suspended.version
    from suspended;
  end if;
  return jsonb_build_object('status', 'configured', 'version', new_version, 'enabled', p_enabled);
end;
$$;

create or replace function public.cleanup_sourcing_learning_authority(
  p_workspace_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  retired_count integer := 0;
  lessons_deleted integer := 0;
  artifacts_deleted integer := 0;
  runs_deleted integer := 0;
  quota_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  with retired as (
    update public.sourcing_lessons
    set status = 'retired',
        retired_at = now(),
        version = version + 1,
        updated_at = now()
    where id in (
      select id from public.sourcing_lessons
      where workspace_id = p_workspace_id
        and status = 'promoted'
        and expires_at <= now()
      order by expires_at, id
      limit p_limit
      for update skip locked
    )
    returning id, version
  ), reviews as (
    insert into public.sourcing_lesson_reviews (
      workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
      prior_status, new_status, reason_code, lesson_version
    )
    select p_workspace_id, retired.id, null, 'system',
           'cleanup:' || retired.id::text,
           'promoted', 'retired', 'expired', retired.version
    from retired
    on conflict (workspace_id, request_id) do nothing
  )
  select count(*)::integer into retired_count from retired;

  perform set_config('app.sourcing_cleanup', 'enabled', true);
  with candidates as (
    select lesson.id
    from public.sourcing_lessons as lesson
    where lesson.workspace_id = p_workspace_id
      and lesson.status in ('draft', 'suspended', 'retired')
      and lesson.updated_at < now() - interval '180 days'
    order by lesson.updated_at, lesson.id
    limit greatest(p_limit - retired_count, 0)
    for update skip locked
  )
  delete from public.sourcing_lessons as lesson
  using candidates
  where lesson.id = candidates.id;
  get diagnostics lessons_deleted = row_count;

  with candidates as (
    select artifact.id
    from public.sourcing_graphify_exports as artifact
    where artifact.workspace_id = p_workspace_id
      and artifact.expires_at <= now()
      and not exists (
        select 1 from public.sourcing_lessons as lesson
        where lesson.workspace_id = artifact.workspace_id
          and lesson.graphify_export_id = artifact.id
      )
    order by artifact.expires_at, artifact.id
    limit greatest(p_limit - retired_count - lessons_deleted, 0)
    for update skip locked
  )
  delete from public.sourcing_graphify_exports as artifact
  using candidates
  where artifact.id = candidates.id;
  get diagnostics artifacts_deleted = row_count;

  with candidates as (
    select run.id
    from public.sourcing_runs as run
    where run.workspace_id = p_workspace_id
      and run.expires_at <= now()
      and not exists (
        select 1
        from public.sourcing_query_receipts as receipt
        join public.sourcing_lesson_evidence as evidence
          on evidence.workspace_id = receipt.workspace_id
         and evidence.receipt_id = receipt.id
        join public.sourcing_lessons as lesson
          on lesson.workspace_id = evidence.workspace_id
         and lesson.id = evidence.lesson_id
        where receipt.workspace_id = run.workspace_id
          and receipt.run_id = run.id
          and lesson.status = 'promoted'
      )
    order by run.expires_at, run.id
    limit greatest(p_limit - retired_count - lessons_deleted - artifacts_deleted, 0)
    for update skip locked
  )
  delete from public.sourcing_runs as run
  using candidates
  where run.id = candidates.id;
  get diagnostics runs_deleted = row_count;

  with candidates as (
    select quota.workspace_id, quota.bucket_date, quota.scope_key
    from public.sourcing_run_quota as quota
    where quota.workspace_id = p_workspace_id
      and quota.bucket_date < current_date - 30
    order by quota.bucket_date, quota.scope_key
    limit greatest(p_limit - retired_count - lessons_deleted - artifacts_deleted - runs_deleted, 0)
    for update skip locked
  )
  delete from public.sourcing_run_quota as quota
  using candidates
  where quota.workspace_id = candidates.workspace_id
    and quota.bucket_date = candidates.bucket_date
    and quota.scope_key = candidates.scope_key;
  get diagnostics quota_deleted = row_count;
  perform set_config('app.sourcing_cleanup', '', true);

  return jsonb_build_object(
    'status', 'cleaned',
    'retired', retired_count,
    'lessons_deleted', lessons_deleted,
    'artifacts_deleted', artifacts_deleted,
    'runs_deleted', runs_deleted,
    'quota_deleted', quota_deleted
  );
end;
$$;

revoke all on function public.begin_sourcing_run(uuid, uuid, text, jsonb, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.complete_sourcing_run(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.fail_sourcing_run(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.record_sourcing_query_feedback(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.list_pending_sourcing_feedback(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.export_graphify_sourcing_lessons(uuid, uuid, integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.complete_graphify_sourcing_export(uuid, uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.attach_graphify_sourcing_lesson(uuid, uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.review_sourcing_lesson(uuid, uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.list_promoted_sourcing_lessons(uuid, uuid, jsonb, integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.configure_sourcing_learning(uuid, uuid, boolean, integer, integer, integer, integer, text, bigint, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.cleanup_sourcing_learning_authority(uuid, integer)
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.begin_sourcing_run(uuid, uuid, text, jsonb, text, text, text, text, uuid, text)
  to service_role;
grant execute on function public.complete_sourcing_run(uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.fail_sourcing_run(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.record_sourcing_query_feedback(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.list_pending_sourcing_feedback(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.export_graphify_sourcing_lessons(uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_graphify_sourcing_export(uuid, uuid, uuid, text, text, jsonb, text)
  to service_role;
grant execute on function public.attach_graphify_sourcing_lesson(uuid, uuid, uuid, bigint, uuid)
  to service_role;
grant execute on function public.review_sourcing_lesson(uuid, uuid, uuid, bigint, text, text, text)
  to service_role;
grant execute on function public.list_promoted_sourcing_lessons(uuid, uuid, jsonb, integer)
  to service_role;
grant execute on function public.configure_sourcing_learning(uuid, uuid, boolean, integer, integer, integer, integer, text, bigint, text)
  to service_role;
grant execute on function public.cleanup_sourcing_learning_authority(uuid, integer)
  to service_role;
