-- 0063_contact_lease_and_browser_computer.sql
--
-- Shared contact lease (sole who-contacted-whom authority for the fleet) +
-- agent_seats columns for OpenBot-style browser computers.
-- Graphify / wiki MUST NOT grant claims — only claim_contact / this table.
-- Extends 0062 enqueue to accept LinkedIn Browser Computer seats.

-- ---- Seat computer fields -------------------------------------------------
alter table public.agent_seats
  add column if not exists computer_id text,
  add column if not exists linkedin_delivery_backend text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_seats_linkedin_delivery_backend_check'
  ) then
    alter table public.agent_seats
      add constraint agent_seats_linkedin_delivery_backend_check
      check (
        linkedin_delivery_backend is null
        or linkedin_delivery_backend in ('vendor-api', 'browser-computer')
      );
  end if;
end $$;

comment on column public.agent_seats.computer_id is
  'Isolated Chromium computer id for LinkedIn Browser Computer seats (1 seat = 1 computer).';
comment on column public.agent_seats.linkedin_delivery_backend is
  'Automatic LinkedIn path: vendor-api | browser-computer. Null for non-LinkedIn seats.';

-- ---- Contact leases -------------------------------------------------------
create table if not exists public.contact_leases (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  candidate_id    text not null,
  identity_key    text not null,
  seat_id         uuid references public.agent_seats(id) on delete set null,
  state           text not null default 'leased'
    check (state in (
      'available', 'leased', 'in_flight', 'sent', 'failed', 'released', 'suppressed'
    )),
  leased_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  computer_job_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists contact_leases_workspace_identity_idx
  on public.contact_leases (workspace_id, identity_key);

create index if not exists contact_leases_expires_idx
  on public.contact_leases (expires_at)
  where state in ('leased', 'in_flight');

create unique index if not exists contact_leases_active_uniq
  on public.contact_leases (workspace_id, identity_key)
  where state in ('leased', 'in_flight', 'sent', 'suppressed');

alter table public.contact_leases enable row level security;

revoke all on public.contact_leases from anon, public;
grant select, insert, update on public.contact_leases to authenticated;
grant select, insert, update, delete on public.contact_leases to service_role;

drop policy if exists "members read contact_leases" on public.contact_leases;
create policy "members read contact_leases"
  on public.contact_leases for select
  using (workspace_id = public.current_workspace_id());

drop policy if exists "members write contact_leases" on public.contact_leases;
create policy "members write contact_leases"
  on public.contact_leases for all
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- Minimal campaign wiki (knowledge recall only — never a contact lock).
create table if not exists public.campaign_knowledge_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id  text not null,
  kind         text not null default 'who_what'
    check (kind in ('purpose', 'playbook', 'objection', 'who_what', 'outcome')),
  title        text not null default '',
  body         text not null default '',
  updated_at   timestamptz not null default now(),
  unique (workspace_id, campaign_id, kind, title)
);

alter table public.campaign_knowledge_notes enable row level security;
revoke all on public.campaign_knowledge_notes from anon, public;
grant select, insert, update, delete on public.campaign_knowledge_notes to authenticated;

