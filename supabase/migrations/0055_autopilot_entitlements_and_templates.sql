-- 0055_autopilot_entitlements_and_templates.sql
--
-- Per-user autopilot entitlement (admin-toggled) + template+audience approval
-- authority for entitled users. Workspace switchboard remains the blast-radius
-- control; this migration adds the who-may-use-autopilot axis.
--
-- Additive-forward only. Existing human approval path is unchanged.

-- ---------------------------------------------------------------------------
-- 1. profiles.autopilot_enabled (default false — fail closed)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists autopilot_enabled boolean not null default false;

alter table public.profiles
  add column if not exists autopilot_updated_by uuid;

alter table public.profiles
  add column if not exists autopilot_updated_at timestamptz;

comment on column public.profiles.autopilot_enabled is
  'Admin-toggled entitlement. When false, the member cannot use shortlist auto-approve, template-bound send, or auto-queued replies. Workspace switchboard flags still gate the loop.';

-- ---------------------------------------------------------------------------
-- 2. Autopilot entitlement audit
-- ---------------------------------------------------------------------------

create table if not exists public.autopilot_entitlement_audit (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  target_user_id uuid not null,
  actor_id      uuid not null,
  enabled       boolean not null,
  created_at    timestamptz not null default now(),
  constraint autopilot_entitlement_audit_target_fk
    foreign key (workspace_id, target_user_id)
    references public.profiles (workspace_id, id)
    on delete cascade,
  constraint autopilot_entitlement_audit_actor_fk
    foreign key (workspace_id, actor_id)
    references public.profiles (workspace_id, id)
    on delete restrict
);

create index if not exists autopilot_entitlement_audit_workspace_created_idx
  on public.autopilot_entitlement_audit (workspace_id, created_at desc);

alter table public.autopilot_entitlement_audit enable row level security;

drop policy if exists "autopilot entitlement audit read" on public.autopilot_entitlement_audit;
create policy "autopilot entitlement audit read" on public.autopilot_entitlement_audit
  for select using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 3. Workspace shortlist auto threshold + currency budget kill (A-4 / A-10)
-- ---------------------------------------------------------------------------

alter table public.sourcing_loop_controls
  add column if not exists auto_shortlist_min_score integer not null default 70
    check (auto_shortlist_min_score between 0 and 100);

alter table public.sourcing_loop_controls
  add column if not exists max_provider_spend_cents_per_day integer not null default 0
    check (max_provider_spend_cents_per_day between 0 and 100000000);

comment on column public.sourcing_loop_controls.auto_shortlist_min_score is
  'Minimum candidate match score for entitled-user shortlist auto-approve. 0 disables the score gate only when an entitled actor is present.';

comment on column public.sourcing_loop_controls.max_provider_spend_cents_per_day is
  'Currency ceiling in cents. 0 means no currency kill (count caps still apply). When spend reaches the ceiling the switchboard kill_switch trips.';

-- ---------------------------------------------------------------------------
-- 4. Outreach templates (template + audience approval model)
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_templates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null,
  channel         text not null
    check (channel in ('Email', 'WhatsApp', 'LinkedIn')),
  subject         text,
  body            text not null,
  body_hash       text not null,
  audience_filter jsonb not null default '{}'::jsonb,
  status          text not null default 'draft'
    check (status in ('draft', 'approved', 'revoked')),
  approved_by     uuid,
  approved_at     timestamptz,
  revoked_at      timestamptz,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint outreach_templates_name_len check (char_length(name) between 1 and 200),
  constraint outreach_templates_body_len check (char_length(body) between 1 and 20000),
  constraint outreach_templates_created_by_fk
    foreign key (workspace_id, created_by)
    references public.profiles (workspace_id, id)
    on delete restrict,
  constraint outreach_templates_approved_by_fk
    foreign key (workspace_id, approved_by)
    references public.profiles (workspace_id, id)
    on delete restrict,
  constraint outreach_templates_approved_shape check (
    (status = 'approved' and approved_by is not null and approved_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
    or (status = 'draft')
  )
);

create index if not exists outreach_templates_workspace_status_idx
  on public.outreach_templates (workspace_id, status);

alter table public.outreach_templates enable row level security;

drop policy if exists "outreach templates read" on public.outreach_templates;
create policy "outreach templates read" on public.outreach_templates
  for select using (workspace_id = public.current_workspace_id());

-- Mutations go through SECURITY DEFINER RPCs only.
revoke insert, update, delete on public.outreach_templates from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Extend outreach_approvals for template-bound instances
-- ---------------------------------------------------------------------------

alter table public.outreach_approvals
  add column if not exists template_id uuid;

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_approval_source_check;

alter table public.outreach_approvals
  add constraint outreach_approvals_approval_source_check
  check (approval_source in ('human', 'legacy_unverified', 'template_bound'));

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_template_fk;

alter table public.outreach_approvals
  add constraint outreach_approvals_template_fk
  foreign key (template_id)
  references public.outreach_templates (id)
  on delete restrict;

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_template_bound_shape;

