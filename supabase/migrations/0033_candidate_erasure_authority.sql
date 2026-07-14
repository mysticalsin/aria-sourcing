-- Canonical candidate-erasure authority.
--
-- One service-only transaction binds the exact workspace, campaign, candidate,
-- administrator and idempotency key; blocks on an active legal hold; scrubs
-- every candidate-addressable operational store; and records only row counts
-- plus opaque provider-reference hashes. External deletion is never assumed:
-- unsupported provider work remains manual_required until independently closed.

create table if not exists public.candidate_legal_holds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  candidate_id text not null
    check (candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  case_reference text not null
    check (case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'),
  status text not null default 'active' check (status in ('active', 'released', 'expired')),
  placed_by uuid not null,
  placed_at timestamptz not null default now(),
  expires_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  release_case_reference text check (
    release_case_reference is null
    or release_case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
  ),
  check (
    (status = 'active' and released_by is null and released_at is null
      and release_case_reference is null)
    or (status = 'released' and released_by is not null and released_at is not null
      and release_case_reference is not null)
    or (status = 'expired' and expires_at is not null
      and released_by is null and released_at is null
      and release_case_reference is null)
  ),
  check (expires_at is null or expires_at > placed_at),
  foreign key (workspace_id, placed_by)
    references public.profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, released_by)
    references public.profiles(workspace_id, id) on delete restrict
);

create unique index if not exists candidate_legal_holds_one_active_idx
  on public.candidate_legal_holds(workspace_id, campaign_id, candidate_id)
  where status = 'active';

create table if not exists public.candidate_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  candidate_id text not null
    check (candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  actor_id uuid not null,
  request_key uuid not null,
  status text not null check (
    status in (
      'pending_provider', 'manual_required', 'retryable_failure',
      'completed', 'blocked_legal_hold'
    )
  ),
  local_scrub_completed_at timestamptz,
  provider_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, actor_id)
    references public.profiles(workspace_id, id) on delete restrict,
  unique (workspace_id, request_key),
  unique (workspace_id, campaign_id, candidate_id),
  constraint candidate_erasure_requests_state_check check (
    (status = 'blocked_legal_hold'
      and provider_completed_at is null)
    or (status in ('pending_provider', 'manual_required', 'retryable_failure')
      and local_scrub_completed_at is not null and provider_completed_at is null)
    or (status = 'completed'
      and local_scrub_completed_at is not null and provider_completed_at is not null)
  )
);

alter table public.candidate_erasure_requests
  drop constraint if exists candidate_erasure_requests_check;
alter table public.candidate_erasure_requests
  drop constraint if exists candidate_erasure_requests_state_check;
alter table public.candidate_erasure_requests
  add constraint candidate_erasure_requests_state_check check (
    (status = 'blocked_legal_hold' and provider_completed_at is null)
    or (status in ('pending_provider', 'manual_required', 'retryable_failure')
      and local_scrub_completed_at is not null and provider_completed_at is null)
    or (status = 'completed'
      and local_scrub_completed_at is not null and provider_completed_at is not null)
  );

create index if not exists candidate_erasure_requests_status_idx
  on public.candidate_erasure_requests(workspace_id, status, updated_at, id);

create table if not exists public.candidate_erasure_suppression_tombstones (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.candidate_erasure_requests(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  identifier_kind text not null check (
    identifier_kind in (
      'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
      'source_external_id', 'source_authority_id', 'provider_external_id'
    )
  ),
  identifier_hmac text not null check (identifier_hmac ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, identifier_kind, identifier_hmac)
);

create index if not exists candidate_erasure_tombstones_request_idx
  on public.candidate_erasure_suppression_tombstones(request_id, identifier_kind);

create table if not exists public.candidate_erasure_receipts (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.candidate_erasure_requests(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_name text not null check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results'
  )),
  scrubbed_rows integer not null check (scrubbed_rows >= 0),
  recorded_at timestamptz not null default now(),
  unique (request_id, store_name)
);

create table if not exists public.candidate_erasure_obligations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.candidate_erasure_requests(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9._:-]{0,63}$'),
  reference_hmac text not null check (reference_hmac ~ '^[0-9a-f]{64}$'),
  reference_ciphertext bytea check (
    reference_ciphertext is null
    or octet_length(reference_ciphertext) between 32 and 4096
  ),
  status text not null check (
    status in (
      'pending_provider', 'manual_required', 'retryable_failure',
      'completed', 'blocked_legal_hold'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  next_attempt_at timestamptz,
  completion_evidence_sha256 text check (
    completion_evidence_sha256 is null or completion_evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  completion_case_reference text check (
    completion_case_reference is null
    or completion_case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
  ),
  completed_by uuid,
  authority_access_count integer not null default 0
    check (authority_access_count between 0 and 1000),
  authority_last_accessed_at timestamptz,
  authority_last_accessed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (request_id, provider, reference_hmac),
  foreign key (workspace_id, completed_by)
    references public.profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, authority_last_accessed_by)
    references public.profiles(workspace_id, id) on delete restrict,
  check (
    (status = 'completed' and completed_at is not null
      and last_error_code is null and next_attempt_at is null
      and completion_evidence_sha256 is not null
      and completion_case_reference is not null and completed_by is not null
      and reference_ciphertext is null)
    or (status = 'retryable_failure' and completed_at is null
      and last_error_code is not null and next_attempt_at is not null
      and completion_evidence_sha256 is null
      and completion_case_reference is null and completed_by is null
      and reference_ciphertext is not null)
    or (status in ('pending_provider', 'manual_required', 'blocked_legal_hold')
      and completed_at is null and last_error_code is null and next_attempt_at is null
      and completion_evidence_sha256 is null and reference_ciphertext is not null
      and completion_case_reference is null and completed_by is null)
  ),
  check (
    (authority_access_count = 0 and authority_last_accessed_at is null
      and authority_last_accessed_by is null)
    or (authority_access_count > 0 and authority_last_accessed_at is not null
      and authority_last_accessed_by is not null)
  )
);

create index if not exists candidate_erasure_obligations_pending_idx
  on public.candidate_erasure_obligations(workspace_id, status, next_attempt_at, id)
  where status in ('pending_provider', 'manual_required', 'retryable_failure');

create or replace function public.enforce_candidate_erasure_obligation_limit()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.request_id::text, 0));
  select count(*) into existing_count
    from public.candidate_erasure_obligations obligation
   where obligation.request_id = new.request_id;
  if existing_count >= 100 then
    raise exception 'candidate erasure provider obligation limit exceeded'
      using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_candidate_erasure_obligation_limit()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_obligation_limit
  on public.candidate_erasure_obligations;
create trigger candidate_erasure_obligation_limit
  before insert on public.candidate_erasure_obligations
  for each row execute function public.enforce_candidate_erasure_obligation_limit();

alter table public.candidate_legal_holds enable row level security;
alter table public.candidate_legal_holds force row level security;
alter table public.candidate_erasure_requests enable row level security;
alter table public.candidate_erasure_requests force row level security;
alter table public.candidate_erasure_suppression_tombstones enable row level security;
alter table public.candidate_erasure_suppression_tombstones force row level security;
alter table public.candidate_erasure_receipts enable row level security;
alter table public.candidate_erasure_receipts force row level security;
alter table public.candidate_erasure_obligations enable row level security;
alter table public.candidate_erasure_obligations force row level security;

revoke all on public.candidate_legal_holds
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.candidate_erasure_requests
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.candidate_erasure_suppression_tombstones
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.candidate_erasure_receipts
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.candidate_erasure_obligations
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.candidate_erasure_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;

drop policy if exists candidate_legal_holds_owner_access on public.candidate_legal_holds;
create policy candidate_legal_holds_owner_access on public.candidate_legal_holds
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists candidate_erasure_requests_owner_access on public.candidate_erasure_requests;
create policy candidate_erasure_requests_owner_access on public.candidate_erasure_requests
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists candidate_erasure_tombstones_owner_access
  on public.candidate_erasure_suppression_tombstones;
create policy candidate_erasure_tombstones_owner_access
  on public.candidate_erasure_suppression_tombstones
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists candidate_erasure_receipts_owner_access on public.candidate_erasure_receipts;
create policy candidate_erasure_receipts_owner_access on public.candidate_erasure_receipts
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists candidate_erasure_obligations_owner_access on public.candidate_erasure_obligations;
create policy candidate_erasure_obligations_owner_access on public.candidate_erasure_obligations
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_candidate_erasure_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'candidate erasure receipts are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_candidate_erasure_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_receipts_append_only
  on public.candidate_erasure_receipts;
