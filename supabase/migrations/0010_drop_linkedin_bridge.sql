-- Forward-only retention gate for the bridge created by 0006-0008.
-- There is no down migration. 0006-0008 stay immutable.
--
-- This migration deletes no bridge rows. A drop runs only when the session
-- has set aria.bridge_legal_hold_cleared to true, which records that no
-- legal hold applies. The default keeps every row.
--
-- Safe on an existing database: without that clearance the tables stay,
-- including token_hash on linkedin_bridge_accounts. This migration is
-- unapplied until a database runs it. Existing databases keep token_hash
-- until a cleared run drops the tables.

do $aria_bridge_retention$
begin
  if current_setting('aria.bridge_legal_hold_cleared', true) is distinct from 'true' then
    raise notice 'linkedin bridge tables kept; drop requires aria.bridge_legal_hold_cleared=true';
    return;
  end if;

  execute 'drop function if exists public.linkedin_bridge_candidate(uuid, text)';
  execute 'drop table if exists public.linkedin_bridge_messages';
  execute 'drop table if exists public.linkedin_bridge_outbox';
  execute 'drop table if exists public.linkedin_bridge_contacts';
  execute 'drop table if exists public.linkedin_bridge_conversations';
  execute 'drop table if exists public.linkedin_bridge_accounts';
end
$aria_bridge_retention$;
