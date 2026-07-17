-- 0044_sourcing_enrichment_authority.sql
--
-- Rock 5: give paid sourcing/enrichment a SERVER owner so the durable worker can
-- source, enrich, score, and commit with every browser closed — and a restart
-- mid-poll never double-pays or double-contacts.
--   * sourcing_provider_runs  — a paid async provider run (Apify/Sillage/Seamless)
--     gets a server row keyed by (workspace, provider, external_run_id), so a
--     provider_poll job resumes exactly-once instead of the browser-only runId.
--   * enrichment_budgets + enrichment_spend_ledger — the enrichment budget moves
--     server-side (reusing the calendar/claim-ledger pattern): a claim fails closed
--     as budget_exhausted, a settle finalizes real spend, a release returns an
--     unspent claim. Replaces the client-trusted budget at /api/source/enrich.
--
-- ⚠️ DEGRADED (Codex Integrator usage-limited until 2026-07-23; adversarial review
-- REQUIRED) and NOT runnable in the build sandbox (Docker denied). The worker-side
-- lib extraction + scoring-parity fixture (client path vs worker bundle byte-identical)
-- are a follow-up; this migration is the durable authority only. Ships dark behind
-- the 0038 loop kill switch. Prove with tests/sourcing-loop-db.sh + the erasure suite.
--
-- Idempotent; safe to re-run. Run AFTER 0043_requisition_authority.sql.

-- ---------------------------------------------------------------------------
-- 1. sourcing_provider_runs — server owner for a paid async provider run.
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_provider_runs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  provider         text not null check (char_length(provider) between 1 and 60),
  external_run_id  text not null check (char_length(external_run_id) between 1 and 200),
  campaign_id      text,
  status           text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at       timestamptz not null default now(),
  settled_at       timestamptz,
  unique (workspace_id, provider, external_run_id)
);

create index if not exists sourcing_provider_runs_open_idx
  on public.sourcing_provider_runs (workspace_id, status, started_at)
  where status = 'running';

alter table public.sourcing_provider_runs enable row level security;
alter table public.sourcing_provider_runs force row level security;
revoke all on public.sourcing_provider_runs from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_provider_runs_owner_access on public.sourcing_provider_runs;
create policy sourcing_provider_runs_owner_access on public.sourcing_provider_runs
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. enrichment_budgets + enrichment_spend_ledger — server-side spend authority.
-- ---------------------------------------------------------------------------
create table if not exists public.enrichment_budgets (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  period        text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'), -- YYYY-MM
  budget_cents  integer not null check (budget_cents >= 0),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, period)
);

