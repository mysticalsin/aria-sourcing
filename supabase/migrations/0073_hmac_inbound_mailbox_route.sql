-- 0073_hmac_inbound_mailbox_route.sql
-- Register inbound_mailbox_routes without an OAuth email_connections row.
-- HMAC /api/webhooks/email-inbound resolves mailbox → workspace via this route;
-- Graph OAuth remains optional when M365 is deferred.

create or replace function public.upsert_hmac_inbound_mailbox_route(
  p_mailbox text,
  p_purpose text default 'intake',
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
  purpose text := lower(btrim(coalesce(p_purpose, 'intake')));
  route_id uuid;
begin
  if purpose not in ('reply', 'intake') then
    return json_build_object('ok', false, 'reason', 'invalid-purpose');
  end if;
  if needle = '' or char_length(needle) < 3 or char_length(needle) > 320 or position('@' in needle) < 2 then
    return json_build_object('ok', false, 'reason', 'invalid-mailbox');
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

  insert into public.inbound_mailbox_routes (
    workspace_id, mailbox_address, connection_id, purpose, active
  ) values (
    wid, needle, null, purpose, true
  )
  on conflict (mailbox_address) do update
    set workspace_id = excluded.workspace_id,
        -- Keep an existing OAuth connection_id when re-registering HMAC on the same mailbox.
        connection_id = coalesce(public.inbound_mailbox_routes.connection_id, excluded.connection_id),
        purpose = excluded.purpose,
        active = true
  where public.inbound_mailbox_routes.workspace_id = wid
  returning id into route_id;

  if route_id is null then
    return json_build_object('ok', false, 'reason', 'mailbox-claimed');
  end if;

  return json_build_object(
    'ok', true,
    'route_id', route_id,
    'mailbox', needle,
    'purpose', purpose,
    'workspace_id', wid,
    'hmac_only', true
  );
end;
$$;

revoke all on function public.upsert_hmac_inbound_mailbox_route(text, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.upsert_hmac_inbound_mailbox_route(text, text, uuid)
  to service_role, authenticated;