create trigger candidate_erasure_receipts_append_only
  before update or delete on public.candidate_erasure_receipts
  for each row execute function public.reject_candidate_erasure_receipt_mutation();

create or replace function public.candidate_erasure_contains_identity(
  p_value text,
  p_tokens text[]
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  token text;
  lowered text := lower(coalesce(p_value, ''));
  relative_index integer;
  absolute_index integer;
  search_offset integer;
  preceding text;
  following text;
begin
  foreach token in array coalesce(p_tokens, array[]::text[]) loop
    if length(token) < 3 then continue; end if;
    search_offset := 1;
    loop
      relative_index := position(token in substring(lowered from search_offset));
      exit when relative_index = 0;
      absolute_index := search_offset + relative_index - 1;
      preceding := case when absolute_index > 1
        then substring(lowered from absolute_index - 1 for 1) else '' end;
      following := substring(lowered from absolute_index + length(token) for 1);
      if (preceding = '' or preceding !~ '[[:alnum:]_]')
         and (following = '' or following !~ '[[:alnum:]_]') then
        return true;
      end if;
      search_offset := absolute_index + 1;
      exit when search_offset > length(lowered) - length(token) + 1;
    end loop;
  end loop;
  return false;
end;
$$;

revoke all on function public.candidate_erasure_contains_identity(text, text[])
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_tombstone_document(
  p_candidate jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'id', coalesce(p_candidate->>'id', ''),
    'campaignId', coalesce(p_candidate->>'campaignId', ''),
    'name', 'Anonymized Candidate',
    'email', '',
    'phone', '',
    'avatarInitials', 'AN',
    'currentTitle', '',
    'currentCompany', '',
    'location', '',
    'timezone', '',
    'linkedinUrl', '',
    'githubUrl', '',
    'sourceUrl', null,
    'sourceExternalId', null,
    'sourceAuthorityId', null,
    'sourcePlatform', 'Manual',
    'sourceQuery', '',
    'matchScore', 0,
    'matchBreakdown', '[]'::jsonb,
    'techStack', '[]'::jsonb,
    'yearsExperience', null,
    'companyStageExperience', '[]'::jsonb,
    'industryExperience', '[]'::jsonb,
    'recentActivity', '',
    'stage', 'Suppressed',
    'maxStageRank', 0,
    'lastContactedAt', null,
    'lastRepliedAt', null,
    'outreachHistory', '[]'::jsonb,
    'replyHistory', '[]'::jsonb,
    'booking', null,
    'createdAt', coalesce(p_candidate->>'createdAt', ''),
    'provenance', 'manual',
    'notes', '[]'::jsonb,
    'rejectionReason', null,
    'leadSource', 'Outbound',
    'referredBy', null,
    'starRating', null,
    'vivier', false,
    'silverMedalist', false,
    'recontactAt', null,
    'prequal', null,
    'interviews', '[]'::jsonb,
    'dna', '[]'::jsonb,
    'complianceFlags', jsonb_build_object(
      'doNotContact', true,
      'suppressed', true,
      'unsubscribed', true,
      'gdprExportRequested',
        coalesce(p_candidate->'complianceFlags'->>'gdprExportRequested', 'false') = 'true',
      'anonymized', true,
      'suppressedUntil', null,
      'preSuppressionStage', null
    )
  );
$$;

revoke all on function public.candidate_erasure_tombstone_document(jsonb)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.scrub_candidate_workspace_document(
  p_state jsonb,
  p_candidate_id text
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate jsonb;
  next_state jsonb := p_state;
  tokens text[] := array[]::text[];
  identities text[] := array[]::text[];
  related_ids text[] := array[]::text[];
  ingested_ids text[] := array[]::text[];
begin
  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_state->'candidates') <> 'array' then
    return null;
  end if;
  select item.value into candidate
    from jsonb_array_elements(p_state->'candidates') item(value)
   where item.value->>'id' = p_candidate_id
   limit 1;
  if candidate is null then return null; end if;

  select coalesce(array_agg(distinct lower(btrim(value))) filter (
    where value is not null and btrim(value) <> ''
  ), array[]::text[])
    into tokens
    from unnest(array[
      candidate->>'id', candidate->>'name', candidate->>'email', candidate->>'phone',
      candidate->>'linkedinUrl', candidate->>'githubUrl', candidate->>'sourceUrl',
      candidate->>'sourceExternalId', candidate->>'sourceAuthorityId'
    ]) value;
  select coalesce(array_agg(distinct lower(btrim(value))) filter (
    where value is not null and btrim(value) <> ''
  ), array[]::text[])
    into identities
    from unnest(array[
      candidate->>'email', candidate->>'phone', candidate->>'linkedinUrl',
      candidate->>'githubUrl', candidate->>'sourceUrl'
    ]) value;

  select coalesce(array_agg(distinct value), array[]::text[]) into related_ids
  from (
    select entry.value->>'id' as value
      from jsonb_array_elements(coalesce(p_state->'outreach', '[]'::jsonb)) entry(value)
     where entry.value->>'candidateId' = p_candidate_id
    union all
    select entry.value->>'id'
      from jsonb_array_elements(coalesce(p_state->'replies', '[]'::jsonb)) entry(value)
     where entry.value->>'candidateId' = p_candidate_id
    union all
    select entry.value->>'id'
      from jsonb_array_elements(coalesce(p_state->'bookings', '[]'::jsonb)) entry(value)
     where entry.value->>'candidateId' = p_candidate_id
  ) linked where value is not null and value <> '';

  select coalesce(array_agg(distinct entry.value->>'messageId'), array[]::text[])
    into ingested_ids
    from jsonb_array_elements(coalesce(p_state->'replies', '[]'::jsonb)) entry(value)
   where entry.value->>'candidateId' = p_candidate_id
     and coalesce(entry.value->>'messageId', '') <> '';

  next_state := jsonb_set(next_state, '{candidates}', (
    select coalesce(jsonb_agg(
      case when entry.value->>'id' = p_candidate_id then
        public.candidate_erasure_tombstone_document(entry.value)
      else entry.value end order by entry.ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(p_state->'candidates') with ordinality entry(value, ordinality)
  ), false);

  next_state := jsonb_set(next_state, '{outreach}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'outreach', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where entry.value->>'candidateId' <> p_candidate_id
  ), true);
  next_state := jsonb_set(next_state, '{replies}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'replies', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where entry.value->>'candidateId' <> p_candidate_id
  ), true);
  next_state := jsonb_set(next_state, '{bookings}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'bookings', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where entry.value->>'candidateId' <> p_candidate_id
  ), true);
  next_state := jsonb_set(next_state, '{wins}', (
    select coalesce(jsonb_agg(
      case when entry.value->>'candidateId' = p_candidate_id
        then entry.value || jsonb_build_object(
          'candidateName', 'Anonymized Candidate', 'roleTitle', '', 'matchScore', 0
        )
        else entry.value end order by entry.ordinality
    ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'wins', '[]'::jsonb))
        with ordinality entry(value, ordinality)
  ), true);
  next_state := jsonb_set(next_state, '{ledger}', (
    select coalesce(jsonb_agg(
      case when entry.value->>'candidateId' = p_candidate_id
        then entry.value || jsonb_build_object('candidateEmail', '', 'reason', null)
        else entry.value end order by entry.ordinality
    ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'ledger', '[]'::jsonb))
        with ordinality entry(value, ordinality)
  ), true);
  next_state := jsonb_set(next_state, '{suppression}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'suppression', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where not (lower(btrim(coalesce(entry.value->>'value', ''))) = any(identities))
  ), true);
  next_state := jsonb_set(next_state, '{activities}', (
    select coalesce(jsonb_agg(
      case when
        (entry.value->>'linkedEntityType' = 'candidate'
          and entry.value->>'linkedEntityId' = p_candidate_id)
        or coalesce(entry.value->>'linkedEntityId', '') = any(related_ids)
        or public.candidate_erasure_contains_identity(
          concat_ws(E'\n', entry.value->>'title', entry.value->>'notes', entry.value->>'outcome'),
          tokens
        )
      then entry.value || jsonb_build_object(
        'title', 'Candidate activity redacted',
        'notes', 'Candidate-linked content was removed during erasure.',
        'outcome', 'Redacted', 'linkedEntityId', null, 'linkedEntityType', null
      ) else entry.value end order by entry.ordinality
    ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'activities', '[]'::jsonb))
        with ordinality entry(value, ordinality)
  ), true);
  next_state := jsonb_set(next_state, '{campaigns}', (
    select coalesce(jsonb_agg(
      entry.value || jsonb_build_object('activities', (
        select coalesce(jsonb_agg(
          case when
            (activity.value->>'linkedEntityType' = 'candidate'
              and activity.value->>'linkedEntityId' = p_candidate_id)
            or coalesce(activity.value->>'linkedEntityId', '') = any(related_ids)
            or public.candidate_erasure_contains_identity(
              concat_ws(E'\n', activity.value->>'title', activity.value->>'notes', activity.value->>'outcome'),
              tokens
            )
          then activity.value || jsonb_build_object(
            'title', 'Candidate activity redacted',
            'notes', 'Candidate-linked content was removed during erasure.',
            'outcome', 'Redacted', 'linkedEntityId', null, 'linkedEntityType', null
          ) else activity.value end order by activity.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(entry.value->'activities', '[]'::jsonb))
          with ordinality activity(value, ordinality)
      )) order by entry.ordinality
    ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'campaigns', '[]'::jsonb))
        with ordinality entry(value, ordinality)
  ), true);
  next_state := jsonb_set(next_state, '{chats}', (
    select coalesce(jsonb_agg(
      entry.value || jsonb_build_object(
        'title', case when public.candidate_erasure_contains_identity(entry.value->>'title', tokens)
          then 'Candidate conversation redacted' else entry.value->>'title' end,
        'messages', (
          select coalesce(jsonb_agg(
            case when public.candidate_erasure_contains_identity(message.value->>'content', tokens)
              then message.value || jsonb_build_object(
                'content', 'Candidate-linked content was removed during erasure.'
              ) else message.value end order by message.ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(coalesce(entry.value->'messages', '[]'::jsonb))
            with ordinality message(value, ordinality)
        )
      ) order by entry.ordinality
    ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'chats', '[]'::jsonb))
        with ordinality entry(value, ordinality)
  ), true);
  next_state := jsonb_set(next_state, '{ingestedMessageIds}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'ingestedMessageIds', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where trim(both '"' from entry.value::text) <> all(ingested_ids)
  ), true);
  next_state := jsonb_set(next_state, '{chatboxSubmissions}', (
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_state->'chatboxSubmissions', '[]'::jsonb))
        with ordinality entry(value, ordinality)
     where entry.value->>'handoffCandidateId' <> p_candidate_id
        or entry.value->>'handoffCandidateId' is null
  ), true);
  return next_state;
