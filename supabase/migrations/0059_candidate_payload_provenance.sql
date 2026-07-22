-- Candidate payload provenance and independently verified provider erasure.
--
-- Candidate-bearing agent payloads are indexed by normalized, workspace-keyed
-- HMACs. Erasure therefore follows exact identity provenance instead of
-- searching opaque JSON text. Encrypted AgentSpec memory content and its exact
-- candidate alias set are written through one service-only transaction.
--
-- Provider obligations may transition to completed only when a separate,
-- append-only evidence receipt already exists. The receipt table deliberately
-- has no service_role insert policy or RPC: a provider-specific adapter or an
-- approved evidence-store verifier must record it through an owner-controlled
-- database channel before the administrator reconciliation call can succeed.

create unique index if not exists agent_runs_workspace_id_provenance_key
  on public.agent_runs (workspace_id, id);
create unique index if not exists agent_events_workspace_id_provenance_key
  on public.agent_events (workspace_id, id);
create unique index if not exists agent_memories_workspace_id_provenance_key
  on public.agent_memories (workspace_id, id);

create table if not exists public.candidate_payload_provenance (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text check (
    campaign_id is null
    or campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  agent_run_id uuid,
  agent_event_id bigint,
  framework_run_id uuid,
  memory_id uuid,
  identifier_kind text not null check (
    identifier_kind in (
      'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
      'source_external_id', 'source_authority_id', 'provider_external_id'
    )
  ),
  identifier_hmac text not null check (identifier_hmac ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint candidate_payload_provenance_one_subject_check check (
    num_nonnulls(agent_run_id, agent_event_id, framework_run_id, memory_id) = 1
  ),
  constraint candidate_payload_provenance_agent_run_fkey
    foreign key (workspace_id, agent_run_id)
    references public.agent_runs (workspace_id, id) on delete cascade,
  constraint candidate_payload_provenance_agent_event_fkey
    foreign key (workspace_id, agent_event_id)
    references public.agent_events (workspace_id, id) on delete cascade,
  constraint candidate_payload_provenance_framework_result_fkey
    foreign key (workspace_id, framework_run_id)
    references public.agent_framework_sourcing_authorizations (
      workspace_id, framework_run_id
    ) on delete cascade,
  constraint candidate_payload_provenance_memory_fkey
    foreign key (workspace_id, memory_id)
    references public.agent_memories (workspace_id, id) on delete cascade
);

create unique index if not exists candidate_payload_provenance_run_key
  on public.candidate_payload_provenance (
    workspace_id, agent_run_id, identifier_kind, identifier_hmac
  ) where agent_run_id is not null;
create unique index if not exists candidate_payload_provenance_event_key
  on public.candidate_payload_provenance (
    workspace_id, agent_event_id, identifier_kind, identifier_hmac
  ) where agent_event_id is not null;
create unique index if not exists candidate_payload_provenance_framework_key
  on public.candidate_payload_provenance (
    workspace_id, framework_run_id, identifier_kind, identifier_hmac
  ) where framework_run_id is not null;
create unique index if not exists candidate_payload_provenance_memory_key
  on public.candidate_payload_provenance (
    workspace_id, memory_id, identifier_kind, identifier_hmac
  ) where memory_id is not null;
create index if not exists candidate_payload_provenance_identity_lookup_idx
  on public.candidate_payload_provenance (
    workspace_id, identifier_kind, identifier_hmac
  );

alter table public.candidate_payload_provenance enable row level security;
alter table public.candidate_payload_provenance force row level security;
revoke all on public.candidate_payload_provenance
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.candidate_payload_provenance_id_seq
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists candidate_payload_provenance_postgres_all
  on public.candidate_payload_provenance;
create policy candidate_payload_provenance_postgres_all
  on public.candidate_payload_provenance
  for all to postgres using (true) with check (true);

create or replace function public.candidate_payload_identifiers(
  p_candidate jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_array(
    jsonb_build_object('kind', 'candidate_id', 'value', coalesce(p_candidate->>'id', p_candidate->>'candidateId', '')),
    jsonb_build_object('kind', 'email', 'value', coalesce(p_candidate->>'email', '')),
    jsonb_build_object('kind', 'phone', 'value', coalesce(p_candidate->>'phone', '')),
    jsonb_build_object('kind', 'linkedin', 'value', coalesce(p_candidate->>'linkedinUrl', p_candidate->>'linkedin_url', '')),
    jsonb_build_object('kind', 'github', 'value', coalesce(p_candidate->>'githubUrl', p_candidate->>'github_url', '')),
    jsonb_build_object('kind', 'source_url', 'value', coalesce(p_candidate->>'sourceUrl', p_candidate->>'source_url', '')),
    jsonb_build_object('kind', 'source_external_id', 'value', coalesce(p_candidate->>'sourceExternalId', p_candidate->>'source_external_id', '')),
    jsonb_build_object('kind', 'source_authority_id', 'value', coalesce(p_candidate->>'sourceAuthorityId', p_candidate->>'source_authority_id', '')),
    jsonb_build_object('kind', 'provider_external_id', 'value', coalesce(p_candidate->>'providerExternalId', p_candidate->>'provider_external_id', ''))
  );
$$;

revoke all on function public.candidate_payload_identifiers(jsonb)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.index_candidate_payload_provenance(
  p_workspace_id uuid,
  p_campaign_id text,
  p_agent_run_id uuid,
  p_agent_event_id bigint,
  p_framework_run_id uuid,
  p_memory_id uuid,
  p_identifiers jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  identity_record record;
  identity_lock_key bigint;
  inserted_count integer := 0;
begin
  if p_workspace_id is null
     or num_nonnulls(
       p_agent_run_id, p_agent_event_id, p_framework_run_id, p_memory_id
     ) <> 1
     or p_identifiers is null
     or jsonb_typeof(p_identifiers) <> 'array'
     or jsonb_array_length(p_identifiers) not between 1 and 32
     or (p_campaign_id is not null and (
       p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     )) then
    raise exception 'invalid candidate payload provenance'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_identifiers) item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ?& array['kind', 'value'])
        or item.value - array['kind', 'value'] <> '{}'::jsonb
        or jsonb_typeof(item.value->'kind') <> 'string'
        or jsonb_typeof(item.value->'value') <> 'string'
        or item.value->>'kind' not in (
          'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
          'source_external_id', 'source_authority_id', 'provider_external_id'
        )
        or octet_length(convert_to(item.value->>'value', 'UTF8')) > 2048
  ) then
    raise exception 'invalid candidate payload identifier'
      using errcode = '22023';
  end if;

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (p_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;

  for identity_lock_key in
    select distinct public.candidate_erasure_identity_lock_key(
      p_workspace_id, item.value->>'kind', item.value->>'value'
    ) as lock_key
      from jsonb_array_elements(p_identifiers) item(value)
     where btrim(item.value->>'value') <> ''
     order by lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;

  for identity_record in
    select distinct
      item.value->>'kind' as identifier_kind,
      item.value->>'value' as identifier_value,
      public.candidate_erasure_identifier_hmac(
        p_workspace_id, item.value->>'kind', item.value->>'value'
      ) as identifier_hmac
      from jsonb_array_elements(p_identifiers) item(value)
     where btrim(item.value->>'value') <> ''
  loop
    if public.candidate_erasure_tombstone_exists(
      p_workspace_id,
      identity_record.identifier_kind,
      identity_record.identifier_value
    ) then
      raise exception 'candidate erasure tombstone blocks payload provenance'
        using errcode = '23514';
    end if;
    insert into public.candidate_payload_provenance(
      workspace_id, campaign_id, agent_run_id, agent_event_id,
      framework_run_id, memory_id, identifier_kind, identifier_hmac
    ) values (
      p_workspace_id, p_campaign_id, p_agent_run_id, p_agent_event_id,
      p_framework_run_id, p_memory_id, identity_record.identifier_kind,
      identity_record.identifier_hmac
    ) on conflict do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.index_candidate_payload_provenance(
  uuid, text, uuid, bigint, uuid, uuid, jsonb
) from public, anon, authenticated, service_role, authenticator;

create or replace function public.index_candidate_json_payload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate jsonb;
  payload jsonb;
  campaign_id text;
begin
  if tg_table_name = 'agent_runs' then
    payload := new.state_json;
    campaign_id := nullif(payload->>'campaignId', '');
    if jsonb_typeof(payload->'candidates') = 'array' then
      for candidate in select value from jsonb_array_elements(payload->'candidates') loop
        perform public.index_candidate_payload_provenance(
          new.workspace_id, coalesce(nullif(candidate->>'campaignId', ''), campaign_id),
          new.id, null, null, null, public.candidate_payload_identifiers(candidate)
        );
      end loop;
    end if;
    if jsonb_typeof(payload->'screened') = 'array' then
      for candidate in select value from jsonb_array_elements(payload->'screened') loop
        perform public.index_candidate_payload_provenance(
          new.workspace_id, coalesce(nullif(candidate->>'campaignId', ''), campaign_id),
          new.id, null, null, null, public.candidate_payload_identifiers(candidate)
        );
      end loop;
    end if;
    if coalesce(payload->>'candidateId', '') <> '' then
      perform public.index_candidate_payload_provenance(
        new.workspace_id, campaign_id, new.id, null, null, null,
        jsonb_build_array(jsonb_build_object(
          'kind', 'candidate_id', 'value', payload->>'candidateId'
        ))
      );
    end if;
  elsif tg_table_name = 'agent_events' then
    payload := new.payload;
    if coalesce(payload->>'candidateId', '') <> '' then
      perform public.index_candidate_payload_provenance(
        new.workspace_id, null, null, new.id, null, null,
        jsonb_build_array(jsonb_build_object(
          'kind', 'candidate_id', 'value', payload->>'candidateId'
        ))
      );
    end if;
    if jsonb_typeof(payload->'candidate') = 'object' then
      perform public.index_candidate_payload_provenance(
        new.workspace_id, null, null, new.id, null, null,
        public.candidate_payload_identifiers(payload->'candidate')
      );
    end if;
  else
    payload := new.result_payload;
    campaign_id := new.campaign_id;
    if payload is not null and jsonb_typeof(payload->'candidates') = 'array' then
      for candidate in select value from jsonb_array_elements(payload->'candidates') loop
        perform public.index_candidate_payload_provenance(
          new.workspace_id, coalesce(nullif(candidate->>'campaignId', ''), campaign_id),
          null, null, new.framework_run_id, null,
          public.candidate_payload_identifiers(candidate)
        );
      end loop;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.index_candidate_json_payload()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_runs_candidate_provenance
  on public.agent_runs;
create trigger agent_runs_candidate_provenance
  after insert or update of state_json on public.agent_runs
  for each row execute function public.index_candidate_json_payload();
drop trigger if exists agent_events_candidate_provenance
  on public.agent_events;
create trigger agent_events_candidate_provenance
  after insert or update of payload on public.agent_events
  for each row execute function public.index_candidate_json_payload();
drop trigger if exists agent_framework_results_candidate_provenance
  on public.agent_framework_sourcing_authorizations;
create trigger agent_framework_results_candidate_provenance
  after insert or update of result_payload
  on public.agent_framework_sourcing_authorizations
  for each row execute function public.index_candidate_json_payload();

create or replace function public.create_agent_memory_with_candidate_provenance(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_actor_id uuid,
  p_kind text,
  p_content_ciphertext text,
  p_content_sha256 text,
  p_content_byte_count integer,
  p_pinned boolean,
  p_expires_at timestamptz,
  p_campaign_id text,
  p_candidate_identifiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  memory_id uuid;
  identity_lock_key bigint;
  indexed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_candidate_identifiers is null
     or jsonb_typeof(p_candidate_identifiers) <> 'array'
     or jsonb_array_length(p_candidate_identifiers) > 32
     or (jsonb_array_length(p_candidate_identifiers) = 0 and p_campaign_id is not null)
     or (p_campaign_id is not null and (
       p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     ))
     or exists (
       select 1
         from jsonb_array_elements(p_candidate_identifiers) item(value)
        where jsonb_typeof(item.value) <> 'object'
           or not (item.value ?& array['kind', 'value'])
           or item.value - array['kind', 'value'] <> '{}'::jsonb
           or jsonb_typeof(item.value->'kind') <> 'string'
           or jsonb_typeof(item.value->'value') <> 'string'
           or item.value->>'kind' not in (
             'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
             'source_external_id', 'source_authority_id', 'provider_external_id'
           )
           or btrim(item.value->>'value') = ''
           or octet_length(convert_to(item.value->>'value', 'UTF8')) > 2048
     ) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  for identity_lock_key in
    select distinct public.candidate_erasure_identity_lock_key(
      p_workspace_id, item.value->>'kind', item.value->>'value'
    ) as lock_key
      from jsonb_array_elements(p_candidate_identifiers) item(value)
     order by lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;

  result := public.create_agent_memory(
    p_workspace_id, p_owner_id, p_spec_id, p_actor_id, p_kind,
    p_content_ciphertext, p_content_sha256, p_content_byte_count,
    p_pinned, p_expires_at
  );
  if coalesce(result->>'status', '') <> 'created' then
    return result;
  end if;

  memory_id := (result->>'id')::uuid;
  if jsonb_array_length(p_candidate_identifiers) > 0 then
    indexed := public.index_candidate_payload_provenance(
      p_workspace_id, p_campaign_id, null, null, null, memory_id,
      p_candidate_identifiers
    );
  end if;
  return result || jsonb_build_object('candidate_identities_recorded', indexed);
end;
$$;

revoke all on function public.create_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz,
  text, jsonb
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz,
  text, jsonb
) to service_role;

create or replace function public.mutate_agent_memory_with_candidate_provenance(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_spec_id uuid,
  p_memory_id uuid,
  p_actor_id uuid,
  p_expected_revision integer,
  p_operation text,
  p_kind text,
  p_content_ciphertext text,
  p_content_sha256 text,
  p_content_byte_count integer,
  p_pinned boolean,
  p_set_expires boolean,
  p_expires_at timestamptz,
  p_replace_candidate_provenance boolean,
  p_campaign_id text,
  p_candidate_identifiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  identity_lock_key bigint;
  indexed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_replace_candidate_provenance is null
     or (p_replace_candidate_provenance and (
       p_operation is distinct from 'edit'
       or p_content_ciphertext is null
       or p_candidate_identifiers is null
       or jsonb_typeof(p_candidate_identifiers) <> 'array'
       or jsonb_array_length(p_candidate_identifiers) > 32
       or (jsonb_array_length(p_candidate_identifiers) = 0 and p_campaign_id is not null)
       or (p_campaign_id is not null and (
         p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
       ))
       or exists (
         select 1
           from jsonb_array_elements(p_candidate_identifiers) item(value)
          where jsonb_typeof(item.value) <> 'object'
             or not (item.value ?& array['kind', 'value'])
             or item.value - array['kind', 'value'] <> '{}'::jsonb
             or jsonb_typeof(item.value->'kind') <> 'string'
             or jsonb_typeof(item.value->'value') <> 'string'
             or item.value->>'kind' not in (
               'candidate_id', 'email', 'phone', 'linkedin', 'github', 'source_url',
               'source_external_id', 'source_authority_id', 'provider_external_id'
             )
             or btrim(item.value->>'value') = ''
             or octet_length(convert_to(item.value->>'value', 'UTF8')) > 2048
       )
     ))
     or (not p_replace_candidate_provenance and (
       p_content_ciphertext is not null
       or p_campaign_id is not null
       or p_candidate_identifiers is not null
     )) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if p_replace_candidate_provenance then
    for identity_lock_key in
      select distinct public.candidate_erasure_identity_lock_key(
        p_workspace_id, item.value->>'kind', item.value->>'value'
      ) as lock_key
        from jsonb_array_elements(p_candidate_identifiers) item(value)
       order by lock_key
    loop
      perform pg_advisory_xact_lock(identity_lock_key);
    end loop;
  end if;

  result := public.mutate_agent_memory(
    p_workspace_id, p_owner_id, p_spec_id, p_memory_id, p_actor_id,
    p_expected_revision, p_operation, p_kind, p_content_ciphertext,
    p_content_sha256, p_content_byte_count, p_pinned, p_set_expires,
    p_expires_at
  );
  if coalesce(result->>'status', '') <> 'updated'
     or not p_replace_candidate_provenance then
    return result;
  end if;

  delete from public.candidate_payload_provenance provenance
   where provenance.workspace_id = p_workspace_id
     and provenance.memory_id = p_memory_id;
  if jsonb_array_length(p_candidate_identifiers) > 0 then
    indexed := public.index_candidate_payload_provenance(
      p_workspace_id, p_campaign_id, null, null, null, p_memory_id,
      p_candidate_identifiers
    );
  end if;
  return result || jsonb_build_object('candidate_identities_recorded', indexed);
end;
$$;

revoke all on function public.mutate_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz, boolean, text, jsonb
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.mutate_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz, boolean, text, jsonb
) to service_role;

-- Once the atomic wrappers exist, service workers may not write encrypted
-- content through the legacy routines or add provenance in a second call.
revoke execute on function public.create_agent_memory(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz
) from service_role;
revoke execute on function public.mutate_agent_memory(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz
) from service_role;

-- Legacy graph rows may be inspected by the application, but service workers
-- cannot mutate them directly. PostgreSQL-owned SECURITY DEFINER routines keep
-- the narrowly validated run-receipt and erasure paths functional.
revoke insert, update, delete on public.agent_runs, public.agent_events
  from service_role;
revoke truncate, references, trigger on public.agent_runs, public.agent_events
  from service_role;
drop function if exists public.register_agent_memory_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, jsonb
);

-- Backfill exact structured agent payloads. Encrypted memories cannot be
-- inspected; all new product writes are covered by the atomic wrappers above.
do $candidate_payload_provenance_backfill$
declare
  item record;
  candidate jsonb;
begin
  for item in select * from public.agent_runs loop
    if jsonb_typeof(item.state_json->'candidates') = 'array' then
      for candidate in select value from jsonb_array_elements(item.state_json->'candidates') loop
        perform public.index_candidate_payload_provenance(
          item.workspace_id, nullif(candidate->>'campaignId', ''),
          item.id, null, null, null, public.candidate_payload_identifiers(candidate)
        );
      end loop;
    end if;
    if jsonb_typeof(item.state_json->'screened') = 'array' then
      for candidate in select value from jsonb_array_elements(item.state_json->'screened') loop
        perform public.index_candidate_payload_provenance(
          item.workspace_id, coalesce(
            nullif(candidate->>'campaignId', ''),
            nullif(item.state_json->>'campaignId', '')
          ),
          item.id, null, null, null,
          public.candidate_payload_identifiers(candidate)
        );
      end loop;
    end if;
    if coalesce(item.state_json->>'candidateId', '') <> '' then
      perform public.index_candidate_payload_provenance(
        item.workspace_id, nullif(item.state_json->>'campaignId', ''),
        item.id, null, null, null,
        jsonb_build_array(jsonb_build_object(
          'kind', 'candidate_id', 'value', item.state_json->>'candidateId'
        ))
      );
    end if;
  end loop;
  for item in select * from public.agent_events loop
    if coalesce(item.payload->>'candidateId', '') <> '' then
      perform public.index_candidate_payload_provenance(
        item.workspace_id, null, null, item.id, null, null,
        jsonb_build_array(jsonb_build_object(
          'kind', 'candidate_id', 'value', item.payload->>'candidateId'
        ))
      );
    end if;
    if jsonb_typeof(item.payload->'candidate') = 'object' then
      perform public.index_candidate_payload_provenance(
        item.workspace_id, null, null, item.id, null, null,
        public.candidate_payload_identifiers(item.payload->'candidate')
      );
    end if;
  end loop;
  for item in
    select * from public.agent_framework_sourcing_authorizations
     where result_payload is not null
       and jsonb_typeof(result_payload->'candidates') = 'array'
  loop
    for candidate in select value from jsonb_array_elements(item.result_payload->'candidates') loop
      perform public.index_candidate_payload_provenance(
        item.workspace_id, item.campaign_id, null, null,
        item.framework_run_id, null, public.candidate_payload_identifiers(candidate)
      );
    end loop;
  end loop;
end;
$candidate_payload_provenance_backfill$;

create or replace function public.candidate_payload_matches_erasure(
  p_workspace_id uuid,
  p_request_id uuid,
  p_candidate jsonb
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from jsonb_array_elements(public.candidate_payload_identifiers(p_candidate)) identity(value)
      join public.candidate_erasure_suppression_tombstones tombstone
        on tombstone.request_id = p_request_id
       and tombstone.workspace_id = p_workspace_id
       and tombstone.identifier_kind = identity.value->>'kind'
       and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
         p_workspace_id, identity.value->>'kind', identity.value->>'value'
       )
     where btrim(identity.value->>'value') <> ''
  );
