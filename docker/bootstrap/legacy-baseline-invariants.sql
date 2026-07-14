-- Read-only invariants for adopting an ARIA schema that predates the ARIA
-- migration ledger. The caller must execute this file inside a READ ONLY
-- transaction and separately verify the canonical public-schema SHA-256.
do $aria_legacy_baseline_invariants$
declare
  actual_tables text;
  actual_functions text;
  actual_candidate_erasure_functions text;
  actual_operational_functions text;
  actual_provisioning_functions text;
  non_rls_tables text;
  expected_tables constant text :=
    'agent_conversations,agent_events,agent_framework_configuration_receipts,agent_framework_controls,agent_framework_instances,agent_framework_memory_egress_leases,agent_framework_run_memory_context,agent_framework_runs,agent_framework_sourcing_authorizations,agent_framework_step_receipts,agent_memories,agent_memory_events,agent_memory_legacy_quarantine,agent_run_memory_context,agent_runs,agent_seats,agent_specs,agent_workflow_versions,api_keys,apollo_enrichment_attempts,apollo_enrichment_confirmations,apollo_enrichment_erasure_events,apollo_enrichment_quota,apollo_enrichment_reconciliation_events,apollo_enrichment_targets,candidate_erasure_obligations,candidate_erasure_receipts,candidate_erasure_requests,candidate_erasure_suppression_tombstones,candidate_legal_holds,databricks_connection_events,databricks_connections,dust_connection_events,dust_connections,email_connection_seat_mismatch_quarantine,email_connections,messages_inbound,messages_outbound,outbound_content_cache,outreach_approvals,outreach_ledger,owner_recovery_receipts,profiles,sourcing_graphify_exports,sourcing_learning_controls,sourcing_learning_secrets,sourcing_lesson_evidence,sourcing_lesson_reviews,sourcing_lessons,sourcing_query_feedback,sourcing_query_receipts,sourcing_run_quota,sourcing_runs,suppression_list,whatsapp_contacts,whatsapp_conversation_windows,whatsapp_delivery_events,whatsapp_senders,whatsapp_templates,workspace_state,workspaces';
  expected_functions constant text :=
    'ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text),agent_framework_run_authority_is_active(uuid),attach_agent_framework_run_memory_context(uuid,uuid,uuid,uuid,uuid),attach_graphify_sourcing_lesson(uuid,uuid,uuid,bigint,uuid),audit_databricks_connection_authority(),audit_dust_connection_authority(),begin_agent_framework_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text),begin_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text),candidate_erasure_contains_identity(text,text[]),candidate_erasure_identifier_hmac(uuid,text,text),candidate_erasure_response(uuid,boolean),candidate_erasure_tombstone_exists(uuid,text,text),canonicalize_sourcing_role_basis(jsonb),check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid),claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_and_record(text,text,text,uuid,text,integer),claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text),claim_email_outbound(text,text,text,text,text,text,uuid),claim_whatsapp_inbound_processing(uuid,uuid),claim_whatsapp_outbound(uuid),cleanup_apollo_enrichment_authority(uuid,integer),cleanup_sourcing_learning_authority(uuid,integer),complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text),complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb),complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb),complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text),complete_graphify_sourcing_export(uuid,uuid,uuid,text,text,jsonb,text),complete_sourcing_run(uuid,uuid,uuid,jsonb),complete_whatsapp_inbound_processing(uuid,uuid,text,text),configure_sourcing_learning(uuid,uuid,boolean,integer,integer,integer,integer,text,bigint,text),create_agent_memory(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamp with time zone),create_agent_run_with_memory_context(uuid,uuid,uuid,uuid),current_profile_role(),current_workspace_id(),delete_agent_memory_content(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer),enforce_active_whatsapp_approval(),enforce_agent_framework_instance_identity_immutable(),enforce_agent_memory_authority_immutable(),enforce_agent_run_authority_immutable(),enforce_agent_spec_authority_immutable(),enforce_agent_workflow_version_immutable(),enqueue_whatsapp_outbound(text,text,text,uuid,text,text,text,text,uuid,jsonb),ensure_workspace(),erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text),export_graphify_sourcing_lessons(uuid,uuid,integer),fail_agent_framework_run(uuid,uuid,text),fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text),fail_sourcing_run(uuid,uuid,uuid,text),finalize_whatsapp_provider_failure(uuid,uuid,text),import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb),list_agent_framework_heartbeat_targets(uuid),list_agent_framework_workflows(uuid,uuid,uuid),list_apollo_enrichment_reconciliation(uuid,uuid,timestamp with time zone,uuid,integer),list_pending_sourcing_feedback(uuid,uuid,text,integer),list_promoted_sourcing_lessons(uuid,uuid,jsonb,integer),mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid),mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamp with time zone),normalize_whatsapp_e164(text),place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamp with time zone),prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text),reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text),reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text),record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean),record_agent_framework_step_receipt(uuid,uuid,integer,text,text,text,text),record_outreach_approval(text,text,text),record_sourcing_query_feedback(uuid,uuid,uuid,text,text),record_whatsapp_delivery_event(uuid,uuid,text,text,timestamp with time zone,integer),record_whatsapp_provider_acceptance(uuid,uuid,text),recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text),register_apollo_enrichment_targets(uuid,uuid,text,jsonb),reject_agent_framework_receipt_mutation(),reject_agent_memory_audit_mutation(),reject_apollo_erasure_event_mutation(),reject_apollo_reconciliation_event_mutation(),reject_candidate_erasure_receipt_mutation(),reject_candidate_erasure_reimport(),reject_email_connection_quarantine_mutation(),reject_owner_recovery_receipt_mutation(),reject_sourcing_lesson_review_mutation(),release_candidate_legal_hold(uuid,uuid,uuid,text),request_candidate_erasure(uuid,uuid,text,text,uuid),resolve_whatsapp_inbound_conversation(uuid,uuid),review_agent_workflow_version(uuid,uuid,uuid,text,text),review_sourcing_lesson(uuid,uuid,uuid,bigint,text,text,text),review_whatsapp_outbound(uuid,text),revoke_outreach_approval(text,text),scrub_candidate_workspace_document(jsonb,text),seed_agent_framework_control(),select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid),sourcing_authority_hmac(uuid,text),stamp_databricks_connection_authority(),stamp_dust_connection_authority(),strip_legacy_agent_memory_authority(),strip_legacy_databricks_authority(),strip_legacy_dust_authority(),touch_updated_at(),validate_sourcing_learning_query(text,text)';
  expected_provisioning_functions constant text :=
    'activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid),cleanup_agent_framework_authority(uuid,integer),configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text),enforce_agent_framework_run_control_identity(),engage_agent_framework_kill_switch(uuid,uuid,uuid,bigint),inspect_agent_framework_control_authority(uuid,uuid),reject_agent_framework_configuration_receipt_mutation()';
  expected_candidate_erasure_functions constant text :=
    'candidate_erasure_constant_time_hex_equal(text,text),candidate_erasure_encrypt_reference(uuid,jsonb),candidate_erasure_identity_lock_key(uuid,text,text),candidate_erasure_provider_for_channel(text),candidate_erasure_reference_hmac(uuid,jsonb),candidate_erasure_tombstone_document(jsonb),enforce_candidate_erasure_obligation_limit(),list_candidate_erasure_requests(uuid,uuid,integer),read_candidate_erasure_obligation_authority(uuid,uuid,uuid),refresh_candidate_erasure_legal_hold_state(uuid),reject_candidate_erasure_apollo_reimport()';
  expected_operational_functions constant text :=
    'authorize_agent_framework_memory_egress(uuid,uuid),release_agent_framework_memory_egress(uuid,uuid,uuid)';
