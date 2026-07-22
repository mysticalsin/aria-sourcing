-- 0052_campaign_create_authority.sql
--
-- Plan 05: normalized campaign-create authority. Consumes one exact leased
-- `campaign_create` job, creates one tenant-bound normalized campaign from
-- immutable ready requisition evidence, finishes the job and enqueues one
-- `sourcing_batch` job -- all in one transaction. Reuses existing authority
-- (requisitions, requisition_parse_receipts, aria_jobs, loop_events,
-- sourcing_loop_controls, canonicalize_sourcing_role_basis, enqueue_aria_job)
-- exactly as proven by requisition_parse (0050/0051). It projects the complete
-- application campaign into workspace_state in the same transaction, without
-- turning missing role evidence into positive facts. It never calls a provider,
-- creates candidates or grants framework authority. This stage performs no external egress, so
-- unlike requisition_parse it needs no separate authorize/begin-egress split
-- or execution-claim fencing table: the single RPC below locks, validates,
-- writes and finishes in one atomic step.
--
-- Stop boundary: this migration stops at a durable `sourcing_batch` job. The
-- next slice must introduce an explicit admin-owned automation binding
-- selecting owner, AgentSpec and approved workflow version before
-- DeerFlow/Flowise can propose a query.

-- ---------------------------------------------------------------------------
-- sourcing_campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  activation_actor_id uuid not null,
  status text not null default 'sourcing'
    check (status in ('sourcing', 'paused', 'completed', 'cancelled')),
  sourcing_stop_reason text check (
    sourcing_stop_reason is null or sourcing_stop_reason in (
      'target_reached', 'provider_exhausted', 'batch_bound_reached'
    )
  ),
  sourcing_completed_at timestamptz,
  -- Bounded, derived only from parsed requisition analysis and
  -- canonicalized server-side via canonicalize_sourcing_role_basis. No
  -- hiring manager, estimated results, scoring weights, target date,
  -- provider, query or strategy: none of that is grounded at creation time.
  role_basis jsonb not null check (
    jsonb_typeof(role_basis) = 'object' and pg_column_size(role_basis) <= 8192
  ),
  parse_input_sha256 text not null check (parse_input_sha256 ~ '^[0-9a-f]{64}$'),
  parse_result_sha256 text not null check (parse_result_sha256 ~ '^[0-9a-f]{64}$'),
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, requisition_id),
  foreign key (workspace_id, requisition_id)
    references public.requisitions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, activation_actor_id)
    references public.profiles (workspace_id, id) on delete restrict,
  check (
    (status = 'completed' and sourcing_stop_reason is not null and sourcing_completed_at is not null)
    or (status <> 'completed' and sourcing_stop_reason is null and sourcing_completed_at is null)
  )
);

alter table public.sourcing_campaigns enable row level security;
alter table public.sourcing_campaigns force row level security;
revoke all on public.sourcing_campaigns
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_campaigns_postgres_all on public.sourcing_campaigns;
create policy sourcing_campaigns_postgres_all on public.sourcing_campaigns
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- campaign_create_receipts (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_create_receipts (
  job_id uuid primary key references public.aria_jobs(id) on delete cascade,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  campaign_id uuid not null,
  activation_actor_id uuid not null,
  campaign_sha256 text not null check (campaign_sha256 ~ '^[0-9a-f]{64}$'),
  sourcing_job_id uuid not null references public.aria_jobs(id) on delete restrict,
  completed_at timestamptz not null default now(),
  -- A blocking composite-unique index cannot safely be added to the existing
  -- hot aria_jobs table inside the deployment's single migration transaction.
  -- The insert trigger below enforces both job tenant and kind bindings.
  foreign key (workspace_id, requisition_id)
    references public.requisitions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, campaign_id)
    references public.sourcing_campaigns (workspace_id, id) on delete cascade,
  foreign key (workspace_id, activation_actor_id)
    references public.profiles (workspace_id, id) on delete restrict
);

