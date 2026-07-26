-- 0064_candidate_lists_authority.sql
--
-- Phase 1 candidate-list authority. Browser candidate JSON is display data,
-- never provenance authority. Membership is accepted only when one durable,
-- server-owned provenance attestation exists for the same tenant candidate.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.candidate_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 200
  ),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, id),
  foreign key (workspace_id, created_by)
    references public.profiles(workspace_id, id) on delete restrict
);

create index if not exists candidate_lists_workspace_created_idx
  on public.candidate_lists (workspace_id, created_at desc, id desc);

create table if not exists public.candidate_contact_attestations (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 200),
  candidate_id text not null check (
    candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  attestation_kind text not null check (
    attestation_kind in ('manual_provenance')
  ),
  value_code text not null check (value_code in ('operator_verified')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (
    workspace_id,
    campaign_id,
    candidate_id,
    id,
    evidence_sha256,
    recorded_at
  ),
  foreign key (workspace_id, campaign_id, candidate_id)
    references public.candidates(workspace_id, campaign_id, id) on delete cascade,
  foreign key (workspace_id, recorded_by)
    references public.profiles(workspace_id, id) on delete restrict
);

create index if not exists candidate_contact_attestations_lookup_idx
  on public.candidate_contact_attestations (
    workspace_id, campaign_id, candidate_id, attestation_kind, recorded_at, id
  );

create table if not exists public.candidate_list_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_id uuid not null,
  campaign_id text not null check (char_length(campaign_id) between 1 and 200),
  candidate_id text not null check (
    candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  evidence_kind text not null check (evidence_kind in ('manual_attestation')),
  evidence_attestation_id bigint not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_recorded_at timestamptz not null,
  added_by uuid not null,
  added_at timestamptz not null default clock_timestamp(),
  member_id uuid not null default gen_random_uuid(),
  primary key (workspace_id, list_id, campaign_id, candidate_id),
  unique (member_id),
  foreign key (workspace_id, list_id)
    references public.candidate_lists(workspace_id, id) on delete cascade,
  foreign key (workspace_id, campaign_id, candidate_id)
    references public.candidates(workspace_id, campaign_id, id) on delete cascade,
  foreign key (
    workspace_id,
    campaign_id,
    candidate_id,
    evidence_attestation_id,
    evidence_sha256,
    evidence_recorded_at
  ) references public.candidate_contact_attestations(
    workspace_id,
    campaign_id,
    candidate_id,
    id,
    evidence_sha256,
    recorded_at
  )
    on delete cascade,
  foreign key (workspace_id, added_by)
    references public.profiles(workspace_id, id) on delete restrict
);

create index if not exists candidate_list_members_page_idx
  on public.candidate_list_members (
    workspace_id, list_id, added_at desc, member_id desc
  );

create index if not exists candidate_list_members_candidate_idx
  on public.candidate_list_members (workspace_id, campaign_id, candidate_id);

create table if not exists public.candidate_list_operation_receipts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_id uuid,
  operation_kind text not null check (
    operation_kind in ('create_list', 'add_member')
  ),
  idempotency_key uuid not null,
  request_hmac_sha256 text not null check (
    request_hmac_sha256 ~ '^[0-9a-f]{64}$'
  ),
  candidate_subject_hmac text check (
    candidate_subject_hmac is null
    or candidate_subject_hmac ~ '^[0-9a-f]{64}$'
  ),
  actor_id uuid not null,
  result jsonb not null check (
    jsonb_typeof(result) = 'object'
    and pg_column_size(result) <= 4096
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, operation_kind, idempotency_key),
  foreign key (workspace_id, list_id)
    references public.candidate_lists(workspace_id, id) on delete restrict,
  foreign key (workspace_id, actor_id)
    references public.profiles(workspace_id, id) on delete restrict,
  check (
    (operation_kind = 'create_list' and candidate_subject_hmac is null)
    or (operation_kind = 'add_member' and candidate_subject_hmac is not null)
  )
);

create index if not exists candidate_list_operation_receipts_list_idx
  on public.candidate_list_operation_receipts (workspace_id, list_id, created_at desc)
  where list_id is not null;

create index if not exists candidate_list_operation_receipts_subject_idx
  on public.candidate_list_operation_receipts (
    workspace_id, candidate_subject_hmac, operation_kind
  )
  where candidate_subject_hmac is not null;

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results',
    'sourcing_candidate_evidence', 'ordinary_sourcing_results',
    'agent_memories', 'candidate_payload_provenance',
    'candidate_list_members', 'candidate_contact_attestations',
    'candidate_list_operation_receipts'
  ));

revoke all on sequence public.candidate_contact_attestations_id_seq
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.candidate_list_operation_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;

