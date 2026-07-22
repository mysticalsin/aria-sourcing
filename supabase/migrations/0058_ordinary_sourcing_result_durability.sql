-- 0058_ordinary_sourcing_result_durability.sql
--
-- Durable, replay-safe result handoff for ordinary authenticated sourcing.
-- Provider execution finishes only when its exact bounded result is staged.
-- The browser acknowledges that result only after every candidate is present
-- in authoritative workspace state. Candidate payloads are scrubbed on
-- acknowledgement, expiry, and candidate erasure.

create table if not exists public.sourcing_run_results (
  run_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  campaign_hmac text not null check (campaign_hmac ~ '^[0-9a-f]{64}$'),
  campaign_fingerprint text not null check (campaign_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null,
  requested_count integer not null check (requested_count between 1 and 8),
  status text not null default 'claimed'
    check (status in ('claimed', 'ready', 'completed', 'failed', 'expired')),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  result_payload jsonb check (
    result_payload is null
    or (jsonb_typeof(result_payload) = 'object' and octet_length(result_payload::text) <= 524288)
  ),
  claimed_at timestamptz not null default now(),
  ready_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  foreign key (workspace_id, actor_id)
    references public.profiles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, run_id)
    references public.sourcing_runs(workspace_id, id) on delete cascade,
  unique (workspace_id, actor_id, idempotency_key),
  constraint sourcing_run_results_state_check check (
    (status = 'claimed' and result_sha256 is null and result_payload is null
      and ready_at is null and completed_at is null and failed_at is null and expired_at is null)
    or (status = 'ready' and result_sha256 is not null and result_payload is not null
      and ready_at is not null and completed_at is null and failed_at is null and expired_at is null)
    or (status = 'completed' and result_sha256 is not null and result_payload is null
      and ready_at is not null and completed_at is not null and failed_at is null and expired_at is null)
    or (status = 'failed' and result_payload is null
      and completed_at is null and failed_at is not null and expired_at is null)
    or (status = 'expired' and result_payload is null
      and completed_at is null and failed_at is null and expired_at is not null)
  )
);

create unique index if not exists sourcing_run_results_one_open_campaign_idx
  on public.sourcing_run_results(workspace_id, actor_id, campaign_hmac)
  where status in ('claimed', 'ready');
create index if not exists sourcing_run_results_cleanup_idx
  on public.sourcing_run_results(workspace_id, expires_at, run_id)
  where status in ('claimed', 'ready');

