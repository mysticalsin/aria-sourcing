-- Read-only invariants for adopting an ARIA schema that predates the ARIA
-- migration ledger. The caller must execute this file inside a READ ONLY
-- transaction and separately verify the canonical public-schema SHA-256.
do $aria_legacy_baseline_invariants$
declare
  actual_tables text;
  actual_extension_tables text;
  actual_autonomous_web_tables text;
  actual_functions text;
  actual_candidate_erasure_functions text;
  actual_operational_functions text;
  actual_ordinary_sourcing_functions text;
  actual_adaptive_sourcing_functions text;
  actual_authority_extension_functions text;
  actual_autonomous_web_functions text;
  expected_tables_with_0063 text;
  expected_functions_with_0063 text;
  actual_provisioning_functions text;
  non_rls_tables text;
  expected_tables constant text :=
    'agent_conversations,agent_events,agent_framework_configuration_receipts,agent_framework_controls,agent_framework_instances,agent_framework_memory_egress_leases,agent_framework_run_memory_context,agent_framework_runs,agent_framework_sourcing_authorizations,agent_framework_step_receipts,agent_memories,agent_memory_events,agent_memory_legacy_quarantine,agent_run_memory_context,agent_runs,agent_seats,agent_specs,agent_workflow_versions,ai_provider_catalog,ai_runtime_binding_receipts,ai_runtime_binding_sets,ai_runtime_bindings,api_keys,apollo_enrichment_attempts,apollo_enrichment_confirmations,apollo_enrichment_erasure_events,apollo_enrichment_quota,apollo_enrichment_reconciliation_events,apollo_enrichment_targets,aria_jobs,calendar_booking_ledger,campaign_create_receipts,candidate_erasure_obligations,candidate_erasure_receipts,candidate_erasure_requests,candidate_erasure_suppression_tombstones,candidate_identities,candidate_legal_holds,candidate_outcome_events,candidates,databricks_connection_events,databricks_connections,dust_connection_events,dust_connections,email_connection_seat_mismatch_quarantine,email_connections,email_delivery_events,email_ledger_delivery_receipts,enrichment_budgets,enrichment_spend_ledger,inbound_mailbox_routes,loop_events,loop_worker_heartbeats,messages_inbound,messages_outbound,need_ingress_credential_receipts,need_ingress_credentials,outbound_content_cache,outreach_approvals,outreach_ledger,outreach_sequence_steps,outreach_sequences,owner_recovery_receipts,persons,profiles,requisition_input_cleanup_receipts,requisition_inputs,requisition_parse_execution_claims,requisition_parse_receipts,requisition_parse_reconciliation_receipts,requisitions,sourcing_batch_claims,sourcing_batch_egress_attempts,sourcing_batch_receipts,sourcing_batch_source_receipts,sourcing_campaigns,sourcing_candidate_evidence,sourcing_graphify_exports,sourcing_learning_controls,sourcing_learning_secrets,sourcing_lesson_evidence,sourcing_lesson_reviews,sourcing_lessons,sourcing_loop_controls,sourcing_provider_quota_ledger,sourcing_provider_runs,sourcing_query_feedback,sourcing_query_receipts,sourcing_run_quota,sourcing_run_results,sourcing_runs,suppression_list,swarm_agents,swarm_assignments,swarm_checkpoints,swarm_escalations,swarm_missions,whatsapp_contacts,whatsapp_conversation_windows,whatsapp_delivery_events,whatsapp_senders,whatsapp_templates,workspace_patch_receipts,workspace_state,workspaces';
  expected_extension_tables constant text :=
    'ai_runtime_model_evidence,candidate_erasure_provider_evidence_receipts,candidate_payload_provenance';
  expected_autonomous_web_tables constant text :=
    'autonomous_web_candidate_evidence,autonomous_web_sourcing_attempts,autonomous_web_sourcing_claims,autonomous_web_sourcing_confirmations,autonomous_web_sourcing_failures,autonomous_web_sourcing_quota_ledger,autonomous_web_sourcing_receipts,autonomous_web_sourcing_reconciliations,autonomous_web_sourcing_results,autonomous_web_sourcing_staged_results';
  expected_functions constant text :=
    'abandon_ambiguous_requisition_parse_attempt(uuid,uuid,text,integer,uuid,uuid,text,text,text,text,text,uuid),ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text),activate_ai_runtime_binding_set(uuid,uuid,uuid),activate_outreach_sequence(uuid),agent_framework_run_authority_is_active(uuid),ai_execution_credential_verified(text,text,timestamp with time zone,text,integer),ai_runtime_binding_set_credentials_valid(uuid,uuid),ai_runtime_binding_set_structurally_valid(uuid,uuid),answer_swarm_escalation(uuid,text,text),apply_workspace_patch(uuid,timestamp with time zone,text,jsonb,text),attach_agent_framework_run_memory_context(uuid,uuid,uuid,uuid,uuid),attach_graphify_sourcing_lesson(uuid,uuid,uuid,bigint,uuid),audit_databricks_connection_authority(),audit_dust_connection_authority(),auth_identity_lifecycle_schema_ready(),authorize_requisition_parse_job_v2(uuid,uuid,uuid,uuid),authorize_requisition_parse_job(uuid,uuid,uuid,uuid),authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer),backfill_candidate_person_identities(),backfill_candidates_corpus(),begin_agent_framework_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text),begin_provider_run(uuid,text,text,text),begin_requisition_parse_egress(uuid,uuid,uuid,uuid,uuid,integer,text,text,text),begin_sourcing_batch_egress(uuid,uuid,uuid,uuid,text,integer,uuid,bigint,text,text),begin_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text),bind_sequence_step_outbound(uuid,uuid),cancel_swarm_mission(uuid,text),candidate_erasure_contains_identity(text,text[]),candidate_erasure_identifier_hmac(uuid,text,text),candidate_erasure_response(uuid,boolean),candidate_erasure_tombstone_exists(uuid,text,text),canonicalize_sourcing_role_basis(jsonb),check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid),claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_and_record(text,text,text,uuid,text,integer),claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text),claim_calendar_booking(uuid,text,timestamp with time zone,text,text),claim_due_aria_jobs(text,integer,text[],integer),claim_email_outbound_queued(uuid),claim_email_outbound(text,text,text,text,text,text,uuid),claim_enrichment_budget(uuid,text,text,integer,text),claim_sequence_step_for_schedule(uuid),claim_whatsapp_inbound_processing(uuid,uuid),claim_whatsapp_outbound(uuid),cleanup_apollo_enrichment_authority(uuid,integer),cleanup_email_ledger_delivery_receipts(integer),cleanup_erased_candidate_mirror(),cleanup_erased_candidate_outcomes(),cleanup_erased_candidate_sequences(),cleanup_requisition_input_authority(uuid,integer),cleanup_sourcing_candidate_evidence(),cleanup_sourcing_learning_authority(uuid,integer),commit_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb,jsonb,text),complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text),complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb),complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb),complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text),complete_aria_job(uuid,uuid,text,jsonb,jsonb),complete_graphify_sourcing_export(uuid,uuid,uuid,text,text,jsonb,text),complete_sequence_manual_task(uuid,uuid),complete_sequence_step_send(uuid),complete_sourcing_run(uuid,uuid,uuid,jsonb),complete_whatsapp_inbound_processing(uuid,uuid,text,text),configure_requisition_input_retention(uuid,integer),configure_sourcing_learning(uuid,uuid,boolean,integer,integer,integer,integer,text,bigint,text),correlate_inbound_email(uuid,text),create_agent_memory(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamp with time zone),create_agent_run_with_memory_context(uuid,uuid,uuid,uuid),create_need_ingress_credential(text,text,timestamp with time zone,uuid,uuid),create_outreach_sequence(uuid,text,text,integer,jsonb),create_swarm_mission(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,uuid,uuid),current_active_identity_id(),current_profile_role(),current_workspace_id(),delete_agent_memory_content(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer),dispatch_ready_swarm_assignments(integer),enforce_active_email_approval(),enforce_active_whatsapp_approval(),enforce_agent_framework_instance_identity_immutable(),enforce_agent_memory_authority_immutable(),enforce_agent_run_authority_immutable(),enforce_agent_spec_authority_immutable(),enforce_agent_workflow_version_immutable(),enforce_ai_bound_credential_lifecycle(),enforce_ai_runtime_binding_set_lifecycle(),enforce_need_ingress_credential_mutation(),enforce_need_ingress_credential_receipt_mutation(),enforce_requisition_input_cleanup_receipt_mutation(),enforce_requisition_input_content_lifecycle(),enqueue_aria_job(uuid,text,text,jsonb,timestamp with time zone,integer),enqueue_email_outbound(text,text,text,uuid,text,text,text),enqueue_whatsapp_outbound(text,text,text,uuid,text,text,text,text,uuid,jsonb),ensure_workspace(),erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text),expected_sourcing_loop_handler_contract_sha256(),export_graphify_sourcing_lessons(uuid,uuid,integer),fail_agent_framework_run(uuid,uuid,text),fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text),fail_aria_job(uuid,uuid,text,boolean),fail_requisition_parse_egress(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,text),fail_sourcing_batch_egress(uuid,uuid,uuid,uuid,text,integer,uuid,bigint,uuid,text,boolean,boolean,jsonb,text,integer,integer),fail_sourcing_run(uuid,uuid,uuid,text),finalize_campaign_create_job(uuid,uuid,uuid,uuid),finalize_email_provider_failure(uuid,uuid,text),finalize_requisition_parse(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text),finalize_requisition_parse(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb,text,text),finalize_whatsapp_provider_failure(uuid,uuid,text),gc_deleted_candidacies(),get_requisition_input(uuid,uuid),get_sourcing_loop_controls(uuid),get_sourcing_loop_readiness(text),get_swarm_assignment_envelope(uuid,uuid),get_swarm_runtime(uuid),guard_sourcing_batch_job_transition(),heartbeat_aria_job(uuid,uuid,integer),import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb),ingest_requisition_and_enqueue_pre0057(uuid,text,text,text),ingest_requisition_and_enqueue(uuid,text,text,text),ingest_requisition_with_credential(uuid,text,text,text,text),ingest_requisition(uuid,text,text),insert_ai_runtime_binding_receipt(uuid,uuid,uuid,text,uuid,uuid,text),link_candidate_person(),link_one_candidate(candidates),list_agent_framework_heartbeat_targets(uuid),list_agent_framework_workflows(uuid,uuid,uuid),list_ambiguous_requisition_parse_attempts(timestamp with time zone,uuid,integer),list_apollo_enrichment_reconciliation(uuid,uuid,timestamp with time zone,uuid,integer),list_loop_events(bigint,integer),list_pending_sourcing_feedback(uuid,uuid,text,integer),list_promoted_sourcing_lessons(uuid,uuid,jsonb,integer),list_swarm_escalations(text,integer),list_swarm_missions(integer),list_workspace_candidates(text,text,text,text,text,integer,integer),list_workspace_requisitions(integer,integer),mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid),mark_stale_swarm_assignments(integer,integer),mirror_workspace_candidates(uuid,jsonb),mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamp with time zone),normalize_whatsapp_e164(text),outreach_sequence_recipient_blocked(outreach_sequences,outreach_sequence_steps),pause_sourcing_batch_pre_egress(uuid,uuid,uuid,uuid,text,integer,text),persist_sourcing_batch_source_receipts(uuid,uuid,uuid,text,integer,jsonb,boolean),place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamp with time zone),plan_swarm_assignments(uuid,uuid,jsonb),prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text),reap_expired_agent_framework_leases(integer),reap_expired_aria_job_leases(integer),reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text),reconcile_calendar_booking(uuid,uuid,text,text,text),reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text),record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean),record_agent_framework_step_receipt(uuid,uuid,integer,text,text,text,text),record_candidate_outcome(uuid,text,text,text,uuid),record_email_delivery_event(uuid,text,text,timestamp with time zone,integer,boolean),record_email_send_message_id(uuid,uuid,text),record_inbound_email(uuid,text,text,text),record_loop_worker_heartbeat(text,text),record_outreach_approval(text,text,text),record_requisition_campaign(uuid,text),record_requisition_parse(uuid,jsonb,jsonb,numeric,boolean),record_sourcing_loop_heartbeat(text,text,text),record_sourcing_query_feedback(uuid,uuid,uuid,text,text),record_swarm_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,text,jsonb),record_whatsapp_delivery_event(uuid,uuid,text,text,timestamp with time zone,integer),record_whatsapp_provider_acceptance(uuid,uuid,text),recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text),register_apollo_enrichment_targets(uuid,uuid,text,jsonb),reject_agent_framework_receipt_mutation(),reject_agent_memory_audit_mutation(),reject_ai_provider_catalog_mutation(),reject_ai_runtime_binding_mutation(),reject_ai_runtime_binding_receipt_mutation(),reject_apollo_erasure_event_mutation(),reject_apollo_reconciliation_event_mutation(),reject_campaign_create_receipt_mutation(),reject_candidate_erasure_receipt_mutation(),reject_candidate_erasure_reimport(),reject_email_connection_quarantine_mutation(),reject_loop_event_mutation(),reject_owner_recovery_receipt_mutation(),reject_reconciled_requisition_parse_job_identity_mutation(),reject_requisition_parse_receipt_mutation(),reject_requisition_parse_reconciliation_receipt_mutation(),reject_sourcing_batch_receipt_mutation(),reject_sourcing_candidate_evidence_reimport(),reject_sourcing_lesson_review_mutation(),reject_swarm_checkpoint_mutation(),release_candidate_legal_hold(uuid,uuid,uuid,text),release_enrichment_claim(uuid),request_candidate_erasure(uuid,uuid,text,text,uuid),requeue_dead_aria_job(uuid),requisition_parse_claim_fingerprint(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,text,text,text),resolve_active_ai_runtime_binding(uuid,text),resolve_inbound_mailbox_route(text),resolve_need_ingress_credential(text),resolve_whatsapp_inbound_conversation(uuid,uuid),review_agent_workflow_version(uuid,uuid,uuid,text,text),review_sourcing_lesson(uuid,uuid,uuid,bigint,text,text,text),review_whatsapp_outbound(uuid,text),revoke_need_ingress_credential(uuid,uuid,uuid),revoke_outreach_approval(text,text),route_swarm_reviews(integer),scrub_candidate_workspace_document(jsonb,text),seed_agent_framework_control(),seed_sourcing_loop_control(),seed_swarm_roster(),select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid),set_sourcing_loop_controls(boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,integer),set_swarm_agent(uuid,boolean,integer,boolean,text),settle_enrichment_spend(uuid,integer),settle_provider_run(uuid,boolean),sourcing_authority_hmac(uuid,text),sourcing_batch_expected_query(jsonb,integer),sourcing_batch_lesson_snapshot_sha256(jsonb),sourcing_batch_result_sha256(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb),sourcing_campaign_document_status(jsonb,uuid),sourcing_candidate_target(),sourcing_max_batch_ordinal(),stage_ai_runtime_binding_set(uuid,text,text,uuid,text,text,uuid,uuid),stamp_databricks_connection_authority(),stamp_dust_connection_authority(),stop_outreach_sequence(uuid,text),strip_legacy_agent_memory_authority(),strip_legacy_databricks_authority(),strip_legacy_dust_authority(),swarm_recompute_mission_status(uuid),sync_candidates_corpus(),touch_updated_at(),validate_campaign_create_receipt_jobs(),validate_requisition_parse_reconciliation_job(),validate_sourcing_batch_candidates(uuid,uuid,jsonb,jsonb,jsonb),validate_sourcing_batch_source_receipts(jsonb,text,integer,boolean),validate_sourcing_learning_query(text,text)';
  expected_provisioning_functions constant text :=
    'activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid),cleanup_agent_framework_authority(uuid,integer),configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text),enforce_agent_framework_run_control_identity(),engage_agent_framework_kill_switch(uuid,uuid,uuid,bigint),inspect_agent_framework_control_authority(uuid,uuid),reject_agent_framework_configuration_receipt_mutation()';
  expected_candidate_erasure_functions constant text :=
    'candidate_erasure_constant_time_hex_equal(text,text),candidate_erasure_encrypt_reference(uuid,jsonb),candidate_erasure_identity_lock_key(uuid,text,text),candidate_erasure_provider_for_channel(text),candidate_erasure_reference_hmac(uuid,jsonb),candidate_erasure_tombstone_document(jsonb),enforce_candidate_erasure_obligation_limit(),list_candidate_erasure_requests(uuid,uuid,integer),read_candidate_erasure_obligation_authority(uuid,uuid,uuid),refresh_candidate_erasure_legal_hold_state(uuid),reject_candidate_erasure_apollo_reimport()';
  expected_operational_functions constant text :=
    'authorize_agent_framework_memory_egress(uuid,uuid),release_agent_framework_memory_egress(uuid,uuid,uuid)';
  expected_ordinary_sourcing_functions constant text :=
    'ack_ordinary_sourcing_result(uuid,uuid,uuid,text),begin_ordinary_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text),cleanup_ordinary_sourcing_erasure(),cleanup_ordinary_sourcing_results(uuid,integer),cleanup_sourcing_learning_authority_pre0058(uuid,integer),complete_ordinary_sourcing_run(uuid,uuid,uuid,jsonb,jsonb),fail_ordinary_sourcing_run(uuid,uuid,uuid,text),resume_ordinary_sourcing_run(uuid,uuid,text,text,integer),validate_ordinary_sourcing_candidates(uuid,text,jsonb,integer)';
  expected_adaptive_sourcing_functions constant text :=
    'sourcing_batch_query_is_allowed(jsonb,integer,jsonb)';
  expected_authority_extension_functions constant text :=
    'activate_ai_runtime_binding_set(uuid,uuid,uuid,uuid,uuid),ai_runtime_model_evidence_matches(uuid,uuid,uuid,text,text,text,smallint,text,text,boolean),authorize_sourcing_batch_0054(uuid,uuid,uuid,uuid,text,integer,text),authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text),candidate_erasure_provider_evidence_document(uuid,uuid,uuid,text,integer,text,text,text,text,text,timestamp with time zone),candidate_payload_identifiers(jsonb),candidate_payload_matches_erasure(uuid,uuid,jsonb),claim_due_sourcing_batch_jobs(text,integer,integer),cleanup_candidate_payload_from_tombstone(),cleanup_candidate_payload_provenance(),create_agent_memory_with_candidate_provenance(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamp with time zone,text,jsonb),enforce_verified_candidate_erasure_completion(),index_candidate_json_payload(),index_candidate_payload_provenance(uuid,text,uuid,bigint,uuid,uuid,jsonb),mutate_agent_memory_with_candidate_provenance(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamp with time zone,boolean,text,jsonb),persist_sourcing_batch_source_receipts(uuid,uuid,uuid,text,integer,jsonb,boolean,text),record_ai_runtime_model_evidence(uuid,uuid,text,text,text),reject_ai_runtime_model_evidence_mutation(),reject_candidate_erasure_provider_evidence_mutation(),sourcing_batch_result_sha256(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb,text),stage_ai_runtime_binding_set(uuid,text,text,uuid,uuid,text,text,uuid,uuid,uuid),validate_candidate_erasure_provider_evidence_receipt(),validate_sourcing_batch_source_receipts(jsonb,text,integer,boolean,text)';
  expected_autonomous_web_functions constant text :=
    'authorize_autonomous_web_sourcing(uuid,uuid,uuid,uuid,text,integer),autonomous_web_activation_counts_are_valid(integer,integer,integer,integer),autonomous_web_activation_job_counts_are_valid(integer,integer,integer,integer),autonomous_web_linkedin_external_id(text),autonomous_web_sourcing_candidates(uuid,uuid,uuid,jsonb,jsonb,text,jsonb,timestamp with time zone),autonomous_web_sourcing_credential_version(uuid,uuid,text,text,timestamp with time zone,text,integer),autonomous_web_sourcing_expected_query(jsonb,integer),autonomous_web_sourcing_query_is_allowed(jsonb,jsonb),autonomous_web_sourcing_request_sha256(jsonb),autonomous_web_sourcing_request(jsonb),begin_autonomous_web_sourcing_egress(uuid,uuid,uuid,uuid,uuid,bigint),cleanup_autonomous_web_from_tombstone(),cleanup_autonomous_web_sourcing_retention(integer),commit_autonomous_web_sourcing(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text),confirm_autonomous_web_sourcing_egress(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,text,text),fail_autonomous_web_sourcing(uuid,uuid,uuid,uuid,bigint,uuid,text,boolean,boolean),get_autonomous_web_sourcing_activation_proof(uuid,uuid),guard_autonomous_web_sourcing_job_transition(),guard_autonomous_web_staged_mutation(),reconcile_autonomous_web_sourcing(uuid,uuid,uuid,text),record_autonomous_web_sourcing_result(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid,text,text,text,text,text,integer,jsonb,jsonb),reject_autonomous_web_sourcing_mutation()';
