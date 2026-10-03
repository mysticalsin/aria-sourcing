-- 0053_sequence_engine_real_authority.sql
--
-- Rock 6 repair: make the dark sequence authority real enough to prove before
-- Owner enablement. This migration is additive over 0045; committed migration
-- bytes stay immutable.
--
-- Deliberate decisions:
--   * Suppression is identity-keyed, not candidate-id keyed. The canonical
--     suppression_list table is (type, value) for email/domain/linkedin/phone,
--     so sequence scheduling resolves candidate email/linkedin from the locked
--     candidate corpus and honors expires_at. A candidate-id suppression row is
--     not invented because no writer or DDL owns that shape.
--   * The 90-day contact window is released by an authority action, not by an
--     index predicate. The active unique index stays as the no-double-contact
--     slot; locked claim paths mark old active rows recontact_elapsed before
--     inserting a new claim.
--   * Sequence scheduling remains dark. Every scheduler RPC re-checks the 0050
--     switchboard and refuses while kill_switch is true or sequences_enabled is
--     false.

-- ---------------------------------------------------------------------------
-- 1. Engine surface: DAG metadata, seat binding, exclusions, credits, inbox
--    correlation, and refusal receipts.
-- ---------------------------------------------------------------------------
alter table public.outreach_sequence_steps
  add column if not exists step_key text,
  add column if not exists next_step_keys text[] not null default '{}'::text[],
  add column if not exists branch_condition jsonb not null default '{}'::jsonb,
  add column if not exists seat_id uuid references public.agent_seats(id) on delete set null;

update public.outreach_sequence_steps
   set step_key = 'step-' || ordinal::text
 where step_key is null;

alter table public.outreach_sequence_steps
  alter column step_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'outreach_sequence_steps_step_key_check'
       and conrelid = 'public.outreach_sequence_steps'::regclass
  ) then
    alter table public.outreach_sequence_steps
      add constraint outreach_sequence_steps_step_key_check
      check (step_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'outreach_sequence_steps_branch_condition_check'
       and conrelid = 'public.outreach_sequence_steps'::regclass
  ) then
    alter table public.outreach_sequence_steps
      add constraint outreach_sequence_steps_branch_condition_check
      check (jsonb_typeof(branch_condition) = 'object') not valid;
  end if;
end;
$$;

create unique index if not exists outreach_sequence_steps_key_uniq
  on public.outreach_sequence_steps (sequence_id, step_key);

create index if not exists outreach_sequence_steps_seat_day_idx
  on public.outreach_sequence_steps (seat_id, scheduled_at)
  where seat_id is not null and status in ('scheduled', 'sent');

create table if not exists public.outreach_campaign_exclusions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 200),
  exclusion_kind text not null check (exclusion_kind in ('candidate', 'email', 'domain', 'linkedin')),
  value text not null check (char_length(value) between 1 and 320),
  reason text not null default '',
  source text not null default 'Operator',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (workspace_id, campaign_id, exclusion_kind, value)
);

create index if not exists outreach_campaign_exclusions_active_idx
  on public.outreach_campaign_exclusions (workspace_id, campaign_id, exclusion_kind, lower(value));

create table if not exists public.outreach_sequence_credit_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  credits_available integer not null default 0 check (credits_available >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_sequence_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null,
  delta integer not null check (delta <> 0),
  reason text not null check (char_length(reason) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, sequence_step_id, reason)
);

create index if not exists outreach_sequence_credit_ledger_ws_idx
  on public.outreach_sequence_credit_ledger (workspace_id, created_at);

create table if not exists public.outreach_sequence_refusals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null,
  candidate_id text not null default '',
  seat_id uuid references public.agent_seats(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 120),
  created_at timestamptz not null default now()
);

create index if not exists outreach_sequence_refusals_ws_idx
  on public.outreach_sequence_refusals (workspace_id, created_at);

create or replace function public.release_elapsed_outreach_contact_window()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
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

