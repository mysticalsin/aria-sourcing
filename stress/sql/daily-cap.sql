-- Disposable cap database for the A1 sweep. This function is not defined by
-- supabase/migrations/0013_outreach_approval_race_safety.sql. auth.role() is
-- stubbed so a vanilla Postgres can act as service_role. No production data.

create schema if not exists auth;

create or replace function auth.role()
returns text
language sql
stable
as $$ select 'service_role'::text $$;

create table if not exists public.outreach_channel_daily_sends (
  workspace_id uuid not null,
  channel text not null,
  send_day date not null,
  sent_count integer not null default 0,
  primary key (workspace_id, channel, send_day)
);

create or replace function public.consume_outreach_channel_daily_cap(p_workspace_id uuid, p_channel text, p_cap integer)
returns json
language plpgsql
as $$
declare
  wid uuid;
  utc_day date := (now() at time zone 'UTC')::date;
  next_count integer;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    wid := p_workspace_id;
  else
    return json_build_object('allowed', false, 'reason', 'not-authenticated');
  end if;
  if wid is null or p_channel is null or btrim(p_channel) = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-message');
  end if;
  if p_cap is null or p_cap <= 0 then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;

  insert into public.outreach_channel_daily_sends as daily (workspace_id, channel, send_day, sent_count)
  values (wid, p_channel, utc_day, 1)
  on conflict (workspace_id, channel, send_day)
  do update set sent_count = daily.sent_count + 1
  where daily.sent_count < p_cap
  returning sent_count into next_count;

  if next_count is null then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;
  return json_build_object('allowed', true, 'reason', 'authorized', 'sent_count', next_count);
end;
$$;
