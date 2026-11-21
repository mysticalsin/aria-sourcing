-- Forward-only retention gate for the autopilot tables created by 0009.
-- There is no down migration. 0009 stays immutable.
--
-- This migration deletes no autopilot rows. A drop runs only when the
-- session has set aria.bridge_legal_hold_cleared to true. The default keeps
-- every row. The drop is idempotent: drop table if exists does not error
-- when a table is already gone. No other table is dropped.
--
-- Safe on an existing database. This migration is unapplied until a database
-- runs it. Existing databases keep the rows until a cleared run drops them.
-- Drop order follows foreign keys: outreach references missions.

do $aria_autopilot_retention$
begin
  if current_setting('aria.bridge_legal_hold_cleared', true) is distinct from 'true' then
    raise notice 'autopilot tables kept; drop requires aria.bridge_legal_hold_cleared=true';
    return;
  end if;

  execute 'drop table if exists public.agent_outreach';
  execute 'drop table if exists public.agent_missions';
  execute 'drop table if exists public.agent_campaign_autopilots';
  execute 'drop table if exists public.agent_delegations';
end
$aria_autopilot_retention$;
