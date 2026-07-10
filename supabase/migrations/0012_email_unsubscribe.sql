-- 0012_email_unsubscribe.sql
--
-- Store only a SHA-256 digest of the opaque recipient token. The public
-- one-click endpoint resolves a ledger row through the service client and
-- writes the existing workspace-scoped suppression list.

alter table public.outreach_ledger
  add column if not exists email_unsubscribe_token_hash text;

alter table public.outreach_ledger
  add constraint outreach_ledger_email_unsubscribe_token_hash_check
  check (
    email_unsubscribe_token_hash is null
    or email_unsubscribe_token_hash ~ '^[0-9a-f]{64}$'
  ) not valid;

create unique index if not exists outreach_ledger_email_unsubscribe_token_hash_uniq
  on public.outreach_ledger (email_unsubscribe_token_hash)
  where email_unsubscribe_token_hash is not null;
