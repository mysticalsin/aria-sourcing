-- Durable, resumable sourcing. Only the service can mutate run authority.
create table public.campaign_sourcing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  campaign_id text not null check (length(campaign_id) between 1 and 100),
  request_key uuid not null,
  campaign_snapshot jsonb not null,
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 2),
  status text not null default 'active' check (status in ('active','completed','partial','failed')),
  revision integer not null default 0,
  claim_token uuid,
  claim_until timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, actor_id, request_key)
);
create unique index campaign_sourcing_jobs_one_active on public.campaign_sourcing_jobs(workspace_id,campaign_id) where status = 'active';
alter table public.campaign_sourcing_jobs enable row level security;
alter table public.campaign_sourcing_jobs force row level security;
revoke all on public.campaign_sourcing_jobs from public, anon, authenticated, authenticator;
grant select, insert, update, delete on public.campaign_sourcing_jobs to service_role;
create policy campaign_sourcing_jobs_owner on public.campaign_sourcing_jobs to postgres, supabase_admin using (true) with check (true);

-- Completion and candidate persistence are one transaction. A stale whole-state
-- write can never overwrite a teammate's edit or mark unpersisted results done.
create function public.finish_campaign_sourcing_step(
  p_job_id uuid, p_claim_token uuid, p_steps jsonb, p_status text,
  p_expected_updated_at timestamptz, p_state jsonb default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  job public.campaign_sourcing_jobs%rowtype;
  ws public.workspace_state%rowtype;
  campaign jsonb;
  blocked_ids jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('ok',false,'reason','service-only'); end if;
  select * into job from public.campaign_sourcing_jobs where id = p_job_id for update;
  if not found or p_claim_token is null or job.claim_token is distinct from p_claim_token or job.status <> 'active' then
    return jsonb_build_object('ok',false,'reason','claim_lost');
  end if;
  if not exists (select 1 from public.profiles where id = job.actor_id and workspace_id = job.workspace_id and role in ('admin','member')) then
    return jsonb_build_object('ok',false,'reason','authority_changed');
  end if;
  select * into ws from public.workspace_state where workspace_id = job.workspace_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','authority_changed'); end if;
  select value into campaign from jsonb_array_elements(ws.state->'campaigns') where value->>'id' = job.campaign_id;
  if campaign is null or jsonb_build_object('jobAnalysis',campaign->'jobAnalysis','scoringWeights',campaign->'scoringWeights',
    'sourcingStrategy',campaign->'sourcingStrategy','status',campaign->'status') is distinct from job.campaign_snapshot then
    return jsonb_build_object('ok',false,'reason','authority_changed');
  end if;
  if ws.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok',false,'reason','state_conflict'); end if;
  -- Do not let one erased identity poison an otherwise valid provider batch.
  -- Return only new candidate IDs to the service; it remaps the remaining
  -- batch and recomputes metrics. The existing trigger is still the final guard.
  if p_state is not null then
    select jsonb_agg(candidate->>'id') into blocked_ids
      from jsonb_array_elements(p_state->'candidates') candidate
      where not exists (select 1 from jsonb_array_elements(ws.state->'candidates') prior where prior->>'id' = candidate->>'id')
      and exists (select 1 from (values
        ('email',candidate->>'email'),('phone',candidate->>'phone'),
        ('linkedin',candidate->>'linkedinUrl'),('github',candidate->>'githubUrl'),
        ('source_url',candidate->>'sourceUrl'),('source_external_id',candidate->>'sourceExternalId')
      ) identity(kind,value) where coalesce(btrim(value),'') <> '' and public.candidate_erasure_tombstone_exists(job.workspace_id,kind,value));
    if blocked_ids is not null then return jsonb_build_object('ok',false,'reason','erased_candidates','blocked_ids',blocked_ids); end if;
  end if;
  if p_state is not null then update public.workspace_state set state = p_state where workspace_id = job.workspace_id; end if;
  update public.campaign_sourcing_jobs set steps = p_steps, status = p_status, revision = revision + 1,
    claim_token = null, claim_until = null where id = job.id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.finish_campaign_sourcing_step(uuid,uuid,jsonb,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.finish_campaign_sourcing_step(uuid,uuid,jsonb,text,timestamptz,jsonb) to service_role;

-- Baseline retirement of loop controls left an undeclared `controls` variable
-- in begin_provider_run. Keep a bounded independent workspace cap (100/day),
-- with the existing quota-row lock serializing simultaneous reservations.
CREATE OR REPLACE FUNCTION public.begin_provider_run(p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text DEFAULT NULL::text) RETURNS json
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
  if used >= 100 then
    return json_build_object('ok', false, 'reason', 'sourcing_run_quota_exceeded', 'used', used, 'limit', 100);
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
