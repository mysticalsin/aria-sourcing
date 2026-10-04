-- 0028_conversation_authority_hardening.sql
-- Message rows are provider and workflow authority, not browser-owned state.
-- Authenticated operators may read only their own agent conversations and may
-- enqueue an already-approved WhatsApp message through one bounded RPC. Inbound
-- ingestion, agent-draft creation, delivery, and reconciliation remain service
-- operations.

-- PostgreSQL's ARE engine rejects the legacy `{1,512}` repetition bound when
-- the constraint is evaluated. Preserve the intended 512-character Meta name
-- limit with a length predicate and an unbounded character-class expression.
alter table public.whatsapp_templates
  drop constraint if exists whatsapp_templates_meta_name_check;
alter table public.whatsapp_templates
  add constraint whatsapp_templates_meta_name_check
  check (
    length(meta_name) between 1 and 512
    and meta_name ~ '^[A-Za-z0-9_]+$'
  ) not valid;
alter table public.whatsapp_templates
  validate constraint whatsapp_templates_meta_name_check;

alter table public.messages_outbound
  add column if not exists owner_id uuid references auth.users(id);

alter table public.messages_inbound
  add column if not exists owner_id uuid references auth.users(id);

alter table public.agent_conversations
  add column if not exists owner_id uuid references auth.users(id);

-- Preserve only a binding that has durable provider-acceptance evidence and an
-- exact same-workspace spec owner. Everything else is unproven legacy data and
-- loses conversation authority instead of being guessed into a tenant.
update public.messages_outbound as message
set owner_id = spec.owner_id
from public.agent_specs as spec
where message.owner_id is null
  and message.spec_id = spec.id
  and message.workspace_id = spec.workspace_id
  and message.status = 'sent'
  and message.provider_message_id is not null
  and message.delivery_attempt_id is not null;

update public.messages_outbound
set spec_id = null,
    owner_id = null,
    conversation_id = null
where spec_id is not null
  and owner_id is null;

update public.messages_outbound
set conversation_id = null
where conversation_id is not null
  and owner_id is null;

update public.agent_conversations
set spec_id = null,
    owner_id = null
where spec_id is not null
  and owner_id is null;

update public.messages_inbound
set conversation_id = null,
    candidate_id = null,
    owner_id = null
where conversation_id is not null
  and owner_id is null;

create unique index if not exists agent_conversations_id_workspace_owner_key
  on public.agent_conversations (id, workspace_id, owner_id);

alter table public.messages_outbound
  drop constraint if exists messages_outbound_spec_id_fkey,
  drop constraint if exists messages_outbound_conversation_id_fkey,
  drop constraint if exists messages_outbound_workspace_owner_spec_fkey,
  drop constraint if exists messages_outbound_conversation_authority_fkey,
  drop constraint if exists messages_outbound_owner_spec_shape_check,
  drop constraint if exists messages_outbound_conversation_owner_shape_check;

alter table public.messages_outbound
  add constraint messages_outbound_workspace_owner_spec_fkey
    foreign key (workspace_id, owner_id, spec_id)
    references public.agent_specs (workspace_id, owner_id, id)
    on delete restrict,
  add constraint messages_outbound_conversation_authority_fkey
    foreign key (conversation_id, workspace_id, owner_id)
    references public.agent_conversations (id, workspace_id, owner_id)
    on delete restrict,
  add constraint messages_outbound_owner_spec_shape_check
    check (spec_id is null or owner_id is not null) not valid,
  add constraint messages_outbound_conversation_owner_shape_check
    check (conversation_id is null or owner_id is not null) not valid;

alter table public.agent_conversations
  drop constraint if exists agent_conversations_spec_id_fkey,
  drop constraint if exists agent_conversations_workspace_owner_spec_fkey,
  drop constraint if exists agent_conversations_owner_spec_shape_check;

alter table public.agent_conversations
  add constraint agent_conversations_workspace_owner_spec_fkey
    foreign key (workspace_id, owner_id, spec_id)
    references public.agent_specs (workspace_id, owner_id, id)
    on delete restrict,
  add constraint agent_conversations_owner_spec_shape_check
    check (
      (owner_id is null and spec_id is null)
      or (owner_id is not null and spec_id is not null)
    ) not valid;

