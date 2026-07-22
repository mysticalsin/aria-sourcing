-- Guarded rollback for 0055 AI runtime binding authority. Activated or staged
-- evidence must be reconciled explicitly before schema removal.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(550055202607210055::bigint);

do $aria_ai_runtime_binding_rollback_guard$
declare
  contains_rows boolean := false;
begin
  if to_regclass('public.ai_runtime_binding_receipts') is not null then
    execute 'lock table public.ai_runtime_binding_receipts in access exclusive mode';
  end if;
  if to_regclass('public.ai_runtime_bindings') is not null then
    execute 'lock table public.ai_runtime_bindings in access exclusive mode';
  end if;
  if to_regclass('public.ai_runtime_model_evidence') is not null then
    execute 'lock table public.ai_runtime_model_evidence in access exclusive mode';
  end if;
  if to_regclass('public.ai_runtime_binding_sets') is not null then
    execute 'lock table public.ai_runtime_binding_sets in access exclusive mode';
  end if;
  if to_regclass('public.ai_provider_catalog') is not null then
    execute 'lock table public.ai_provider_catalog in access exclusive mode';
  end if;

  if to_regclass('public.ai_runtime_binding_sets') is not null then
    execute 'select exists (select 1 from public.ai_runtime_binding_sets)'
      into contains_rows;
  end if;
  if not contains_rows and to_regclass('public.ai_runtime_bindings') is not null then
    execute 'select exists (select 1 from public.ai_runtime_bindings)'
      into contains_rows;
  end if;
  if not contains_rows and to_regclass('public.ai_runtime_binding_receipts') is not null then
    execute 'select exists (select 1 from public.ai_runtime_binding_receipts)'
      into contains_rows;
  end if;
  if not contains_rows and to_regclass('public.ai_runtime_model_evidence') is not null then
    execute 'select exists (select 1 from public.ai_runtime_model_evidence)'
      into contains_rows;
  end if;
  if contains_rows then
    raise exception 'refusing 0055 rollback because AI runtime binding authority contains rows'
      using errcode = '55000';
  end if;
end;
$aria_ai_runtime_binding_rollback_guard$;

drop function if exists public.stage_ai_runtime_binding_set(uuid, uuid, uuid, text, text, uuid, text, text, uuid);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid);
drop function if exists public.stage_ai_runtime_binding_set(uuid, text, text, uuid, text, text, uuid, uuid);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid, uuid);
drop function if exists public.stage_ai_runtime_binding_set(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid, uuid);
drop function if exists public.stage_ai_runtime_binding_set(uuid, text, text, uuid, text, text, uuid);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid);
drop function if exists public.resolve_active_ai_runtime_binding(uuid, text);
drop function if exists public.insert_ai_runtime_binding_receipt(uuid, uuid, uuid, text, uuid, uuid, text);
drop function if exists public.ai_runtime_binding_set_credentials_valid(uuid, uuid);
drop function if exists public.ai_runtime_binding_set_structurally_valid(uuid, uuid);
drop function if exists public.ai_runtime_model_evidence_matches(uuid, uuid, uuid, text, text, text, smallint, text, text, boolean);
drop function if exists public.record_ai_runtime_model_evidence(uuid, uuid, text, text, text);

drop table if exists public.ai_runtime_binding_receipts;
drop table if exists public.ai_runtime_bindings;
drop table if exists public.ai_runtime_binding_sets;
drop table if exists public.ai_runtime_model_evidence;
drop table if exists public.ai_provider_catalog;

drop trigger if exists ai_bound_credential_enforce_lifecycle on public.api_keys;
drop function if exists public.reject_ai_runtime_binding_receipt_mutation();
drop function if exists public.reject_ai_runtime_binding_mutation();
drop function if exists public.reject_ai_runtime_model_evidence_mutation();
drop function if exists public.enforce_ai_runtime_binding_set_lifecycle();
drop function if exists public.enforce_ai_bound_credential_lifecycle();
drop function if exists public.ai_execution_credential_verified(text, text, timestamptz, text, integer);
drop function if exists public.reject_ai_provider_catalog_mutation();

alter table public.api_keys drop column if exists verification_http_status;
alter table public.api_keys drop column if exists verification_method;

commit;