do $candidate_list_table_security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'candidate_lists',
    'candidate_contact_attestations',
    'candidate_list_members',
    'candidate_list_operation_receipts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role, authenticator',
      table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_access', table_name);
    execute format(
      'create policy %I on public.%I for all to postgres, supabase_admin using (true) with check (true)',
      table_name || '_owner_access',
      table_name
    );
  end loop;
end
$candidate_list_table_security$;

create or replace function public.reject_candidate_list_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  -- Foreign-key cascades are the governed erasure/workspace-deletion path.
  -- Direct owner updates/deletes remain forbidden and are tested separately.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$;

alter function public.reject_candidate_list_evidence_mutation() owner to postgres;
revoke all on function public.reject_candidate_list_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_contact_attestations_append_only
  on public.candidate_contact_attestations;
create trigger candidate_contact_attestations_append_only
  before update or delete on public.candidate_contact_attestations
  for each row execute function public.reject_candidate_list_evidence_mutation();

drop trigger if exists candidate_list_operation_receipts_append_only
  on public.candidate_list_operation_receipts;
create trigger candidate_list_operation_receipts_append_only
  before update or delete on public.candidate_list_operation_receipts
  for each row execute function public.reject_candidate_list_evidence_mutation();

create or replace function public.cleanup_erased_candidate_lists()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_member_count integer := 0;
  v_attestation_count integer := 0;
  v_receipt_count integer := 0;
  v_subject_hmac text;
begin
  if new.status = 'blocked_legal_hold' then
    return null;
  end if;

  perform set_config('aria.candidate_list_erasure_cleanup', 'on', true);

  -- The canonical erasure RPC creates the workspace HMAC secret after the
  -- request row. No secret also means no 0064 add receipt could have been
  -- created, so legacy/manual erasure must continue without computing a HMAC.
  if exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = new.workspace_id
  ) then
    v_subject_hmac := public.sourcing_authority_hmac(
      new.workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', new.campaign_id, new.candidate_id
      )::text
    );

    delete from public.candidate_list_operation_receipts receipt
     where receipt.workspace_id = new.workspace_id
       and receipt.operation_kind = 'add_member'
       and receipt.candidate_subject_hmac = v_subject_hmac;
    get diagnostics v_receipt_count = row_count;
  end if;

  delete from public.candidate_list_members member
   where member.workspace_id = new.workspace_id
     and member.campaign_id = new.campaign_id
     and member.candidate_id = new.candidate_id;
  get diagnostics v_member_count = row_count;

  delete from public.candidate_contact_attestations attestation
   where attestation.workspace_id = new.workspace_id
     and attestation.campaign_id = new.campaign_id
     and attestation.candidate_id = new.candidate_id;
  get diagnostics v_attestation_count = row_count;

  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values
    (new.id, new.workspace_id, 'candidate_list_members', v_member_count),
    (new.id, new.workspace_id, 'candidate_contact_attestations', v_attestation_count),
    (new.id, new.workspace_id, 'candidate_list_operation_receipts', v_receipt_count)
  on conflict (request_id, store_name) do nothing;

  return null;
end
$$;

alter function public.cleanup_erased_candidate_lists() owner to postgres;
revoke all on function public.cleanup_erased_candidate_lists()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_erasure_requests_candidate_lists_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_candidate_lists_cleanup
  after insert or update on public.candidate_erasure_requests
  for each row
  when (new.status <> 'blocked_legal_hold')
  execute function public.cleanup_erased_candidate_lists();