alter table public.messages_inbound
  drop constraint if exists messages_inbound_conversation_id_fkey,
  drop constraint if exists messages_inbound_conversation_authority_fkey,
  drop constraint if exists messages_inbound_conversation_owner_shape_check;

alter table public.messages_inbound
  add constraint messages_inbound_conversation_authority_fkey
    foreign key (conversation_id, workspace_id, owner_id)
    references public.agent_conversations (id, workspace_id, owner_id)
    on delete restrict,
  add constraint messages_inbound_conversation_owner_shape_check
    check (
      (conversation_id is null and owner_id is null)
      or (conversation_id is not null and owner_id is not null)
    ) not valid;

alter table public.messages_outbound
  validate constraint messages_outbound_owner_spec_shape_check,
  validate constraint messages_outbound_conversation_owner_shape_check;
alter table public.agent_conversations
  validate constraint agent_conversations_owner_spec_shape_check;
alter table public.messages_inbound
  validate constraint messages_inbound_conversation_owner_shape_check;

create index if not exists messages_outbound_owner_idx
  on public.messages_outbound (workspace_id, owner_id, created_at desc);
create index if not exists messages_inbound_owner_idx
  on public.messages_inbound (workspace_id, owner_id, received_at desc);
create index if not exists agent_conversations_owner_idx
  on public.agent_conversations (workspace_id, owner_id, last_inbound_at desc);

-- Browser sessions cannot forge provider events, conversation anchors, or
-- delivery state. Security-definer functions below retain narrowly bounded
-- operator transitions; service workers retain explicit ledger authority.
drop policy if exists messages_outbound_insert on public.messages_outbound;
drop policy if exists messages_outbound_update on public.messages_outbound;
drop policy if exists messages_inbound_insert on public.messages_inbound;
drop policy if exists messages_inbound_update on public.messages_inbound;

revoke insert, update, delete on public.messages_outbound from authenticated;
revoke insert, update, delete on public.messages_inbound from authenticated;

grant select, insert, update, delete on public.messages_outbound to service_role;
grant select, insert, update, delete on public.messages_inbound to service_role;

drop policy if exists messages_outbound_select on public.messages_outbound;
create policy messages_outbound_select on public.messages_outbound
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and owner_id = auth.uid()
  );

drop policy if exists messages_inbound_select on public.messages_inbound;
create policy messages_inbound_select on public.messages_inbound
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and owner_id = auth.uid()
  );

drop policy if exists agent_conversations_select on public.agent_conversations;
create policy agent_conversations_select on public.agent_conversations
  for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() <> 'viewer'
    and owner_id = auth.uid()
  );