drop trigger if exists outreach_ledger_release_elapsed_contact_window on public.outreach_ledger;
create trigger outreach_ledger_release_elapsed_contact_window
  before insert on public.outreach_ledger
  for each row execute function public.release_elapsed_outreach_contact_window();

alter table public.outreach_ledger
  add column if not exists sequence_id uuid references public.outreach_sequences(id) on delete set null,
  add column if not exists sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null;

alter table public.messages_outbound
  add column if not exists sequence_id uuid references public.outreach_sequences(id) on delete set null,
  add column if not exists sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null;

alter table public.messages_inbound
  add column if not exists campaign_id text,
  add column if not exists sequence_id uuid references public.outreach_sequences(id) on delete set null,
  add column if not exists sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null,
  add column if not exists correlation_status text not null default 'unresolved'
    check (correlation_status in ('unresolved', 'correlated', 'ambiguous', 'no_match')),
  add column if not exists inbox_status text not null default 'open'
    check (inbox_status in ('open', 'triaged', 'closed'));

alter table public.outreach_campaign_exclusions enable row level security;
alter table public.outreach_campaign_exclusions force row level security;
alter table public.outreach_sequence_credit_accounts enable row level security;
alter table public.outreach_sequence_credit_accounts force row level security;
alter table public.outreach_sequence_credit_ledger enable row level security;
alter table public.outreach_sequence_credit_ledger force row level security;
alter table public.outreach_sequence_refusals enable row level security;
alter table public.outreach_sequence_refusals force row level security;

revoke all on public.outreach_campaign_exclusions from public, anon, authenticated, service_role, authenticator;
revoke all on public.outreach_sequence_credit_accounts from public, anon, authenticated, service_role, authenticator;
revoke all on public.outreach_sequence_credit_ledger from public, anon, authenticated, service_role, authenticator;
revoke all on public.outreach_sequence_refusals from public, anon, authenticated, service_role, authenticator;

drop policy if exists outreach_campaign_exclusions_owner_access on public.outreach_campaign_exclusions;
create policy outreach_campaign_exclusions_owner_access on public.outreach_campaign_exclusions
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists outreach_sequence_credit_accounts_owner_access on public.outreach_sequence_credit_accounts;
create policy outreach_sequence_credit_accounts_owner_access on public.outreach_sequence_credit_accounts
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists outreach_sequence_credit_ledger_owner_access on public.outreach_sequence_credit_ledger;
create policy outreach_sequence_credit_ledger_owner_access on public.outreach_sequence_credit_ledger
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists outreach_sequence_refusals_owner_access on public.outreach_sequence_refusals;
create policy outreach_sequence_refusals_owner_access on public.outreach_sequence_refusals
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. create_outreach_sequence: save a typed DAG and reject cycles at save time.
-- ---------------------------------------------------------------------------
create or replace function public.create_outreach_sequence(
  p_workspace_id uuid, p_candidate_id text, p_campaign_id text, p_max_touches int, p_steps jsonb
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  seq_id uuid;
  step jsonb;
  n int;
  missing_edges int;
  cyclic_edges int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) < 1 or jsonb_array_length(p_steps) > 5 then
    return json_build_object('ok', false, 'reason', 'invalid-steps');
  end if;

  insert into public.outreach_sequences(workspace_id, candidate_id, campaign_id, status, max_touches)
    values (p_workspace_id, p_candidate_id, p_campaign_id, 'pending_approval', least(greatest(coalesce(p_max_touches, 1), 1), 5))
    returning id into seq_id;

  n := 0;
  for step in select * from jsonb_array_elements(p_steps) loop
    insert into public.outreach_sequence_steps(
      sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash,
      step_key, next_step_keys, branch_condition, seat_id
    ) values (
      seq_id,
      n,
      coalesce((step->>'gapDays')::int, 0),
      step->>'channel',
      step->>'messageId',
      step->>'body',
      step->>'bodyHash',
      step->>'scopeHash',
      coalesce(nullif(step->>'stepKey', ''), 'step-' || n::text),
      coalesce(
        array(select jsonb_array_elements_text(coalesce(step->'nextStepKeys', '[]'::jsonb))),
        '{}'::text[]
      ),
      coalesce(step->'branchCondition', '{}'::jsonb),
      nullif(step->>'seatId', '')::uuid
    );
    n := n + 1;
  end loop;

  select count(*) into missing_edges
    from public.outreach_sequence_steps s
    cross join lateral unnest(s.next_step_keys) as edge(next_key)
    left join public.outreach_sequence_steps target
      on target.sequence_id = s.sequence_id and target.step_key = edge.next_key
   where s.sequence_id = seq_id
     and target.id is null;
  if missing_edges > 0 then
    raise exception 'sequence DAG references missing step' using errcode = '23514';
  end if;

  with recursive walk(root_key, step_key, path, cycle) as (
    select s.step_key, edge.next_key, array[s.step_key, edge.next_key], edge.next_key = s.step_key
      from public.outreach_sequence_steps s
      cross join lateral unnest(s.next_step_keys) as edge(next_key)
     where s.sequence_id = seq_id
    union all
    select walk.root_key, edge.next_key, walk.path || edge.next_key, edge.next_key = any(walk.path)
      from walk
      join public.outreach_sequence_steps s
        on s.sequence_id = seq_id and s.step_key = walk.step_key
      cross join lateral unnest(s.next_step_keys) as edge(next_key)
     where not walk.cycle
       and cardinality(walk.path) <= 6
  )
  select count(*) into cyclic_edges from walk where cycle;
  if cyclic_edges > 0 then
    raise exception 'sequence DAG cycle detected' using errcode = '23514';
  end if;

  return json_build_object('ok', true, 'sequence_id', seq_id, 'status', 'pending_approval', 'steps', n);
