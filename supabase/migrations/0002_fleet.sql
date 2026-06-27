-- ============================================================================
-- Hermes Sourcing — fleet guardrails (server-side enforcement)
-- Authoritative tables + an atomic claim RPC so the anti-double-contact and
-- per-account rate limits are enforced in Postgres, not just the client.
-- Coordination within official limits — never evasion. Email only.
-- Run AFTER 0001_init.sql.
-- ============================================================================

create table if not exists public.agent_seats (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  name               text not null,
  operator_email     text not null,
  provider           text not null default 'Microsoft Graph',
  status             text not null default 'active',
  mode               text not null default 'mock',
  domain_verified    boolean not null default false,
  daily_limit        int not null default 40,
  warmup             boolean not null default true,
  warmup_start_cap   int not null default 10,
  warmup_step_per_day int not null default 4,
  warmup_started_at  timestamptz not null default now(),
  min_gap_minutes    int not null default 12,
  persona            text not null default '',
  signature          text not null default '',
  connected_account  text not null default '',
  created_at         timestamptz not null default now()
);

create table if not exists public.suppression_list (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type         text not null check (type in ('email','domain','linkedin')),
  value        text not null,
  reason       text not null default '',
  source       text not null default 'Operator',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  unique (workspace_id, type, value)
);

create table if not exists public.outreach_ledger (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  candidate_id    text not null,
  candidate_email text not null,
  seat_id         uuid references public.agent_seats(id) on delete set null,
  campaign_id     text,
  channel         text not null default 'Email',
  status          text not null default 'sent',
  reason          text,
  at              timestamptz not null default now()
);

-- One active contact per candidate per workspace — the hard de-dupe guarantee.
create unique index if not exists outreach_ledger_active_uniq
  on public.outreach_ledger (workspace_id, candidate_id)
  where status in ('claimed','sent');

create index if not exists outreach_ledger_seat_day on public.outreach_ledger (seat_id, at);

-- ---- RLS ----
alter table public.agent_seats      enable row level security;
alter table public.suppression_list enable row level security;
alter table public.outreach_ledger  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_seats','suppression_list','outreach_ledger'] loop
    execute format('drop policy if exists "%s rw" on public.%I', t, t);
    execute format(
      'create policy "%s rw" on public.%I for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id())',
      t, t);
  end loop;
end $$;

-- ---- Atomic claim: suppression + re-contact window + per-seat daily cap ----
-- Returns json { allowed: bool, reason: text, ledger_id: uuid }.
create or replace function public.claim_and_record(
  p_candidate_id    text,
  p_candidate_email text,
  p_campaign_id     text,
  p_seat_id         uuid,
  p_channel         text default 'Email',
  p_recontact_days  int  default 90
) returns json
language plpgsql security definer set search_path = public as $$
declare
  wid        uuid := public.current_workspace_id();
  domain     text := lower(split_part(coalesce(p_candidate_email,''), '@', 2));
  seat       public.agent_seats%rowtype;
  used_today int;
  cap        int;
  new_id     uuid;
begin
  if wid is null then return json_build_object('allowed', false, 'reason', 'no workspace'); end if;

  -- suppression (email / domain)
  if exists (
    select 1 from public.suppression_list s
     where s.workspace_id = wid
       and (s.expires_at is null or s.expires_at > now())
       and ((s.type='email' and lower(s.value)=lower(p_candidate_email))
         or (s.type='domain' and lower(s.value)=domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  -- re-contact window across the whole fleet
  if exists (
    select 1 from public.outreach_ledger l
     where l.workspace_id = wid and l.candidate_id = p_candidate_id
       and l.status in ('claimed','sent') and l.at > now() - make_interval(days => p_recontact_days)
  ) then
    return json_build_object('allowed', false, 'reason', 'recently contacted');
  end if;

  -- per-seat daily cap (effective warm-up cap)
  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
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
   where seat_id = p_seat_id and at::date = now()::date and status in ('claimed','sent');
  if used_today >= cap then
    return json_build_object('allowed', false, 'reason', 'seat daily cap reached');
  end if;

  -- atomic insert as 'claimed' — holds the de-dupe slot (the unique index, daily
  -- cap and re-contact checks all include 'claimed'). The caller reconciles to
  -- 'sent' after the provider responds, or 'skipped' on failure (so it retries).
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

grant execute on function public.claim_and_record(text,text,text,uuid,text,int) to authenticated;