alter table public.sourcing_run_results enable row level security;
alter table public.sourcing_run_results force row level security;
revoke all on public.sourcing_run_results
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_run_results_postgres_all on public.sourcing_run_results;
create policy sourcing_run_results_postgres_all on public.sourcing_run_results
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.validate_ordinary_sourcing_candidates(
  p_workspace_id uuid,
  p_campaign_id text,
  p_candidates jsonb,
  p_count integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  candidate jsonb;
  identity_lock_key bigint;
begin
  if p_workspace_id is null or p_campaign_id is null
     or p_candidates is null or jsonb_typeof(p_candidates) <> 'array'
     or p_count not between 1 and 8
     or jsonb_array_length(p_candidates) > p_count then
    return false;
  end if;

  if (
    select count(*) <> count(distinct value->>'id')
        or count(*) <> count(distinct lower(coalesce(
          nullif(value->>'linkedinUrl', ''),
          nullif(value->>'githubUrl', ''),
          nullif(value->>'sourceUrl', ''),
          value->>'id'
        )))
    from jsonb_array_elements(p_candidates)
  ) then
    return false;
  end if;

  for candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(candidate) <> 'object'
       or not (candidate ?& array[
         'id','campaignId','name','currentTitle','currentCompany','location',
         'linkedinUrl','githubUrl','sourcePlatform','sourceQuery','matchScore',
         'matchBreakdown','techStack','recentActivity','createdAt'
       ])
       or candidate - array[
         'id','campaignId','name','currentTitle','currentCompany','location',
         'linkedinUrl','githubUrl','sourceUrl','sourcePlatform','sourceQuery',
         'matchScore','matchBreakdown','techStack','recentActivity','createdAt',
         'draftSubject','draftBody'
       ] <> '{}'::jsonb
       or jsonb_typeof(candidate->'id') <> 'string'
       or char_length(candidate->>'id') not between 1 and 100
       or jsonb_typeof(candidate->'campaignId') <> 'string'
       or candidate->>'campaignId' <> p_campaign_id
       or jsonb_typeof(candidate->'name') <> 'string'
       or char_length(candidate->>'name') not between 1 and 200
       or jsonb_typeof(candidate->'currentTitle') <> 'string'
       or char_length(candidate->>'currentTitle') > 200
       or jsonb_typeof(candidate->'currentCompany') <> 'string'
       or char_length(candidate->>'currentCompany') > 200
       or jsonb_typeof(candidate->'location') <> 'string'
       or char_length(candidate->>'location') > 200
       or jsonb_typeof(candidate->'linkedinUrl') <> 'string'
       or char_length(candidate->>'linkedinUrl') > 2048
       or (candidate->>'linkedinUrl' <> '' and candidate->>'linkedinUrl' !~ '^https://')
       or jsonb_typeof(candidate->'githubUrl') <> 'string'
       or char_length(candidate->>'githubUrl') > 2048
       or (candidate->>'githubUrl' <> '' and candidate->>'githubUrl' !~ '^https://')
       or ((candidate ? 'sourceUrl') and (
         jsonb_typeof(candidate->'sourceUrl') <> 'string'
         or char_length(candidate->>'sourceUrl') > 2048
         or (candidate->>'sourceUrl' <> '' and candidate->>'sourceUrl' !~ '^https://')
       ))
       or candidate->>'sourcePlatform' not in ('GitHub','LinkedIn','Stack Overflow','Dribbble','Behance')
       or (candidate->>'sourcePlatform' = 'GitHub' and candidate->>'githubUrl' = '')
       or jsonb_typeof(candidate->'sourceQuery') <> 'string'
       or char_length(candidate->>'sourceQuery') not between 3 and 500
       or jsonb_typeof(candidate->'matchScore') <> 'number'
       or candidate->>'matchScore' !~ '^[0-9]+([.][0-9]+)?$'
       or (candidate->>'matchScore')::numeric not between 0 and 100
       or jsonb_typeof(candidate->'matchBreakdown') <> 'array'
       or jsonb_array_length(candidate->'matchBreakdown') > 6
       or exists (
         select 1 from jsonb_array_elements(candidate->'matchBreakdown') part(value)
         where jsonb_typeof(part.value) <> 'object'
            or not (part.value ?& array[
              'key','label','score','weight','contribution','rationale'
            ])
            or part.value - array[
              'key','label','score','weight','contribution','rationale'
            ] <> '{}'::jsonb
            or part.value->>'key' not in (
              'skills','experience','companyStage','industry','location','activity'
            )
            or jsonb_typeof(part.value->'label') <> 'string'
            or char_length(part.value->>'label') > 100
            or jsonb_typeof(part.value->'score') <> 'number'
            or part.value->>'score' !~ '^[0-9]+([.][0-9]+)?$'
            or (part.value->>'score')::numeric not between 0 and 100
            or jsonb_typeof(part.value->'weight') <> 'number'
            or part.value->>'weight' !~ '^[0-9]+([.][0-9]+)?$'
            or (part.value->>'weight')::numeric not between 0 and 1
            or jsonb_typeof(part.value->'contribution') <> 'number'
            or part.value->>'contribution' !~ '^[0-9]+([.][0-9]+)?$'
            or (part.value->>'contribution')::numeric not between 0 and 100
            or jsonb_typeof(part.value->'rationale') <> 'string'
            or char_length(part.value->>'rationale') > 1000
       )
       or jsonb_typeof(candidate->'techStack') <> 'array'
       or jsonb_array_length(candidate->'techStack') > 100
       or exists (
         select 1 from jsonb_array_elements(candidate->'techStack') skill(value)
         where jsonb_typeof(skill.value) <> 'string'
            or char_length(skill.value #>> '{}') > 100
       )
       or jsonb_typeof(candidate->'recentActivity') <> 'string'
       or char_length(candidate->>'recentActivity') > 1000
       or jsonb_typeof(candidate->'createdAt') <> 'string'
       or char_length(candidate->>'createdAt') not between 20 and 100
       or candidate->>'createdAt' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
       or ((candidate ? 'draftSubject') <> (candidate ? 'draftBody'))
       or ((candidate ? 'draftSubject') and (
         jsonb_typeof(candidate->'draftSubject') <> 'string'
         or char_length(candidate->>'draftSubject') not between 1 and 255
         or jsonb_typeof(candidate->'draftBody') <> 'string'
         or char_length(candidate->>'draftBody') not between 1 and 5000
       )) then
      return false;
    end if;
  end loop;

  for identity_lock_key in
    select distinct identity.lock_key
    from (
      select public.candidate_erasure_identity_lock_key(
        p_workspace_id,
        identifier.kind,
        identifier.value
      ) as lock_key
      from jsonb_array_elements(p_candidates) item(value)
      cross join lateral (values
        ('candidate_id', item.value->>'id'),
        ('linkedin', item.value->>'linkedinUrl'),
        ('github', item.value->>'githubUrl'),
        ('source_url', item.value->>'sourceUrl')
      ) identifier(kind, value)
      where coalesce(btrim(identifier.value), '') <> ''
    ) identity
    where identity.lock_key is not null
    order by identity.lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;

  for candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'candidate_id', candidate->>'id'
       )
       or (candidate->>'linkedinUrl' <> '' and public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'linkedin', candidate->>'linkedinUrl'
       ))
       or (candidate->>'githubUrl' <> '' and public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'github', candidate->>'githubUrl'
       ))
       or (coalesce(candidate->>'sourceUrl', '') <> '' and public.candidate_erasure_tombstone_exists(
         p_workspace_id, 'source_url', candidate->>'sourceUrl'
       )) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.validate_ordinary_sourcing_candidates(uuid,text,jsonb,integer)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.resume_ordinary_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_campaign_fingerprint text,
  p_count integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  staged public.sourcing_run_results%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
     or p_campaign_fingerprint is null
     or p_campaign_fingerprint !~ '^[0-9a-f]{64}$'
     or p_count not between 1 and 8 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
   where workspace_id = p_workspace_id and id = p_actor_id
     and role in ('admin','member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'ordinary-sourcing', p_workspace_id::text, p_actor_id::text, p_campaign_id
  ), 0));
  select * into staged
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.campaign_id = p_campaign_id
     and result.status in ('claimed','ready')
   for update;
  if not found then return jsonb_build_object('status', 'no_pending'); end if;
  if staged.expires_at <= now() then
    update public.sourcing_run_results
       set status = 'expired', result_payload = null,
           expired_at = now(), expires_at = now()
     where run_id = staged.run_id;
    return jsonb_build_object('status', 'result_expired');
  end if;
  if staged.campaign_fingerprint is distinct from p_campaign_fingerprint then
    return jsonb_build_object('status', 'pending_conflict');
  end if;
  if staged.status = 'claimed' then
    return jsonb_build_object('status', 'in_progress', 'run_id', staged.run_id);
  end if;
  return jsonb_build_object(
    'status', 'result_ready', 'run_id', staged.run_id,
    'requested_count', staged.requested_count,
    'result_sha256', staged.result_sha256,
    'result_payload', staged.result_payload
  );