create table if not exists public.enrichment_spend_ledger (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  period          text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status          text not null default 'claimed' check (status in ('claimed', 'settled', 'released')),
  amount_cents    integer not null check (amount_cents >= 0),
  provider        text,
  claimed_at      timestamptz not null default now(),
  settled_at      timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists enrichment_spend_period_idx
  on public.enrichment_spend_ledger (workspace_id, period, status);

alter table public.enrichment_budgets enable row level security;
alter table public.enrichment_budgets force row level security;
alter table public.enrichment_spend_ledger enable row level security;
alter table public.enrichment_spend_ledger force row level security;
revoke all on public.enrichment_budgets from public, anon, authenticated, service_role, authenticator;
revoke all on public.enrichment_spend_ledger from public, anon, authenticated, service_role, authenticator;
grant select on public.enrichment_budgets to authenticated;
grant select on public.enrichment_spend_ledger to authenticated;
drop policy if exists enrichment_budgets_owner_access on public.enrichment_budgets;
create policy enrichment_budgets_owner_access on public.enrichment_budgets
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists enrichment_budgets_member_read on public.enrichment_budgets;
create policy enrichment_budgets_member_read on public.enrichment_budgets
  for select to authenticated using (workspace_id = public.current_workspace_id());
drop policy if exists enrichment_spend_owner_access on public.enrichment_spend_ledger;
create policy enrichment_spend_owner_access on public.enrichment_spend_ledger
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists enrichment_spend_member_read on public.enrichment_spend_ledger;
create policy enrichment_spend_member_read on public.enrichment_spend_ledger
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 3. RPCs (all service-only).
-- ---------------------------------------------------------------------------
create or replace function public.begin_provider_run(
  p_workspace_id uuid, p_provider text, p_external_run_id text, p_campaign_id text default null
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare existing public.sourcing_provider_runs%rowtype; new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  select * into existing from public.sourcing_provider_runs
    where workspace_id = p_workspace_id and provider = p_provider and external_run_id = p_external_run_id;
  if found then return json_build_object('ok', true, 'run_id', existing.id, 'status', existing.status, 'duplicate', true); end if;
  begin
    insert into public.sourcing_provider_runs(workspace_id, provider, external_run_id, campaign_id)
      values (p_workspace_id, p_provider, p_external_run_id, p_campaign_id) returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.sourcing_provider_runs
      where workspace_id = p_workspace_id and provider = p_provider and external_run_id = p_external_run_id;
    return json_build_object('ok', true, 'run_id', new_id, 'duplicate', true);
  end;
  return json_build_object('ok', true, 'run_id', new_id, 'status', 'running', 'duplicate', false);
end; $$;
revoke all on function public.begin_provider_run(uuid, text, text, text) from public, anon, authenticated, authenticator;
grant execute on function public.begin_provider_run(uuid, text, text, text) to service_role;

create or replace function public.settle_provider_run(p_run_id uuid, p_succeeded boolean) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  update public.sourcing_provider_runs
     set status = case when p_succeeded then 'succeeded' else 'failed' end, settled_at = now()
   where id = p_run_id and status = 'running';
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'settled' else 'not-running' end);
end; $$;
revoke all on function public.settle_provider_run(uuid, boolean) from public, anon, authenticated, authenticator;
grant execute on function public.settle_provider_run(uuid, boolean) to service_role;

-- claim_enrichment_budget — fail-closed budget_exhausted when the period's claimed+
-- settled spend plus this claim would exceed the budget. Idempotent on the key.
create or replace function public.claim_enrichment_budget(
  p_workspace_id uuid, p_period text, p_idempotency_key text, p_amount_cents integer, p_provider text default null
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare budget public.enrichment_budgets%rowtype; existing public.enrichment_spend_ledger%rowtype; used int; new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('allowed', false, 'reason', 'service-only'); end if;
  if p_amount_cents is null or p_amount_cents < 0 then return json_build_object('allowed', false, 'reason', 'invalid-amount'); end if;

  select * into existing from public.enrichment_spend_ledger
    where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key for update;
  if found then
    return json_build_object('allowed', existing.status <> 'released', 'reason', 'already-claimed', 'ledger_id', existing.id, 'duplicate', true);
  end if;

  select * into budget from public.enrichment_budgets
    where workspace_id = p_workspace_id and period = p_period for update;
  if not found then return json_build_object('allowed', false, 'reason', 'no-budget'); end if;

  select coalesce(sum(amount_cents), 0) into used from public.enrichment_spend_ledger
    where workspace_id = p_workspace_id and period = p_period and status in ('claimed', 'settled');
  if used + p_amount_cents > budget.budget_cents then
    return json_build_object('allowed', false, 'reason', 'budget_exhausted', 'used_cents', used, 'budget_cents', budget.budget_cents);
  end if;

  insert into public.enrichment_spend_ledger(workspace_id, period, idempotency_key, amount_cents, provider)
    values (p_workspace_id, p_period, p_idempotency_key, p_amount_cents, p_provider) returning id into new_id;
  return json_build_object('allowed', true, 'reason', 'claimed', 'ledger_id', new_id);
end; $$;
revoke all on function public.claim_enrichment_budget(uuid, text, text, integer, text) from public, anon, authenticated, authenticator;
grant execute on function public.claim_enrichment_budget(uuid, text, text, integer, text) to service_role;

create or replace function public.settle_enrichment_spend(p_ledger_id uuid, p_actual_cents integer) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if p_actual_cents is null or p_actual_cents < 0 then return json_build_object('ok', false, 'reason', 'invalid-amount'); end if;
  update public.enrichment_spend_ledger
     set status = 'settled', amount_cents = p_actual_cents, settled_at = now()
   where id = p_ledger_id and status = 'claimed';
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'settled' else 'not-claimed' end);
end; $$;
revoke all on function public.settle_enrichment_spend(uuid, integer) from public, anon, authenticated, authenticator;
grant execute on function public.settle_enrichment_spend(uuid, integer) to service_role;

create or replace function public.release_enrichment_claim(p_ledger_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  update public.enrichment_spend_ledger
     set status = 'released', amount_cents = 0, settled_at = now()
   where id = p_ledger_id and status = 'claimed';
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'released' else 'not-claimed' end);
end; $$;
revoke all on function public.release_enrichment_claim(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.release_enrichment_claim(uuid) to service_role;

alter function public.begin_provider_run(uuid, text, text, text) owner to postgres;
alter function public.settle_provider_run(uuid, boolean) owner to postgres;
alter function public.claim_enrichment_budget(uuid, text, text, integer, text) owner to postgres;
alter function public.settle_enrichment_spend(uuid, integer) owner to postgres;
alter function public.release_enrichment_claim(uuid) owner to postgres;
