\set ON_ERROR_STOP on
begin;
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sourcing-fixture@example.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values ('e2222222-2222-4222-8222-222222222222','Unified sourcing fixture');
insert into public.profiles(id,email,full_name,workspace_id,role) values ('e1111111-1111-4111-8111-111111111111','sourcing-fixture@example.test','Fixture','e2222222-2222-4222-8222-222222222222','member');
insert into public.workspace_state(workspace_id,state) values ('e2222222-2222-4222-8222-222222222222',
  '{"campaigns":[{"id":"fixture-campaign","status":"Sourcing","jobAnalysis":{},"sourcingStrategy":{},"scoringWeights":{}}],"candidates":[]}');
insert into public.campaign_sourcing_jobs(id,workspace_id,actor_id,campaign_id,request_key,campaign_snapshot,steps,claim_token,claim_until)
values ('e3333333-3333-4333-8333-333333333333','e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','fixture-campaign',gen_random_uuid(),
  '{"jobAnalysis":{},"scoringWeights":{},"sourcingStrategy":{},"status":"Sourcing"}', '[{"source":"LinkedIn","status":"running"}]',
  'e4444444-4444-4444-8444-444444444444',now()+interval '3 minutes');

do $$ begin
  begin
    insert into public.campaign_sourcing_jobs(workspace_id,actor_id,campaign_id,request_key,campaign_snapshot,steps)
      values ('e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','fixture-campaign',gen_random_uuid(),'{}','[{}]');
    raise exception 'Concurrent campaign launch accepted';
  exception when unique_violation then null;
  end;
  if has_table_privilege('authenticated','public.campaign_sourcing_jobs','SELECT')
    or has_table_privilege('authenticated','public.campaign_sourcing_jobs','INSERT')
    or has_function_privilege('authenticated','public.finish_campaign_sourcing_step(uuid,uuid,jsonb,text,timestamptz,jsonb)','EXECUTE') then
    raise exception 'Browser must not own sourcing run authority';
  end if;
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$
declare result jsonb; version timestamptz; before_state jsonb; begin
  -- Executes the retired-loop-control regression: this formerly raised an
  -- undeclared controls.max_sourcing_runs_per_day SQL exception.
  result := public.begin_provider_run('e2222222-2222-4222-8222-222222222222','Apify','quota-fixture','fixture-campaign')::jsonb;
  if result->>'ok' <> 'true' then raise exception 'Provider reservation failed: %', result; end if;
  result := public.begin_provider_run('e2222222-2222-4222-8222-222222222222','Apify','quota-fixture','fixture-campaign')::jsonb;
  if result->>'duplicate' <> 'true' then raise exception 'Provider reservation replay not deduplicated'; end if;
  insert into public.sourcing_provider_runs(workspace_id,provider,external_run_id,campaign_id)
    select 'e2222222-2222-4222-8222-222222222222','Apify','quota-fixture-'||n,'fixture-campaign' from generate_series(1,99) n;
  result := public.begin_provider_run('e2222222-2222-4222-8222-222222222222','Apify','quota-over-cap','fixture-campaign')::jsonb;
  if result->>'reason' <> 'sourcing_run_quota_exceeded' then raise exception 'Provider quota cap bypassed: %',result; end if;
  select updated_at,state into version,before_state from public.workspace_state where workspace_id='e2222222-2222-4222-8222-222222222222';
  result := public.finish_campaign_sourcing_step('e3333333-3333-4333-8333-333333333333','e5555555-5555-4555-8555-555555555555','[{"status":"completed"}]','completed',version,before_state);
  if result->>'reason' <> 'claim_lost' then raise exception 'Foreign claim accepted'; end if;
  result := public.finish_campaign_sourcing_step('e3333333-3333-4333-8333-333333333333','e4444444-4444-4444-8444-444444444444','[{"status":"completed"}]','completed',version-interval '1 second',before_state);
  if result->>'reason' <> 'state_conflict' then raise exception 'Stale state accepted'; end if;
  if (select status from public.campaign_sourcing_jobs where id='e3333333-3333-4333-8333-333333333333') <> 'active' then raise exception 'Conflict completed job'; end if;
  result := public.finish_campaign_sourcing_step('e3333333-3333-4333-8333-333333333333','e4444444-4444-4444-8444-444444444444','[{"status":"completed","added":0}]','completed',version,before_state || '{"unifiedFixture":true}'::jsonb);
  if result->>'ok' <> 'true' then raise exception 'Atomic completion failed: %',result; end if;
  if (select state->>'unifiedFixture' from public.workspace_state where workspace_id='e2222222-2222-4222-8222-222222222222') <> 'true' then raise exception 'State did not persist with completion'; end if;
  result := public.finish_campaign_sourcing_step('e3333333-3333-4333-8333-333333333333','e4444444-4444-4444-8444-444444444444','[{"status":"completed"}]','completed',version,before_state);
  if result->>'reason' <> 'claim_lost' then raise exception 'Completion replay accepted'; end if;
end $$;
reset role;
update public.campaign_sourcing_jobs set status='active',claim_token='e4444444-4444-4444-8444-444444444444' where id='e3333333-3333-4333-8333-333333333333';
update public.profiles set role='viewer' where id='e1111111-1111-4111-8111-111111111111';
set local role service_role;
do $$ declare result jsonb; begin
  result := public.finish_campaign_sourcing_step('e3333333-3333-4333-8333-333333333333','e4444444-4444-4444-8444-444444444444','[{"status":"completed"}]','completed',now(),null);
  if result->>'reason' <> 'authority_changed' then raise exception 'Revoked source role accepted'; end if;
end $$;
reset role;
rollback;
\echo 'PASS: unified sourcing authority, quota, state conflict and atomic completion'
