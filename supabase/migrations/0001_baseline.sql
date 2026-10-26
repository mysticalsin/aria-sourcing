-- ============================================================================
-- ARIA baseline schema
--
-- Squashes the historical migrations 0001-0054 into one file after the
-- October 2026 demo cleanup. Generated with pg_dump (schema "public" only)
-- from a database migrated through 0054, after removing the objects of the
-- retired features (agent frameworks, agent memory, swarm, autonomous loop,
-- Apollo, WhatsApp, Databricks, outreach sequences) and fixing
-- ensure_workspace() to read the caller's email from the JWT.
--
-- Applied by docker/bootstrap/migrate.sh as the direct postgres role, inside
-- one transaction. Add new changes as 0002_*.sql and later; never edit this
-- file once applied.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Default privileges. pg_dump cannot express revocations of the Supabase
-- image's defaults, so they are restated here (from the former 0019) BEFORE
-- any object is created. The bootstrap applies the equivalent reconciliation
-- for supabase_admin.
-- ----------------------------------------------------------------------------
alter default privileges revoke all on tables from public;
alter default privileges revoke all on sequences from public;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role, authenticator;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role, authenticator;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role, authenticator;
revoke create on schema public from public, anon, authenticated, service_role, authenticator;
do $aria_extensions_schema$
begin
  if to_regnamespace('extensions') is not null then
    execute 'revoke create on schema extensions from public, anon, authenticated, service_role, authenticator';
  end if;
end
$aria_extensions_schema$;