create or replace function public.create_candidate_list(
  p_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor_id uuid;
  v_workspace_id uuid;
  v_profile_role text;
  v_request_hmac_sha256 text;
  v_receipt public.candidate_list_operation_receipts%rowtype;
  v_list_id uuid;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_actor_id := public.current_active_identity_id();
  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();

  if v_actor_id is null or v_workspace_id is null
     or v_profile_role not in ('member', 'admin') then
    raise exception 'source permission required' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = ''
     or char_length(btrim(p_name)) > 200
     or p_idempotency_key is null then
    raise exception 'invalid candidate list request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':create_list:' || p_idempotency_key::text,
    0
  ));

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (v_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;

  v_request_hmac_sha256 := public.sourcing_authority_hmac(
    v_workspace_id,
    jsonb_build_array('candidate_list_request_v1', 'create_list',
      v_actor_id, btrim(p_name))::text
  );
  select receipt.*
    into v_receipt
    from public.candidate_list_operation_receipts receipt
   where receipt.workspace_id = v_workspace_id
     and receipt.operation_kind = 'create_list'
     and receipt.idempotency_key = p_idempotency_key
   for update;

  if found then
    if v_receipt.request_hmac_sha256 <> v_request_hmac_sha256 then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return v_receipt.result;
  end if;

  insert into public.candidate_lists (workspace_id, name, created_by)
  values (v_workspace_id, btrim(p_name), v_actor_id)
  returning id into v_list_id;

  v_result := jsonb_build_object(
    'status', 'created',
    'list_id', v_list_id
  );

  insert into public.candidate_list_operation_receipts (
    workspace_id,
    list_id,
    operation_kind,
    idempotency_key,
    request_hmac_sha256,
    actor_id,
    result
  ) values (
    v_workspace_id,
    v_list_id,
    'create_list',
    p_idempotency_key,
    v_request_hmac_sha256,
    v_actor_id,
    v_result
  );

  return v_result;
end
$$;

alter function public.create_candidate_list(text, uuid) owner to postgres;
revoke all on function public.create_candidate_list(text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_candidate_list(text, uuid)
  to authenticated;

create or replace function public.add_candidate_list_member(
  p_list_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor_id uuid;
  v_workspace_id uuid;
  v_profile_role text;
  v_request_hmac_sha256 text;
  v_candidate_subject_hmac text;
  v_receipt public.candidate_list_operation_receipts%rowtype;
  v_result jsonb;
  v_attestation_ids bigint[];
  v_attestation public.candidate_contact_attestations%rowtype;
  v_rows_inserted bigint;
  v_existing_member boolean;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_actor_id := public.current_active_identity_id();
  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();

  if v_actor_id is null or v_workspace_id is null
     or v_profile_role not in ('member', 'admin') then
    raise exception 'source permission required' using errcode = '42501';
  end if;

  if p_list_id is null or p_idempotency_key is null
     or p_campaign_id is null or p_candidate_id is null
     or char_length(p_campaign_id) not between 1 and 200
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate list member request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':add_member:' || p_idempotency_key::text,
    0
  ));

  -- Candidate erasure uses this same identity lock before creating a
  -- suppression tombstone and deleting candidate-bearing records. Holding it
  -- before secret creation, HMAC computation, or receipt lookup ensures an
  -- add either commits before erasure (and is scrubbed) or observes the
  -- tombstone afterward (and creates no candidate-linked receipt).
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    v_workspace_id, 'candidate_id', p_candidate_id
  ));

  if exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = v_workspace_id
  ) then
    if public.candidate_erasure_tombstone_exists(
      v_workspace_id, 'candidate_id', p_candidate_id
    ) then
      return jsonb_build_object('status', 'candidate_not_found');
    end if;
  end if;

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (v_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;

  v_request_hmac_sha256 := public.sourcing_authority_hmac(
    v_workspace_id,
    jsonb_build_array('candidate_list_request_v1', 'add_member',
      v_actor_id, p_list_id, p_campaign_id, p_candidate_id)::text
  );
  v_candidate_subject_hmac := public.sourcing_authority_hmac(
    v_workspace_id,
    jsonb_build_array(
      'candidate_list_subject_v1', p_campaign_id, p_candidate_id
    )::text
  );

  select receipt.*
    into v_receipt
    from public.candidate_list_operation_receipts receipt
   where receipt.workspace_id = v_workspace_id
     and receipt.operation_kind = 'add_member'
     and receipt.idempotency_key = p_idempotency_key
   for update;

  if found then
    if v_receipt.request_hmac_sha256 <> v_request_hmac_sha256 then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return v_receipt.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':candidate_list_member:' || p_list_id::text
      || ':' || p_campaign_id || ':' || p_candidate_id,
    0
  ));

  perform 1
    from public.candidate_lists list_record
   where list_record.workspace_id = v_workspace_id
     and list_record.id = p_list_id
   for key share;

  if not found then
    v_result := jsonb_build_object('status', 'list_not_found');

    insert into public.candidate_list_operation_receipts (
      workspace_id, list_id, operation_kind, idempotency_key,
      request_hmac_sha256, candidate_subject_hmac, actor_id, result
    ) values (
      v_workspace_id, null, 'add_member', p_idempotency_key,
      v_request_hmac_sha256, v_candidate_subject_hmac, v_actor_id, v_result
    );

    return v_result;
  end if;

  perform 1
    from public.candidates candidate
   where candidate.workspace_id = v_workspace_id
     and candidate.campaign_id = p_campaign_id
     and candidate.id = p_candidate_id
   for key share;

  if not found then
    v_result := jsonb_build_object('status', 'candidate_not_found');

    insert into public.candidate_list_operation_receipts (
      workspace_id, list_id, operation_kind, idempotency_key,
      request_hmac_sha256, candidate_subject_hmac, actor_id, result
    ) values (
      v_workspace_id, p_list_id, 'add_member', p_idempotency_key,
      v_request_hmac_sha256, v_candidate_subject_hmac, v_actor_id, v_result
    );

    return v_result;
  end if;

  select exists (
    select 1
      from public.candidate_list_members member
     where member.workspace_id = v_workspace_id
       and member.list_id = p_list_id
       and member.campaign_id = p_campaign_id
       and member.candidate_id = p_candidate_id
  ) into v_existing_member;

  if v_existing_member then
    v_result := jsonb_build_object('status', 'already_member');
  else
    -- Future evidence writers must share this candidate-global lock. The
    -- bounded one-statement snapshot distinguishes zero, one, and many rows
    -- without an unbounded count/select race.
    perform pg_advisory_xact_lock(hashtextextended(
      v_workspace_id::text || ':candidate_contact_evidence:'
        || p_campaign_id || ':' || p_candidate_id,
      0
    ));

    select coalesce(array_agg(candidate_evidence.id order by candidate_evidence.id), array[]::bigint[])
      into v_attestation_ids
      from (
        select attestation.id
          from public.candidate_contact_attestations attestation
         where attestation.workspace_id = v_workspace_id
           and attestation.campaign_id = p_campaign_id
           and attestation.candidate_id = p_candidate_id
           and attestation.attestation_kind = 'manual_provenance'
         order by attestation.id
         limit 2
      ) candidate_evidence;

    if cardinality(v_attestation_ids) = 0 then
      v_result := jsonb_build_object('status', 'provenance_missing');
    elsif cardinality(v_attestation_ids) > 1 then
      v_result := jsonb_build_object('status', 'provenance_ambiguous');
    else
      select attestation.*
        into strict v_attestation
        from public.candidate_contact_attestations attestation
       where attestation.workspace_id = v_workspace_id
         and attestation.id = v_attestation_ids[1];

      insert into public.candidate_list_members (
        workspace_id,
        list_id,
        campaign_id,
        candidate_id,
        evidence_kind,
        evidence_attestation_id,
        evidence_sha256,
        evidence_recorded_at,
        added_by
      ) values (
        v_workspace_id,
        p_list_id,
        p_campaign_id,
        p_candidate_id,
        'manual_attestation',
        v_attestation.id,
        v_attestation.evidence_sha256,
        v_attestation.recorded_at,
        v_actor_id
      )
      on conflict (workspace_id, list_id, campaign_id, candidate_id)
      do nothing;

      get diagnostics v_rows_inserted = row_count;

      if v_rows_inserted = 1 then
        v_result := jsonb_build_object(
          'status', 'added',
          'list_id', p_list_id
        );
      else
        v_result := jsonb_build_object('status', 'already_member');
      end if;
    end if;
  end if;

  insert into public.candidate_list_operation_receipts (
    workspace_id,
    list_id,
    operation_kind,
    idempotency_key,
    request_hmac_sha256,
    candidate_subject_hmac,
    actor_id,
    result
  ) values (
    v_workspace_id,
    p_list_id,
    'add_member',
    p_idempotency_key,
    v_request_hmac_sha256,
    v_candidate_subject_hmac,
    v_actor_id,
    v_result
  );

  return v_result;
