-- Restore the pre-0061 JWT-only RLS helpers and profile policies.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select workspace_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

alter function public.current_workspace_id() owner to postgres;
alter function public.current_profile_role() owner to postgres;
revoke all on function public.current_workspace_id()
  from public, anon, authenticator, authenticated, service_role;
revoke all on function public.current_profile_role()
  from public, anon, authenticator, authenticated, service_role;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select
  using (id = auth.uid());

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert
  with check (
    id = auth.uid()
    and workspace_id is null
    and role = 'member'
  );

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and workspace_id is not distinct from public.current_workspace_id()
    and role is not distinct from public.current_profile_role()
  );

drop function public.current_active_identity_id();
drop function public.auth_identity_lifecycle_schema_ready();

-- Restore the exact 0018 first-admin workspace contract.
create or replace function public.ensure_workspace()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  uemail text;
  domain text;
  wid    uuid;
  workspace_was_created boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;
  domain := lower(split_part(coalesce(uemail, 'user@workspace'), '@', 2));
  if domain = '' then domain := 'workspace'; end if;

  -- already provisioned?
  select workspace_id into wid from public.profiles where id = uid;
  if wid is not null then
    return wid;
  end if;

  -- shared org workspace, keyed by domain
  select id into wid from public.workspaces where allowed_domain = domain;
  if wid is null then
    insert into public.workspaces(name, allowed_domain)
      values (initcap(domain) || ' Workspace', domain)
      returning id into wid;
    workspace_was_created := true;
  end if;

  insert into public.profiles(id, email, full_name, workspace_id, role)
    values (
      uid,
      uemail,
      split_part(coalesce(uemail, 'user'), '@', 1),
      wid,
      -- First profile for a newly-created workspace starts as role='admin'.
      case when workspace_was_created then 'admin' else 'member' end
    )
    on conflict (id) do update
      set workspace_id = excluded.workspace_id,
          email = excluded.email,
          -- A pre-existing profile only becomes admin when this same call created
          -- the workspace. Joining an existing workspace never elevates role.
          role = case when workspace_was_created then 'admin' else public.profiles.role end;

  return wid;
end;
$$;

alter function public.ensure_workspace() owner to postgres;
revoke all on function public.ensure_workspace()
  from public, anon, authenticator, authenticated, service_role;
grant execute on function public.ensure_workspace() to authenticated;