begin
  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into actual_tables
   from pg_tables
   where schemaname = 'public'
     and tablename not in (
       'aria_schema_migrations',
       'ai_runtime_model_evidence',
       'autonomous_web_candidate_evidence',
       'autonomous_web_sourcing_attempts',
       'autonomous_web_sourcing_claims',
       'autonomous_web_sourcing_confirmations',
       'autonomous_web_sourcing_failures',
       'autonomous_web_sourcing_quota_ledger',
       'autonomous_web_sourcing_receipts',
       'autonomous_web_sourcing_reconciliations',
       'autonomous_web_sourcing_results',
       'autonomous_web_sourcing_staged_results',
       'candidate_erasure_provider_evidence_receipts',
       'candidate_payload_provenance'
     );

  expected_tables_with_0063 := replace(
    expected_tables,
    'outreach_ledger,outreach_sequence_steps',
    'outreach_ledger,outreach_sequence_manual_action_receipts,outreach_sequence_manual_approval_consumptions,outreach_sequence_release_controls,outreach_sequence_steps'
  );

  if actual_tables <> expected_tables_with_0063 then
    raise exception 'legacy public table set does not match the reviewed ARIA schema: %', actual_tables
      using errcode = '55000';
  end if;

  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into actual_extension_tables
    from pg_tables
   where schemaname = 'public'
     and tablename in (
       'ai_runtime_model_evidence',
       'candidate_erasure_provider_evidence_receipts',
       'candidate_payload_provenance'
     );

  if actual_extension_tables <> expected_extension_tables then
    raise exception 'legacy extension table set does not match the reviewed ARIA schema: %',
      actual_extension_tables using errcode = '55000';
  end if;

  select coalesce(string_agg(tablename, ',' order by tablename), '')
    into actual_autonomous_web_tables
    from pg_tables
   where schemaname = 'public'
     and tablename in (
       'autonomous_web_candidate_evidence',
       'autonomous_web_sourcing_attempts',
       'autonomous_web_sourcing_claims',
       'autonomous_web_sourcing_confirmations',
       'autonomous_web_sourcing_failures',
       'autonomous_web_sourcing_quota_ledger',
       'autonomous_web_sourcing_receipts',
       'autonomous_web_sourcing_reconciliations',
       'autonomous_web_sourcing_results',
       'autonomous_web_sourcing_staged_results'
     );

  if actual_autonomous_web_tables <> expected_autonomous_web_tables then
    raise exception 'legacy autonomous web table set does not match the reviewed ARIA schema: %',
      actual_autonomous_web_tables using errcode = '55000';
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
       'reject_candidate_erasure_apollo_reimport',
       'ack_ordinary_sourcing_result',
       'begin_ordinary_sourcing_run',
       'cleanup_ordinary_sourcing_erasure',
       'cleanup_ordinary_sourcing_results',
       'cleanup_sourcing_learning_authority_pre0058',
       'complete_ordinary_sourcing_run',
       'fail_ordinary_sourcing_run',
       'resume_ordinary_sourcing_run',
       'validate_ordinary_sourcing_candidates',
       'sourcing_batch_query_is_allowed',
       'ai_runtime_model_evidence_matches',
       'candidate_erasure_provider_evidence_document',
       'candidate_payload_identifiers',
       'candidate_payload_matches_erasure',
       'claim_due_sourcing_batch_jobs',
       'cleanup_candidate_payload_from_tombstone',
       'cleanup_candidate_payload_provenance',
       'create_agent_memory_with_candidate_provenance',
       'enforce_verified_candidate_erasure_completion',
       'index_candidate_json_payload',
       'index_candidate_payload_provenance',
       'mutate_agent_memory_with_candidate_provenance',
       'record_ai_runtime_model_evidence',
       'reject_ai_runtime_model_evidence_mutation',
       'reject_candidate_erasure_provider_evidence_mutation',
       'validate_candidate_erasure_provider_evidence_receipt',
       'authorize_sourcing_batch_0054',
       'authorize_autonomous_web_sourcing',
       'autonomous_web_activation_counts_are_valid',
       'autonomous_web_activation_job_counts_are_valid',
       'autonomous_web_linkedin_external_id',
       'autonomous_web_sourcing_candidates',
       'autonomous_web_sourcing_credential_version',
       'autonomous_web_sourcing_expected_query',
       'autonomous_web_sourcing_query_is_allowed',
       'autonomous_web_sourcing_request',
       'autonomous_web_sourcing_request_sha256',
       'begin_autonomous_web_sourcing_egress',
       'cleanup_autonomous_web_from_tombstone',
       'cleanup_autonomous_web_sourcing_retention',
       'commit_autonomous_web_sourcing',
       'confirm_autonomous_web_sourcing_egress',
       'fail_autonomous_web_sourcing',
       'get_autonomous_web_sourcing_activation_proof',
       'guard_autonomous_web_sourcing_job_transition',
       'guard_autonomous_web_staged_mutation',
       'reconcile_autonomous_web_sourcing',
       'record_autonomous_web_sourcing_result',
       'reject_autonomous_web_sourcing_mutation'
     );

  -- Changed signatures remain represented in the original reviewed set for
  -- continuity, while the extension set below verifies their exact current
  -- signatures. This keeps every function covered without rewriting the
  -- historical baseline as one opaque generated string.
  actual_functions := replace(
    actual_functions,
    'activate_ai_runtime_binding_set(uuid,uuid,uuid,uuid,uuid)',
    'activate_ai_runtime_binding_set(uuid,uuid,uuid)'
  );
  actual_functions := replace(
    actual_functions,
    'authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text)',
    'authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer)'
  );
  actual_functions := replace(
    actual_functions,
    'persist_sourcing_batch_source_receipts(uuid,uuid,uuid,text,integer,jsonb,boolean,text)',
    'persist_sourcing_batch_source_receipts(uuid,uuid,uuid,text,integer,jsonb,boolean)'
  );
  actual_functions := replace(
    actual_functions,
    'sourcing_batch_result_sha256(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb,text)',
    'sourcing_batch_result_sha256(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,jsonb,jsonb)'
  );
  actual_functions := replace(
    actual_functions,
    'stage_ai_runtime_binding_set(uuid,text,text,uuid,uuid,text,text,uuid,uuid,uuid)',
    'stage_ai_runtime_binding_set(uuid,text,text,uuid,text,text,uuid,uuid)'
  );
  actual_functions := replace(
    actual_functions,
    'validate_sourcing_batch_source_receipts(jsonb,text,integer,boolean,text)',
    'validate_sourcing_batch_source_receipts(jsonb,text,integer,boolean)'
  );

  expected_functions_with_0063 := expected_functions;
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'candidate_erasure_identifier_hmac(uuid,text,text)',
    'candidate_erasure_identifier_hmac(uuid,text,text),candidate_erasure_linkedin_canonical_hmac(uuid,text)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'canonicalize_sourcing_role_basis(jsonb)',
    'canonicalize_candidate_erasure_linkedin_tombstone(),canonicalize_sourcing_role_basis(jsonb)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'claim_email_outbound_queued(uuid)',
    'claim_email_outbound_queued_pre0063(uuid),claim_email_outbound_queued(uuid)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'claim_whatsapp_outbound(uuid)',
    'claim_whatsapp_outbound_pre0063(uuid),claim_whatsapp_outbound(uuid)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'complete_sequence_manual_task(uuid,uuid)',
    'complete_sequence_manual_task(uuid)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'enforce_requisition_input_content_lifecycle(),enqueue_aria_job',
    'enforce_requisition_input_content_lifecycle(),enforce_sequence_outbound_insert_binding(),enforce_sequence_outbound_insert_origin(),enforce_sequence_outbound_update_authority(),enqueue_and_bind_sequence_step_outbound(uuid,uuid),enqueue_aria_job'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'normalize_whatsapp_e164(text)',
    'normalize_linkedin_profile_url(text),normalize_whatsapp_e164(text)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'reject_loop_event_mutation()',
    'reject_legacy_linkedin_candidate_reimport(),reject_loop_event_mutation()'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'outreach_sequence_recipient_blocked(outreach_sequences,outreach_sequence_steps)',
    'outreach_sequence_current_scope_hash(outreach_sequences,outreach_sequence_steps),outreach_sequence_execution_enabled(uuid),outreach_sequence_recipient_blocked(outreach_sequences,outreach_sequence_steps)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'outreach_sequence_recipient_blocked(outreach_sequences,outreach_sequence_steps)',
    'outreach_sequence_recipient_blocked(outreach_sequences,outreach_sequence_steps),outreach_sequence_stop_internal(uuid,text),outreach_sequence_tombstone_exists(uuid,text,text)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text)',
    'prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text),prepare_sequence_outbound_claim(uuid,text)'
  );
  expected_functions_with_0063 := replace(
    expected_functions_with_0063,
    'reject_requisition_parse_reconciliation_receipt_mutation(),reject_sourcing_batch_receipt_mutation()',
    'reject_requisition_parse_reconciliation_receipt_mutation(),reject_sequence_manual_action_receipt_mutation(),reject_sourcing_batch_receipt_mutation()'
  );

  if actual_functions <> expected_functions_with_0063 then
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
    into actual_ordinary_sourcing_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'ack_ordinary_sourcing_result',
       'begin_ordinary_sourcing_run',
       'cleanup_ordinary_sourcing_erasure',
       'cleanup_ordinary_sourcing_results',
       'cleanup_sourcing_learning_authority_pre0058',
       'complete_ordinary_sourcing_run',
       'fail_ordinary_sourcing_run',
       'resume_ordinary_sourcing_run',
       'validate_ordinary_sourcing_candidates'
     );

  if actual_ordinary_sourcing_functions <> expected_ordinary_sourcing_functions then
    raise exception 'legacy ordinary sourcing functions do not match the reviewed ARIA schema: %', actual_ordinary_sourcing_functions
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_adaptive_sourcing_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sourcing_batch_query_is_allowed';

  if actual_adaptive_sourcing_functions <> expected_adaptive_sourcing_functions then
    raise exception 'legacy adaptive sourcing functions do not match the reviewed ARIA schema: %', actual_adaptive_sourcing_functions
      using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_authority_extension_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'activate_ai_runtime_binding_set',
       'ai_runtime_model_evidence_matches',
       'authorize_sourcing_batch',
       'authorize_sourcing_batch_0054',
       'candidate_erasure_provider_evidence_document',
       'candidate_payload_identifiers',
       'candidate_payload_matches_erasure',
       'claim_due_sourcing_batch_jobs',
       'cleanup_candidate_payload_from_tombstone',
       'cleanup_candidate_payload_provenance',
       'create_agent_memory_with_candidate_provenance',
       'enforce_verified_candidate_erasure_completion',
       'index_candidate_json_payload',
       'index_candidate_payload_provenance',
       'mutate_agent_memory_with_candidate_provenance',
       'persist_sourcing_batch_source_receipts',
       'record_ai_runtime_model_evidence',
       'reject_ai_runtime_model_evidence_mutation',
       'reject_candidate_erasure_provider_evidence_mutation',
       'sourcing_batch_result_sha256',
       'stage_ai_runtime_binding_set',
       'validate_candidate_erasure_provider_evidence_receipt',
       'validate_sourcing_batch_source_receipts'
     );

  if actual_authority_extension_functions <> expected_authority_extension_functions then
    raise exception 'legacy authority extension functions do not match the reviewed ARIA schema: %',
      actual_authority_extension_functions using errcode = '55000';
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), '')
    into actual_autonomous_web_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'authorize_autonomous_web_sourcing',
       'autonomous_web_activation_counts_are_valid',
       'autonomous_web_activation_job_counts_are_valid',
       'autonomous_web_linkedin_external_id',
       'autonomous_web_sourcing_candidates',
       'autonomous_web_sourcing_credential_version',
       'autonomous_web_sourcing_expected_query',
       'autonomous_web_sourcing_query_is_allowed',
       'autonomous_web_sourcing_request',
       'autonomous_web_sourcing_request_sha256',
       'begin_autonomous_web_sourcing_egress',
       'cleanup_autonomous_web_from_tombstone',
       'cleanup_autonomous_web_sourcing_retention',
       'commit_autonomous_web_sourcing',
       'confirm_autonomous_web_sourcing_egress',
       'fail_autonomous_web_sourcing',
       'get_autonomous_web_sourcing_activation_proof',
       'guard_autonomous_web_sourcing_job_transition',
       'guard_autonomous_web_staged_mutation',
       'reconcile_autonomous_web_sourcing',
       'record_autonomous_web_sourcing_result',
       'reject_autonomous_web_sourcing_mutation'
     );

  if actual_autonomous_web_functions <> expected_autonomous_web_functions then
    raise exception 'legacy autonomous web functions do not match the reviewed ARIA schema: %',
      actual_autonomous_web_functions using errcode = '55000';
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
