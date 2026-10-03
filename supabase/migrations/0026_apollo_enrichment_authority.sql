-- Paid Apollo enrichment authority.
--
-- Raw Apollo person ids, confirmation nonces, spend claims, and terminal
-- receipts are normalized server authority. The operator-editable
-- workspace_state document may mirror a result but can never authorize a paid
-- provider call.

create table if not exists public.apollo_enrichment_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  candidate_id uuid not null default gen_random_uuid(),
  provider_external_id text not null check (length(provider_external_id) between 1 and 200),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  erased_at timestamptz,
  erased_by uuid references auth.users(id) on delete restrict,
  erasure_reference text
    check (erasure_reference is null or erasure_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'),
  erasure_request_id text
    check (erasure_request_id is null or erasure_request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  selected_at timestamptz,
  constraint apollo_enrich_target_campaign_provider_uniq
    unique (workspace_id, campaign_id, provider_external_id),
  constraint apollo_enrich_target_campaign_candidate_uniq
    unique (workspace_id, campaign_id, candidate_id)
);

create index if not exists apollo_enrichment_targets_workspace_expiry_idx
  on public.apollo_enrichment_targets (workspace_id, expires_at desc);

create table if not exists public.apollo_enrichment_confirmations (
  nonce uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.apollo_enrichment_targets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  candidate_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  scope text not null check (scope = 'email'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

create index if not exists apollo_enrichment_confirmations_lookup_idx
  on public.apollo_enrichment_confirmations
  (workspace_id, user_id, target_id, expires_at desc);

create unique index if not exists apollo_enrichment_confirmations_one_unconsumed_idx
  on public.apollo_enrichment_confirmations (workspace_id, user_id, target_id, scope)
  where consumed_at is null;

create table if not exists public.apollo_enrichment_attempts (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.apollo_enrichment_targets(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  candidate_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  scope text not null check (scope = 'email'),
  idempotency_key uuid not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'ambiguous', 'cancelled')),
  found boolean,
  email_secret text not null default '',
  phone_secret text not null default '' check (phone_secret = ''),
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  ambiguous_at timestamptz,
  cancelled_at timestamptz,
  receipt_expires_at timestamptz,
  receipt_erased_at timestamptz,
  unique (workspace_id, user_id, idempotency_key),
  constraint apollo_enrichment_attempts_state_coherence check (
    (
      status = 'in_progress'
      and found is null
      and email_secret = ''
      and completed_at is null
      and ambiguous_at is null
      and cancelled_at is null
      and receipt_expires_at is null
      and receipt_erased_at is null
    )
    or (
      status = 'ambiguous'
      and found is null
      and email_secret = ''
      and completed_at is null
      and ambiguous_at is not null
      and cancelled_at is null
      and receipt_expires_at is null
      and receipt_erased_at is null
    )
    or (
      status = 'completed'
      and found is not null
      and (
        (
          found
          and receipt_expires_at is not null
          and receipt_expires_at <= completed_at + interval '30 days'
          and (
            (email_secret <> '' and receipt_erased_at is null)
            or (email_secret = '' and receipt_erased_at is not null)
          )
        )
        or (
          not found
          and email_secret = ''
          and receipt_expires_at is null
          and receipt_erased_at is null
        )
      )
      and completed_at is not null
      and cancelled_at is null
    )
    or (
      status = 'cancelled'
      and found is null
      and email_secret = ''
      and completed_at is null
      and cancelled_at is not null
      and receipt_expires_at is null
      and receipt_erased_at is null
    )
  )
);

create index if not exists apollo_enrichment_attempts_target_idx
  on public.apollo_enrichment_attempts (workspace_id, target_id, created_at desc, id desc);

create unique index if not exists apollo_enrichment_attempts_one_unresolved_target_idx
  on public.apollo_enrichment_attempts (workspace_id, target_id)
  where status in ('in_progress', 'ambiguous');

create table if not exists public.apollo_enrichment_quota (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket_date date not null,
  scope_key text not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, bucket_date, scope_key)
);

create table if not exists public.apollo_enrichment_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attempt_id uuid not null references public.apollo_enrichment_attempts(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null
    check (action in ('quarantine_stale', 'complete_found', 'complete_not_found', 'release_no_charge')),
  from_status text not null check (from_status in ('in_progress', 'ambiguous')),
  to_status text not null check (to_status in ('ambiguous', 'completed', 'cancelled')),
  from_version bigint not null check (from_version > 0),
  to_version bigint not null check (to_version = from_version + 1),
  case_reference text not null
    check (case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  created_at timestamptz not null default now()
);

create index if not exists apollo_enrichment_reconciliation_events_attempt_idx
  on public.apollo_enrichment_reconciliation_events (workspace_id, attempt_id, created_at desc);

create table if not exists public.apollo_enrichment_erasure_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_id uuid not null,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  candidate_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  cleared_receipts integer not null check (cleared_receipts >= 0),
  cancelled_attempts integer not null check (cancelled_attempts >= 0),
  case_reference text not null
    check (case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'),
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, request_id)
);

create index if not exists apollo_enrichment_erasure_events_target_idx
  on public.apollo_enrichment_erasure_events (workspace_id, target_id, created_at desc);

alter table public.apollo_enrichment_targets enable row level security;
alter table public.apollo_enrichment_confirmations enable row level security;
alter table public.apollo_enrichment_attempts enable row level security;
alter table public.apollo_enrichment_quota enable row level security;
alter table public.apollo_enrichment_reconciliation_events enable row level security;
alter table public.apollo_enrichment_reconciliation_events force row level security;
alter table public.apollo_enrichment_erasure_events enable row level security;
alter table public.apollo_enrichment_erasure_events force row level security;

revoke all on public.apollo_enrichment_targets from anon, authenticated, service_role, public;
revoke all on public.apollo_enrichment_confirmations from anon, authenticated, service_role, public;
revoke all on public.apollo_enrichment_attempts from anon, authenticated, service_role, public;
revoke all on public.apollo_enrichment_quota from anon, authenticated, service_role, public;
revoke all on public.apollo_enrichment_reconciliation_events from anon, authenticated, service_role, public;
revoke all on public.apollo_enrichment_erasure_events from anon, authenticated, service_role, public;

drop policy if exists "Apollo reconciliation function inserts events"
  on public.apollo_enrichment_reconciliation_events;
create policy "Apollo reconciliation function inserts events"
  on public.apollo_enrichment_reconciliation_events for insert to postgres, supabase_admin
  with check (true);

drop policy if exists "Apollo erasure function inserts events"
  on public.apollo_enrichment_erasure_events;
create policy "Apollo erasure function inserts events"
  on public.apollo_enrichment_erasure_events for insert to postgres, supabase_admin
  with check (true);
drop policy if exists "Apollo erasure owners inspect events"
  on public.apollo_enrichment_erasure_events;
create policy "Apollo erasure owners inspect events"
  on public.apollo_enrichment_erasure_events for select to postgres, supabase_admin
  using (true);

create or replace function public.reject_apollo_reconciliation_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Apollo reconciliation events are append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_apollo_reconciliation_event_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists apollo_reconciliation_events_append_only
  on public.apollo_enrichment_reconciliation_events;
create trigger apollo_reconciliation_events_append_only
  before update or delete on public.apollo_enrichment_reconciliation_events
  for each row execute function public.reject_apollo_reconciliation_event_mutation();

create or replace function public.reject_apollo_erasure_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Apollo erasure events are append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_apollo_erasure_event_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists apollo_erasure_events_append_only
  on public.apollo_enrichment_erasure_events;
create trigger apollo_erasure_events_append_only
  before update or delete on public.apollo_enrichment_erasure_events
  for each row execute function public.reject_apollo_erasure_event_mutation();

create or replace function public.register_apollo_enrichment_targets(
  p_workspace_id uuid,
  p_user_id uuid,
  p_campaign_id text,
  p_profiles jsonb
)
returns table (target_id uuid, candidate_id uuid, provider_external_id text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  profile_item jsonb;
  external_id text;
  public_profile jsonb;
  resolved_id uuid;
  resolved_candidate_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_user_id is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' then
    raise exception 'invalid authority context';
  end if;
  if p_profiles is null
     or jsonb_typeof(p_profiles) <> 'array'
     or jsonb_array_length(p_profiles) not between 1 and 50 then
    raise exception 'invalid profile batch';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and workspace_id = p_workspace_id) then
    raise exception 'invalid authority context';
  end if;

  for profile_item in select value from jsonb_array_elements(p_profiles)
  loop
    external_id := nullif(btrim(profile_item ->> 'providerExternalId'), '');
    public_profile := profile_item -> 'profile';
    if external_id is null or length(external_id) not between 1 and 200 or jsonb_typeof(public_profile) <> 'object' then
      raise exception 'invalid provider profile';
    end if;

    insert into public.apollo_enrichment_targets (
      workspace_id,
      campaign_id,
      provider_external_id,
      profile_hash,
      created_by
    ) values (
      p_workspace_id,
      p_campaign_id,
      external_id,
      encode(digest(public_profile::text, 'sha256'), 'hex'),
      p_user_id
    )
    on conflict on constraint apollo_enrich_target_campaign_provider_uniq do update
      set profile_hash = excluded.profile_hash,
          last_seen_at = now(),
          expires_at = now() + interval '30 days'
    returning id, apollo_enrichment_targets.candidate_id
      into resolved_id, resolved_candidate_id;

    target_id := resolved_id;
    candidate_id := resolved_candidate_id;
    provider_external_id := external_id;
    return next;
  end loop;
end;
$$;

create or replace function public.select_apollo_enrichment_target(
  p_workspace_id uuid,
  p_user_id uuid,
  p_campaign_id text,
  p_target_id uuid,
  p_candidate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  selected_time timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and workspace_id = p_workspace_id
      and role in ('admin', 'member')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1
    from public.workspace_state as state
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(state.state -> 'candidates') = 'array'
          then state.state -> 'candidates'
        else '[]'::jsonb
      end
    ) as persisted(candidate)
    where state.workspace_id = p_workspace_id
      and persisted.candidate ->> 'id' = p_candidate_id::text
      and persisted.candidate ->> 'campaignId' = p_campaign_id
      and persisted.candidate ->> 'sourcePlatform' = 'Apollo'
      and persisted.candidate ->> 'sourceAuthorityId' = p_target_id::text
      and persisted.candidate #> '{complianceFlags,anonymized}' = 'false'::jsonb
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;


  update public.apollo_enrichment_targets
  set selected_at = coalesce(selected_at, now())
  where id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and erased_at is null
    and expires_at > now()
  returning selected_at into selected_time;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'selected',
    'ok', true,
    'selected_at', selected_time
  );