$$;

revoke all on function public.candidate_payload_matches_erasure(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;

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
    'agent_memories', 'candidate_payload_provenance'
  ));

create or replace function public.cleanup_candidate_payload_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  affected_run_ids uuid[] := array[]::uuid[];
  affected_event_ids bigint[] := array[]::bigint[];
  affected_framework_ids uuid[] := array[]::uuid[];
  affected_memory_ids uuid[] := array[]::uuid[];
  run_count integer := 0;
  event_count integer := 0;
  framework_count integer := 0;
  memory_count integer := 0;
  provenance_count integer := 0;
  memory_record public.agent_memories%rowtype;
begin
  if new.status = 'blocked_legal_hold'
     or new.local_scrub_completed_at is null
     or not exists (
       select 1 from public.candidate_erasure_suppression_tombstones tombstone
        where tombstone.request_id = new.id
     ) then
    return new;
  end if;

  select
    coalesce(array_agg(distinct provenance.agent_run_id)
      filter (where provenance.agent_run_id is not null), array[]::uuid[]),
    coalesce(array_agg(distinct provenance.agent_event_id)
      filter (where provenance.agent_event_id is not null), array[]::bigint[]),
    coalesce(array_agg(distinct provenance.framework_run_id)
      filter (where provenance.framework_run_id is not null), array[]::uuid[]),
    coalesce(array_agg(distinct provenance.memory_id)
      filter (where provenance.memory_id is not null), array[]::uuid[]),
    count(distinct provenance.id)
    into affected_run_ids, affected_event_ids, affected_framework_ids,
         affected_memory_ids, provenance_count
    from public.candidate_payload_provenance provenance
    join public.candidate_erasure_suppression_tombstones tombstone
      on tombstone.request_id = new.id
     and tombstone.workspace_id = provenance.workspace_id
     and tombstone.identifier_kind = provenance.identifier_kind
     and tombstone.identifier_hmac = provenance.identifier_hmac
   where provenance.workspace_id = new.workspace_id;

  select affected_event_ids || coalesce(
    array_agg(event.id) filter (where event.id is not null),
    array[]::bigint[]
  )
    into affected_event_ids
    from public.agent_events event
   where event.workspace_id = new.workspace_id
     and event.run_id = any(affected_run_ids);

  -- The affected payloads are redacted in full. Remove all of their identity
  -- mappings first; the framework update trigger reindexes only candidates
  -- that survive the exact erasure filter.
  delete from public.candidate_payload_provenance provenance
   where provenance.workspace_id = new.workspace_id
     and (
       provenance.agent_run_id = any(affected_run_ids)
       or provenance.agent_event_id = any(affected_event_ids)
       or provenance.framework_run_id = any(affected_framework_ids)
       or provenance.memory_id = any(affected_memory_ids)
     );
  get diagnostics provenance_count = row_count;

  update public.agent_runs run
     set state_json = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure'),
         status = case when run.status in ('running', 'awaiting_gate') then 'failed' else run.status end,
         finished_at = case when run.status in ('running', 'awaiting_gate')
           then coalesce(run.finished_at, now()) else run.finished_at end
   where run.workspace_id = new.workspace_id
     and run.id = any(affected_run_ids)
     and run.state_json <> jsonb_build_object('redacted', true, 'reason', 'candidate_erasure');
  get diagnostics run_count = row_count;

  update public.agent_events event
     set payload = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure')
   where event.workspace_id = new.workspace_id
     and (event.id = any(affected_event_ids) or event.run_id = any(affected_run_ids))
     and event.payload <> jsonb_build_object('redacted', true, 'reason', 'candidate_erasure');
  get diagnostics event_count = row_count;

  update public.agent_framework_sourcing_authorizations framework_result
     set result_payload = jsonb_set(
       framework_result.result_payload,
       '{candidates}',
       coalesce((
         select jsonb_agg(candidate.value order by candidate.ordinality)
           from jsonb_array_elements(framework_result.result_payload->'candidates')
             with ordinality candidate(value, ordinality)
          where not public.candidate_payload_matches_erasure(
            new.workspace_id, new.id, candidate.value
          )
       ), '[]'::jsonb),
       false
     )
   where framework_result.workspace_id = new.workspace_id
     and framework_result.framework_run_id = any(affected_framework_ids)
     and framework_result.result_payload is not null
     and jsonb_typeof(framework_result.result_payload->'candidates') = 'array'
     and exists (
       select 1
         from jsonb_array_elements(framework_result.result_payload->'candidates') candidate(value)
        where public.candidate_payload_matches_erasure(
          new.workspace_id, new.id, candidate.value
        )
     );
  get diagnostics framework_count = row_count;

  if exists (
    select 1
      from public.agent_framework_memory_egress_leases egress
      join public.agent_framework_run_memory_context context
        on context.framework_run_id = egress.framework_run_id
     where context.memory_id = any(affected_memory_ids)
       and egress.released_at is null
       and egress.expires_at > clock_timestamp()
  ) then
    raise exception 'candidate-bound agent memory has an active egress lease'
      using errcode = '55000';
  end if;

  for memory_record in
    select * from public.agent_memories memory
     where memory.workspace_id = new.workspace_id
       and memory.id = any(affected_memory_ids)
       and memory.status <> 'deleted'
     for update
  loop
    insert into public.agent_memory_events(
      memory_id, workspace_id, owner_id, spec_id, actor_id, event_type,
      memory_revision, content_sha256, metadata
    ) values (
      memory_record.id, memory_record.workspace_id, memory_record.owner_id,
      memory_record.spec_id, new.actor_id, 'deleted', memory_record.revision,
      memory_record.content_sha256, '{}'::jsonb
    );
    update public.agent_memories
       set content_ciphertext = 'enc:v2:' || repeat('0', 64) || ':AA==:AA==:AA==',
           content_sha256 = encode(digest(convert_to('[deleted]', 'UTF8'), 'sha256'), 'hex'),
           content_byte_count = 9,
           status = 'deleted', deleted_at = now(), pinned = false,
           expires_at = null, updated_by = new.actor_id
     where id = memory_record.id;
    memory_count := memory_count + 1;
  end loop;

  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values
    (new.id, new.workspace_id, 'agent_runs', run_count),
    (new.id, new.workspace_id, 'agent_events', event_count),
    (new.id, new.workspace_id, 'agent_framework_results', framework_count),
    (new.id, new.workspace_id, 'agent_memories', memory_count),
    (new.id, new.workspace_id, 'candidate_payload_provenance', provenance_count)
  on conflict (request_id, store_name) do nothing;
  return new;
