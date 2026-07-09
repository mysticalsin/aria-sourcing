-- 0014_whatsapp_review_and_inbound_recovery.sql
--
-- Persist the sender identity and retry metadata needed to recover a stored
-- WhatsApp inbound event, and make the human review release of a blocked reply
-- one atomic, workspace-scoped transaction.

alter table public.messages_inbound
  add column if not exists whatsapp_sender_id uuid references public.whatsapp_senders(id) on delete set null,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists last_processing_attempt_at timestamptz,
  add column if not exists last_processing_error text,
  add column if not exists processing_claim_id uuid,
  add column if not exists processing_lease_until timestamptz;

alter table public.messages_inbound
  add constraint messages_inbound_processing_attempts_check
  check (processing_attempts >= 0) not valid;

-- Backfill only unambiguous historic rows. If a workspace has multiple active
-- senders, leave the mapping null for human triage rather than guessing.
update public.messages_inbound inbound
set whatsapp_sender_id = sender.id
from public.whatsapp_senders sender
where inbound.channel = 'WhatsApp'
  and inbound.whatsapp_sender_id is null
  and sender.workspace_id = inbound.workspace_id
  and sender.status = 'active'
  and 1 = (
    select count(*) from public.whatsapp_senders candidate_sender
    where candidate_sender.workspace_id = inbound.workspace_id
      and candidate_sender.status = 'active'
  );

create index if not exists messages_inbound_whatsapp_recovery_idx
  on public.messages_inbound (workspace_id, whatsapp_sender_id, received_at)
  where channel = 'WhatsApp'
    and processed = false
    and whatsapp_sender_id is not null;

alter table public.messages_outbound
  add column if not exists review_decision text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists inbound_message_id uuid references public.messages_inbound(id) on delete set null;

alter table public.messages_outbound
  add constraint messages_outbound_review_shape_check
  check (
    (review_decision is null and reviewed_at is null and reviewed_by is null)
    or (review_decision in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
  ) not valid;

create index if not exists messages_outbound_whatsapp_review_idx
  on public.messages_outbound (workspace_id, created_at)
  where channel = 'WhatsApp'
    and status = 'blocked'
    and review_decision is null;

create unique index if not exists messages_outbound_inbound_message_uniq
  on public.messages_outbound (inbound_message_id)
  where inbound_message_id is not null;

-- The review route calls this under the operator's JWT. It takes the same
-- outbox -> advisory -> approval lock order as 0013, so review, revoke, and
-- dispatch cannot each observe a contradictory decision.
create or replace function public.review_whatsapp_outbound(
  p_message_id uuid,
  p_decision text
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  outbound public.messages_outbound%rowtype;
  approval public.outreach_approvals%rowtype;
  recipient text;
  approval_id text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_decision not in ('approve', 'reject') then return json_build_object('ok', false, 'reason', 'invalid-decision'); end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id and workspace_id = wid
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if outbound.channel <> 'WhatsApp'
    or outbound.type <> 'candidate_reply'
    or outbound.status <> 'blocked'
    or outbound.review_decision is not null then
    return json_build_object('ok', false, 'reason', 'not-reviewable');
  end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || approval_id, 0));

  if p_decision = 'reject' then
    update public.messages_outbound
      set review_decision = 'rejected',
          reviewed_at = now(),
          reviewed_by = auth.uid(),
          gate_result = coalesce(gate_result, '{}'::jsonb) || jsonb_build_object(
            'pass', false,
            'reasons', coalesce(gate_result -> 'reasons', '[]'::jsonb) || jsonb_build_array('human-review-rejected')
          )
      where id = outbound.id;
    return json_build_object('ok', true, 'status', 'rejected');
  end if;

  recipient := public.normalize_whatsapp_e164(coalesce(outbound.recipient_e164, outbound.to_address));
  if recipient is null then return json_build_object('ok', false, 'reason', 'invalid-recipient'); end if;

  if exists (
    select 1 from public.outreach_ledger ledger
    where ledger.workspace_id = wid
      and ledger.approval_message_id = approval_id
      and ledger.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = approval_id
    for update;

  if found then
    update public.outreach_approvals
      set body_hash = encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex'),
          approval_scope_hash = encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex'),
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  else
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
      approval_id,
      encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex'),
      encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex'),
      auth.uid(),
      now(),
      'human',
      null,
      null,
      null
    );
  end if;

  update public.messages_outbound
    set approval_message_id = approval_id,
        review_decision = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        status = 'queued',
        scheduled_at = now()
    where id = outbound.id;

  return json_build_object('ok', true, 'status', 'queued');
end;
$$;

revoke all on function public.review_whatsapp_outbound(uuid, text) from public, anon;
grant execute on function public.review_whatsapp_outbound(uuid, text) to authenticated;

-- Only one webhook delivery or recovery worker may compose a stored inbound
-- message at once. A short lease permits recovery after a process crash without
-- treating an uncertain model/provider call as a successful reply.
create or replace function public.claim_whatsapp_inbound_processing(
  p_inbound_id uuid,
  p_sender_id uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inbound public.messages_inbound%rowtype;
  claim_id uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_sender_id is null then return json_build_object('ok', false, 'reason', 'missing-sender'); end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if inbound.channel <> 'WhatsApp' then return json_build_object('ok', false, 'reason', 'wrong-channel'); end if;
  if inbound.processed then return json_build_object('ok', false, 'reason', 'already-processed'); end if;
  if inbound.whatsapp_sender_id is not null and inbound.whatsapp_sender_id is distinct from p_sender_id then
    return json_build_object('ok', false, 'reason', 'sender-mismatch');
  end if;
  if inbound.processing_lease_until is not null and inbound.processing_lease_until > now() then
    return json_build_object('ok', false, 'reason', 'already-claimed');
  end if;

  update public.messages_inbound
    set whatsapp_sender_id = p_sender_id,
        processing_attempts = processing_attempts + 1,
        last_processing_attempt_at = now(),
        last_processing_error = null,
        processing_claim_id = claim_id,
        processing_lease_until = now() + interval '2 minutes'
    where id = inbound.id;

  return json_build_object(
    'ok', true,
    'claim_id', claim_id,
    'workspace_id', inbound.workspace_id,
    'sender_id', p_sender_id,
    'from_address', inbound.from_address,
    'body', inbound.body,
    'provider_id', inbound.provider_id,
    'received_at', inbound.received_at
  );
end;
$$;

revoke all on function public.claim_whatsapp_inbound_processing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_inbound_processing(uuid, uuid) to service_role;

create or replace function public.complete_whatsapp_inbound_processing(
  p_inbound_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_error text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inbound public.messages_inbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_outcome not in ('processed', 'triage', 'retry') then
    return json_build_object('ok', false, 'reason', 'invalid-outcome');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if inbound.processing_claim_id is distinct from p_claim_id then
    return json_build_object('ok', false, 'reason', 'claim-mismatch');
  end if;

  update public.messages_inbound
    set processed = p_outcome in ('processed', 'triage'),
        last_processing_error = case when p_outcome = 'retry' then left(coalesce(p_error, p_outcome), 500) else null end,
        processing_claim_id = null,
        processing_lease_until = null
    where id = inbound.id;

  return json_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

revoke all on function public.complete_whatsapp_inbound_processing(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_whatsapp_inbound_processing(uuid, uuid, text, text) to service_role;
