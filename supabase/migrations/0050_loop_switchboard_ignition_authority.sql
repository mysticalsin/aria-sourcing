-- 0050_loop_switchboard_ignition_authority.sql
--
-- Rock 3: the sourcing loop may ignite and claim work only when the
-- per-workspace switchboard permits that stage. The kind-to-column mapping for
-- the eleven loop kinds lives in sourcing_loop_stage_enabled() so enqueue and
-- claim cannot drift.

create or replace function public.sourcing_loop_stage_enabled(
  p_workspace_id uuid,
  p_kind text
) returns boolean
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(auth.role(), '') = 'service_role'
     and coalesce((
      select case
        when p_kind in ('email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create')
          then not controls.kill_switch and controls.intake_enabled
        when p_kind in ('sourcing_batch', 'provider_poll', 'shortlist_build', 'draft_generate')
          then not controls.kill_switch and controls.sourcing_enabled
        when p_kind = 'enrich_candidate'
          then not controls.kill_switch and controls.enrichment_enabled
        when p_kind in ('delivery_reconcile', 'outcome_feedback')
          then not controls.kill_switch and controls.sequences_enabled
        when p_kind = 'swarm_assignment'
          then not controls.kill_switch and controls.swarm_enabled
        else false
      end
      from public.sourcing_loop_controls controls
      where controls.workspace_id = p_workspace_id
    ), false);
$$;

revoke all on function public.sourcing_loop_stage_enabled(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.sourcing_loop_stage_enabled(uuid, text) to service_role;

create or replace function public.read_inbound_email_for_loop(
  p_workspace_id uuid,
  p_inbound_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  ledger_campaign_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null or p_inbound_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select message.*
    into inbound
    from public.messages_inbound message
   where message.id = p_inbound_id
     and message.workspace_id = p_workspace_id
     and message.channel = 'Email';

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  select ledger.campaign_id
    into ledger_campaign_id
    from public.outreach_ledger ledger
   where ledger.id = inbound.correlated_ledger_id
     and ledger.workspace_id = inbound.workspace_id;

  return json_build_object(
    'status', 'ok',
    'inbound_id', inbound.id,
    'candidate_id', coalesce(inbound.candidate_id, ''),
    'campaign_id', coalesce(ledger_campaign_id, ''),
    'body', inbound.body,
    'received_at', inbound.received_at,
    'message_id', coalesce(inbound.provider_id, '')
  );
end;
$$;

revoke all on function public.read_inbound_email_for_loop(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.read_inbound_email_for_loop(uuid, uuid) to service_role;

create or replace function public.enqueue_aria_job(
  p_workspace_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb,
  p_run_at timestamptz default now(),
  p_priority integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing_row public.aria_jobs%rowtype;
  new_row public.aria_jobs%rowtype;
  violated_constraint text;
  payload_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_kind is null
     or p_kind not in (
       'email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create',
       'sourcing_batch', 'provider_poll', 'enrich_candidate', 'shortlist_build',
       'draft_generate', 'delivery_reconcile', 'outcome_feedback'
     )
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 8192
     or p_run_at is null
     or p_run_at > now() + interval '30 days'
     or p_priority is null
     or p_priority not between 0 and 1000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not public.sourcing_loop_stage_enabled(p_workspace_id, p_kind) then
    return jsonb_build_object('status', 'control_blocked');
  end if;

  payload_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

  select * into existing_row
    from public.aria_jobs
   where workspace_id = p_workspace_id
     and kind = p_kind
     and idempotency_key = p_idempotency_key
   for update;
  if found then
    if existing_row.payload_sha256 <> payload_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'enqueued',
      'id', existing_row.id,
      'job_status', existing_row.status,
      'replay', true
    );
  end if;

  begin
    insert into public.aria_jobs (
      workspace_id, kind, idempotency_key, payload, payload_sha256,
      next_run_at, priority
    ) values (
      p_workspace_id, p_kind, p_idempotency_key, p_payload, payload_hash,
      p_run_at, p_priority
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'aria_jobs_workspace_kind_idem_uniq' then
      select * into existing_row
        from public.aria_jobs
       where workspace_id = p_workspace_id
         and kind = p_kind
         and idempotency_key = p_idempotency_key
       for update;
      if existing_row.payload_sha256 <> payload_hash then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'enqueued',
        'id', existing_row.id,
        'job_status', existing_row.status,
        'replay', true
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'enqueued',
    'id', new_row.id,
    'job_status', new_row.status,
    'replay', false
  );
end;
$$;

create or replace function public.claim_due_aria_jobs(
  p_worker_id text,
  p_lease_seconds integer,
  p_kinds text[],
  p_limit integer
) returns setof public.aria_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600
     or p_kinds is null or array_length(p_kinds, 1) is null
     or p_limit is null or p_limit not between 1 and 50 then
    return;
  end if;

  return query
  update public.aria_jobs job
     set status = 'leased',
         lease_id = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         claimed_by = p_worker_id,
         attempt_count = job.attempt_count + 1,
         updated_at = now()
   where job.id in (
     select due.id
       from public.aria_jobs due
      where due.status = 'queued'
        and due.next_run_at <= now()
        and due.kind = any(p_kinds)
        and public.sourcing_loop_stage_enabled(due.workspace_id, due.kind)
      order by due.priority asc, due.next_run_at asc
      limit p_limit
        for update skip locked
   )
  returning job.*;
end;
$$;

alter function public.sourcing_loop_stage_enabled(uuid, text) owner to postgres;
alter function public.read_inbound_email_for_loop(uuid, uuid) owner to postgres;
alter function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) owner to postgres;
alter function public.claim_due_aria_jobs(text, integer, text[], integer) owner to postgres;

revoke all on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  to service_role;

revoke all on function public.claim_due_aria_jobs(text, integer, text[], integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_due_aria_jobs(text, integer, text[], integer)
  to service_role;