end; $$;

-- ---------------------------------------------------------------------------
-- 3. claim_sequence_step_for_schedule: dark switchboard, live approval,
--    suppression, exclusions, re-contact window, seat controls, credits, and
--    atomic daily workspace cap.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sequence_step_for_schedule(p_step_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  controls public.sourcing_loop_controls%rowtype;
  seat public.agent_seats%rowtype;
  credit_account public.outreach_sequence_credit_accounts%rowtype;
  candidate_email text;
  candidate_domain text;
  candidate_linkedin text;
  used_workspace_today int;
  used_seat_today int;
  cap int;
  last_seat_send timestamptz;
  credit_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;

  select * into step from public.outreach_sequence_steps where id = p_step_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.status <> 'due' then return json_build_object('ok', false, 'reason', 'not-due'); end if;
  if step.scheduled_at is not null and step.scheduled_at > now() then return json_build_object('ok', false, 'reason', 'not-due'); end if;

  select * into seq from public.outreach_sequences where id = step.sequence_id for update;
  if not found or seq.status <> 'active' then return json_build_object('ok', false, 'reason', 'sequence-not-active'); end if;

  select * into controls
    from public.sourcing_loop_controls
   where workspace_id = seq.workspace_id
   for update;
  if not found or controls.kill_switch or not controls.sequences_enabled then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'sequences_disabled');
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;

  select count(*)::int into used_workspace_today
    from public.outreach_sequence_steps s
    join public.outreach_sequences q on q.id = s.sequence_id
   where q.workspace_id = seq.workspace_id
     and s.status in ('scheduled', 'sent')
     and s.scheduled_at >= current_date::timestamptz
     and s.scheduled_at < (current_date + 1)::timestamptz;
  if used_workspace_today >= controls.max_sequence_sends_per_day then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'sequence_daily_cap_reached');
    return json_build_object('ok', false, 'reason', 'sequence_daily_cap_reached', 'used', used_workspace_today, 'limit', controls.max_sequence_sends_per_day);
  end if;

  if not exists (
    select 1 from public.outreach_approvals a
     where a.workspace_id = seq.workspace_id
       and a.message_id = step.message_id
       and a.body_hash = step.body_hash
       and a.approval_scope_hash = step.scope_hash
       and a.approval_source = 'human'
       and a.revoked_at is null
     for update
  ) then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'approval-required');
    return json_build_object('ok', false, 'reason', 'approval-required');
  end if;

  select lower(c.email), lower(split_part(coalesce(c.email, ''), '@', 2)), lower(c.linkedin_url)
    into candidate_email, candidate_domain, candidate_linkedin
    from public.candidates c
   where c.workspace_id = seq.workspace_id
     and c.campaign_id = coalesce(seq.campaign_id, c.campaign_id)
     and c.id = seq.candidate_id
   order by c.mirrored_at desc
   limit 1;

  if exists (
    select 1 from public.suppression_list sl
     where sl.workspace_id = seq.workspace_id
       and (sl.expires_at is null or sl.expires_at > now())
       and (
         (sl.type = 'email' and candidate_email is not null and lower(sl.value) = candidate_email)
         or (sl.type = 'domain' and candidate_domain is not null and lower(sl.value) = candidate_domain)
         or (sl.type = 'linkedin' and candidate_linkedin is not null and lower(sl.value) = candidate_linkedin)
       )
  ) then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'suppressed');
    return json_build_object('ok', false, 'reason', 'suppressed');
  end if;

  if exists (
    select 1 from public.outreach_campaign_exclusions ex
     where ex.workspace_id = seq.workspace_id
       and ex.campaign_id = seq.campaign_id
       and (ex.expires_at is null or ex.expires_at > now())
       and (
         (ex.exclusion_kind = 'candidate' and ex.value = seq.candidate_id)
         or (ex.exclusion_kind = 'email' and candidate_email is not null and lower(ex.value) = candidate_email)
         or (ex.exclusion_kind = 'domain' and candidate_domain is not null and lower(ex.value) = candidate_domain)
         or (ex.exclusion_kind = 'linkedin' and candidate_linkedin is not null and lower(ex.value) = candidate_linkedin)
       )
  ) then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'campaign_excluded');
    return json_build_object('ok', false, 'reason', 'campaign_excluded');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(seq.workspace_id::text || ':' || seq.candidate_id, 1));
  update public.outreach_ledger
     set status = 'recontact_elapsed',
         reason = coalesce(reason, '90-day re-contact window elapsed')
   where workspace_id = seq.workspace_id
     and candidate_id = seq.candidate_id
     and status in ('claimed', 'sent', 'ambiguous')
     and at <= now() - interval '90 days';

  if exists (
    select 1 from public.outreach_ledger l
     where l.workspace_id = seq.workspace_id
       and l.candidate_id = seq.candidate_id
       and l.status in ('claimed', 'sent', 'ambiguous')
       and l.at > now() - interval '90 days'
  ) then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'recently-contacted');
    return json_build_object('ok', false, 'reason', 'recently-contacted');
  end if;

  if step.seat_id is not null then
    select * into seat
      from public.agent_seats
     where id = step.seat_id and workspace_id = seq.workspace_id
     for update;
    if not found or seat.status <> 'active' then
      insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
      values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'seat-not-active');
      return json_build_object('ok', false, 'reason', 'seat-not-active');
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

    select count(*)::int into used_seat_today
      from public.outreach_sequence_steps s
      join public.outreach_sequences q on q.id = s.sequence_id
     where q.workspace_id = seq.workspace_id
       and s.seat_id = seat.id
       and s.status in ('scheduled', 'sent')
       and s.scheduled_at >= current_date::timestamptz
       and s.scheduled_at < (current_date + 1)::timestamptz;
    if used_seat_today >= cap then
      insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
      values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'seat-daily-cap-reached');
      return json_build_object('ok', false, 'reason', 'seat-daily-cap-reached', 'used', used_seat_today, 'limit', cap);
    end if;

    select max(coalesce(s.sent_at, s.scheduled_at)) into last_seat_send
      from public.outreach_sequence_steps s
      join public.outreach_sequences q on q.id = s.sequence_id
     where q.workspace_id = seq.workspace_id
       and s.seat_id = seat.id
       and s.status in ('scheduled', 'sent')
       and coalesce(s.sent_at, s.scheduled_at) is not null;
    if last_seat_send is not null and last_seat_send > now() - make_interval(mins => seat.min_gap_minutes) then
      insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
      values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'seat-min-gap');
      return json_build_object('ok', false, 'reason', 'seat-min-gap');
    end if;
  end if;

  select * into credit_account
    from public.outreach_sequence_credit_accounts
   where workspace_id = seq.workspace_id
   for update;
  if not found or credit_account.credits_available < 1 then
    insert into public.outreach_sequence_refusals(workspace_id, sequence_id, sequence_step_id, candidate_id, seat_id, reason)
    values (seq.workspace_id, seq.id, step.id, seq.candidate_id, step.seat_id, 'credits-exhausted');
    return json_build_object('ok', false, 'reason', 'credits-exhausted');
  end if;

  insert into public.outreach_sequence_credit_ledger(workspace_id, sequence_id, sequence_step_id, delta, reason)
    values (seq.workspace_id, seq.id, step.id, -1, 'sequence_schedule')
    returning id into credit_id;
  update public.outreach_sequence_credit_accounts
     set credits_available = credits_available - 1,
         updated_at = now()
   where workspace_id = seq.workspace_id;

  update public.outreach_sequence_steps
     set status = 'scheduled',
         scheduled_at = now()
   where id = p_step_id;

  return json_build_object(
    'ok', true, 'reason', 'scheduled',
    'step_id', step.id, 'sequence_id', seq.id, 'ordinal', step.ordinal,
    'step_key', step.step_key, 'channel', step.channel, 'message_id', step.message_id,
    'candidate_id', seq.candidate_id, 'workspace_id', seq.workspace_id,
    'campaign_id', coalesce(seq.campaign_id, ''), 'seat_id', step.seat_id,
    'credit_ledger_id', credit_id, 'body', step.body
  );