end;
$$;

revoke all on function public.cleanup_candidate_payload_provenance()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_requests_payload_provenance_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_payload_provenance_cleanup
  after insert or update of status, local_scrub_completed_at
  on public.candidate_erasure_requests
  for each row execute function public.cleanup_candidate_payload_provenance();
drop trigger if exists candidate_erasure_tombstones_payload_provenance_cleanup
  on public.candidate_erasure_suppression_tombstones;

-- The tombstone-row trigger passes a tombstone row, not an erasure-request
-- row. Route it to the same request-scoped cleanup without duplicating logic.
create or replace function public.cleanup_candidate_payload_from_tombstone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  request_record public.candidate_erasure_requests%rowtype;
begin
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = new.request_id;
  if request_record.id is null then return new; end if;
  -- Touching status fires the request trigger after the tombstone is visible.
  update public.candidate_erasure_requests
     set status = status
   where id = request_record.id;
  return new;
end;
$$;

revoke all on function public.cleanup_candidate_payload_from_tombstone()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_tombstones_payload_provenance_cleanup
  on public.candidate_erasure_suppression_tombstones;
create trigger candidate_erasure_tombstones_payload_provenance_cleanup
  after insert on public.candidate_erasure_suppression_tombstones
  for each row execute function public.cleanup_candidate_payload_from_tombstone();

