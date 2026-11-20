-- Drop the agents-runner tables created by 0009.
--
-- 0009 stays immutable. Those tables stored standing approvals that queued
-- LinkedIn messages without a per-message approval (agent_campaign_autopilots),
-- plus delegations, missions, and the outreach queue. This forward migration
-- removes them. It is unapplied until a database runs it. Existing databases
-- keep the rows until then.
--
-- Drop order follows foreign keys: outreach references missions.

drop table if exists public.agent_outreach;
drop table if exists public.agent_missions;
drop table if exists public.agent_campaign_autopilots;
drop table if exists public.agent_delegations;