end; $$;

-- ---------------------------------------------------------------------------
-- 4. Step advancement: mark a scheduled step sent, then make the next step due
--    only after its configured gap elapses.
-- ---------------------------------------------------------------------------
create or replace function public.record_sequence_step_sent(p_step_id uuid, p_outbound_id uuid default null) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  next_count int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;

  select * into step from public.outreach_sequence_steps where id = p_step_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.status <> 'scheduled' then return json_build_object('ok', false, 'reason', 'not-scheduled'); end if;
  select * into seq from public.outreach_sequences where id = step.sequence_id for update;
  if not found or seq.status <> 'active' then return json_build_object('ok', false, 'reason', 'sequence-not-active'); end if;

  update public.outreach_sequence_steps
     set status = 'sent',
         sent_at = now(),
         queued_outbound_id = coalesce(p_outbound_id, queued_outbound_id)
   where id = p_step_id;

  if cardinality(step.next_step_keys) > 0 then
    update public.outreach_sequence_steps target
       set scheduled_at = now() + make_interval(days => target.gap_days)
     where target.sequence_id = step.sequence_id
       and target.step_key = any(step.next_step_keys)
       and target.status = 'waiting';
    get diagnostics next_count = row_count;
  elsif step.ordinal + 1 < seq.max_touches then
    update public.outreach_sequence_steps target
       set scheduled_at = now() + make_interval(days => target.gap_days)
     where target.sequence_id = step.sequence_id
       and target.ordinal = step.ordinal + 1
       and target.status = 'waiting';
    get diagnostics next_count = row_count;
  end if;

  return json_build_object('ok', true, 'status', 'sent', 'next_waiting', next_count);