alter table public.outreach_approvals
  add constraint outreach_approvals_template_bound_shape check (
    (approval_source = 'template_bound' and template_id is not null)
    or (approval_source <> 'template_bound')
  );

comment on column public.outreach_approvals.approval_source is
  'human = named operator approved exact body. template_bound = entitled operator approved a template+audience; instance minted under that authority. legacy_unverified = fail-closed until re-approved.';

-- ---------------------------------------------------------------------------
-- 6. Helper: does this approval authorize a wire send?
-- ---------------------------------------------------------------------------

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

revoke all on function public.outbound_approval_authorizes_send(uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.outbound_approval_authorizes_send(uuid, text, uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. set_member_autopilot — admin-only, no self-escalation via client RLS
-- ---------------------------------------------------------------------------

create or replace function public.set_member_autopilot(
  p_target_user_id uuid,
  p_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  target_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_target_user_id is null or p_enabled is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select profile.role into target_role
    from public.profiles profile
   where profile.workspace_id = caller_workspace
     and profile.id = p_target_user_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Viewers never receive autopilot; admins/members may.
  if target_role = 'viewer' and p_enabled is true then
    return jsonb_build_object('status', 'viewer_denied');
  end if;

  update public.profiles
     set autopilot_enabled = p_enabled,
         autopilot_updated_by = auth.uid(),
         autopilot_updated_at = now()
   where workspace_id = caller_workspace
     and id = p_target_user_id;

  insert into public.autopilot_entitlement_audit (
    workspace_id, target_user_id, actor_id, enabled
  ) values (
    caller_workspace, p_target_user_id, auth.uid(), p_enabled
  );

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace,
    'autopilot.entitlement_updated',
    'profile',
    p_target_user_id::text,
    jsonb_build_object(
      'actor_id', auth.uid()::text,
      'target_user_id', p_target_user_id::text,
      'enabled', p_enabled
    )
  );

  return jsonb_build_object(
    'status', 'ok',
    'target_user_id', p_target_user_id,
    'enabled', p_enabled
  );
end;
$$;

revoke all on function public.set_member_autopilot(uuid, boolean)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.set_member_autopilot(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. list_workspace_members — admin roster with entitlement flags
-- ---------------------------------------------------------------------------

create or replace function public.list_workspace_members()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', profile.id,
      'email', profile.email,
      'full_name', profile.full_name,
      'role', profile.role,
      'autopilot_enabled', profile.autopilot_enabled,
      'autopilot_updated_at', profile.autopilot_updated_at,
      'autopilot_updated_by', profile.autopilot_updated_by
    ) order by profile.email nulls last, profile.id
  ), '[]'::jsonb)
    into result
    from public.profiles profile
   where profile.workspace_id = caller_workspace;

  return result;
end;
$$;

revoke all on function public.list_workspace_members()
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_workspace_members() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. approve_outreach_template / revoke_outreach_template
-- ---------------------------------------------------------------------------

create or replace function public.approve_outreach_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  tmpl public.outreach_templates%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
       and profile.autopilot_enabled is true
  ) then
    raise exception 'autopilot-entitled administrator required' using errcode = '42501';
  end if;

  select * into tmpl
    from public.outreach_templates
   where id = p_template_id
     and workspace_id = caller_workspace
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if tmpl.status = 'revoked' then
    return jsonb_build_object('status', 'revoked');
  end if;

  update public.outreach_templates
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         revoked_at = null,
         updated_at = now()
   where id = p_template_id
     and workspace_id = caller_workspace;

  return jsonb_build_object('status', 'ok', 'template_id', p_template_id);
end;
$$;

create or replace function public.revoke_outreach_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  update public.outreach_templates
     set status = 'revoked',
         revoked_at = now(),
         updated_at = now()
   where id = p_template_id
     and workspace_id = caller_workspace
     and status <> 'revoked';

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'template_id', p_template_id);
end;
$$;

