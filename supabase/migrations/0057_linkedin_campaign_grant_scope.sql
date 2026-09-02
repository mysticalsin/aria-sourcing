-- 0057_linkedin_campaign_grant_scope.sql
--
-- Campaign launch scope (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S3).
-- One tap on "Launch outreach" is the human approval of the exact first-touch
-- drafts the operator saw in the launch sheet. The tap records one campaign
-- grant plus one outreach_approvals row per shown draft in the same
-- transaction, so the existing 0054 trigger and claim keep enforcing "no
-- approval, no send" with no bypass: a first-touch row still needs its own
-- human approval row, and that row now comes from the launch.
--
-- Additive over 0055 and 0056. The approval trigger body is untouched.
--
-- Authority model
--   linkedin_reply_grants.scope            'replies' (the reply loop only, 0055
--                                          launch) or 'campaign' (Launch outreach:
--                                          first touches under the grant, replies
--                                          under the same grant).
--   outreach_approvals.linkedin_reply_grant_id
--                                          binds an approval row to the launch
--                                          that wrote it, so a revoke can pull
--                                          exactly those drafts back.
--   launch_linkedin_campaign               the one human tap. Refuses with no
--                                          drafts shown; writes approvals only
--                                          for the drafts it was handed.
--                                          A second tap on a live campaign
--                                          grant is "Add to launch".
--   revoke_linkedin_reply_loop             gains: approvals bound to a revoked
--                                          grant are revoked, queued first-touch
--                                          rows go back to composed (a draft).

-- ---------------------------------------------------------------------------
-- 1. Grant scope (default 'replies' keeps every existing grant as it was)
-- ---------------------------------------------------------------------------
alter table public.linkedin_reply_grants
  add column if not exists scope text not null default 'replies';

alter table public.linkedin_reply_grants
  drop constraint if exists linkedin_reply_grants_scope_check;
alter table public.linkedin_reply_grants
  add constraint linkedin_reply_grants_scope_check
  check (scope in ('replies', 'campaign'));

-- ---------------------------------------------------------------------------
-- 2. Approval rows remember the launch that wrote them
-- ---------------------------------------------------------------------------
alter table public.outreach_approvals
  add column if not exists linkedin_reply_grant_id uuid references public.linkedin_reply_grants(id) on delete set null;

create index if not exists outreach_approvals_linkedin_grant_idx
  on public.outreach_approvals (linkedin_reply_grant_id)
  where linkedin_reply_grant_id is not null;

-- ---------------------------------------------------------------------------
-- 3. launch_linkedin_campaign: the human tap for a shown list of drafts.
--    p_drafts is a json array of { message_id, body_hash, scope_hash } where
--    body_hash = sha256(subject || '\n' || body) of the draft exactly as it was
--    shown and scope_hash = sha256(candidate_id || '\n' || channel || '\n' ||
--    profile_url), the same two hashes 0054 re-checks at dispatch. Every
--    draft is validated before anything is written; an empty list writes
--    nothing, not even the grant.
-- ---------------------------------------------------------------------------
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
  if jsonb_array_length(p_drafts) > 20 then
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

-- ---------------------------------------------------------------------------
-- 4. revoke_linkedin_reply_loop: 0055 body plus the campaign pull-back. Every
--    approval a revoked launch wrote is revoked (unless that message already
--    entered delivery) and every queued first-touch row it covered goes back
--    to composed, a visible draft for a person.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_linkedin_reply_loop(p_grant_id uuid, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  revoked_ids uuid[] := '{}';
  affected int;
  drafts_pulled int := 0;
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;

  with revoked as (
    update public.linkedin_reply_grants
       set revoked_at = now(), revoked_by = actor_id, revoke_reason = left(coalesce(p_reason, 'revoked'), 200)
     where (p_grant_id is null or id = p_grant_id)
       and workspace_id = wid
       and revoked_at is null
     returning id
  )
  select coalesce(array_agg(id), '{}') into revoked_ids from revoked;
  affected := coalesce(array_length(revoked_ids, 1), 0);

  -- Anything still waiting its delay is pulled back to a visible draft.
  update public.messages_outbound
     set status = 'blocked',
         gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('linkedin-loop:campaign-launch-revoked'))
   where workspace_id = wid
     and channel = 'LinkedIn'
     and status = 'queued'
     and linkedin_reply_grant_id is not null
     and (p_grant_id is null or linkedin_reply_grant_id = p_grant_id);

  -- Campaign scope: the launch approvals are withdrawn and every first-touch
  -- row they covered goes back to draft. A message that already entered
  -- delivery keeps its approval so the ledger stays truthful.
  update public.outreach_approvals a
     set revoked_at = now(),
         revoked_by = actor_id,
         revocation_reason = 'linkedin-campaign:launch-revoked'
   where a.workspace_id = wid
     and a.linkedin_reply_grant_id = any(revoked_ids)
     and a.revoked_at is null
     and not exists (
       select 1 from public.outreach_ledger l
         where l.workspace_id = wid
           and l.approval_message_id = a.message_id
           and l.status in ('claimed', 'sent', 'ambiguous')
     );
  get diagnostics drafts_pulled = row_count;

  update public.messages_outbound m
     set status = 'composed',
         gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('linkedin-campaign:launch-revoked'))
   where m.workspace_id = wid
     and m.channel = 'LinkedIn'
     and m.status = 'queued'
     and m.linkedin_reply_grant_id is null
     and exists (
       select 1 from public.outreach_approvals a
         where a.workspace_id = wid
           and a.linkedin_reply_grant_id = any(revoked_ids)
           and a.message_id = coalesce(m.approval_message_id, m.id::text)
     );

  return json_build_object('ok', true, 'revoked', affected, 'drafts_pulled', drafts_pulled);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: the launch is a human action, service_role never launches.
-- ---------------------------------------------------------------------------
revoke all on function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.revoke_linkedin_reply_loop(uuid, text) from public, anon, authenticated, service_role, authenticator;

grant execute on function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) to authenticated;
grant execute on function public.revoke_linkedin_reply_loop(uuid, text) to authenticated;

alter function public.launch_linkedin_campaign(text, uuid, jsonb, uuid, text, text, int, int, int, text) owner to postgres;
alter function public.revoke_linkedin_reply_loop(uuid, text) owner to postgres;
