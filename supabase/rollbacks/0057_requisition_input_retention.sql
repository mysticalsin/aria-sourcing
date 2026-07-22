-- Guarded rollback for 0057. Raw content cannot be reconstructed after a
-- cleanup, and cleanup receipts are audit evidence. Refuse rollback whenever
-- either condition exists.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(570057202607210057::bigint);

do $aria_requisition_input_retention_rollback_guard$
declare
  cleanup_evidence_exists boolean := false;
  scrubbed_content_exists boolean := false;
begin
  if to_regclass('public.requisition_input_cleanup_receipts') is not null then
    execute 'lock table public.requisition_input_cleanup_receipts in access exclusive mode';
    execute 'select exists (select 1 from public.requisition_input_cleanup_receipts)'
      into cleanup_evidence_exists;
  end if;
  if to_regclass('public.requisition_inputs') is not null then
    execute 'lock table public.requisition_inputs in access exclusive mode';
    execute 'select exists (select 1 from public.requisition_inputs where content is null)'
      into scrubbed_content_exists;
  end if;
  if cleanup_evidence_exists or scrubbed_content_exists then
    raise exception 'refusing 0057 rollback because raw requisition cleanup evidence exists'
      using errcode = '55000';
  end if;
end;
$aria_requisition_input_retention_rollback_guard$;

drop function if exists public.cleanup_requisition_input_authority(uuid, integer);
drop function if exists public.configure_requisition_input_retention(uuid, integer);

drop function if exists public.ingest_requisition_and_enqueue(uuid, text, text, text);
alter function public.ingest_requisition_and_enqueue_pre0057(uuid, text, text, text)
  rename to ingest_requisition_and_enqueue;
revoke all on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists requisition_input_cleanup_receipts_enforce_mutation
  on public.requisition_input_cleanup_receipts;
drop table if exists public.requisition_input_cleanup_receipts;
drop function if exists public.enforce_requisition_input_cleanup_receipt_mutation();

drop trigger if exists requisition_inputs_content_lifecycle
  on public.requisition_inputs;
drop function if exists public.enforce_requisition_input_content_lifecycle();
alter table public.requisition_inputs
  drop constraint requisition_inputs_content_lifecycle_check;
alter table public.requisition_inputs
  alter column content set not null;
alter table public.requisition_inputs
  drop column content_scrubbed_at;
alter table public.requisition_inputs
  add constraint requisition_inputs_content_check check (
    char_length(content) between 20 and 100000
    and octet_length(content) between 20 and 100000
    and content = btrim(content)
  );
drop index if exists public.requisition_inputs_workspace_requisition_uniq;

alter table public.sourcing_loop_controls
  drop constraint sourcing_loop_controls_raw_requisition_retention_days_check;
alter table public.sourcing_loop_controls
  drop column raw_requisition_retention_days;

commit;
