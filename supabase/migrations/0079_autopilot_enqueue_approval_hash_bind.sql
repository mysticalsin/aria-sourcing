-- 0079_autopilot_enqueue_approval_hash_bind.sql
-- Defense-in-depth: service-role Autopilot enqueue must bind body_hash +
-- approval_scope_hash the same way claim_* does, so a mismatched draft cannot
-- land as queued and only fail at dispatch.

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


  if approval.body_hash is distinct from encode(digest(coalesce(p_subject, '') || E'\n' || p_body, 'sha256'), 'hex')
     or approval.approval_scope_hash is distinct from encode(digest(p_candidate_id || E'\n' || 'Email' || E'\n' || recipient, 'sha256'), 'hex') then
    return json_build_object('ok', false, 'reason', 'approval-mismatch');
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


  if approval.body_hash is distinct from encode(digest(coalesce(p_subject, '') || E'\n' || p_body, 'sha256'), 'hex')
     or approval.approval_scope_hash is distinct from encode(digest(p_candidate_id || E'\n' || 'WhatsApp' || E'\n' || recipient, 'sha256'), 'hex') then
    return json_build_object('ok', false, 'reason', 'approval-mismatch');
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


  if approval.body_hash is distinct from encode(digest(coalesce(p_subject, '') || E'\n' || p_body, 'sha256'), 'hex')
     or approval.approval_scope_hash is distinct from encode(digest(p_candidate_id || E'\n' || 'LinkedIn' || E'\n' || recipient, 'sha256'), 'hex') then
    return json_build_object('ok', false, 'reason', 'approval-mismatch');
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
