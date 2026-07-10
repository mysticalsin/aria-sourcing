-- ============================================================================
-- Hermes Sourcing — first workspace profile is admin
-- Keep the profile anti-escalation RLS policy intact. The only role elevation is
-- inside ensure_workspace(), and only when this call creates a brand-new
-- workspace for the caller's email domain.
-- Run AFTER 0001_init.sql.
-- ============================================================================

create or replace function public.ensure_workspace()
returns uuid
language plpgsql security definer set search_path = public as $$
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

grant execute on function public.ensure_workspace() to authenticated;
