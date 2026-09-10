-- 0083: AriaBot Browser Computer seats may register LinkedIn inbound routes.
--
-- Prod symptom after ENABLE_PUBLIC_DEMO_ARIABOT: ensure_connect created the
-- LinkedIn Browser Computer seat, then upsert_linkedin_inbound_route returned
-- reason not-linkedin-seat because 0058/0060 only allowed Assisted Manual +
-- Vendor API.

create or replace function public.upsert_linkedin_inbound_route(
  p_seat_id uuid,
  p_operator_label text default '',
  p_workspace_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  role_name text := coalesce(auth.role(), '');
  wid uuid;
  seat public.agent_seats%rowtype;
  route_id uuid;
  key text;
begin
  if p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'missing-seat');
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
       where p.workspace_id = wid and p.id = auth.uid() and p.role = 'admin'
    ) then
      return json_build_object('ok', false, 'reason', 'admin-required');
    end if;
  end if;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.provider not in (
    'LinkedIn Assisted Manual',
    'LinkedIn Vendor API',
    'LinkedIn Browser Computer'
  ) then
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
    'workspace_id', wid
  );
end;
$$;

revoke all on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  to service_role, authenticated;
