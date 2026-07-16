-- 0037_person_identity_model.sql
--
-- Derived person identity layer over the candidate corpus.
-- Linkage is intentionally conservative: LinkedIn personal /in/ profile URLs
-- are the only person key, canonicalized byte-for-byte like 0033 tombstones.

create table if not exists public.persons (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, person_id)
);

create table if not exists public.candidate_identities (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  kind text not null check (kind in ('linkedin')),
  value_normalized text not null check (char_length(value_normalized) between 1 and 500),
  first_seen_at timestamptz not null default now(),
  primary key (workspace_id, kind, value_normalized),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, person_id) on delete cascade
);

create index if not exists candidate_identities_person_idx
  on public.candidate_identities (workspace_id, person_id);

alter table public.persons enable row level security;
alter table public.persons force row level security;
alter table public.candidate_identities enable row level security;
alter table public.candidate_identities force row level security;

revoke all on public.persons
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.candidate_identities
  from public, anon, authenticated, service_role, authenticator;

drop policy if exists persons_owner_access on public.persons;
create policy persons_owner_access on public.persons
  for all to postgres, supabase_admin using (true) with check (true);

drop policy if exists candidate_identities_owner_access on public.candidate_identities;
create policy candidate_identities_owner_access on public.candidate_identities
  for all to postgres, supabase_admin using (true) with check (true);

alter table public.candidates
  add column if not exists person_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'candidates_person_fk'
       and conrelid = 'public.candidates'::regclass
  ) then
    alter table public.candidates
      add constraint candidates_person_fk
      foreign key (workspace_id, person_id)
      references public.persons(workspace_id, person_id)
      on delete set null (person_id);
  end if;
end;
$$;

create index if not exists candidates_ws_person_idx
  on public.candidates (workspace_id, person_id);

