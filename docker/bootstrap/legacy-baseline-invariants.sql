-- Read-only invariants for adopting an ARIA schema that predates the ARIA
-- migration ledger. The caller must execute this file inside a READ ONLY
-- transaction and separately verify the canonical public-schema SHA-256.
do $aria_legacy_baseline_invariants$
declare
  actual_tables text;
  actual_functions text;
  non_rls_tables text;
  expected_tables constant text :=
    'agent_events,agent_runs,agent_seats,agent_specs,api_keys,databricks_connection_events,databricks_connections,dust_connection_events,dust_connections,email_connections,messages_inbound,messages_outbound,outbound_content_cache,outreach_approvals,outreach_ledger,profiles,suppression_list,whatsapp_contacts,whatsapp_conversation_windows,whatsapp_delivery_events,whatsapp_senders,whatsapp_templates,workspace_state,workspaces';
  expected_functions constant text :=
    'audit_databricks_connection_authority(),audit_dust_connection_authority(),claim_and_record(text,text,text,uuid,text,integer),claim_email_outbound(text,text,text,text,text,text,uuid),claim_whatsapp_inbound_processing(uuid,uuid),claim_whatsapp_outbound(uuid),complete_whatsapp_inbound_processing(uuid,uuid,text,text),current_profile_role(),current_workspace_id(),enforce_active_whatsapp_approval(),ensure_workspace(),finalize_whatsapp_provider_failure(uuid,uuid,text),normalize_whatsapp_e164(text),record_outreach_approval(text,text,text),record_whatsapp_delivery_event(uuid,uuid,text,text,timestamp with time zone,integer),record_whatsapp_provider_acceptance(uuid,uuid,text),review_whatsapp_outbound(uuid,text),revoke_outreach_approval(text,text),stamp_databricks_connection_authority(),stamp_dust_connection_authority(),strip_legacy_databricks_authority(),strip_legacy_dust_authority(),touch_updated_at()';
begin
  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into actual_tables
    from pg_tables
   where schemaname = 'public'
     and tablename <> 'aria_schema_migrations';

  if actual_tables <> expected_tables then
    raise exception 'legacy public table set does not match the reviewed ARIA schema'
      using errcode = '55000';
  end if;

  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into non_rls_tables
    from pg_tables
   where schemaname = 'public'
     and tablename <> 'aria_schema_migrations'
     and rowsecurity is false;

  if non_rls_tables <> '' then
    raise exception 'legacy public tables without RLS: %', non_rls_tables
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  if actual_functions <> expected_functions then
    raise exception 'legacy public function signatures do not match the reviewed ARIA schema'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.finalize_whatsapp_provider_failure(uuid,uuid,text)') is null then
    raise exception 'legacy schema lacks the final WhatsApp reconciliation function'
      using errcode = '55000';
  end if;
end
$aria_legacy_baseline_invariants$;