--
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: attach_provider_run(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_provider_run(p_run_id uuid, p_external_run_id text, p_dataset_id text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  run_row public.sourcing_provider_runs%rowtype;
  conflicting_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if p_run_id is null or p_external_run_id is null or char_length(p_external_run_id) < 1 or char_length(p_external_run_id) > 200 then
    return json_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_dataset_id is not null and (char_length(p_dataset_id) < 1 or char_length(p_dataset_id) > 200) then
    return json_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into run_row
    from public.sourcing_provider_runs
   where id = p_run_id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if run_row.status <> 'running' then return json_build_object('ok', false, 'reason', 'not_running'); end if;
  if run_row.external_run_id = p_external_run_id then
    update public.sourcing_provider_runs set dataset_id = coalesce(p_dataset_id, dataset_id) where id = p_run_id;
    return json_build_object('ok', true, 'run_id', p_run_id, 'duplicate', true);
  end if;

  select id into conflicting_id
    from public.sourcing_provider_runs
   where workspace_id = run_row.workspace_id
     and provider = run_row.provider
     and external_run_id = p_external_run_id
     and id <> p_run_id;
  if found then return json_build_object('ok', false, 'reason', 'external_run_conflict', 'conflicting_run_id', conflicting_id); end if;

  update public.sourcing_provider_runs
     set external_run_id = p_external_run_id,
         dataset_id = p_dataset_id
   where id = p_run_id;
  return json_build_object('ok', true, 'run_id', p_run_id, 'duplicate', false);
end; $$;

--
-- Name: audit_dust_connection_authority(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_dust_connection_authority() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  authority public.dust_connections%rowtype;
  authority_hash text;
begin
  if tg_op = 'DELETE' then
    authority := old;
  else
    authority := new;
  end if;

  authority_hash := encode(
    digest(
      jsonb_build_array(
        authority.workspace_id::text,
        authority.dust_workspace_id,
        authority.region,
        authority.api_key_id::text,
        authority.credential_provider,
        authority.agent_locks,
        authority.agents,
        authority.enabled,
        authority.config_revision::text
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.dust_connection_events (
    workspace_id,
    connection_id,
    actor_id,
    action,
    config_revision,
    config_hash
  ) values (
    authority.workspace_id,
    authority.id,
    auth.uid(),
    lower(tg_op),
    authority.config_revision,
    authority_hash
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

--
-- Name: backfill_candidate_person_identities(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_candidate_person_identities() RETURNS TABLE(linked integer, skipped integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  ws record;
  candidate_record public.candidates%rowtype;
  candidate_count integer;
  linked_person uuid;
begin
  linked := 0;
  skipped := 0;

  for ws in
    select distinct workspace_id
      from public.candidates
     order by workspace_id
  loop
    begin
      candidate_count := 0;
      for candidate_record in
        select *
          from public.candidates
         where workspace_id = ws.workspace_id
         order by campaign_id, id
      loop
        candidate_count := candidate_count + 1;
        linked_person := public.link_one_candidate(candidate_record);
        if linked_person is null then
          skipped := skipped + 1;
        else
          linked := linked + 1;
        end if;
      end loop;
    exception when others then
      skipped := skipped + candidate_count;
      raise warning 'person backfill skipped workspace %: %', ws.workspace_id, sqlerrm;
    end;
  end loop;

  raise notice 'person backfill: % candidacies linked, % skipped', linked, skipped;
  return next;
end;
$$;

--
-- Name: backfill_candidates_corpus(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_candidates_corpus() RETURNS TABLE(mirrored integer, skipped integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  ws record;
begin
  mirrored := 0;
  skipped := 0;

  for ws in
    select workspace_id, state
      from public.workspace_state
     order by workspace_id
  loop
    begin
      perform public.mirror_workspace_candidates(ws.workspace_id, ws.state);
      mirrored := mirrored + 1;
    exception when others then
      skipped := skipped + 1;
      raise warning 'candidates corpus backfill skipped ws %: %', ws.workspace_id, sqlerrm;
    end;
  end loop;

  raise notice 'candidates corpus backfill: % workspaces mirrored, % skipped', mirrored, skipped;
  return next;
end;
$$;

--
-- Name: begin_provider_run(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_provider_run(p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  existing public.sourcing_provider_runs%rowtype;
  used integer;
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if p_workspace_id is null
     or p_provider is null or char_length(p_provider) < 1 or char_length(p_provider) > 60
     or p_external_run_id is null or char_length(p_external_run_id) < 1 or char_length(p_external_run_id) > 200 then
    return json_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into existing from public.sourcing_provider_runs
    where workspace_id = p_workspace_id and provider = p_provider and external_run_id = p_external_run_id
    for update;
  if found then return json_build_object('ok', true, 'run_id', existing.id, 'status', existing.status, 'duplicate', true); end if;

  insert into public.sourcing_run_quota (workspace_id, bucket_date, scope_key)
    values (p_workspace_id, current_date, 'workspace')
  on conflict do nothing;

  perform 1
    from public.sourcing_run_quota
   where workspace_id = p_workspace_id
     and bucket_date = current_date
     and scope_key = 'workspace'
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'quota_unavailable'); end if;

  select count(*)::integer into used
    from public.sourcing_provider_runs
   where workspace_id = p_workspace_id
     and started_at >= current_date::timestamptz
     and started_at < (current_date + 1)::timestamptz;
  if used >= controls.max_sourcing_runs_per_day then
    return json_build_object('ok', false, 'reason', 'sourcing_run_quota_exceeded', 'used', used, 'limit', controls.max_sourcing_runs_per_day);
  end if;

  begin
    insert into public.sourcing_provider_runs(workspace_id, provider, external_run_id, campaign_id)
      values (p_workspace_id, p_provider, p_external_run_id, p_campaign_id) returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.sourcing_provider_runs
      where workspace_id = p_workspace_id and provider = p_provider and external_run_id = p_external_run_id;
    return json_build_object('ok', true, 'run_id', new_id, 'duplicate', true);
  end;

  update public.sourcing_run_quota
     set used = public.sourcing_run_quota.used + 1,
         updated_at = now()
   where workspace_id = p_workspace_id
     and bucket_date = current_date
     and scope_key = 'workspace';

  return json_build_object('ok', true, 'run_id', new_id, 'status', 'running', 'duplicate', false);
end; $$;

--
-- Name: begin_sourcing_run(uuid, uuid, text, jsonb, text, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_role_basis jsonb, p_configuration_fingerprint text, p_mode text, p_provider text, p_model text, p_idempotency_key uuid, p_request_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: candidate_erasure_constant_time_hex_equal(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_constant_time_hex_equal(p_left text, p_right text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: candidate_erasure_contains_identity(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_contains_identity(p_value text, p_tokens text[]) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_encrypt_reference(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_encrypt_reference(p_workspace_id uuid, p_reference jsonb) RETURNS bytea
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_identifier_hmac(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_identifier_hmac(p_workspace_id uuid, p_identifier_kind text, p_value text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_identity_lock_key(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_identity_lock_key(p_workspace_id uuid, p_identifier_kind text, p_value text) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_provider_for_channel(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_provider_for_channel(p_channel text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if lower(coalesce(p_channel, '')) not in ('email', 'linkedin', 'whatsapp', 'sms') then
    raise exception 'unsupported candidate erasure channel' using errcode = '22023';
  end if;
  return lower(p_channel);
end;
$$;

--
-- Name: candidate_erasure_reference_hmac(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_reference_hmac(p_workspace_id uuid, p_reference jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_response(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_response(p_request_id uuid, p_replayed boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_tombstone_document(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_tombstone_document(p_candidate jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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

--
-- Name: candidate_erasure_tombstone_exists(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_erasure_tombstone_exists(p_workspace_id uuid, p_identifier_kind text, p_value text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: canonicalize_sourcing_role_basis(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_sourcing_role_basis(p_basis jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: claim_and_record(text, text, text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text DEFAULT 'Email'::text, p_recontact_days integer DEFAULT 90) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  wid        uuid := public.current_workspace_id();
  domain     text := lower(split_part(coalesce(p_candidate_email,''), '@', 2));
  seat       public.agent_seats%rowtype;
  used_today int;
  cap        int;
  new_id     uuid;
begin
  if wid is null then return json_build_object('allowed', false, 'reason', 'no workspace'); end if;

  if exists (
    select 1 from public.suppression_list s
     where s.workspace_id = wid
       and (s.expires_at is null or s.expires_at > now())
       and ((s.type='email' and lower(s.value)=lower(p_candidate_email))
         or (s.type='domain' and lower(s.value)=domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_candidate_id, 1));
  update public.outreach_ledger
     set status = 'recontact_elapsed',
         reason = coalesce(reason, 're-contact window elapsed')
   where workspace_id = wid
     and candidate_id = p_candidate_id
     and status in ('claimed', 'sent', 'ambiguous')
     and at <= now() - make_interval(days => p_recontact_days);

  if exists (
    select 1 from public.outreach_ledger l
     where l.workspace_id = wid and l.candidate_id = p_candidate_id
       and l.status in ('claimed','sent','ambiguous') and l.at > now() - make_interval(days => p_recontact_days)
  ) then
    return json_build_object('allowed', false, 'reason', 'recently contacted');
  end if;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat not found'); end if;
  if seat.status <> 'active' then return json_build_object('allowed', false, 'reason', 'seat not active'); end if;

  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(seat.daily_limit,
                 greatest(seat.warmup_start_cap,
                          seat.warmup_start_cap + seat.warmup_step_per_day *
                          floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int));
  end if;

  select count(*) into used_today from public.outreach_ledger
   where seat_id = p_seat_id and at::date = now()::date and status in ('claimed','sent','ambiguous');
  if used_today >= cap then
    return json_build_object('allowed', false, 'reason', 'seat daily cap reached');
  end if;

  begin
    insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status)
      values (wid, p_candidate_id, p_candidate_email, p_seat_id, p_campaign_id, p_channel, 'claimed')
      returning id into new_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already contacted');
  end;

  return json_build_object('allowed', true, 'reason', 'ok', 'ledger_id', new_id);
end;
$$;

--
-- Name: claim_calendar_booking(uuid, text, timestamp with time zone, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_calendar_booking(p_workspace_id uuid, p_candidate_id text, p_start_time timestamp with time zone, p_request_id text, p_provider text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  existing_row public.calendar_booking_ledger%rowtype;
  new_row public.calendar_booking_ledger%rowtype;
  violated_constraint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_candidate_id is null
     or char_length(p_candidate_id) not between 1 and 200
     or p_start_time is null
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_provider is null
     or p_provider not in ('Gmail API', 'Microsoft Graph') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Idempotent retry check FIRST, and lock the row if it exists. The
  -- (workspace_id, request_id) unique constraint permanently binds one
  -- request_id to one row, so a genuine retry must always return that row
  -- rather than ever attempting a second insert. A request_id reused for a
  -- DIFFERENT candidate/start_time/provider is not a valid retry — it is
  -- rejected rather than silently returned as if it matched (mirrors
  -- claim_apollo_enrichment's idempotency_conflict, 0026).
  select * into existing_row
    from public.calendar_booking_ledger
   where workspace_id = p_workspace_id and request_id = p_request_id
   for update;
  if found then
    if existing_row.candidate_id <> p_candidate_id
       or existing_row.start_time <> p_start_time
       or existing_row.provider <> p_provider then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'claimed',
      'id', existing_row.id,
      'booking_status', existing_row.status,
      'external_event_id', existing_row.external_event_id,
      'replay', true
    );
  end if;

  begin
    insert into public.calendar_booking_ledger (
      workspace_id, candidate_id, start_time, request_id, provider, status
    ) values (
      p_workspace_id, p_candidate_id, p_start_time, p_request_id, p_provider, 'claimed'
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'calendar_booking_ledger_workspace_request_uniq' then
      -- A concurrent identical retry committed first. Return its row instead
      -- of racing a second insert under the same request_id — unless the
      -- concurrent winner was for a different candidate/start_time/provider,
      -- which is an idempotency conflict, not a valid replay.
      select * into existing_row
        from public.calendar_booking_ledger
       where workspace_id = p_workspace_id and request_id = p_request_id
       for update;
      if existing_row.candidate_id <> p_candidate_id
         or existing_row.start_time <> p_start_time
         or existing_row.provider <> p_provider then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'claimed',
        'id', existing_row.id,
        'booking_status', existing_row.status,
        'external_event_id', existing_row.external_event_id,
        'replay', true
      );
    end if;
    -- Any other unique violation is the active-slot guard firing: another
    -- claimed or confirmed booking already holds this exact candidate +
    -- start_time. Fail closed — no row is created, the caller must never
    -- call the provider.
    return jsonb_build_object('status', 'double_booked');
  end;

  return jsonb_build_object(
    'status', 'claimed',
    'id', new_row.id,
    'booking_status', new_row.status,
    'external_event_id', new_row.external_event_id,
    'replay', false
  );
end;
$_$;

--
-- Name: claim_email_outbound(text, text, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_email_outbound(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
  claim json;
  ledger_id uuid;
begin
  if auth.uid() is null or wid is null then return json_build_object('allowed', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('allowed', false, 'reason', 'insufficient-permissions'); end if;

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.revoked_at is not null then return json_build_object('allowed', false, 'reason', 'approval-revoked'); end if;
  if approval.approval_source <> 'human' then return json_build_object('allowed', false, 'reason', 'approval-not-human'); end if;
  if approval.body_hash is distinct from p_body_hash or approval.approval_scope_hash is distinct from p_approval_scope_hash then
    return json_build_object('allowed', false, 'reason', 'approval-mismatch');
  end if;

  claim := public.claim_and_record(
    p_candidate_id,
    p_candidate_email,
    p_campaign_id,
    p_seat_id,
    'Email'
  );
  if coalesce((claim ->> 'allowed')::boolean, false) is not true then return claim; end if;
  ledger_id := (claim ->> 'ledger_id')::uuid;

  update public.outreach_ledger
    set approval_message_id = p_message_id
    where id = ledger_id
      and workspace_id = wid
      and status = 'claimed';
  if not found then
    return json_build_object('allowed', false, 'reason', 'ledger-bind-failed');
  end if;
  return claim;
end;
$$;

--
-- Name: claim_email_outbound_queued(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_email_outbound_queued(p_message_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  outbound      public.messages_outbound%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  domain        text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  rfc_id        text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  domain := split_part(recipient, '@', 2);
  if recipient = '' or domain = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-recipient');
  end if;

  -- Active human approval, locked, matching the exact stored subject/body and the
  -- candidate+channel+recipient scope. Same shape as the WhatsApp claim (0024).
  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  -- Suppression: opt-out / do-not-contact by exact email or by domain.
  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and ((s.type = 'email' and lower(s.value) = recipient)
          or (s.type = 'domain' and lower(s.value) = domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  -- Live, domain-verified email seat (never a WhatsApp/SMS sender).
  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active'
    or seat.mode <> 'live'
    or not seat.domain_verified
    or seat.provider in ('WhatsApp Cloud', 'Twilio SMS')
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  -- 90-day fleet-wide re-contact window (claimed | sent hold the slot).
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  -- Per-seat effective warmup cap (ambiguous also consumes a slot, mirroring 0024).
  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(
      seat.daily_limit,
      greatest(
        seat.warmup_start_cap,
        seat.warmup_start_cap + seat.warmup_step_per_day
          * floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int
      )
    );
  end if;
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  -- Mint the RFC Message-ID BEFORE the send so the MIME header, the ledger, and
  -- the eventual delivery-event correlation all agree on one value. The domain is
  -- the SENDER's (the seat mailbox), per RFC 5322 — never the recipient's.
  rfc_id := '<' || attempt_id::text || '@' || split_part(seat.operator_email, '@', 2) || '>';

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id, rfc_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'Email', 'claimed',
      approval_id, outbound.id, attempt_id, rfc_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-17',
          'recipient', recipient,
          'content_kind', outbound.type,
          'rfc_message_id', rfc_id
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'rfc_message_id', rfc_id,
    'operator_email', seat.operator_email,
    'provider', seat.provider
  );
end;
$$;

--
-- Name: claim_enrichment_budget(uuid, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_enrichment_budget(p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  budget public.enrichment_budgets%rowtype;
  existing public.enrichment_spend_ledger%rowtype;
  used int;
  used_today int;
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('allowed', false, 'reason', 'service-only'); end if;
  if p_amount_cents is null or p_amount_cents < 0 then return json_build_object('allowed', false, 'reason', 'invalid-amount'); end if;

  select * into existing from public.enrichment_spend_ledger
    where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.period is distinct from p_period
       or existing.amount_cents is distinct from p_amount_cents
       or existing.provider is distinct from p_provider then
      return json_build_object('allowed', false, 'reason', 'idempotency_conflict', 'ledger_id', existing.id);
    end if;
    return json_build_object('allowed', existing.status = 'claimed', 'reason', 'already-claimed', 'ledger_id', existing.id, 'duplicate', true);
  end if;

  select * into budget from public.enrichment_budgets
    where workspace_id = p_workspace_id and period = p_period for update;
  if not found then return json_build_object('allowed', false, 'reason', 'no-budget'); end if;

  select coalesce(sum(amount_cents), 0) into used from public.enrichment_spend_ledger
    where workspace_id = p_workspace_id and period = p_period and status in ('claimed', 'settled');
  if used + p_amount_cents > budget.budget_cents then
    return json_build_object('allowed', false, 'reason', 'budget_exhausted', 'used_cents', used, 'budget_cents', budget.budget_cents);
  end if;

  select coalesce(sum(amount_cents), 0) into used_today from public.enrichment_spend_ledger
    where workspace_id = p_workspace_id
      and claimed_at >= current_date::timestamptz
      and claimed_at < (current_date + 1)::timestamptz
      and status in ('claimed', 'settled');
  if used_today + p_amount_cents > controls.max_enrichment_units_per_day then
    return json_build_object('allowed', false, 'reason', 'enrichment_unit_quota_exhausted', 'used_units', used_today, 'limit', controls.max_enrichment_units_per_day);
  end if;

  insert into public.enrichment_spend_ledger(workspace_id, period, idempotency_key, amount_cents, provider)
    values (p_workspace_id, p_period, p_idempotency_key, p_amount_cents, p_provider) returning id into new_id;
  return json_build_object('allowed', true, 'reason', 'claimed', 'ledger_id', new_id);
end; $$;

--
-- Name: claim_linkedin_outbound_queued(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_linkedin_outbound_queued(p_message_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  outbound      public.messages_outbound%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  backend       text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('allowed', false, 'reason', 'invalid-linkedin-profile');
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and s.type = 'linkedin'
        and lower(s.value) = recipient
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active'
    or seat.mode <> 'live'
    or seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API')
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent', 'ambiguous')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(
      seat.daily_limit,
      greatest(
        seat.warmup_start_cap,
        seat.warmup_start_cap + seat.warmup_step_per_day
          * floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int
      )
    );
  end if;
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  backend := case seat.provider
    when 'LinkedIn Vendor API' then 'vendor-api'
    else 'assisted-manual'
  end;

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'LinkedIn', 'claimed',
      approval_id, outbound.id, attempt_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-29-linkedin',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', backend
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'profile_url', recipient,
    'provider', seat.provider,
    'backend', backend
  );
end;
$$;

--
-- Name: cleanup_email_ledger_delivery_receipts(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_email_ledger_delivery_receipts(p_retention_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  deleted integer;
  retention integer := greatest(coalesce(p_retention_days, 180), 90);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.email_ledger_delivery_receipts
   where received_at < now() - make_interval(days => retention);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

--
-- Name: cleanup_erased_candidate_mirror(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_erased_candidate_mirror() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  delete from public.candidates
   where workspace_id = new.workspace_id
     and campaign_id = new.campaign_id
     and id = new.candidate_id;
  return null;
end;
$$;

--
-- Name: cleanup_erased_candidate_outcomes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_erased_candidate_outcomes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  delete from public.candidate_outcome_events
   where workspace_id = new.workspace_id
     and candidate_id = new.candidate_id;
  return null;
end;
$$;

--
-- Name: cleanup_sourcing_learning_authority(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_sourcing_learning_authority(p_workspace_id uuid, p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: complete_sourcing_run(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_query_receipts jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: configure_sourcing_learning(uuid, uuid, boolean, integer, integer, integer, integer, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.configure_sourcing_learning(p_workspace_id uuid, p_actor_id uuid, p_enabled boolean, p_workspace_daily_limit integer, p_user_daily_limit integer, p_min_evidence_runs integer, p_lesson_ttl_days integer, p_required_graphify_image_digest text, p_expected_version bigint, p_request_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: correlate_inbound_email(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.correlate_inbound_email(p_inbound_id uuid, p_in_reply_to text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  inbound public.messages_inbound%rowtype;
  needle text := btrim(coalesce(p_in_reply_to, ''));
  match_count int;
  ledger public.outreach_ledger%rowtype;
  outcome_result json;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'inbound-not-found'); end if;
  if inbound.channel <> 'Email' then return json_build_object('ok', false, 'reason', 'wrong-channel'); end if;
  if inbound.processed then return json_build_object('ok', true, 'correlated', inbound.candidate_id is not null, 'reason', 'already-processed'); end if;

  if needle = '' or needle !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    update public.messages_inbound
       set last_processing_error = 'no-in-reply-to',
           correlation_status = 'no_match'
     where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'no-in-reply-to');
  end if;

  select count(*) into match_count
    from public.outreach_ledger l
    where l.workspace_id = inbound.workspace_id
      and l.rfc_message_id = needle
      and l.status in ('sent', 'ambiguous');

  if match_count = 0 then
    update public.messages_inbound set last_processing_error = 'no-match', correlation_status = 'no_match' where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'no-match');
  end if;
  if match_count > 1 then
    update public.messages_inbound set last_processing_error = 'ambiguous', correlation_status = 'ambiguous' where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'ambiguous');
  end if;

  select * into ledger
    from public.outreach_ledger l
    where l.workspace_id = inbound.workspace_id
      and l.rfc_message_id = needle
      and l.status in ('sent', 'ambiguous');

  -- Record the reply outcome FIRST (idempotent, tombstone-skipping). Its
  -- result is the authoritative tombstone check: erasure scrubs
  -- outreach_ledger.candidate_id to 'erased:...' so re-materialization is
  -- already prevented, but if an erase races an in-flight correlate this
  -- catches it and we must not stamp the erased candidate onto the inbound.
  outcome_result := public.record_candidate_outcome(
    inbound.workspace_id, ledger.candidate_id, 'reply_received', 'reply:' || inbound.id::text, inbound.id);

  if outcome_result->>'reason' = 'candidate-erased' then
    update public.messages_inbound
       set correlated_ledger_id = ledger.id,
           correlated_outbound_id = ledger.outbound_message_id,
           sequence_id = ledger.sequence_id,
           sequence_step_id = ledger.sequence_step_id,
           correlation_status = 'correlated',
           processed = true,
           last_processing_error = 'candidate-erased'
     where id = inbound.id
       and processed = false;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'candidate-erased');
  end if;

  update public.messages_inbound
     set candidate_id = ledger.candidate_id,
         campaign_id = ledger.campaign_id,
         correlated_ledger_id = ledger.id,
         correlated_outbound_id = ledger.outbound_message_id,
         sequence_id = ledger.sequence_id,
         sequence_step_id = ledger.sequence_step_id,
         correlation_status = 'correlated',
         processed = true,
         last_processing_error = null
   where id = inbound.id
     and processed = false;
  if not found then
    return json_build_object('ok', true, 'correlated', false, 'reason', 'race-lost');
  end if;

  return json_build_object(
    'ok', true,
    'correlated', true,
    'candidate_id', ledger.candidate_id,
    'campaign_id', coalesce(ledger.campaign_id, ''),
    'sequence_id', ledger.sequence_id,
    'sequence_step_id', ledger.sequence_step_id,
    'ledger_id', ledger.id,
    'outbound_message_id', ledger.outbound_message_id,
    'outcome_recorded', coalesce(outcome_result->>'ok', 'false')::boolean
  );
end;
$_$;

--
-- Name: current_profile_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select role from public.profiles where id = auth.uid();
$$;

--
-- Name: current_workspace_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select workspace_id from public.profiles where id = auth.uid();
$$;

--
-- Name: enforce_active_email_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_active_email_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'Email' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

--
-- Name: enforce_active_linkedin_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_active_linkedin_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'LinkedIn' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

--
-- Name: enforce_agent_spec_authority_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_agent_spec_authority_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id then
    raise exception 'agent spec workspace_id and owner_id authority is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

--
-- Name: enforce_candidate_erasure_obligation_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_candidate_erasure_obligation_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: enqueue_email_outbound(text, text, text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_email_outbound(p_message_id text, p_candidate_id text, p_campaign_id text, p_seat_id uuid, p_recipient text, p_subject text, p_body text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  recipient text := lower(btrim(coalesce(p_recipient, '')));
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
begin
  if auth.uid() is null or wid is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;
  if p_candidate_id is null or length(p_candidate_id) < 1 or length(p_candidate_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-candidate');
  end if;
  if recipient = '' or recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;

  -- Deterministic per-draft de-dupe key: the same approved draft to the same
  -- recipient can never mint two wire-eligible rows, even across retries.
  dedupe := encode(
    digest('email' || E'\n' || p_candidate_id || E'\n' || recipient || E'\n' || p_message_id, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
    ) values (
      wid, p_candidate_id, p_seat_id, 'Email', recipient, 'candidate_reply',
      coalesce(p_subject, ''), p_body,
      'queued', dedupe, now(), p_message_id, p_campaign_id
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_outbound
      where workspace_id = wid and dedupe_hash = dedupe;
    return json_build_object(
      'ok', false,
      'status', coalesce(existing.status, 'queued'),
      'id', existing.id,
      'reason', 'duplicate'
    );
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$_$;

--
-- Name: ensure_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_workspace() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  uid    uuid := auth.uid();
  uemail text;
  domain text;
  wid    uuid;
  workspace_was_created boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- The function owner cannot read auth.users after the ownership hardening,
  -- so the verified email comes from the caller's GoTrue JWT claims (set by
  -- PostgREST; read directly so the function does not depend on auth.jwt()).
  uemail := nullif(btrim(coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    current_setting('request.jwt.claim.email', true),
    ''
  )), '');
  domain := lower(split_part(coalesce(uemail, 'user@workspace'), '@', 2));
  if domain = '' then domain := 'workspace'; end if;

  -- already provisioned?
  select workspace_id into wid from public.profiles where id = uid;
  if wid is not null then
    return wid;
  end if;

  -- shared org workspace, keyed by domain
  select id into wid from public.workspaces where allowed_domain = domain;
  if wid is null then
    insert into public.workspaces(name, allowed_domain)
      values (initcap(domain) || ' Workspace', domain)
      returning id into wid;
    workspace_was_created := true;
  end if;

  insert into public.profiles(id, email, full_name, workspace_id, role)
    values (
      uid,
      uemail,
      split_part(coalesce(uemail, 'user'), '@', 1),
      wid,
      -- First profile for a newly-created workspace starts as role='admin'.
      case when workspace_was_created then 'admin' else 'member' end
    )
    on conflict (id) do update
      set workspace_id = excluded.workspace_id,
          email = excluded.email,
          -- A pre-existing profile only becomes admin when this same call created
          -- the workspace. Joining an existing workspace never elevates role.
          role = case when workspace_was_created then 'admin' else public.profiles.role end;

  return wid;
end;
$$;

--
-- Name: fail_sourcing_run(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_error_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: finalize_email_provider_failure(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_email_provider_failure(p_message_id uuid, p_delivery_attempt_id uuid, p_reason text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  outbound public.messages_outbound%rowtype;
  ledger public.outreach_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_delivery_attempt_id is null then
    return json_build_object('allowed', false, 'reason', 'invalid-delivery-attempt');
  end if;
  if p_reason is null or length(btrim(p_reason)) < 1 or length(p_reason) > 512 then
    return json_build_object('allowed', false, 'reason', 'invalid-reason');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status <> 'dispatching' then
    return json_build_object('allowed', false, 'reason', 'not-dispatching');
  end if;

  select * into ledger
    from public.outreach_ledger
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
    for update;
  if not found or ledger.status <> 'claimed' then
    return json_build_object('allowed', false, 'reason', 'ledger-not-claimed');
  end if;

  update public.messages_outbound
    set status = 'failed'
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;
  if not found then raise exception 'outbox ownership changed during email failure finalization'; end if;

  update public.outreach_ledger
    set status = 'skipped',
        reason = p_reason
    where id = ledger.id
      and workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';
  if not found then raise exception 'ledger ownership changed during email failure finalization'; end if;

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

--
-- Name: gc_deleted_candidacies(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gc_deleted_candidacies() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  with aff as (
    select distinct workspace_id, person_id
      from gone
     where workspace_id is not null
       and person_id is not null
  )
  delete from public.candidate_identities identity
   using aff
   where identity.workspace_id = aff.workspace_id
     and identity.person_id = aff.person_id
     and not exists (
       select 1
         from public.candidates candidate
        where candidate.workspace_id = identity.workspace_id
          and candidate.person_id = identity.person_id
          and lower(btrim(coalesce(candidate.linkedin_url, ''))) = identity.value_normalized
     );

  with aff as (
    select distinct workspace_id, person_id
      from gone
     where workspace_id is not null
       and person_id is not null
  )
  delete from public.persons person
   using aff
   where person.workspace_id = aff.workspace_id
     and person.person_id = aff.person_id
     and not exists (
       select 1
         from public.candidates candidate
        where candidate.workspace_id = person.workspace_id
          and candidate.person_id = person.person_id
     );

  return null;
end;
$$;

--
-- Name: link_candidate_person(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_candidate_person() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_old_key text;
  v_new_key text;
begin
  if tg_op = 'UPDATE' then
    v_old_key := lower(btrim(coalesce(old.linkedin_url, '')));
    v_new_key := lower(btrim(coalesce(new.linkedin_url, '')));
    if new.person_id is not null and v_old_key = v_new_key then
      return null;
    end if;
  end if;

  begin
    perform public.link_one_candidate(new);

    if tg_op = 'UPDATE'
       and old.person_id is not null
       and lower(btrim(coalesce(old.linkedin_url, ''))) <> lower(btrim(coalesce(new.linkedin_url, '')))
       and old.linkedin_url is not null
       and btrim(old.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
      v_old_key := lower(btrim(old.linkedin_url));

      delete from public.candidate_identities identity
       where identity.workspace_id = old.workspace_id
         and identity.person_id = old.person_id
         and identity.kind = 'linkedin'
         and identity.value_normalized = v_old_key
         and not exists (
           select 1
             from public.candidates candidate
            where candidate.workspace_id = identity.workspace_id
              and candidate.person_id = identity.person_id
              and lower(btrim(coalesce(candidate.linkedin_url, ''))) = identity.value_normalized
         );

      delete from public.persons person
       where person.workspace_id = old.workspace_id
         and person.person_id = old.person_id
         and not exists (
           select 1
             from public.candidates candidate
            where candidate.workspace_id = person.workspace_id
              and candidate.person_id = person.person_id
         );
    end if;
  exception when others then
    raise warning 'candidate person linkage failed for ws %, campaign %, candidate %: %',
      new.workspace_id, new.campaign_id, new.id, sqlerrm;
  end;

  return null;
end;
$_$;

SET default_table_access_method = heap;

--
-- Name: candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidates (
    workspace_id uuid NOT NULL,
    campaign_id text NOT NULL,
    id text NOT NULL,
    email text,
    phone text,
    linkedin_url text,
    github_url text,
    source_url text,
    source_external_id text,
    source_authority_id text,
    source_platform text,
    name text,
    current_title text,
    current_company text,
    location text,
    match_score integer,
    stage text,
    years_experience integer,
    provenance text,
    created_at timestamp with time zone,
    last_contacted_at timestamp with time zone,
    payload jsonb NOT NULL,
    mirrored_at timestamp with time zone DEFAULT now() NOT NULL,
    person_id uuid,
    CONSTRAINT candidates_campaign_id_check CHECK (((char_length(campaign_id) >= 1) AND (char_length(campaign_id) <= 200))),
    CONSTRAINT candidates_id_check CHECK ((id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text))
);

ALTER TABLE ONLY public.candidates FORCE ROW LEVEL SECURITY;

--
-- Name: link_one_candidate(public.candidates); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_one_candidate(p_candidate public.candidates) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_key text;
  v_identity_count integer;
  v_person_id uuid;
begin
  if p_candidate.linkedin_url is not null
     and btrim(p_candidate.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
    v_key := lower(btrim(p_candidate.linkedin_url));
  end if;

  if v_key is null then
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  -- Tombstone-skip (defense-in-depth). The identifier HMAC helper RAISES when the workspace has no
  -- sourcing secret, and Postgres hoists that STABLE call out of the EXISTS predicate so it fires even
  -- against zero tombstone rows. Guard it: only compute the HMAC when LinkedIn tombstones actually
  -- exist for this workspace (no tombstones ⇒ nothing to skip; and a tombstone can only exist after
  -- its secret does, so the helper is safe once we are inside this branch).
  if exists (
    select 1 from public.candidate_erasure_suppression_tombstones t
     where t.workspace_id = p_candidate.workspace_id and t.identifier_kind = 'linkedin'
  ) then
    -- LinkedIn tombstones exist for this workspace ⇒ its secret exists ⇒ the HMAC helper is safe.
    if exists (
      select 1
        from public.candidate_erasure_suppression_tombstones tombstone
       where tombstone.workspace_id = p_candidate.workspace_id
         and tombstone.identifier_kind = 'linkedin'
         and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
           p_candidate.workspace_id,
           'linkedin',
           v_key
         )
    ) then
      update public.candidates candidate
         set person_id = null
       where candidate.workspace_id = p_candidate.workspace_id
         and candidate.campaign_id = p_candidate.campaign_id
         and candidate.id = p_candidate.id
         and candidate.person_id is not null;
      return null;
    end if;
  end if;

  select count(*)
    into v_identity_count
    from public.candidate_identities identity
   where identity.workspace_id = p_candidate.workspace_id
     and identity.kind = 'linkedin'
     and identity.value_normalized = v_key;

  if v_identity_count > 1 then
    raise warning 'ambiguous person identity for workspace %, linkedin %',
      p_candidate.workspace_id, v_key;
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  if v_identity_count = 1 then
    select identity.person_id
      into v_person_id
      from public.candidate_identities identity
     where identity.workspace_id = p_candidate.workspace_id
       and identity.kind = 'linkedin'
       and identity.value_normalized = v_key;
  end if;

  if v_person_id is null then
    insert into public.persons(workspace_id)
    values (p_candidate.workspace_id)
    returning person_id into v_person_id;
  end if;

  insert into public.candidate_identities(
    workspace_id, person_id, kind, value_normalized
  ) values (
    p_candidate.workspace_id, v_person_id, 'linkedin', v_key
  )
  on conflict (workspace_id, kind, value_normalized) do nothing;

  update public.candidates candidate
     set person_id = v_person_id
   where candidate.workspace_id = p_candidate.workspace_id
     and candidate.campaign_id = p_candidate.campaign_id
     and candidate.id = p_candidate.id
     and candidate.person_id is distinct from v_person_id;

  return v_person_id;
end;
$_$;

--
-- Name: list_candidate_erasure_requests(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_candidate_erasure_requests(p_workspace_id uuid, p_actor_id uuid, p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: list_pending_sourcing_feedback(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_pending_sourcing_feedback(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: list_promoted_sourcing_lessons(uuid, uuid, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_promoted_sourcing_lessons(p_workspace_id uuid, p_actor_id uuid, p_role_basis jsonb, p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: list_workspace_candidates(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_candidates(p_campaign_id text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'match'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(total bigint, payload jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  ws uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  safe_offset int := greatest(coalesce(p_offset, 0), 0);
  safe_sort text := case when p_sort in ('match', 'recent') then p_sort else 'match' end;
  escaped_search text;
begin
  if auth.uid() is null then
    return;
  end if;

  ws := public.current_workspace_id();
  if ws is null then
    return;
  end if;

  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    escaped_search := '%' || replace(replace(replace(btrim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  end if;

  return query
  with filtered as (
    select candidate.*
      from public.candidates candidate
     where candidate.workspace_id = ws
       and candidate.id <> ''
       and candidate.campaign_id <> ''
       and coalesce(candidate.name, '') <> ''
       and (p_campaign_id is null or candidate.campaign_id = p_campaign_id)
       and (p_stage is null or candidate.stage = p_stage)
       and (p_source is null or candidate.source_platform = p_source)
       and (
         escaped_search is null
         or candidate.name ilike escaped_search escape E'\\'
         or candidate.email ilike escaped_search escape E'\\'
         or candidate.current_title ilike escaped_search escape E'\\'
         or candidate.current_company ilike escaped_search escape E'\\'
       )
  ),
  total_count as (
    select count(*)::bigint as total from filtered
  ),
  paged as (
    select filtered.payload
      from filtered
     order by
       case when safe_sort = 'match' then filtered.match_score end desc nulls last,
       filtered.created_at desc nulls last
     limit safe_limit
     offset safe_offset
  )
  select total_count.total, paged.payload
    from total_count
    left join paged on true;
end;
$$;

--
-- Name: mirror_workspace_candidates(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mirror_workspace_candidates(p_workspace_id uuid, p_state jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if jsonb_typeof(p_state->'candidates') is distinct from 'array' then
    return;
  end if;

  insert into public.candidates (
    workspace_id,
    campaign_id,
    id,
    email,
    phone,
    linkedin_url,
    github_url,
    source_url,
    source_external_id,
    source_authority_id,
    source_platform,
    name,
    current_title,
    current_company,
    location,
    match_score,
    stage,
    years_experience,
    provenance,
    created_at,
    last_contacted_at,
    payload,
    mirrored_at
  )
  select
    p_workspace_id,
    live.campaign_id,
    live.id,
    live.email,
    live.phone,
    live.linkedin_url,
    live.github_url,
    live.source_url,
    live.source_external_id,
    live.source_authority_id,
    live.source_platform,
    live.name,
    live.current_title,
    live.current_company,
    live.location,
    live.match_score,
    live.stage,
    live.years_experience,
    live.provenance,
    live.created_at,
    live.last_contacted_at,
    live.payload,
    now()
  from (
    select distinct on (candidate.campaign_id, candidate.id)
      candidate.campaign_id,
      candidate.id,
      candidate.email,
      candidate.phone,
      candidate.linkedin_url,
      candidate.github_url,
      candidate.source_url,
      candidate.source_external_id,
      candidate.source_authority_id,
      candidate.source_platform,
      candidate.name,
      candidate.current_title,
      candidate.current_company,
      candidate.location,
      candidate.match_score,
      candidate.stage,
      candidate.years_experience,
      candidate.provenance,
      candidate.created_at,
      candidate.last_contacted_at,
      candidate.payload,
      candidate.ordinality
    from (
      select
        elem.value->>'campaignId' as campaign_id,
        elem.value->>'id' as id,
        nullif(elem.value->>'email', '') as email,
        nullif(elem.value->>'phone', '') as phone,
        nullif(elem.value->>'linkedinUrl', '') as linkedin_url,
        nullif(elem.value->>'githubUrl', '') as github_url,
        nullif(elem.value->>'sourceUrl', '') as source_url,
        nullif(elem.value->>'sourceExternalId', '') as source_external_id,
        nullif(elem.value->>'sourceAuthorityId', '') as source_authority_id,
        nullif(elem.value->>'sourcePlatform', '') as source_platform,
        nullif(elem.value->>'name', '') as name,
        nullif(elem.value->>'currentTitle', '') as current_title,
        nullif(elem.value->>'currentCompany', '') as current_company,
        nullif(elem.value->>'location', '') as location,
        nullif(elem.value->>'matchScore', '')::int as match_score,
        nullif(elem.value->>'stage', '') as stage,
        nullif(elem.value->>'yearsExperience', '')::int as years_experience,
        nullif(elem.value->>'provenance', '') as provenance,
        nullif(elem.value->>'createdAt', '')::timestamptz as created_at,
        nullif(elem.value->>'lastContactedAt', '')::timestamptz as last_contacted_at,
        elem.value as payload,
        elem.ordinality
      from jsonb_array_elements(p_state->'candidates')
        with ordinality elem(value, ordinality)
      where not exists (
        select 1
          from public.candidate_erasure_suppression_tombstones tombstone
         where tombstone.workspace_id = p_workspace_id
           and tombstone.identifier_kind = 'candidate_id'
           and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
             p_workspace_id,
             'candidate_id',
             elem.value->>'id'
           )
      )
    ) candidate
    order by candidate.campaign_id, candidate.id, candidate.ordinality
  ) live
  on conflict (workspace_id, campaign_id, id) do update set
    email = excluded.email,
    phone = excluded.phone,
    linkedin_url = excluded.linkedin_url,
    github_url = excluded.github_url,
    source_url = excluded.source_url,
    source_external_id = excluded.source_external_id,
    source_authority_id = excluded.source_authority_id,
    source_platform = excluded.source_platform,
    name = excluded.name,
    current_title = excluded.current_title,
    current_company = excluded.current_company,
    location = excluded.location,
    match_score = excluded.match_score,
    stage = excluded.stage,
    years_experience = excluded.years_experience,
    provenance = excluded.provenance,
    created_at = excluded.created_at,
    last_contacted_at = excluded.last_contacted_at,
    payload = excluded.payload,
    mirrored_at = excluded.mirrored_at;

  delete from public.candidates candidate
   where candidate.workspace_id = p_workspace_id
     and not exists (
       select 1
         from (
           select distinct
             elem.value->>'campaignId' as campaign_id,
             elem.value->>'id' as id
           from jsonb_array_elements(p_state->'candidates') elem(value)
           where not exists (
             select 1
               from public.candidate_erasure_suppression_tombstones tombstone
              where tombstone.workspace_id = p_workspace_id
                and tombstone.identifier_kind = 'candidate_id'
                and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
                  p_workspace_id,
                  'candidate_id',
                  elem.value->>'id'
                )
           )
         ) live
        where live.campaign_id = candidate.campaign_id
          and live.id = candidate.id
     );
end;
$$;

--
-- Name: place_candidate_legal_hold(uuid, uuid, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_reason_code text, p_case_reference text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: read_candidate_erasure_obligation_authority(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_candidate_erasure_obligation_authority(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: reconcile_calendar_booking(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_calendar_booking(p_workspace_id uuid, p_id uuid, p_status text, p_external_event_id text, p_detail text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  updated_row public.calendar_booking_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_id is null
     or p_status not in ('confirmed', 'failed', 'released')
     or (p_external_event_id is not null and char_length(p_external_event_id) > 512)
     or (p_detail is not null and char_length(p_detail) > 1000) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- One-shot terminal transition: only a row still 'claimed' may be
  -- reconciled. A delayed duplicate reconciliation call (e.g. two racing
  -- responses for the same attempt) can therefore never flip an
  -- already-confirmed booking to failed, or vice versa.
  update public.calendar_booking_ledger
     set status = p_status,
         external_event_id = coalesce(p_external_event_id, external_event_id),
         detail = p_detail,
         updated_at = now()
   where id = p_id
     and workspace_id = p_workspace_id
     and status = 'claimed'
  returning * into updated_row;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'reconciled',
    'id', updated_row.id,
    'booking_status', updated_row.status
  );
end;
$$;

--
-- Name: reconcile_candidate_erasure_obligation(uuid, uuid, uuid, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_candidate_erasure_obligation(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid, p_expected_attempt_count integer, p_status text, p_error_code text DEFAULT NULL::text, p_evidence_sha256 text DEFAULT NULL::text, p_case_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: record_candidate_outcome(uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_candidate_outcome(p_workspace_id uuid, p_candidate_id text, p_kind text, p_idempotency_key text, p_source_inbound_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_candidate_id is null or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    return json_build_object('ok', false, 'reason', 'invalid-candidate');
  end if;
  -- Erasure rewrites outreach_ledger.candidate_id to the reserved scrub token
  -- 'erased:<request-uuid>:<ledger-uuid>' (0033). That token was never
  -- tombstoned (the tombstone HMAC is over the ORIGINAL id), so the tombstone
  -- check below would MISS it and record a fresh outcome for an erased
  -- candidate. Fail closed on the EXACT scrub-token structure (two UUIDs) so a
  -- legitimate imported id like 'erased:external-123' is NOT falsely rejected
  -- (Codex P1).
  if p_candidate_id ~ '^erased:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return json_build_object('ok', false, 'reason', 'candidate-erased');
  end if;
  if p_kind is null or p_kind not in (
      'reply_received', 'interested', 'not_interested', 'ooo', 'booked',
      'bounced', 'unsubscribed', 'manual_stage_change', 'sequence_exhausted') then
    return json_build_object('ok', false, 'reason', 'invalid-kind');
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 1 or char_length(p_idempotency_key) > 200 then
    return json_build_object('ok', false, 'reason', 'invalid-idempotency-key');
  end if;

  -- Tombstone-skip: refuse to record an outcome for an erased candidate.
  if exists (
    select 1 from public.candidate_erasure_suppression_tombstones t
     where t.workspace_id = p_workspace_id and t.identifier_kind = 'candidate_id'
  ) then
    if exists (
      select 1 from public.candidate_erasure_suppression_tombstones tombstone
       where tombstone.workspace_id = p_workspace_id
         and tombstone.identifier_kind = 'candidate_id'
         and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
           p_workspace_id, 'candidate_id', p_candidate_id)
    ) then
      return json_build_object('ok', false, 'reason', 'candidate-erased');
    end if;
  end if;

  begin
    insert into public.candidate_outcome_events(workspace_id, candidate_id, kind, idempotency_key, source_inbound_id)
      values (p_workspace_id, p_candidate_id, p_kind, btrim(p_idempotency_key), p_source_inbound_id)
      returning id into new_id;
  exception when unique_violation then
    return json_build_object('ok', true, 'duplicate', true);
  end;

  return json_build_object('ok', true, 'duplicate', false, 'outcome_id', new_id);
end;
$_$;

--
-- Name: record_email_delivery_event(uuid, text, text, timestamp with time zone, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_email_delivery_event(p_workspace_id uuid, p_rfc_message_id text, p_event_status text, p_provider_occurred_at timestamp with time zone, p_provider_error_code integer DEFAULT NULL::integer, p_permanent boolean DEFAULT false) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  outbound public.messages_outbound%rowtype;
  recipient text;
  suppress boolean;
  event_is_new integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('recorded', false, 'reason', 'service-only');
  end if;
  if p_event_status not in ('delivered', 'bounced', 'complained', 'opened') then
    return json_build_object('recorded', false, 'reason', 'invalid-status');
  end if;
  if p_rfc_message_id is null or p_rfc_message_id !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    return json_build_object('recorded', false, 'reason', 'invalid-rfc-message-id');
  end if;
  if p_provider_occurred_at is null then
    return json_build_object('recorded', false, 'reason', 'invalid-event-time');
  end if;

  select * into outbound
    from public.messages_outbound
    where workspace_id = p_workspace_id
      and provider_message_id = p_rfc_message_id
      and channel = 'Email'
    for share;
  if not found then
    -- Synchronous-send path: the interactive /api/outreach/send never creates a
    -- messages_outbound row — it sends off outreach_ledger and stamps the RFC
    -- Message-ID there. A bounce/complaint for such a send MUST still suppress
    -- the address (CAN-SPAM / deliverability), so fall back to the ledger.
    select lower(btrim(coalesce(l.candidate_email, ''))) into recipient
      from public.outreach_ledger l
      where l.workspace_id = p_workspace_id
        and l.rfc_message_id = p_rfc_message_id
      for share;
    if recipient is null then
      return json_build_object('recorded', false, 'reason', 'outbound-not-found');
    end if;
    -- Durable receipt makes this branch replay-idempotent: a re-delivered event
    -- inserts nothing and does not touch the suppression (Codex).
    insert into public.email_ledger_delivery_receipts(
      workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at
    ) values (
      p_workspace_id, p_rfc_message_id, p_event_status, coalesce(p_permanent, false), p_provider_occurred_at
    ) on conflict (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at) do nothing;
    get diagnostics event_is_new = row_count;

    suppress := (p_event_status = 'bounced' and coalesce(p_permanent, false)) or p_event_status = 'complained';
    if suppress and event_is_new = 1 and recipient <> '' then
      insert into public.suppression_list(workspace_id, type, value, reason, source)
        values (
          p_workspace_id, 'email', recipient,
          case when p_event_status = 'complained' then 'spam-complaint' else 'hard-bounce' end,
          'system'
        )
      on conflict (workspace_id, type, value)
        do update set expires_at = null,
                      reason = excluded.reason,
                      source = excluded.source;
    end if;
    return json_build_object('recorded', true, 'reason', 'ledger-correlated', 'suppressed', suppress and event_is_new = 1);
  end if;
  if outbound.delivery_attempt_id is null then
    return json_build_object('recorded', false, 'reason', 'attempt-not-found');
  end if;

  insert into public.email_delivery_events(
    workspace_id,
    outbound_message_id,
    delivery_attempt_id,
    rfc_message_id,
    event_status,
    is_permanent,
    provider_occurred_at,
    provider_error
  ) values (
    outbound.workspace_id,
    outbound.id,
    outbound.delivery_attempt_id,
    p_rfc_message_id,
    p_event_status,
    coalesce(p_permanent, false),
    p_provider_occurred_at,
    case
      when p_provider_error_code is null then '{}'::jsonb
      else jsonb_build_object('code', p_provider_error_code)
    end
  ) on conflict on constraint email_delivery_events_dedupe_uniq do nothing;
  get diagnostics event_is_new = row_count;

  -- Permanent bounce or spam complaint -> never contact this address again.
  -- Only act on a genuinely NEW event (Codex P1): a replayed event inserts no
  -- delivery row and must not mutate a suppression an admin later expired.
  suppress := (p_event_status = 'bounced' and coalesce(p_permanent, false)) or p_event_status = 'complained';
  if suppress and event_is_new = 1 then
    recipient := lower(btrim(coalesce(outbound.to_address, '')));
    if recipient <> '' then
      insert into public.suppression_list(workspace_id, type, value, reason, source)
        values (
          outbound.workspace_id,
          'email',
          recipient,
          case when p_event_status = 'complained' then 'spam-complaint' else 'hard-bounce' end,
          'system'
        )
      on conflict (workspace_id, type, value)
        do update set expires_at = null,
                      reason = excluded.reason,
                      source = excluded.source;
    end if;
  end if;

  return json_build_object('recorded', true, 'reason', 'recorded', 'suppressed', suppress and event_is_new = 1);
end;
$_$;

--
-- Name: record_email_send_message_id(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_email_send_message_id(p_message_id uuid, p_delivery_attempt_id uuid, p_rfc_message_id text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  outbound public.messages_outbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_rfc_message_id is null or p_rfc_message_id !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    return json_build_object('allowed', false, 'reason', 'invalid-rfc-message-id');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status = 'sent' and outbound.provider_message_id = p_rfc_message_id then
    return json_build_object('allowed', true, 'reason', 'already-recorded');
  end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;

  update public.messages_outbound
    set status = 'sent',
        sent_at = now(),
        provider_message_id = p_rfc_message_id
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;
  if not found then raise exception 'outbox ownership changed during email send finalization'; end if;

  update public.outreach_ledger
    set status = 'sent',
        reason = null,
        rfc_message_id = p_rfc_message_id
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$_$;

--
-- Name: record_inbound_email(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_inbound_email(p_workspace_id uuid, p_provider_id text, p_from_address text, p_body text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  new_id uuid;
  existing public.messages_inbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_provider_id is null or char_length(btrim(p_provider_id)) < 1 or char_length(p_provider_id) > 512 then
    return json_build_object('ok', false, 'reason', 'invalid-provider-id');
  end if;
  if p_from_address is null or char_length(btrim(p_from_address)) < 3 then
    return json_build_object('ok', false, 'reason', 'invalid-from');
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return json_build_object('ok', false, 'reason', 'unknown-workspace');
  end if;

  begin
    insert into public.messages_inbound(workspace_id, channel, from_address, body, provider_id, processed)
      values (p_workspace_id, 'Email', lower(btrim(p_from_address)), coalesce(p_body, ''), btrim(p_provider_id), false)
      returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_inbound
      where workspace_id = p_workspace_id and channel = 'Email' and provider_id = btrim(p_provider_id);
    return json_build_object('ok', true, 'inbound_id', existing.id, 'duplicate', true);
  end;

  return json_build_object('ok', true, 'inbound_id', new_id, 'duplicate', false);
end;
$$;

--
-- Name: record_linkedin_delivery_outcome(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_linkedin_delivery_outcome(p_message_id uuid, p_delivery_attempt_id uuid, p_outcome text, p_reason text DEFAULT NULL::text, p_provider_message_id text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  outbound public.messages_outbound%rowtype;
  ledger public.outreach_ledger%rowtype;
  next_outbox_status text;
  next_ledger_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_outcome not in ('sent', 'skipped', 'ambiguous') then
    return json_build_object('allowed', false, 'reason', 'invalid-outcome');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;

  select * into ledger
    from public.outreach_ledger l
    where l.workspace_id = outbound.workspace_id
      and l.outbound_message_id = outbound.id
      and l.send_attempt_id = p_delivery_attempt_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'ledger-not-found'); end if;
  if ledger.status <> 'claimed' then return json_build_object('allowed', false, 'reason', 'ledger-not-claimed'); end if;

  next_outbox_status := case p_outcome when 'sent' then 'sent' else 'failed' end;
  next_ledger_status := p_outcome;

  update public.messages_outbound
    set status = next_outbox_status,
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        provider_message_id = coalesce(nullif(p_provider_message_id, ''), provider_message_id),
        gate_result = case
          when p_outcome = 'sent' then gate_result
          else jsonb_build_object('pass', false, 'reasons', jsonb_build_array(coalesce(nullif(p_reason, ''), 'linkedin-delivery-failed')))
        end
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;

  update public.outreach_ledger
    set status = next_ledger_status,
        reason = case when p_outcome = 'sent' then null else left(coalesce(p_reason, 'LinkedIn delivery failed.'), 512) end
    where id = ledger.id
      and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

--
-- Name: record_outreach_approval(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;
  if p_body_hash is null or p_approval_scope_hash is null
    or p_body_hash !~ '^[0-9a-f]{64}$' or p_approval_scope_hash !~ '^[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'reason', 'invalid-approval-hash');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;

  -- Re-check after locking the approval.  Otherwise a waiting record request
  -- can overwrite the approval that a completed claim just bound to the ledger.
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  if found then
    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  else
    insert into public.outreach_approvals(
      workspace_id,
      message_id,
      body_hash,
      approval_scope_hash,
      approved_by,
      approved_at,
      approval_source,
      revoked_at,
      revoked_by,
      revocation_reason
    ) values (
      wid,
      p_message_id,
      p_body_hash,
      p_approval_scope_hash,
      auth.uid(),
      now(),
      'human',
      null,
      null,
      null
    ) on conflict (workspace_id, message_id) do nothing;

    select * into approval
      from public.outreach_approvals
      where workspace_id = wid and message_id = p_message_id
      for update;
    if not found then return json_build_object('ok', false, 'reason', 'approval-record-failed'); end if;

    -- The conflict path is only reachable for a legacy/direct writer.  Check
    -- again after taking its row lock before allowing any mutation.
    if exists (
      select 1 from public.outreach_ledger l
        where l.workspace_id = wid
          and l.approval_message_id = p_message_id
          and l.status in ('claimed', 'sent')
    ) then
      return json_build_object('ok', false, 'reason', 'already-dispatching');
    end if;

    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  end if;

  return json_build_object('ok', true);
end;
$_$;

--
-- Name: record_sourcing_query_feedback(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_sourcing_query_feedback(p_workspace_id uuid, p_actor_id uuid, p_receipt_id uuid, p_verdict text, p_request_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: refresh_candidate_erasure_legal_hold_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_candidate_erasure_legal_hold_state(p_request_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: reject_candidate_erasure_receipt_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_candidate_erasure_receipt_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  raise exception 'candidate erasure receipts are append-only' using errcode = '42501';
end;
$$;

--
-- Name: reject_candidate_erasure_reimport(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_candidate_erasure_reimport() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: reject_email_connection_quarantine_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_email_connection_quarantine_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  raise exception 'email connection mismatch receipts are append-only'
    using errcode = '42501';
end;
$$;

--
-- Name: reject_sourcing_lesson_review_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_sourcing_lesson_review_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.sourcing_cleanup', true) = 'enabled' then
    return old;
  end if;
  raise exception 'sourcing lesson reviews are append-only' using errcode = '42501';
end;
$$;

--
-- Name: release_candidate_legal_hold(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_hold_id uuid, p_case_reference text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: release_elapsed_outreach_contact_window(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_elapsed_outreach_contact_window() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.status in ('claimed', 'sent', 'ambiguous') then
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || new.candidate_id, 1));
    update public.outreach_ledger
       set status = 'recontact_elapsed',
           reason = coalesce(reason, '90-day re-contact window elapsed')
     where workspace_id = new.workspace_id
       and candidate_id = new.candidate_id
       and status in ('claimed', 'sent', 'ambiguous')
       and at <= coalesce(new.at, now()) - interval '90 days';
  end if;
  return new;
end;
$$;

--
-- Name: release_enrichment_claim(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_enrichment_claim(p_ledger_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  update public.enrichment_spend_ledger
     set status = 'released', amount_cents = 0, settled_at = now()
   where id = p_ledger_id and status = 'claimed';
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'released' else 'not-claimed' end);
end; $$;

--
-- Name: request_candidate_erasure(uuid, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_candidate_erasure(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_request_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  workspace_record public.workspace_state%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  candidate jsonb;
  candidate_mirror public.candidates%rowtype;
  workspace_state_present boolean := false;
  workspace_state_candidate_present boolean := false;
  scrubbed_state jsonb;
  identities text[] := array[]::text[];
  phones text[] := array[]::text[];
  outbound_ids uuid[] := array[]::uuid[];
  approval_ids text[] := array[]::text[];
  conversation_ids uuid[] := array[]::uuid[];
  source_provider text;
  source_reference text;
  source_reference_payload jsonb;
  obligation_count integer := 0;
  workspace_state_count integer := 0;
  outbound_count integer := 0;
  inbound_count integer := 0;
  conversation_count integer := 0;
  ledger_count integer := 0;
  approval_count integer := 0;
  suppression_count integer := 0;
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
  workspace_state_present := found;

  if workspace_state_present and jsonb_typeof(workspace_record.state->'candidates') = 'array' then
    select item.value into candidate
      from jsonb_array_elements(workspace_record.state->'candidates') item(value)
     where item.value->>'id' = p_candidate_id
       and item.value->>'campaignId' = p_campaign_id
     limit 1;
    workspace_state_candidate_present := found;
  end if;

  if candidate is null then
    select * into candidate_mirror
      from public.candidates mirrored
     where mirrored.workspace_id = p_workspace_id
       and mirrored.campaign_id = p_campaign_id
       and mirrored.id = p_candidate_id
     limit 1;
    if found then
      candidate := candidate_mirror.payload;
    end if;
  end if;

  candidate := coalesce(candidate, jsonb_build_object(
    'id', p_candidate_id,
    'campaignId', p_campaign_id
  ));

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
  select coalesce(array_agg(distinct lower(btrim(value))) filter (
    where value is not null and btrim(value) <> ''
  ), array[]::text[])
    into identities
    from unnest(array[
      p_candidate_id, candidate->>'email', candidate->>'phone', candidate->>'linkedinUrl',
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
         coalesce(array_agg(distinct coalesce(message.approval_message_id, message.id::text)), array[]::text[])
    into outbound_ids, approval_ids
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
  delete from public.outreach_approvals approval
   where approval.workspace_id = p_workspace_id
     and approval.message_id = any(approval_ids);
  get diagnostics approval_count = row_count;

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
  if workspace_state_present then
    if jsonb_typeof(workspace_record.state) is distinct from 'object'
       or jsonb_typeof(workspace_record.state->'candidates') is distinct from 'array' then
      raise exception 'candidate workspace scrub failed' using errcode = 'P0001';
    end if;
    if workspace_state_candidate_present then
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
    end if;
  end if;

  insert into public.candidate_erasure_receipts(request_id, workspace_id, store_name, scrubbed_rows)
  values
    (request_record.id, p_workspace_id, 'workspace_state', workspace_state_count),
    (request_record.id, p_workspace_id, 'messages_outbound', outbound_count),
    (request_record.id, p_workspace_id, 'messages_inbound', inbound_count),
    (request_record.id, p_workspace_id, 'agent_conversations', conversation_count),
    (request_record.id, p_workspace_id, 'outreach_ledger', ledger_count),
    (request_record.id, p_workspace_id, 'outreach_approvals', approval_count),
    (request_record.id, p_workspace_id, 'suppression_list', suppression_count)
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
$_$;

--
-- Name: resolve_inbound_mailbox_route(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_inbound_mailbox_route(p_mailbox text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  route public.inbound_mailbox_routes%rowtype;
  needle text := lower(btrim(coalesce(p_mailbox, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if needle = '' then
    return json_build_object('ok', false, 'reason', 'invalid-mailbox');
  end if;

  select * into route
    from public.inbound_mailbox_routes
    where mailbox_address = needle and active;
  if not found then
    return json_build_object('ok', false, 'reason', 'no-route');
  end if;

  return json_build_object(
    'ok', true,
    'workspace_id', route.workspace_id,
    'connection_id', route.connection_id,
    'purpose', route.purpose
  );
end;
$$;

--
-- Name: review_sourcing_lesson(uuid, uuid, uuid, bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_sourcing_lesson(p_workspace_id uuid, p_reviewer_id uuid, p_lesson_id uuid, p_expected_version bigint, p_decision text, p_reason_code text, p_request_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;

--
-- Name: revoke_outreach_approval(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_outreach_approval(p_message_id text, p_reason text DEFAULT 'Operator rejected the outreach draft.'::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;

  -- Outbox claims own a queued outbox row before taking the advisory lock.
  -- Taking the same row first keeps the common lock order:
  -- outbox -> advisory key -> approval row.
  perform 1
    from public.messages_outbound
    where workspace_id = wid
      and coalesce(approval_message_id, id::text) = p_message_id
      and status = 'queued'
    for update;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('ok', true, 'revoked', false, 'reason', 'not-found'); end if;
  if approval.revoked_at is not null then return json_build_object('ok', true, 'revoked', false, 'reason', 'already-revoked'); end if;
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  update public.outreach_approvals
    set revoked_at = now(),
        revoked_by = auth.uid(),
        revocation_reason = left(coalesce(nullif(trim(p_reason), ''), 'Operator rejected the outreach draft.'), 500)
    where id = approval.id;

  update public.messages_outbound
    set status = 'blocked',
        gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('approval-revoked'))
    where workspace_id = wid
      and coalesce(approval_message_id, id::text) = p_message_id
      and status = 'queued';

  return json_build_object('ok', true, 'revoked', true);
end;
$$;

--
-- Name: scrub_candidate_workspace_document(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scrub_candidate_workspace_document(p_state jsonb, p_candidate_id text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: settle_enrichment_spend(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_enrichment_spend(p_ledger_id uuid, p_actual_cents integer) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare claim public.enrichment_spend_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if p_actual_cents is null or p_actual_cents < 0 then return json_build_object('ok', false, 'reason', 'invalid-amount'); end if;
  select * into claim from public.enrichment_spend_ledger
   where id = p_ledger_id and status = 'claimed' for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'not-claimed');
  end if;
  -- Settlement is capped at the reservation (Codex P1-16): a claim reserves
  -- authority up to amount_cents; a larger actual charge needs a NEW claim
  -- against the current budget, never a retroactive settlement.
  if p_actual_cents > claim.amount_cents then
    return json_build_object('ok', false, 'reason', 'exceeds-claim',
                             'claimed_cents', claim.amount_cents,
                             'actual_cents', p_actual_cents);
  end if;
  update public.enrichment_spend_ledger
     set status = 'settled', amount_cents = p_actual_cents, settled_at = now()
   where id = p_ledger_id;
  return json_build_object('ok', true, 'reason', 'settled');
end; $$;

--
-- Name: settle_provider_run(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_provider_run(p_run_id uuid, p_succeeded boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  update public.sourcing_provider_runs
     set status = case when p_succeeded then 'succeeded' else 'failed' end, settled_at = now()
   where id = p_run_id and status = 'running';
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'settled' else 'not-running' end);
end; $$;

--
-- Name: settle_provider_run_by_external(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_provider_run_by_external(p_workspace_id uuid, p_provider text, p_external_run_id text, p_succeeded boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  run_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  select id into run_id
    from public.sourcing_provider_runs
   where workspace_id = p_workspace_id
     and provider = p_provider
     and external_run_id = p_external_run_id;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  return public.settle_provider_run(run_id, p_succeeded);
end; $$;

--
-- Name: sourcing_authority_hmac(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_authority_hmac(p_workspace_id uuid, p_value text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

--
-- Name: stamp_dust_connection_authority(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_dust_connection_authority() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.config_revision := 1;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.id := old.id;
    new.workspace_id := old.workspace_id;
    new.credential_provider := old.credential_provider;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
    new.config_revision := old.config_revision + 1;
  end if;
  return new;
end;
$$;

--
-- Name: strip_legacy_dust_authority(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strip_legacy_dust_authority() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.state #> '{settings,dust}' is not null then
    new.state := new.state #- '{settings,dust}';
  end if;
  return new;
end;
$$;

--
-- Name: sync_candidates_corpus(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_candidates_corpus() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if jsonb_typeof(new.state->'candidates') is distinct from 'array' then
    return null;
  end if;

  begin
    perform public.mirror_workspace_candidates(new.workspace_id, new.state);
  exception when others then
    raise warning 'candidates mirror sync failed for ws %: %', new.workspace_id, sqlerrm;
  end;

  return null;
end;
$$;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

--
-- Name: validate_sourcing_learning_query(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_sourcing_learning_query(p_platform text, p_query text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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

--
-- Name: agent_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    spec_id uuid,
    candidate_id text NOT NULL,
    channel text NOT NULL,
    provider_thread_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_inbound_at timestamp with time zone,
    owner_id uuid,
    CONSTRAINT agent_conversations_channel_check CHECK ((channel = ANY (ARRAY['Email'::text, 'LinkedIn'::text, 'WhatsApp'::text, 'SMS'::text]))),
    CONSTRAINT agent_conversations_owner_spec_shape_check CHECK ((((owner_id IS NULL) AND (spec_id IS NULL)) OR ((owner_id IS NOT NULL) AND (spec_id IS NOT NULL)))),
    CONSTRAINT agent_conversations_provider_thread_key_check CHECK (((length(btrim(provider_thread_key)) >= 1) AND (length(btrim(provider_thread_key)) <= 512)))
);

--
-- Name: agent_seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_seats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    operator_email text NOT NULL,
    provider text DEFAULT 'Microsoft Graph'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    mode text DEFAULT 'mock'::text NOT NULL,
    domain_verified boolean DEFAULT false NOT NULL,
    daily_limit integer DEFAULT 40 NOT NULL,
    warmup boolean DEFAULT true NOT NULL,
    warmup_start_cap integer DEFAULT 10 NOT NULL,
    warmup_step_per_day integer DEFAULT 4 NOT NULL,
    warmup_started_at timestamp with time zone DEFAULT now() NOT NULL,
    min_gap_minutes integer DEFAULT 12 NOT NULL,
    persona text DEFAULT ''::text NOT NULL,
    signature text DEFAULT ''::text NOT NULL,
    connected_account text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_specs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_specs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    role_brief jsonb NOT NULL,
    channels text[] DEFAULT '{Email}'::text[] NOT NULL,
    guardrails jsonb DEFAULT '{"autopilot": false, "canary_remaining": 5}'::jsonb NOT NULL,
    flowise_chatflow_id text,
    seat_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_specs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
);

--
-- Name: COLUMN agent_specs.flowise_chatflow_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agent_specs.flowise_chatflow_id IS 'Deprecated and intentionally null. Use service-owned agent_workflow_versions.';

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    secret text NOT NULL,
    last4 text NOT NULL,
    status text DEFAULT 'untested'::text NOT NULL,
    last_tested_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: calendar_booking_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_booking_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    candidate_id text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    request_id text NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'claimed'::text NOT NULL,
    external_event_id text,
    detail text,
    processing_lease_until timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_booking_ledger_candidate_id_check CHECK (((char_length(candidate_id) >= 1) AND (char_length(candidate_id) <= 200))),
    CONSTRAINT calendar_booking_ledger_detail_check CHECK (((detail IS NULL) OR (char_length(detail) <= 1000))),
    CONSTRAINT calendar_booking_ledger_external_event_id_check CHECK (((external_event_id IS NULL) OR ((char_length(external_event_id) >= 1) AND (char_length(external_event_id) <= 512)))),
    CONSTRAINT calendar_booking_ledger_provider_check CHECK ((provider = ANY (ARRAY['Gmail API'::text, 'Microsoft Graph'::text]))),
    CONSTRAINT calendar_booking_ledger_request_id_check CHECK ((request_id ~ '^[A-Za-z0-9._:-]{1,100}$'::text)),
    CONSTRAINT calendar_booking_ledger_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'confirmed'::text, 'failed'::text, 'released'::text])))
);

ALTER TABLE ONLY public.calendar_booking_ledger FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_erasure_obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    provider text NOT NULL,
    reference_hmac text NOT NULL,
    reference_ciphertext bytea,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error_code text,
    next_attempt_at timestamp with time zone,
    completion_evidence_sha256 text,
    completion_case_reference text,
    completed_by uuid,
    authority_access_count integer DEFAULT 0 NOT NULL,
    authority_last_accessed_at timestamp with time zone,
    authority_last_accessed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT candidate_erasure_obligations_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 100))),
    CONSTRAINT candidate_erasure_obligations_authority_access_count_check CHECK (((authority_access_count >= 0) AND (authority_access_count <= 1000))),
    CONSTRAINT candidate_erasure_obligations_check CHECK ((((status = 'completed'::text) AND (completed_at IS NOT NULL) AND (last_error_code IS NULL) AND (next_attempt_at IS NULL) AND (completion_evidence_sha256 IS NOT NULL) AND (completion_case_reference IS NOT NULL) AND (completed_by IS NOT NULL) AND (reference_ciphertext IS NULL)) OR ((status = 'retryable_failure'::text) AND (completed_at IS NULL) AND (last_error_code IS NOT NULL) AND (next_attempt_at IS NOT NULL) AND (completion_evidence_sha256 IS NULL) AND (completion_case_reference IS NULL) AND (completed_by IS NULL) AND (reference_ciphertext IS NOT NULL)) OR ((status = ANY (ARRAY['pending_provider'::text, 'manual_required'::text, 'blocked_legal_hold'::text])) AND (completed_at IS NULL) AND (last_error_code IS NULL) AND (next_attempt_at IS NULL) AND (completion_evidence_sha256 IS NULL) AND (reference_ciphertext IS NOT NULL) AND (completion_case_reference IS NULL) AND (completed_by IS NULL)))),
    CONSTRAINT candidate_erasure_obligations_check1 CHECK ((((authority_access_count = 0) AND (authority_last_accessed_at IS NULL) AND (authority_last_accessed_by IS NULL)) OR ((authority_access_count > 0) AND (authority_last_accessed_at IS NOT NULL) AND (authority_last_accessed_by IS NOT NULL)))),
    CONSTRAINT candidate_erasure_obligations_completion_case_reference_check CHECK (((completion_case_reference IS NULL) OR (completion_case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'::text))),
    CONSTRAINT candidate_erasure_obligations_completion_evidence_sha256_check CHECK (((completion_evidence_sha256 IS NULL) OR (completion_evidence_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT candidate_erasure_obligations_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text))),
    CONSTRAINT candidate_erasure_obligations_provider_check CHECK ((provider ~ '^[a-z][a-z0-9._:-]{0,63}$'::text)),
    CONSTRAINT candidate_erasure_obligations_reference_ciphertext_check CHECK (((reference_ciphertext IS NULL) OR ((octet_length(reference_ciphertext) >= 32) AND (octet_length(reference_ciphertext) <= 4096)))),
    CONSTRAINT candidate_erasure_obligations_reference_hmac_check CHECK ((reference_hmac ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT candidate_erasure_obligations_status_check CHECK ((status = ANY (ARRAY['pending_provider'::text, 'manual_required'::text, 'retryable_failure'::text, 'completed'::text, 'blocked_legal_hold'::text])))
);

ALTER TABLE ONLY public.candidate_erasure_obligations FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_erasure_receipts (
    id bigint NOT NULL,
    request_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    store_name text NOT NULL,
    scrubbed_rows integer NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_erasure_receipts_scrubbed_rows_check CHECK ((scrubbed_rows >= 0)),
    CONSTRAINT candidate_erasure_receipts_store_name_check CHECK ((store_name = ANY (ARRAY['workspace_state'::text, 'messages_outbound'::text, 'messages_inbound'::text, 'agent_conversations'::text, 'outreach_ledger'::text, 'outreach_approvals'::text, 'suppression_list'::text, 'whatsapp_contacts'::text, 'whatsapp_conversation_windows'::text, 'whatsapp_delivery_events'::text, 'outbound_content_cache'::text, 'apollo_enrichment'::text, 'agent_runs'::text, 'agent_events'::text, 'agent_framework_results'::text, 'loop_events'::text])))
);

ALTER TABLE ONLY public.candidate_erasure_receipts FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidate_erasure_receipts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidate_erasure_receipts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: candidate_erasure_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_erasure_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    campaign_id text NOT NULL,
    candidate_id text NOT NULL,
    actor_id uuid NOT NULL,
    request_key uuid NOT NULL,
    status text NOT NULL,
    local_scrub_completed_at timestamp with time zone,
    provider_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_erasure_requests_campaign_id_check CHECK ((campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text)),
    CONSTRAINT candidate_erasure_requests_candidate_id_check CHECK ((candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text)),
    CONSTRAINT candidate_erasure_requests_state_check CHECK ((((status = 'blocked_legal_hold'::text) AND (provider_completed_at IS NULL)) OR ((status = ANY (ARRAY['pending_provider'::text, 'manual_required'::text, 'retryable_failure'::text])) AND (local_scrub_completed_at IS NOT NULL) AND (provider_completed_at IS NULL)) OR ((status = 'completed'::text) AND (local_scrub_completed_at IS NOT NULL) AND (provider_completed_at IS NOT NULL)))),
    CONSTRAINT candidate_erasure_requests_status_check CHECK ((status = ANY (ARRAY['pending_provider'::text, 'manual_required'::text, 'retryable_failure'::text, 'completed'::text, 'blocked_legal_hold'::text])))
);

ALTER TABLE ONLY public.candidate_erasure_requests FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_suppression_tombstones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_erasure_suppression_tombstones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    identifier_kind text NOT NULL,
    identifier_hmac text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_erasure_suppression_tombstones_identifier_hmac_check CHECK ((identifier_hmac ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT candidate_erasure_suppression_tombstones_identifier_kind_check CHECK ((identifier_kind = ANY (ARRAY['candidate_id'::text, 'email'::text, 'phone'::text, 'linkedin'::text, 'github'::text, 'source_url'::text, 'source_external_id'::text, 'source_authority_id'::text, 'provider_external_id'::text])))
);

ALTER TABLE ONLY public.candidate_erasure_suppression_tombstones FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_identities (
    workspace_id uuid NOT NULL,
    person_id uuid NOT NULL,
    kind text NOT NULL,
    value_normalized text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_identities_kind_check CHECK ((kind = 'linkedin'::text)),
    CONSTRAINT candidate_identities_value_normalized_check CHECK (((char_length(value_normalized) >= 1) AND (char_length(value_normalized) <= 500)))
);

ALTER TABLE ONLY public.candidate_identities FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_legal_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_legal_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    campaign_id text NOT NULL,
    candidate_id text NOT NULL,
    reason_code text NOT NULL,
    case_reference text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    placed_by uuid NOT NULL,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    released_by uuid,
    released_at timestamp with time zone,
    release_case_reference text,
    CONSTRAINT candidate_legal_holds_campaign_id_check CHECK ((campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text)),
    CONSTRAINT candidate_legal_holds_candidate_id_check CHECK ((candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text)),
    CONSTRAINT candidate_legal_holds_case_reference_check CHECK ((case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'::text)),
    CONSTRAINT candidate_legal_holds_check CHECK ((((status = 'active'::text) AND (released_by IS NULL) AND (released_at IS NULL) AND (release_case_reference IS NULL)) OR ((status = 'released'::text) AND (released_by IS NOT NULL) AND (released_at IS NOT NULL) AND (release_case_reference IS NOT NULL)) OR ((status = 'expired'::text) AND (expires_at IS NOT NULL) AND (released_by IS NULL) AND (released_at IS NULL) AND (release_case_reference IS NULL)))),
    CONSTRAINT candidate_legal_holds_check1 CHECK (((expires_at IS NULL) OR (expires_at > placed_at))),
    CONSTRAINT candidate_legal_holds_reason_code_check CHECK ((reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)),
    CONSTRAINT candidate_legal_holds_release_case_reference_check CHECK (((release_case_reference IS NULL) OR (release_case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'::text))),
    CONSTRAINT candidate_legal_holds_status_check CHECK ((status = ANY (ARRAY['active'::text, 'released'::text, 'expired'::text])))
);

ALTER TABLE ONLY public.candidate_legal_holds FORCE ROW LEVEL SECURITY;

--
-- Name: candidate_outcome_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_outcome_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    candidate_id text NOT NULL,
    kind text NOT NULL,
    idempotency_key text NOT NULL,
    source_inbound_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_outcome_events_candidate_id_check CHECK ((candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'::text)),
    CONSTRAINT candidate_outcome_events_idempotency_key_check CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200))),
    CONSTRAINT candidate_outcome_events_kind_check CHECK ((kind = ANY (ARRAY['reply_received'::text, 'interested'::text, 'not_interested'::text, 'ooo'::text, 'booked'::text, 'bounced'::text, 'unsubscribed'::text, 'manual_stage_change'::text, 'sequence_exhausted'::text])))
);

ALTER TABLE ONLY public.candidate_outcome_events FORCE ROW LEVEL SECURITY;

--
-- Name: dust_connection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dust_connection_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    config_revision bigint NOT NULL,
    config_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dust_connection_events_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))),
    CONSTRAINT dust_connection_events_config_hash_check CHECK ((config_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.dust_connection_events FORCE ROW LEVEL SECURITY;

--
-- Name: dust_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dust_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    dust_workspace_id text NOT NULL,
    region text DEFAULT 'us'::text NOT NULL,
    api_key_id uuid NOT NULL,
    credential_provider text DEFAULT 'Dust'::text NOT NULL,
    agent_locks jsonb DEFAULT '{}'::jsonb NOT NULL,
    agents jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config_revision bigint DEFAULT 1 NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dust_connections_agent_locks_check CHECK ((jsonb_typeof(agent_locks) = 'object'::text)),
    CONSTRAINT dust_connections_agents_check CHECK ((jsonb_typeof(agents) = 'array'::text)),
    CONSTRAINT dust_connections_provider_check CHECK ((credential_provider = 'Dust'::text)),
    CONSTRAINT dust_connections_region_check CHECK ((region = ANY (ARRAY['us'::text, 'eu'::text]))),
    CONSTRAINT dust_connections_revision_check CHECK ((config_revision > 0)),
    CONSTRAINT dust_connections_workspace_id_check CHECK (((length(btrim(dust_workspace_id)) >= 1) AND (length(btrim(dust_workspace_id)) <= 256)))
);

ALTER TABLE ONLY public.dust_connections FORCE ROW LEVEL SECURITY;

--
-- Name: email_connection_seat_mismatch_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_connection_seat_mismatch_quarantine (
    connection_id uuid NOT NULL,
    quarantine_reason text DEFAULT 'cross_workspace_seat_binding'::text NOT NULL,
    quarantined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_connection_seat_mismatch_quaranti_quarantine_reason_check CHECK ((quarantine_reason = 'cross_workspace_seat_binding'::text)),
    CONSTRAINT email_connection_seat_mismatch_quarantine_quarantine_reason_che CHECK ((quarantine_reason = 'cross_workspace_seat_binding'::text))
);

ALTER TABLE ONLY public.email_connection_seat_mismatch_quarantine FORCE ROW LEVEL SECURITY;

--
-- Name: email_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    seat_id uuid NOT NULL,
    provider text NOT NULL,
    account_email text NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scope text DEFAULT ''::text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_connections_provider_check CHECK ((provider = ANY (ARRAY['Gmail API'::text, 'Microsoft Graph'::text])))
);

--
-- Name: email_delivery_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_delivery_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    outbound_message_id uuid NOT NULL,
    delivery_attempt_id uuid NOT NULL,
    rfc_message_id text NOT NULL,
    event_status text NOT NULL,
    is_permanent boolean DEFAULT false NOT NULL,
    provider_occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_error jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT email_delivery_events_event_status_check CHECK ((event_status = ANY (ARRAY['delivered'::text, 'bounced'::text, 'complained'::text, 'opened'::text]))),
    CONSTRAINT email_delivery_events_rfc_message_id_check CHECK ((rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'::text))
);

ALTER TABLE ONLY public.email_delivery_events FORCE ROW LEVEL SECURITY;

--
-- Name: email_ledger_delivery_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_ledger_delivery_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    rfc_message_id text NOT NULL,
    event_status text NOT NULL,
    is_permanent boolean DEFAULT false NOT NULL,
    provider_occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_ledger_delivery_receipts_event_status_check CHECK ((event_status = ANY (ARRAY['delivered'::text, 'bounced'::text, 'complained'::text, 'opened'::text]))),
    CONSTRAINT email_ledger_delivery_receipts_rfc_message_id_check CHECK ((rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'::text))
);

ALTER TABLE ONLY public.email_ledger_delivery_receipts FORCE ROW LEVEL SECURITY;

--
-- Name: enrichment_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_budgets (
    workspace_id uuid NOT NULL,
    period text NOT NULL,
    budget_cents integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrichment_budgets_budget_cents_check CHECK ((budget_cents >= 0)),
    CONSTRAINT enrichment_budgets_period_check CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text))
);

ALTER TABLE ONLY public.enrichment_budgets FORCE ROW LEVEL SECURITY;

--
-- Name: enrichment_spend_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_spend_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    period text NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'claimed'::text NOT NULL,
    amount_cents integer NOT NULL,
    provider text,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT enrichment_spend_ledger_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT enrichment_spend_ledger_idempotency_key_check CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200))),
    CONSTRAINT enrichment_spend_ledger_period_check CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text)),
    CONSTRAINT enrichment_spend_ledger_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'settled'::text, 'released'::text])))
);

ALTER TABLE ONLY public.enrichment_spend_ledger FORCE ROW LEVEL SECURITY;

--
-- Name: inbound_mailbox_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound_mailbox_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    mailbox_address text NOT NULL,
    connection_id uuid,
    purpose text DEFAULT 'reply'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbound_mailbox_routes_mailbox_address_check CHECK ((((char_length(mailbox_address) >= 3) AND (char_length(mailbox_address) <= 320)) AND (mailbox_address = lower(mailbox_address)))),
    CONSTRAINT inbound_mailbox_routes_purpose_check CHECK ((purpose = ANY (ARRAY['reply'::text, 'intake'::text])))
);

ALTER TABLE ONLY public.inbound_mailbox_routes FORCE ROW LEVEL SECURITY;

--
-- Name: messages_inbound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages_inbound (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    candidate_id text,
    channel text NOT NULL,
    from_address text NOT NULL,
    body text NOT NULL,
    provider_id text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed boolean DEFAULT false NOT NULL,
    processing_attempts integer DEFAULT 0 NOT NULL,
    last_processing_attempt_at timestamp with time zone,
    last_processing_error text,
    processing_claim_id uuid,
    processing_lease_until timestamp with time zone,
    conversation_id uuid,
    owner_id uuid,
    correlated_ledger_id uuid,
    correlated_outbound_id uuid,
    campaign_id text,
    sequence_id uuid,
    sequence_step_id uuid,
    correlation_status text DEFAULT 'unresolved'::text NOT NULL,
    inbox_status text DEFAULT 'open'::text NOT NULL,
    CONSTRAINT messages_inbound_channel_check CHECK ((channel = ANY (ARRAY['Email'::text, 'LinkedIn'::text, 'WhatsApp'::text, 'SMS'::text]))),
    CONSTRAINT messages_inbound_conversation_owner_shape_check CHECK ((((conversation_id IS NULL) AND (owner_id IS NULL)) OR ((conversation_id IS NOT NULL) AND (owner_id IS NOT NULL)))),
    CONSTRAINT messages_inbound_correlation_status_check CHECK ((correlation_status = ANY (ARRAY['unresolved'::text, 'correlated'::text, 'ambiguous'::text, 'no_match'::text]))),
    CONSTRAINT messages_inbound_inbox_status_check CHECK ((inbox_status = ANY (ARRAY['open'::text, 'triaged'::text, 'closed'::text])))
);

--
-- Name: messages_outbound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages_outbound (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    spec_id uuid,
    candidate_id text NOT NULL,
    seat_id uuid,
    channel text NOT NULL,
    to_address text DEFAULT ''::text NOT NULL,
    type text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'composed'::text NOT NULL,
    gate_result jsonb,
    dedupe_hash text NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_e164 text,
    approval_message_id text,
    template_parameters jsonb DEFAULT '[]'::jsonb NOT NULL,
    content_hash text,
    policy_snapshot jsonb,
    provider_message_id text,
    delivery_attempt_id uuid,
    dispatching_at timestamp with time zone,
    inbound_message_id uuid,
    conversation_id uuid,
    owner_id uuid,
    campaign_id text,
    sequence_id uuid,
    sequence_step_id uuid,
    CONSTRAINT messages_outbound_channel_check CHECK ((channel = ANY (ARRAY['Email'::text, 'LinkedIn'::text, 'WhatsApp'::text, 'SMS'::text]))),
    CONSTRAINT messages_outbound_conversation_owner_shape_check CHECK (((conversation_id IS NULL) OR (owner_id IS NOT NULL))),
    CONSTRAINT messages_outbound_owner_spec_shape_check CHECK (((spec_id IS NULL) OR (owner_id IS NOT NULL))),
    CONSTRAINT messages_outbound_status_check CHECK ((status = ANY (ARRAY['composed'::text, 'queued'::text, 'blocked'::text, 'dispatching'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT messages_outbound_type_check CHECK ((type = ANY (ARRAY['candidate_reply'::text, 'approved_template'::text])))
);

--
-- Name: outreach_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    message_id text NOT NULL,
    body_hash text NOT NULL,
    approved_by uuid NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    approval_source text DEFAULT 'human'::text NOT NULL,
    approval_scope_hash text,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revocation_reason text,
    CONSTRAINT outreach_approvals_approval_source_check CHECK ((approval_source = ANY (ARRAY['human'::text, 'legacy_unverified'::text])))
);

--
-- Name: COLUMN outreach_approvals.approval_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outreach_approvals.approval_source IS 'Only human approvals may release an external message. Pre-provenance rows are legacy_unverified and require re-approval.';

--
-- Name: outreach_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    candidate_id text NOT NULL,
    candidate_email text NOT NULL,
    seat_id uuid,
    campaign_id text,
    channel text DEFAULT 'Email'::text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    reason text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    outbound_message_id uuid,
    approval_message_id text,
    email_unsubscribe_token_hash text,
    send_attempt_id uuid,
    rfc_message_id text,
    sequence_id uuid,
    sequence_step_id uuid
);

--
-- Name: persons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persons (
    workspace_id uuid NOT NULL,
    person_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.persons FORCE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    workspace_id uuid,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: sourcing_graphify_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_graphify_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    export_payload jsonb NOT NULL,
    status text DEFAULT 'exported'::text NOT NULL,
    input_sha256 text,
    graph_sha256 text,
    graph_text text,
    manifest jsonb,
    image_digest text,
    graphify_commit text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '180 days'::interval) NOT NULL,
    CONSTRAINT sourcing_graphify_exports_graph_sha256_check CHECK (((graph_sha256 IS NULL) OR (graph_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_graphify_exports_graph_text_check CHECK (((graph_text IS NULL) OR ((octet_length(graph_text) >= 2) AND (octet_length(graph_text) <= 5242880)))),
    CONSTRAINT sourcing_graphify_exports_graphify_commit_check CHECK (((graphify_commit IS NULL) OR (graphify_commit ~ '^[0-9a-f]{40}$'::text))),
    CONSTRAINT sourcing_graphify_exports_image_digest_check CHECK (((image_digest IS NULL) OR (image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_graphify_exports_input_sha256_check CHECK (((input_sha256 IS NULL) OR (input_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_graphify_exports_state_coherence CHECK ((((status = 'exported'::text) AND (input_sha256 IS NULL) AND (graph_sha256 IS NULL) AND (graph_text IS NULL) AND (manifest IS NULL) AND (image_digest IS NULL) AND (graphify_commit IS NULL) AND (completed_at IS NULL)) OR ((status = 'completed'::text) AND (input_sha256 IS NOT NULL) AND (graph_sha256 IS NOT NULL) AND (graph_text IS NOT NULL) AND (manifest IS NOT NULL) AND (image_digest IS NOT NULL) AND (graphify_commit IS NOT NULL) AND (completed_at IS NOT NULL)))),
    CONSTRAINT sourcing_graphify_exports_status_check CHECK ((status = ANY (ARRAY['exported'::text, 'completed'::text])))
);

ALTER TABLE ONLY public.sourcing_graphify_exports FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_learning_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_learning_controls (
    workspace_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    workspace_daily_limit integer DEFAULT 100 NOT NULL,
    user_daily_limit integer DEFAULT 25 NOT NULL,
    min_evidence_runs integer DEFAULT 2 NOT NULL,
    lesson_ttl_days integer DEFAULT 90 NOT NULL,
    required_graphify_commit text DEFAULT '94d3099540550d58dd121ec3e67cf93e80364079'::text NOT NULL,
    required_graphify_image_digest text,
    version bigint DEFAULT 1 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_learning_controls_lesson_ttl_days_check CHECK (((lesson_ttl_days >= 7) AND (lesson_ttl_days <= 365))),
    CONSTRAINT sourcing_learning_controls_min_evidence_runs_check CHECK (((min_evidence_runs >= 2) AND (min_evidence_runs <= 10))),
    CONSTRAINT sourcing_learning_controls_required_graphify_commit_check CHECK ((required_graphify_commit ~ '^[0-9a-f]{40}$'::text)),
    CONSTRAINT sourcing_learning_controls_required_graphify_image_digest_check CHECK (((required_graphify_image_digest IS NULL) OR (required_graphify_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_learning_controls_user_daily_limit_check CHECK (((user_daily_limit >= 1) AND (user_daily_limit <= 250))),
    CONSTRAINT sourcing_learning_controls_version_check CHECK ((version > 0)),
    CONSTRAINT sourcing_learning_controls_workspace_daily_limit_check CHECK (((workspace_daily_limit >= 1) AND (workspace_daily_limit <= 1000)))
);

ALTER TABLE ONLY public.sourcing_learning_controls FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_learning_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_learning_secrets (
    workspace_id uuid NOT NULL,
    hmac_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_learning_secrets_hmac_key_check CHECK ((octet_length(hmac_key) = 32))
);

ALTER TABLE ONLY public.sourcing_learning_secrets FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_lesson_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_lesson_evidence (
    workspace_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sourcing_lesson_evidence FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_lesson_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_lesson_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    reviewer_id uuid,
    reviewer_kind text DEFAULT 'human'::text NOT NULL,
    request_id text NOT NULL,
    prior_status text NOT NULL,
    new_status text NOT NULL,
    reason_code text NOT NULL,
    lesson_version bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_lesson_reviews_actor_coherence CHECK ((((reviewer_kind = 'human'::text) AND (reviewer_id IS NOT NULL)) OR ((reviewer_kind = 'system'::text) AND (reviewer_id IS NULL)))),
    CONSTRAINT sourcing_lesson_reviews_lesson_version_check CHECK ((lesson_version > 0)),
    CONSTRAINT sourcing_lesson_reviews_new_status_check CHECK ((new_status = ANY (ARRAY['promoted'::text, 'suspended'::text, 'retired'::text]))),
    CONSTRAINT sourcing_lesson_reviews_prior_status_check CHECK ((prior_status = ANY (ARRAY['draft'::text, 'promoted'::text, 'suspended'::text, 'retired'::text]))),
    CONSTRAINT sourcing_lesson_reviews_reason_code_check CHECK ((reason_code = ANY (ARRAY['reviewed_useful'::text, 'quality_hold'::text, 'security_hold'::text, 'operator_disabled'::text, 'expired'::text, 'superseded'::text]))),
    CONSTRAINT sourcing_lesson_reviews_request_id_check CHECK ((request_id ~ '^[A-Za-z0-9._:-]{1,100}$'::text)),
    CONSTRAINT sourcing_lesson_reviews_reviewer_kind_check CHECK ((reviewer_kind = ANY (ARRAY['human'::text, 'system'::text])))
);

ALTER TABLE ONLY public.sourcing_lesson_reviews FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    role_fingerprint text NOT NULL,
    platform text NOT NULL,
    query_hmac text NOT NULL,
    query_text text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    evidence_run_count integer DEFAULT 0 NOT NULL,
    evidence_campaign_count integer DEFAULT 0 NOT NULL,
    useful_feedback_count integer DEFAULT 0 NOT NULL,
    dead_end_feedback_count integer DEFAULT 0 NOT NULL,
    corrected_feedback_count integer DEFAULT 0 NOT NULL,
    graphify_artifact_sha256 text,
    graphify_cluster_ref text,
    graphify_commit text,
    graphify_export_id uuid,
    graphified_at timestamp with time zone,
    graphified_by uuid,
    promoted_at timestamp with time zone,
    promoted_by uuid,
    suspended_at timestamp with time zone,
    retired_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_lessons_corrected_feedback_count_check CHECK ((corrected_feedback_count >= 0)),
    CONSTRAINT sourcing_lessons_dead_end_feedback_count_check CHECK ((dead_end_feedback_count >= 0)),
    CONSTRAINT sourcing_lessons_evidence_campaign_count_check CHECK ((evidence_campaign_count >= 0)),
    CONSTRAINT sourcing_lessons_evidence_run_count_check CHECK ((evidence_run_count >= 0)),
    CONSTRAINT sourcing_lessons_graphify_artifact_sha256_check CHECK (((graphify_artifact_sha256 IS NULL) OR (graphify_artifact_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_lessons_graphify_cluster_ref_check CHECK (((graphify_cluster_ref IS NULL) OR (graphify_cluster_ref ~ '^[A-Za-z0-9._:-]{1,100}$'::text))),
    CONSTRAINT sourcing_lessons_graphify_coherence CHECK ((((graphify_artifact_sha256 IS NULL) AND (graphify_cluster_ref IS NULL) AND (graphify_commit IS NULL) AND (graphify_export_id IS NULL) AND (graphified_at IS NULL) AND (graphified_by IS NULL)) OR ((graphify_artifact_sha256 IS NOT NULL) AND (graphify_cluster_ref IS NOT NULL) AND (graphify_commit IS NOT NULL) AND (graphify_export_id IS NOT NULL) AND (graphified_at IS NOT NULL) AND (graphified_by IS NOT NULL)))),
    CONSTRAINT sourcing_lessons_graphify_commit_check CHECK (((graphify_commit IS NULL) OR (graphify_commit ~ '^[0-9a-f]{40}$'::text))),
    CONSTRAINT sourcing_lessons_platform_check CHECK ((platform = ANY (ARRAY['GitHub'::text, 'LinkedIn'::text, 'Stack Overflow'::text, 'Dribbble'::text, 'Behance'::text]))),
    CONSTRAINT sourcing_lessons_query_hmac_check CHECK ((query_hmac ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_lessons_query_text_check CHECK (((length(query_text) >= 3) AND (length(query_text) <= 256))),
    CONSTRAINT sourcing_lessons_role_fingerprint_check CHECK ((role_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_lessons_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'promoted'::text, 'suspended'::text, 'retired'::text]))),
    CONSTRAINT sourcing_lessons_useful_feedback_count_check CHECK ((useful_feedback_count >= 0)),
    CONSTRAINT sourcing_lessons_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.sourcing_lessons FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_provider_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_provider_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    provider text NOT NULL,
    external_run_id text NOT NULL,
    campaign_id text,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    dataset_id text,
    CONSTRAINT sourcing_provider_runs_dataset_id_check CHECK (((dataset_id IS NULL) OR ((char_length(dataset_id) >= 1) AND (char_length(dataset_id) <= 200)))),
    CONSTRAINT sourcing_provider_runs_external_run_id_check CHECK (((char_length(external_run_id) >= 1) AND (char_length(external_run_id) <= 200))),
    CONSTRAINT sourcing_provider_runs_provider_check CHECK (((char_length(provider) >= 1) AND (char_length(provider) <= 60))),
    CONSTRAINT sourcing_provider_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.sourcing_provider_runs FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_query_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_query_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    verdict text NOT NULL,
    request_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_query_feedback_request_id_check CHECK ((request_id ~ '^[A-Za-z0-9._:-]{1,100}$'::text)),
    CONSTRAINT sourcing_query_feedback_verdict_check CHECK ((verdict = ANY (ARRAY['useful'::text, 'dead_end'::text, 'corrected'::text])))
);

ALTER TABLE ONLY public.sourcing_query_feedback FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_query_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_query_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    ordinal integer NOT NULL,
    platform text NOT NULL,
    query_text text NOT NULL,
    query_hmac text NOT NULL,
    succeeded boolean NOT NULL,
    candidate_count integer NOT NULL,
    skipped_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
    CONSTRAINT sourcing_query_receipts_candidate_count_check CHECK (((candidate_count >= 0) AND (candidate_count <= 100))),
    CONSTRAINT sourcing_query_receipts_ordinal_check CHECK (((ordinal >= 0) AND (ordinal <= 19))),
    CONSTRAINT sourcing_query_receipts_platform_check CHECK ((platform = ANY (ARRAY['GitHub'::text, 'LinkedIn'::text, 'Stack Overflow'::text, 'Dribbble'::text, 'Behance'::text]))),
    CONSTRAINT sourcing_query_receipts_query_hmac_check CHECK ((query_hmac ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_query_receipts_query_text_check CHECK (((length(query_text) >= 3) AND (length(query_text) <= 256))),
    CONSTRAINT sourcing_query_receipts_skipped_count_check CHECK (((skipped_count >= 0) AND (skipped_count <= 100)))
);

ALTER TABLE ONLY public.sourcing_query_receipts FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_run_quota; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_run_quota (
    workspace_id uuid NOT NULL,
    bucket_date date NOT NULL,
    scope_key text NOT NULL,
    used integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_run_quota_scope_key_check CHECK ((scope_key ~ '^(workspace|user:[0-9a-f-]{36})$'::text)),
    CONSTRAINT sourcing_run_quota_used_check CHECK ((used >= 0))
);

ALTER TABLE ONLY public.sourcing_run_quota FORCE ROW LEVEL SECURITY;

--
-- Name: sourcing_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    request_id text NOT NULL,
    campaign_hmac text NOT NULL,
    role_fingerprint text NOT NULL,
    configuration_fingerprint text NOT NULL,
    mode text NOT NULL,
    provider text,
    model text,
    status text DEFAULT 'in_progress'::text NOT NULL,
    completion_hmac text,
    query_count integer DEFAULT 0 NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
    CONSTRAINT sourcing_runs_campaign_hmac_check CHECK ((campaign_hmac ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_runs_candidate_count_check CHECK (((candidate_count >= 0) AND (candidate_count <= 1000))),
    CONSTRAINT sourcing_runs_completion_hmac_check CHECK (((completion_hmac IS NULL) OR (completion_hmac ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT sourcing_runs_configuration_fingerprint_check CHECK ((configuration_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_runs_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text))),
    CONSTRAINT sourcing_runs_mode_check CHECK ((mode = ANY (ARRAY['cloud'::text, 'deterministic'::text]))),
    CONSTRAINT sourcing_runs_model_check CHECK (((model IS NULL) OR (model ~ '^[A-Za-z0-9._:/-]{1,160}$'::text))),
    CONSTRAINT sourcing_runs_provider_check CHECK (((provider IS NULL) OR (provider ~ '^[A-Za-z0-9._:-]{1,64}$'::text))),
    CONSTRAINT sourcing_runs_query_count_check CHECK (((query_count >= 0) AND (query_count <= 20))),
    CONSTRAINT sourcing_runs_request_id_check CHECK ((request_id ~ '^[A-Za-z0-9._:-]{1,100}$'::text)),
    CONSTRAINT sourcing_runs_role_fingerprint_check CHECK ((role_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sourcing_runs_skipped_count_check CHECK (((skipped_count >= 0) AND (skipped_count <= 1000))),
    CONSTRAINT sourcing_runs_state_coherence CHECK ((((status = 'in_progress'::text) AND (completion_hmac IS NULL) AND (completed_at IS NULL) AND (failed_at IS NULL) AND (error_code IS NULL)) OR ((status = 'completed'::text) AND (completion_hmac IS NOT NULL) AND (completed_at IS NOT NULL) AND (failed_at IS NULL) AND (error_code IS NULL)) OR ((status = 'failed'::text) AND (completion_hmac IS NULL) AND (completed_at IS NULL) AND (failed_at IS NOT NULL) AND (error_code IS NOT NULL)))),
    CONSTRAINT sourcing_runs_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.sourcing_runs FORCE ROW LEVEL SECURITY;

--
-- Name: suppression_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppression_list (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    type text NOT NULL,
    value text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'Operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT suppression_list_type_check CHECK ((type = ANY (ARRAY['email'::text, 'domain'::text, 'linkedin'::text, 'phone'::text])))
);

--
-- Name: workspace_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_state (
    workspace_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    allowed_domain text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_conversations agent_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);

--
-- Name: agent_conversations agent_conversations_workspace_id_channel_provider_thread_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_workspace_id_channel_provider_thread_ke_key UNIQUE (workspace_id, channel, provider_thread_key);

--
-- Name: agent_seats agent_seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_seats
    ADD CONSTRAINT agent_seats_pkey PRIMARY KEY (id);

--
-- Name: agent_specs agent_specs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_specs
    ADD CONSTRAINT agent_specs_pkey PRIMARY KEY (id);

--
-- Name: api_keys api_keys_id_workspace_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_id_workspace_provider_key UNIQUE (id, workspace_id, provider);

--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

--
-- Name: calendar_booking_ledger calendar_booking_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_booking_ledger
    ADD CONSTRAINT calendar_booking_ledger_pkey PRIMARY KEY (id);

--
-- Name: calendar_booking_ledger calendar_booking_ledger_workspace_request_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_booking_ledger
    ADD CONSTRAINT calendar_booking_ledger_workspace_request_uniq UNIQUE (workspace_id, request_id);

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_pkey PRIMARY KEY (id);

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_request_id_provider_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_request_id_provider_reference_key UNIQUE (request_id, provider, reference_hmac);

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_receipts
    ADD CONSTRAINT candidate_erasure_receipts_pkey PRIMARY KEY (id);

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_request_id_store_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_receipts
    ADD CONSTRAINT candidate_erasure_receipts_request_id_store_name_key UNIQUE (request_id, store_name);

--
-- Name: candidate_erasure_requests candidate_erasure_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_requests
    ADD CONSTRAINT candidate_erasure_requests_pkey PRIMARY KEY (id);

--
-- Name: candidate_erasure_requests candidate_erasure_requests_workspace_id_campaign_id_candida_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_requests
    ADD CONSTRAINT candidate_erasure_requests_workspace_id_campaign_id_candida_key UNIQUE (workspace_id, campaign_id, candidate_id);

--
-- Name: candidate_erasure_requests candidate_erasure_requests_workspace_id_request_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_requests
    ADD CONSTRAINT candidate_erasure_requests_workspace_id_request_key_key UNIQUE (workspace_id, request_key);

--
-- Name: candidate_erasure_suppression_tombstones candidate_erasure_suppression_tombstones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_suppression_tombstones
    ADD CONSTRAINT candidate_erasure_suppression_tombstones_pkey PRIMARY KEY (id);

--
-- Name: candidate_erasure_suppression_tombstones candidate_erasure_suppression_workspace_id_identifier_kind__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_suppression_tombstones
    ADD CONSTRAINT candidate_erasure_suppression_workspace_id_identifier_kind__key UNIQUE (workspace_id, identifier_kind, identifier_hmac);

--
-- Name: candidate_identities candidate_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_pkey PRIMARY KEY (workspace_id, kind, value_normalized);

--
-- Name: candidate_legal_holds candidate_legal_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_legal_holds
    ADD CONSTRAINT candidate_legal_holds_pkey PRIMARY KEY (id);

--
-- Name: candidate_outcome_events candidate_outcome_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_outcome_events
    ADD CONSTRAINT candidate_outcome_events_pkey PRIMARY KEY (id);

--
-- Name: candidate_outcome_events candidate_outcome_events_workspace_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_outcome_events
    ADD CONSTRAINT candidate_outcome_events_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);

--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (workspace_id, campaign_id, id);

--
-- Name: dust_connection_events dust_connection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connection_events
    ADD CONSTRAINT dust_connection_events_pkey PRIMARY KEY (id);

--
-- Name: dust_connections dust_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_pkey PRIMARY KEY (id);

--
-- Name: dust_connections dust_connections_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_workspace_id_key UNIQUE (workspace_id);

--
-- Name: email_connection_seat_mismatch_quarantine email_connection_seat_mismatch_quarantine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connection_seat_mismatch_quarantine
    ADD CONSTRAINT email_connection_seat_mismatch_quarantine_pkey PRIMARY KEY (connection_id);

--
-- Name: email_connections email_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_pkey PRIMARY KEY (id);

--
-- Name: email_connections email_connections_workspace_id_seat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_workspace_id_seat_id_key UNIQUE (workspace_id, seat_id);

--
-- Name: email_delivery_events email_delivery_events_dedupe_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_events
    ADD CONSTRAINT email_delivery_events_dedupe_uniq UNIQUE (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at);

--
-- Name: email_delivery_events email_delivery_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_events
    ADD CONSTRAINT email_delivery_events_pkey PRIMARY KEY (id);

--
-- Name: email_ledger_delivery_receipts email_ledger_delivery_receipt_workspace_id_rfc_message_id_e_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ledger_delivery_receipts
    ADD CONSTRAINT email_ledger_delivery_receipt_workspace_id_rfc_message_id_e_key UNIQUE (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at);

--
-- Name: email_ledger_delivery_receipts email_ledger_delivery_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ledger_delivery_receipts
    ADD CONSTRAINT email_ledger_delivery_receipts_pkey PRIMARY KEY (id);

--
-- Name: enrichment_budgets enrichment_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_budgets
    ADD CONSTRAINT enrichment_budgets_pkey PRIMARY KEY (workspace_id, period);

--
-- Name: enrichment_spend_ledger enrichment_spend_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_spend_ledger
    ADD CONSTRAINT enrichment_spend_ledger_pkey PRIMARY KEY (id);

--
-- Name: enrichment_spend_ledger enrichment_spend_ledger_workspace_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_spend_ledger
    ADD CONSTRAINT enrichment_spend_ledger_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_mailbox_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_mailbox_routes
    ADD CONSTRAINT inbound_mailbox_routes_mailbox_address_key UNIQUE (mailbox_address);

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_mailbox_routes
    ADD CONSTRAINT inbound_mailbox_routes_pkey PRIMARY KEY (id);

--
-- Name: messages_inbound messages_inbound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_inbound
    ADD CONSTRAINT messages_inbound_pkey PRIMARY KEY (id);

--
-- Name: messages_inbound messages_inbound_processing_attempts_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.messages_inbound
    ADD CONSTRAINT messages_inbound_processing_attempts_check CHECK ((processing_attempts >= 0)) NOT VALID;

--
-- Name: messages_inbound messages_inbound_workspace_id_channel_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_inbound
    ADD CONSTRAINT messages_inbound_workspace_id_channel_provider_id_key UNIQUE (workspace_id, channel, provider_id);

--
-- Name: messages_outbound messages_outbound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_pkey PRIMARY KEY (id);

--
-- Name: messages_outbound messages_outbound_workspace_id_dedupe_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_workspace_id_dedupe_hash_key UNIQUE (workspace_id, dedupe_hash);

--
-- Name: outreach_approvals outreach_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_pkey PRIMARY KEY (id);

--
-- Name: outreach_approvals outreach_approvals_revocation_shape_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_revocation_shape_check CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (revocation_reason IS NOT NULL)))) NOT VALID;

--
-- Name: outreach_approvals outreach_approvals_scope_hash_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_scope_hash_check CHECK (((approval_scope_hash IS NULL) OR (approval_scope_hash ~ '^[0-9a-f]{64}$'::text))) NOT VALID;

--
-- Name: outreach_approvals outreach_approvals_workspace_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_workspace_id_message_id_key UNIQUE (workspace_id, message_id);

--
-- Name: outreach_ledger outreach_ledger_email_unsubscribe_token_hash_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_email_unsubscribe_token_hash_check CHECK (((email_unsubscribe_token_hash IS NULL) OR (email_unsubscribe_token_hash ~ '^[0-9a-f]{64}$'::text))) NOT VALID;

--
-- Name: outreach_ledger outreach_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_pkey PRIMARY KEY (id);

--
-- Name: outreach_ledger outreach_ledger_rfc_message_id_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_rfc_message_id_check CHECK (((rfc_message_id IS NULL) OR (rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'::text))) NOT VALID;

--
-- Name: persons persons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_pkey PRIMARY KEY (workspace_id, person_id);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: sourcing_graphify_exports sourcing_graphify_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_graphify_exports
    ADD CONSTRAINT sourcing_graphify_exports_pkey PRIMARY KEY (id);

--
-- Name: sourcing_graphify_exports sourcing_graphify_exports_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_graphify_exports
    ADD CONSTRAINT sourcing_graphify_exports_workspace_id_id_key UNIQUE (workspace_id, id);

--
-- Name: sourcing_learning_controls sourcing_learning_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_learning_controls
    ADD CONSTRAINT sourcing_learning_controls_pkey PRIMARY KEY (workspace_id);

--
-- Name: sourcing_learning_secrets sourcing_learning_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_learning_secrets
    ADD CONSTRAINT sourcing_learning_secrets_pkey PRIMARY KEY (workspace_id);

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_evidence
    ADD CONSTRAINT sourcing_lesson_evidence_pkey PRIMARY KEY (lesson_id, receipt_id);

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_workspace_id_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_evidence
    ADD CONSTRAINT sourcing_lesson_evidence_workspace_id_receipt_id_key UNIQUE (workspace_id, receipt_id);

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_reviews
    ADD CONSTRAINT sourcing_lesson_reviews_pkey PRIMARY KEY (id);

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_workspace_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_reviews
    ADD CONSTRAINT sourcing_lesson_reviews_workspace_id_request_id_key UNIQUE (workspace_id, request_id);

--
-- Name: sourcing_lessons sourcing_lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_pkey PRIMARY KEY (id);

--
-- Name: sourcing_lessons sourcing_lessons_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_workspace_id_id_key UNIQUE (workspace_id, id);

--
-- Name: sourcing_lessons sourcing_lessons_workspace_id_role_fingerprint_platform_que_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_workspace_id_role_fingerprint_platform_que_key UNIQUE (workspace_id, role_fingerprint, platform, query_hmac);

--
-- Name: sourcing_provider_runs sourcing_provider_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_provider_runs
    ADD CONSTRAINT sourcing_provider_runs_pkey PRIMARY KEY (id);

--
-- Name: sourcing_provider_runs sourcing_provider_runs_workspace_id_provider_external_run_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_provider_runs
    ADD CONSTRAINT sourcing_provider_runs_workspace_id_provider_external_run_i_key UNIQUE (workspace_id, provider, external_run_id);

--
-- Name: sourcing_query_feedback sourcing_query_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_pkey PRIMARY KEY (id);

--
-- Name: sourcing_query_feedback sourcing_query_feedback_workspace_id_receipt_id_actor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_workspace_id_receipt_id_actor_id_key UNIQUE (workspace_id, receipt_id, actor_id);

--
-- Name: sourcing_query_feedback sourcing_query_feedback_workspace_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_workspace_id_request_id_key UNIQUE (workspace_id, request_id);

--
-- Name: sourcing_query_receipts sourcing_query_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_pkey PRIMARY KEY (id);

--
-- Name: sourcing_query_receipts sourcing_query_receipts_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_workspace_id_id_key UNIQUE (workspace_id, id);

--
-- Name: sourcing_query_receipts sourcing_query_receipts_workspace_id_id_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_workspace_id_id_run_id_key UNIQUE (workspace_id, id, run_id);

--
-- Name: sourcing_query_receipts sourcing_query_receipts_workspace_id_run_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_workspace_id_run_id_ordinal_key UNIQUE (workspace_id, run_id, ordinal);

--
-- Name: sourcing_run_quota sourcing_run_quota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_run_quota
    ADD CONSTRAINT sourcing_run_quota_pkey PRIMARY KEY (workspace_id, bucket_date, scope_key);

--
-- Name: sourcing_runs sourcing_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_runs
    ADD CONSTRAINT sourcing_runs_pkey PRIMARY KEY (id);

--
-- Name: sourcing_runs sourcing_runs_workspace_id_actor_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_runs
    ADD CONSTRAINT sourcing_runs_workspace_id_actor_id_idempotency_key_key UNIQUE (workspace_id, actor_id, idempotency_key);

--
-- Name: sourcing_runs sourcing_runs_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_runs
    ADD CONSTRAINT sourcing_runs_workspace_id_id_key UNIQUE (workspace_id, id);

--
-- Name: suppression_list suppression_list_phone_e164_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.suppression_list
    ADD CONSTRAINT suppression_list_phone_e164_check CHECK (((type <> 'phone'::text) OR (value ~ '^[1-9][0-9]{7,14}$'::text))) NOT VALID;

--
-- Name: suppression_list suppression_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_list
    ADD CONSTRAINT suppression_list_pkey PRIMARY KEY (id);

--
-- Name: suppression_list suppression_list_workspace_id_type_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_list
    ADD CONSTRAINT suppression_list_workspace_id_type_value_key UNIQUE (workspace_id, type, value);

--
-- Name: workspace_state workspace_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_state
    ADD CONSTRAINT workspace_state_pkey PRIMARY KEY (workspace_id);

--
-- Name: workspaces workspaces_allowed_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_allowed_domain_key UNIQUE (allowed_domain);

--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

--
-- Name: agent_conversations_id_workspace_owner_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_conversations_id_workspace_owner_key ON public.agent_conversations USING btree (id, workspace_id, owner_id);

--
-- Name: agent_conversations_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_conversations_owner_idx ON public.agent_conversations USING btree (workspace_id, owner_id, last_inbound_at DESC);

--
-- Name: agent_conversations_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_conversations_workspace_idx ON public.agent_conversations USING btree (workspace_id, channel, last_inbound_at DESC);

--
-- Name: agent_seats_workspace_id_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_seats_workspace_id_id_key ON public.agent_seats USING btree (workspace_id, id);

--
-- Name: agent_specs_workspace_owner_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_specs_workspace_owner_id_key ON public.agent_specs USING btree (workspace_id, owner_id, id);

--
-- Name: calendar_booking_ledger_active_slot_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_booking_ledger_active_slot_uniq ON public.calendar_booking_ledger USING btree (workspace_id, candidate_id, start_time) WHERE (status = ANY (ARRAY['claimed'::text, 'confirmed'::text]));

--
-- Name: calendar_booking_ledger_workspace_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_booking_ledger_workspace_candidate_idx ON public.calendar_booking_ledger USING btree (workspace_id, candidate_id, start_time DESC);

--
-- Name: candidate_erasure_obligations_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_erasure_obligations_pending_idx ON public.candidate_erasure_obligations USING btree (workspace_id, status, next_attempt_at, id) WHERE (status = ANY (ARRAY['pending_provider'::text, 'manual_required'::text, 'retryable_failure'::text]));

--
-- Name: candidate_erasure_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_erasure_requests_status_idx ON public.candidate_erasure_requests USING btree (workspace_id, status, updated_at, id);

--
-- Name: candidate_erasure_tombstones_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_erasure_tombstones_request_idx ON public.candidate_erasure_suppression_tombstones USING btree (request_id, identifier_kind);

--
-- Name: candidate_identities_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_identities_person_idx ON public.candidate_identities USING btree (workspace_id, person_id);

--
-- Name: candidate_legal_holds_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX candidate_legal_holds_one_active_idx ON public.candidate_legal_holds USING btree (workspace_id, campaign_id, candidate_id) WHERE (status = 'active'::text);

--
-- Name: candidate_outcome_events_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_outcome_events_candidate_idx ON public.candidate_outcome_events USING btree (workspace_id, candidate_id, created_at DESC);

--
-- Name: candidates_ws_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_ws_campaign_idx ON public.candidates USING btree (workspace_id, campaign_id);

--
-- Name: candidates_ws_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_ws_email_idx ON public.candidates USING btree (workspace_id, lower(email)) WHERE (email IS NOT NULL);

--
-- Name: candidates_ws_linkedin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_ws_linkedin_idx ON public.candidates USING btree (workspace_id, lower(linkedin_url)) WHERE (linkedin_url IS NOT NULL);

--
-- Name: candidates_ws_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_ws_person_idx ON public.candidates USING btree (workspace_id, person_id);

--
-- Name: dust_connection_events_authority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dust_connection_events_authority_idx ON public.dust_connection_events USING btree (workspace_id, connection_id, created_at DESC);

--
-- Name: email_connections_seat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_connections_seat_idx ON public.email_connections USING btree (workspace_id, seat_id);

--
-- Name: email_delivery_events_outbound_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_delivery_events_outbound_idx ON public.email_delivery_events USING btree (workspace_id, outbound_message_id, provider_occurred_at DESC);

--
-- Name: enrichment_spend_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enrichment_spend_period_idx ON public.enrichment_spend_ledger USING btree (workspace_id, period, status);

--
-- Name: inbound_mailbox_routes_ws_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_mailbox_routes_ws_idx ON public.inbound_mailbox_routes USING btree (workspace_id, purpose) WHERE active;

--
-- Name: messages_inbound_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_inbound_owner_idx ON public.messages_inbound USING btree (workspace_id, owner_id, received_at DESC);

--
-- Name: messages_inbound_unprocessed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_inbound_unprocessed_idx ON public.messages_inbound USING btree (workspace_id, processed, received_at);

--
-- Name: messages_outbound_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_outbound_due_idx ON public.messages_outbound USING btree (status, scheduled_at);

--
-- Name: messages_outbound_inbound_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_outbound_inbound_message_uniq ON public.messages_outbound USING btree (inbound_message_id) WHERE (inbound_message_id IS NOT NULL);

--
-- Name: messages_outbound_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_outbound_owner_idx ON public.messages_outbound USING btree (workspace_id, owner_id, created_at DESC);

--
-- Name: messages_outbound_provider_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_outbound_provider_message_uniq ON public.messages_outbound USING btree (workspace_id, provider_message_id) WHERE (provider_message_id IS NOT NULL);

--
-- Name: messages_outbound_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_outbound_status_idx ON public.messages_outbound USING btree (workspace_id, status, created_at DESC);

--
-- Name: messages_outbound_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_outbound_thread_idx ON public.messages_outbound USING btree (workspace_id, to_address, created_at DESC);

--
-- Name: outreach_approvals_active_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_approvals_active_lookup_idx ON public.outreach_approvals USING btree (workspace_id, message_id) WHERE (revoked_at IS NULL);

--
-- Name: outreach_approvals_ws_msg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_approvals_ws_msg_idx ON public.outreach_approvals USING btree (workspace_id, message_id);

--
-- Name: outreach_ledger_active_reconcile_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_active_reconcile_uniq ON public.outreach_ledger USING btree (workspace_id, candidate_id) WHERE (status = ANY (ARRAY['claimed'::text, 'sent'::text, 'ambiguous'::text]));

--
-- Name: outreach_ledger_approval_message_reconcile_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_approval_message_reconcile_uniq ON public.outreach_ledger USING btree (workspace_id, approval_message_id) WHERE ((approval_message_id IS NOT NULL) AND (status = ANY (ARRAY['claimed'::text, 'sent'::text, 'ambiguous'::text])));

--
-- Name: outreach_ledger_email_unsubscribe_token_hash_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_email_unsubscribe_token_hash_uniq ON public.outreach_ledger USING btree (email_unsubscribe_token_hash) WHERE (email_unsubscribe_token_hash IS NOT NULL);

--
-- Name: outreach_ledger_outbound_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_outbound_message_uniq ON public.outreach_ledger USING btree (outbound_message_id) WHERE (outbound_message_id IS NOT NULL);

--
-- Name: outreach_ledger_rfc_message_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_rfc_message_id_uniq ON public.outreach_ledger USING btree (workspace_id, rfc_message_id) WHERE (rfc_message_id IS NOT NULL);

--
-- Name: outreach_ledger_seat_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_ledger_seat_day ON public.outreach_ledger USING btree (seat_id, at);

--
-- Name: outreach_ledger_send_attempt_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_ledger_send_attempt_uniq ON public.outreach_ledger USING btree (send_attempt_id) WHERE (send_attempt_id IS NOT NULL);

--
-- Name: profiles_workspace_id_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_workspace_id_id_key ON public.profiles USING btree (workspace_id, id);

--
-- Name: sourcing_lessons_runtime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_lessons_runtime_idx ON public.sourcing_lessons USING btree (workspace_id, role_fingerprint, status, useful_feedback_count DESC, evidence_run_count DESC);

--
-- Name: sourcing_provider_runs_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_provider_runs_open_idx ON public.sourcing_provider_runs USING btree (workspace_id, status, started_at) WHERE (status = 'running'::text);

--
-- Name: sourcing_runs_feedback_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_runs_feedback_lookup_idx ON public.sourcing_runs USING btree (workspace_id, actor_id, campaign_hmac, status, created_at DESC);

--
-- Name: sourcing_runs_workspace_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_runs_workspace_expiry_idx ON public.sourcing_runs USING btree (workspace_id, expires_at, id);

--
-- Name: sourcing_runs_workspace_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_runs_workspace_role_idx ON public.sourcing_runs USING btree (workspace_id, role_fingerprint, created_at DESC);

--
-- Name: agent_conversations agent_conversations_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_conversations_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF candidate_id ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: agent_specs agent_specs_authority_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_specs_authority_immutable BEFORE UPDATE ON public.agent_specs FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_spec_authority_immutable();

--
-- Name: candidate_erasure_obligations candidate_erasure_obligation_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidate_erasure_obligation_limit BEFORE INSERT ON public.candidate_erasure_obligations FOR EACH ROW EXECUTE FUNCTION public.enforce_candidate_erasure_obligation_limit();

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidate_erasure_receipts_append_only BEFORE DELETE OR UPDATE ON public.candidate_erasure_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_receipt_mutation();

--
-- Name: candidate_erasure_requests candidate_erasure_requests_mirror_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidate_erasure_requests_mirror_cleanup AFTER INSERT OR UPDATE ON public.candidate_erasure_requests FOR EACH ROW WHEN ((new.status <> 'blocked_legal_hold'::text)) EXECUTE FUNCTION public.cleanup_erased_candidate_mirror();

--
-- Name: candidate_erasure_requests candidate_erasure_requests_outcomes_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidate_erasure_requests_outcomes_cleanup AFTER INSERT OR UPDATE ON public.candidate_erasure_requests FOR EACH ROW WHEN ((new.status <> 'blocked_legal_hold'::text)) EXECUTE FUNCTION public.cleanup_erased_candidate_outcomes();

--
-- Name: workspace_state candidates_corpus_mirror_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidates_corpus_mirror_ins AFTER INSERT ON public.workspace_state FOR EACH ROW EXECUTE FUNCTION public.sync_candidates_corpus();

--
-- Name: workspace_state candidates_corpus_mirror_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidates_corpus_mirror_upd AFTER UPDATE OF state ON public.workspace_state FOR EACH ROW WHEN (((old.state -> 'candidates'::text) IS DISTINCT FROM (new.state -> 'candidates'::text))) EXECUTE FUNCTION public.sync_candidates_corpus();

--
-- Name: candidates candidates_person_gc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidates_person_gc AFTER DELETE ON public.candidates REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION public.gc_deleted_candidacies();

--
-- Name: candidates candidates_person_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidates_person_link AFTER INSERT OR UPDATE OF linkedin_url ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.link_candidate_person();

--
-- Name: dust_connections dust_connections_audit_authority; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dust_connections_audit_authority AFTER INSERT OR DELETE OR UPDATE ON public.dust_connections FOR EACH ROW EXECUTE FUNCTION public.audit_dust_connection_authority();

--
-- Name: dust_connections dust_connections_stamp_authority; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dust_connections_stamp_authority BEFORE INSERT OR UPDATE ON public.dust_connections FOR EACH ROW EXECUTE FUNCTION public.stamp_dust_connection_authority();

--
-- Name: email_connection_seat_mismatch_quarantine email_connection_seat_mismatch_quarantine_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_connection_seat_mismatch_quarantine_append_only BEFORE DELETE OR UPDATE ON public.email_connection_seat_mismatch_quarantine FOR EACH ROW EXECUTE FUNCTION public.reject_email_connection_quarantine_mutation();

--
-- Name: messages_inbound messages_inbound_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_inbound_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF candidate_id, from_address ON public.messages_inbound FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: messages_outbound messages_outbound_active_email_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_outbound_active_email_approval BEFORE UPDATE OF status ON public.messages_outbound FOR EACH ROW EXECUTE FUNCTION public.enforce_active_email_approval();

--
-- Name: messages_outbound messages_outbound_active_linkedin_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_outbound_active_linkedin_approval BEFORE UPDATE OF status ON public.messages_outbound FOR EACH ROW EXECUTE FUNCTION public.enforce_active_linkedin_approval();

--
-- Name: messages_outbound messages_outbound_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_outbound_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF candidate_id, to_address, recipient_e164 ON public.messages_outbound FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: outreach_ledger outreach_ledger_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_ledger_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF candidate_id, candidate_email ON public.outreach_ledger FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: outreach_ledger outreach_ledger_release_elapsed_contact_window; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_ledger_release_elapsed_contact_window BEFORE INSERT ON public.outreach_ledger FOR EACH ROW EXECUTE FUNCTION public.release_elapsed_outreach_contact_window();

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sourcing_lesson_reviews_append_only BEFORE DELETE OR UPDATE ON public.sourcing_lesson_reviews FOR EACH ROW EXECUTE FUNCTION public.reject_sourcing_lesson_review_mutation();

--
-- Name: suppression_list suppression_list_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER suppression_list_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF type, value ON public.suppression_list FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: workspace_state workspace_state_candidate_erasure_reimport_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_state_candidate_erasure_reimport_guard BEFORE INSERT OR UPDATE OF state ON public.workspace_state FOR EACH ROW EXECUTE FUNCTION public.reject_candidate_erasure_reimport();

--
-- Name: workspace_state workspace_state_strip_legacy_dust_authority; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_state_strip_legacy_dust_authority BEFORE INSERT OR UPDATE ON public.workspace_state FOR EACH ROW EXECUTE FUNCTION public.strip_legacy_dust_authority();

--
-- Name: workspace_state workspace_state_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_state_touch BEFORE UPDATE ON public.workspace_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

--
-- Name: agent_conversations agent_conversations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

--
-- Name: agent_conversations agent_conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: agent_conversations agent_conversations_workspace_owner_spec_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_workspace_owner_spec_fkey FOREIGN KEY (workspace_id, owner_id, spec_id) REFERENCES public.agent_specs(workspace_id, owner_id, id) ON DELETE RESTRICT;

--
-- Name: agent_seats agent_seats_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_seats
    ADD CONSTRAINT agent_seats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: agent_specs agent_specs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_specs
    ADD CONSTRAINT agent_specs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

--
-- Name: agent_specs agent_specs_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_specs
    ADD CONSTRAINT agent_specs_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.agent_seats(id) ON DELETE SET NULL;

--
-- Name: agent_specs agent_specs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_specs
    ADD CONSTRAINT agent_specs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: agent_specs agent_specs_workspace_seat_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_specs
    ADD CONSTRAINT agent_specs_workspace_seat_fkey FOREIGN KEY (workspace_id, seat_id) REFERENCES public.agent_seats(workspace_id, id) ON DELETE SET NULL (seat_id);

--
-- Name: api_keys api_keys_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: calendar_booking_ledger calendar_booking_ledger_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_booking_ledger
    ADD CONSTRAINT calendar_booking_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.candidate_erasure_requests(id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_workspace_id_authority_last__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_workspace_id_authority_last__fkey FOREIGN KEY (workspace_id, authority_last_accessed_by) REFERENCES public.profiles(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_workspace_id_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_workspace_id_completed_by_fkey FOREIGN KEY (workspace_id, completed_by) REFERENCES public.profiles(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_obligations
    ADD CONSTRAINT candidate_erasure_obligations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_receipts
    ADD CONSTRAINT candidate_erasure_receipts_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.candidate_erasure_requests(id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_receipts
    ADD CONSTRAINT candidate_erasure_receipts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_erasure_requests candidate_erasure_requests_workspace_id_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_requests
    ADD CONSTRAINT candidate_erasure_requests_workspace_id_actor_id_fkey FOREIGN KEY (workspace_id, actor_id) REFERENCES public.profiles(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_requests candidate_erasure_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_requests
    ADD CONSTRAINT candidate_erasure_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_erasure_suppression_tombstones candidate_erasure_suppression_tombstones_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_suppression_tombstones
    ADD CONSTRAINT candidate_erasure_suppression_tombstones_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.candidate_erasure_requests(id) ON DELETE RESTRICT;

--
-- Name: candidate_erasure_suppression_tombstones candidate_erasure_suppression_tombstones_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_erasure_suppression_tombstones
    ADD CONSTRAINT candidate_erasure_suppression_tombstones_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_identities candidate_identities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_identities candidate_identities_workspace_id_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_workspace_id_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES public.persons(workspace_id, person_id) ON DELETE CASCADE;

--
-- Name: candidate_legal_holds candidate_legal_holds_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_legal_holds
    ADD CONSTRAINT candidate_legal_holds_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidate_legal_holds candidate_legal_holds_workspace_id_placed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_legal_holds
    ADD CONSTRAINT candidate_legal_holds_workspace_id_placed_by_fkey FOREIGN KEY (workspace_id, placed_by) REFERENCES public.profiles(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: candidate_legal_holds candidate_legal_holds_workspace_id_released_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_legal_holds
    ADD CONSTRAINT candidate_legal_holds_workspace_id_released_by_fkey FOREIGN KEY (workspace_id, released_by) REFERENCES public.profiles(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: candidate_outcome_events candidate_outcome_events_source_inbound_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_outcome_events
    ADD CONSTRAINT candidate_outcome_events_source_inbound_id_fkey FOREIGN KEY (source_inbound_id) REFERENCES public.messages_inbound(id) ON DELETE SET NULL;

--
-- Name: candidate_outcome_events candidate_outcome_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_outcome_events
    ADD CONSTRAINT candidate_outcome_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: candidates candidates_person_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_person_fk FOREIGN KEY (workspace_id, person_id) REFERENCES public.persons(workspace_id, person_id) ON DELETE SET NULL (person_id);

--
-- Name: candidates candidates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: dust_connection_events dust_connection_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connection_events
    ADD CONSTRAINT dust_connection_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: dust_connection_events dust_connection_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connection_events
    ADD CONSTRAINT dust_connection_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: dust_connections dust_connections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: dust_connections dust_connections_key_binding_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_key_binding_fkey FOREIGN KEY (api_key_id, workspace_id, credential_provider) REFERENCES public.api_keys(id, workspace_id, provider) ON DELETE RESTRICT;

--
-- Name: dust_connections dust_connections_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: dust_connections dust_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dust_connections
    ADD CONSTRAINT dust_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: email_connections email_connections_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.agent_seats(id) ON DELETE CASCADE;

--
-- Name: email_connections email_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: email_connections email_connections_workspace_seat_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_workspace_seat_fkey FOREIGN KEY (workspace_id, seat_id) REFERENCES public.agent_seats(workspace_id, id) ON DELETE CASCADE;

--
-- Name: email_delivery_events email_delivery_events_outbound_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_events
    ADD CONSTRAINT email_delivery_events_outbound_message_id_fkey FOREIGN KEY (outbound_message_id) REFERENCES public.messages_outbound(id) ON DELETE CASCADE;

--
-- Name: email_delivery_events email_delivery_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_events
    ADD CONSTRAINT email_delivery_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: email_ledger_delivery_receipts email_ledger_delivery_receipts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ledger_delivery_receipts
    ADD CONSTRAINT email_ledger_delivery_receipts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: enrichment_budgets enrichment_budgets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_budgets
    ADD CONSTRAINT enrichment_budgets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: enrichment_spend_ledger enrichment_spend_ledger_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_spend_ledger
    ADD CONSTRAINT enrichment_spend_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_mailbox_routes
    ADD CONSTRAINT inbound_mailbox_routes_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.email_connections(id) ON DELETE SET NULL;

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_mailbox_routes
    ADD CONSTRAINT inbound_mailbox_routes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: messages_inbound messages_inbound_conversation_authority_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_inbound
    ADD CONSTRAINT messages_inbound_conversation_authority_fkey FOREIGN KEY (conversation_id, workspace_id, owner_id) REFERENCES public.agent_conversations(id, workspace_id, owner_id) ON DELETE RESTRICT;

--
-- Name: messages_inbound messages_inbound_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_inbound
    ADD CONSTRAINT messages_inbound_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

--
-- Name: messages_inbound messages_inbound_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_inbound
    ADD CONSTRAINT messages_inbound_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: messages_outbound messages_outbound_conversation_authority_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_conversation_authority_fkey FOREIGN KEY (conversation_id, workspace_id, owner_id) REFERENCES public.agent_conversations(id, workspace_id, owner_id) ON DELETE RESTRICT;

--
-- Name: messages_outbound messages_outbound_inbound_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_inbound_message_id_fkey FOREIGN KEY (inbound_message_id) REFERENCES public.messages_inbound(id) ON DELETE SET NULL;

--
-- Name: messages_outbound messages_outbound_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

--
-- Name: messages_outbound messages_outbound_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.agent_seats(id) ON DELETE SET NULL;

--
-- Name: messages_outbound messages_outbound_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: messages_outbound messages_outbound_workspace_owner_spec_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_workspace_owner_spec_fkey FOREIGN KEY (workspace_id, owner_id, spec_id) REFERENCES public.agent_specs(workspace_id, owner_id, id) ON DELETE RESTRICT;

--
-- Name: messages_outbound messages_outbound_workspace_seat_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_outbound
    ADD CONSTRAINT messages_outbound_workspace_seat_fkey FOREIGN KEY (workspace_id, seat_id) REFERENCES public.agent_seats(workspace_id, id) ON DELETE SET NULL (seat_id);

--
-- Name: outreach_approvals outreach_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);

--
-- Name: outreach_approvals outreach_approvals_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id);

--
-- Name: outreach_approvals outreach_approvals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_approvals
    ADD CONSTRAINT outreach_approvals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: outreach_ledger outreach_ledger_outbound_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_outbound_message_id_fkey FOREIGN KEY (outbound_message_id) REFERENCES public.messages_outbound(id) ON DELETE SET NULL;

--
-- Name: outreach_ledger outreach_ledger_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.agent_seats(id) ON DELETE SET NULL;

--
-- Name: outreach_ledger outreach_ledger_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_ledger
    ADD CONSTRAINT outreach_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: persons persons_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: profiles profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

--
-- Name: sourcing_graphify_exports sourcing_graphify_exports_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_graphify_exports
    ADD CONSTRAINT sourcing_graphify_exports_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_graphify_exports sourcing_graphify_exports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_graphify_exports
    ADD CONSTRAINT sourcing_graphify_exports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_learning_controls sourcing_learning_controls_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_learning_controls
    ADD CONSTRAINT sourcing_learning_controls_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_learning_controls sourcing_learning_controls_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_learning_controls
    ADD CONSTRAINT sourcing_learning_controls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_learning_secrets sourcing_learning_secrets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_learning_secrets
    ADD CONSTRAINT sourcing_learning_secrets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_lesson_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_evidence
    ADD CONSTRAINT sourcing_lesson_evidence_lesson_fkey FOREIGN KEY (workspace_id, lesson_id) REFERENCES public.sourcing_lessons(workspace_id, id) ON DELETE CASCADE;

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_receipt_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_evidence
    ADD CONSTRAINT sourcing_lesson_evidence_receipt_fkey FOREIGN KEY (workspace_id, receipt_id) REFERENCES public.sourcing_query_receipts(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_evidence
    ADD CONSTRAINT sourcing_lesson_evidence_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_lesson_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_reviews
    ADD CONSTRAINT sourcing_lesson_reviews_lesson_fkey FOREIGN KEY (workspace_id, lesson_id) REFERENCES public.sourcing_lessons(workspace_id, id) ON DELETE CASCADE;

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_reviews
    ADD CONSTRAINT sourcing_lesson_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lesson_reviews
    ADD CONSTRAINT sourcing_lesson_reviews_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_lessons sourcing_lessons_graphified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_graphified_by_fkey FOREIGN KEY (graphified_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_lessons sourcing_lessons_graphify_export_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_graphify_export_fkey FOREIGN KEY (workspace_id, graphify_export_id) REFERENCES public.sourcing_graphify_exports(workspace_id, id) ON DELETE RESTRICT;

--
-- Name: sourcing_lessons sourcing_lessons_promoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_lessons sourcing_lessons_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_lessons
    ADD CONSTRAINT sourcing_lessons_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_provider_runs sourcing_provider_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_provider_runs
    ADD CONSTRAINT sourcing_provider_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_query_feedback sourcing_query_feedback_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_query_feedback sourcing_query_feedback_receipt_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_receipt_fkey FOREIGN KEY (workspace_id, receipt_id) REFERENCES public.sourcing_query_receipts(workspace_id, id) ON DELETE CASCADE;

--
-- Name: sourcing_query_feedback sourcing_query_feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_feedback
    ADD CONSTRAINT sourcing_query_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_query_receipts sourcing_query_receipts_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_run_fkey FOREIGN KEY (workspace_id, run_id) REFERENCES public.sourcing_runs(workspace_id, id) ON DELETE CASCADE;

--
-- Name: sourcing_query_receipts sourcing_query_receipts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_query_receipts
    ADD CONSTRAINT sourcing_query_receipts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_run_quota sourcing_run_quota_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_run_quota
    ADD CONSTRAINT sourcing_run_quota_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: sourcing_runs sourcing_runs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_runs
    ADD CONSTRAINT sourcing_runs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: sourcing_runs sourcing_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_runs
    ADD CONSTRAINT sourcing_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: suppression_list suppression_list_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_list
    ADD CONSTRAINT suppression_list_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: workspace_state workspace_state_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_state
    ADD CONSTRAINT workspace_state_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

--
-- Name: dust_connection_events Dust audit trigger inserts events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Dust audit trigger inserts events" ON public.dust_connection_events FOR INSERT TO postgres WITH CHECK (true);

--
-- Name: dust_connections admins delete Dust connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete Dust connections" ON public.dust_connections FOR DELETE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: agent_seats admins delete agent_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete agent_seats" ON public.agent_seats FOR DELETE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: email_connections admins delete email_connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete email_connections" ON public.email_connections FOR DELETE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: api_keys admins delete keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete keys" ON public.api_keys FOR DELETE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: suppression_list admins delete suppression_list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins delete suppression_list" ON public.suppression_list FOR DELETE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: dust_connections admins insert Dust connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert Dust connections" ON public.dust_connections FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: agent_seats admins insert agent_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert agent_seats" ON public.agent_seats FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: email_connections admins insert email_connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert email_connections" ON public.email_connections FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: api_keys admins insert keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert keys" ON public.api_keys FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: suppression_list admins insert suppression_list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins insert suppression_list" ON public.suppression_list FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: dust_connection_events admins read Dust connection events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins read Dust connection events" ON public.dust_connection_events FOR SELECT USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: dust_connections admins update Dust connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update Dust connections" ON public.dust_connections FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text))) WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text)));

--
-- Name: agent_seats admins update agent_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update agent_seats" ON public.agent_seats FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text))) WITH CHECK ((workspace_id = public.current_workspace_id()));

--
-- Name: email_connections admins update email_connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update email_connections" ON public.email_connections FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text))) WITH CHECK ((workspace_id = public.current_workspace_id()));

--
-- Name: api_keys admins update keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update keys" ON public.api_keys FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text))) WITH CHECK ((workspace_id = public.current_workspace_id()));

--
-- Name: suppression_list admins update suppression_list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins update suppression_list" ON public.suppression_list FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = 'admin'::text))) WITH CHECK ((workspace_id = public.current_workspace_id()));

--
-- Name: agent_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_conversations agent_conversations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_conversations_select ON public.agent_conversations FOR SELECT TO authenticated USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND (owner_id = auth.uid())));

--
-- Name: agent_seats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_seats ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_specs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_specs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_specs agent_specs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_specs_insert ON public.agent_specs FOR INSERT TO authenticated WITH CHECK (((workspace_id = public.current_workspace_id()) AND (owner_id = auth.uid()) AND (public.current_profile_role() <> 'viewer'::text)));

--
-- Name: agent_specs agent_specs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_specs_select ON public.agent_specs FOR SELECT TO authenticated USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND ((owner_id = auth.uid()) OR (public.current_profile_role() = 'admin'::text))));

--
-- Name: agent_specs agent_specs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_specs_update ON public.agent_specs FOR UPDATE TO authenticated USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND ((owner_id = auth.uid()) OR (public.current_profile_role() = 'admin'::text)))) WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND ((owner_id = auth.uid()) OR (public.current_profile_role() = 'admin'::text))));

--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_booking_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_booking_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_booking_ledger calendar_booking_ledger_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_booking_ledger_postgres_all ON public.calendar_booking_ledger TO postgres USING (true) WITH CHECK (true);

--
-- Name: candidate_erasure_obligations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_erasure_obligations ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_obligations candidate_erasure_obligations_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_erasure_obligations_owner_access ON public.candidate_erasure_obligations TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_erasure_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_erasure_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_receipts candidate_erasure_receipts_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_erasure_receipts_owner_access ON public.candidate_erasure_receipts TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_erasure_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_erasure_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_requests candidate_erasure_requests_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_erasure_requests_owner_access ON public.candidate_erasure_requests TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_erasure_suppression_tombstones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_erasure_suppression_tombstones ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_erasure_suppression_tombstones candidate_erasure_tombstones_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_erasure_tombstones_owner_access ON public.candidate_erasure_suppression_tombstones TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_identities candidate_identities_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_identities_owner_access ON public.candidate_identities TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_legal_holds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_legal_holds ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_legal_holds candidate_legal_holds_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_legal_holds_owner_access ON public.candidate_legal_holds TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidate_outcome_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_outcome_events ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_outcome_events candidate_outcome_events_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_outcome_events_member_read ON public.candidate_outcome_events FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));

--
-- Name: candidate_outcome_events candidate_outcome_events_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidate_outcome_events_owner_access ON public.candidate_outcome_events TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: candidates candidates_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidates_owner_access ON public.candidates TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: dust_connection_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dust_connection_events ENABLE ROW LEVEL SECURITY;

--
-- Name: dust_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dust_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: email_connection_seat_mismatch_quarantine; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_connection_seat_mismatch_quarantine ENABLE ROW LEVEL SECURITY;

--
-- Name: email_connection_seat_mismatch_quarantine email_connection_seat_mismatch_quarantine_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_connection_seat_mismatch_quarantine_postgres_all ON public.email_connection_seat_mismatch_quarantine TO postgres USING (true) WITH CHECK (true);

--
-- Name: email_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: email_delivery_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

--
-- Name: email_delivery_events email_delivery_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_delivery_events_select ON public.email_delivery_events FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: email_ledger_delivery_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_ledger_delivery_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_ledger_delivery_receipts email_ledger_delivery_receipts_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_ledger_delivery_receipts_owner ON public.email_ledger_delivery_receipts TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: enrichment_budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_budgets enrichment_budgets_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrichment_budgets_member_read ON public.enrichment_budgets FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));

--
-- Name: enrichment_budgets enrichment_budgets_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrichment_budgets_owner_access ON public.enrichment_budgets TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: enrichment_spend_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_spend_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_spend_ledger enrichment_spend_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrichment_spend_member_read ON public.enrichment_spend_ledger FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));

--
-- Name: enrichment_spend_ledger enrichment_spend_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrichment_spend_owner_access ON public.enrichment_spend_ledger TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: inbound_mailbox_routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbound_mailbox_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbound_mailbox_routes_member_read ON public.inbound_mailbox_routes FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));

--
-- Name: inbound_mailbox_routes inbound_mailbox_routes_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbound_mailbox_routes_owner_access ON public.inbound_mailbox_routes TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: outreach_ledger members insert outreach_ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members insert outreach_ledger" ON public.outreach_ledger FOR INSERT WITH CHECK ((workspace_id = public.current_workspace_id()));

--
-- Name: workspace_state members insert state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members insert state" ON public.workspace_state FOR INSERT WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = ANY (ARRAY['admin'::text, 'member'::text]))));

--
-- Name: dust_connections members read Dust connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read Dust connections" ON public.dust_connections FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: agent_seats members read agent_seats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read agent_seats" ON public.agent_seats FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: email_connections members read email_connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read email_connections" ON public.email_connections FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: api_keys members read keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read keys" ON public.api_keys FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: outreach_ledger members read outreach_ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read outreach_ledger" ON public.outreach_ledger FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: workspace_state members read state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read state" ON public.workspace_state FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: suppression_list members read suppression_list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read suppression_list" ON public.suppression_list FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: workspaces members read workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read workspace" ON public.workspaces FOR SELECT USING ((id = public.current_workspace_id()));

--
-- Name: outreach_ledger members update outreach_ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members update outreach_ledger" ON public.outreach_ledger FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = ANY (ARRAY['admin'::text, 'member'::text])))) WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = ANY (ARRAY['admin'::text, 'member'::text]))));

--
-- Name: workspace_state members update state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members update state" ON public.workspace_state FOR UPDATE USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = ANY (ARRAY['admin'::text, 'member'::text])))) WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() = ANY (ARRAY['admin'::text, 'member'::text]))));

--
-- Name: messages_inbound; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages_inbound ENABLE ROW LEVEL SECURITY;

--
-- Name: messages_inbound messages_inbound_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_inbound_select ON public.messages_inbound FOR SELECT TO authenticated USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND (owner_id = auth.uid())));

--
-- Name: messages_outbound; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages_outbound ENABLE ROW LEVEL SECURITY;

--
-- Name: messages_outbound messages_outbound_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_outbound_select ON public.messages_outbound FOR SELECT TO authenticated USING (((workspace_id = public.current_workspace_id()) AND (public.current_profile_role() <> 'viewer'::text) AND (owner_id = auth.uid())));

--
-- Name: outreach_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_approvals outreach_approvals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_approvals_select ON public.outreach_approvals FOR SELECT USING ((workspace_id = public.current_workspace_id()));

--
-- Name: outreach_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles own profile insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (((id = auth.uid()) AND (workspace_id IS NULL) AND (role = 'member'::text)));

--
-- Name: profiles own profile read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING ((id = auth.uid()));

--
-- Name: profiles own profile update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (NOT (workspace_id IS DISTINCT FROM public.current_workspace_id())) AND (NOT (role IS DISTINCT FROM public.current_profile_role()))));

--
-- Name: persons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

--
-- Name: persons persons_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY persons_owner_access ON public.persons TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_graphify_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_graphify_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_graphify_exports sourcing_graphify_exports_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_graphify_exports_postgres_all ON public.sourcing_graphify_exports TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_learning_controls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_learning_controls ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_learning_controls sourcing_learning_controls_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_learning_controls_postgres_all ON public.sourcing_learning_controls TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_learning_secrets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_learning_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_learning_secrets sourcing_learning_secrets_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_learning_secrets_postgres_all ON public.sourcing_learning_secrets TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_lesson_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_lesson_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_lesson_evidence sourcing_lesson_evidence_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_lesson_evidence_postgres_all ON public.sourcing_lesson_evidence TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_lesson_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_lesson_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_lesson_reviews sourcing_lesson_reviews_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_lesson_reviews_postgres_all ON public.sourcing_lesson_reviews TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_lessons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_lessons ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_lessons sourcing_lessons_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_lessons_postgres_all ON public.sourcing_lessons TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_provider_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_provider_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_provider_runs sourcing_provider_runs_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_provider_runs_owner_access ON public.sourcing_provider_runs TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_query_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_query_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_query_feedback sourcing_query_feedback_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_query_feedback_postgres_all ON public.sourcing_query_feedback TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_query_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_query_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_query_receipts sourcing_query_receipts_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_query_receipts_postgres_all ON public.sourcing_query_receipts TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_run_quota; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_run_quota ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_run_quota sourcing_run_quota_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_run_quota_postgres_all ON public.sourcing_run_quota TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: sourcing_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sourcing_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: sourcing_runs sourcing_runs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sourcing_runs_postgres_all ON public.sourcing_runs TO postgres, supabase_admin USING (true) WITH CHECK (true);

--
-- Name: suppression_list; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppression_list ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_state ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION attach_provider_run(p_run_id uuid, p_external_run_id text, p_dataset_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.attach_provider_run(p_run_id uuid, p_external_run_id text, p_dataset_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.attach_provider_run(p_run_id uuid, p_external_run_id text, p_dataset_id text) TO service_role;

--
-- Name: FUNCTION audit_dust_connection_authority(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_dust_connection_authority() FROM PUBLIC;

--
-- Name: FUNCTION backfill_candidate_person_identities(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.backfill_candidate_person_identities() FROM PUBLIC;

--
-- Name: FUNCTION backfill_candidates_corpus(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.backfill_candidates_corpus() FROM PUBLIC;

--
-- Name: FUNCTION begin_provider_run(p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_provider_run(p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_provider_run(p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text) TO service_role;

--
-- Name: FUNCTION begin_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_role_basis jsonb, p_configuration_fingerprint text, p_mode text, p_provider text, p_model text, p_idempotency_key uuid, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_role_basis jsonb, p_configuration_fingerprint text, p_mode text, p_provider text, p_model text, p_idempotency_key uuid, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_role_basis jsonb, p_configuration_fingerprint text, p_mode text, p_provider text, p_model text, p_idempotency_key uuid, p_request_id text) TO service_role;

--
-- Name: FUNCTION candidate_erasure_constant_time_hex_equal(p_left text, p_right text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_constant_time_hex_equal(p_left text, p_right text) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_contains_identity(p_value text, p_tokens text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_contains_identity(p_value text, p_tokens text[]) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_encrypt_reference(p_workspace_id uuid, p_reference jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_encrypt_reference(p_workspace_id uuid, p_reference jsonb) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_identifier_hmac(p_workspace_id uuid, p_identifier_kind text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_identifier_hmac(p_workspace_id uuid, p_identifier_kind text, p_value text) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_identity_lock_key(p_workspace_id uuid, p_identifier_kind text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_identity_lock_key(p_workspace_id uuid, p_identifier_kind text, p_value text) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_provider_for_channel(p_channel text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_provider_for_channel(p_channel text) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_reference_hmac(p_workspace_id uuid, p_reference jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_reference_hmac(p_workspace_id uuid, p_reference jsonb) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_response(p_request_id uuid, p_replayed boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_response(p_request_id uuid, p_replayed boolean) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_tombstone_document(p_candidate jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_tombstone_document(p_candidate jsonb) FROM PUBLIC;

--
-- Name: FUNCTION candidate_erasure_tombstone_exists(p_workspace_id uuid, p_identifier_kind text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.candidate_erasure_tombstone_exists(p_workspace_id uuid, p_identifier_kind text, p_value text) FROM PUBLIC;

--
-- Name: FUNCTION canonicalize_sourcing_role_basis(p_basis jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_sourcing_role_basis(p_basis jsonb) FROM PUBLIC;

--
-- Name: FUNCTION claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text, p_recontact_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text, p_recontact_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text, p_recontact_days integer) TO service_role;

--
-- Name: FUNCTION claim_calendar_booking(p_workspace_id uuid, p_candidate_id text, p_start_time timestamp with time zone, p_request_id text, p_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_calendar_booking(p_workspace_id uuid, p_candidate_id text, p_start_time timestamp with time zone, p_request_id text, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_calendar_booking(p_workspace_id uuid, p_candidate_id text, p_start_time timestamp with time zone, p_request_id text, p_provider text) TO service_role;

--
-- Name: FUNCTION claim_email_outbound(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_email_outbound(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_email_outbound(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid) TO authenticated;

--
-- Name: FUNCTION claim_email_outbound_queued(p_message_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_email_outbound_queued(p_message_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_email_outbound_queued(p_message_id uuid) TO service_role;

--
-- Name: FUNCTION claim_enrichment_budget(p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_enrichment_budget(p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_enrichment_budget(p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text) TO service_role;

--
-- Name: FUNCTION claim_linkedin_outbound_queued(p_message_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_linkedin_outbound_queued(p_message_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_linkedin_outbound_queued(p_message_id uuid) TO service_role;

--
-- Name: FUNCTION cleanup_email_ledger_delivery_receipts(p_retention_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cleanup_email_ledger_delivery_receipts(p_retention_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cleanup_email_ledger_delivery_receipts(p_retention_days integer) TO service_role;

--
-- Name: FUNCTION cleanup_erased_candidate_mirror(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cleanup_erased_candidate_mirror() FROM PUBLIC;

--
-- Name: FUNCTION cleanup_erased_candidate_outcomes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cleanup_erased_candidate_outcomes() FROM PUBLIC;

--
-- Name: FUNCTION cleanup_sourcing_learning_authority(p_workspace_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cleanup_sourcing_learning_authority(p_workspace_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cleanup_sourcing_learning_authority(p_workspace_id uuid, p_limit integer) TO service_role;

--
-- Name: FUNCTION complete_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_query_receipts jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_query_receipts jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_query_receipts jsonb) TO service_role;

--
-- Name: FUNCTION configure_sourcing_learning(p_workspace_id uuid, p_actor_id uuid, p_enabled boolean, p_workspace_daily_limit integer, p_user_daily_limit integer, p_min_evidence_runs integer, p_lesson_ttl_days integer, p_required_graphify_image_digest text, p_expected_version bigint, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.configure_sourcing_learning(p_workspace_id uuid, p_actor_id uuid, p_enabled boolean, p_workspace_daily_limit integer, p_user_daily_limit integer, p_min_evidence_runs integer, p_lesson_ttl_days integer, p_required_graphify_image_digest text, p_expected_version bigint, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_sourcing_learning(p_workspace_id uuid, p_actor_id uuid, p_enabled boolean, p_workspace_daily_limit integer, p_user_daily_limit integer, p_min_evidence_runs integer, p_lesson_ttl_days integer, p_required_graphify_image_digest text, p_expected_version bigint, p_request_id text) TO service_role;

--
-- Name: FUNCTION correlate_inbound_email(p_inbound_id uuid, p_in_reply_to text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.correlate_inbound_email(p_inbound_id uuid, p_in_reply_to text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.correlate_inbound_email(p_inbound_id uuid, p_in_reply_to text) TO service_role;

--
-- Name: FUNCTION current_profile_role(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_profile_role() TO authenticated;

--
-- Name: FUNCTION current_workspace_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_workspace_id() TO authenticated;

--
-- Name: FUNCTION enforce_active_email_approval(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_active_email_approval() FROM PUBLIC;

--
-- Name: FUNCTION enforce_active_linkedin_approval(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_active_linkedin_approval() FROM PUBLIC;

--
-- Name: FUNCTION enforce_agent_spec_authority_immutable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_agent_spec_authority_immutable() FROM PUBLIC;

--
-- Name: FUNCTION enforce_candidate_erasure_obligation_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_candidate_erasure_obligation_limit() FROM PUBLIC;

--
-- Name: FUNCTION enqueue_email_outbound(p_message_id text, p_candidate_id text, p_campaign_id text, p_seat_id uuid, p_recipient text, p_subject text, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enqueue_email_outbound(p_message_id text, p_candidate_id text, p_campaign_id text, p_seat_id uuid, p_recipient text, p_subject text, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_email_outbound(p_message_id text, p_candidate_id text, p_campaign_id text, p_seat_id uuid, p_recipient text, p_subject text, p_body text) TO authenticated;

--
-- Name: FUNCTION ensure_workspace(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_workspace() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_workspace() TO authenticated;

--
-- Name: FUNCTION fail_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_error_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fail_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_sourcing_run(p_workspace_id uuid, p_actor_id uuid, p_run_id uuid, p_error_code text) TO service_role;

--
-- Name: FUNCTION finalize_email_provider_failure(p_message_id uuid, p_delivery_attempt_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finalize_email_provider_failure(p_message_id uuid, p_delivery_attempt_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalize_email_provider_failure(p_message_id uuid, p_delivery_attempt_id uuid, p_reason text) TO service_role;

--
-- Name: FUNCTION gc_deleted_candidacies(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gc_deleted_candidacies() FROM PUBLIC;

--
-- Name: FUNCTION link_candidate_person(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_candidate_person() FROM PUBLIC;

--
-- Name: FUNCTION link_one_candidate(p_candidate public.candidates); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_one_candidate(p_candidate public.candidates) FROM PUBLIC;

--
-- Name: FUNCTION list_candidate_erasure_requests(p_workspace_id uuid, p_actor_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_candidate_erasure_requests(p_workspace_id uuid, p_actor_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_candidate_erasure_requests(p_workspace_id uuid, p_actor_id uuid, p_limit integer) TO service_role;

--
-- Name: FUNCTION list_pending_sourcing_feedback(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_pending_sourcing_feedback(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_pending_sourcing_feedback(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_limit integer) TO service_role;

--
-- Name: FUNCTION list_promoted_sourcing_lessons(p_workspace_id uuid, p_actor_id uuid, p_role_basis jsonb, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_promoted_sourcing_lessons(p_workspace_id uuid, p_actor_id uuid, p_role_basis jsonb, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_promoted_sourcing_lessons(p_workspace_id uuid, p_actor_id uuid, p_role_basis jsonb, p_limit integer) TO service_role;

--
-- Name: FUNCTION list_workspace_candidates(p_campaign_id text, p_stage text, p_source text, p_search text, p_sort text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_workspace_candidates(p_campaign_id text, p_stage text, p_source text, p_search text, p_sort text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_workspace_candidates(p_campaign_id text, p_stage text, p_source text, p_search text, p_sort text, p_limit integer, p_offset integer) TO authenticated;

--
-- Name: FUNCTION mirror_workspace_candidates(p_workspace_id uuid, p_state jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mirror_workspace_candidates(p_workspace_id uuid, p_state jsonb) FROM PUBLIC;

--
-- Name: FUNCTION place_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_reason_code text, p_case_reference text, p_expires_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.place_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_reason_code text, p_case_reference text, p_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_reason_code text, p_case_reference text, p_expires_at timestamp with time zone) TO service_role;

--
-- Name: FUNCTION read_candidate_erasure_obligation_authority(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.read_candidate_erasure_obligation_authority(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_candidate_erasure_obligation_authority(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid) TO service_role;

--
-- Name: FUNCTION reconcile_calendar_booking(p_workspace_id uuid, p_id uuid, p_status text, p_external_event_id text, p_detail text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_calendar_booking(p_workspace_id uuid, p_id uuid, p_status text, p_external_event_id text, p_detail text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_calendar_booking(p_workspace_id uuid, p_id uuid, p_status text, p_external_event_id text, p_detail text) TO service_role;

--
-- Name: FUNCTION reconcile_candidate_erasure_obligation(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid, p_expected_attempt_count integer, p_status text, p_error_code text, p_evidence_sha256 text, p_case_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_candidate_erasure_obligation(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid, p_expected_attempt_count integer, p_status text, p_error_code text, p_evidence_sha256 text, p_case_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_candidate_erasure_obligation(p_workspace_id uuid, p_actor_id uuid, p_obligation_id uuid, p_expected_attempt_count integer, p_status text, p_error_code text, p_evidence_sha256 text, p_case_reference text) TO service_role;

--
-- Name: FUNCTION record_candidate_outcome(p_workspace_id uuid, p_candidate_id text, p_kind text, p_idempotency_key text, p_source_inbound_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_candidate_outcome(p_workspace_id uuid, p_candidate_id text, p_kind text, p_idempotency_key text, p_source_inbound_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_candidate_outcome(p_workspace_id uuid, p_candidate_id text, p_kind text, p_idempotency_key text, p_source_inbound_id uuid) TO service_role;

--
-- Name: FUNCTION record_email_delivery_event(p_workspace_id uuid, p_rfc_message_id text, p_event_status text, p_provider_occurred_at timestamp with time zone, p_provider_error_code integer, p_permanent boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_email_delivery_event(p_workspace_id uuid, p_rfc_message_id text, p_event_status text, p_provider_occurred_at timestamp with time zone, p_provider_error_code integer, p_permanent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_email_delivery_event(p_workspace_id uuid, p_rfc_message_id text, p_event_status text, p_provider_occurred_at timestamp with time zone, p_provider_error_code integer, p_permanent boolean) TO service_role;

--
-- Name: FUNCTION record_email_send_message_id(p_message_id uuid, p_delivery_attempt_id uuid, p_rfc_message_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_email_send_message_id(p_message_id uuid, p_delivery_attempt_id uuid, p_rfc_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_email_send_message_id(p_message_id uuid, p_delivery_attempt_id uuid, p_rfc_message_id text) TO service_role;

--
-- Name: FUNCTION record_inbound_email(p_workspace_id uuid, p_provider_id text, p_from_address text, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_inbound_email(p_workspace_id uuid, p_provider_id text, p_from_address text, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_inbound_email(p_workspace_id uuid, p_provider_id text, p_from_address text, p_body text) TO service_role;

--
-- Name: FUNCTION record_linkedin_delivery_outcome(p_message_id uuid, p_delivery_attempt_id uuid, p_outcome text, p_reason text, p_provider_message_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_linkedin_delivery_outcome(p_message_id uuid, p_delivery_attempt_id uuid, p_outcome text, p_reason text, p_provider_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_linkedin_delivery_outcome(p_message_id uuid, p_delivery_attempt_id uuid, p_outcome text, p_reason text, p_provider_message_id text) TO service_role;

--
-- Name: FUNCTION record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text) TO authenticated;

--
-- Name: FUNCTION record_sourcing_query_feedback(p_workspace_id uuid, p_actor_id uuid, p_receipt_id uuid, p_verdict text, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_sourcing_query_feedback(p_workspace_id uuid, p_actor_id uuid, p_receipt_id uuid, p_verdict text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_sourcing_query_feedback(p_workspace_id uuid, p_actor_id uuid, p_receipt_id uuid, p_verdict text, p_request_id text) TO service_role;

--
-- Name: FUNCTION refresh_candidate_erasure_legal_hold_state(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_candidate_erasure_legal_hold_state(p_request_id uuid) FROM PUBLIC;

--
-- Name: FUNCTION reject_candidate_erasure_receipt_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_candidate_erasure_receipt_mutation() FROM PUBLIC;

--
-- Name: FUNCTION reject_candidate_erasure_reimport(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_candidate_erasure_reimport() FROM PUBLIC;

--
-- Name: FUNCTION reject_email_connection_quarantine_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_email_connection_quarantine_mutation() FROM PUBLIC;

--
-- Name: FUNCTION reject_sourcing_lesson_review_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_sourcing_lesson_review_mutation() FROM PUBLIC;

--
-- Name: FUNCTION release_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_hold_id uuid, p_case_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_hold_id uuid, p_case_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_candidate_legal_hold(p_workspace_id uuid, p_actor_id uuid, p_hold_id uuid, p_case_reference text) TO service_role;

--
-- Name: FUNCTION release_elapsed_outreach_contact_window(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_elapsed_outreach_contact_window() FROM PUBLIC;

--
-- Name: FUNCTION release_enrichment_claim(p_ledger_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_enrichment_claim(p_ledger_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_enrichment_claim(p_ledger_id uuid) TO service_role;

--
-- Name: FUNCTION request_candidate_erasure(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_request_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_candidate_erasure(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_request_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_candidate_erasure(p_workspace_id uuid, p_actor_id uuid, p_campaign_id text, p_candidate_id text, p_request_key uuid) TO service_role;

--
-- Name: FUNCTION resolve_inbound_mailbox_route(p_mailbox text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_inbound_mailbox_route(p_mailbox text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_inbound_mailbox_route(p_mailbox text) TO service_role;

--
-- Name: FUNCTION review_sourcing_lesson(p_workspace_id uuid, p_reviewer_id uuid, p_lesson_id uuid, p_expected_version bigint, p_decision text, p_reason_code text, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_sourcing_lesson(p_workspace_id uuid, p_reviewer_id uuid, p_lesson_id uuid, p_expected_version bigint, p_decision text, p_reason_code text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_sourcing_lesson(p_workspace_id uuid, p_reviewer_id uuid, p_lesson_id uuid, p_expected_version bigint, p_decision text, p_reason_code text, p_request_id text) TO service_role;

--
-- Name: FUNCTION revoke_outreach_approval(p_message_id text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_outreach_approval(p_message_id text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_outreach_approval(p_message_id text, p_reason text) TO authenticated;

--
-- Name: FUNCTION scrub_candidate_workspace_document(p_state jsonb, p_candidate_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scrub_candidate_workspace_document(p_state jsonb, p_candidate_id text) FROM PUBLIC;

--
-- Name: FUNCTION settle_enrichment_spend(p_ledger_id uuid, p_actual_cents integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_enrichment_spend(p_ledger_id uuid, p_actual_cents integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_enrichment_spend(p_ledger_id uuid, p_actual_cents integer) TO service_role;

--
-- Name: FUNCTION settle_provider_run(p_run_id uuid, p_succeeded boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_provider_run(p_run_id uuid, p_succeeded boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_provider_run(p_run_id uuid, p_succeeded boolean) TO service_role;

--
-- Name: FUNCTION settle_provider_run_by_external(p_workspace_id uuid, p_provider text, p_external_run_id text, p_succeeded boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_provider_run_by_external(p_workspace_id uuid, p_provider text, p_external_run_id text, p_succeeded boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_provider_run_by_external(p_workspace_id uuid, p_provider text, p_external_run_id text, p_succeeded boolean) TO service_role;

--
-- Name: FUNCTION sourcing_authority_hmac(p_workspace_id uuid, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sourcing_authority_hmac(p_workspace_id uuid, p_value text) FROM PUBLIC;

--
-- Name: FUNCTION stamp_dust_connection_authority(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stamp_dust_connection_authority() FROM PUBLIC;

--
-- Name: FUNCTION strip_legacy_dust_authority(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.strip_legacy_dust_authority() FROM PUBLIC;

--
-- Name: FUNCTION sync_candidates_corpus(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_candidates_corpus() FROM PUBLIC;

--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC;

--
-- Name: FUNCTION validate_sourcing_learning_query(p_platform text, p_query text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_sourcing_learning_query(p_platform text, p_query text) FROM PUBLIC;

--
-- Name: TABLE agent_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.agent_conversations TO authenticated;

--
-- Name: TABLE agent_seats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_seats TO authenticated;
GRANT ALL ON TABLE public.agent_seats TO service_role;

--
-- Name: TABLE agent_specs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.agent_specs TO authenticated;
GRANT ALL ON TABLE public.agent_specs TO service_role;

--
-- Name: COLUMN agent_specs.name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(name) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.role_brief; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(role_brief) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.channels; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(channels) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.guardrails; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(guardrails) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.seat_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(seat_id) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.agent_specs TO authenticated;

--
-- Name: COLUMN agent_specs.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.agent_specs TO authenticated;

--
-- Name: TABLE api_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.api_keys TO service_role;
GRANT INSERT,DELETE,UPDATE ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.workspace_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(workspace_id) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.provider; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(provider) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.last4; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last4) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.last_tested_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_tested_at) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.created_by; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_by) ON TABLE public.api_keys TO authenticated;

--
-- Name: COLUMN api_keys.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.api_keys TO authenticated;

--
-- Name: TABLE candidate_outcome_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.candidate_outcome_events TO authenticated;

--
-- Name: TABLE dust_connection_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.dust_connection_events TO authenticated;

--
-- Name: TABLE dust_connections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dust_connections TO authenticated;
GRANT SELECT ON TABLE public.dust_connections TO service_role;

--
-- Name: TABLE email_connection_seat_mismatch_quarantine; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.email_connection_seat_mismatch_quarantine TO service_role;

--
-- Name: TABLE email_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_connections TO service_role;
GRANT INSERT,DELETE,UPDATE ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.workspace_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(workspace_id) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.seat_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(seat_id) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.provider; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(provider) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.account_email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(account_email) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.scope; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(scope) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.connected_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(connected_at) ON TABLE public.email_connections TO authenticated;

--
-- Name: COLUMN email_connections.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.email_connections TO authenticated;

--
-- Name: TABLE email_delivery_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.email_delivery_events TO authenticated;
GRANT SELECT ON TABLE public.email_delivery_events TO service_role;

--
-- Name: TABLE inbound_mailbox_routes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.inbound_mailbox_routes TO authenticated;

--
-- Name: TABLE messages_inbound; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.messages_inbound TO authenticated;
GRANT ALL ON TABLE public.messages_inbound TO service_role;

--
-- Name: TABLE messages_outbound; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.messages_outbound TO authenticated;
GRANT ALL ON TABLE public.messages_outbound TO service_role;

--
-- Name: TABLE outreach_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.outreach_approvals TO authenticated;
GRANT ALL ON TABLE public.outreach_approvals TO service_role;

--
-- Name: TABLE outreach_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.outreach_ledger TO authenticated;
GRANT ALL ON TABLE public.outreach_ledger TO service_role;

--
-- Name: COLUMN outreach_ledger.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.outreach_ledger TO authenticated;

--
-- Name: COLUMN outreach_ledger.reason; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(reason) ON TABLE public.outreach_ledger TO authenticated;

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

--
-- Name: TABLE suppression_list; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.suppression_list TO authenticated;
GRANT ALL ON TABLE public.suppression_list TO service_role;

--
-- Name: TABLE workspace_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_state TO authenticated;
GRANT ALL ON TABLE public.workspace_state TO service_role;

--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;

--
--


-- Restore the session settings changed by the pg_dump preamble so later
-- migrations in the same transaction run with normal defaults.
reset statement_timeout;
reset lock_timeout;
reset idle_in_transaction_session_timeout;
reset transaction_timeout;
reset check_function_bodies;
reset xmloption;
reset client_min_messages;
reset row_security;
reset default_table_access_method;