drop policy if exists "campaign_knowledge_notes rw" on public.campaign_knowledge_notes;
create policy "campaign_knowledge_notes rw" on public.campaign_knowledge_notes
  for all
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- ---- claim_contact --------------------------------------------------------
create or replace function public.claim_contact(
  p_candidate_id text,
  p_identity_key text,
  p_seat_id      uuid,
  p_ttl_seconds  int default 900
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  ident text := lower(btrim(coalesce(p_identity_key, '')));
  ttl int := greatest(60, least(coalesce(p_ttl_seconds, 900), 86400));
  existing public.contact_leases%rowtype;
  new_id uuid;
begin
  if auth.uid() is null or wid is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;
  if p_candidate_id is null or length(p_candidate_id) < 1 or length(p_candidate_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-candidate');
  end if;
  if ident = '' or length(ident) > 512 then
    return json_build_object('ok', false, 'reason', 'invalid-identity');
  end if;
  if p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'invalid-seat');
  end if;
  if not exists (
    select 1 from public.agent_seats s
     where s.id = p_seat_id and s.workspace_id = wid and s.status = 'active'
  ) then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;

  update public.contact_leases
     set state = 'released', updated_at = now()
   where workspace_id = wid
     and identity_key = ident
     and state in ('leased', 'in_flight')
     and expires_at <= now();

  select * into existing
    from public.contact_leases
   where workspace_id = wid
     and identity_key = ident
     and state in ('leased', 'in_flight', 'sent', 'suppressed')
   order by leased_at desc
   limit 1
   for update skip locked;

  if found then
    return json_build_object(
      'ok', false,
      'reason', case
        when existing.state = 'sent' then 'already-sent'
        when existing.state = 'suppressed' then 'suppressed'
        else 'lease-held'
      end,
      'holder_seat_id', existing.seat_id,
      'lease_id', existing.id,
      'state', existing.state
    );
  end if;

  begin
    insert into public.contact_leases (
      workspace_id, candidate_id, identity_key, seat_id, state, expires_at
    ) values (
      wid, p_candidate_id, ident, p_seat_id, 'leased', now() + make_interval(secs => ttl)
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.contact_leases
     where workspace_id = wid and identity_key = ident
       and state in ('leased', 'in_flight', 'sent', 'suppressed')
     order by leased_at desc
     limit 1;
    return json_build_object(
      'ok', false,
      'reason', 'lease-held',
      'holder_seat_id', existing.seat_id,
      'lease_id', existing.id,
      'state', coalesce(existing.state, 'leased')
    );
  end;

  return json_build_object(
    'ok', true,
    'lease_id', new_id,
    'state', 'leased',
    'expires_at', now() + make_interval(secs => ttl)
  );
end;
$$;

alter function public.claim_contact(text, text, uuid, int) owner to postgres;
revoke all on function public.claim_contact(text, text, uuid, int)
  from public, anon, authenticator;
grant execute on function public.claim_contact(text, text, uuid, int)
  to authenticated, service_role;

create or replace function public.complete_contact_lease(
  p_lease_id uuid,
  p_state text,
  p_computer_job_id text default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  wid uuid := public.current_workspace_id();
  lease public.contact_leases%rowtype;
begin
  if auth.uid() is null or wid is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if p_state not in ('sent', 'failed', 'released', 'suppressed', 'in_flight') then
    return json_build_object('ok', false, 'reason', 'invalid-state');
  end if;

  select * into lease
    from public.contact_leases
   where id = p_lease_id and workspace_id = wid
   for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'lease-not-found');
  end if;
  if lease.state not in ('leased', 'in_flight') then
    return json_build_object('ok', false, 'reason', 'lease-not-active', 'state', lease.state);
  end if;

  update public.contact_leases
     set state = p_state,
         computer_job_id = coalesce(p_computer_job_id, computer_job_id),
         updated_at = now()
   where id = p_lease_id;

  return json_build_object('ok', true, 'lease_id', p_lease_id, 'state', p_state);
end;
$$;

alter function public.complete_contact_lease(uuid, text, text) owner to postgres;
revoke all on function public.complete_contact_lease(uuid, text, text)
  from public, anon, authenticator;
grant execute on function public.complete_contact_lease(uuid, text, text)
  to authenticated, service_role;

create or replace function public.sweep_stale_contact_leases()
returns int
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  n int;
begin
  update public.contact_leases
     set state = 'released', updated_at = now()
   where state in ('leased', 'in_flight')
     and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

alter function public.sweep_stale_contact_leases() owner to postgres;
revoke all on function public.sweep_stale_contact_leases()
  from public, anon, authenticator, authenticated;
grant execute on function public.sweep_stale_contact_leases() to service_role;

-- ---- enqueue: same as 0062 + browser-computer + mandatory contact lease ----
create or replace function public.enqueue_linkedin_outbound(
  p_message_id  text,
  p_candidate_id text,
  p_campaign_id text,
  p_seat_id     uuid,
  p_profile_url text,
  p_subject     text,
  p_body        text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  recipient text := lower(btrim(coalesce(p_profile_url, '')));
  seat public.agent_seats%rowtype;
  approval public.outreach_approvals%rowtype;
  expected_body_hash text;
  expected_scope_hash text;
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
  identity_key text;
  lease_result json;
  li_slug text;
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
  if p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'invalid-seat');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 or length(p_body) > 50000 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('ok', false, 'reason', 'invalid-linkedin-profile');
  end if;

  select * into seat
    from public.agent_seats
    where id = p_seat_id and workspace_id = wid
    for share;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.status <> 'active' or seat.mode <> 'live' then
    return json_build_object('ok', false, 'reason', 'seat-not-live');
  end if;
  -- Automatic wire: vendor-api OR browser-computer (never silent assisted-manual).
  if seat.provider not in ('LinkedIn Vendor API', 'LinkedIn Browser Computer') then
    return json_build_object('ok', false, 'reason', 'linkedin-automatic-requires-entitled-seat');
  end if;

  expected_body_hash := encode(
    digest(coalesce(p_subject, '') || E'\n' || p_body, 'sha256'),
    'hex'
  );
  expected_scope_hash := encode(
    digest(p_candidate_id || E'\n' || 'LinkedIn' || E'\n' || recipient, 'sha256'),
    'hex'
  );

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = wid
      and a.message_id = p_message_id
    for share;
  if not found
    or approval.body_hash is distinct from expected_body_hash
    or approval.approval_scope_hash is distinct from expected_scope_hash
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    return json_build_object('ok', false, 'reason', 'approval-required');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = wid
        and (s.expires_at is null or s.expires_at > now())
        and s.type = 'linkedin'
        and lower(s.value) = recipient
  ) then
    return json_build_object('ok', false, 'reason', 'suppressed');
  end if;

  li_slug := substring(recipient from 'linkedin\.com/(in|pub)/([^/?#]+)');
  identity_key := case
    when li_slug is not null and length(li_slug) > 0 then 'li:' || li_slug
    else 'li:' || recipient
  end;

  lease_result := public.claim_contact(p_candidate_id, identity_key, p_seat_id, 900);
  if coalesce((lease_result->>'ok')::boolean, false) is not true then
    return json_build_object(
      'ok', false,
      'reason', coalesce(lease_result->>'reason', 'lease-denied'),
      'lease', lease_result
    );
  end if;

  dedupe := encode(
    digest('linkedin' || E'\n' || p_candidate_id || E'\n' || recipient || E'\n' || p_message_id, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
    ) values (
      wid, p_candidate_id, p_seat_id, 'LinkedIn', recipient, 'candidate_reply',
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

  return json_build_object(
    'ok', true,
    'status', 'queued',
    'id', new_id,
    'lease_id', lease_result->>'lease_id'
  );
end;
$$;

alter function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text) owner to postgres;
revoke all on function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text)
  from public, anon, authenticator, service_role;
grant execute on function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text)
  to authenticated;