revoke all on function public.approve_outreach_template(uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.revoke_outreach_template(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.approve_outreach_template(uuid) to authenticated;
grant execute on function public.revoke_outreach_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. mint_template_bound_approval — service_role only
-- ---------------------------------------------------------------------------

create or replace function public.mint_template_bound_approval(
  p_workspace_id uuid,
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_template_id uuid,
  p_entitled_approver_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_workspace_id is null
     or p_message_id is null
     or p_body_hash is null
     or p_template_id is null
     or p_entitled_approver_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not public.outbound_approval_authorizes_send(
    p_workspace_id, 'template_bound', p_entitled_approver_id, p_template_id, null
  ) then
    return jsonb_build_object('status', 'not_authorized');
  end if;

  insert into public.outreach_approvals (
    workspace_id, message_id, body_hash, approval_scope_hash,
    approved_by, approved_at, approval_source, template_id
  ) values (
    p_workspace_id, p_message_id, p_body_hash, p_approval_scope_hash,
    p_entitled_approver_id, now(), 'template_bound', p_template_id
  )
  on conflict (workspace_id, message_id) do update
    set body_hash = excluded.body_hash,
        approval_scope_hash = excluded.approval_scope_hash,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        approval_source = 'template_bound',
        template_id = excluded.template_id,
        revoked_at = null;

  return jsonb_build_object('status', 'ok', 'message_id', p_message_id);
end;
$$;

revoke all on function public.mint_template_bound_approval(uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.mint_template_bound_approval(uuid, text, text, text, uuid, uuid)
  to service_role;


-- ---------------------------------------------------------------------------
-- 11. Patch LinkedIn claim + enforce to accept template_bound via helper
--     Bodies copied from 0054 with approval_source check swapped to helper.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_active_linkedin_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'LinkedIn' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or not public.outbound_approval_authorizes_send(
          new.workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
        )
  then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

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
    or seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API')
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
          'policy_version', '2026-07-29-linkedin',
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

-- ---------------------------------------------------------------------------
-- 12. profile_has_autopilot — used by app/worker
-- ---------------------------------------------------------------------------

create or replace function public.profile_has_autopilot(
  p_workspace_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_user_id
       and profile.autopilot_enabled is true
       and profile.role in ('admin', 'member')
  );
$$;

revoke all on function public.profile_has_autopilot(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.profile_has_autopilot(uuid, uuid) to service_role, authenticated;

-- 13. Email + WhatsApp claims accept template_bound via helper

create or replace function public.claim_email_outbound_queued(p_message_id uuid)
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
  domain        text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  rfc_id        text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  domain := split_part(recipient, '@', 2);
  if recipient = '' or domain = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-recipient');
  end if;

  -- Active human approval, locked, matching the exact stored subject/body and the
  -- candidate+channel+recipient scope. Same shape as the WhatsApp claim (0024).
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

  -- Suppression: opt-out / do-not-contact by exact email or by domain.
  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and ((s.type = 'email' and lower(s.value) = recipient)
          or (s.type = 'domain' and lower(s.value) = domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  -- Live, domain-verified email seat (never a WhatsApp/SMS sender).
  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active'
    or seat.mode <> 'live'
    or not seat.domain_verified
    or seat.provider in ('WhatsApp Cloud', 'Twilio SMS')
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  -- 90-day fleet-wide re-contact window (claimed | sent hold the slot).
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  -- Per-seat effective warmup cap (ambiguous also consumes a slot, mirroring 0024).
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

  -- Mint the RFC Message-ID BEFORE the send so the MIME header, the ledger, and
  -- the eventual delivery-event correlation all agree on one value. The domain is
  -- the SENDER's (the seat mailbox), per RFC 5322 — never the recipient's.
  rfc_id := '<' || attempt_id::text || '@' || split_part(seat.operator_email, '@', 2) || '>';

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id, rfc_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'Email', 'claimed',
      approval_id, outbound.id, attempt_id, rfc_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-17',
          'recipient', recipient,
          'content_kind', outbound.type,
          'rfc_message_id', rfc_id
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'rfc_message_id', rfc_id,
    'operator_email', seat.operator_email,
    'provider', seat.provider
  );
end;
$$;




create or replace function public.enforce_active_email_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'Email' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or not public.outbound_approval_authorizes_send(
          new.workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
        )
  then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;




create or replace function public.claim_whatsapp_outbound(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound      public.messages_outbound%rowtype;
  contact       public.whatsapp_contacts%rowtype;
  sender_row    public.whatsapp_senders%rowtype;
  template_row  public.whatsapp_templates%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  approval_id   text;
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

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := public.normalize_whatsapp_e164(coalesce(outbound.recipient_e164, outbound.to_address));
  if recipient is null then return json_build_object('allowed', false, 'reason', 'invalid-recipient'); end if;

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

  select * into sender_row
    from public.whatsapp_senders
    where workspace_id = outbound.workspace_id
      and seat_id = outbound.seat_id
      and status = 'active'
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'sender-not-active'); end if;

  if outbound.type = 'approved_template' then
    select * into template_row
      from public.whatsapp_templates
      where id = outbound.template_id
        and workspace_id = outbound.workspace_id
        and sender_id = sender_row.id
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
      where w.workspace_id = outbound.workspace_id
        and w.recipient_e164 = recipient
        and w.sender_id = sender_row.id
        and w.freeform_until > now()
  ) then
    return json_build_object('allowed', false, 'reason', 'reply-window-closed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
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
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status, approval_message_id, outbound_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.spec_id::text, 'agent'), 'WhatsApp', 'claimed', approval_id, outbound.id
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
    'meta_phone_number_id', sender_row.meta_phone_number_id,
    'template_id', outbound.template_id
  );
end;
$$;




revoke all on function public.claim_email_outbound_queued(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.claim_email_outbound_queued(uuid) to service_role;
revoke all on function public.claim_whatsapp_outbound(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.claim_whatsapp_outbound(uuid) to service_role;
