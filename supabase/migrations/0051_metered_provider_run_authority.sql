-- 0051_metered_provider_run_authority.sql
--
-- Rock 4: provider runs are durable loop-owned work, metered by the
-- workspace's daily sourcing cap before a provider socket is reached.

alter table public.sourcing_provider_runs
  add column if not exists dataset_id text check (dataset_id is null or char_length(dataset_id) between 1 and 200);

create or replace function public.begin_provider_run(
  p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text default null
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  existing public.sourcing_provider_runs%rowtype;
  controls public.sourcing_loop_controls%rowtype;
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

  select * into controls
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
  if not found or controls.kill_switch or not controls.sourcing_enabled then
    return json_build_object('ok', false, 'reason', 'control_blocked');
  end if;

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

create or replace function public.attach_provider_run(
  p_run_id uuid, p_external_run_id text, p_dataset_id text default null
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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

create or replace function public.settle_provider_run_by_external(
  p_workspace_id uuid, p_provider text, p_external_run_id text, p_succeeded boolean
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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

create or replace function public.read_provider_run_for_loop(
  p_workspace_id uuid, p_run_id uuid
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  run_row public.sourcing_provider_runs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('status', 'service_only'); end if;
  if p_workspace_id is null or p_run_id is null then return json_build_object('status', 'invalid_request'); end if;
  if not public.sourcing_loop_stage_enabled(p_workspace_id, 'provider_poll') then
    return json_build_object('status', 'control_blocked');
  end if;
  select * into run_row
    from public.sourcing_provider_runs
   where workspace_id = p_workspace_id
     and id = p_run_id;
  if not found then return json_build_object('status', 'not_found'); end if;
  return json_build_object(
    'status', 'ok',
    'id', run_row.id,
    'workspace_id', run_row.workspace_id,
    'provider', run_row.provider,
    'external_run_id', run_row.external_run_id,
    'dataset_id', coalesce(run_row.dataset_id, ''),
    'campaign_id', coalesce(run_row.campaign_id, ''),
    'run_status', run_row.status
  );
end; $$;

create or replace function public.claim_enrichment_budget(
  p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text default null
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  budget public.enrichment_budgets%rowtype;
  controls public.sourcing_loop_controls%rowtype;
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

  select * into controls
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
  if not found or controls.kill_switch or not controls.enrichment_enabled then
    return json_build_object('allowed', false, 'reason', 'control_blocked');
  end if;

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

revoke all on function public.begin_provider_run(uuid, text, text, text) from public, anon, authenticated, authenticator;
grant execute on function public.begin_provider_run(uuid, text, text, text) to service_role;
revoke all on function public.attach_provider_run(uuid, text, text) from public, anon, authenticated, authenticator;
grant execute on function public.attach_provider_run(uuid, text, text) to service_role;
revoke all on function public.settle_provider_run_by_external(uuid, text, text, boolean) from public, anon, authenticated, authenticator;
grant execute on function public.settle_provider_run_by_external(uuid, text, text, boolean) to service_role;
revoke all on function public.read_provider_run_for_loop(uuid, uuid) from public, anon, authenticated, authenticator;
grant execute on function public.read_provider_run_for_loop(uuid, uuid) to service_role;
revoke all on function public.claim_enrichment_budget(uuid, text, text, integer, text) from public, anon, authenticated, authenticator;
grant execute on function public.claim_enrichment_budget(uuid, text, text, integer, text) to service_role;

alter function public.begin_provider_run(uuid, text, text, text) owner to postgres;
alter function public.attach_provider_run(uuid, text, text) owner to postgres;
alter function public.settle_provider_run_by_external(uuid, text, text, boolean) owner to postgres;
alter function public.read_provider_run_for_loop(uuid, uuid) owner to postgres;
alter function public.claim_enrichment_budget(uuid, text, text, integer, text) owner to postgres;
