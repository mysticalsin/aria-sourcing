-- Forward-only drop of the bridge created by 0006–0008.
-- There is no down migration: recreating these tables would restore a
-- banned session bridge. 0006–0008 stay immutable.
--
-- Safe on an existing database:
-- * drop table if exists does not error when the table is already gone.
-- * Children are dropped before parents (messages, outbox, contacts,
--   conversations, then accounts), so foreign keys inside this set do not
--   block the drop.
-- * No other table is dropped. Candidate profile URLs live elsewhere and stay.
-- * This migration is unapplied. Until it runs, linkedin_bridge_accounts
--   still holds token_hash.
-- * Applying it deletes those rows, including token_hash. That is destructive.

drop function if exists public.linkedin_bridge_candidate(uuid, text);

drop table if exists public.linkedin_bridge_messages;
drop table if exists public.linkedin_bridge_outbox;
drop table if exists public.linkedin_bridge_contacts;
drop table if exists public.linkedin_bridge_conversations;
drop table if exists public.linkedin_bridge_accounts;
