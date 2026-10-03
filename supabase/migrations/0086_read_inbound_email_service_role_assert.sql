-- 0086: restore in-body service_role assertion on read_inbound_email_for_loop.
-- Migration 0059 rewrote the function as a thin wrapper around
-- read_inbound_message_for_loop but dropped the auth.role() gate that 0050
-- required. Privilege GRANT alone is not enough — function-privileges CI
-- demands an in-body service_role assertion on every service RPC.

create or replace function public.read_inbound_email_for_loop(
  p_workspace_id uuid,
  p_inbound_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result json;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;

  result := public.read_inbound_message_for_loop(p_workspace_id, p_inbound_id);
  if (result->>'status') = 'ok' and (result->>'channel') is distinct from 'Email' then
    -- Preserve historical Email-only contract for any remaining Email-specific callers.
    return json_build_object('status', 'not_found');
  end if;
  return result;
end;
$$;

revoke all on function public.read_inbound_email_for_loop(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.read_inbound_email_for_loop(uuid, uuid) to service_role;

alter function public.read_inbound_email_for_loop(uuid, uuid) owner to postgres;
