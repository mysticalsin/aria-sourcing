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
    'agent_conversations,agent_events,agent_framework_configuration_receipts,agent_framework_controls,agent_framework_instances,agent_framework_memory_egress_leases,agent_framework_run_memory_context,agent_framework_runs,agent_framework_sourcing_authorizations,agent_framework_step_receipts,agent_memories,agent_memory_events,agent_memory_legacy_quarantine,agent_run_memory_context,agent_runs,agent_seats,agent_specs,agent_workflow_versions,api_keys,apollo_enrichment_attempts,apollo_enrichment_confirmations,apollo_enrichment_erasure_events,apollo_enrichment_quota,apollo_enrichment_reconciliation_events,apollo_enrichment_targets,aria_jobs,calendar_booking_ledger,candidate_erasure_obligations,candidate_erasure_receipts,candidate_erasure_requests,candidate_erasure_suppression_tombstones,candidate_identities,candidate_legal_holds,candidate_outcome_events,candidates,databricks_connection_events,databricks_connections,dust_connection_events,dust_connections,email_connection_seat_mismatch_quarantine,email_connections,email_delivery_events,email_ledger_delivery_receipts,enrichment_budgets,enrichment_spend_ledger,inbound_mailbox_routes,loop_events,loop_worker_heartbeats,messages_inbound,messages_outbound,outbound_content_cache,outreach_approvals,outreach_ledger,outreach_sequence_steps,outreach_sequences,owner_recovery_receipts,persons,profiles,requisitions,sourcing_graphify_exports,sourcing_learning_controls,sourcing_learning_secrets,sourcing_lesson_evidence,sourcing_lesson_reviews,sourcing_lessons,sourcing_loop_controls,sourcing_provider_runs,sourcing_query_feedback,sourcing_query_receipts,sourcing_run_quota,sourcing_runs,suppression_list,swarm_agents,swarm_assignments,swarm_checkpoints,swarm_escalations,swarm_missions,whatsapp_contacts,whatsapp_conversation_windows,whatsapp_delivery_events,whatsapp_senders,whatsapp_templates,workspace_patch_receipts,workspace_state,workspaces';
  expected_functions constant text :=
    'ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text),activate_outreach_sequence(uuid),agent_framework_run_authority_is_active(uuid),answer_swarm_escalation(uuid,text,text),apply_workspace_patch(uuid,timestamp with time zone,text,jsonb,text),aria_job_payload_contract_ok(text,jsonb),attach_agent_framework_run_memory_context(uuid,uuid,uuid,uuid,uuid),attach_graphify_sourcing_lesson(uuid,uuid,uuid,bigint,uuid),attach_provider_run(uuid,text,text),audit_databricks_connection_authority(),audit_dust_connection_authority(),backfill_candidate_person_identities(),backfill_candidates_corpus(),begin_agent_framework_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text),begin_provider_run(uuid,text,text,text),begin_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text),bind_sequence_step_outbound(uuid,uuid),cancel_swarm_mission(uuid,text),candidate_erasure_contains_identity(text,text[]),candidate_erasure_identifier_hmac(uuid,text,text),candidate_erasure_response(uuid,boolean),candidate_erasure_tombstone_exists(uuid,text,text),canonicalize_sourcing_role_basis(jsonb),check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid),claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text),claim_and_record(text,text,text,uuid,text,integer),claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text),claim_calendar_booking(uuid,text,timestamp with time zone,text,text),claim_due_aria_jobs(text,integer,text[],integer),claim_email_outbound_queued(uuid),claim_email_outbound(text,text,text,text,text,text,uuid),claim_enrichment_budget(uuid,text,text,integer,text),claim_sequence_step_for_schedule(uuid),claim_whatsapp_inbound_processing(uuid,uuid),claim_whatsapp_outbound(uuid),cleanup_apollo_enrichment_authority(uuid,integer),cleanup_email_ledger_delivery_receipts(integer),cleanup_erased_candidate_mirror(),cleanup_erased_candidate_outcomes(),cleanup_erased_candidate_sequences(),cleanup_sourcing_learning_authority(uuid,integer),complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text),complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb),complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb),complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text),complete_aria_job_with_workspace_patch(uuid,uuid,timestamp with time zone,text,jsonb,text,text,jsonb,jsonb),complete_aria_job(uuid,uuid,text,jsonb,jsonb),complete_graphify_sourcing_export(uuid,uuid,uuid,text,text,jsonb,text),complete_sourcing_run(uuid,uuid,uuid,jsonb),complete_whatsapp_inbound_processing(uuid,uuid,text,text),configure_sourcing_learning(uuid,uuid,boolean,integer,integer,integer,integer,text,bigint,text),correlate_inbound_email(uuid,text),create_agent_memory(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamp with time zone),create_agent_run_with_memory_context(uuid,uuid,uuid,uuid),create_outreach_sequence(uuid,text,text,integer,jsonb),create_swarm_mission(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,uuid,uuid),current_profile_role(),current_workspace_id(),delete_agent_memory_content(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer),dispatch_ready_swarm_assignments(integer),enforce_active_email_approval(),enforce_active_whatsapp_approval(),enforce_agent_framework_instance_identity_immutable(),enforce_agent_memory_authority_immutable(),enforce_agent_run_authority_immutable(),enforce_agent_spec_authority_immutable(),enforce_agent_workflow_version_immutable(),enqueue_aria_job(uuid,text,text,jsonb,timestamp with time zone,integer),enqueue_email_outbound(text,text,text,uuid,text,text,text),enqueue_whatsapp_outbound(text,text,text,uuid,text,text,text,text,uuid,jsonb),ensure_workspace(),erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text),export_graphify_sourcing_lessons(uuid,uuid,integer),fail_agent_framework_run(uuid,uuid,text),fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text),fail_aria_job(uuid,uuid,text,boolean),fail_sourcing_run(uuid,uuid,uuid,text),finalize_email_provider_failure(uuid,uuid,text),finalize_whatsapp_provider_failure(uuid,uuid,text),gc_deleted_candidacies(),get_sourcing_loop_controls(uuid),get_swarm_assignment_envelope(uuid,uuid),get_swarm_runtime(uuid),heartbeat_aria_job(uuid,uuid,integer),import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb),ingest_requisition(uuid,text,text),link_candidate_person(),link_one_candidate(candidates),list_agent_framework_heartbeat_targets(uuid),list_agent_framework_workflows(uuid,uuid,uuid),list_apollo_enrichment_reconciliation(uuid,uuid,timestamp with time zone,uuid,integer),list_loop_events(bigint,integer),list_pending_sourcing_feedback(uuid,uuid,text,integer),list_promoted_sourcing_lessons(uuid,uuid,jsonb,integer),list_swarm_escalations(text,integer),list_swarm_missions(integer),list_workspace_candidates(text,text,text,text,text,integer,integer),list_workspace_requisitions(integer,integer),mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid),mark_stale_swarm_assignments(integer,integer),mirror_workspace_candidates(uuid,jsonb),mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamp with time zone),normalize_whatsapp_e164(text),place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamp with time zone),plan_swarm_assignments(uuid,uuid,jsonb),prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text),read_inbound_email_for_loop(uuid,uuid),read_provider_run_for_loop(uuid,uuid),read_workspace_state_for_loop(uuid),reap_expired_agent_framework_leases(integer),reap_expired_aria_job_leases(integer),reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text),reconcile_calendar_booking(uuid,uuid,text,text,text),reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text),record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean),record_agent_framework_step_receipt(uuid,uuid,integer,text,text,text,text),record_candidate_outcome(uuid,text,text,text,uuid),record_email_delivery_event(uuid,text,text,timestamp with time zone,integer,boolean),record_email_send_message_id(uuid,uuid,text),record_inbound_email(uuid,text,text,text),record_loop_worker_heartbeat(text,text),record_outreach_approval(text,text,text),record_requisition_campaign(uuid,text),record_requisition_parse(uuid,jsonb,jsonb,numeric,boolean),record_sourcing_query_feedback(uuid,uuid,uuid,text,text),record_swarm_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,text,jsonb),record_whatsapp_delivery_event(uuid,uuid,text,text,timestamp with time zone,integer),record_whatsapp_provider_acceptance(uuid,uuid,text),recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text),redact_loop_events_for_candidate_erasure(uuid,text,text[],text[]),register_apollo_enrichment_targets(uuid,uuid,text,jsonb),reject_agent_framework_receipt_mutation(),reject_agent_memory_audit_mutation(),reject_apollo_erasure_event_mutation(),reject_apollo_reconciliation_event_mutation(),reject_candidate_erasure_receipt_mutation(),reject_candidate_erasure_reimport(),reject_email_connection_quarantine_mutation(),reject_loop_event_mutation(),reject_owner_recovery_receipt_mutation(),reject_sourcing_lesson_review_mutation(),reject_swarm_checkpoint_mutation(),release_candidate_legal_hold(uuid,uuid,uuid,text),release_enrichment_claim(uuid),request_candidate_erasure(uuid,uuid,text,text,uuid),requeue_dead_aria_job(uuid),resolve_inbound_mailbox_route(text),resolve_whatsapp_inbound_conversation(uuid,uuid),review_agent_workflow_version(uuid,uuid,uuid,text,text),review_sourcing_lesson(uuid,uuid,uuid,bigint,text,text,text),review_whatsapp_outbound(uuid,text),revoke_outreach_approval(text,text),route_swarm_reviews(integer),scrub_candidate_workspace_document(jsonb,text),seed_agent_framework_control(),seed_sourcing_loop_control(),seed_swarm_roster(),select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid),set_sourcing_loop_controls(boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,integer),set_swarm_agent(uuid,boolean,integer,boolean,text),settle_enrichment_spend(uuid,integer),settle_provider_run_by_external(uuid,text,text,boolean),settle_provider_run(uuid,boolean),sourcing_authority_hmac(uuid,text),sourcing_loop_stage_enabled(uuid,text),stamp_databricks_connection_authority(),stamp_dust_connection_authority(),stop_outreach_sequence(uuid,text),strip_legacy_agent_memory_authority(),strip_legacy_databricks_authority(),strip_legacy_dust_authority(),swarm_recompute_mission_status(uuid),sync_candidates_corpus(),touch_updated_at(),validate_sourcing_learning_query(text,text)';
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
