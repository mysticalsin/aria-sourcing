-- 0035_candidate_corpus_mirror.sql
--
-- Candidate corpus shadow mirror.
--
-- The JSONB workspace document remains authoritative. This table is a locked
-- down, product-unread shadow populated best-effort from workspace_state and
-- independently cleaned by the candidate-erasure authority.

create table if not exists public.candidates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 200),
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  email text,
  phone text,
  linkedin_url text,
  github_url text,
  source_url text,
  source_external_id text,
  source_authority_id text,
  source_platform text,
  name text,
  current_title text,
  current_company text,
  location text,
  match_score int,
  stage text,
  years_experience int,
  provenance text,
  created_at timestamptz,
  last_contacted_at timestamptz,
  payload jsonb not null,
  mirrored_at timestamptz not null default now(),
  primary key (workspace_id, campaign_id, id)
);

create index if not exists candidates_ws_campaign_idx
  on public.candidates (workspace_id, campaign_id);
create index if not exists candidates_ws_email_idx
  on public.candidates (workspace_id, lower(email))
  where email is not null;
create index if not exists candidates_ws_linkedin_idx
  on public.candidates (workspace_id, lower(linkedin_url))
  where linkedin_url is not null;

alter table public.candidates enable row level security;
alter table public.candidates force row level security;
revoke all on public.candidates
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists candidates_owner_access on public.candidates;
create policy candidates_owner_access on public.candidates
  for all to postgres, supabase_admin using (true) with check (true);

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
      new.workspace_id,
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
        from jsonb_array_elements(new.state->'candidates')
          with ordinality elem(value, ordinality)
        where not exists (
          select 1
            from public.candidate_erasure_suppression_tombstones tombstone
           where tombstone.workspace_id = new.workspace_id
             and tombstone.identifier_kind = 'candidate_id'
             and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
               new.workspace_id,
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
     where candidate.workspace_id = new.workspace_id
       and not exists (
         select 1
           from (
             select distinct
               elem.value->>'campaignId' as campaign_id,
               elem.value->>'id' as id
             from jsonb_array_elements(new.state->'candidates') elem(value)
             where not exists (
               select 1
                 from public.candidate_erasure_suppression_tombstones tombstone
                where tombstone.workspace_id = new.workspace_id
                  and tombstone.identifier_kind = 'candidate_id'
                  and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
                    new.workspace_id,
                    'candidate_id',
                    elem.value->>'id'
                  )
             )
           ) live
          where live.campaign_id = candidate.campaign_id
            and live.id = candidate.id
       );
  exception when others then
    raise warning 'candidates mirror sync failed for ws %: %', new.workspace_id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.sync_candidates_corpus()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidates_corpus_mirror_ins on public.workspace_state;
create trigger candidates_corpus_mirror_ins
  after insert on public.workspace_state
  for each row execute function public.sync_candidates_corpus();

drop trigger if exists candidates_corpus_mirror_upd on public.workspace_state;
create trigger candidates_corpus_mirror_upd
  after update of state on public.workspace_state
  for each row
  when (old.state->'candidates' is distinct from new.state->'candidates')
  execute function public.sync_candidates_corpus();

create or replace function public.cleanup_erased_candidate_mirror()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.candidates
   where workspace_id = new.workspace_id
     and campaign_id = new.campaign_id
     and id = new.candidate_id;
  return null;
end;
$$;

revoke all on function public.cleanup_erased_candidate_mirror()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_erasure_requests_mirror_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_mirror_cleanup
  after insert or update on public.candidate_erasure_requests
  for each row
  when (new.status <> 'blocked_legal_hold')
  execute function public.cleanup_erased_candidate_mirror();