end;
$$;

create or replace function public.prepare_apollo_enrichment(
  p_workspace_id uuid,
  p_user_id uuid,
  p_campaign_id text,
  p_candidate_id uuid,
  p_target_id uuid,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  new_nonce uuid;
  nonce_expiry timestamptz;
  existing_confirmation public.apollo_enrichment_confirmations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_scope <> 'email' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and workspace_id = p_workspace_id
      and role in ('admin', 'member')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1
    from public.workspace_state as state
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(state.state -> 'candidates') = 'array'
          then state.state -> 'candidates'
        else '[]'::jsonb
      end
    ) as persisted(candidate)
    where state.workspace_id = p_workspace_id
      and persisted.candidate ->> 'id' = p_candidate_id::text
      and persisted.candidate ->> 'campaignId' = p_campaign_id
      and persisted.candidate ->> 'sourcePlatform' = 'Apollo'
      and persisted.candidate ->> 'sourceAuthorityId' = p_target_id::text
      and persisted.candidate #> '{complianceFlags,anonymized}' = 'false'::jsonb
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform 1
  from public.apollo_enrichment_targets
  where id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and selected_at is not null
    and expires_at > now()
    and erased_at is null
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into existing_confirmation
  from public.apollo_enrichment_confirmations
  where target_id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and user_id = p_user_id
    and scope = p_scope
    and consumed_at is null
  for update;
  if found and existing_confirmation.expires_at > now() then
    return jsonb_build_object(
      'status', 'prepared',
      'confirmation_nonce', existing_confirmation.nonce,
      'expires_at', existing_confirmation.expires_at
    );
  end if;
  if found then
    update public.apollo_enrichment_confirmations
    set consumed_at = now()
    where nonce = existing_confirmation.nonce;
  end if;

  insert into public.apollo_enrichment_confirmations (
    target_id,
    workspace_id,
    campaign_id,
    candidate_id,
    user_id,
    scope
  ) values (
    p_target_id,
    p_workspace_id,
    p_campaign_id,
    p_candidate_id,
    p_user_id,
    p_scope
  ) returning nonce, expires_at into new_nonce, nonce_expiry;

  return jsonb_build_object(
    'status', 'prepared',
    'confirmation_nonce', new_nonce,
    'expires_at', nonce_expiry
  );
