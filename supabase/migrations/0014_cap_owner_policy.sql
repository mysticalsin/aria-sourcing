-- db-init removes bypassrls from postgres. Forced row security then hides
-- these tables from the security-definer claims, so a real send looks like
-- a cap refusal. The owner policy is the only read and write path. Members
-- still have no grant and no policy.

create policy outreach_channel_cap_config_owner
  on public.outreach_channel_cap_config
  for all
  to postgres
  using (true)
  with check (true);

create policy outreach_channel_daily_sends_owner
  on public.outreach_channel_daily_sends
  for all
  to postgres
  using (true)
  with check (true);

create policy outreach_ledger_events_owner
  on public.outreach_ledger_events
  for all
  to postgres
  using (true)
  with check (true);