end; $$;

create or replace function public.promote_due_sequence_steps(p_workspace_id uuid, p_limit integer default 50) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare promoted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return 0; end if;
  if p_workspace_id is null or p_limit is null or p_limit not between 1 and 100 then return 0; end if;

  if not exists (
    select 1 from public.sourcing_loop_controls controls
     where controls.workspace_id = p_workspace_id
       and controls.kill_switch = false
       and controls.sequences_enabled = true
  ) then
    return 0;
  end if;

  update public.outreach_sequence_steps step
     set status = 'due'
   where step.id in (
     select due.id
       from public.outreach_sequence_steps due
       join public.outreach_sequences seq on seq.id = due.sequence_id
      where seq.workspace_id = p_workspace_id
        and seq.status = 'active'
        and due.status = 'waiting'
        and due.scheduled_at is not null
        and due.scheduled_at <= now()
      order by due.scheduled_at asc, due.ordinal asc
      limit p_limit
      for update of due skip locked
   );
  get diagnostics promoted = row_count;
  return promoted;
end; $$;

create or replace function public.bind_sequence_step_outbound(p_step_id uuid, p_outbound_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  select * into step from public.outreach_sequence_steps where id = p_step_id for update;
  if not found or step.status <> 'scheduled' or step.queued_outbound_id is not null then
    return json_build_object('ok', false, 'reason', 'not-bindable');
  end if;
  select * into seq from public.outreach_sequences where id = step.sequence_id;
  if not found then return json_build_object('ok', false, 'reason', 'sequence-not-found'); end if;

  update public.outreach_sequence_steps
     set queued_outbound_id = p_outbound_id
   where id = p_step_id and status = 'scheduled' and queued_outbound_id is null;
  get diagnostics updated = row_count;

  update public.messages_outbound
     set sequence_id = seq.id,
         sequence_step_id = step.id
   where id = p_outbound_id
     and workspace_id = seq.workspace_id;

  update public.outreach_ledger
     set sequence_id = seq.id,
         sequence_step_id = step.id
   where outbound_message_id = p_outbound_id
     and workspace_id = seq.workspace_id;

  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'bound' else 'not-bindable' end);
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Re-contact release in the existing claim paths. The unique active slot
--    remains, but old slots are deliberately retired under a candidate lock.
-- ---------------------------------------------------------------------------
create or replace function public.claim_and_record(
  p_candidate_id    text,
  p_candidate_email text,
  p_campaign_id     text,
  p_seat_id         uuid,
  p_channel         text default 'Email',
  p_recontact_days  int  default 90
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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

create or replace function public.correlate_inbound_email(
  p_inbound_id uuid,
  p_in_reply_to text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;

revoke all on function public.create_outreach_sequence(uuid, text, text, int, jsonb) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_outreach_sequence(uuid, text, text, int, jsonb) to service_role;
revoke all on function public.claim_sequence_step_for_schedule(uuid) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_sequence_step_for_schedule(uuid) to service_role;
revoke all on function public.record_sequence_step_sent(uuid, uuid) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_sequence_step_sent(uuid, uuid) to service_role;
revoke all on function public.promote_due_sequence_steps(uuid, integer) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.promote_due_sequence_steps(uuid, integer) to service_role;
revoke all on function public.bind_sequence_step_outbound(uuid, uuid) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.bind_sequence_step_outbound(uuid, uuid) to service_role;
revoke all on function public.claim_and_record(text,text,text,uuid,text,int) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_and_record(text,text,text,uuid,text,int) to service_role;
revoke all on function public.correlate_inbound_email(uuid, text) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.correlate_inbound_email(uuid, text) to service_role;
revoke all on function public.release_elapsed_outreach_contact_window() from public, anon, authenticated, service_role, authenticator;

alter function public.create_outreach_sequence(uuid, text, text, int, jsonb) owner to postgres;
alter function public.claim_sequence_step_for_schedule(uuid) owner to postgres;
alter function public.record_sequence_step_sent(uuid, uuid) owner to postgres;
alter function public.promote_due_sequence_steps(uuid, integer) owner to postgres;
alter function public.bind_sequence_step_outbound(uuid, uuid) owner to postgres;
alter function public.claim_and_record(text,text,text,uuid,text,int) owner to postgres;
alter function public.correlate_inbound_email(uuid, text) owner to postgres;
alter function public.release_elapsed_outreach_contact_window() owner to postgres;
