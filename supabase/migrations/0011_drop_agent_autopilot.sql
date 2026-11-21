-- Forward-only drop of the agents-runner tables created by 0009.
-- There is no down migration: recreating these tables would restore standing
-- approvals that queued messages without a per-message approval. 0009 stays
-- immutable, including its enabled and contact_enabled defaults and the
-- queue_linkedin scope default. This drop removes those tables instead of
-- leaving the defaults in place.
--
-- Safe on an existing database:
-- * drop table if exists does not error when the table is already gone.
-- * agent_outreach is dropped before agent_missions because outreach
--   references missions. The other two tables are not referenced by this set.
-- * No other table is dropped.
-- * This migration is unapplied. An existing database keeps the rows until
--   it runs. Applying it deletes them.

drop table if exists public.agent_outreach;
drop table if exists public.agent_missions;
drop table if exists public.agent_campaign_autopilots;
drop table if exists public.agent_delegations;
