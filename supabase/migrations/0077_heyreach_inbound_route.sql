-- 0077_heyreach_inbound_route.sql
-- Allow HeyReach seats to register linkedin_inbound_routes (reply webhooks).
--
-- DROP required: 0058/0060 defined p_operator_label with DEFAULT ''. Postgres
-- rejects CREATE OR REPLACE that removes parameter defaults
-- ("cannot remove parameter defaults from existing function").

drop function if exists public.upsert_linkedin_inbound_route(uuid, text, uuid);

create or replace function public.upsert_linkedin_inbound_route(
  p_seat_id uuid,
  p_operator_label text,
  p_workspace_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  wid uuid;
  seat public.agent_seats%rowtype;
  key text;
  route_id uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    wid := p_workspace_id;
    if wid is null then
      return json_build_object('ok', false, 'reason', 'workspace-required');
    end if;
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
       where p.workspace_id = wid and p.id = auth.uid() and p.role = 'admin'
    ) then
      return json_build_object('ok', false, 'reason', 'admin-required');
    end if;
  end if;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API', 'HeyReach') then
    return json_build_object('ok', false, 'reason', 'not-linkedin-seat');
  end if;

  begin
    key := encode(public.gen_random_bytes(24), 'hex');
  exception
    when undefined_function then
      key := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end;

  insert into public.linkedin_inbound_routes (workspace_id, seat_id, route_key, operator_label, active)
  values (wid, p_seat_id, key, coalesce(btrim(p_operator_label), ''), true)
  on conflict (workspace_id, seat_id) do update
    set operator_label = excluded.operator_label,
        active = true;

  select id, route_key into route_id, key
    from public.linkedin_inbound_routes
   where workspace_id = wid and seat_id = p_seat_id;

  if route_id is null then
    return json_build_object('ok', false, 'reason', 'route-upsert-failed');
  end if;

  return json_build_object(
    'ok', true,
    'route_id', route_id,
    'route_key', key,
    'seat_id', p_seat_id,
    'provider', seat.provider
  );
end;
$$;

revoke all on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  to authenticated, service_role;
