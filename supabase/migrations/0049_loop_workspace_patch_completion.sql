-- 0049_loop_workspace_patch_completion.sql
--
-- Rock 1 bridge: the durable loop worker must commit a workspace_state artifact
-- through 0042 apply_workspace_patch and complete the aria_jobs lease with its
-- follow-on enqueue in one database transaction. This migration does not add a
-- send path and does not change job-kind vocabulary.

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
    'state', ws.state,
    'updated_at', ws.updated_at
  );
end;
$$;

revoke all on function public.read_workspace_state_for_loop(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_workspace_state_for_loop(uuid) to service_role;

create or replace function public.complete_aria_job_with_workspace_patch(
  p_job_id uuid,
  p_lease_id uuid,
  p_expected_updated_at timestamptz,
  p_patch_kind text,
  p_patch jsonb,
  p_receipt_key text,
  p_result_sha256 text,
  p_events jsonb default '[]'::jsonb,
  p_enqueue jsonb default '[]'::jsonb
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  patch_result json;
  patch_status text;
  completed boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
   for update;
  if not found then
    return json_build_object('status', 'stale_lease');
  end if;

  patch_result := public.apply_workspace_patch(
    job_row.workspace_id,
    p_expected_updated_at,
    p_patch_kind,
    p_patch,
    p_receipt_key
  );
  patch_status := patch_result->>'status';
  if patch_status not in ('applied', 'already_applied') then
    return json_build_object(
      'status', 'patch_failed',
      'patch_status', patch_status,
      'patch', patch_result
    );
  end if;

  completed := public.complete_aria_job(
    p_job_id,
    p_lease_id,
    p_result_sha256,
    p_events,
    p_enqueue
  );
  if not completed then
    raise exception 'job completion failed' using errcode = '22023';
  end if;

  return json_build_object(
    'status', 'completed',
    'patch_status', patch_status,
    'new_updated_at', patch_result->>'new_updated_at'
  );
end;
$$;

revoke all on function public.complete_aria_job_with_workspace_patch(
  uuid, uuid, timestamptz, text, jsonb, text, text, jsonb, jsonb
) from public, anon, authenticated, authenticator;
grant execute on function public.complete_aria_job_with_workspace_patch(
  uuid, uuid, timestamptz, text, jsonb, text, text, jsonb, jsonb
) to service_role;

alter function public.read_workspace_state_for_loop(uuid) owner to postgres;
alter function public.complete_aria_job_with_workspace_patch(
  uuid, uuid, timestamptz, text, jsonb, text, text, jsonb, jsonb
) owner to postgres;
