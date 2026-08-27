-- 0066_calendar_meeting_url.sql
-- Persist Teams/Outlook meeting join URL on calendar_booking_ledger so
-- confirmLive replays and the UI can surface the join link after Graph create.

alter table public.calendar_booking_ledger
  add column if not exists meeting_url text
  check (meeting_url is null or char_length(meeting_url) between 1 and 2000);

create or replace function public.claim_calendar_booking(
  p_workspace_id uuid,
  p_candidate_id text,
  p_start_time timestamptz,
  p_request_id text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  existing_row public.calendar_booking_ledger%rowtype;
  new_row public.calendar_booking_ledger%rowtype;
  violated_constraint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_candidate_id is null
     or char_length(p_candidate_id) not between 1 and 200
     or p_start_time is null
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_provider is null
     or p_provider not in ('Gmail API', 'Microsoft Graph') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into existing_row
    from public.calendar_booking_ledger
   where workspace_id = p_workspace_id and request_id = p_request_id
   for update;
  if found then
    if existing_row.candidate_id <> p_candidate_id
       or existing_row.start_time <> p_start_time
       or existing_row.provider <> p_provider then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'claimed',
      'id', existing_row.id,
      'booking_status', existing_row.status,
      'external_event_id', existing_row.external_event_id,
      'meeting_url', existing_row.meeting_url,
      'replay', true
    );
  end if;

  begin
    insert into public.calendar_booking_ledger (
      workspace_id, candidate_id, start_time, request_id, provider, status
    ) values (
      p_workspace_id, p_candidate_id, p_start_time, p_request_id, p_provider, 'claimed'
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'calendar_booking_ledger_workspace_request_uniq' then
      select * into existing_row
        from public.calendar_booking_ledger
       where workspace_id = p_workspace_id and request_id = p_request_id
       for update;
      if existing_row.candidate_id <> p_candidate_id
         or existing_row.start_time <> p_start_time
         or existing_row.provider <> p_provider then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'claimed',
        'id', existing_row.id,
        'booking_status', existing_row.status,
        'external_event_id', existing_row.external_event_id,
        'meeting_url', existing_row.meeting_url,
        'replay', true
      );
    end if;
    return jsonb_build_object('status', 'double_booked');
  end;

  return jsonb_build_object(
    'status', 'claimed',
    'id', new_row.id,
    'booking_status', new_row.status,
    'external_event_id', new_row.external_event_id,
    'meeting_url', new_row.meeting_url,
    'replay', false
  );
end;
$$;

drop function if exists public.reconcile_calendar_booking(uuid, uuid, text, text, text);

create function public.reconcile_calendar_booking(
  p_workspace_id uuid,
  p_id uuid,
  p_status text,
  p_external_event_id text default null,
  p_detail text default null,
  p_meeting_url text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  row_rec public.calendar_booking_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_id is null
     or p_status is null
     or p_status not in ('confirmed', 'failed', 'released')
     or (p_external_event_id is not null and char_length(p_external_event_id) not between 1 and 512)
     or (p_detail is not null and char_length(p_detail) > 1000)
     or (p_meeting_url is not null and char_length(p_meeting_url) not between 1 and 2000) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  update public.calendar_booking_ledger
     set status = p_status,
         external_event_id = coalesce(p_external_event_id, external_event_id),
         meeting_url = coalesce(p_meeting_url, meeting_url),
         detail = coalesce(p_detail, detail),
         updated_at = now()
   where id = p_id
     and workspace_id = p_workspace_id
     and status = 'claimed'
  returning * into row_rec;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'reconciled',
    'id', row_rec.id,
    'booking_status', row_rec.status,
    'meeting_url', row_rec.meeting_url
  );
end;
$$;

revoke all on function public.claim_calendar_booking(uuid, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_calendar_booking(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_calendar_booking(uuid, text, timestamptz, text, text) to service_role;
grant execute on function public.reconcile_calendar_booking(uuid, uuid, text, text, text, text) to service_role;