end
$$;

alter function public.add_candidate_list_member(uuid, text, text, uuid)
  owner to postgres;
revoke all on function public.add_candidate_list_member(uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.add_candidate_list_member(uuid, text, text, uuid)
  to authenticated;

create or replace function public.list_candidate_list_members(
  p_list_id uuid,
  p_after_added_at timestamptz,
  p_after_member_id uuid,
  p_limit int
)
returns table (
  candidate_id text,
  campaign_id text,
  evidence_kind text,
  evidence_sha256 text,
  added_by uuid,
  added_at timestamptz,
  member_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_profile_role text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();

  if v_workspace_id is null
     or v_profile_role not in ('viewer', 'member', 'admin') then
    raise exception 'view permission required' using errcode = '42501';
  end if;

  if p_list_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid candidate list page request' using errcode = '22023';
  end if;

  if (p_after_added_at is null) <> (p_after_member_id is null) then
    raise exception 'candidate list cursor requires both components'
      using errcode = '22023';
  end if;

  return query
  select member.candidate_id,
         member.campaign_id,
         member.evidence_kind,
         member.evidence_sha256,
         member.added_by,
         member.added_at,
         member.member_id
    from public.candidate_list_members member
   where member.workspace_id = v_workspace_id
     and member.list_id = p_list_id
     and (
       p_after_added_at is null
       or (member.added_at, member.member_id)
          < (p_after_added_at, p_after_member_id)
     )
   order by member.added_at desc, member.member_id desc
   limit p_limit;
end
$$;

alter function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  owner to postgres;
revoke all on function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  to authenticated;