begin
  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into actual_tables
    from pg_tables
   where schemaname = 'public'
     and tablename <> 'aria_schema_migrations';

  if actual_tables <> expected_tables then
    raise exception 'legacy public table set does not match the reviewed ARIA schema: %', actual_tables
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
   where n.nspname = 'public'
     and p.proname not in (
       'activate_agent_framework_authority',
       'cleanup_agent_framework_authority',
       'configure_agent_framework_authority',
       'enforce_agent_framework_run_control_identity',
       'engage_agent_framework_kill_switch',
       'inspect_agent_framework_control_authority',
       'reject_agent_framework_configuration_receipt_mutation',
       'authorize_agent_framework_memory_egress',
       'release_agent_framework_memory_egress',
       'candidate_erasure_constant_time_hex_equal',
       'candidate_erasure_encrypt_reference',
       'candidate_erasure_identity_lock_key',
       'candidate_erasure_provider_for_channel',
       'candidate_erasure_reference_hmac',
       'candidate_erasure_tombstone_document',
       'enforce_candidate_erasure_obligation_limit',
       'list_candidate_erasure_requests',
       'read_candidate_erasure_obligation_authority',
       'refresh_candidate_erasure_legal_hold_state',
       'reject_candidate_erasure_apollo_reimport'
     );

  if actual_functions <> expected_functions then
    raise exception 'legacy public function signatures do not match the reviewed ARIA schema: %', actual_functions
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_candidate_erasure_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'candidate_erasure_constant_time_hex_equal',
       'candidate_erasure_encrypt_reference',
       'candidate_erasure_identity_lock_key',
       'candidate_erasure_provider_for_channel',
       'candidate_erasure_reference_hmac',
       'candidate_erasure_tombstone_document',
       'enforce_candidate_erasure_obligation_limit',
       'list_candidate_erasure_requests',
       'read_candidate_erasure_obligation_authority',
       'refresh_candidate_erasure_legal_hold_state',
       'reject_candidate_erasure_apollo_reimport'
     );

  if actual_candidate_erasure_functions <> expected_candidate_erasure_functions then
    raise exception 'legacy candidate erasure functions do not match the reviewed ARIA schema: %', actual_candidate_erasure_functions
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_operational_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'authorize_agent_framework_memory_egress',
       'release_agent_framework_memory_egress'
     );

  if actual_operational_functions <> expected_operational_functions then
    raise exception 'legacy operational functions do not match the reviewed ARIA schema: %', actual_operational_functions
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_provisioning_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'activate_agent_framework_authority',
       'cleanup_agent_framework_authority',
       'configure_agent_framework_authority',
       'enforce_agent_framework_run_control_identity',
       'engage_agent_framework_kill_switch',
       'inspect_agent_framework_control_authority',
       'reject_agent_framework_configuration_receipt_mutation'
     );

  if actual_provisioning_functions <> expected_provisioning_functions then
    raise exception 'legacy framework provisioning functions do not match the reviewed ARIA schema'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.finalize_whatsapp_provider_failure(uuid,uuid,text)') is null then
    raise exception 'legacy schema lacks the final WhatsApp reconciliation function'
      using errcode = '55000';
  end if;
end
$aria_legacy_baseline_invariants$;
