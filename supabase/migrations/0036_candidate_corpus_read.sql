-- 0036_candidate_corpus_read.sql
--
-- Read path for the candidate corpus shadow mirror.
-- The JSONB workspace document remains authoritative for writes.

create or replace function public.mirror_workspace_candidates(
  p_workspace_id uuid,
  p_state jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if jsonb_typeof(p_state->'candidates') is distinct from 'array' then
    return;
  end if;

  insert into public.candidates (
    workspace_id,
    campaign_id,
    id,
    email,
    phone,
    linkedin_url,
    github_url,
    source_url,
    source_external_id,
    source_authority_id,
    source_platform,
    name,
    current_title,
    current_company,
    location,
    match_score,
    stage,
    years_experience,
    provenance,
    created_at,
    last_contacted_at,
    payload,
    mirrored_at
  )
  select
    p_workspace_id,
    live.campaign_id,
    live.id,
    live.email,
    live.phone,
    live.linkedin_url,
    live.github_url,
    live.source_url,
    live.source_external_id,
    live.source_authority_id,
    live.source_platform,
    live.name,
    live.current_title,
    live.current_company,
    live.location,
    live.match_score,
    live.stage,
    live.years_experience,
    live.provenance,
    live.created_at,
    live.last_contacted_at,
    live.payload,
    now()
  from (
    select distinct on (candidate.campaign_id, candidate.id)
      candidate.campaign_id,
      candidate.id,
      candidate.email,
      candidate.phone,
      candidate.linkedin_url,
      candidate.github_url,
      candidate.source_url,
      candidate.source_external_id,
      candidate.source_authority_id,
      candidate.source_platform,
      candidate.name,
      candidate.current_title,
      candidate.current_company,
      candidate.location,
      candidate.match_score,
      candidate.stage,
      candidate.years_experience,
      candidate.provenance,
      candidate.created_at,
      candidate.last_contacted_at,
      candidate.payload,
      candidate.ordinality
    from (
      select
        elem.value->>'campaignId' as campaign_id,
        elem.value->>'id' as id,
        nullif(elem.value->>'email', '') as email,
        nullif(elem.value->>'phone', '') as phone,
        nullif(elem.value->>'linkedinUrl', '') as linkedin_url,
        nullif(elem.value->>'githubUrl', '') as github_url,
        nullif(elem.value->>'sourceUrl', '') as source_url,
        nullif(elem.value->>'sourceExternalId', '') as source_external_id,
        nullif(elem.value->>'sourceAuthorityId', '') as source_authority_id,
        nullif(elem.value->>'sourcePlatform', '') as source_platform,
        nullif(elem.value->>'name', '') as name,
        nullif(elem.value->>'currentTitle', '') as current_title,
        nullif(elem.value->>'currentCompany', '') as current_company,
        nullif(elem.value->>'location', '') as location,
        nullif(elem.value->>'matchScore', '')::int as match_score,
        nullif(elem.value->>'stage', '') as stage,
        nullif(elem.value->>'yearsExperience', '')::int as years_experience,
        nullif(elem.value->>'provenance', '') as provenance,
        nullif(elem.value->>'createdAt', '')::timestamptz as created_at,
        nullif(elem.value->>'lastContactedAt', '')::timestamptz as last_contacted_at,
        elem.value as payload,
        elem.ordinality
      from jsonb_array_elements(p_state->'candidates')
        with ordinality elem(value, ordinality)
      where not exists (
        select 1
          from public.candidate_erasure_suppression_tombstones tombstone
         where tombstone.workspace_id = p_workspace_id
           and tombstone.identifier_kind = 'candidate_id'
           and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
             p_workspace_id,
             'candidate_id',
             elem.value->>'id'
           )
      )
    ) candidate
    order by candidate.campaign_id, candidate.id, candidate.ordinality
  ) live
  on conflict (workspace_id, campaign_id, id) do update set
    email = excluded.email,
    phone = excluded.phone,
    linkedin_url = excluded.linkedin_url,
    github_url = excluded.github_url,
    source_url = excluded.source_url,
    source_external_id = excluded.source_external_id,
    source_authority_id = excluded.source_authority_id,
    source_platform = excluded.source_platform,
    name = excluded.name,
    current_title = excluded.current_title,
    current_company = excluded.current_company,
    location = excluded.location,
    match_score = excluded.match_score,
    stage = excluded.stage,
    years_experience = excluded.years_experience,
    provenance = excluded.provenance,
    created_at = excluded.created_at,
    last_contacted_at = excluded.last_contacted_at,
    payload = excluded.payload,
    mirrored_at = excluded.mirrored_at;

  delete from public.candidates candidate
   where candidate.workspace_id = p_workspace_id
     and not exists (
       select 1
         from (
           select distinct
             elem.value->>'campaignId' as campaign_id,
             elem.value->>'id' as id
           from jsonb_array_elements(p_state->'candidates') elem(value)
           where not exists (
             select 1
               from public.candidate_erasure_suppression_tombstones tombstone
              where tombstone.workspace_id = p_workspace_id
                and tombstone.identifier_kind = 'candidate_id'
                and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
                  p_workspace_id,
                  'candidate_id',
                  elem.value->>'id'
                )
           )
         ) live
        where live.campaign_id = candidate.campaign_id
          and live.id = candidate.id
     );
