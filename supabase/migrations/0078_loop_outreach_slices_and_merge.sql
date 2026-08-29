-- 0078_loop_outreach_slices_and_merge.sql
-- Post-0074, read_workspace_state_for_loop returns revision only. Autopilot
-- crons (draft, prep, sweep, calendar) still need bounded slices. Also add
-- merge_outreach_message so sweep can flip Needs Approval → Scheduled after
-- durable queue without re-appending duplicates.

-- ---------------------------------------------------------------------------
-- 1. Booking slice
-- ---------------------------------------------------------------------------
create or replace function public.read_workspace_booking_for_loop(
  p_workspace_id uuid,
  p_booking_id text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  row jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null
     or p_booking_id is null
     or char_length(btrim(p_booking_id)) < 1
     or char_length(p_booking_id) > 160 then
    return json_build_object('status', 'invalid_request');
  end if;

  select elem into row
    from public.workspace_state ws,
         lateral jsonb_array_elements(coalesce(ws.state->'bookings', '[]'::jsonb)) elem
   where ws.workspace_id = p_workspace_id
     and elem->>'id' = p_booking_id
   limit 1;

  if row is null then
    return json_build_object('status', 'not_found');
  end if;

  return json_build_object('status', 'ok', 'booking', row);
end;
$$;

revoke all on function public.read_workspace_booking_for_loop(uuid, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_booking_for_loop(uuid, text) to service_role;
alter function public.read_workspace_booking_for_loop(uuid, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- 2. Skills slice (bounded — drafts only need agent skill list)
-- ---------------------------------------------------------------------------
create or replace function public.read_workspace_skills_for_loop(
  p_workspace_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  skills jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select coalesce(ws.state->'skills', '[]'::jsonb) into skills
    from public.workspace_state ws
   where ws.workspace_id = p_workspace_id;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  -- Cap array length to keep RPC bounded.
  if jsonb_typeof(skills) = 'array' and jsonb_array_length(skills) > 100 then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into skills
      from (
        select elem
          from jsonb_array_elements(skills) with ordinality as t(elem, ord)
         order by ord
         limit 100
      ) capped;
  end if;

  return json_build_object('status', 'ok', 'skills', coalesce(skills, '[]'::jsonb));
end;
$$;

revoke all on function public.read_workspace_skills_for_loop(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_skills_for_loop(uuid) to service_role;
alter function public.read_workspace_skills_for_loop(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- 3. Outreach slice — by message id, or ready-for-autopilot sweep (capped)
-- ---------------------------------------------------------------------------
create or replace function public.read_workspace_outreach_for_loop(
  p_workspace_id uuid,
  p_message_id text default null,
  p_ready_sweep boolean default false,
  p_limit integer default 20
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  found jsonb := '[]'::jsonb;
  lim integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  lim := least(greatest(coalesce(p_limit, 20), 1), 50);

  if p_message_id is not null and char_length(btrim(p_message_id)) > 0 then
    if char_length(p_message_id) > 160 then
      return json_build_object('status', 'invalid_request');
    end if;
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into found
      from public.workspace_state ws,
           lateral jsonb_array_elements(coalesce(ws.state->'outreach', '[]'::jsonb)) elem
     where ws.workspace_id = p_workspace_id
       and elem->>'id' = p_message_id;
    return json_build_object('status', 'ok', 'outreach', found);
  end if;

  if p_ready_sweep is true then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into found
      from (
        select elem
          from public.workspace_state ws,
               lateral jsonb_array_elements(coalesce(ws.state->'outreach', '[]'::jsonb)) elem
         where ws.workspace_id = p_workspace_id
           and elem->>'status' = 'Needs Approval'
           and elem->>'qualityStatus' = 'ready'
           and (elem->>'qualityCriticsUsed')::boolean is true
         order by elem->>'createdAt' desc nulls last
         limit lim
      ) ready;
    return json_build_object('status', 'ok', 'outreach', coalesce(found, '[]'::jsonb));
  end if;

  -- campaignId+candidateId latest Needs Approval — caller filters after.
  return json_build_object('status', 'invalid_request', 'reason', 'message_id_or_sweep_required');
end;
$$;

revoke all on function public.read_workspace_outreach_for_loop(uuid, text, boolean, integer)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_outreach_for_loop(uuid, text, boolean, integer)
  to service_role;
alter function public.read_workspace_outreach_for_loop(uuid, text, boolean, integer)
  owner to postgres;

-- Latest Needs Approval outreach for one campaign+candidate (draft retry / messageId omit).
create or replace function public.read_workspace_candidate_outreach_for_loop(
  p_workspace_id uuid,
  p_campaign_id text,
  p_candidate_id text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  row jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null
     or p_campaign_id is null
     or p_candidate_id is null
     or char_length(btrim(p_campaign_id)) < 1
     or char_length(btrim(p_candidate_id)) < 1
     or char_length(p_campaign_id) > 160
     or char_length(p_candidate_id) > 160 then
    return json_build_object('status', 'invalid_request');
  end if;

  select elem into row
    from public.workspace_state ws,
         lateral jsonb_array_elements(coalesce(ws.state->'outreach', '[]'::jsonb)) elem
   where ws.workspace_id = p_workspace_id
     and elem->>'campaignId' = p_campaign_id
     and elem->>'candidateId' = p_candidate_id
     and elem->>'status' in ('Needs Approval', 'Draft')
   order by elem->>'createdAt' desc nulls last
   limit 1;

  if row is null then
    return json_build_object('status', 'not_found');
  end if;

  return json_build_object('status', 'ok', 'outreach', row);
end;
$$;

revoke all on function public.read_workspace_candidate_outreach_for_loop(uuid, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_candidate_outreach_for_loop(uuid, text, text)
  to service_role;
alter function public.read_workspace_candidate_outreach_for_loop(uuid, text, text)
  owner to postgres;

-- ---------------------------------------------------------------------------
-- 4. Settings scoringWeights only (sourcing batch fallback)
-- ---------------------------------------------------------------------------
create or replace function public.read_workspace_scoring_weights_for_loop(
  p_workspace_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  weights jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select ws.state#> '{settings,scoringWeights}' into weights
    from public.workspace_state ws
   where ws.workspace_id = p_workspace_id;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  return json_build_object('status', 'ok', 'scoringWeights', weights);
end;
$$;

revoke all on function public.read_workspace_scoring_weights_for_loop(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_scoring_weights_for_loop(uuid) to service_role;
alter function public.read_workspace_scoring_weights_for_loop(uuid) owner to postgres;

-- Candidate identity stubs for sourcing dedupe (id + linkedinUrl + email only).
create or replace function public.read_workspace_candidate_identities_for_loop(
  p_workspace_id uuid,
  p_campaign_id text,
  p_limit integer default 500
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  found jsonb := '[]'::jsonb;
  lim integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null
     or p_campaign_id is null
     or char_length(btrim(p_campaign_id)) < 1
     or char_length(p_campaign_id) > 160 then
    return json_build_object('status', 'invalid_request');
  end if;

  lim := least(greatest(coalesce(p_limit, 500), 1), 2000);

  select coalesce(jsonb_agg(stub), '[]'::jsonb) into found
    from (
      select jsonb_build_object(
               'id', elem->>'id',
               'campaignId', elem->>'campaignId',
               'email', coalesce(elem->>'email', ''),
               'linkedinUrl', coalesce(elem->>'linkedinUrl', ''),
               'githubUrl', coalesce(elem->>'githubUrl', ''),
               'sourceUrl', coalesce(elem->>'sourceUrl', ''),
               'lastContactedAt', elem->>'lastContactedAt',
               'name', coalesce(elem->>'name', '')
             ) as stub
        from public.workspace_state ws,
             lateral jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
       where ws.workspace_id = p_workspace_id
         and elem->>'campaignId' = p_campaign_id
       order by elem->>'createdAt' desc nulls last
       limit lim
    ) stubs;

  return json_build_object('status', 'ok', 'candidates', coalesce(found, '[]'::jsonb));
end;
$$;

revoke all on function public.read_workspace_candidate_identities_for_loop(uuid, text, integer)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_candidate_identities_for_loop(uuid, text, integer)
  to service_role;
alter function public.read_workspace_candidate_identities_for_loop(uuid, text, integer)
  owner to postgres;

-- ---------------------------------------------------------------------------
-- 5. apply_workspace_patch — add merge_outreach_message
-- ---------------------------------------------------------------------------
create or replace function public.apply_workspace_patch(
  p_workspace_id uuid,
  p_expected_updated_at timestamptz,
  p_patch_kind text,
  p_patch jsonb,
  p_receipt_key text
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  ws public.workspace_state%rowtype;
  receipt public.workspace_patch_receipts%rowtype;
  sha text;
  new_state jsonb;
  payload text;
  append_kinds constant text[] := array[
    'append_campaign', 'append_candidates', 'append_activities', 'append_reply',
    'append_enrichment_ledger', 'append_outreach', 'append_booking'];
  append_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_patch_kind is null or p_patch_kind not in (
      'append_campaign', 'append_candidates', 'append_activities', 'append_reply',
      'append_enrichment_ledger', 'append_outreach', 'append_booking',
      'merge_candidate_patch', 'merge_outreach_status', 'merge_outreach_message') then
    return json_build_object('status', 'invalid_request', 'reason', 'unknown-patch-kind');
  end if;
  if p_patch is null then
    return json_build_object('status', 'invalid_request', 'reason', 'null-patch');
  end if;
  if p_receipt_key is null or char_length(btrim(p_receipt_key)) < 1 or char_length(p_receipt_key) > 200 then
    return json_build_object('status', 'invalid_request', 'reason', 'invalid-receipt-key');
  end if;

  payload := p_patch_kind || E'\n' || p_patch::text;
  begin
    sha := encode(public.digest(convert_to(payload, 'UTF8'), 'sha256'::text), 'hex');
  exception
    when undefined_function then
      begin
        sha := encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'::text), 'hex');
      exception
        when undefined_function then
          sha := md5(payload) || md5(reverse(payload));
      end;
  end;

  select * into ws
    from public.workspace_state
    where workspace_id = p_workspace_id
    for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if p_expected_updated_at is distinct from ws.updated_at then
    return json_build_object('status', 'stale_token');
  end if;

  select * into receipt
    from public.workspace_patch_receipts
   where workspace_id = p_workspace_id
     and receipt_key = p_receipt_key;
  if found then
    if receipt.patch_kind = p_patch_kind and receipt.patch_sha256 = sha then
      return json_build_object('status', 'already_applied');
    end if;
    return json_build_object('status', 'idempotency_conflict');
  end if;

  new_state := ws.state;
  if p_patch_kind = any(append_kinds) then
    if jsonb_typeof(p_patch) <> 'array' then
      return json_build_object('status', 'invalid_request', 'reason', 'append-expects-array');
    end if;
    append_key := case p_patch_kind
      when 'append_campaign' then 'campaigns'
      when 'append_candidates' then 'candidates'
      when 'append_activities' then 'activities'
      when 'append_reply' then 'replies'
      when 'append_enrichment_ledger' then 'enrichmentLedger'
      when 'append_outreach' then 'outreach'
      when 'append_booking' then 'bookings'
    end;
    new_state := jsonb_set(
      new_state,
      array[append_key],
      coalesce(new_state->append_key, '[]'::jsonb) || p_patch,
      true);

  elsif p_patch_kind = 'merge_candidate_patch' then
    if p_patch->>'id' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-candidate-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'id'
                and (p_patch->>'campaignId' is null or elem->>'campaignId' = p_patch->>'campaignId')
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);

  elsif p_patch_kind = 'merge_outreach_status' then
    if p_patch->>'candidateId' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-outreach-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'candidateId'
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);

  elsif p_patch_kind = 'merge_outreach_message' then
    if p_patch->>'id' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-outreach-message-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{outreach}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'id'
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'outreach', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);
  end if;

  update public.workspace_state
     set state = new_state
   where workspace_id = p_workspace_id;

  insert into public.workspace_patch_receipts(workspace_id, receipt_key, patch_kind, patch_sha256)
  values (p_workspace_id, p_receipt_key, p_patch_kind, sha);

  return json_build_object('status', 'applied');
end;
$$;

revoke all on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text)
  to service_role;

alter function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text) owner to postgres;
