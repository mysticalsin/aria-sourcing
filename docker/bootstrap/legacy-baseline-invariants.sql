-- Read-only invariants for adopting an ARIA schema that predates the ARIA
-- migration ledger. The caller must execute this file inside a READ ONLY
-- transaction and separately verify the canonical public-schema SHA-256.
do $aria_legacy_baseline_invariants$
declare
  actual_tables text;
  actual_functions text;
  non_rls_tables text;
  expected_tables constant text :=
    'agent_conversations,agent_events,agent_memories,agent_memory_events,agent_memory_legacy_quarantine,agent_run_memory_context,agent_runs,agent_seats,agent_specs,api_keys,apollo_enrichment_attempts,apollo_enrichment_confirmations,apollo_enrichment_erasure_events,apollo_enrichment_quota,apollo_enrichment_reconciliation_events,apollo_enrichment_targets,databricks_connection_events,databricks_connections,dust_connection_events,dust_connections,email_connections,messages_inbound,messages_outbound,outbound_content_cache,outreach_approvals,outreach_ledger,profiles,suppression_list,whatsapp_contacts,whatsapp_conversation_windows,whatsapp_delivery_events,whatsapp_senders,whatsapp_templates,workspace_state,workspaces';
  expected_functions constant text :=
    'audit_databricks_connection_authority(),audit_dust_connection_authority(),claim_and_record(text,text,text,uuid,text,integer),claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text),claim_email_outbound(text,text,text,text,text,text,uuid),claim_whatsapp_inbound_processing(uuid,uuid),claim_whatsapp_outbound(uuid),cleanup_apollo_enrichment_authority(uuid,integer),complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text),complete_whatsapp_inbound_processing(uuid,uuid,text,text),create_agent_run_with_memory_context(uuid,uuid,uuid,uuid),current_profile_role(),current_workspace_id(),enforce_active_whatsapp_approval(),enforce_agent_memory_authority_immutable(),enforce_agent_run_authority_immutable(),enforce_agent_spec_authority_immutable(),ensure_workspace(),erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text),finalize_whatsapp_provider_failure(uuid,uuid,text),list_apollo_enrichment_reconciliation(uuid,uuid,timestamp with time zone,uuid,integer),mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid),normalize_whatsapp_e164(text),prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text),reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text),record_outreach_approval(text,text,text),record_whatsapp_delivery_event(uuid,uuid,text,text,timestamp with time zone,integer),record_whatsapp_provider_acceptance(uuid,uuid,text),register_apollo_enrichment_targets(uuid,uuid,text,jsonb),reject_agent_memory_audit_mutation(),reject_apollo_erasure_event_mutation(),reject_apollo_reconciliation_event_mutation(),resolve_whatsapp_inbound_conversation(uuid,uuid),review_whatsapp_outbound(uuid,text),revoke_outreach_approval(text,text),select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid),stamp_databricks_connection_authority(),stamp_dust_connection_authority(),strip_legacy_agent_memory_authority(),strip_legacy_databricks_authority(),strip_legacy_dust_authority(),touch_updated_at()';
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