end;
$$;

create or replace function public.claim_apollo_enrichment(
  p_workspace_id uuid,
  p_user_id uuid,
  p_campaign_id text,
  p_candidate_id uuid,
  p_target_id uuid,
  p_scope text,
  p_confirmation_nonce uuid,
  p_idempotency_key uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  target_row public.apollo_enrichment_targets%rowtype;
  confirmation_row public.apollo_enrichment_confirmations%rowtype;
  existing_attempt public.apollo_enrichment_attempts%rowtype;
  target_attempt public.apollo_enrichment_attempts%rowtype;
  claimed_attempt_id uuid;
  workspace_quota integer;
  user_quota integer;
  user_scope text := 'user:' || p_user_id::text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_scope <> 'email' then
    return jsonb_build_object('status', 'nonce_invalid');
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    return jsonb_build_object('status', 'dependency_unavailable');
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and workspace_id = p_workspace_id
      and role in ('admin', 'member')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1
    from public.workspace_state as state
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(state.state -> 'candidates') = 'array'
          then state.state -> 'candidates'
        else '[]'::jsonb
      end
    ) as persisted(candidate)
    where state.workspace_id = p_workspace_id
      and persisted.candidate ->> 'id' = p_candidate_id::text
      and persisted.candidate ->> 'campaignId' = p_campaign_id
      and persisted.candidate ->> 'sourcePlatform' = 'Apollo'
      and persisted.candidate ->> 'sourceAuthorityId' = p_target_id::text
      and persisted.candidate #> '{complianceFlags,anonymized}' = 'false'::jsonb
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;


  select * into target_row
  from public.apollo_enrichment_targets
  where id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and selected_at is not null
    and expires_at > now()
    and erased_at is null
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into existing_attempt
  from public.apollo_enrichment_attempts
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_attempt.target_id <> p_target_id
       or existing_attempt.campaign_id <> p_campaign_id
       or existing_attempt.candidate_id <> p_candidate_id
       or existing_attempt.scope <> p_scope then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    if existing_attempt.status = 'completed'
       and existing_attempt.found
       and (
         existing_attempt.receipt_erased_at is not null
         or existing_attempt.receipt_expires_at <= now()
         or existing_attempt.email_secret = ''
       ) then
      if existing_attempt.email_secret <> '' then
        update public.apollo_enrichment_attempts
        set email_secret = '',
            receipt_erased_at = coalesce(receipt_erased_at, now()),
            version = version + 1
        where id = existing_attempt.id;
      end if;
      return jsonb_build_object('status', 'not_found');
    end if;
    if existing_attempt.status = 'completed' then
      return jsonb_build_object(
        'status', 'completed',
        'found', existing_attempt.found,
        'email_secret', existing_attempt.email_secret,
        'phone_secret', existing_attempt.phone_secret
      );
    end if;
    return jsonb_build_object('status', existing_attempt.status);
  end if;

  select * into target_attempt
  from public.apollo_enrichment_attempts
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and target_id = p_target_id
  order by created_at desc, id desc
  limit 1
  for update;
  select * into confirmation_row
  from public.apollo_enrichment_confirmations
  where nonce = p_confirmation_nonce
    and target_id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
    and user_id = p_user_id
    and scope = p_scope
    and consumed_at is null
    and expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('status', 'nonce_invalid');
  end if;

  if target_attempt.id is not null then
    if target_attempt.status = 'completed' then
      if target_attempt.found
         and (
           target_attempt.receipt_erased_at is not null
           or target_attempt.receipt_expires_at <= now()
           or target_attempt.email_secret = ''
         ) then
        if target_attempt.email_secret <> '' then
          update public.apollo_enrichment_attempts
          set email_secret = '',
              receipt_erased_at = coalesce(receipt_erased_at, now()),
              version = version + 1
          where id = target_attempt.id;
        end if;
      else
        update public.apollo_enrichment_confirmations
        set consumed_at = now()
        where nonce = confirmation_row.nonce;

        insert into public.apollo_enrichment_attempts (
          target_id,
          workspace_id,
          campaign_id,
          candidate_id,
          user_id,
          scope,
          idempotency_key,
          status,
          found,
          email_secret,
          phone_secret,
          request_id,
          completed_at,
          receipt_expires_at
        ) values (
          p_target_id,
          p_workspace_id,
          p_campaign_id,
          p_candidate_id,
          p_user_id,
          p_scope,
          p_idempotency_key,
          'completed',
          target_attempt.found,
          target_attempt.email_secret,
          '',
          p_request_id,
          now(),
          target_attempt.receipt_expires_at
        );

        return jsonb_build_object(
          'status', 'completed',
          'found', target_attempt.found,
          'email_secret', target_attempt.email_secret,
          'phone_secret', ''
        );
      end if;
    end if;
    if target_attempt.status not in ('completed', 'cancelled') then
      return jsonb_build_object('status', target_attempt.status);
    end if;
  end if;

  insert into public.apollo_enrichment_quota (workspace_id, bucket_date, scope_key)
  values
    (p_workspace_id, current_date, 'workspace'),
    (p_workspace_id, current_date, user_scope)
  on conflict do nothing;

  perform 1
  from public.apollo_enrichment_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key in ('workspace', user_scope)
  order by scope_key
  for update;

  select used into workspace_quota
  from public.apollo_enrichment_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key = 'workspace';
  select used into user_quota
  from public.apollo_enrichment_quota
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key = user_scope;
  if workspace_quota >= 100 or user_quota >= 25 then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;

  update public.apollo_enrichment_confirmations
  set consumed_at = now()
  where nonce = confirmation_row.nonce;
  update public.apollo_enrichment_quota
  set used = used + 1,
      updated_at = now()
  where workspace_id = p_workspace_id
    and bucket_date = current_date
    and scope_key in ('workspace', user_scope);

  insert into public.apollo_enrichment_attempts (
    target_id,
    workspace_id,
    campaign_id,
    candidate_id,
    user_id,
    scope,
    idempotency_key,
    request_id
  ) values (
    p_target_id,
    p_workspace_id,
    p_campaign_id,
    p_candidate_id,
    p_user_id,
    p_scope,
    p_idempotency_key,
    p_request_id
  ) returning id into claimed_attempt_id;

  return jsonb_build_object(
    'status', 'claimed',
    'attempt_id', claimed_attempt_id,
    'provider_external_id', target_row.provider_external_id
  );
