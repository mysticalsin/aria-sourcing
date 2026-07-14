-- 0022_email_send_reconciliation.sql
--
-- An email provider timeout or 5xx can arrive AFTER the provider accepted the
-- message.  Reconciling that unknown outcome to 'skipped' released the partial
-- unique indexes, so a retry of the same human approval could contact the same
-- candidate twice.  This migration ports the WhatsApp ambiguity doctrine
-- (0010: a worker must never retry an ambiguous external send) to the email
-- ledger: an unknown post-transport outcome becomes 'ambiguous', which keeps
-- holding the de-dupe slot until a human resolves it to 'sent' or 'skipped'
-- through the existing column-scoped (status, reason) update grant (0005).
-- Holding the candidate slot indefinitely until that human decision is the
-- intended fail-closed trade-off — the email analog of a WhatsApp outbox row
-- parked in 'dispatching'.  It is not a leak; do not "fix" it with a sweeper.

-- Immutable per-attempt identity, generated in the send route BEFORE any
-- provider call and written only by the service-role client (the email analog
-- of messages_outbound.delivery_attempt_id).  The same value travels to the
-- provider as an X-Aria-Send-Attempt header, so a human can match an ambiguous
-- ledger row against the provider's sent folder or logs.
alter table public.outreach_ledger
  add column if not exists send_attempt_id uuid;

create unique index if not exists outreach_ledger_send_attempt_uniq
  on public.outreach_ledger (send_attempt_id)
  where send_attempt_id is not null;

-- Extend both de-dupe predicates so an 'ambiguous' row keeps the slot: a retry
-- insert in claim_and_record hits unique_violation and fails closed ("already
-- contacted") without changing any pinned SECURITY DEFINER function.  Build
-- each replacement index before dropping the one it supersedes so a running
-- deployment never has an unprotected interval (same pattern as 0013).
create unique index if not exists outreach_ledger_active_reconcile_uniq
  on public.outreach_ledger (workspace_id, candidate_id)
  where status in ('claimed', 'sent', 'ambiguous');

drop index if exists public.outreach_ledger_active_uniq;

create unique index if not exists outreach_ledger_approval_message_reconcile_uniq
  on public.outreach_ledger (workspace_id, approval_message_id)
  where approval_message_id is not null
    and status in ('claimed', 'sent', 'ambiguous');

drop index if exists public.outreach_ledger_approval_message_live_uniq;

-- No grant changes: `status` is unconstrained text and authenticated already
-- holds the column-scoped update (status, reason) from 0005, so the route can
-- write 'ambiguous' under the caller's JWT while send_attempt_id stays
-- service-only (clients hold no update grant on it).