end;
$$;

create or replace function public.sync_candidates_corpus()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if jsonb_typeof(new.state->'candidates') is distinct from 'array' then
    return null;
  end if;

  begin
    perform public.mirror_workspace_candidates(new.workspace_id, new.state);
  exception when others then
    raise warning 'candidates mirror sync failed for ws %: %', new.workspace_id, sqlerrm;
  end;

  return null;
end;
$$;

create or replace function public.backfill_candidates_corpus()
returns table(mirrored integer, skipped integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ws record;
begin
  mirrored := 0;
  skipped := 0;

  for ws in
    select workspace_id, state
      from public.workspace_state
     order by workspace_id
  loop
    begin
      perform public.mirror_workspace_candidates(ws.workspace_id, ws.state);
      mirrored := mirrored + 1;
    exception when others then
      skipped := skipped + 1;
      raise warning 'candidates corpus backfill skipped ws %: %', ws.workspace_id, sqlerrm;
    end;
  end loop;

  raise notice 'candidates corpus backfill: % workspaces mirrored, % skipped', mirrored, skipped;
  return next;
end;
$$;

create or replace function public.list_workspace_candidates(
  p_campaign_id text default null,
  p_stage text default null,
  p_source text default null,
  p_search text default null,
  p_sort text default 'match',
  p_limit int default 50,
  p_offset int default 0
)
returns table(total bigint, payload jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ws uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  safe_offset int := greatest(coalesce(p_offset, 0), 0);
  safe_sort text := case when p_sort in ('match', 'recent') then p_sort else 'match' end;
  escaped_search text;
begin
  if auth.uid() is null then
    return;
  end if;

  ws := public.current_workspace_id();
  if ws is null then
    return;
  end if;

  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    escaped_search := '%' || replace(replace(replace(btrim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  end if;

  return query
  with filtered as (
    select candidate.*
      from public.candidates candidate
     where candidate.workspace_id = ws
       and candidate.id <> ''
       and candidate.campaign_id <> ''
       and coalesce(candidate.name, '') <> ''
       and (p_campaign_id is null or candidate.campaign_id = p_campaign_id)
       and (p_stage is null or candidate.stage = p_stage)
       and (p_source is null or candidate.source_platform = p_source)
       and (
         escaped_search is null
         or candidate.name ilike escaped_search escape E'\\'
         or candidate.email ilike escaped_search escape E'\\'
         or candidate.current_title ilike escaped_search escape E'\\'
         or candidate.current_company ilike escaped_search escape E'\\'
       )
  ),
  total_count as (
    select count(*)::bigint as total from filtered
  ),
  paged as (
    select filtered.payload
      from filtered
     order by
       case when safe_sort = 'match' then filtered.match_score end desc nulls last,
       filtered.created_at desc nulls last
     limit safe_limit
     offset safe_offset
  )
  select total_count.total, paged.payload
    from total_count
    left join paged on true;
end;
$$;

revoke all on function public.mirror_workspace_candidates(uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.backfill_candidates_corpus()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.sync_candidates_corpus()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.list_workspace_candidates(text, text, text, text, text, int, int)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_workspace_candidates(text, text, text, text, text, int, int)
  to authenticated;

select * from public.backfill_candidates_corpus();