end;
$$;

create or replace function public.complete_apollo_enrichment(
  p_workspace_id uuid,
  p_user_id uuid,
  p_target_id uuid,
  p_attempt_id uuid,
  p_found boolean,
  p_email_secret text,
  p_phone_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_found is null
     or p_email_secret is null
     or p_phone_secret is null
     or p_phone_secret <> ''
     or length(p_email_secret) > 4096
     or (p_found and p_email_secret = '')
     or (not p_found and p_email_secret <> '') then
    return jsonb_build_object('ok', false);
  end if;
  update public.apollo_enrichment_attempts
  set status = 'completed',
      found = p_found,
      email_secret = p_email_secret,
      phone_secret = '',
      completed_at = now(),
      receipt_expires_at = case when p_found then now() + interval '30 days' else null end,
      receipt_erased_at = null,
      version = version + 1
  where id = p_attempt_id
    and target_id = p_target_id
    and workspace_id = p_workspace_id
    and user_id = p_user_id
    and status = 'in_progress';
  get diagnostics changed = row_count;
  return jsonb_build_object('ok', changed = 1);
end;
$$;

create or replace function public.mark_apollo_enrichment_ambiguous(
  p_workspace_id uuid,
  p_user_id uuid,
  p_target_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.apollo_enrichment_attempts
  set status = 'ambiguous',
      ambiguous_at = now(),
      version = version + 1
  where id = p_attempt_id
    and target_id = p_target_id
    and workspace_id = p_workspace_id
    and user_id = p_user_id
    and status = 'in_progress';
  get diagnostics changed = row_count;
  return jsonb_build_object('ok', changed = 1);
end;
$$;

create or replace function public.list_apollo_enrichment_reconciliation(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_before_created timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table (
  attempt_id uuid,
  target_id uuid,
  provider_external_id text,
  requester_id uuid,
  status text,
  version bigint,
  request_id text,
  created_at timestamptz,
  lease_expires_at timestamptz,
  ambiguous_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and workspace_id = p_workspace_id
      and role = 'admin'
  ) then
    raise exception 'admin authority required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50
     or ((p_before_created is null) <> (p_before_id is null)) then
    raise exception 'invalid reconciliation query' using errcode = '22023';
  end if;

  return query
    select
      attempt.id,
      attempt.target_id,
      target.provider_external_id,
      attempt.user_id,
      attempt.status,
      attempt.version,
      attempt.request_id,
      attempt.created_at,
      attempt.lease_expires_at,
      attempt.ambiguous_at
    from public.apollo_enrichment_attempts as attempt
    join public.apollo_enrichment_targets as target
      on target.id = attempt.target_id
     and target.workspace_id = attempt.workspace_id
    where attempt.workspace_id = p_workspace_id
      and (
        attempt.status = 'ambiguous'
        or (attempt.status = 'in_progress' and attempt.lease_expires_at <= now())
      )
      and (
        p_before_created is null
        or (attempt.created_at, attempt.id) < (p_before_created, p_before_id)
      )
    order by attempt.created_at desc, attempt.id desc
    limit p_limit;
end;
$$;

create or replace function public.reconcile_apollo_enrichment(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_attempt_id uuid,
  p_expected_version bigint,
  p_action text,
  p_email_secret text,
  p_case_reference text,
  p_evidence_sha256 text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  target_id_to_lock uuid;
  attempt public.apollo_enrichment_attempts%rowtype;
  next_status text;
  next_version bigint;
  reconciliation_event_id uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and workspace_id = p_workspace_id
      and role = 'admin'
  ) then
    raise exception 'admin authority required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1
     or p_action not in ('quarantine_stale', 'complete_found', 'complete_not_found', 'release_no_charge')
     or p_case_reference is null
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     or p_evidence_sha256 is null
     or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_email_secret is null
     or length(p_email_secret) > 4096 then
    raise exception 'invalid reconciliation request' using errcode = '22023';
  end if;

  select candidate.target_id into target_id_to_lock
  from public.apollo_enrichment_attempts as candidate
  where candidate.id = p_attempt_id
    and candidate.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform 1
  from public.apollo_enrichment_targets as target
  where target.id = target_id_to_lock
    and target.workspace_id = p_workspace_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into attempt
  from public.apollo_enrichment_attempts as candidate
  where candidate.id = p_attempt_id
    and candidate.workspace_id = p_workspace_id
    and candidate.target_id = target_id_to_lock
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if attempt.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_action = 'quarantine_stale' then
    if attempt.status <> 'in_progress' then
      return jsonb_build_object('status', 'conflict');
    end if;
    if attempt.lease_expires_at > now() then
      return jsonb_build_object('status', 'not_stale');
    end if;
    if p_email_secret <> '' then
      raise exception 'quarantine cannot contain an email receipt' using errcode = '22023';
    end if;
    next_status := 'ambiguous';
    update public.apollo_enrichment_attempts
    set status = next_status,
        ambiguous_at = now(),
        version = version + 1
    where id = attempt.id
    returning version into next_version;
  elsif p_action = 'complete_found' then
    if attempt.status <> 'ambiguous' then
      return jsonb_build_object('status', 'conflict');
    end if;
    if p_email_secret = '' then
      raise exception 'completed email receipt is required' using errcode = '22023';
    end if;
    next_status := 'completed';
    update public.apollo_enrichment_attempts
    set status = next_status,
        found = true,
        email_secret = p_email_secret,
        completed_at = now(),
        receipt_expires_at = now() + interval '30 days',
        receipt_erased_at = null,
        version = version + 1
    where id = attempt.id
    returning version into next_version;
  elsif p_action = 'complete_not_found' then
    if attempt.status <> 'ambiguous' then
      return jsonb_build_object('status', 'conflict');
    end if;
    if p_email_secret <> '' then
      raise exception 'no-match reconciliation cannot contain an email receipt' using errcode = '22023';
    end if;
    next_status := 'completed';
    update public.apollo_enrichment_attempts
    set status = next_status,
        found = false,
        email_secret = '',
        completed_at = now(),
        receipt_expires_at = null,
        receipt_erased_at = null,
        version = version + 1
    where id = attempt.id
    returning version into next_version;
  else
    if attempt.status <> 'ambiguous' then
      return jsonb_build_object('status', 'conflict');
    end if;
    if p_email_secret <> '' then
      raise exception 'cancellation cannot contain an email receipt' using errcode = '22023';
    end if;
    next_status := 'cancelled';
    update public.apollo_enrichment_attempts
    set status = next_status,
        found = null,
        email_secret = '',
        cancelled_at = now(),
        version = version + 1
    where id = attempt.id
    returning version into next_version;
  end if;

  insert into public.apollo_enrichment_reconciliation_events (
    id,
    workspace_id,
    attempt_id,
    actor_id,
    action,
    from_status,
    to_status,
    from_version,
    to_version,
    case_reference,
    evidence_sha256,
    request_id
  ) values (
    reconciliation_event_id,
    p_workspace_id,
    attempt.id,
    p_actor_id,
    p_action,
    attempt.status,
    next_status,
    attempt.version,
    next_version,
    p_case_reference,
    p_evidence_sha256,
    p_request_id
  );

  return jsonb_build_object(
    'status', 'reconciled',
    'attempt_id', attempt.id,
    'attempt_status', next_status,
    'version', next_version,
    'event_id', reconciliation_event_id
  );
end;
$$;

create or replace function public.erase_apollo_enrichment_target(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id uuid,
  p_target_id uuid,
  p_case_reference text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  target public.apollo_enrichment_targets%rowtype;
  replayed_event public.apollo_enrichment_erasure_events%rowtype;
  cleared_receipts integer := 0;
  cancelled_attempts integer := 0;
  event_id uuid := gen_random_uuid();
  original_event_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and workspace_id = p_workspace_id
      and role = 'admin'
  ) then
    raise exception 'admin authority required' using errcode = '42501';
  end if;
  if p_case_reference is null
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    raise exception 'invalid erasure request' using errcode = '22023';
  end if;

  select * into replayed_event
  from public.apollo_enrichment_erasure_events
  where workspace_id = p_workspace_id
    and request_id = p_request_id;
  if found then
    if replayed_event.target_id <> p_target_id
       or replayed_event.campaign_id <> p_campaign_id
       or replayed_event.candidate_id <> p_candidate_id
       or replayed_event.actor_id <> p_actor_id
       or replayed_event.case_reference <> p_case_reference then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'erased',
      'target_id', replayed_event.target_id,
      'cleared_receipts', replayed_event.cleared_receipts,
      'cancelled_attempts', replayed_event.cancelled_attempts,
      'event_id', replayed_event.id,
      'cached', true
    );
  end if;

  select * into target
  from public.apollo_enrichment_targets
  where id = p_target_id
    and workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and candidate_id = p_candidate_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target.erased_at is not null then
    select * into replayed_event
    from public.apollo_enrichment_erasure_events
    where workspace_id = p_workspace_id
      and request_id = p_request_id;
    if found then
      if replayed_event.target_id <> p_target_id
         or replayed_event.campaign_id <> p_campaign_id
         or replayed_event.candidate_id <> p_candidate_id
         or replayed_event.actor_id <> p_actor_id
         or replayed_event.case_reference <> p_case_reference then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'erased',
        'target_id', replayed_event.target_id,
        'cleared_receipts', replayed_event.cleared_receipts,
        'cancelled_attempts', replayed_event.cancelled_attempts,
        'event_id', replayed_event.id,
        'cached', true
      );
    end if;
    select id into original_event_id
    from public.apollo_enrichment_erasure_events
    where workspace_id = p_workspace_id
      and target_id = p_target_id
      and campaign_id = p_campaign_id
      and candidate_id = p_candidate_id
    order by created_at, id
    limit 1;
    return jsonb_build_object(
      'status', 'already_erased',
      'target_id', target.id,
      'original_event_id', original_event_id
    );
  end if;

  update public.apollo_enrichment_attempts as attempt
  set email_secret = '',
      receipt_erased_at = now(),
      version = attempt.version + 1
  where attempt.workspace_id = p_workspace_id
    and attempt.target_id = p_target_id
    and attempt.status = 'completed'
    and attempt.found
    and attempt.email_secret <> '';
  get diagnostics cleared_receipts = row_count;

  update public.apollo_enrichment_attempts as attempt
  set status = 'cancelled',
      found = null,
      email_secret = '',
      completed_at = null,
      ambiguous_at = null,
      cancelled_at = now(),
      receipt_expires_at = null,
      receipt_erased_at = null,
      version = attempt.version + 1
  where attempt.workspace_id = p_workspace_id
    and attempt.target_id = p_target_id
    and attempt.status in ('in_progress', 'ambiguous');
  get diagnostics cancelled_attempts = row_count;

  update public.apollo_enrichment_confirmations as confirmation
  set consumed_at = coalesce(confirmation.consumed_at, now())
  where confirmation.workspace_id = p_workspace_id
    and confirmation.target_id = p_target_id
    and confirmation.consumed_at is null;

  update public.apollo_enrichment_targets
  set provider_external_id = 'erased:' || id::text,
      profile_hash = repeat('0', 64),
      expires_at = now(),
      erased_at = now(),
      erased_by = p_actor_id,
      erasure_reference = p_case_reference,
      erasure_request_id = p_request_id
  where id = p_target_id
    and workspace_id = p_workspace_id;

  insert into public.apollo_enrichment_erasure_events (
    id,
    workspace_id,
    target_id,
    campaign_id,
    candidate_id,
    actor_id,
    cleared_receipts,
    cancelled_attempts,
    case_reference,
    request_id
  ) values (
    event_id,
    p_workspace_id,
    p_target_id,
    p_campaign_id,
    p_candidate_id,
    p_actor_id,
    cleared_receipts,
    cancelled_attempts,
    p_case_reference,
    p_request_id
  );

  return jsonb_build_object(
    'status', 'erased',
    'target_id', p_target_id,
    'cleared_receipts', cleared_receipts,
    'cancelled_attempts', cancelled_attempts,
    'event_id', event_id
  );
end;
$$;

create or replace function public.cleanup_apollo_enrichment_authority(
  p_workspace_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  remaining integer;
  expired_receipts_cleared integer := 0;
  confirmations_deleted integer := 0;
  targets_deleted integer := 0;
  expired_targets_scrubbed integer := 0;
  quota_rows_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'invalid cleanup limit' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  remaining := p_limit;
  with candidates as (
    select attempt.id
    from public.apollo_enrichment_attempts as attempt
    where attempt.workspace_id = p_workspace_id
      and attempt.status = 'completed'
      and attempt.found
      and attempt.email_secret <> ''
      and attempt.receipt_expires_at <= now()
    order by attempt.receipt_expires_at, attempt.id
    limit remaining
    for update skip locked
  )
  update public.apollo_enrichment_attempts as attempt
  set email_secret = '',
      receipt_erased_at = coalesce(attempt.receipt_erased_at, now()),
      version = attempt.version + 1
  from candidates
  where attempt.id = candidates.id;
  get diagnostics expired_receipts_cleared = row_count;
  remaining := remaining - expired_receipts_cleared;

  if remaining > 0 then
    with candidates as (
      select nonce
      from public.apollo_enrichment_confirmations
      where workspace_id = p_workspace_id
        and (consumed_at is not null or expires_at <= now())
      order by coalesce(consumed_at, expires_at), nonce
      limit remaining
      for update skip locked
    )
    delete from public.apollo_enrichment_confirmations as confirmation
    using candidates
    where confirmation.nonce = candidates.nonce;
    get diagnostics confirmations_deleted = row_count;
    remaining := remaining - confirmations_deleted;
  end if;

  if remaining > 0 then
    with candidates as (
      select target.id
      from public.apollo_enrichment_targets as target
      where target.workspace_id = p_workspace_id
        and target.expires_at <= now()
        and not exists (
          select 1
          from public.apollo_enrichment_attempts as attempt
          where attempt.target_id = target.id
        )
      order by target.expires_at, target.id
      limit remaining
      for update skip locked
    )
    delete from public.apollo_enrichment_targets as target
    using candidates
    where target.id = candidates.id;
    get diagnostics targets_deleted = row_count;
    remaining := remaining - targets_deleted;
  end if;

  if remaining > 0 then
    with candidates as (
      select target.id
      from public.apollo_enrichment_targets as target
      where target.workspace_id = p_workspace_id
        and target.expires_at <= now()
        and target.erased_at is null
        and target.provider_external_id <> 'expired:' || target.id::text
        and exists (
          select 1
          from public.apollo_enrichment_attempts as attempt
          where attempt.target_id = target.id
        )
        and not exists (
          select 1
          from public.apollo_enrichment_attempts as attempt
          where attempt.target_id = target.id
            and attempt.status in ('in_progress', 'ambiguous')
        )
      order by target.expires_at, target.id
      limit remaining
      for update skip locked
    )
    update public.apollo_enrichment_targets as target
    set provider_external_id = 'expired:' || target.id::text,
        profile_hash = repeat('0', 64)
    from candidates
    where target.id = candidates.id;
    get diagnostics expired_targets_scrubbed = row_count;
    remaining := remaining - expired_targets_scrubbed;
  end if;

  if remaining > 0 then
    with candidates as (
      select quota.workspace_id, quota.bucket_date, quota.scope_key
      from public.apollo_enrichment_quota as quota
      where quota.workspace_id = p_workspace_id
        and (
          quota.bucket_date < current_date - 30
          or (quota.used = 0 and quota.bucket_date < current_date)
        )
      order by quota.bucket_date, quota.scope_key
      limit remaining
      for update skip locked
    )
    delete from public.apollo_enrichment_quota as quota
    using candidates
    where quota.workspace_id = candidates.workspace_id
      and quota.bucket_date = candidates.bucket_date
      and quota.scope_key = candidates.scope_key;
    get diagnostics quota_rows_deleted = row_count;
  end if;

  return jsonb_build_object(
    'status', 'cleaned',
    'processed', expired_receipts_cleared + confirmations_deleted + targets_deleted
      + expired_targets_scrubbed + quota_rows_deleted,
    'expired_receipts_cleared', expired_receipts_cleared,
    'confirmations_deleted', confirmations_deleted,
    'targets_deleted', targets_deleted,
    'expired_targets_scrubbed', expired_targets_scrubbed,
    'quota_rows_deleted', quota_rows_deleted
  );
end;
$$;

revoke all on function public.register_apollo_enrichment_targets(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.select_apollo_enrichment_target(uuid, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.prepare_apollo_enrichment(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_apollo_enrichment(uuid, uuid, text, uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_apollo_enrichment(uuid, uuid, uuid, uuid, boolean, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_apollo_enrichment_ambiguous(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_apollo_enrichment_reconciliation(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_apollo_enrichment(uuid, uuid, uuid, bigint, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.erase_apollo_enrichment_target(uuid, uuid, text, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_apollo_enrichment_authority(uuid, integer) from public, anon, authenticated, service_role;

grant execute on function public.register_apollo_enrichment_targets(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.select_apollo_enrichment_target(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.prepare_apollo_enrichment(uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.claim_apollo_enrichment(uuid, uuid, text, uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.complete_apollo_enrichment(uuid, uuid, uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.mark_apollo_enrichment_ambiguous(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.list_apollo_enrichment_reconciliation(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.reconcile_apollo_enrichment(uuid, uuid, uuid, bigint, text, text, text, text, text) to service_role;
grant execute on function public.erase_apollo_enrichment_target(uuid, uuid, text, uuid, uuid, text, text) to service_role;
grant execute on function public.cleanup_apollo_enrichment_authority(uuid, integer) to service_role;
