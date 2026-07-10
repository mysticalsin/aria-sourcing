-- 0009_whatsapp_delivery_policy.sql
--
-- WhatsApp must have a stricter delivery boundary than email. A message may
-- reach Meta only after a service-only transaction verifies explicit consent,
-- a phone do-not-contact record, the Meta template catalogue or live reply
-- window, the sender seat, and the existing contact-rate ledger.
--
-- Existing WhatsApp rows stay readable. They do not receive inferred consent
-- or a template backfill, so they fail closed until a human records the data.

-- ---------------------------------------------------------------------------
-- Canonical recipient format and phone suppression
-- ---------------------------------------------------------------------------
create or replace function public.normalize_whatsapp_e164(p_value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_value ~ '^\\+?[1-9][0-9]{7,14}$' then regexp_replace(p_value, '^\\+', '')
    else null
  end;
$$;

alter table public.suppression_list
  drop constraint if exists suppression_list_type_check;

alter table public.suppression_list
  add constraint suppression_list_type_check
  check (type in ('email', 'domain', 'linkedin', 'phone'));

alter table public.suppression_list
  add constraint suppression_list_phone_e164_check
  check (type <> 'phone' or value ~ '^[1-9][0-9]{7,14}$') not valid;

-- ---------------------------------------------------------------------------
-- Source-of-truth WhatsApp policy records
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_contacts (
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  recipient_e164     text not null check (recipient_e164 ~ '^[1-9][0-9]{7,14}$'),
  consent_status     text not null check (consent_status in ('opted_in', 'opted_out')),
  consent_source     text not null check (length(consent_source) between 1 and 120),
  consent_evidence   jsonb not null default '{}'::jsonb,
  policy_version     text not null default '2026-07-09',
  recorded_at        timestamptz not null default now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text,
  last_inbound_at    timestamptz,
  primary key (workspace_id, recipient_e164),
  check (expires_at is null or expires_at > recorded_at),
  check (
    (consent_status = 'opted_in' and revoked_at is null)
    or (consent_status = 'opted_out' and revoked_at is not null)
  )
);

create table if not exists public.whatsapp_senders (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  seat_id              uuid references public.agent_seats(id) on delete set null,
  meta_phone_number_id text not null unique,
  meta_waba_id         text,
  status               text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  created_at           timestamptz not null default now(),
  unique (workspace_id, seat_id)
);

create table if not exists public.whatsapp_templates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  sender_id        uuid not null references public.whatsapp_senders(id) on delete restrict,
  meta_name        text not null check (meta_name ~ '^[A-Za-z0-9_]{1,512}$'),
  language         text not null check (language ~ '^[a-z]{2,3}_[A-Z]{2}$'),
  category         text not null default 'utility',
  status           text not null check (status in ('approved', 'paused', 'rejected', 'retired')),
  provider_template_id text,
  parameter_schema jsonb not null default '[]'::jsonb,
  body_parameter_count integer not null default 0 check (body_parameter_count >= 0),
  version          integer not null default 1 check (version > 0),
  approved_at      timestamptz,
  updated_at       timestamptz not null default now(),
  unique (workspace_id, sender_id, meta_name, language, version),
  check ((status = 'approved') = (approved_at is not null))
);

create table if not exists public.whatsapp_conversation_windows (
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  sender_id               uuid not null references public.whatsapp_senders(id) on delete cascade,
  recipient_e164          text not null check (recipient_e164 ~ '^[1-9][0-9]{7,14}$'),
  last_inbound_message_id text not null,
  last_inbound_at         timestamptz not null,
  freeform_until          timestamptz not null,
  primary key (workspace_id, sender_id, recipient_e164),
  check (freeform_until > last_inbound_at)
);

create index if not exists whatsapp_templates_lookup_idx
  on public.whatsapp_templates (workspace_id, id, status);
create index if not exists whatsapp_windows_reply_idx
  on public.whatsapp_conversation_windows (workspace_id, recipient_e164, freeform_until desc);

