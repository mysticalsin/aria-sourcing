-- Drop the LinkedIn bridge created by 0006–0008.
--
-- Those migrations stay immutable. This forward migration removes the tables
-- and the helper, because the Chrome extension, session bridge and Voyager
-- client are not a permitted LinkedIn integration. Do not recreate them.

drop function if exists public.linkedin_bridge_candidate(uuid, text);

drop table if exists public.linkedin_bridge_messages;
drop table if exists public.linkedin_bridge_outbox;
drop table if exists public.linkedin_bridge_contacts;
drop table if exists public.linkedin_bridge_conversations;
drop table if exists public.linkedin_bridge_accounts;