end;
$$;

create or replace function public.begin_ordinary_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_role_basis jsonb,
  p_configuration_fingerprint text,
  p_mode text,
  p_provider text,
  p_model text,
  p_idempotency_key uuid,
  p_request_id text,
  p_count integer,
  p_campaign_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  exact_result public.sourcing_run_results%rowtype;
  open_result public.sourcing_run_results%rowtype;
  begun jsonb;
  begun_run_id uuid;
  campaign_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_idempotency_key is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
     or p_campaign_fingerprint is null
     or p_campaign_fingerprint !~ '^[0-9a-f]{64}$'
     or p_count not between 1 and 8 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
   where workspace_id = p_workspace_id and id = p_actor_id
     and role in ('admin','member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'ordinary-sourcing', p_workspace_id::text, p_actor_id::text, p_campaign_id
  ), 0));
  select * into exact_result
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.idempotency_key = p_idempotency_key
   for update;
  if found then
    if exact_result.campaign_id is distinct from p_campaign_id
       or exact_result.campaign_fingerprint is distinct from p_campaign_fingerprint
       or exact_result.requested_count is distinct from p_count then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    if exact_result.status = 'ready' and exact_result.expires_at > now() then
      return jsonb_build_object(
        'status', 'result_ready', 'run_id', exact_result.run_id,
        'requested_count', exact_result.requested_count,
        'result_sha256', exact_result.result_sha256,
        'result_payload', exact_result.result_payload
      );
    end if;
    if exact_result.status = 'claimed' and exact_result.expires_at > now() then
      return jsonb_build_object('status', 'in_progress', 'run_id', exact_result.run_id);
    end if;
    if exact_result.status in ('completed','failed') then
      return jsonb_build_object('status', 'already_consumed');
    end if;
    update public.sourcing_run_results
       set status = 'expired', result_payload = null,
           expired_at = coalesce(expired_at, now()), expires_at = now()
     where run_id = exact_result.run_id and status in ('claimed','ready');
    return jsonb_build_object('status', 'result_expired');
  end if;

  select * into open_result
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.campaign_id = p_campaign_id
     and result.status in ('claimed','ready')
   for update;
  if found then
    if open_result.expires_at <= now() then
      update public.sourcing_run_results
         set status = 'expired', result_payload = null,
             expired_at = now(), expires_at = now()
       where run_id = open_result.run_id;
      return jsonb_build_object('status', 'result_expired');
    end if;
    if open_result.campaign_fingerprint is distinct from p_campaign_fingerprint
       or open_result.requested_count is distinct from p_count then
      return jsonb_build_object('status', 'pending_conflict');
    end if;
    if open_result.status = 'ready' then
      return jsonb_build_object(
        'status', 'result_ready', 'run_id', open_result.run_id,
        'requested_count', open_result.requested_count,
        'result_sha256', open_result.result_sha256,
        'result_payload', open_result.result_payload
      );
    end if;
    return jsonb_build_object('status', 'in_progress', 'run_id', open_result.run_id);
  end if;

  begun := public.begin_sourcing_run(
    p_workspace_id, p_actor_id, p_campaign_id, p_role_basis,
    p_configuration_fingerprint, p_mode, p_provider, p_model,
    p_idempotency_key, p_request_id
  );
  if begun->>'status' <> 'claimed' then return begun; end if;
  begin
    begun_run_id := (begun->>'run_id')::uuid;
  exception when others then
    raise exception 'invalid sourcing claim receipt' using errcode = '55000';
  end;
  campaign_hash := public.sourcing_authority_hmac(
    p_workspace_id, 'campaign:' || p_campaign_id
  );
  insert into public.sourcing_run_results(
    run_id, workspace_id, actor_id, campaign_id, campaign_hmac,
    campaign_fingerprint, idempotency_key, requested_count
  ) values (
    begun_run_id, p_workspace_id, p_actor_id, p_campaign_id, campaign_hash,
    p_campaign_fingerprint, p_idempotency_key, p_count
  );
  return begun;
