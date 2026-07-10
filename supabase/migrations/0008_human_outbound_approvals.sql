-- 0008_human_outbound_approvals.sql
--
-- An approval only releases an external message when a named authenticated
-- operator recorded it. Existing rows predate provenance and are deliberately
-- fail-closed until an operator reviews and approves the exact text again.

alter table public.outreach_approvals
  add column if not exists approval_source text;

update public.outreach_approvals
  set approval_source = 'legacy_unverified'
  where approval_source is null;

alter table public.outreach_approvals
  alter column approval_source set default 'human';

alter table public.outreach_approvals
  alter column approval_source set not null;

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_approval_source_check;

alter table public.outreach_approvals
  add constraint outreach_approvals_approval_source_check
  check (approval_source in ('human', 'legacy_unverified'));

comment on column public.outreach_approvals.approval_source is
  'Only human approvals may release an external message. Pre-provenance rows are legacy_unverified and require re-approval.';