end;
$$;

revoke all on function public.scrub_candidate_workspace_document(jsonb, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_response(
  p_request_id uuid,
  p_replayed boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'status', request.status,
    'request_id', request.id,
    'campaign_id', request.campaign_id,
    'candidate_id', request.candidate_id,
    'replayed', p_replayed,
    'scrub_counts', coalesce((
      select jsonb_object_agg(receipt.store_name, receipt.scrubbed_rows order by receipt.store_name)
        from public.candidate_erasure_receipts receipt
       where receipt.request_id = request.id
    ), '{}'::jsonb),
    'obligations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', obligation.id,
        'provider', obligation.provider,
        'status', obligation.status,
        'attemptCount', obligation.attempt_count
      ) order by obligation.provider, obligation.id)
        from public.candidate_erasure_obligations obligation
       where obligation.request_id = request.id
    ), '[]'::jsonb)
  )
  from public.candidate_erasure_requests request
  where request.id = p_request_id;
$$;

revoke all on function public.candidate_erasure_response(uuid, boolean)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.refresh_candidate_erasure_legal_hold_state(
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  request_record public.candidate_erasure_requests%rowtype;
  active_hold boolean;
begin
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = p_request_id
   for update;
  if not found then return false; end if;

  update public.candidate_legal_holds hold
     set status = 'expired'
   where hold.workspace_id = request_record.workspace_id
     and hold.campaign_id = request_record.campaign_id
     and hold.candidate_id = request_record.candidate_id
     and hold.status = 'active'
     and hold.expires_at <= now();

  select exists (
    select 1 from public.candidate_legal_holds hold
     where hold.workspace_id = request_record.workspace_id
       and hold.campaign_id = request_record.campaign_id
       and hold.candidate_id = request_record.candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) into active_hold;

  if not active_hold
     and request_record.status = 'blocked_legal_hold'
     and request_record.local_scrub_completed_at is not null then
    update public.candidate_erasure_obligations obligation
       set status = 'manual_required', updated_at = now()
     where obligation.request_id = request_record.id
       and obligation.status = 'blocked_legal_hold';
    update public.candidate_erasure_requests request
       set status = 'manual_required', updated_at = now()
     where request.id = request_record.id
       and request.status = 'blocked_legal_hold';
  end if;
  return active_hold;
end;
$$;

revoke all on function public.refresh_candidate_erasure_legal_hold_state(uuid)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.list_candidate_erasure_requests(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  queued_request_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'invalid candidate erasure queue limit' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id and profile.role = 'admin'
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  for queued_request_id in
    select item.id
      from public.candidate_erasure_requests item
     where item.workspace_id = p_workspace_id
       and item.status = 'blocked_legal_hold'
     order by item.updated_at, item.id
     limit p_limit
  loop
    perform public.refresh_candidate_erasure_legal_hold_state(queued_request_id);
  end loop;
  select coalesce(jsonb_agg(
    public.candidate_erasure_response(request.id, false)
    order by request.updated_at, request.id
  ), '[]'::jsonb)
    into result
    from (
      select item.id, item.updated_at
        from public.candidate_erasure_requests item
       where item.workspace_id = p_workspace_id
         and item.status <> 'completed'
       order by item.updated_at, item.id
       limit p_limit
    ) request;
  return result;
end;
$$;

revoke all on function public.list_candidate_erasure_requests(uuid, uuid, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_candidate_erasure_requests(uuid, uuid, integer)
  to service_role;

create or replace function public.candidate_erasure_identifier_hmac(
  p_workspace_id uuid,
  p_identifier_kind text,
  p_value text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  normalized text;
begin
  if p_identifier_kind not in (
    'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
    'source_external_id', 'source_authority_id', 'provider_external_id'
  ) then
    raise exception 'invalid candidate erasure identifier kind' using errcode = '22023';
  end if;
  normalized := case
    when p_identifier_kind = 'phone' then regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
    else lower(btrim(coalesce(p_value, '')))
  end;
  if normalized = '' then return null; end if;
  return public.sourcing_authority_hmac(
    p_workspace_id,
    'candidate-erasure:' || p_identifier_kind || ':' || normalized
  );
end;
$$;

revoke all on function public.candidate_erasure_identifier_hmac(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_identity_lock_key(
  p_workspace_id uuid,
  p_identifier_kind text,
  p_value text
)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  normalized text;
begin
  if p_identifier_kind not in (
    'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
    'source_external_id', 'source_authority_id', 'provider_external_id'
  ) then
    raise exception 'invalid candidate erasure identifier kind' using errcode = '22023';
  end if;
  normalized := case
    when p_identifier_kind = 'phone' then regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
    else lower(btrim(coalesce(p_value, '')))
  end;
  if normalized = '' then return null; end if;
  return hashtextextended(
    p_workspace_id::text || ':' || p_identifier_kind || ':' || normalized,
    0
  );
end;
$$;

revoke all on function public.candidate_erasure_identity_lock_key(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_tombstone_exists(
  p_workspace_id uuid,
  p_identifier_kind text,
  p_value text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.candidate_erasure_suppression_tombstones tombstone
     where tombstone.workspace_id = p_workspace_id
       and tombstone.identifier_kind = p_identifier_kind
       and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
         p_workspace_id, p_identifier_kind, p_value
       )
  );
$$;

revoke all on function public.candidate_erasure_tombstone_exists(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_provider_for_channel(
  p_channel text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if lower(coalesce(p_channel, '')) not in ('email', 'linkedin', 'whatsapp', 'sms') then
    raise exception 'unsupported candidate erasure channel' using errcode = '22023';
  end if;
  return lower(p_channel);
end;
$$;

revoke all on function public.candidate_erasure_provider_for_channel(text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_encrypt_reference(
  p_workspace_id uuid,
  p_reference jsonb
)
returns bytea
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  encryption_key bytea;
  plaintext text;
begin
  if jsonb_typeof(p_reference) <> 'object' then
    raise exception 'invalid candidate erasure provider reference' using errcode = '22023';
  end if;
  plaintext := p_reference::text;
  if octet_length(convert_to(plaintext, 'UTF8')) not between 2 and 2048 then
    raise exception 'candidate erasure provider reference exceeds bound' using errcode = '22023';
  end if;
  select secret.hmac_key into encryption_key
    from public.sourcing_learning_secrets secret
   where secret.workspace_id = p_workspace_id;
  if encryption_key is null or octet_length(encryption_key) <> 32 then
    raise exception 'candidate erasure encryption authority unavailable' using errcode = '55000';
  end if;
  return pgp_sym_encrypt(
    plaintext,
    encode(encryption_key, 'hex'),
    'cipher-algo=aes256,compress-algo=0'
  );
end;
$$;

revoke all on function public.candidate_erasure_encrypt_reference(uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_reference_hmac(
  p_workspace_id uuid,
  p_reference jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if jsonb_typeof(p_reference) <> 'object'
     or octet_length(convert_to(p_reference::text, 'UTF8')) not between 2 and 2048 then
    raise exception 'invalid candidate erasure provider reference' using errcode = '22023';
  end if;
  return public.sourcing_authority_hmac(
    p_workspace_id,
    'candidate-erasure-provider-reference:' || p_reference::text
  );
end;
$$;

revoke all on function public.candidate_erasure_reference_hmac(uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_constant_time_hex_equal(
  p_left text,
  p_right text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  left_bytes bytea;
  right_bytes bytea;
  mismatch integer := 0;
  index integer;
begin
  if p_left !~ '^[0-9a-f]{64}$' or p_right !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  left_bytes := convert_to(p_left, 'UTF8');
  right_bytes := convert_to(p_right, 'UTF8');
  for index in 0..63 loop
    mismatch := mismatch | (get_byte(left_bytes, index) # get_byte(right_bytes, index));
  end loop;
  return mismatch = 0;
end;
$$;

revoke all on function public.candidate_erasure_constant_time_hex_equal(text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.reject_candidate_erasure_reimport()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate jsonb;
  safe_tombstone boolean;
  candidate_workspace_id uuid;
  candidate_id_value text;
  address_value text;
  identifier_kind_value text;
  identity_lock_key bigint;
begin
  if tg_table_name = 'workspace_state' then
    if jsonb_typeof(new.state->'candidates') <> 'array' then return new; end if;
    for identity_lock_key in
      select distinct public.candidate_erasure_identity_lock_key(
        new.workspace_id,
        identity.kind,
        identity.value
      ) as lock_key
        from jsonb_array_elements(new.state->'candidates') item(value)
        cross join lateral (values
          ('candidate_id', item.value->>'id'),
          ('email', item.value->>'email'),
          ('phone', item.value->>'phone'),
          ('linkedin', item.value->>'linkedinUrl'),
          ('github', item.value->>'githubUrl'),
          ('source_url', item.value->>'sourceUrl'),
          ('source_external_id', item.value->>'sourceExternalId'),
          ('source_authority_id', item.value->>'sourceAuthorityId')
        ) identity(kind, value)
       where coalesce(btrim(identity.value), '') <> ''
       order by lock_key
    loop
      perform pg_advisory_xact_lock(identity_lock_key);
    end loop;
    for candidate in select value from jsonb_array_elements(new.state->'candidates') loop
      candidate_id_value := candidate->>'id';
      safe_tombstone := candidate = public.candidate_erasure_tombstone_document(candidate);
      if public.candidate_erasure_tombstone_exists(
        new.workspace_id, 'candidate_id', candidate_id_value
      ) and not safe_tombstone then
        raise exception 'candidate erasure tombstone blocks workspace reimport'
          using errcode = '23514';
      end if;
      if (coalesce(candidate->>'email', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'email', candidate->>'email'))
         or (coalesce(candidate->>'phone', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'phone', candidate->>'phone'))
         or (coalesce(candidate->>'linkedinUrl', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'linkedin', candidate->>'linkedinUrl'))
         or (coalesce(candidate->>'githubUrl', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'github', candidate->>'githubUrl'))
         or (coalesce(candidate->>'sourceUrl', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'source_url', candidate->>'sourceUrl'))
         or (coalesce(candidate->>'sourceExternalId', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'source_external_id', candidate->>'sourceExternalId'))
         or (coalesce(candidate->>'sourceAuthorityId', '') <> '' and public.candidate_erasure_tombstone_exists(
            new.workspace_id, 'source_authority_id', candidate->>'sourceAuthorityId')) then
        raise exception 'candidate erasure tombstone blocks identifier reimport'
          using errcode = '23514';
      end if;
    end loop;
    return new;
  end if;

  candidate_workspace_id := new.workspace_id;
  candidate_id_value := null;
  address_value := null;
  identifier_kind_value := null;
  if tg_table_name = 'suppression_list' then
    address_value := new.value;
    identifier_kind_value := case new.type
      when 'email' then 'email'
      when 'phone' then 'phone'
      when 'linkedin' then 'linkedin'
      else null
    end;
  elsif tg_table_name in ('whatsapp_contacts', 'whatsapp_conversation_windows') then
    address_value := new.recipient_e164;
    identifier_kind_value := 'phone';
  elsif tg_table_name = 'agent_conversations' then
    candidate_id_value := new.candidate_id;
  else
    candidate_id_value := new.candidate_id;
    if tg_table_name = 'messages_outbound' then
      address_value := coalesce(new.recipient_e164, new.to_address);
    elsif tg_table_name = 'messages_inbound' then
      address_value := new.from_address;
    else
      address_value := new.candidate_email;
    end if;
  end if;
  for identity_lock_key in
    select distinct public.candidate_erasure_identity_lock_key(
      candidate_workspace_id,
      identity.kind,
      identity.value
    ) as lock_key
      from (
        select 'candidate_id'::text as kind, candidate_id_value as value
        union all
        select identifier_kind_value, address_value
         where identifier_kind_value is not null
        union all
        select 'email', address_value
         where identifier_kind_value is null
        union all
        select 'phone', address_value
         where identifier_kind_value is null
      ) identity
     where coalesce(btrim(identity.value), '') <> ''
     order by lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;
  if candidate_id_value is not null
     and public.candidate_erasure_tombstone_exists(
       candidate_workspace_id, 'candidate_id', candidate_id_value
     ) then
    raise exception 'candidate erasure tombstone blocks normalized reimport'
      using errcode = '23514';
  end if;
  if coalesce(address_value, '') <> '' and (
    (identifier_kind_value is not null and public.candidate_erasure_tombstone_exists(
      candidate_workspace_id, identifier_kind_value, address_value
    ))
    or (identifier_kind_value is null and (
      public.candidate_erasure_tombstone_exists(candidate_workspace_id, 'email', address_value)
      or public.candidate_erasure_tombstone_exists(candidate_workspace_id, 'phone', address_value)
    ))
  ) then
    raise exception 'candidate erasure tombstone blocks normalized identifier reimport'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_candidate_erasure_reimport()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists workspace_state_candidate_erasure_reimport_guard on public.workspace_state;
create trigger workspace_state_candidate_erasure_reimport_guard
  before insert or update of state on public.workspace_state
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists messages_outbound_candidate_erasure_reimport_guard on public.messages_outbound;
create trigger messages_outbound_candidate_erasure_reimport_guard
  before insert or update of candidate_id, to_address, recipient_e164 on public.messages_outbound
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists messages_inbound_candidate_erasure_reimport_guard on public.messages_inbound;
create trigger messages_inbound_candidate_erasure_reimport_guard
  before insert or update of candidate_id, from_address on public.messages_inbound
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists outreach_ledger_candidate_erasure_reimport_guard on public.outreach_ledger;
create trigger outreach_ledger_candidate_erasure_reimport_guard
  before insert or update of candidate_id, candidate_email on public.outreach_ledger
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists suppression_list_candidate_erasure_reimport_guard on public.suppression_list;
create trigger suppression_list_candidate_erasure_reimport_guard
  before insert or update of type, value on public.suppression_list
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists whatsapp_contacts_candidate_erasure_reimport_guard on public.whatsapp_contacts;
create trigger whatsapp_contacts_candidate_erasure_reimport_guard
  before insert or update of recipient_e164 on public.whatsapp_contacts
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists whatsapp_windows_candidate_erasure_reimport_guard
  on public.whatsapp_conversation_windows;
create trigger whatsapp_windows_candidate_erasure_reimport_guard
  before insert or update of recipient_e164 on public.whatsapp_conversation_windows
  for each row execute function public.reject_candidate_erasure_reimport();
drop trigger if exists agent_conversations_candidate_erasure_reimport_guard
  on public.agent_conversations;
create trigger agent_conversations_candidate_erasure_reimport_guard
  before insert or update of candidate_id on public.agent_conversations
  for each row execute function public.reject_candidate_erasure_reimport();

create or replace function public.reject_candidate_erasure_apollo_reimport()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    new.workspace_id,
    'provider_external_id',
    new.provider_external_id
  ));
  if public.candidate_erasure_tombstone_exists(
    new.workspace_id,
    'provider_external_id',
    new.provider_external_id
  ) then
    raise exception 'candidate erasure tombstone blocks Apollo provider reimport'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_candidate_erasure_apollo_reimport()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists apollo_target_candidate_erasure_reimport_guard
  on public.apollo_enrichment_targets;
create trigger apollo_target_candidate_erasure_reimport_guard
  before insert or update of provider_external_id
  on public.apollo_enrichment_targets
  for each row execute function public.reject_candidate_erasure_apollo_reimport();

create or replace function public.place_candidate_legal_hold(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_reason_code text,
  p_case_reference text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  state_record public.workspace_state%rowtype;
  hold_record public.candidate_legal_holds%rowtype;
  hold_replayed boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     or (p_expires_at is not null and p_expires_at <= now()) then
    raise exception 'invalid legal hold' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  select * into state_record from public.workspace_state
   where workspace_id = p_workspace_id for share;
  if not found or not exists (
    select 1 from jsonb_array_elements(coalesce(state_record.state->'candidates', '[]'::jsonb)) item(value)
     where item.value->>'id' = p_candidate_id
       and item.value->>'campaignId' = p_campaign_id
  ) then return jsonb_build_object('status', 'not_found'); end if;
  update public.candidate_legal_holds
     set status = 'expired'
   where workspace_id = p_workspace_id
     and campaign_id = p_campaign_id
     and candidate_id = p_candidate_id
     and status = 'active'
     and expires_at <= now();
  insert into public.candidate_legal_holds(
    workspace_id, campaign_id, candidate_id, reason_code, case_reference,
    placed_by, expires_at
  ) values (
    p_workspace_id, p_campaign_id, p_candidate_id, p_reason_code,
    p_case_reference, p_actor_id, p_expires_at
  )
  on conflict (workspace_id, campaign_id, candidate_id) where status = 'active'
  do nothing
  returning * into hold_record;
  if hold_record.id is null then
    select * into hold_record
      from public.candidate_legal_holds hold
     where hold.workspace_id = p_workspace_id
       and hold.campaign_id = p_campaign_id
       and hold.candidate_id = p_candidate_id
       and hold.status = 'active'
     for update;
    if hold_record.reason_code <> p_reason_code
       or hold_record.case_reference <> p_case_reference
       or hold_record.placed_by <> p_actor_id
       or hold_record.expires_at is distinct from p_expires_at then
      return jsonb_build_object(
        'status', 'conflict', 'hold_id', hold_record.id, 'replayed', false
      );
    end if;
    hold_replayed := true;
  end if;

  update public.candidate_erasure_requests request
     set status = 'blocked_legal_hold', updated_at = now()
   where request.workspace_id = p_workspace_id
     and request.campaign_id = p_campaign_id
     and request.candidate_id = p_candidate_id
     and request.status <> 'completed';
  update public.candidate_erasure_obligations obligation
     set status = 'blocked_legal_hold',
         last_error_code = null,
         next_attempt_at = null,
         updated_at = now()
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
     and request.workspace_id = p_workspace_id
     and request.campaign_id = p_campaign_id
     and request.candidate_id = p_candidate_id
     and obligation.status <> 'completed';
  return jsonb_build_object(
    'status', 'active', 'hold_id', hold_record.id,
    'expires_at', hold_record.expires_at, 'replayed', hold_replayed
  );
end;
$$;

revoke all on function public.place_candidate_legal_hold(uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.place_candidate_legal_hold(uuid, uuid, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.release_candidate_legal_hold(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_hold_id uuid,
  p_case_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  hold_record public.candidate_legal_holds%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$' then
    raise exception 'invalid legal hold release' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  select * into hold_record from public.candidate_legal_holds hold
   where hold.id = p_hold_id and hold.workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if hold_record.status = 'released' then
    if hold_record.released_by <> p_actor_id
       or hold_record.release_case_reference <> p_case_reference then
      return jsonb_build_object(
        'status', 'conflict', 'hold_id', hold_record.id, 'replayed', false
      );
    end if;
    return jsonb_build_object('status', 'released', 'hold_id', hold_record.id, 'replayed', true);
  end if;
  if hold_record.status = 'expired' then
    return jsonb_build_object(
      'status', 'conflict', 'hold_id', hold_record.id, 'replayed', false
    );
  end if;
  update public.candidate_legal_holds
     set status = 'released', released_by = p_actor_id, released_at = now(),
         release_case_reference = p_case_reference
   where id = hold_record.id;
  update public.candidate_erasure_obligations obligation
     set status = 'manual_required', updated_at = now()
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
     and request.workspace_id = hold_record.workspace_id
     and request.campaign_id = hold_record.campaign_id
     and request.candidate_id = hold_record.candidate_id
     and obligation.status = 'blocked_legal_hold';
  update public.candidate_erasure_requests request
     set status = 'manual_required', updated_at = now()
   where request.workspace_id = hold_record.workspace_id
     and request.campaign_id = hold_record.campaign_id
     and request.candidate_id = hold_record.candidate_id
     and request.status = 'blocked_legal_hold'
     and request.local_scrub_completed_at is not null;
  return jsonb_build_object('status', 'released', 'hold_id', hold_record.id, 'replayed', false);
end;
$$;

revoke all on function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.release_candidate_legal_hold(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.request_candidate_erasure(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  workspace_record public.workspace_state%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  candidate jsonb;
  scrubbed_state jsonb;
  identities text[] := array[]::text[];
  phones text[] := array[]::text[];
  outbound_ids uuid[] := array[]::uuid[];
  approval_ids text[] := array[]::text[];
  content_hashes text[] := array[]::text[];
  conversation_ids uuid[] := array[]::uuid[];
  affected_run_ids uuid[] := array[]::uuid[];
  source_provider text;
  source_reference text;
  source_reference_payload jsonb;
  target_record record;
  apollo_result jsonb;
  obligation_count integer := 0;
  workspace_state_count integer := 0;
  outbound_count integer := 0;
  inbound_count integer := 0;
  conversation_count integer := 0;
  ledger_count integer := 0;
  approval_count integer := 0;
  suppression_count integer := 0;
  contact_count integer := 0;
  window_count integer := 0;
  delivery_count integer := 0;
  cache_count integer := 0;
  apollo_count integer := 0;
  run_count integer := 0;
  event_count integer := 0;
  framework_result_count integer := 0;
  final_status text;
  legal_hold_active boolean := false;
  identity_lock_key bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_request_key is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate erasure request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select * into request_record
    from public.candidate_erasure_requests request
   where request.workspace_id = p_workspace_id
     and request.request_key = p_request_key
   for update;
  if found then
    if request_record.actor_id <> p_actor_id
       or request_record.campaign_id <> p_campaign_id
       or request_record.candidate_id <> p_candidate_id then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    legal_hold_active := public.refresh_candidate_erasure_legal_hold_state(request_record.id);
    select * into request_record
      from public.candidate_erasure_requests request
     where request.id = request_record.id
     for update;
    if request_record.status <> 'blocked_legal_hold' or legal_hold_active then
      return public.candidate_erasure_response(request_record.id, true);
    end if;
  end if;

  select * into workspace_record
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for update;
  if not found or jsonb_typeof(workspace_record.state->'candidates') <> 'array' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select item.value into candidate
    from jsonb_array_elements(workspace_record.state->'candidates') item(value)
   where item.value->>'id' = p_candidate_id
     and item.value->>'campaignId' = p_campaign_id
   limit 1;
  if candidate is null then return jsonb_build_object('status', 'not_found'); end if;

  if request_record.id is null then
    select * into request_record
      from public.candidate_erasure_requests request
     where request.workspace_id = p_workspace_id
       and request.campaign_id = p_campaign_id
       and request.candidate_id = p_candidate_id
     for update;
    if found then
      legal_hold_active := public.refresh_candidate_erasure_legal_hold_state(request_record.id);
      select * into request_record
        from public.candidate_erasure_requests request
       where request.id = request_record.id
       for update;
      if request_record.status <> 'blocked_legal_hold' or legal_hold_active then
        return public.candidate_erasure_response(request_record.id, true);
      end if;
    end if;
  end if;

  if exists (
    select 1 from public.candidate_legal_holds hold
     where hold.workspace_id = p_workspace_id
       and hold.campaign_id = p_campaign_id
       and hold.candidate_id = p_candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) then
    if request_record.id is null then
      insert into public.candidate_erasure_requests(
        workspace_id, campaign_id, candidate_id, actor_id, request_key, status
      ) values (
        p_workspace_id, p_campaign_id, p_candidate_id, p_actor_id,
        p_request_key, 'blocked_legal_hold'
      ) returning * into request_record;
    end if;
    return public.candidate_erasure_response(request_record.id, request_record.request_key <> p_request_key);
  end if;

  for identity_lock_key in
    select distinct identity.lock_key
      from (
        select public.candidate_erasure_identity_lock_key(
          p_workspace_id,
          identifier.kind,
          identifier.value
        ) as lock_key
          from (values
            ('candidate_id', p_candidate_id),
            ('email', candidate->>'email'),
            ('phone', candidate->>'phone'),
            ('linkedin', candidate->>'linkedinUrl'),
            ('github', candidate->>'githubUrl'),
            ('source_url', candidate->>'sourceUrl'),
            ('source_external_id', candidate->>'sourceExternalId'),
            ('source_authority_id', candidate->>'sourceAuthorityId')
          ) identifier(kind, value)
        union all
        select public.candidate_erasure_identity_lock_key(
          p_workspace_id,
          'provider_external_id',
          target.provider_external_id
        )
          from public.apollo_enrichment_targets target
         where p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           and target.workspace_id = p_workspace_id
           and target.campaign_id = p_campaign_id
           and target.candidate_id = p_candidate_id::uuid
           and target.erased_at is null
      ) identity
     where identity.lock_key is not null
     order by identity.lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;

  if request_record.id is null then
    insert into public.candidate_erasure_requests(
      workspace_id, campaign_id, candidate_id, actor_id, request_key, status,
      local_scrub_completed_at
    ) values (
      p_workspace_id, p_campaign_id, p_candidate_id, p_actor_id,
      p_request_key, 'pending_provider', now()
    ) returning * into request_record;
  else
    update public.candidate_erasure_requests
       set status = 'pending_provider',
           local_scrub_completed_at = now(),
           updated_at = now()
     where id = request_record.id
     returning * into request_record;
  end if;

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (p_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;
  insert into public.candidate_erasure_suppression_tombstones(
    request_id, workspace_id, identifier_kind, identifier_hmac
  )
  select request_record.id, p_workspace_id, identifier.kind,
         public.candidate_erasure_identifier_hmac(
           p_workspace_id, identifier.kind, identifier.value
         )
    from (values
      ('candidate_id', p_candidate_id),
      ('email', candidate->>'email'),
      ('phone', candidate->>'phone'),
      ('linkedin', candidate->>'linkedinUrl'),
      ('github', candidate->>'githubUrl'),
      ('source_url', candidate->>'sourceUrl'),
      ('source_external_id', candidate->>'sourceExternalId'),
      ('source_authority_id', candidate->>'sourceAuthorityId')
    ) identifier(kind, value)
   where coalesce(btrim(identifier.value), '') <> ''
  on conflict (workspace_id, identifier_kind, identifier_hmac) do nothing;
  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    insert into public.candidate_erasure_suppression_tombstones(
      request_id, workspace_id, identifier_kind, identifier_hmac
    )
    select request_record.id, p_workspace_id, 'provider_external_id',
           public.candidate_erasure_identifier_hmac(
             p_workspace_id, 'provider_external_id', target.provider_external_id
           )
      from public.apollo_enrichment_targets target
     where target.workspace_id = p_workspace_id
       and target.campaign_id = p_campaign_id
       and target.candidate_id = p_candidate_id::uuid
       and target.erased_at is null
    on conflict (workspace_id, identifier_kind, identifier_hmac) do nothing;
  end if;

  select coalesce(array_agg(distinct lower(btrim(value))) filter (
    where value is not null and btrim(value) <> ''
  ), array[]::text[])
    into identities
    from unnest(array[
      candidate->>'email', candidate->>'phone', candidate->>'linkedinUrl',
      candidate->>'githubUrl', candidate->>'sourceUrl'
    ]) value;

  select coalesce(array_agg(distinct normalized) filter (
    where length(normalized) between 8 and 15
  ), array[]::text[])
    into phones
    from (
      select regexp_replace(coalesce(candidate->>'phone', ''), '[^0-9]', '', 'g') normalized
      union all
      select regexp_replace(coalesce(message.recipient_e164, message.to_address), '[^0-9]', '', 'g')
        from public.messages_outbound message
       where message.workspace_id = p_workspace_id
         and message.candidate_id = p_candidate_id
      union all
      select regexp_replace(message.from_address, '[^0-9]', '', 'g')
        from public.messages_inbound message
       where message.workspace_id = p_workspace_id
         and (
           message.candidate_id = p_candidate_id
           or lower(btrim(message.from_address)) = any(identities)
           or regexp_replace(message.from_address, '[^0-9]', '', 'g')
             = regexp_replace(coalesce(candidate->>'phone', ''), '[^0-9]', '', 'g')
         )
    ) candidate_phones;
  identities := identities || phones;

  select coalesce(array_agg(message.id), array[]::uuid[]),
         coalesce(array_agg(distinct coalesce(message.approval_message_id, message.id::text)), array[]::text[]),
         coalesce(array_agg(distinct message.content_hash) filter (where message.content_hash is not null), array[]::text[])
    into outbound_ids, approval_ids, content_hashes
    from public.messages_outbound message
   where message.workspace_id = p_workspace_id
     and message.candidate_id = p_candidate_id;
  select coalesce(array_agg(conversation.id), array[]::uuid[])
    into conversation_ids
    from public.agent_conversations conversation
   where conversation.workspace_id = p_workspace_id
     and conversation.candidate_id = p_candidate_id;

  source_provider := regexp_replace(lower(coalesce(candidate->>'sourcePlatform', '')), '[^a-z0-9._:-]', '', 'g');
  source_reference := coalesce(
    nullif(candidate->>'sourceExternalId', ''), nullif(candidate->>'sourceAuthorityId', ''),
    nullif(candidate->>'sourceUrl', ''), p_candidate_id
  );
  if source_provider <> '' and source_provider not in ('manual', 'applicant', 'referral') then
    source_reference_payload := jsonb_strip_nulls(jsonb_build_object(
      'kind', 'source_record',
      'provider', source_provider,
      'campaignId', p_campaign_id,
      'externalId', nullif(candidate->>'sourceExternalId', ''),
      'authorityId', nullif(candidate->>'sourceAuthorityId', ''),
      'sourceUrl', nullif(candidate->>'sourceUrl', ''),
      'lookupEmail', case when source_reference = p_candidate_id
        then nullif(candidate->>'email', '') else null end,
      'lookupName', case when source_reference = p_candidate_id
        then nullif(candidate->>'name', '') else null end
    ));
    insert into public.candidate_erasure_obligations(
      request_id, workspace_id, provider, reference_hmac,
      reference_ciphertext, status
    ) values (
      request_record.id, p_workspace_id, source_provider,
      public.candidate_erasure_reference_hmac(p_workspace_id, source_reference_payload),
      public.candidate_erasure_encrypt_reference(
        p_workspace_id,
        source_reference_payload
      ),
      'manual_required'
    ) on conflict do nothing;
  end if;
  insert into public.candidate_erasure_obligations(
    request_id, workspace_id, provider, reference_hmac,
    reference_ciphertext, status
  )
  select request_record.id, p_workspace_id,
         public.candidate_erasure_provider_for_channel(message.channel),
         public.candidate_erasure_reference_hmac(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'outbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_message_id
           )
         ),
         public.candidate_erasure_encrypt_reference(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'outbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_message_id
           )
         ),
         'manual_required'
    from public.messages_outbound message
   where message.workspace_id = p_workspace_id
     and message.candidate_id = p_candidate_id
     and message.provider_message_id is not null
  on conflict do nothing;
  insert into public.candidate_erasure_obligations(
    request_id, workspace_id, provider, reference_hmac,
    reference_ciphertext, status
  )
  select request_record.id, p_workspace_id,
         public.candidate_erasure_provider_for_channel(message.channel),
         public.candidate_erasure_reference_hmac(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'inbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_id
           )
         ),
         public.candidate_erasure_encrypt_reference(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'inbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_id
           )
         ),
         'manual_required'
    from public.messages_inbound message
   where message.workspace_id = p_workspace_id
     and (
       message.candidate_id = p_candidate_id
       or message.conversation_id = any(conversation_ids)
       or lower(btrim(message.from_address)) = any(identities)
       or regexp_replace(message.from_address, '[^0-9]', '', 'g') = any(phones)
     )
     and message.provider_id is not null
  on conflict do nothing;
  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    insert into public.candidate_erasure_obligations(
      request_id, workspace_id, provider, reference_hmac,
      reference_ciphertext, status
    )
    select request_record.id, p_workspace_id, 'apollo',
           public.candidate_erasure_reference_hmac(
             p_workspace_id,
             jsonb_build_object(
               'kind', 'apollo_profile',
               'targetId', target.id,
               'campaignId', target.campaign_id,
               'providerExternalId', target.provider_external_id
             )
           ),
           public.candidate_erasure_encrypt_reference(
             p_workspace_id,
             jsonb_build_object(
               'kind', 'apollo_profile',
               'targetId', target.id,
               'campaignId', target.campaign_id,
               'providerExternalId', target.provider_external_id
             )
           ),
           'manual_required'
      from public.apollo_enrichment_targets target
     where target.workspace_id = p_workspace_id
       and target.campaign_id = p_campaign_id
       and target.candidate_id = p_candidate_id::uuid
    on conflict do nothing;
  end if;

  delete from public.whatsapp_delivery_events delivery
   where delivery.workspace_id = p_workspace_id
     and delivery.outbound_message_id = any(outbound_ids);
  get diagnostics delivery_count = row_count;
  delete from public.outreach_approvals approval
   where approval.workspace_id = p_workspace_id
     and approval.message_id = any(approval_ids);
  get diagnostics approval_count = row_count;
  delete from public.outbound_content_cache cache
   where cache.workspace_id = p_workspace_id
     and cache.content_hash = any(content_hashes);
  get diagnostics cache_count = row_count;

  update public.messages_inbound message
     set candidate_id = null,
         from_address = '',
         body = 'Candidate data erased',
         provider_id = null,
         last_processing_error = null,
         conversation_id = null,
         owner_id = null
   where message.workspace_id = p_workspace_id
     and (
       message.candidate_id = p_candidate_id
       or message.conversation_id = any(conversation_ids)
       or lower(btrim(message.from_address)) = any(identities)
       or regexp_replace(message.from_address, '[^0-9]', '', 'g') = any(phones)
     );
  get diagnostics inbound_count = row_count;
  update public.messages_outbound message
     set candidate_id = 'erased:' || request_record.id::text || ':' || message.id::text,
         to_address = '',
         recipient_e164 = null,
         subject = '',
         body = 'Candidate data erased',
         gate_result = jsonb_build_object('redacted', true),
         dedupe_hash = encode(digest(convert_to(
           'erased:' || request_record.id::text || ':' || message.id::text,
           'UTF8'
         ), 'sha256'), 'hex'),
         template_parameters = '[]'::jsonb,
         policy_snapshot = null,
         provider_message_id = null,
         delivery_attempt_id = null,
         content_hash = null
   where message.workspace_id = p_workspace_id
     and message.id = any(outbound_ids);
  get diagnostics outbound_count = row_count;
  update public.agent_conversations conversation
     set candidate_id = 'erased:' || request_record.id::text || ':' || conversation.id::text,
         provider_thread_key = 'erased:' || request_record.id::text || ':' || conversation.id::text
   where conversation.workspace_id = p_workspace_id
     and conversation.id = any(conversation_ids);
  get diagnostics conversation_count = row_count;
  update public.outreach_ledger ledger
     set candidate_id = 'erased:' || request_record.id::text || ':' || ledger.id::text,
         candidate_email = '',
         reason = null,
         email_unsubscribe_token_hash = null
   where ledger.workspace_id = p_workspace_id
     and ledger.candidate_id = p_candidate_id;
  get diagnostics ledger_count = row_count;
  delete from public.suppression_list suppression
   where suppression.workspace_id = p_workspace_id
     and lower(btrim(suppression.value)) = any(identities);
  get diagnostics suppression_count = row_count;
  delete from public.whatsapp_conversation_windows conversation_window
   where conversation_window.workspace_id = p_workspace_id
     and conversation_window.recipient_e164 = any(phones);
  get diagnostics window_count = row_count;
  delete from public.whatsapp_contacts contact
   where contact.workspace_id = p_workspace_id
     and contact.recipient_e164 = any(phones);
  get diagnostics contact_count = row_count;

  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    for target_record in
      select target.id, target.erased_at
        from public.apollo_enrichment_targets target
       where target.workspace_id = p_workspace_id
         and target.campaign_id = p_campaign_id
         and target.candidate_id = p_candidate_id::uuid
       for update
    loop
      apollo_count := apollo_count + 1;
      if target_record.erased_at is null then
        apollo_result := public.erase_apollo_enrichment_target(
          p_workspace_id, p_actor_id, p_campaign_id, p_candidate_id::uuid,
          target_record.id, 'erasure:' || request_record.id::text,
          request_record.id::text
        );
        if apollo_result->>'status' not in ('erased', 'already_erased') then
          raise exception 'Apollo local erasure failed' using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  select coalesce(array_agg(run.id), array[]::uuid[])
    into affected_run_ids
    from public.agent_runs run
   where run.workspace_id = p_workspace_id
     and run.state_json::text like '%' || to_jsonb(p_candidate_id)::text || '%';
  update public.agent_runs run
     set state_json = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure'),
         status = case when run.status in ('running', 'awaiting_gate') then 'failed' else run.status end,
         finished_at = case when run.status in ('running', 'awaiting_gate')
           then coalesce(run.finished_at, now()) else run.finished_at end
   where run.workspace_id = p_workspace_id
     and run.id = any(affected_run_ids);
  get diagnostics run_count = row_count;
  update public.agent_events event
     set payload = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure')
   where event.workspace_id = p_workspace_id
     and (
       event.run_id = any(affected_run_ids)
       or event.payload::text like '%' || to_jsonb(p_candidate_id)::text || '%'
     );
  get diagnostics event_count = row_count;
  update public.agent_framework_sourcing_authorizations sourcing_authorization
     set result_payload = jsonb_set(
       sourcing_authorization.result_payload,
       '{candidates}',
       coalesce((
         select jsonb_agg(item.value order by item.ordinality)
           from jsonb_array_elements(sourcing_authorization.result_payload->'candidates')
             with ordinality item(value, ordinality)
          where item.value->>'id' <> p_candidate_id
       ), '[]'::jsonb),
       false
     )
   where sourcing_authorization.workspace_id = p_workspace_id
     and sourcing_authorization.result_payload is not null
     and jsonb_typeof(sourcing_authorization.result_payload->'candidates') = 'array'
     and exists (
       select 1 from jsonb_array_elements(sourcing_authorization.result_payload->'candidates') item(value)
        where item.value->>'id' = p_candidate_id
     );
  get diagnostics framework_result_count = row_count;

  scrubbed_state := public.scrub_candidate_workspace_document(
    workspace_record.state, p_candidate_id
  );
  if scrubbed_state is null then
    raise exception 'candidate workspace scrub failed' using errcode = 'P0001';
  end if;
  update public.workspace_state
     set state = scrubbed_state
   where workspace_id = p_workspace_id;
  get diagnostics workspace_state_count = row_count;
  if workspace_state_count <> 1 then
    raise exception 'candidate workspace scrub changed concurrently' using errcode = '40001';
  end if;

  insert into public.candidate_erasure_receipts(request_id, workspace_id, store_name, scrubbed_rows)
  values
    (request_record.id, p_workspace_id, 'workspace_state', workspace_state_count),
    (request_record.id, p_workspace_id, 'messages_outbound', outbound_count),
    (request_record.id, p_workspace_id, 'messages_inbound', inbound_count),
    (request_record.id, p_workspace_id, 'agent_conversations', conversation_count),
    (request_record.id, p_workspace_id, 'outreach_ledger', ledger_count),
    (request_record.id, p_workspace_id, 'outreach_approvals', approval_count),
    (request_record.id, p_workspace_id, 'suppression_list', suppression_count),
    (request_record.id, p_workspace_id, 'whatsapp_contacts', contact_count),
    (request_record.id, p_workspace_id, 'whatsapp_conversation_windows', window_count),
    (request_record.id, p_workspace_id, 'whatsapp_delivery_events', delivery_count),
    (request_record.id, p_workspace_id, 'outbound_content_cache', cache_count),
    (request_record.id, p_workspace_id, 'apollo_enrichment', apollo_count),
    (request_record.id, p_workspace_id, 'agent_runs', run_count),
    (request_record.id, p_workspace_id, 'agent_events', event_count),
    (request_record.id, p_workspace_id, 'agent_framework_results', framework_result_count)
  on conflict (request_id, store_name) do nothing;

  select count(*) into obligation_count
    from public.candidate_erasure_obligations obligation
   where obligation.request_id = request_record.id
     and obligation.status <> 'completed';
  final_status := case when obligation_count = 0 then 'completed' else 'manual_required' end;
  update public.candidate_erasure_requests
     set status = final_status,
         provider_completed_at = case when final_status = 'completed' then now() else null end,
         updated_at = now()
   where id = request_record.id;
  return public.candidate_erasure_response(request_record.id, false);
end;
$$;

revoke all on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  to service_role;

create or replace function public.read_candidate_erasure_obligation_authority(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_obligation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  obligation public.candidate_erasure_obligations%rowtype;
  encryption_key bytea;
  plaintext text;
  provider_reference jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform public.refresh_candidate_erasure_legal_hold_state(obligation.request_id);
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  if obligation.status = 'completed' or obligation.reference_ciphertext is null then
    return jsonb_build_object(
      'status', 'completed', 'obligation_id', obligation.id,
      'provider', obligation.provider, 'attempt_count', obligation.attempt_count
    );
  end if;
  if exists (
    select 1
      from public.candidate_erasure_requests request
      join public.candidate_legal_holds hold
        on hold.workspace_id = request.workspace_id
       and hold.campaign_id = request.campaign_id
       and hold.candidate_id = request.candidate_id
     where request.id = obligation.request_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) then
    return jsonb_build_object(
      'status', 'blocked_legal_hold', 'obligation_id', obligation.id,
      'provider', obligation.provider, 'attempt_count', obligation.attempt_count
    );
  end if;
  if obligation.authority_access_count >= 1000 then
    raise exception 'candidate erasure authority access limit reached' using errcode = '54000';
  end if;
  select secret.hmac_key into encryption_key
    from public.sourcing_learning_secrets secret
   where secret.workspace_id = p_workspace_id;
  if encryption_key is null or octet_length(encryption_key) <> 32 then
    raise exception 'candidate erasure decryption authority unavailable' using errcode = '55000';
  end if;
  begin
    plaintext := pgp_sym_decrypt(
      obligation.reference_ciphertext,
      encode(encryption_key, 'hex'),
      'cipher-algo=aes256,compress-algo=0'
    );
    provider_reference := plaintext::jsonb;
  exception when others then
    raise exception 'candidate erasure provider reference is unreadable' using errcode = '55000';
  end;
  if jsonb_typeof(provider_reference) <> 'object'
     or octet_length(convert_to(provider_reference::text, 'UTF8')) > 2048 then
    raise exception 'candidate erasure provider reference is invalid' using errcode = '55000';
  end if;
  if not public.candidate_erasure_constant_time_hex_equal(
    obligation.reference_hmac,
    public.candidate_erasure_reference_hmac(p_workspace_id, provider_reference)
  ) then
    raise exception 'candidate erasure provider reference integrity failure' using errcode = '55000';
  end if;
  update public.candidate_erasure_obligations
     set authority_access_count = authority_access_count + 1,
         authority_last_accessed_at = now(),
         authority_last_accessed_by = p_actor_id,
         updated_at = now()
   where id = obligation.id;
  return jsonb_build_object(
    'status', obligation.status,
    'obligation_id', obligation.id,
    'provider', obligation.provider,
    'attempt_count', obligation.attempt_count,
    'reference', provider_reference
  );
end;
$$;

revoke all on function public.read_candidate_erasure_obligation_authority(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.read_candidate_erasure_obligation_authority(uuid, uuid, uuid)
  to service_role;

drop function if exists public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text
);
create or replace function public.reconcile_candidate_erasure_obligation(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_obligation_id uuid,
  p_expected_attempt_count integer,
  p_status text,
  p_error_code text default null,
  p_evidence_sha256 text default null,
  p_case_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  obligation public.candidate_erasure_obligations%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  next_attempt_count integer;
  request_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_expected_attempt_count is null or p_expected_attempt_count < 0
     or p_status not in ('pending_provider', 'retryable_failure', 'completed')
     or (p_status = 'retryable_failure' and (
       p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     ))
     or (p_status <> 'retryable_failure' and p_error_code is not null)
     or (p_status = 'completed' and (
       p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
       or p_case_reference is null
       or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     ))
     or (p_status <> 'completed' and (
       p_evidence_sha256 is not null or p_case_reference is not null
     )) then
    raise exception 'invalid obligation transition' using errcode = '22023';
  end if;
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
   for update;
  perform public.refresh_candidate_erasure_legal_hold_state(request_record.id);
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
   for update;
  if obligation.status <> 'completed' and exists (
    select 1 from public.candidate_legal_holds hold
     where hold.workspace_id = request_record.workspace_id
       and hold.campaign_id = request_record.campaign_id
       and hold.candidate_id = request_record.candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) then
    return jsonb_build_object(
      'status', 'blocked_legal_hold', 'obligation_id', obligation.id,
      'attempt_count', obligation.attempt_count
    );
  end if;
  if obligation.status = 'completed' then
    if p_status <> 'completed'
       or obligation.completed_by <> p_actor_id
       or obligation.completion_evidence_sha256 <> p_evidence_sha256
       or obligation.completion_case_reference <> p_case_reference
       or p_expected_attempt_count not in (
         obligation.attempt_count,
         greatest(obligation.attempt_count - 1, 0)
       ) then
      return jsonb_build_object(
        'status', 'conflict', 'attempt_count', obligation.attempt_count
      );
    end if;
    return public.candidate_erasure_response(obligation.request_id, true);
  end if;
  if obligation.attempt_count <> p_expected_attempt_count then
    return jsonb_build_object(
      'status', 'conflict', 'attempt_count', obligation.attempt_count
    );
  end if;
  if obligation.status = 'manual_required' and p_status <> 'completed' then
    return jsonb_build_object('status', 'invalid_transition');
  end if;
  next_attempt_count := obligation.attempt_count + 1;
  update public.candidate_erasure_obligations
     set status = p_status,
         attempt_count = next_attempt_count,
         last_error_code = p_error_code,
         next_attempt_at = case when p_status = 'retryable_failure'
           then now() + interval '15 minutes' else null end,
         completed_at = case when p_status = 'completed' then now() else null end,
         completion_evidence_sha256 = case when p_status = 'completed'
           then p_evidence_sha256 else null end,
         completion_case_reference = case when p_status = 'completed'
           then p_case_reference else null end,
         completed_by = case when p_status = 'completed' then p_actor_id else null end,
         reference_ciphertext = case when p_status = 'completed'
           then null else reference_ciphertext end,
         updated_at = now()
   where id = obligation.id;

  select case
    when bool_and(item.status = 'completed') then 'completed'
    when bool_or(item.status = 'manual_required') then 'manual_required'
    when bool_or(item.status = 'retryable_failure') then 'retryable_failure'
    else 'pending_provider'
  end into request_status
    from public.candidate_erasure_obligations item
   where item.request_id = request_record.id;
  update public.candidate_erasure_requests
     set status = request_status,
         provider_completed_at = case when request_status = 'completed' then now() else null end,
         updated_at = now()
   where id = request_record.id;
  return public.candidate_erasure_response(request_record.id, false);
end;
$$;

revoke all on function public.reconcile_candidate_erasure_obligation(uuid, uuid, uuid, integer, text, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reconcile_candidate_erasure_obligation(uuid, uuid, uuid, integer, text, text, text, text)
  to service_role;
