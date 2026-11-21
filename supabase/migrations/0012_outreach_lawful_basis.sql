-- Fail closed on lawful basis inside the approval and enqueue functions.
-- A signed-in caller cannot record an approval or queue an email by calling
-- these SECURITY DEFINER functions directly and skipping the API routes.
-- 0001 stays immutable. This replacement keeps the same signatures.

create or replace function public.candidate_has_operator_lawful_basis(p_workspace_id uuid, p_candidate_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.workspace_state ws
    cross join lateral jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
    where ws.workspace_id = p_workspace_id
      and p_candidate_id is not null
      and elem->>'id' = p_candidate_id
      and elem->>'lawfulBasis' in ('consent', 'legitimate_interest')
      and elem->>'lawfulBasisSource' = 'operator_selection'
      and elem->>'lawfulBasisRecordedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  );
$$;

revoke all on function public.candidate_has_operator_lawful_basis(uuid, text) from public, anon, authenticated;

create or replace function public.enqueue_email_outbound(p_message_id text, p_candidate_id text, p_campaign_id text, p_seat_id uuid, p_recipient text, p_subject text, p_body text) returns json
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $_$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  recipient text := lower(btrim(coalesce(p_recipient, '')));
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
  if recipient = '' or recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;
  if not public.candidate_has_operator_lawful_basis(wid, p_candidate_id) then
    return json_build_object('ok', false, 'reason', 'lawful-basis-required');
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
      wid, p_candidate_id, p_seat_id, 'Email', recipient, 'candidate_reply',
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
$_$;

create or replace function public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text) returns json
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $_$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
  candidate_id text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;
  if p_body_hash is null or p_approval_scope_hash is null
    or p_body_hash !~ '^[0-9a-f]{64}$' or p_approval_scope_hash !~ '^[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'reason', 'invalid-approval-hash');
  end if;

  select elem->>'candidateId' into candidate_id
    from public.workspace_state ws
    cross join lateral jsonb_array_elements(coalesce(ws.state->'outreach', '[]'::jsonb)) elem
    where ws.workspace_id = wid
      and elem->>'id' = p_message_id
    limit 1;
  if not public.candidate_has_operator_lawful_basis(wid, candidate_id) then
    return json_build_object('ok', false, 'reason', 'lawful-basis-required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  if found then
    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  else
    insert into public.outreach_approvals(
      workspace_id, message_id, body_hash, approval_scope_hash,
      approved_by, approved_at, approval_source,
      revoked_at, revoked_by, revocation_reason
    ) values (
      wid, p_message_id, p_body_hash, p_approval_scope_hash,
      auth.uid(), now(), 'human',
      null, null, null
    ) on conflict (workspace_id, message_id) do nothing;

    select * into approval
      from public.outreach_approvals
      where workspace_id = wid and message_id = p_message_id
      for update;
    if not found then return json_build_object('ok', false, 'reason', 'approval-record-failed'); end if;

    if exists (
      select 1 from public.outreach_ledger l
        where l.workspace_id = wid
          and l.approval_message_id = p_message_id
          and l.status in ('claimed', 'sent')
    ) then
      return json_build_object('ok', false, 'reason', 'already-dispatching');
    end if;

    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  end if;

  return json_build_object('ok', true);
end;
$_$;