-- The sole browser-facing message write. The caller supplies display inputs;
-- the transaction derives workspace, actor, hashes, sender, and dedupe authority
-- from current database state and the exact active human approval.
create or replace function public.enqueue_whatsapp_outbound(
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
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  actor public.profiles%rowtype;
  state jsonb;
  candidate jsonb;
  approval public.outreach_approvals%rowtype;
  sender public.whatsapp_senders%rowtype;
  template public.whatsapp_templates%rowtype;
  recipient text;
  expected_body_hash text;
  expected_scope_hash text;
  normalized_body text;
  dedupe text;
  queued_id uuid;
  audit jsonb;
  schema_item jsonb;
  audit_item jsonb;
  parameter_value text;
  parameter_max integer;
  parameter_index integer;
begin
  if actor_id is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;
  if wid is null then
    return json_build_object('ok', false, 'reason', 'workspace-not-found');
  end if;
  if p_message_id is null or length(p_message_id) not between 1 and 120
     or p_candidate_id is null or length(p_candidate_id) not between 1 and 120
     or p_seat_id is null
     or p_type not in ('candidate_reply', 'approved_template')
     or p_subject is null or length(p_subject) > 255
     or p_body is null or length(p_body) not between 1 and 50000 then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  recipient := public.normalize_whatsapp_e164(p_recipient);
  if recipient is null then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;

  select * into actor
    from public.profiles
    where id = actor_id
      and workspace_id = wid
      and role in ('admin', 'member')
    for share;
  if not found then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;

  select workspace_state.state into state
    from public.workspace_state as workspace_state
    where workspace_state.workspace_id = wid
    for share;
  if not found then
    return json_build_object('ok', false, 'reason', 'workspace-state-unavailable');
  end if;

  select item.value into candidate
    from jsonb_array_elements(coalesce(state -> 'candidates', '[]'::jsonb)) as item(value)
    where item.value ->> 'id' = p_candidate_id
      and coalesce(item.value #> '{complianceFlags,anonymized}', 'false'::jsonb) = 'false'::jsonb
    limit 1;
  if candidate is null then
    return json_build_object('ok', false, 'reason', 'candidate-not-found');
  end if;
  if p_campaign_id is not null
     and candidate ->> 'campaignId' is distinct from p_campaign_id then
    return json_build_object('ok', false, 'reason', 'candidate-campaign-mismatch');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid
      and message_id = p_message_id
    for update;
  if not found
     or approval.approval_source <> 'human'
     or approval.revoked_at is not null then
    return json_build_object('ok', false, 'reason', 'approval-invalid');
  end if;

  expected_body_hash := encode(
    extensions.digest(p_subject || E'\n' || p_body, 'sha256'),
    'hex'
  );
  expected_scope_hash := encode(
    extensions.digest(p_candidate_id || E'\nWhatsApp\n' || recipient, 'sha256'),
    'hex'
  );
  if approval.body_hash is distinct from expected_body_hash
     or approval.approval_scope_hash is distinct from expected_scope_hash then
    return json_build_object('ok', false, 'reason', 'approval-mismatch');
  end if;

  -- WhatsApp sender legitimacy is the Meta phone-number registration
  -- (whatsapp_senders.status='active') on a live WhatsApp Cloud seat — NOT
  -- email domain_verified (SPF/DKIM/DMARC), which no WhatsApp seat can ever
  -- satisfy and which claim_whatsapp_outbound deliberately does not require.
  -- Requiring it here made every WhatsApp enqueue fail 'sender-unavailable'.
  select whatsapp_sender.* into sender
    from public.whatsapp_senders as whatsapp_sender
    join public.agent_seats as seat
      on seat.id = whatsapp_sender.seat_id
     and seat.workspace_id = wid
     and seat.provider = 'WhatsApp Cloud'
     and seat.status = 'active'
     and seat.mode = 'live'
    where whatsapp_sender.workspace_id = wid
      and whatsapp_sender.seat_id = p_seat_id
      and whatsapp_sender.status = 'active'
    for share of whatsapp_sender, seat;
  if not found then
    return json_build_object('ok', false, 'reason', 'sender-unavailable');
  end if;

  if p_type = 'candidate_reply' then
    if p_campaign_id is null
       or p_template_id is not null
       or p_template_parameters <> '[]'::jsonb then
      return json_build_object('ok', false, 'reason', 'invalid-reply-shape');
    end if;
  else
    if p_template_id is null
       or jsonb_typeof(p_template_parameters) <> 'array' then
      return json_build_object('ok', false, 'reason', 'invalid-template-shape');
    end if;
    select * into template
      from public.whatsapp_templates
      where id = p_template_id
        and workspace_id = wid
        and sender_id = sender.id
        and status = 'approved'
      for share;
    if not found
       or template.approved_at is null
       or jsonb_typeof(template.parameter_schema) <> 'array'
       or jsonb_array_length(template.parameter_schema) <> template.body_parameter_count
       or jsonb_array_length(p_template_parameters) <> template.body_parameter_count
       or template.body_parameter_count > 10
       or p_subject <> 'WhatsApp approved-template dispatch' then
      return json_build_object('ok', false, 'reason', 'template-invalid');
    end if;

    begin
      audit := p_body::jsonb;
    exception when others then
      return json_build_object('ok', false, 'reason', 'template-audit-invalid');
    end;
    if jsonb_typeof(audit) <> 'object'
       or audit - array['audit_version', 'kind', 'template', 'parameters'] <> '{}'::jsonb
       or audit ->> 'audit_version' <> '1'
       or audit ->> 'kind' <> 'meta_approved_whatsapp_template'
       or jsonb_typeof(audit -> 'template') <> 'object'
       or jsonb_typeof(audit -> 'parameters') <> 'array'
       or audit -> 'template' ->> 'id' <> template.id::text
       or audit -> 'template' ->> 'sender_id' <> sender.id::text
       or audit -> 'template' ->> 'meta_name' <> template.meta_name
       or audit -> 'template' ->> 'language' <> template.language
       or audit -> 'template' ->> 'version' <> template.version::text
       or jsonb_array_length(audit -> 'parameters') <> template.body_parameter_count then
      return json_build_object('ok', false, 'reason', 'template-audit-invalid');
    end if;

    if template.body_parameter_count > 0 then
      for parameter_index in 0..template.body_parameter_count - 1 loop
        schema_item := template.parameter_schema -> parameter_index;
        audit_item := audit -> 'parameters' -> parameter_index;
        if jsonb_typeof(schema_item) <> 'object'
           or jsonb_typeof(p_template_parameters -> parameter_index) <> 'string'
           or jsonb_typeof(audit_item) <> 'object'
           or audit_item - array['name', 'value'] <> '{}'::jsonb
           or coalesce(schema_item ->> 'name', '') !~ '^[a-z][a-z0-9_]{0,63}$' then
          return json_build_object('ok', false, 'reason', 'template-parameter-invalid');
        end if;
        begin
          parameter_max := coalesce(
            (schema_item ->> 'max_length')::integer,
            (schema_item ->> 'maxLength')::integer
          );
        exception when others then
          return json_build_object('ok', false, 'reason', 'template-parameter-invalid');
        end;
        parameter_value := btrim(p_template_parameters ->> parameter_index);
        if parameter_max not between 1 and 1024
           or length(parameter_value) not between 1 and parameter_max
           or parameter_value ~ '[[:cntrl:]]'
           or audit_item ->> 'name' <> schema_item ->> 'name'
           or audit_item ->> 'value' <> parameter_value then
          return json_build_object('ok', false, 'reason', 'template-parameter-invalid');
        end if;
      end loop;
    end if;
  end if;

  normalized_body := btrim(regexp_replace(lower(p_body), '[[:space:]]+', ' ', 'g'));
  dedupe := encode(
    extensions.digest(p_candidate_id || E'\nWhatsApp\n' || normalized_body, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound (
      workspace_id, owner_id, candidate_id, seat_id, channel, to_address,
      recipient_e164, approval_message_id, type, subject, body, status,
      gate_result, template_id, template_parameters, content_hash, dedupe_hash,
      scheduled_at
    ) values (
      wid, actor_id, p_candidate_id, p_seat_id, 'WhatsApp', recipient,
      recipient, p_message_id, p_type, p_subject, p_body, 'queued',
      jsonb_build_object('pass', true, 'reasons', '[]'::jsonb),
      p_template_id, p_template_parameters,
      encode(extensions.digest(p_body, 'sha256'), 'hex'), dedupe, now()
    ) returning id into queued_id;
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'duplicate');
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', queued_id);
end;
$$;

revoke all on function public.enqueue_whatsapp_outbound(
  text, text, text, uuid, text, text, text, text, uuid, jsonb
) from public, anon, authenticator, service_role;
grant execute on function public.enqueue_whatsapp_outbound(
  text, text, text, uuid, text, text, text, text, uuid, jsonb
) to authenticated;

-- Provider-scoped reply resolution. Only an accepted/sent row with a durable
-- delivery attempt and an exact same-workspace owner/spec binding may create a
-- conversation. Existing trusted conversations retain their owner.
create or replace function public.resolve_whatsapp_inbound_conversation(
  p_inbound_id uuid,
  p_claim_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  sender public.whatsapp_senders%rowtype;
  conversation public.agent_conversations%rowtype;
  thread_key text;
  binding_count integer;
  binding_candidate_id text;
  binding_spec_id uuid;
  binding_owner_id uuid;
  resolved_conversation_id uuid;
  resolved_candidate_id text;
  resolved_spec_id uuid;
  resolved_owner_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if inbound.channel <> 'WhatsApp' then return json_build_object('ok', false, 'reason', 'wrong-channel'); end if;
  if inbound.processing_claim_id is distinct from p_claim_id then
    return json_build_object('ok', false, 'reason', 'claim-mismatch');
  end if;
  if inbound.whatsapp_sender_id is null then
    return json_build_object('ok', false, 'reason', 'no-sender-context');
  end if;

  thread_key := inbound.whatsapp_sender_id::text || ':' || inbound.from_address;

  select * into conversation
    from public.agent_conversations
    where workspace_id = inbound.workspace_id
      and channel = 'WhatsApp'
      and provider_thread_key = thread_key
    for update;
  if found and conversation.owner_id is not null and conversation.spec_id is not null then
    update public.agent_conversations
      set last_inbound_at = greatest(coalesce(last_inbound_at, inbound.received_at), inbound.received_at)
      where id = conversation.id;
    resolved_conversation_id := conversation.id;
    resolved_candidate_id := conversation.candidate_id;
    resolved_spec_id := conversation.spec_id;
    resolved_owner_id := conversation.owner_id;
  else
    select * into sender
      from public.whatsapp_senders
      where id = inbound.whatsapp_sender_id
        and workspace_id = inbound.workspace_id
      for share;
    if not found or sender.seat_id is null then
      return json_build_object('ok', false, 'reason', 'no-conversation');
    end if;

    select count(*) into binding_count
    from (
      select distinct m.candidate_id, m.spec_id, m.owner_id
      from public.messages_outbound as m
      join public.agent_specs as spec
        on spec.id = m.spec_id
       and spec.workspace_id = m.workspace_id
       and spec.owner_id = m.owner_id
      where m.workspace_id = inbound.workspace_id
        and m.channel = 'WhatsApp'
        and coalesce(m.recipient_e164, public.normalize_whatsapp_e164(m.to_address)) = inbound.from_address
        and m.seat_id = sender.seat_id
        and m.status = 'sent'
        and m.provider_message_id is not null
        and m.delivery_attempt_id is not null
        and m.spec_id is not null
        and m.owner_id is not null
    ) as bindings;
    if binding_count = 0 then
      return json_build_object('ok', false, 'reason', 'no-conversation');
    end if;
    if binding_count > 1 then
      return json_build_object('ok', false, 'reason', 'ambiguous-conversation');
    end if;

    select distinct m.candidate_id, m.spec_id, m.owner_id
      into binding_candidate_id, binding_spec_id, binding_owner_id
    from public.messages_outbound as m
    join public.agent_specs as spec
      on spec.id = m.spec_id
     and spec.workspace_id = m.workspace_id
     and spec.owner_id = m.owner_id
    where m.workspace_id = inbound.workspace_id
      and m.channel = 'WhatsApp'
      and coalesce(m.recipient_e164, public.normalize_whatsapp_e164(m.to_address)) = inbound.from_address
      and m.seat_id = sender.seat_id
      and m.status = 'sent'
      and m.provider_message_id is not null
      and m.delivery_attempt_id is not null
      and m.spec_id is not null
      and m.owner_id is not null;

    insert into public.agent_conversations (
      workspace_id, owner_id, spec_id, candidate_id, channel,
      whatsapp_sender_id, provider_thread_key, last_inbound_at
    ) values (
      inbound.workspace_id, binding_owner_id, binding_spec_id,
      binding_candidate_id, 'WhatsApp', inbound.whatsapp_sender_id,
      thread_key, inbound.received_at
    )
    on conflict (workspace_id, channel, provider_thread_key)
      do update set
        owner_id = coalesce(public.agent_conversations.owner_id, excluded.owner_id),
        spec_id = coalesce(public.agent_conversations.spec_id, excluded.spec_id),
        candidate_id = case
          when public.agent_conversations.owner_id is null then excluded.candidate_id
          else public.agent_conversations.candidate_id
        end,
        last_inbound_at = greatest(
          coalesce(public.agent_conversations.last_inbound_at, excluded.last_inbound_at),
          excluded.last_inbound_at
        )
    returning id, candidate_id, spec_id, owner_id
      into resolved_conversation_id, resolved_candidate_id,
           resolved_spec_id, resolved_owner_id;
  end if;

  update public.messages_inbound
  set conversation_id = resolved_conversation_id,
      candidate_id = resolved_candidate_id,
      owner_id = resolved_owner_id
  where id = inbound.id;

  return json_build_object(
    'ok', true,
    'conversation_id', resolved_conversation_id,
    'candidate_id', resolved_candidate_id,
    'spec_id', resolved_spec_id,
    'owner_id', resolved_owner_id
  );
end;
$$;

revoke all on function public.resolve_whatsapp_inbound_conversation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_inbound_conversation(uuid, uuid)
  to service_role;
