-- 0060_linkedin_campaign_launch_two_drafts.sql
--
-- S6 targeting (docs/outreach/ARIA-LINKEDIN-CONNECT.md, section 4). The
-- launch sheet now shows two drafts per person: the connection note (sent
-- first to anyone who is not a connection) and the first message (sent to
-- connections, or once a connection request is accepted). One tap approves
-- both, so a full shortlist of 20 people is 40 drafts.
--
-- Additive over 0059. launch_linkedin_campaign is the 0057 body with exactly
-- one change: the per-tap draft ceiling goes from 20 to 40 (two per person).
-- Every draft is still validated before the first write, every approval row
-- is still written only from p_drafts, and nothing else moves. The approval
-- trigger, both claims and the revoke are untouched.

create or replace function public.launch_linkedin_campaign(
  p_campaign_id text,
  p_seat_id uuid,
  p_drafts jsonb,
  p_calendar_seat_id uuid default null,
  p_interviewer_email text default '',
  p_role_title text default '',
  p_daily_cap int default 20,
  p_quiet_start int default 21,
  p_quiet_end int default 8,
  p_timezone text default 'UTC'
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  campaign text := btrim(coalesce(p_campaign_id, ''));
  seat public.agent_seats%rowtype;
  grant_row public.linkedin_reply_grants%rowtype;
  draft jsonb;
  draft_message_id text;
  draft_body_hash text;
  draft_scope_hash text;
  approved int := 0;
  added boolean := false;
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if length(campaign) not between 1 and 120 then
    return json_build_object('ok', false, 'reason', 'invalid-campaign');
  end if;

  -- No drafts shown means no launch. Nothing is written.
  if p_drafts is null or jsonb_typeof(p_drafts) <> 'array' or jsonb_array_length(p_drafts) = 0 then
    return json_build_object('ok', false, 'reason', 'no-drafts-shown');
  end if;
  if jsonb_array_length(p_drafts) > 40 then
    return json_build_object('ok', false, 'reason', 'too-many-drafts');
  end if;

  -- Validate every draft before the first write.
  for draft in select value from jsonb_array_elements(p_drafts) loop
    if jsonb_typeof(draft) <> 'object' then
      return json_build_object('ok', false, 'reason', 'invalid-draft');
    end if;
    draft_message_id := draft ->> 'message_id';
    draft_body_hash := draft ->> 'body_hash';
    draft_scope_hash := draft ->> 'scope_hash';
    if draft_message_id is null or length(draft_message_id) not between 1 and 120
      or draft_body_hash is null or draft_body_hash !~ '^[0-9a-f]{64}$'
      or draft_scope_hash is null or draft_scope_hash !~ '^[0-9a-f]{64}$'
    then
      return json_build_object('ok', false, 'reason', 'invalid-draft', 'message_id', draft_message_id);
    end if;
    if exists (
      select 1 from public.outreach_ledger l
        where l.workspace_id = wid
          and l.approval_message_id = draft_message_id
          and l.status in ('claimed', 'sent', 'ambiguous')
    ) then
      return json_build_object('ok', false, 'reason', 'already-dispatching', 'message_id', draft_message_id);
    end if;
  end loop;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
  if not found or seat.provider not in ('LinkedIn Vendor API', 'LinkedIn Assisted Manual') then
    return json_build_object('ok', false, 'reason', 'seat-not-linkedin');
  end if;
  if p_calendar_seat_id is not null and not exists (
    select 1 from public.agent_seats s
      where s.id = p_calendar_seat_id and s.workspace_id = wid and s.provider in ('Gmail API', 'Microsoft Graph')
  ) then
    return json_build_object('ok', false, 'reason', 'calendar-seat-invalid');
  end if;

  -- A live campaign grant is reused: this tap is "Add to launch". A live
  -- reply-only grant is not silently widened into a campaign launch.
  select * into grant_row
    from public.linkedin_reply_grants
    where workspace_id = wid and channel = 'LinkedIn' and campaign_id = campaign and revoked_at is null
    for update;
  if found then
    if grant_row.scope <> 'campaign' then
      return json_build_object('ok', false, 'reason', 'already-launched');
    end if;
    added := true;
  else
    begin
      insert into public.linkedin_reply_grants(
        workspace_id, channel, scope, campaign_id, vendor_campaign_id, seat_id, calendar_seat_id,
        interviewer_email, role_title, daily_cap, quiet_start, quiet_end, timezone, granted_by
      ) values (
        wid, 'LinkedIn', 'campaign', campaign, null, p_seat_id, p_calendar_seat_id,
        coalesce(p_interviewer_email, ''), coalesce(p_role_title, ''),
        coalesce(p_daily_cap, 20), coalesce(p_quiet_start, 21), coalesce(p_quiet_end, 8), coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
        actor_id
      ) returning * into grant_row;
    exception when unique_violation then
      return json_build_object('ok', false, 'reason', 'already-launched');
    end;
  end if;

  -- One human approval row per shown draft, bound to this launch. Same shape
  -- as record_outreach_approval (0011): a re-launch of an edited draft
  -- replaces the hash, so the old copy is no longer dispatchable.
  for draft in select value from jsonb_array_elements(p_drafts) loop
    insert into public.outreach_approvals(
      workspace_id, message_id, body_hash, approval_scope_hash, approved_by, approved_at,
      approval_source, revoked_at, revoked_by, revocation_reason, linkedin_reply_grant_id
    ) values (
      wid, draft ->> 'message_id', draft ->> 'body_hash', draft ->> 'scope_hash', actor_id, now(),
      'human', null, null, null, grant_row.id
    ) on conflict (workspace_id, message_id) do update
      set body_hash = excluded.body_hash,
          approval_scope_hash = excluded.approval_scope_hash,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null,
          linkedin_reply_grant_id = excluded.linkedin_reply_grant_id;
    approved := approved + 1;
  end loop;

  return json_build_object('ok', true, 'grant_id', grant_row.id, 'scope', 'campaign', 'approved', approved, 'added', added);
end;
$$;

-- Privileges exactly as 0057: the launch is a human action, service_role never launches.
revoke all on function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) to authenticated;
alter function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) owner to postgres;