alter table public.campaign_create_receipts enable row level security;
alter table public.campaign_create_receipts force row level security;
revoke all on public.campaign_create_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists campaign_create_receipts_postgres_all on public.campaign_create_receipts;
create policy campaign_create_receipts_postgres_all on public.campaign_create_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.validate_campaign_create_receipt_jobs()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.aria_jobs source_job
     where source_job.id = new.job_id
       and source_job.workspace_id = new.workspace_id
       and source_job.kind = 'campaign_create'
  ) or not exists (
    select 1 from public.aria_jobs sourcing_job
     where sourcing_job.id = new.sourcing_job_id
       and sourcing_job.workspace_id = new.workspace_id
       and sourcing_job.kind = 'sourcing_batch'
  ) then
    raise exception 'campaign create receipt job binding is invalid'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_campaign_create_receipt_jobs()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists campaign_create_receipts_validate_jobs on public.campaign_create_receipts;
create trigger campaign_create_receipts_validate_jobs
  before insert on public.campaign_create_receipts
  for each row execute function public.validate_campaign_create_receipt_jobs();

create or replace function public.reject_campaign_create_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'campaign create receipts are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_campaign_create_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists campaign_create_receipts_append_only on public.campaign_create_receipts;
create trigger campaign_create_receipts_append_only
  before update or delete on public.campaign_create_receipts
  for each row execute function public.reject_campaign_create_receipt_mutation();

