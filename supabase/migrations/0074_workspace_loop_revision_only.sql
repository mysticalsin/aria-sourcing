-- 0074_workspace_loop_revision_only.sql
--
-- read_workspace_state_for_loop previously returned the full workspace_state.state
-- blob. After many E2E campaigns that JSON exceeds the loop worker's bounded RPC
-- reader (256 KiB), so every completeJobWithWorkspacePatch / inbound_classify
-- failed with response_size_invalid and never append_reply'd.
--
-- Loop handlers only need updated_at for optimistic concurrency. Campaign and
-- candidate lookups use targeted slice RPCs below.

create or replace function public.read_workspace_state_for_loop(p_workspace_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ws public.workspace_state%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select * into ws
    from public.workspace_state
   where workspace_id = p_workspace_id;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  return json_build_object(
    'status', 'ok',
    'workspace_id', ws.workspace_id,
    'updated_at', ws.updated_at
  );
end;
$$;

revoke all on function public.read_workspace_state_for_loop(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_state_for_loop(uuid) to service_role;
alter function public.read_workspace_state_for_loop(uuid) owner to postgres;

-- Single campaign blob by id (campaign_create existence check).
create or replace function public.read_workspace_campaign_for_loop(
  p_workspace_id uuid,
  p_campaign_id text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  camp jsonb;
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

  select elem into camp
    from public.workspace_state ws,
         lateral jsonb_array_elements(coalesce(ws.state->'campaigns', '[]'::jsonb)) elem
   where ws.workspace_id = p_workspace_id
     and elem->>'id' = p_campaign_id
   limit 1;

  if camp is null then
    return json_build_object('status', 'not_found');
  end if;

  return json_build_object('status', 'ok', 'campaign', camp);
end;
$$;

revoke all on function public.read_workspace_campaign_for_loop(uuid, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_campaign_for_loop(uuid, text) to service_role;
alter function public.read_workspace_campaign_for_loop(uuid, text) owner to postgres;

-- Candidate blobs by id list (shortlist resolution from workspace).
create or replace function public.read_workspace_candidates_for_loop(
  p_workspace_id uuid,
  p_candidate_ids text[]
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  found jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null then
    return json_build_object('status', 'invalid_request');
  end if;
  if p_candidate_ids is null or cardinality(p_candidate_ids) is null or cardinality(p_candidate_ids) = 0 then
    return json_build_object('status', 'ok', 'candidates', '[]'::jsonb);
  end if;
  if cardinality(p_candidate_ids) > 200 then
    return json_build_object('status', 'invalid_request', 'reason', 'too_many_ids');
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb) into found
    from public.workspace_state ws,
         lateral jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
   where ws.workspace_id = p_workspace_id
     and elem->>'id' = any(p_candidate_ids);

  return json_build_object('status', 'ok', 'candidates', found);
end;
$$;

revoke all on function public.read_workspace_candidates_for_loop(uuid, text[])
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_candidates_for_loop(uuid, text[]) to service_role;
alter function public.read_workspace_candidates_for_loop(uuid, text[]) owner to postgres;
