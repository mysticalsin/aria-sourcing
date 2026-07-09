-- 0011_outreach_approval_lifecycle.sql
--
-- Human approvals are durable authority, not a UI label. This migration makes
-- revocation explicit, binds live email claims to an approval id, and ensures a
-- WhatsApp queued-row transition cannot race a revoked approval.

alter table public.outreach_approvals
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id),
  add column if not exists revocation_reason text;

alter table public.outreach_approvals
  add constraint outreach_approvals_revocation_shape_check
  check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by is not null and revocation_reason is not null)
  ) not valid;

create index if not exists outreach_approvals_active_lookup_idx
  on public.outreach_approvals (workspace_id, message_id)
  where revoked_at is null;

alter table public.outreach_ledger
  add column if not exists approval_message_id text;

create unique index if not exists outreach_ledger_approval_message_uniq
  on public.outreach_ledger (workspace_id, approval_message_id)
  where approval_message_id is not null;

-- The browser calls this through /api/outreach/approve. SECURITY DEFINER is
-- intentional: an authorized reviewer can re-approve another reviewer’s
-- revoked draft without inheriting the restrictive original-author RLS policy.
create or replace function public.record_outreach_approval(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
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
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  insert into public.outreach_approvals(
    workspace_id,
    message_id,
    body_hash,
    approval_scope_hash,
    approved_by,
    approved_at,
    approval_source,
    revoked_at,
    revoked_by,
    revocation_reason
  ) values (
    wid,
    p_message_id,
    p_body_hash,
    p_approval_scope_hash,
    auth.uid(),
    now(),
    'human',
    null,
    null,
    null
  ) on conflict (workspace_id, message_id) do update
    set body_hash = excluded.body_hash,
        approval_scope_hash = excluded.approval_scope_hash,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        approval_source = 'human',
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.record_outreach_approval(text, text, text) from public, anon;
grant execute on function public.record_outreach_approval(text, text, text) to authenticated;

-- Rejection is idempotent until a claim has crossed the send cutoff. A queued
-- WhatsApp outbox row is cancelled here as a convenience; the claim trigger
-- below remains the final race-safe enforcement point.
create or replace function public.revoke_outreach_approval(
  p_message_id text,
  p_reason text default 'Operator rejected the outreach draft.'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('ok', true, 'revoked', false, 'reason', 'not-found'); end if;
  if approval.revoked_at is not null then return json_build_object('ok', true, 'revoked', false, 'reason', 'already-revoked'); end if;
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  update public.outreach_approvals
    set revoked_at = now(),
        revoked_by = auth.uid(),
        revocation_reason = left(coalesce(nullif(trim(p_reason), ''), 'Operator rejected the outreach draft.'), 500)
    where id = approval.id;

  update public.messages_outbound
    set status = 'blocked',
        gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('approval-revoked'))
    where workspace_id = wid
      and approval_message_id = p_message_id
      and status = 'queued';

  return json_build_object('ok', true, 'revoked', true);
end;
$$;

revoke all on function public.revoke_outreach_approval(text, text) from public, anon;
grant execute on function public.revoke_outreach_approval(text, text) to authenticated;

-- Email validation and ledger creation must occur while the active approval
-- row is locked. The delivery provider remains outside Postgres, so a claimed
-- ledger is the irreversible cutoff for a later revoke request.
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
  if approval.approval_source <> 'human' then return json_build_object('allowed', false, 'reason', 'approval-not-human'); end if;
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

-- The old generic claim does not know about approval lifecycle or RBAC. All
-- browser-facing email sends now use claim_email_outbound above; WhatsApp uses
-- the service-only claim from 0009.
revoke execute on function public.claim_and_record(text, text, text, uuid, text, int) from authenticated;
grant execute on function public.claim_and_record(text, text, text, uuid, text, int) to service_role;

-- The existing WhatsApp claim predates revocation fields. This trigger runs in
-- that claim transaction and closes the only remaining queued-to-dispatching
-- race without weakening the service-only state machine in migration 0009.
create or replace function public.enforce_active_whatsapp_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient text;
begin
  if new.channel <> 'WhatsApp' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;
  recipient := public.normalize_whatsapp_e164(coalesce(new.recipient_e164, new.to_address));
  if recipient is null or not exists (
    select 1 from public.outreach_approvals a
      where a.workspace_id = new.workspace_id
        and a.message_id = coalesce(new.approval_message_id, new.id::text)
        and a.body_hash = encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
        and a.approval_scope_hash = encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
        and a.approval_source = 'human'
        and a.revoked_at is null
  ) then
    raise exception 'active human approval required for WhatsApp dispatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_outbound_active_whatsapp_approval on public.messages_outbound;
create trigger messages_outbound_active_whatsapp_approval
  before update of status on public.messages_outbound
  for each row execute function public.enforce_active_whatsapp_approval();