-- Cache only the content-gate observation. Delivery authorization is never
-- cached: the claim function below reads current consent and window state.
create table if not exists public.outbound_content_cache (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  gate_version text not null,
  verdict      text not null check (verdict in ('pass', 'block')),
  reasons      jsonb not null default '[]'::jsonb,
  expires_at   timestamptz not null,
  observed_at  timestamptz not null default now(),
  primary key (workspace_id, content_hash, gate_version)
);

-- ---------------------------------------------------------------------------
-- Extend the durable outbox without rewriting historical rows.
-- ---------------------------------------------------------------------------
alter table public.messages_outbound
  add column if not exists recipient_e164 text,
  add column if not exists approval_message_id text,
  add column if not exists template_id uuid references public.whatsapp_templates(id) on delete restrict,
  add column if not exists template_parameters jsonb not null default '[]'::jsonb,
  add column if not exists content_hash text,
  add column if not exists policy_snapshot jsonb,
  add column if not exists provider_message_id text,
  add column if not exists delivery_attempt_id uuid,
  add column if not exists dispatching_at timestamptz;

alter table public.outreach_ledger
  add column if not exists outbound_message_id uuid references public.messages_outbound(id) on delete set null;

alter table public.outreach_approvals
  add column if not exists approval_scope_hash text;

alter table public.outreach_approvals
  add constraint outreach_approvals_scope_hash_check
  check (approval_scope_hash is null or approval_scope_hash ~ '^[0-9a-f]{64}$') not valid;

create unique index if not exists outreach_ledger_outbound_message_uniq
  on public.outreach_ledger (outbound_message_id)
  where outbound_message_id is not null;

update public.messages_outbound
  set recipient_e164 = public.normalize_whatsapp_e164(to_address)
  where channel = 'WhatsApp'
    and recipient_e164 is null
    and public.normalize_whatsapp_e164(to_address) is not null;

update public.messages_outbound
  set approval_message_id = id::text
  where approval_message_id is null;

alter table public.messages_outbound
  drop constraint if exists messages_outbound_status_check;

alter table public.messages_outbound
  add constraint messages_outbound_status_check
  check (status in ('composed', 'queued', 'blocked', 'dispatching', 'sent', 'failed'));

alter table public.messages_outbound
  add constraint messages_outbound_template_reference_check
  check (type <> 'approved_template' or template_id is not null) not valid;

-- Normal users can compose and read messages, but cannot place a row directly
-- into a wire-eligible state. The dispatcher is a service-role process and
-- takes the transition in claim_whatsapp_outbound().
revoke update on public.messages_outbound from authenticated;
grant select, insert on public.messages_outbound to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: members may inspect policy data; only workspace admins manage durable
-- consent, senders, and templates. Inbound webhooks and dispatch use service
-- role and bypass RLS, which is intentional and limited by the RPC below.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_senders enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_conversation_windows enable row level security;
alter table public.outbound_content_cache enable row level security;

revoke all on public.whatsapp_contacts from anon, public;
revoke all on public.whatsapp_senders from anon, public;
revoke all on public.whatsapp_templates from anon, public;
revoke all on public.whatsapp_conversation_windows from anon, public;
revoke all on public.outbound_content_cache from anon, public;

grant select on public.whatsapp_contacts to authenticated;
grant select on public.whatsapp_senders to authenticated;
grant select on public.whatsapp_templates to authenticated;
grant select on public.whatsapp_conversation_windows to authenticated;

drop policy if exists whatsapp_contacts_select on public.whatsapp_contacts;
create policy whatsapp_contacts_select on public.whatsapp_contacts
  for select using (workspace_id = public.current_workspace_id());
drop policy if exists whatsapp_contacts_admin_write on public.whatsapp_contacts;
create policy whatsapp_contacts_admin_write on public.whatsapp_contacts
  for all using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  ) with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists whatsapp_senders_select on public.whatsapp_senders;
create policy whatsapp_senders_select on public.whatsapp_senders
  for select using (workspace_id = public.current_workspace_id());
drop policy if exists whatsapp_senders_admin_write on public.whatsapp_senders;
create policy whatsapp_senders_admin_write on public.whatsapp_senders
  for all using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  ) with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists whatsapp_templates_select on public.whatsapp_templates;
