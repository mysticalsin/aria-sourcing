-- 0076_autopilot_critics_approval.sql
-- REI autopilot first-touch: approval_source=autopilot_critics, service enqueue
-- for Email/WhatsApp/LinkedIn, HeyReach seat provider for LinkedIn dispatch.

-- ---------------------------------------------------------------------------
-- 1. Approval source + authorize + mint
-- ---------------------------------------------------------------------------
alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_approval_source_check;

alter table public.outreach_approvals
  add constraint outreach_approvals_approval_source_check
  check (approval_source in ('human', 'legacy_unverified', 'template_bound', 'autopilot_critics'));

comment on column public.outreach_approvals.approval_source is
  'human = named operator approved exact body. template_bound = entitled template+audience. autopilot_critics = entitled autopilot + live critics green. legacy_unverified = fail-closed.';

create or replace function public.outbound_approval_authorizes_send(
  p_workspace_id uuid,
  p_approval_source text,
  p_approved_by uuid,
  p_template_id uuid,
  p_revoked_at timestamptz
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_revoked_at is not null then
    return false;
  end if;
  if p_approval_source = 'human' then
    return true;
  end if;
  if p_approval_source = 'autopilot_critics' then
    if p_approved_by is null then
      return false;
    end if;
    return exists (
      select 1 from public.profiles profile
       where profile.workspace_id = p_workspace_id
         and profile.id = p_approved_by
         and profile.autopilot_enabled is true
    );
  end if;
  if p_approval_source = 'template_bound' then
    if p_approved_by is null or p_template_id is null then
      return false;
    end if;
    if not exists (
      select 1 from public.profiles profile
       where profile.workspace_id = p_workspace_id
         and profile.id = p_approved_by
         and profile.autopilot_enabled is true
    ) then
      return false;
    end if;
    if not exists (
      select 1 from public.outreach_templates tmpl
       where tmpl.id = p_template_id
         and tmpl.workspace_id = p_workspace_id
         and tmpl.status = 'approved'
         and tmpl.revoked_at is null
    ) then
      return false;
    end if;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.mint_autopilot_critics_approval(
  p_workspace_id uuid,
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_entitled_approver_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  controls public.sourcing_loop_controls%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_workspace_id is null
     or p_message_id is null
     or p_body_hash is null
     or p_approval_scope_hash is null
     or p_entitled_approver_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into controls
    from public.sourcing_loop_controls
    where workspace_id = p_workspace_id;
  if not found
     or controls.kill_switch is distinct from false
     or controls.sequences_enabled is distinct from true then
    return jsonb_build_object('status', 'sequences_not_armed');
  end if;

  if not public.outbound_approval_authorizes_send(
    p_workspace_id, 'autopilot_critics', p_entitled_approver_id, null, null
  ) then
    return jsonb_build_object('status', 'not_authorized');
  end if;

  insert into public.outreach_approvals (
    workspace_id, message_id, body_hash, approval_scope_hash,
    approved_by, approved_at, approval_source, template_id
  ) values (
    p_workspace_id, p_message_id, p_body_hash, p_approval_scope_hash,
    p_entitled_approver_id, now(), 'autopilot_critics', null
  )
  on conflict (workspace_id, message_id) do update
    set body_hash = excluded.body_hash,
        approval_scope_hash = excluded.approval_scope_hash,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        approval_source = 'autopilot_critics',
        template_id = null,
        revoked_at = null;

  return jsonb_build_object('status', 'ok', 'message_id', p_message_id, 'source', 'autopilot_critics');
end;
$$;

revoke all on function public.mint_autopilot_critics_approval(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.mint_autopilot_critics_approval(uuid, text, text, text, uuid)
  to service_role;

-- Interactive send route may verify autopilot/template authorization without service role.
revoke all on function public.outbound_approval_authorizes_send(uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, authenticator;
grant execute on function public.outbound_approval_authorizes_send(uuid, text, uuid, uuid, timestamptz)
  to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Interactive email claim accepts authorized autopilot/template approvals
-- ---------------------------------------------------------------------------
create or replace function public.claim_email_outbound(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_candidate_id text,
  p_candidate_email text,
  p_campaign_id text,
  p_seat_id uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
  claim json;
  ledger_id uuid;
begin
  if auth.uid() is null or wid is null then return json_build_object('allowed', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('allowed', false, 'reason', 'insufficient-permissions'); end if;

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.revoked_at is not null then return json_build_object('allowed', false, 'reason', 'approval-revoked'); end if;
  if not public.outbound_approval_authorizes_send(
    wid, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
  ) then
    return json_build_object('allowed', false, 'reason', 'approval-not-authorized');
  end if;
  if approval.body_hash is distinct from p_body_hash or approval.approval_scope_hash is distinct from p_approval_scope_hash then
    return json_build_object('allowed', false, 'reason', 'approval-mismatch');
  end if;

  claim := public.claim_and_record(
    p_candidate_id,
    p_candidate_email,
    p_campaign_id,
    p_seat_id,
    'Email'
  );
  if coalesce((claim ->> 'allowed')::boolean, false) is not true then return claim; end if;
  ledger_id := (claim ->> 'ledger_id')::uuid;

  update public.outreach_ledger
    set approval_message_id = p_message_id
    where id = ledger_id
      and workspace_id = wid
      and status = 'claimed';
  if not found then
    return json_build_object('allowed', false, 'reason', 'ledger-bind-failed');
  end if;
  return claim;
end;
$$;

revoke all on function public.claim_email_outbound(text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.claim_email_outbound(text, text, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Service-role enqueue helpers (autopilot cron / loop worker)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_email_outbound_service(
  p_workspace_id uuid,
  p_message_id text,
  p_candidate_id text,
  p_campaign_id text,
  p_seat_id uuid,
  p_recipient text,
  p_subject text,
  p_body text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text := lower(btrim(coalesce(p_recipient, '')));
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
  approval public.outreach_approvals%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_workspace_id is null or p_message_id is null or p_candidate_id is null or p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;
  if recipient = '' or recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = p_workspace_id and message_id = p_message_id
    for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'approval-required');
  end if;
  if not public.outbound_approval_authorizes_send(
    p_workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
  ) then
    return json_build_object('ok', false, 'reason', 'approval-not-authorized');
  end if;

  dedupe := encode(
    digest('email' || E'\n' || p_candidate_id || E'\n' || recipient || E'\n' || p_message_id, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
    ) values (
      p_workspace_id, p_candidate_id, p_seat_id, 'Email', recipient, 'candidate_reply',
      coalesce(p_subject, ''), p_body,
      'queued', dedupe, now(), p_message_id, p_campaign_id
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_outbound
      where workspace_id = p_workspace_id and dedupe_hash = dedupe;
    return json_build_object(
      'ok', false,
      'status', coalesce(existing.status, 'queued'),
      'id', existing.id,
      'reason', 'duplicate'
    );
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$$;

revoke all on function public.enqueue_email_outbound_service(uuid, text, text, text, uuid, text, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.enqueue_email_outbound_service(uuid, text, text, text, uuid, text, text, text)
  to service_role;

create or replace function public.enqueue_whatsapp_outbound_service(
  p_workspace_id uuid,
  p_message_id text,
  p_candidate_id text,
  p_campaign_id text,
  p_seat_id uuid,
  p_recipient text,
  p_type text,
  p_subject text,
  p_body text,
  p_template_id uuid default null,
  p_template_parameters jsonb default '[]'::jsonb
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text;
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
  approval public.outreach_approvals%rowtype;
  sender public.whatsapp_senders%rowtype;
  template public.whatsapp_templates%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_workspace_id is null or p_message_id is null or p_candidate_id is null or p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;
  if coalesce(p_type, '') not in ('candidate_reply', 'approved_template') then
    return json_build_object('ok', false, 'reason', 'invalid-type');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;

  recipient := public.normalize_whatsapp_e164(p_recipient);
  if recipient is null then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;

  if p_type = 'candidate_reply' then
    if p_template_id is not null
       or coalesce(p_template_parameters, '[]'::jsonb) <> '[]'::jsonb then
      return json_build_object('ok', false, 'reason', 'invalid-reply-shape');
    end if;
  else
    -- Cold autopilot: Meta-approved template only (prefer zero-param; params must match count).
    if p_template_id is null
       or jsonb_typeof(coalesce(p_template_parameters, 'null'::jsonb)) <> 'array'
       or p_subject is distinct from 'WhatsApp approved-template dispatch' then
      return json_build_object('ok', false, 'reason', 'invalid-template-shape');
    end if;
    select whatsapp_sender.* into sender
      from public.whatsapp_senders as whatsapp_sender
      join public.agent_seats as seat
        on seat.id = whatsapp_sender.seat_id
       and seat.workspace_id = p_workspace_id
       and seat.provider = 'WhatsApp Cloud'
       and seat.status = 'active'
       and seat.mode = 'live'
      where whatsapp_sender.workspace_id = p_workspace_id
        and whatsapp_sender.seat_id = p_seat_id
        and whatsapp_sender.status = 'active';
    if not found then
      return json_build_object('ok', false, 'reason', 'sender-unavailable');
    end if;
    select * into template
      from public.whatsapp_templates
      where id = p_template_id
        and workspace_id = p_workspace_id
        and sender_id = sender.id
        and status = 'approved';
    if not found
       or template.approved_at is null
       or jsonb_array_length(coalesce(p_template_parameters, '[]'::jsonb))
            <> coalesce(template.body_parameter_count, -1) then
      return json_build_object('ok', false, 'reason', 'template-invalid');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = p_workspace_id and message_id = p_message_id
    for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'approval-required');
  end if;
  if not public.outbound_approval_authorizes_send(
    p_workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
  ) then
    return json_build_object('ok', false, 'reason', 'approval-not-authorized');
  end if;

  dedupe := encode(
    digest('whatsapp' || E'\n' || p_candidate_id || E'\n' || recipient || E'\n' || p_message_id, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id,
      template_id, template_parameters
    ) values (
      p_workspace_id, p_candidate_id, p_seat_id, 'WhatsApp', recipient, p_type,
      coalesce(p_subject, ''), p_body,
      'queued', dedupe, now(), p_message_id, p_campaign_id,
      p_template_id, coalesce(p_template_parameters, '[]'::jsonb)
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_outbound
      where workspace_id = p_workspace_id and dedupe_hash = dedupe;
    return json_build_object(
      'ok', false,
      'status', coalesce(existing.status, 'queued'),
      'id', existing.id,
      'reason', 'duplicate'
    );
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$$;

revoke all on function public.enqueue_whatsapp_outbound_service(uuid, text, text, text, uuid, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated, authenticator;
grant execute on function public.enqueue_whatsapp_outbound_service(uuid, text, text, text, uuid, text, text, text, text, uuid, jsonb)
  to service_role;

create or replace function public.enqueue_linkedin_outbound_service(
  p_workspace_id uuid,
  p_message_id text,
  p_candidate_id text,
  p_campaign_id text,
  p_seat_id uuid,
  p_profile_url text,
  p_subject text,
  p_body text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text := lower(btrim(coalesce(p_profile_url, '')));
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
  approval public.outreach_approvals%rowtype;
  seat public.agent_seats%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_workspace_id is null or p_message_id is null or p_candidate_id is null or p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('ok', false, 'reason', 'invalid-linkedin-profile');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;

  select * into seat
    from public.agent_seats
    where id = p_seat_id and workspace_id = p_workspace_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.status <> 'active'
     or seat.mode <> 'live'
     or seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API', 'HeyReach')
  then
    return json_build_object('ok', false, 'reason', 'seat-not-live');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = p_workspace_id and message_id = p_message_id
    for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'approval-required');
  end if;
  if not public.outbound_approval_authorizes_send(
    p_workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
  ) then
    return json_build_object('ok', false, 'reason', 'approval-not-authorized');
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
      p_workspace_id, p_candidate_id, p_seat_id, 'LinkedIn', recipient, 'candidate_reply',
      coalesce(p_subject, ''), p_body,
      'queued', dedupe, now(), p_message_id, p_campaign_id
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_outbound
      where workspace_id = p_workspace_id and dedupe_hash = dedupe;
    return json_build_object(
      'ok', false,
      'status', coalesce(existing.status, 'queued'),
      'id', existing.id,
      'reason', 'duplicate'
    );
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$$;

revoke all on function public.enqueue_linkedin_outbound_service(uuid, text, text, text, uuid, text, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.enqueue_linkedin_outbound_service(uuid, text, text, text, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. LinkedIn claim accepts HeyReach provider
-- ---------------------------------------------------------------------------
create or replace function public.claim_linkedin_outbound_queued(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound      public.messages_outbound%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  backend       text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('allowed', false, 'reason', 'invalid-linkedin-profile');
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or not public.outbound_approval_authorizes_send(
         outbound.workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
       )
  then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and s.type = 'linkedin'
        and lower(s.value) = recipient
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active'
    or seat.mode <> 'live'
    or seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API', 'HeyReach')
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent', 'ambiguous')
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
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  backend := case seat.provider
    when 'LinkedIn Vendor API' then 'vendor-api'
    when 'HeyReach' then 'heyreach'
    else 'assisted-manual'
  end;

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'LinkedIn', 'claimed',
      approval_id, outbound.id, attempt_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-08-29-linkedin-heyreach',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', backend,
          'approval_source', approval.approval_source
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'profile_url', recipient,
    'provider', seat.provider,
    'backend', backend
  );
end;
$$;

revoke all on function public.claim_linkedin_outbound_queued(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;