end;
$$;

create or replace function public.complete_ordinary_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_query_receipts jsonb,
  p_result_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  staged public.sourcing_run_results%rowtype;
  sourcing public.sourcing_runs%rowtype;
  completion jsonb;
  final_payload jsonb;
  final_sha256 text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_run_id is null
     or p_query_receipts is null or p_result_payload is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into staged
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.run_id = p_run_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if staged.status = 'ready' then
    if staged.result_payload - 'feedbackReceipts' is distinct from p_result_payload then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'result_ready', 'run_id', staged.run_id,
      'result_sha256', staged.result_sha256,
      'result_payload', staged.result_payload
    );
  end if;
  if staged.status <> 'claimed' then
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  if staged.expires_at <= now() then
    update public.sourcing_run_results
       set status = 'expired', result_payload = null,
           expired_at = now(), expires_at = now()
     where run_id = staged.run_id;
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  select * into sourcing
    from public.sourcing_runs run
   where run.workspace_id = p_workspace_id
     and run.actor_id = p_actor_id
     and run.id = p_run_id
   for share;
  if not found or sourcing.status not in ('in_progress','completed') then
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  if jsonb_typeof(p_result_payload) <> 'object'
     or octet_length(p_result_payload::text) > 524288
     or not (p_result_payload ?& array[
       'ok','mode','campaignId','campaignFingerprint','candidates','totalFound',
       'requestId','idempotencyKey','sourcingRunId','appliedLessonIds'
     ])
     or p_result_payload - array[
       'ok','mode','campaignId','campaignFingerprint','candidates','totalFound',
       'requestId','idempotencyKey','sourcingRunId','appliedLessonIds'
     ] <> '{}'::jsonb
     or p_result_payload->'ok' <> 'true'::jsonb
     or p_result_payload->>'mode' is distinct from sourcing.mode
     or p_result_payload->>'campaignId' is distinct from staged.campaign_id
     or encode(digest(convert_to(p_result_payload->>'campaignFingerprint', 'UTF8'), 'sha256'), 'hex')
        is distinct from staged.campaign_fingerprint
     or p_result_payload->>'idempotencyKey' is distinct from staged.idempotency_key::text
     or p_result_payload->>'sourcingRunId' is distinct from staged.run_id::text
     or p_result_payload->>'requestId' is distinct from sourcing.request_id
     or jsonb_typeof(p_result_payload->'requestId') <> 'string'
     or p_result_payload->>'requestId' !~ '^[A-Za-z0-9._:-]{1,100}$'
     or jsonb_typeof(p_result_payload->'totalFound') <> 'number'
     or p_result_payload->>'totalFound' !~ '^[0-9]{1,6}$'
     or (p_result_payload->>'totalFound')::integer > 100000
     or (case
          when jsonb_typeof(p_result_payload->'candidates') = 'array'
            and p_result_payload->>'totalFound' ~ '^[0-9]{1,6}$'
          then (p_result_payload->>'totalFound')::integer <
            jsonb_array_length(p_result_payload->'candidates')
          else false
        end)
     or jsonb_typeof(p_result_payload->'appliedLessonIds') <> 'array'
     or jsonb_array_length(p_result_payload->'appliedLessonIds') > 10
     or exists (
       select 1 from jsonb_array_elements(p_result_payload->'appliedLessonIds') applied(value)
       where jsonb_typeof(applied.value) <> 'string'
          or applied.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     or not public.validate_ordinary_sourcing_candidates(
       p_workspace_id, staged.campaign_id,
       p_result_payload->'candidates', staged.requested_count
     ) then
    return jsonb_build_object('status', 'result_invalid');
  end if;

  completion := public.complete_sourcing_run(
    p_workspace_id, p_actor_id, p_run_id, p_query_receipts
  );
  if completion->>'status' <> 'completed' then return completion; end if;
  final_payload := p_result_payload || jsonb_build_object(
    'feedbackReceipts', completion->'receipts'
  );
  if octet_length(final_payload::text) > 524288 then
    raise exception 'staged sourcing result exceeds bound' using errcode = '22023';
  end if;
  final_sha256 := encode(
    digest(convert_to(final_payload::text, 'UTF8'), 'sha256'), 'hex'
  );
  update public.sourcing_run_results
     set status = 'ready', result_sha256 = final_sha256,
         result_payload = final_payload, ready_at = now(),
         expires_at = now() + interval '24 hours'
   where run_id = staged.run_id;
  return jsonb_build_object(
    'status', 'result_ready', 'run_id', staged.run_id,
    'result_sha256', final_sha256, 'result_payload', final_payload
  );
end;
$$;

create or replace function public.ack_ordinary_sourcing_result(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_result_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  staged public.sourcing_run_results%rowtype;
  workspace_document jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_run_id is null
     or p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
   where workspace_id = p_workspace_id and id = p_actor_id
     and role in ('admin','member')
   for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into staged
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.run_id = p_run_id
   for update;
  if not found or staged.result_sha256 is distinct from p_result_sha256 then
    return jsonb_build_object('status', 'not_found');
  end if;
  if staged.status = 'completed' then
    return jsonb_build_object(
      'status', 'completed', 'run_id', staged.run_id,
      'result_sha256', staged.result_sha256
    );
  end if;
  if staged.status <> 'ready' then
    return jsonb_build_object('status', 'run_closed');
  end if;
  if staged.expires_at <= now() then
    update public.sourcing_run_results
       set status = 'expired', result_payload = null,
           expired_at = now(), expires_at = now()
     where run_id = staged.run_id;
    return jsonb_build_object('status', 'result_expired');
  end if;
  select state into workspace_document
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for share;
  -- The exact result-hash marker is written in the same durable workspace
  -- commit as accepted candidates and intentional skips. It covers empty and
  -- all-skipped batches without requiring the database to duplicate client
  -- dedupe and exclusion policy.
  if not found or jsonb_typeof(workspace_document->'activities') <> 'array'
     or not exists (
       select 1
         from jsonb_array_elements(workspace_document->'activities') activity(value)
        where activity.value->>'id' =
          'sourcing-run:' || staged.run_id::text || ':' || staged.result_sha256
     ) then
    return jsonb_build_object('status', 'persistence_unverified');
  end if;
  update public.sourcing_run_results
     set status = 'completed', result_payload = null,
         completed_at = now(), expires_at = now()
   where run_id = staged.run_id;
  return jsonb_build_object(
    'status', 'completed', 'run_id', staged.run_id,
    'result_sha256', staged.result_sha256
  );
end;
$$;

create or replace function public.fail_ordinary_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  staged public.sourcing_run_results%rowtype;
  failure jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into staged
    from public.sourcing_run_results result
   where result.workspace_id = p_workspace_id
     and result.actor_id = p_actor_id
     and result.run_id = p_run_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if staged.status = 'failed' then
    return jsonb_build_object('status', 'failed', 'run_id', staged.run_id);
  end if;
  if staged.status <> 'claimed' then
    return jsonb_build_object('status', 'completion_conflict');
  end if;
  failure := public.fail_sourcing_run(
    p_workspace_id, p_actor_id, p_run_id, p_error_code
  );
  if failure->>'status' <> 'failed' then return failure; end if;
  update public.sourcing_run_results
     set status = 'failed', result_payload = null,
         failed_at = now(), expires_at = now()
   where run_id = staged.run_id;
  return failure;
end;
$$;

create or replace function public.cleanup_ordinary_sourcing_results(
  p_workspace_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  processed integer := 0;
  payloads_scrubbed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  with candidates as (
    select result.run_id, result.status
      from public.sourcing_run_results result
     where result.workspace_id = p_workspace_id
       and result.status in ('claimed','ready')
       and result.expires_at <= now()
     order by result.expires_at, result.run_id
     limit p_limit
     for update skip locked
  ), expired as (
    update public.sourcing_run_results result
       set status = 'expired', result_payload = null,
           expired_at = now(), expires_at = now()
      from candidates
     where result.run_id = candidates.run_id
     returning candidates.status
  )
  select count(*)::integer,
         count(*) filter (where status = 'ready')::integer
    into processed, payloads_scrubbed
    from expired;
  return jsonb_build_object(
    'status', 'cleaned',
    'processed', processed,
    'payloads_scrubbed', payloads_scrubbed
  );
end;
$$;

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
do $ordinary_sourcing_receipt_allowlist$
begin
  if to_regclass('public.candidate_payload_provenance') is not null then
    alter table public.candidate_erasure_receipts
      add constraint candidate_erasure_receipts_store_name_check check (store_name in (
        'workspace_state', 'messages_outbound', 'messages_inbound',
        'agent_conversations', 'outreach_ledger', 'outreach_approvals',
        'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
        'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
        'agent_runs', 'agent_events', 'agent_framework_results',
        'sourcing_candidate_evidence', 'ordinary_sourcing_results',
        'agent_memories', 'candidate_payload_provenance'
      ));
  else
    alter table public.candidate_erasure_receipts
      add constraint candidate_erasure_receipts_store_name_check check (store_name in (
        'workspace_state', 'messages_outbound', 'messages_inbound',
        'agent_conversations', 'outreach_ledger', 'outreach_approvals',
        'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
        'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
        'agent_runs', 'agent_events', 'agent_framework_results',
        'sourcing_candidate_evidence', 'ordinary_sourcing_results'
      ));
  end if;
end;
$ordinary_sourcing_receipt_allowlist$;

create or replace function public.cleanup_ordinary_sourcing_erasure()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  scrubbed integer := 0;
begin
  if new.status = 'blocked_legal_hold' then return null; end if;
  -- The authoritative erasure routine inserts its identity tombstones after
  -- creating the request, then performs a final status update. Defer cleanup
  -- until that update so a staged alias with a different generated candidate
  -- ID is still matched by its LinkedIn, GitHub, or source identity.
  if not exists (
    select 1
      from public.candidate_erasure_suppression_tombstones tombstone
     where tombstone.workspace_id = new.workspace_id
       and tombstone.request_id = new.id
  ) then
    return null;
  end if;
  update public.sourcing_run_results result
     set status = 'expired', result_payload = null,
         expired_at = now(), expires_at = now()
   where result.workspace_id = new.workspace_id
     and result.campaign_id = new.campaign_id
     and result.status = 'ready'
     and result.result_payload is not null
     and exists (
       select 1 from jsonb_array_elements(result.result_payload->'candidates') candidate(value)
        where candidate.value->>'id' = new.candidate_id
           or exists (
             select 1
               from (values
                 ('candidate_id', candidate.value->>'id'),
                 ('linkedin', candidate.value->>'linkedinUrl'),
                 ('github', candidate.value->>'githubUrl'),
                 ('source_url', candidate.value->>'sourceUrl')
               ) identifier(kind, value)
               join public.candidate_erasure_suppression_tombstones tombstone
                 on tombstone.workspace_id = new.workspace_id
                and tombstone.request_id = new.id
                and tombstone.identifier_kind = identifier.kind
                and tombstone.identifier_hmac =
                  public.candidate_erasure_identifier_hmac(
                    new.workspace_id, identifier.kind, identifier.value
                  )
              where coalesce(btrim(identifier.value), '') <> ''
           )
     );
  get diagnostics scrubbed = row_count;
  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values (
    new.id, new.workspace_id, 'ordinary_sourcing_results', scrubbed
  ) on conflict (request_id, store_name) do nothing;
  return null;
end;
$$;

revoke all on function public.cleanup_ordinary_sourcing_erasure()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_requests_ordinary_sourcing_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_ordinary_sourcing_cleanup
  after insert or update of status on public.candidate_erasure_requests
  for each row execute function public.cleanup_ordinary_sourcing_erasure();

do $ordinary_cleanup_base$
begin
  if to_regprocedure(
    'public.cleanup_sourcing_learning_authority_pre0058(uuid,integer)'
  ) is null then
    alter function public.cleanup_sourcing_learning_authority(uuid,integer)
      rename to cleanup_sourcing_learning_authority_pre0058;
  end if;
end;
$ordinary_cleanup_base$;
revoke all on function public.cleanup_sourcing_learning_authority_pre0058(uuid,integer)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.cleanup_sourcing_learning_authority(
  p_workspace_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  base jsonb;
  result_cleanup jsonb := jsonb_build_object(
    'status', 'cleaned', 'processed', 0, 'payloads_scrubbed', 0
  );
  used integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  base := public.cleanup_sourcing_learning_authority_pre0058(
    p_workspace_id, p_limit
  );
  if base->>'status' <> 'cleaned' then return base; end if;
  used := coalesce((base->>'retired')::integer, 0)
    + coalesce((base->>'lessons_deleted')::integer, 0)
    + coalesce((base->>'artifacts_deleted')::integer, 0)
    + coalesce((base->>'runs_deleted')::integer, 0)
    + coalesce((base->>'quota_deleted')::integer, 0);
  if used < p_limit then
    result_cleanup := public.cleanup_ordinary_sourcing_results(
      p_workspace_id, p_limit - used
    );
    if result_cleanup->>'status' <> 'cleaned' then return result_cleanup; end if;
  end if;
  return base || jsonb_build_object(
    'ordinary_results_expired', (result_cleanup->>'processed')::integer,
    'ordinary_result_payloads_scrubbed', (result_cleanup->>'payloads_scrubbed')::integer
  );
end;
$$;

alter function public.validate_ordinary_sourcing_candidates(uuid,text,jsonb,integer) owner to postgres;
alter function public.resume_ordinary_sourcing_run(uuid,uuid,text,text,integer) owner to postgres;
alter function public.begin_ordinary_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text) owner to postgres;
alter function public.complete_ordinary_sourcing_run(uuid,uuid,uuid,jsonb,jsonb) owner to postgres;
alter function public.ack_ordinary_sourcing_result(uuid,uuid,uuid,text) owner to postgres;
alter function public.fail_ordinary_sourcing_run(uuid,uuid,uuid,text) owner to postgres;
alter function public.cleanup_ordinary_sourcing_results(uuid,integer) owner to postgres;
alter function public.cleanup_ordinary_sourcing_erasure() owner to postgres;
alter function public.cleanup_sourcing_learning_authority_pre0058(uuid,integer) owner to postgres;
alter function public.cleanup_sourcing_learning_authority(uuid,integer) owner to postgres;

revoke all on function public.resume_ordinary_sourcing_run(uuid,uuid,text,text,integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.begin_ordinary_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.complete_ordinary_sourcing_run(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.ack_ordinary_sourcing_result(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.fail_ordinary_sourcing_run(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.cleanup_ordinary_sourcing_results(uuid,integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.cleanup_sourcing_learning_authority(uuid,integer)
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.resume_ordinary_sourcing_run(uuid,uuid,text,text,integer)
  to service_role;
grant execute on function public.begin_ordinary_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text)
  to service_role;
grant execute on function public.complete_ordinary_sourcing_run(uuid,uuid,uuid,jsonb,jsonb)
  to service_role;
grant execute on function public.ack_ordinary_sourcing_result(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.fail_ordinary_sourcing_run(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.cleanup_ordinary_sourcing_results(uuid,integer)
  to service_role;
grant execute on function public.cleanup_sourcing_learning_authority(uuid,integer)
  to service_role;
