-- Serialize the per-seat daily cap in claim_and_record. The seat lookup, cap
-- count and 'claimed' insert previously ran with no per-seat lock, so two
-- concurrent claims for DIFFERENT candidates on the same seat could both read
-- used_today = cap - 1, both pass the check and both insert — landing the seat
-- at cap + 1 (outreach_ledger_active_uniq only de-dupes per candidate, not per
-- seat). Locking the agent_seats row (select ... for update) blocks the second
-- claimant until the first commits; its count(*) then runs on a fresh snapshot
-- that includes the committed 'claimed' row, so at cap - 1 exactly one claim
-- wins and the loser fails closed with 'seat daily cap reached'.
--
-- Lock order: claim_email_outbound (0011) locks the outreach_approvals row
-- FIRST, then invokes this function, which locks agent_seats. Any future
-- function must keep that approvals-before-seats ordering — locking
-- agent_seats before an approvals row would invert it and risk deadlock.
--
-- The header deliberately saves search_path = pg_catalog, public, pg_temp
-- (the 0019 hardened state — create or replace would otherwise reset the
-- saved proconfig), and the body deliberately has NO auth.role() assertion:
-- the authenticated claim_email_outbound SECURITY DEFINER wrapper invokes
-- this as the function owner. Direct callers stay service_role-only via ACL.

create or replace function public.claim_and_record(
  p_candidate_id    text,
  p_candidate_email text,
  p_campaign_id     text,
  p_seat_id         uuid,
  p_channel         text default 'Email',
  p_recontact_days  int  default 90
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  wid        uuid := public.current_workspace_id();
  domain     text := lower(split_part(coalesce(p_candidate_email,''), '@', 2));
  seat       public.agent_seats%rowtype;
  used_today int;
  cap        int;
  new_id     uuid;
begin
  if wid is null then return json_build_object('allowed', false, 'reason', 'no workspace'); end if;

  -- suppression (email / domain)
  if exists (
    select 1 from public.suppression_list s
     where s.workspace_id = wid
       and (s.expires_at is null or s.expires_at > now())
       and ((s.type='email' and lower(s.value)=lower(p_candidate_email))
         or (s.type='domain' and lower(s.value)=domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  -- re-contact window across the whole fleet
  if exists (
    select 1 from public.outreach_ledger l
     where l.workspace_id = wid and l.candidate_id = p_candidate_id
       and l.status in ('claimed','sent') and l.at > now() - make_interval(days => p_recontact_days)
  ) then
    return json_build_object('allowed', false, 'reason', 'recently contacted');
  end if;

  -- per-seat daily cap (effective warm-up cap). The row lock serializes
  -- concurrent claims on the same seat so the count below cannot race.
  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat not found'); end if;
  if seat.status <> 'active' then return json_build_object('allowed', false, 'reason', 'seat not active'); end if;

  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(seat.daily_limit,
                 greatest(seat.warmup_start_cap,
                          seat.warmup_start_cap + seat.warmup_step_per_day *
                          floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int));
  end if;

  select count(*) into used_today from public.outreach_ledger
   where seat_id = p_seat_id and at::date = now()::date and status in ('claimed','sent');
  if used_today >= cap then
    return json_build_object('allowed', false, 'reason', 'seat daily cap reached');
  end if;

  -- atomic insert as 'claimed' — holds the de-dupe slot (the unique index, daily
  -- cap and re-contact checks all include 'claimed'). The caller reconciles to
  -- 'sent' after the provider responds, or 'skipped' on failure (so it retries).
  begin
    insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status)
      values (wid, p_candidate_id, p_candidate_email, p_seat_id, p_campaign_id, p_channel, 'claimed')
      returning id into new_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already contacted');
  end;

  return json_build_object('allowed', true, 'reason', 'ok', 'ledger_id', new_id);
end;
$$;

-- Re-assert the 0019 ACL end-state: service_role-only execute, nothing for
-- PUBLIC or the API roles (the authenticated email path goes through the
-- claim_email_outbound wrapper, which invokes this as the function owner).
revoke all on function public.claim_and_record(text,text,text,uuid,text,int) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_and_record(text,text,text,uuid,text,int) to service_role;