-- ---------------------------------------------------------------------------
-- finalize_campaign_create_job -- the sole authority for this stage.
-- Service-only. Lock-then-clock discipline mirrors 0051's
-- finalize_requisition_parse exactly: lock the job row with FOR UPDATE
-- first, then read clock_timestamp() (never now()) to decide lease
-- liveness, so a lock-wait can never let a statement act on an
-- already-expired lease.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_campaign_create_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  requisition_row public.requisitions%rowtype;
  parse_receipt_row public.requisition_parse_receipts%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  receipt_row public.campaign_create_receipts%rowtype;
  activation_profile_row public.profiles%rowtype;
  workspace_row public.workspace_state%rowtype;
  raw_basis jsonb;
  canonical_basis jsonb;
  projected_job_analysis jsonb;
  projected_company_stages jsonb;
  projected_campaign jsonb;
  merged_campaigns jsonb;
  campaign_hash text;
  enqueue_result jsonb;
  sourcing_job_id uuid;
  updated integer;
  new_campaign_id uuid;
  optional_field text;
  optional_value text;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null or p_requisition_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'campaign_create' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.payload <> jsonb_build_object('requisition_id', p_requisition_id::text)
     or job_row.payload_sha256 <> encode(sha256(convert_to(
       jsonb_build_object('requisition_id', p_requisition_id::text)::text,
       'UTF8'
     )), 'hex') then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;
  if job_row.status not in ('leased', 'succeeded') then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  wall_now := clock_timestamp();
  if job_row.status = 'leased' then
    if job_row.lease_id <> p_lease_id then
      return jsonb_build_object('status', 'lease_mismatch');
    end if;
    if job_row.lease_expires_at is null or job_row.lease_expires_at <= wall_now then
      return jsonb_build_object('status', 'lease_expired');
    end if;
  end if;

  -- Lost-response retry: only the exact completed lease and exact immutable
  -- receipt may replay successfully. Every binding the receipt claims --
  -- the job's own stored result hash, the campaign row it names, and the
  -- sourcing_batch job it enqueued -- must independently still hold.
  -- Anything less exact is a conflict, never a silent success.
  if job_row.status = 'succeeded' then
    select * into receipt_row from public.campaign_create_receipts where job_id = p_job_id;
    if found
       and receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.requisition_id = p_requisition_id
       and job_row.result_sha256 = receipt_row.campaign_sha256
       and exists (
         select 1
           from public.sourcing_campaigns c
           join public.requisitions r
             on r.workspace_id = c.workspace_id
            and r.id = c.requisition_id
           join public.requisition_parse_receipts pr
             on pr.workspace_id = r.workspace_id
            and pr.requisition_id = r.id
          where c.id = receipt_row.campaign_id
            and c.workspace_id = receipt_row.workspace_id
            and c.requisition_id = receipt_row.requisition_id
            and c.activation_actor_id = receipt_row.activation_actor_id
            and c.campaign_sha256 = receipt_row.campaign_sha256
            and r.status = 'campaign_created'
            and r.campaign_id = c.id::text
            and r.parsed_job_analysis is not null
            and r.parse_input_sha256 = c.parse_input_sha256
            and r.parse_result_sha256 = c.parse_result_sha256
            and pr.ready
            and pr.input_sha256 = c.parse_input_sha256
            and pr.result_sha256 = c.parse_result_sha256
            and r.parse_result_sha256 = encode(sha256(convert_to(
              jsonb_build_object(
                'job_analysis', r.parsed_job_analysis,
                'warnings', r.parse_warnings
              )::text,
              'UTF8'
            )), 'hex')
            and c.campaign_sha256 = encode(sha256(convert_to(
              jsonb_build_object(
                'campaign_id', c.id::text,
                'workspace_id', c.workspace_id::text,
                'requisition_id', c.requisition_id::text,
                'activation_actor_id', c.activation_actor_id::text,
                'role_basis', c.role_basis,
                'parse_input_sha256', c.parse_input_sha256,
                'parse_result_sha256', c.parse_result_sha256
              )::text,
              'UTF8'
            )), 'hex')
       )
       and exists (
         select 1 from public.aria_jobs sj
          where sj.id = receipt_row.sourcing_job_id
            and sj.workspace_id = receipt_row.workspace_id
            and sj.kind = 'sourcing_batch'
            and sj.idempotency_key = 'sourcing_batch:' || receipt_row.campaign_id::text || ':000000'
            and sj.payload = jsonb_build_object(
              'campaign_id', receipt_row.campaign_id::text,
              'campaign_sha256', receipt_row.campaign_sha256,
              'batch_ordinal', 0
            )
            and sj.payload_sha256 = encode(sha256(convert_to(
              jsonb_build_object(
                'campaign_id', receipt_row.campaign_id::text,
                'campaign_sha256', receipt_row.campaign_sha256,
                'batch_ordinal', 0
              )::text,
              'UTF8'
            )), 'hex')
       )
       and exists (
         select 1
           from public.workspace_state workspace
           cross join lateral jsonb_array_elements(
             case when jsonb_typeof(workspace.state -> 'campaigns') = 'array'
               then workspace.state -> 'campaigns' else '[]'::jsonb end
           ) projected(value)
          where workspace.workspace_id = receipt_row.workspace_id
            and projected.value ->> 'id' = receipt_row.campaign_id::text
       )
    then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'job_id', p_job_id,
        'campaign_id', receipt_row.campaign_id,
        'campaign_sha256', receipt_row.campaign_sha256,
        'sourcing_job_id', receipt_row.sourcing_job_id
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  select * into requisition_row
    from public.requisitions
   where id = p_requisition_id
     and workspace_id = p_workspace_id
     for update;
  if not found
     or requisition_row.status <> 'ready'
     or requisition_row.campaign_id is not null
     or requisition_row.parsed_job_analysis is null
     or requisition_row.parse_input_sha256 is null
     or requisition_row.parse_result_sha256 is null then
    return jsonb_build_object('status', 'requisition_not_ready');
  end if;

  select * into parse_receipt_row
    from public.requisition_parse_receipts
   where requisition_id = p_requisition_id
     and workspace_id = p_workspace_id;
  if not found
     or not parse_receipt_row.ready
     or parse_receipt_row.input_sha256 <> requisition_row.parse_input_sha256
     or parse_receipt_row.result_sha256 <> requisition_row.parse_result_sha256
     or requisition_row.parse_result_sha256 <> encode(sha256(convert_to(
       jsonb_build_object(
         'job_analysis', requisition_row.parsed_job_analysis,
         'warnings', requisition_row.parse_warnings
       )::text,
       'UTF8'
     )), 'hex') then
    return jsonb_build_object('status', 'parse_receipt_mismatch');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
     for share;
  if not found
     or control_row.kill_switch
     or not control_row.sourcing_enabled
     or control_row.max_sourcing_runs_per_day <= 0
     or control_row.updated_by is null then
    return jsonb_build_object('status', 'sourcing_disabled');
  end if;

  -- Revalidate that the admin who last enabled automation is still an
  -- admin of this exact workspace at execution time, never at enable time.
  -- FOR SHARE prevents a concurrent role demotion or profile deletion from
  -- committing between this authority check and the campaign transaction.
  select * into activation_profile_row
    from public.profiles activation_profile
   where activation_profile.workspace_id = p_workspace_id
     and activation_profile.id = control_row.updated_by
   for share;
  if not found or activation_profile_row.role <> 'admin' then
    return jsonb_build_object('status', 'activation_actor_invalid');
  end if;

  -- Reject malformed legacy evidence before ->> can coerce numbers, objects,
  -- arrays or booleans into apparently grounded strings.
  if jsonb_typeof(requisition_row.parsed_job_analysis) <> 'object'
     or jsonb_typeof(requisition_row.parsed_job_analysis -> 'title') <> 'string'
     or jsonb_typeof(requisition_row.parsed_job_analysis -> 'requiredSkills') <> 'array'
     or exists (
       select 1
         from jsonb_array_elements(requisition_row.parsed_job_analysis -> 'requiredSkills') skill(value)
        where jsonb_typeof(skill.value) <> 'string'
     ) then
    return jsonb_build_object('status', 'invalid_role_basis');
  end if;
  foreach optional_field in array array['seniority', 'employmentType', 'locationType', 'timezone']
  loop
    if requisition_row.parsed_job_analysis ? optional_field
       and jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) not in ('string', 'null') then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
  end loop;

  -- Derived only from the parsed, grounded job analysis -- never a
  -- caller-supplied basis. JobAnalysisSchema stores `regions` as a plural
  -- array with no designated primary; there is no grounded way to collapse
  -- it to canonicalize_sourcing_role_basis's single optional "region"
  -- string, so `region` is omitted entirely rather than invented from
  -- regions[0]. title and skills are required and always included as-is.
  -- Every other optional scalar is included only when the parser actually
  -- grounded it: a null, empty (after trim), or literal "Unspecified"
  -- (case-insensitive) value is the parser's own absence marker and must
  -- never be promoted into a campaign fact.
  raw_basis := jsonb_build_object(
    'title', requisition_row.parsed_job_analysis ->> 'title',
    'skills', coalesce(requisition_row.parsed_job_analysis -> 'requiredSkills', '[]'::jsonb)
  );
  foreach optional_field in array array['seniority', 'employmentType', 'locationType', 'timezone']
  loop
    optional_value := requisition_row.parsed_job_analysis ->> optional_field;
    if optional_value is not null
       and length(btrim(optional_value)) > 0
       and lower(btrim(optional_value)) <> 'unspecified' then
      raw_basis := raw_basis || jsonb_build_object(optional_field, btrim(optional_value));
    end if;
  end loop;
  begin
    canonical_basis := public.canonicalize_sourcing_role_basis(raw_basis);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid_role_basis');
  end;
  if canonical_basis is null or pg_column_size(canonical_basis) > 8192 then
    return jsonb_build_object('status', 'invalid_role_basis');
  end if;

  -- Merge against the newest application document under a row lock. This
  -- preserves every unrelated concurrent field while making the relational
  -- campaign and its UI projection one transaction.
  select * into workspace_row
    from public.workspace_state workspace
   where workspace.workspace_id = p_workspace_id
   for update;
  if not found
     or jsonb_typeof(workspace_row.state) <> 'object'
     or (workspace_row.state ? 'campaigns'
       and jsonb_typeof(workspace_row.state -> 'campaigns') <> 'array') then
    return jsonb_build_object('status', 'workspace_unavailable');
  end if;

  -- Invalid legacy shapes fail closed rather than reaching table, search or
  -- drawer code with an incompatible value.
  foreach optional_field in array array[
    'regions', 'niceToHaveSkills', 'industryExperience', 'companyStageTarget'
  ]
  loop
    if requisition_row.parsed_job_analysis ? optional_field
       and jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) not in ('array', 'null') then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
    if jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) = 'array'
       and exists (
         select 1
           from jsonb_array_elements(requisition_row.parsed_job_analysis -> optional_field) item(value)
          where jsonb_typeof(item.value) <> 'string'
       ) then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
  end loop;
  foreach optional_field in array array[
    'department', 'location', 'currency', 'education', 'teamSize',
    'reportingTo', 'urgency', 'language', 'expectedStartDate'
  ]
  loop
    if requisition_row.parsed_job_analysis ? optional_field
       and jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) not in ('string', 'null') then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
  end loop;
  foreach optional_field in array array[
    'salaryMin', 'salaryMax', 'minYearsExperience', 'maxYearsExperience'
  ]
  loop
    if requisition_row.parsed_job_analysis ? optional_field
       and jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) not in ('number', 'null') then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
  end loop;
  if requisition_row.parsed_job_analysis ? 'equity'
     and jsonb_typeof(requisition_row.parsed_job_analysis -> 'equity') not in ('boolean', 'null') then
    return jsonb_build_object('status', 'invalid_role_basis');
  end if;
  foreach optional_field in array array['equityKnown', 'urgencyKnown']
  loop
    if requisition_row.parsed_job_analysis ? optional_field
       and jsonb_typeof(requisition_row.parsed_job_analysis -> optional_field) not in ('boolean', 'null') then
      return jsonb_build_object('status', 'invalid_role_basis');
    end if;
  end loop;

  select coalesce(jsonb_agg(stage.value order by stage.ordinality), '[]'::jsonb)
    into projected_company_stages
    from jsonb_array_elements(
      case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'companyStageTarget') = 'array'
        then requisition_row.parsed_job_analysis -> 'companyStageTarget' else '[]'::jsonb end
    ) with ordinality stage(value, ordinality)
   where stage.value #>> '{}' = any(array[
     'Seed', 'Series A', 'Series B', 'Series C+', 'Public', 'Enterprise'
   ]);

  projected_job_analysis := jsonb_build_object(
    'title', btrim(requisition_row.parsed_job_analysis ->> 'title'),
    'department', coalesce(requisition_row.parsed_job_analysis ->> 'department', ''),
    'seniority', case lower(btrim(coalesce(requisition_row.parsed_job_analysis ->> 'seniority', '')))
      when 'junior' then 'Junior' when 'mid' then 'Mid' when 'senior' then 'Senior'
      when 'staff' then 'Staff' when 'principal' then 'Principal' when 'lead' then 'Lead'
      when 'director' then 'Director' else 'Unspecified' end,
    'employmentType', case lower(btrim(coalesce(requisition_row.parsed_job_analysis ->> 'employmentType', '')))
      when 'full-time' then 'Full-time' when 'contract' then 'Contract'
      when 'part-time' then 'Part-time' else 'Unspecified' end,
    'locationType', case lower(btrim(coalesce(requisition_row.parsed_job_analysis ->> 'locationType', '')))
      when 'remote' then 'Remote' when 'hybrid' then 'Hybrid'
      when 'on-site' then 'On-site' else 'Unspecified' end,
    'location', coalesce(requisition_row.parsed_job_analysis ->> 'location', ''),
    'regions', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'regions') = 'array'
      then requisition_row.parsed_job_analysis -> 'regions' else '[]'::jsonb end,
    'timezone', coalesce(requisition_row.parsed_job_analysis ->> 'timezone', ''),
    'salaryMin', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'salaryMin') = 'number'
      then requisition_row.parsed_job_analysis -> 'salaryMin' else 'null'::jsonb end,
    'salaryMax', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'salaryMax') = 'number'
      then requisition_row.parsed_job_analysis -> 'salaryMax' else 'null'::jsonb end,
    'currency', coalesce(requisition_row.parsed_job_analysis ->> 'currency', ''),
    'equity', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'equity') = 'boolean'
      then (requisition_row.parsed_job_analysis ->> 'equity')::boolean else false end,
    'equityKnown', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'equityKnown') = 'boolean'
      then (requisition_row.parsed_job_analysis ->> 'equityKnown')::boolean else false end,
    'requiredSkills', requisition_row.parsed_job_analysis -> 'requiredSkills',
    'niceToHaveSkills', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'niceToHaveSkills') = 'array'
      then requisition_row.parsed_job_analysis -> 'niceToHaveSkills' else '[]'::jsonb end,
    'minYearsExperience', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'minYearsExperience') = 'number'
      then requisition_row.parsed_job_analysis -> 'minYearsExperience' else 'null'::jsonb end,
    'maxYearsExperience', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'maxYearsExperience') = 'number'
      then requisition_row.parsed_job_analysis -> 'maxYearsExperience' else 'null'::jsonb end,
    'education', coalesce(requisition_row.parsed_job_analysis ->> 'education', ''),
    'industryExperience', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'industryExperience') = 'array'
      then requisition_row.parsed_job_analysis -> 'industryExperience' else '[]'::jsonb end,
    'companyStageTarget', projected_company_stages,
    'teamSize', coalesce(requisition_row.parsed_job_analysis ->> 'teamSize', ''),
    'reportingTo', coalesce(requisition_row.parsed_job_analysis ->> 'reportingTo', ''),
    'urgency', case lower(btrim(coalesce(requisition_row.parsed_job_analysis ->> 'urgency', '')))
      when 'asap' then 'ASAP' when 'critical' then 'Critical' when 'urgent' then 'Urgent'
      when 'this week' then 'This Week' else 'Standard' end,
    'urgencyKnown', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'urgencyKnown') = 'boolean'
      then (requisition_row.parsed_job_analysis ->> 'urgencyKnown')::boolean else false end,
    'language', coalesce(requisition_row.parsed_job_analysis ->> 'language', ''),
    'expectedStartDate', case when jsonb_typeof(requisition_row.parsed_job_analysis -> 'expectedStartDate') = 'string'
      then requisition_row.parsed_job_analysis -> 'expectedStartDate' else 'null'::jsonb end,
    'validationWarnings', case when jsonb_typeof(requisition_row.parse_warnings) = 'array'
      then requisition_row.parse_warnings else '[]'::jsonb end
  );

  new_campaign_id := gen_random_uuid();
  projected_campaign := jsonb_build_object(
    'id', new_campaign_id::text,
    'title', projected_job_analysis ->> 'title',
    'department', projected_job_analysis ->> 'department',
    'urgency', projected_job_analysis ->> 'urgency',
    'status', 'Sourcing',
    'hiringManager', '',
    'hiringManagerEmail', '',
    'createdAt', to_char(wall_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'targetStartDate', coalesce(projected_job_analysis ->> 'expectedStartDate', ''),
    'jobAnalysis', projected_job_analysis,
    'sourcingStrategy', jsonb_build_object(
      'primaryPlatforms', jsonb_build_array('GitHub'),
      'secondaryPlatforms', '[]'::jsonb,
      'githubQueries', '[]'::jsonb,
      'linkedinBoolean', '',
      'stackOverflowTags', '[]'::jsonb,
      'geoTargets', projected_job_analysis -> 'regions',
      'excludedCompanies', '[]'::jsonb,
      'targetCompanyStages', projected_job_analysis -> 'companyStageTarget'
    ),
    'scoringWeights', jsonb_build_object(
      'skills', 0, 'experience', 0, 'companyStage', 0,
      'industry', 0, 'location', 0, 'activity', 0
    ),
    'metrics', jsonb_build_object(
      'sourced', 0, 'contacted', 0, 'replied', 0, 'interested', 0,
      'booked', 0, 'interviewed', 0, 'offer', 0, 'hired', 0,
      'notInterested', 0, 'replyRate', 0, 'avgMatchScore', 0,
      'timeToFirstInterviewHours', null, 'emailsSentToday', 0,
      'linkedinSentToday', 0
    ),
    'skillUpdates', '[]'::jsonb,
    'activities', '[]'::jsonb
  );
  merged_campaigns := coalesce(workspace_row.state -> 'campaigns', '[]'::jsonb)
    || jsonb_build_array(projected_campaign);
  -- The hash commits to every field that determines this campaign's
  -- identity: replaying a lost response with a different requisition,
  -- actor, basis or parse evidence can never be mistaken for completion.
  campaign_hash := encode(sha256(convert_to(
    jsonb_build_object(
      'campaign_id', new_campaign_id::text,
      'workspace_id', p_workspace_id::text,
      'requisition_id', p_requisition_id::text,
      'activation_actor_id', control_row.updated_by::text,
      'role_basis', canonical_basis,
      'parse_input_sha256', requisition_row.parse_input_sha256,
      'parse_result_sha256', requisition_row.parse_result_sha256
    )::text,
    'UTF8'
  )), 'hex');

  insert into public.sourcing_campaigns (
    id, workspace_id, requisition_id, activation_actor_id, status,
    role_basis, parse_input_sha256, parse_result_sha256, campaign_sha256
  ) values (
    new_campaign_id, p_workspace_id, p_requisition_id, control_row.updated_by, 'sourcing',
    canonical_basis, requisition_row.parse_input_sha256, requisition_row.parse_result_sha256, campaign_hash
  );

  update public.workspace_state
     set state = jsonb_set(workspace_row.state, '{campaigns}', merged_campaigns, true)
   where workspace_id = p_workspace_id;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'campaign document projection lost mid-commit' using errcode = '40001';
  end if;

  -- The campaign row is already written at this point: every failure from
  -- here on must raise (never return) so the whole transaction -- campaign
  -- insert included -- rolls back together. A plain RETURN here would leave
  -- an orphaned campaign committed with no requisition/job/receipt to match
  -- it, so a lost-race requisition update is a hard error, not a status.
  update public.requisitions
     set status = 'campaign_created',
         campaign_id = new_campaign_id::text,
         updated_at = now()
   where id = p_requisition_id
     and workspace_id = p_workspace_id
     and status = 'ready'
     and campaign_id is null;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'campaign create requisition transition lost mid-commit' using errcode = 'P0001';
  end if;

  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = campaign_hash,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > clock_timestamp();
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'campaign create job lease lost mid-commit' using errcode = 'P0001';
  end if;

  enqueue_result := public.enqueue_aria_job(
    p_workspace_id,
    'sourcing_batch',
    'sourcing_batch:' || new_campaign_id::text || ':000000',
    jsonb_build_object(
      'campaign_id', new_campaign_id::text,
      'campaign_sha256', campaign_hash,
      'batch_ordinal', 0
    ),
    now(),
    100
  );
  if enqueue_result ->> 'status' <> 'enqueued' then
    raise exception 'sourcing_batch enqueue failed: %', enqueue_result ->> 'status'
      using errcode = '22023';
  end if;
  sourcing_job_id := (enqueue_result ->> 'id')::uuid;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    p_workspace_id, 'campaign.created', 'sourcing_campaign', new_campaign_id::text, p_job_id,
    jsonb_build_object('requisition_id', p_requisition_id::text)
  );

  insert into public.campaign_create_receipts (
    job_id, lease_id, workspace_id, requisition_id, campaign_id,
    activation_actor_id, campaign_sha256, sourcing_job_id
  ) values (
    p_job_id, p_lease_id, p_workspace_id, p_requisition_id, new_campaign_id,
    control_row.updated_by, campaign_hash, sourcing_job_id
  );

  return jsonb_build_object(
    'status', 'completed',
    'job_id', p_job_id,
    'campaign_id', new_campaign_id,
    'campaign_sha256', campaign_hash,
    'sourcing_job_id', sourcing_job_id
  );
end;
$$;

alter function public.finalize_campaign_create_job(uuid, uuid, uuid, uuid) owner to postgres;

revoke all on function public.finalize_campaign_create_job(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.finalize_campaign_create_job(uuid, uuid, uuid, uuid)
  to service_role;

-- The old unfenced one-shot mutation is superseded by
-- finalize_campaign_create_job above. Its definition stays for migration
-- history; its execute grant is revoked so it can no longer be called.
revoke execute on function public.record_requisition_campaign(uuid, text)
  from service_role;
