-- Guarded rollback for 0056. Once any credential or receipt exists, removal
-- would destroy security and audit evidence, so rollback must fail closed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(560056202607210056::bigint);

do $aria_need_ingress_credential_rollback_guard$
declare
  contains_rows boolean := false;
begin
  if to_regclass('public.need_ingress_credential_receipts') is not null then
    execute 'lock table public.need_ingress_credential_receipts in access exclusive mode';
    execute 'select exists (select 1 from public.need_ingress_credential_receipts)'
      into contains_rows;
  end if;
  if not contains_rows and to_regclass('public.need_ingress_credentials') is not null then
    execute 'lock table public.need_ingress_credentials in access exclusive mode';
    execute 'select exists (select 1 from public.need_ingress_credentials)'
      into contains_rows;
  end if;
  if contains_rows then
    raise exception 'refusing 0056 rollback because need ingress credential evidence exists'
      using errcode = '55000';
  end if;
end;
$aria_need_ingress_credential_rollback_guard$;

drop function if exists public.ingest_requisition_with_credential(uuid, text, text, text, text);
drop function if exists public.resolve_need_ingress_credential(text);
drop function if exists public.revoke_need_ingress_credential(uuid, uuid, uuid);
drop function if exists public.create_need_ingress_credential(text, text, timestamptz, uuid, uuid);
drop function if exists public.revoke_need_ingress_credential(uuid, uuid);
drop function if exists public.create_need_ingress_credential(text, text, timestamptz, uuid);

drop table if exists public.need_ingress_credential_receipts;
drop table if exists public.need_ingress_credentials;

drop function if exists public.enforce_need_ingress_credential_receipt_mutation();
drop function if exists public.enforce_need_ingress_credential_mutation();

-- Safe only because the guard proved that no 0056 authority was issued.
grant execute on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  to service_role;

commit;