create policy whatsapp_templates_select on public.whatsapp_templates
  for select using (workspace_id = public.current_workspace_id());
drop policy if exists whatsapp_templates_admin_write on public.whatsapp_templates;
create policy whatsapp_templates_admin_write on public.whatsapp_templates
  for all using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  ) with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists whatsapp_windows_select on public.whatsapp_conversation_windows;
create policy whatsapp_windows_select on public.whatsapp_conversation_windows
  for select using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- Service-only atomic WhatsApp claim. This locks the outbox first, so a retry
-- or a second worker cannot make a second Meta request for the same message.
-- ---------------------------------------------------------------------------
create or replace function public.claim_whatsapp_outbound(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  outbound      public.messages_outbound%rowtype;
  contact       public.whatsapp_contacts%rowtype;
  sender        public.whatsapp_senders%rowtype;
  template_row  public.whatsapp_templates%rowtype;
  seat          public.agent_seats%rowtype;
  recipient     text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'WhatsApp' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  recipient := public.normalize_whatsapp_e164(coalesce(outbound.recipient_e164, outbound.to_address));
  if recipient is null then return json_build_object('allowed', false, 'reason', 'invalid-recipient'); end if;

  select * into contact
    from public.whatsapp_contacts
    where workspace_id = outbound.workspace_id and recipient_e164 = recipient
    for update;
  if not found or contact.consent_status <> 'opted_in' then
    return json_build_object('allowed', false, 'reason', 'missing-opt-in');
  end if;
  if contact.expires_at is not null and contact.expires_at <= now() then
    return json_build_object('allowed', false, 'reason', 'permission-expired');
  end if;
  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and s.type = 'phone'
        and s.value = recipient
        and (s.expires_at is null or s.expires_at > now())
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into sender
    from public.whatsapp_senders
    where workspace_id = outbound.workspace_id
      and seat_id = outbound.seat_id
      and status = 'active'
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'sender-not-active'); end if;

  if not exists (
    select 1 from public.outreach_approvals a
      where a.workspace_id = outbound.workspace_id
        and a.message_id = coalesce(outbound.approval_message_id, outbound.id::text)
        and a.body_hash = encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
        and a.approval_scope_hash = encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
        and a.approval_source = 'human'
  ) then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  if outbound.type = 'approved_template' then
    select * into template_row
      from public.whatsapp_templates
      where id = outbound.template_id
        and workspace_id = outbound.workspace_id
        and sender_id = sender.id
      for update;
    if not found or template_row.status <> 'approved' then
      return json_build_object('allowed', false, 'reason', 'template-not-approved');
    end if;
    if jsonb_typeof(outbound.template_parameters) <> 'array'
      or jsonb_array_length(outbound.template_parameters) <> template_row.body_parameter_count then
      return json_build_object('allowed', false, 'reason', 'template-parameters-invalid');
    end if;
  elsif not exists (
    select 1 from public.whatsapp_conversation_windows w
      join public.whatsapp_senders sender on sender.id = w.sender_id
      where w.workspace_id = outbound.workspace_id
        and w.recipient_e164 = recipient
        and w.sender_id = sender.id
        and w.freeform_until > now()
  ) then
    return json_build_object('allowed', false, 'reason', 'reply-window-closed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active' or seat.mode <> 'live' or seat.provider <> 'WhatsApp Cloud' then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
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
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id and l.at::date = now()::date and l.status in ('claimed', 'sent');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status, outbound_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.spec_id::text, 'agent'), 'WhatsApp', 'claimed', outbound.id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set recipient_e164 = recipient,
        status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-09',
          'recipient_e164', recipient,
          'consent_recorded_at', contact.recorded_at,
          'content_kind', outbound.type,
          'template_id', outbound.template_id
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'meta_phone_number_id', sender.meta_phone_number_id,
    'template_id', outbound.template_id
  );
end;
$$;

revoke all on function public.claim_whatsapp_outbound(uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbound(uuid) to service_role;