create or replace function public.link_one_candidate(
  p_candidate public.candidates
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_identity_count integer;
  v_person_id uuid;
begin
  if p_candidate.linkedin_url is not null
     and btrim(p_candidate.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
    v_key := lower(btrim(p_candidate.linkedin_url));
  end if;

  if v_key is null then
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  -- Tombstone-skip (defense-in-depth). The identifier HMAC helper RAISES when the workspace has no
  -- sourcing secret, and Postgres hoists that STABLE call out of the EXISTS predicate so it fires even
  -- against zero tombstone rows. Guard it: only compute the HMAC when LinkedIn tombstones actually
  -- exist for this workspace (no tombstones ⇒ nothing to skip; and a tombstone can only exist after
  -- its secret does, so the helper is safe once we are inside this branch).
  if exists (
    select 1 from public.candidate_erasure_suppression_tombstones t
     where t.workspace_id = p_candidate.workspace_id and t.identifier_kind = 'linkedin'
  ) then
    -- LinkedIn tombstones exist for this workspace ⇒ its secret exists ⇒ the HMAC helper is safe.
    if exists (
      select 1
        from public.candidate_erasure_suppression_tombstones tombstone
       where tombstone.workspace_id = p_candidate.workspace_id
         and tombstone.identifier_kind = 'linkedin'
         and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
           p_candidate.workspace_id,
           'linkedin',
           v_key
         )
    ) then
      update public.candidates candidate
         set person_id = null
       where candidate.workspace_id = p_candidate.workspace_id
         and candidate.campaign_id = p_candidate.campaign_id
         and candidate.id = p_candidate.id
         and candidate.person_id is not null;
      return null;
    end if;
  end if;

  select count(*)
    into v_identity_count
    from public.candidate_identities identity
   where identity.workspace_id = p_candidate.workspace_id
     and identity.kind = 'linkedin'
     and identity.value_normalized = v_key;

  if v_identity_count > 1 then
    raise warning 'ambiguous person identity for workspace %, linkedin %',
      p_candidate.workspace_id, v_key;
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  if v_identity_count = 1 then
    select identity.person_id
      into v_person_id
      from public.candidate_identities identity
     where identity.workspace_id = p_candidate.workspace_id
       and identity.kind = 'linkedin'
       and identity.value_normalized = v_key;
  end if;

  if v_person_id is null then
    insert into public.persons(workspace_id)
    values (p_candidate.workspace_id)
    returning person_id into v_person_id;
  end if;

  insert into public.candidate_identities(
    workspace_id, person_id, kind, value_normalized
  ) values (
    p_candidate.workspace_id, v_person_id, 'linkedin', v_key
  )
  on conflict (workspace_id, kind, value_normalized) do nothing;

  update public.candidates candidate
     set person_id = v_person_id
   where candidate.workspace_id = p_candidate.workspace_id
     and candidate.campaign_id = p_candidate.campaign_id
     and candidate.id = p_candidate.id
     and candidate.person_id is distinct from v_person_id;

  return v_person_id;
end;
$$;

create or replace function public.link_candidate_person()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_key text;
  v_new_key text;
begin
  if tg_op = 'UPDATE' then
    v_old_key := lower(btrim(coalesce(old.linkedin_url, '')));
    v_new_key := lower(btrim(coalesce(new.linkedin_url, '')));
    if new.person_id is not null and v_old_key = v_new_key then
      return null;
    end if;
  end if;

  begin
    perform public.link_one_candidate(new);

    if tg_op = 'UPDATE'
       and old.person_id is not null
       and lower(btrim(coalesce(old.linkedin_url, ''))) <> lower(btrim(coalesce(new.linkedin_url, '')))
       and old.linkedin_url is not null
       and btrim(old.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
      v_old_key := lower(btrim(old.linkedin_url));

      delete from public.candidate_identities identity
       where identity.workspace_id = old.workspace_id
         and identity.person_id = old.person_id
         and identity.kind = 'linkedin'
         and identity.value_normalized = v_old_key
         and not exists (
           select 1
             from public.candidates candidate
            where candidate.workspace_id = identity.workspace_id
              and candidate.person_id = identity.person_id
              and lower(btrim(coalesce(candidate.linkedin_url, ''))) = identity.value_normalized
         );

      delete from public.persons person
       where person.workspace_id = old.workspace_id
         and person.person_id = old.person_id
         and not exists (
           select 1
             from public.candidates candidate
            where candidate.workspace_id = person.workspace_id
              and candidate.person_id = person.person_id
         );
    end if;
  exception when others then
    raise warning 'candidate person linkage failed for ws %, campaign %, candidate %: %',
      new.workspace_id, new.campaign_id, new.id, sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists candidates_person_link on public.candidates;
create trigger candidates_person_link
  after insert or update of linkedin_url on public.candidates
  for each row execute function public.link_candidate_person();

create or replace function public.gc_deleted_candidacies()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  with aff as (
    select distinct workspace_id, person_id
      from gone
     where workspace_id is not null
       and person_id is not null
  )
  delete from public.candidate_identities identity
   using aff
   where identity.workspace_id = aff.workspace_id
     and identity.person_id = aff.person_id
     and not exists (
       select 1
         from public.candidates candidate
        where candidate.workspace_id = identity.workspace_id
          and candidate.person_id = identity.person_id
          and lower(btrim(coalesce(candidate.linkedin_url, ''))) = identity.value_normalized
     );

  with aff as (
    select distinct workspace_id, person_id
      from gone
     where workspace_id is not null
       and person_id is not null
  )
  delete from public.persons person
   using aff
   where person.workspace_id = aff.workspace_id
     and person.person_id = aff.person_id
     and not exists (
       select 1
         from public.candidates candidate
        where candidate.workspace_id = person.workspace_id
          and candidate.person_id = person.person_id
     );

  return null;
end;
$$;

drop trigger if exists candidates_person_gc on public.candidates;
create trigger candidates_person_gc
  after delete on public.candidates
  referencing old table as gone
  for each statement execute function public.gc_deleted_candidacies();

-- NOTE (empirically established by the disposable-Postgres test): a tombstone-INSERT purge of the
-- person layer is UNREACHABLE and therefore intentionally NOT implemented. request_candidate_erasure
-- writes candidate_erasure_requests (0033), whose after-insert trigger (0035) deletes the erased
-- candidacy BEFORE the tombstone is inserted; the statement-level candidates_person_gc above then
-- removes that candidacy's now-orphaned identity + person. And 0033's reject_candidate_erasure_reimport
-- BLOCKS erasing a candidate whose identifier a SURVIVING candidacy still carries (the scrubbed-state
-- write reintroduces the just-tombstoned value) — so no successful erasure ever leaves a surviving
-- candidacy holding the tombstoned identifier. Hence the delete-GC fully covers erasure identity
-- cleanup; a separate tombstone purge would have no reachable input. The linkage tombstone-skip in
-- link_one_candidate remains as defense-in-depth against a direct-DB resurrection (proven in isolation
-- by the person-model test).

create or replace function public.backfill_candidate_person_identities()
returns table(linked integer, skipped integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ws record;
  candidate_record public.candidates%rowtype;
  candidate_count integer;
  linked_person uuid;
begin
  linked := 0;
  skipped := 0;

  for ws in
    select distinct workspace_id
      from public.candidates
     order by workspace_id
  loop
    begin
      candidate_count := 0;
      for candidate_record in
        select *
          from public.candidates
         where workspace_id = ws.workspace_id
         order by campaign_id, id
      loop
        candidate_count := candidate_count + 1;
        linked_person := public.link_one_candidate(candidate_record);
        if linked_person is null then
          skipped := skipped + 1;
        else
          linked := linked + 1;
        end if;
      end loop;
    exception when others then
      skipped := skipped + candidate_count;
      raise warning 'person backfill skipped workspace %: %', ws.workspace_id, sqlerrm;
    end;
  end loop;

  raise notice 'person backfill: % candidacies linked, % skipped', linked, skipped;
  return next;
end;
$$;

alter function public.link_one_candidate(public.candidates) owner to postgres;
alter function public.link_candidate_person() owner to postgres;
alter function public.gc_deleted_candidacies() owner to postgres;
alter function public.backfill_candidate_person_identities() owner to postgres;

revoke all on function public.link_one_candidate(public.candidates)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.link_candidate_person()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.gc_deleted_candidacies()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.backfill_candidate_person_identities()
  from public, anon, authenticated, service_role, authenticator;

select * from public.backfill_candidate_person_identities();