-- -------------------------------------------------------------------------
-- Independently recorded provider evidence.
-- -------------------------------------------------------------------------

create unique index if not exists candidate_erasure_obligations_scope_key
  on public.candidate_erasure_obligations (
    workspace_id, request_id, provider, id
  );

create table if not exists public.candidate_erasure_provider_evidence_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  obligation_id uuid not null,
  provider text not null check (provider ~ '^[a-z][a-z0-9._:-]{0,63}$'),
  expected_attempt_count integer not null check (expected_attempt_count between 0 and 100),
  verification_method text not null check (verification_method in (
    'provider_signed_receipt', 'provider_read_after_delete',
    'approved_evidence_store'
  )),
  adapter_id text not null check (adapter_id ~ '^[a-z][a-z0-9._:-]{0,63}$'),
  adapter_version text not null check (
    adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  ),
  provider_receipt_hmac text not null check (provider_receipt_hmac ~ '^[0-9a-f]{64}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  case_reference text not null check (
    case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
  ),
  verified_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint candidate_erasure_provider_evidence_obligation_fkey
    foreign key (workspace_id, request_id, provider, obligation_id)
    references public.candidate_erasure_obligations (
      workspace_id, request_id, provider, id
    ) on delete restrict,
  unique (
    obligation_id, expected_attempt_count, evidence_sha256, case_reference
  ),
  unique (provider, provider_receipt_hmac)
);

