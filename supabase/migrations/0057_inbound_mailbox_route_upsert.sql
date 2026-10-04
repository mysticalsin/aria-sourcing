-- 0057_inbound_mailbox_route_upsert.sql
--
-- OAuth connect + Settings need to register inbound_mailbox_routes so reply
-- webhooks can resolve the tenant. 0040 revoked service_role table grants and
-- left writes to postgres/supabase_admin only — this adds SECURITY DEFINER
-- upsert / deactivate RPCs for the OAuth callback (service_role) and admins.

create or replace function public.upsert_inbound_mailbox_route(
  p_mailbox text,
  p_connection_id uuid,
  p_purpose text default 'reply',
  p_workspace_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  role_name text := coalesce(auth.role(), '');
  wid uuid;
  needle text := lower(btrim(coalesce(p_mailbox, '')));
  purpose text := lower(btrim(coalesce(p_purpose, 'reply')));
  conn_ws uuid;
  route_id uuid;
begin
  if purpose not in ('reply', 'intake') then
    return json_build_object('ok', false, 'reason', 'invalid-purpose');
  end if;
  if needle = '' or char_length(needle) < 3 or char_length(needle) > 320 then
    return json_build_object('ok', false, 'reason', 'invalid-mailbox');
  end if;
  if p_connection_id is null then
    return json_build_object('ok', false, 'reason', 'missing-connection');
  end if;

  if role_name = 'service_role' then
    if p_workspace_id is null then
      return json_build_object('ok', false, 'reason', 'missing-workspace');
    end if;
    wid := p_workspace_id;
  else
    if auth.uid() is null then
      return json_build_object('ok', false, 'reason', 'auth-required');
    end if;
    wid := public.current_workspace_id();
    if wid is null then
      return json_build_object('ok', false, 'reason', 'no-workspace');
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.workspace_id = wid
         and p.id = auth.uid()
         and p.role = 'admin'
    ) then
      return json_build_object('ok', false, 'reason', 'admin-required');
    end if;
  end if;

  select c.workspace_id into conn_ws
    from public.email_connections c
   where c.id = p_connection_id;
  if conn_ws is null or conn_ws <> wid then
    return json_build_object('ok', false, 'reason', 'connection-mismatch');
  end if;

  insert into public.inbound_mailbox_routes (
    workspace_id, mailbox_address, connection_id, purpose, active
  ) values (
    wid, needle, p_connection_id, purpose, true
  )
  on conflict (mailbox_address) do update
    set workspace_id = excluded.workspace_id,
        connection_id = excluded.connection_id,
        purpose = excluded.purpose,
        active = true
  where public.inbound_mailbox_routes.workspace_id = wid
  returning id into route_id;

  if route_id is null then
    -- Conflict row belongs to another workspace — fail closed (global uniqueness).
    return json_build_object('ok', false, 'reason', 'mailbox-claimed');
  end if;

  return json_build_object(
    'ok', true,
    'route_id', route_id,
    'mailbox', needle,
    'purpose', purpose,
    'workspace_id', wid
  );
end;
$$;

revoke all on function public.upsert_inbound_mailbox_route(text, uuid, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.upsert_inbound_mailbox_route(text, uuid, text, uuid)
  to service_role, authenticated;

create or replace function public.deactivate_inbound_mailbox_route_for_connection(
  p_connection_id uuid,
  p_workspace_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  role_name text := coalesce(auth.role(), '');
  wid uuid;
  updated int := 0;
begin
  if p_connection_id is null then
    return json_build_object('ok', false, 'reason', 'missing-connection');
  end if;

  if role_name = 'service_role' then
    if p_workspace_id is null then
      return json_build_object('ok', false, 'reason', 'missing-workspace');
    end if;
    wid := p_workspace_id;
  else
    if auth.uid() is null then
      return json_build_object('ok', false, 'reason', 'auth-required');
    end if;
    wid := public.current_workspace_id();
    if wid is null then
      return json_build_object('ok', false, 'reason', 'no-workspace');
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.workspace_id = wid
         and p.id = auth.uid()
         and p.role = 'admin'
    ) then
      return json_build_object('ok', false, 'reason', 'admin-required');
    end if;
  end if;

  update public.inbound_mailbox_routes
     set active = false,
         connection_id = null
   where connection_id = p_connection_id
     and workspace_id = wid;
  get diagnostics updated = row_count;

  return json_build_object('ok', true, 'deactivated', updated);
end;
$$;

revoke all on function public.deactivate_inbound_mailbox_route_for_connection(uuid, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.deactivate_inbound_mailbox_route_for_connection(uuid, uuid)
  to service_role, authenticated;
