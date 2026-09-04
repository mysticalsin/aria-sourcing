-- 0062_linkedin_automatic_enqueue.sql
--
-- Entitled automatic LinkedIn delivery: authenticated clients may enqueue an
-- approved LinkedIn draft onto messages_outbound for the service dispatcher.
-- Manual (assisted) confirm stays on record_linkedin_assisted_manual_send.
-- No scrape / session bots — vendor-api seat + claim_linkedin_outbound_queued.

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
  -- Automatic wire uses vendor-api only (no silent assisted-manual fallback).
  if seat.provider <> 'LinkedIn Vendor API' then
    return json_build_object('ok', false, 'reason', 'linkedin-automatic-requires-vendor-seat');
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

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$$;

alter function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text) owner to postgres;
revoke all on function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text)
  from public, anon, authenticator, service_role;
grant execute on function public.enqueue_linkedin_outbound(text, text, text, uuid, text, text, text)
  to authenticated;