alter table public.candidate_erasure_provider_evidence_receipts enable row level security;
alter table public.candidate_erasure_provider_evidence_receipts force row level security;
revoke all on public.candidate_erasure_provider_evidence_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists candidate_erasure_provider_evidence_postgres_all
  on public.candidate_erasure_provider_evidence_receipts;
create policy candidate_erasure_provider_evidence_postgres_all
  on public.candidate_erasure_provider_evidence_receipts
  for all to postgres using (true) with check (true);

create or replace function public.candidate_erasure_provider_evidence_document(
  p_workspace_id uuid,
  p_request_id uuid,
  p_obligation_id uuid,
  p_provider text,
  p_expected_attempt_count integer,
  p_verification_method text,
  p_adapter_id text,
  p_adapter_version text,
  p_evidence_sha256 text,
  p_case_reference text,
  p_verified_at timestamptz
)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'kind', 'candidate_erasure_provider_evidence',
    'workspaceId', p_workspace_id,
    'requestId', p_request_id,
    'obligationId', p_obligation_id,
    'provider', p_provider,
    'expectedAttemptCount', p_expected_attempt_count,
    'verificationMethod', p_verification_method,
    'adapterId', p_adapter_id,
    'adapterVersion', p_adapter_version,
    'evidenceSha256', p_evidence_sha256,
    'caseReference', p_case_reference,
    'verifiedAt', to_char(
      p_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
$$;

revoke all on function public.candidate_erasure_provider_evidence_document(
  uuid, uuid, uuid, text, integer, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role, authenticator;

create or replace function public.validate_candidate_erasure_provider_evidence_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.verified_at < clock_timestamp() - interval '10 minutes'
     or new.verified_at > clock_timestamp() then
    raise exception 'candidate erasure provider evidence is not fresh'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.candidate_erasure_obligations obligation
     where obligation.workspace_id = new.workspace_id
       and obligation.request_id = new.request_id
       and obligation.id = new.obligation_id
       and obligation.provider = new.provider
       and obligation.attempt_count = new.expected_attempt_count
       and obligation.status <> 'completed'
     for key share
  ) then
    raise exception 'candidate erasure provider evidence authority changed'
      using errcode = '40001';
  end if;
  if not public.candidate_erasure_constant_time_hex_equal(
    new.provider_receipt_hmac,
    public.candidate_erasure_reference_hmac(
      new.workspace_id,
      public.candidate_erasure_provider_evidence_document(
        new.workspace_id, new.request_id, new.obligation_id, new.provider,
        new.expected_attempt_count, new.verification_method, new.adapter_id,
        new.adapter_version, new.evidence_sha256, new.case_reference,
        new.verified_at
      )
    )
  ) then
    raise exception 'candidate erasure provider evidence adapter binding is invalid'
      using errcode = '23514';
  end if;
  new.recorded_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.validate_candidate_erasure_provider_evidence_receipt()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_provider_evidence_validate
  on public.candidate_erasure_provider_evidence_receipts;
create trigger candidate_erasure_provider_evidence_validate
  before insert on public.candidate_erasure_provider_evidence_receipts
  for each row execute function public.validate_candidate_erasure_provider_evidence_receipt();

create or replace function public.reject_candidate_erasure_provider_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'candidate erasure provider evidence is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_candidate_erasure_provider_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_provider_evidence_append_only
  on public.candidate_erasure_provider_evidence_receipts;
create trigger candidate_erasure_provider_evidence_append_only
  before update or delete on public.candidate_erasure_provider_evidence_receipts
  for each row execute function public.reject_candidate_erasure_provider_evidence_mutation();

alter table public.candidate_erasure_obligations
  add column if not exists completion_evidence_receipt_id uuid;
alter table public.candidate_erasure_obligations
  drop constraint if exists candidate_erasure_obligations_completion_evidence_receipt_fkey;
alter table public.candidate_erasure_obligations
  add constraint candidate_erasure_obligations_completion_evidence_receipt_fkey
  foreign key (completion_evidence_receipt_id)
  references public.candidate_erasure_provider_evidence_receipts(id)
  on delete restrict;

create or replace function public.enforce_verified_candidate_erasure_completion()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'completed'
     and old.status <> 'completed'
     and not exists (
       select 1
         from public.candidate_erasure_provider_evidence_receipts evidence
        where evidence.id = new.completion_evidence_receipt_id
          and evidence.workspace_id = new.workspace_id
          and evidence.request_id = new.request_id
          and evidence.obligation_id = new.id
          and evidence.provider = new.provider
          and evidence.evidence_sha256 = new.completion_evidence_sha256
          and evidence.case_reference = new.completion_case_reference
          and evidence.expected_attempt_count = old.attempt_count
          and evidence.verified_at >= clock_timestamp() - interval '10 minutes'
          and evidence.verified_at <= clock_timestamp()
     ) then
    raise exception 'verified provider erasure evidence required'
      using errcode = '23514';
  end if;
  if old.status = 'completed'
     and new.completion_evidence_receipt_id is distinct from old.completion_evidence_receipt_id then
    raise exception 'provider erasure completion evidence is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_verified_candidate_erasure_completion()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_obligations_verified_completion
  on public.candidate_erasure_obligations;
create trigger candidate_erasure_obligations_verified_completion
  before update on public.candidate_erasure_obligations
  for each row execute function public.enforce_verified_candidate_erasure_completion();

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
  evidence public.candidate_erasure_provider_evidence_receipts%rowtype;
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
  if p_status = 'completed' then
    select * into evidence
      from public.candidate_erasure_provider_evidence_receipts item
     where item.workspace_id = p_workspace_id
       and item.request_id = obligation.request_id
       and item.obligation_id = obligation.id
       and item.provider = obligation.provider
       and item.expected_attempt_count = p_expected_attempt_count
       and item.evidence_sha256 = p_evidence_sha256
       and item.case_reference = p_case_reference
       and item.verified_at >= clock_timestamp() - interval '10 minutes'
       and item.verified_at <= clock_timestamp()
     for share;
    if not found then
      return jsonb_build_object(
        'status', 'unverified_evidence', 'attempt_count', obligation.attempt_count
      );
    end if;
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
         completion_evidence_receipt_id = case when p_status = 'completed'
           then evidence.id else null end,
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

revoke all on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) to service_role;

alter function public.candidate_payload_identifiers(jsonb) owner to postgres;
alter function public.index_candidate_payload_provenance(
  uuid, text, uuid, bigint, uuid, uuid, jsonb
) owner to postgres;
alter function public.index_candidate_json_payload() owner to postgres;
alter function public.create_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz,
  text, jsonb
) owner to postgres;
alter function public.mutate_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz, boolean, text, jsonb
) owner to postgres;
alter function public.candidate_payload_matches_erasure(uuid, uuid, jsonb)
  owner to postgres;
alter function public.cleanup_candidate_payload_provenance() owner to postgres;
alter function public.cleanup_candidate_payload_from_tombstone() owner to postgres;
alter function public.candidate_erasure_provider_evidence_document(
  uuid, uuid, uuid, text, integer, text, text, text, text, text, timestamptz
) owner to postgres;
alter function public.validate_candidate_erasure_provider_evidence_receipt()
  owner to postgres;
alter function public.reject_candidate_erasure_provider_evidence_mutation()
  owner to postgres;
alter function public.enforce_verified_candidate_erasure_completion()
  owner to postgres;
alter function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) owner to postgres;
