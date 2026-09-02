\set ON_ERROR_STOP on

begin;

do $aria_direct_postgres_session_test$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'Function privilege verification requires a direct postgres session';
  end if;
end
$aria_direct_postgres_session_test$;

do $aria_function_privilege_test$
declare
  item record;
  role_name text;
  actual boolean;
  expected boolean;
  public_execute boolean;
  function_def text;
  saved_path text;
  object_owner text;
begin
  for item in
    select * from (values
      ('public.current_workspace_id()',                                      'authenticated', true),
      ('public.current_profile_role()',                                      'authenticated', true),
      ('public.ensure_workspace()',                                          'authenticated', true),
      ('public.record_outreach_approval(text,text,text)',                     'authenticated', true),
      ('public.revoke_outreach_approval(text,text)',                          'authenticated', true),
      ('public.claim_email_outbound(text,text,text,text,text,text,uuid)',      'authenticated', true),
      ('public.review_whatsapp_outbound(uuid,text)',                          'authenticated', true),
      ('public.enqueue_whatsapp_outbound(text,text,text,uuid,text,text,text,text,uuid,jsonb)', 'authenticated', true),
      ('public.claim_and_record(text,text,text,uuid,text,integer)',            'service_role',  true),
      ('public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)', 'service_role', true),
      ('public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)', 'owner_only', true),
      ('public.attach_agent_framework_run_memory_context(uuid,uuid,uuid,uuid,uuid)', 'service_role', true),
      ('public.authorize_agent_framework_memory_egress(uuid,uuid)',           'service_role', true),
      ('public.create_agent_memory(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamptz)', 'service_role', true),
      ('public.mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamptz)', 'service_role', true),
      ('public.delete_agent_memory_content(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer)', 'service_role', true),
      ('public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)', 'service_role', true),
      ('public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)', 'service_role', true),
      ('public.engage_agent_framework_kill_switch(uuid,uuid,uuid,bigint)',      'service_role', true),
      ('public.cleanup_agent_framework_authority(uuid,integer)',              'service_role', true),
      ('public.inspect_agent_framework_control_authority(uuid,uuid)',         'service_role', true),
      ('public.recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text)', 'service_role', true),
      ('public.import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)', 'service_role', true),
      ('public.review_agent_workflow_version(uuid,uuid,uuid,text,text)',       'service_role', true),
      ('public.list_agent_framework_workflows(uuid,uuid,uuid)',              'service_role', true),
      ('public.list_agent_framework_heartbeat_targets(uuid)',                'service_role', true),
      ('public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)', 'service_role', true),
      ('public.record_agent_framework_step_receipt(uuid,uuid,integer,text,text,text,text)', 'service_role', true),
      ('public.release_agent_framework_memory_egress(uuid,uuid,uuid)',       'service_role', true),
      ('public.complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb)', 'service_role', true),
      ('public.complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text)', 'owner_only', true),
      ('public.begin_agent_framework_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text)', 'service_role', true),
      ('public.check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid)', 'service_role', true),
      ('public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb)', 'service_role', true),
      ('public.ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text)', 'service_role', true),
      ('public.fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text)', 'service_role', true),
      ('public.fail_agent_framework_run(uuid,uuid,text)',                     'service_role', true),
      ('public.agent_framework_run_authority_is_active(uuid)',                'owner_only', true),
      ('public.seed_agent_framework_control()',                               'owner_only', true),
      ('public.reject_agent_framework_configuration_receipt_mutation()',      'owner_only', false),
      ('public.reject_owner_recovery_receipt_mutation()',                     'owner_only', false),
      ('public.reject_email_connection_quarantine_mutation()',                'owner_only', false),
      ('public.enforce_agent_framework_run_control_identity()',               'owner_only', true),
      ('public.claim_whatsapp_outbound(uuid)',                                'service_role',  true),
      ('public.record_whatsapp_provider_acceptance(uuid,uuid,text)',          'service_role',  true),
      ('public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)', 'service_role', true),
      ('public.claim_whatsapp_inbound_processing(uuid,uuid)',                 'service_role',  true),
      ('public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)',     'service_role',  true),
      ('public.finalize_whatsapp_provider_failure(uuid,uuid,text)',           'service_role',  true),
      ('public.register_apollo_enrichment_targets(uuid,uuid,text,jsonb)',     'service_role',  true),
      ('public.select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid)',    'service_role',  true),
      ('public.prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text)',     'service_role',  true),
      ('public.claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text)', 'service_role', true),
      ('public.complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text)', 'service_role', true),
      ('public.mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid)',        'service_role',  true),
      ('public.list_apollo_enrichment_reconciliation(uuid,uuid,timestamptz,uuid,integer)', 'service_role', true),
      ('public.reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text)', 'service_role', true),
      ('public.erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text)', 'service_role', true),
      ('public.cleanup_apollo_enrichment_authority(uuid,integer)',             'service_role', true),
      ('public.list_candidate_erasure_requests(uuid,uuid,integer)',          'service_role', true),
      ('public.request_candidate_erasure(uuid,uuid,text,text,uuid)',          'service_role', true),
      ('public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)', 'service_role', true),
      ('public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)', 'service_role', true),
      ('public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)', 'service_role', true),
      ('public.release_candidate_legal_hold(uuid,uuid,uuid,text)',             'service_role', true),
      ('public.candidate_erasure_response(uuid,boolean)',                      'owner_only', true),
      ('public.refresh_candidate_erasure_legal_hold_state(uuid)',              'owner_only', true),
      ('public.candidate_erasure_constant_time_hex_equal(text,text)',          'owner_only', false),
      ('public.candidate_erasure_encrypt_reference(uuid,jsonb)',               'owner_only', true),
      ('public.candidate_erasure_identifier_hmac(uuid,text,text)',             'owner_only', true),
      ('public.candidate_erasure_identity_lock_key(uuid,text,text)',            'owner_only', false),
      ('public.candidate_erasure_provider_for_channel(text)',                  'owner_only', false),
      ('public.candidate_erasure_reference_hmac(uuid,jsonb)',                  'owner_only', true),
      ('public.candidate_erasure_tombstone_document(jsonb)',                   'owner_only', false),
      ('public.candidate_erasure_tombstone_exists(uuid,text,text)',            'owner_only', true),
      ('public.enforce_candidate_erasure_obligation_limit()',                 'owner_only', false),
      ('public.reject_candidate_erasure_apollo_reimport()',                   'owner_only', true),
      ('public.reject_candidate_erasure_receipt_mutation()',                  'owner_only', false),
      ('public.reject_candidate_erasure_reimport()',                          'owner_only', true),
      ('public.candidate_erasure_contains_identity(text,text[])',              'owner_only', false),
      ('public.scrub_candidate_workspace_document(jsonb,text)',                'owner_only', false),
      ('public.aria_job_payload_contract_ok(text,jsonb)',                      'owner_only', false),
      ('public.stamp_databricks_connection_authority()',                      'owner_only',    false),
      ('public.audit_databricks_connection_authority()',                      'owner_only',    true),
      ('public.strip_legacy_databricks_authority()',                          'owner_only',    false),
      ('public.normalize_whatsapp_e164(text)',                                'owner_only',    false),
      ('public.touch_updated_at()',                                           'owner_only',    false),
      ('public.enforce_active_whatsapp_approval()',                           'owner_only',    true),
      ('public.reject_apollo_reconciliation_event_mutation()',               'owner_only',    false),
      ('public.reject_apollo_erasure_event_mutation()',                     'owner_only',    false),
      ('public.enqueue_aria_job(uuid,text,text,jsonb,timestamptz,integer)',  'service_role',  true),
      ('public.claim_due_aria_jobs(text,integer,text[],integer)',            'service_role',  true),
      ('public.sourcing_loop_stage_enabled(uuid,text)',                      'service_role',  true),
      ('public.heartbeat_aria_job(uuid,uuid,integer)',                        'service_role',  true),
      ('public.complete_aria_job(uuid,uuid,text,jsonb,jsonb)',               'service_role',  true),
      ('public.fail_aria_job(uuid,uuid,text,boolean)',                        'service_role',  true),
      ('public.requeue_dead_aria_job(uuid)',                                  'authenticated', true),
      ('public.reap_expired_aria_job_leases(integer)',                        'service_role',  true),
      ('public.reap_expired_agent_framework_leases(integer)',                 'service_role',  true),
      ('public.get_sourcing_loop_controls(uuid)',                             'service_role',  true),
      ('public.set_sourcing_loop_controls(boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,integer)', 'authenticated', true),
      ('public.list_loop_events(bigint,integer)',                             'authenticated', true),
      ('public.record_loop_worker_heartbeat(text,text)',                      'service_role',  true),
      ('public.read_workspace_state_for_loop(uuid)',                          'service_role',  true),
      ('public.read_inbound_email_for_loop(uuid,uuid)',                       'service_role',  true),
      ('public.complete_aria_job_with_workspace_patch(uuid,uuid,timestamp with time zone,text,jsonb,text,text,jsonb,jsonb)', 'service_role', true),
      ('public.reject_loop_event_mutation()',                                 'owner_only',    false),
      ('public.redact_loop_events_for_candidate_erasure(uuid,text,text[],text[])', 'service_role', true),
      ('public.seed_sourcing_loop_control()',                                 'owner_only',    true),
      ('public.enqueue_email_outbound(text,text,text,uuid,text,text,text)',    'authenticated', true),
      ('public.claim_email_outbound_queued(uuid)',                            'service_role',  true),
      ('public.record_email_send_message_id(uuid,uuid,text)',                 'service_role',  true),
      ('public.finalize_email_provider_failure(uuid,uuid,text)',              'service_role',  true),
      ('public.record_email_delivery_event(uuid,text,text,timestamptz,integer,boolean)', 'service_role', true),
      ('public.cleanup_email_ledger_delivery_receipts(integer)',              'service_role',  true),
      ('public.enforce_active_email_approval()',                              'owner_only',    true),
      ('public.enforce_active_linkedin_approval()',                           'owner_only',    true),
      ('public.claim_linkedin_outbound_queued(uuid)',                         'service_role',  true),
      ('public.record_linkedin_delivery_outcome(uuid,uuid,text,text,text)',    'service_role',  true),
      ('public.claim_linkedin_loop_reply(uuid)',                              'service_role',  true),
      ('public.set_linkedin_sending_caps(integer,integer,text)',              'authenticated', true),
      ('public.launch_linkedin_campaign(text,uuid,jsonb,uuid,text,text,integer,integer,integer,text)', 'authenticated', true),
      ('public.revoke_linkedin_reply_loop(uuid,text)',                        'authenticated', true),
      ('public.linkedin_workspace_timezone(uuid)',                            'owner_only',    true),
      ('public.linkedin_messages_today(uuid)',                                'owner_only',    true),
      ('public.linkedin_connects_today(uuid)',                                'owner_only',    true),
      ('public.resolve_inbound_mailbox_route(text)',                          'service_role',  true),
      ('public.record_inbound_email(uuid,text,text,text)',                    'service_role',  true),
      ('public.correlate_inbound_email(uuid,text)',                           'service_role',  true),
      ('public.record_candidate_outcome(uuid,text,text,text,uuid)',           'service_role',  true),
      ('public.cleanup_erased_candidate_outcomes()',                          'owner_only',    true),
      ('public.apply_workspace_patch(uuid,timestamptz,text,jsonb,text)',       'service_role',  true),
      ('public.ingest_requisition(uuid,text,text)',                           'service_role',  true),
      ('public.record_requisition_parse(uuid,jsonb,jsonb,numeric,boolean)',   'service_role',  true),
      ('public.record_requisition_campaign(uuid,text)',                       'service_role',  true),
      ('public.list_workspace_requisitions(integer,integer)',                 'authenticated', true),
      ('public.begin_provider_run(uuid,text,text,text)',                      'service_role',  true),
      ('public.attach_provider_run(uuid,text,text)',                          'service_role',  true),
      ('public.settle_provider_run(uuid,boolean)',                            'service_role',  true),
      ('public.settle_provider_run_by_external(uuid,text,text,boolean)',      'service_role',  true),
      ('public.read_provider_run_for_loop(uuid,uuid)',                        'service_role',  true),
      ('public.claim_enrichment_budget(uuid,text,text,integer,text)',         'service_role',  true),
      ('public.settle_enrichment_spend(uuid,integer)',                        'service_role',  true),
      ('public.release_enrichment_claim(uuid)',                               'service_role',  true),
      ('public.create_outreach_sequence(uuid,text,text,integer,jsonb)',       'service_role',  true),
      ('public.activate_outreach_sequence(uuid)',                             'service_role',  true),
      ('public.stop_outreach_sequence(uuid,text)',                            'service_role',  true),
      ('public.claim_sequence_step_for_schedule(uuid)',                       'service_role',  true),
      ('public.bind_sequence_step_outbound(uuid,uuid)',                       'service_role',  true),
      ('public.record_sequence_step_sent(uuid,uuid)',                         'service_role',  true),
      ('public.promote_due_sequence_steps(uuid,integer)',                     'service_role',  true),
      ('public.cleanup_erased_candidate_sequences()',                         'owner_only',    true),
      ('public.release_elapsed_outreach_contact_window()',                    'owner_only',    false),
      ('public.seed_swarm_roster()',                                          'authenticated', true),
      ('public.set_swarm_agent(uuid,boolean,integer,boolean,text)',           'authenticated', true),
      ('public.create_swarm_mission(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,uuid,uuid)', 'service_role', true),
      ('public.plan_swarm_assignments(uuid,uuid,jsonb)',                      'service_role',  true),
      ('public.dispatch_ready_swarm_assignments(integer)',                    'service_role',  true),
      ('public.record_swarm_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,text,jsonb)', 'service_role', true),
      ('public.route_swarm_reviews(integer)',                                 'service_role',  true),
      ('public.mark_stale_swarm_assignments(integer,integer)',                'service_role',  true),
      ('public.get_swarm_runtime(uuid)',                                      'service_role',  true),
      ('public.get_swarm_assignment_envelope(uuid,uuid)',                     'service_role',  true),
      ('public.answer_swarm_escalation(uuid,text,text)',                      'authenticated', true),
      ('public.cancel_swarm_mission(uuid,text)',                              'authenticated', true),
      ('public.list_swarm_missions(integer)',                                 'authenticated', true),
      ('public.list_swarm_escalations(text,integer)',                         'authenticated', true),
      ('public.swarm_recompute_mission_status(uuid)',                         'owner_only',    true),
      ('public.reject_swarm_checkpoint_mutation()',                           'owner_only',    false)
    ) as expected_matrix(signature, allowed_role, security_definer)
  loop
    if to_regprocedure(item.signature) is null then
      raise exception 'Missing expected routine: %', item.signature;
    end if;

    foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
    loop
      expected := role_name = item.allowed_role;
      execute format('select has_function_privilege(%L, %L, %L)', role_name, item.signature, 'EXECUTE') into actual;
      if actual is distinct from expected then
        raise exception 'Unexpected EXECUTE privilege for role % on %: expected %, got %',
          role_name, item.signature, expected, actual;
      end if;
    end loop;

    select exists (
      select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = to_regprocedure(item.signature)
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
    ) into public_execute;
    if public_execute then
      raise exception 'PUBLIC retains EXECUTE on %', item.signature;
    end if;

    select p.prosecdef, array_to_string(p.proconfig, ',')
      into actual, saved_path
      from pg_proc p
     where p.oid = to_regprocedure(item.signature);
    if actual is distinct from item.security_definer then
      raise exception 'Unexpected SECURITY DEFINER state on %', item.signature;
    end if;
    if saved_path is null or saved_path !~ 'search_path=.*pg_temp$' then
      raise exception 'Unsafe saved search_path on %: %', item.signature, saved_path;
    end if;
  end loop;

  if to_regprocedure('public.record_whatsapp_delivery_event(uuid,text,text,timestamptz,integer)') is not null then
    raise exception 'Removed five-argument delivery-event overload still exists';
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_schema_privilege(role_name, 'public', 'CREATE') then
      raise exception 'Role % retains CREATE on public schema', role_name;
    end if;
    if to_regnamespace('extensions') is not null and has_schema_privilege(role_name, 'extensions', 'CREATE') then
      raise exception 'Role % retains CREATE on extensions schema', role_name;
    end if;
  end loop;

  select pg_get_functiondef(to_regprocedure('public.claim_and_record(text,text,text,uuid,text,integer)'))
    into function_def;
  if function_def ~* 'auth\.role\(\).*service_role' then
    raise exception 'claim_and_record service JWT assertion breaks the authenticated SECURITY DEFINER wrapper';
  end if;

  for item in
    select signature from (values
      ('public.claim_whatsapp_outbound(uuid)'),
      ('public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'),
      ('public.attach_agent_framework_run_memory_context(uuid,uuid,uuid,uuid,uuid)'),
      ('public.authorize_agent_framework_memory_egress(uuid,uuid)'),
      ('public.create_agent_memory(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamptz)'),
      ('public.mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamptz)'),
      ('public.delete_agent_memory_content(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer)'),
      ('public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)'),
      ('public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)'),
      ('public.engage_agent_framework_kill_switch(uuid,uuid,uuid,bigint)'),
      ('public.cleanup_agent_framework_authority(uuid,integer)'),
      ('public.inspect_agent_framework_control_authority(uuid,uuid)'),
      ('public.recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text)'),
      ('public.import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)'),
      ('public.review_agent_workflow_version(uuid,uuid,uuid,text,text)'),
      ('public.list_agent_framework_workflows(uuid,uuid,uuid)'),
      ('public.list_agent_framework_heartbeat_targets(uuid)'),
      ('public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)'),
      ('public.record_agent_framework_step_receipt(uuid,uuid,integer,text,text,text,text)'),
      ('public.release_agent_framework_memory_egress(uuid,uuid,uuid)'),
      ('public.complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb)'),
      ('public.begin_agent_framework_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text)'),
      ('public.check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid)'),
      ('public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb)'),
      ('public.ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text)'),
      ('public.fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text)'),
      ('public.fail_agent_framework_run(uuid,uuid,text)'),
      ('public.record_whatsapp_provider_acceptance(uuid,uuid,text)'),
      ('public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)'),
      ('public.claim_whatsapp_inbound_processing(uuid,uuid)'),
      ('public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)'),
      ('public.finalize_whatsapp_provider_failure(uuid,uuid,text)'),
      ('public.register_apollo_enrichment_targets(uuid,uuid,text,jsonb)'),
      ('public.select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid)'),
      ('public.prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text)'),
      ('public.claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text)'),
      ('public.complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text)'),
      ('public.mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid)'),
      ('public.list_apollo_enrichment_reconciliation(uuid,uuid,timestamptz,uuid,integer)'),
      ('public.reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text)'),
      ('public.erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text)'),
      ('public.cleanup_apollo_enrichment_authority(uuid,integer)'),
      ('public.list_candidate_erasure_requests(uuid,uuid,integer)'),
      ('public.request_candidate_erasure(uuid,uuid,text,text,uuid)'),
      ('public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'),
      ('public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'),
      ('public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'),
      ('public.release_candidate_legal_hold(uuid,uuid,uuid,text)'),
      ('public.resolve_whatsapp_inbound_conversation(uuid,uuid)'),
      ('public.enqueue_aria_job(uuid,text,text,jsonb,timestamptz,integer)'),
      ('public.claim_due_aria_jobs(text,integer,text[],integer)'),
      ('public.sourcing_loop_stage_enabled(uuid,text)'),
      ('public.heartbeat_aria_job(uuid,uuid,integer)'),
      ('public.complete_aria_job(uuid,uuid,text,jsonb,jsonb)'),
      ('public.fail_aria_job(uuid,uuid,text,boolean)'),
      ('public.reap_expired_aria_job_leases(integer)'),
      ('public.reap_expired_agent_framework_leases(integer)'),
      ('public.get_sourcing_loop_controls(uuid)'),
      ('public.record_loop_worker_heartbeat(text,text)'),
      ('public.read_workspace_state_for_loop(uuid)'),
      ('public.read_inbound_email_for_loop(uuid,uuid)'),
      ('public.complete_aria_job_with_workspace_patch(uuid,uuid,timestamp with time zone,text,jsonb,text,text,jsonb,jsonb)'),
      ('public.redact_loop_events_for_candidate_erasure(uuid,text,text[],text[])'),
      ('public.claim_email_outbound_queued(uuid)'),
      ('public.record_email_send_message_id(uuid,uuid,text)'),
      ('public.finalize_email_provider_failure(uuid,uuid,text)'),
      ('public.record_email_delivery_event(uuid,text,text,timestamptz,integer,boolean)'),
      ('public.cleanup_email_ledger_delivery_receipts(integer)'),
      ('public.claim_linkedin_outbound_queued(uuid)'),
      ('public.record_linkedin_delivery_outcome(uuid,uuid,text,text,text)'),
      ('public.resolve_inbound_mailbox_route(text)'),
      ('public.record_inbound_email(uuid,text,text,text)'),
      ('public.correlate_inbound_email(uuid,text)'),
      ('public.record_candidate_outcome(uuid,text,text,text,uuid)'),
      ('public.apply_workspace_patch(uuid,timestamptz,text,jsonb,text)'),
      ('public.ingest_requisition(uuid,text,text)'),
      ('public.record_requisition_parse(uuid,jsonb,jsonb,numeric,boolean)'),
      ('public.record_requisition_campaign(uuid,text)'),
      ('public.begin_provider_run(uuid,text,text,text)'),
      ('public.attach_provider_run(uuid,text,text)'),
      ('public.settle_provider_run(uuid,boolean)'),
      ('public.settle_provider_run_by_external(uuid,text,text,boolean)'),
      ('public.read_provider_run_for_loop(uuid,uuid)'),
      ('public.claim_enrichment_budget(uuid,text,text,integer,text)'),
      ('public.settle_enrichment_spend(uuid,integer)'),
      ('public.release_enrichment_claim(uuid)'),
      ('public.create_outreach_sequence(uuid,text,text,integer,jsonb)'),
      ('public.activate_outreach_sequence(uuid)'),
      ('public.stop_outreach_sequence(uuid,text)'),
      ('public.claim_sequence_step_for_schedule(uuid)'),
      ('public.bind_sequence_step_outbound(uuid,uuid)'),
      ('public.record_sequence_step_sent(uuid,uuid)'),
      ('public.promote_due_sequence_steps(uuid,integer)'),
      ('public.create_swarm_mission(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,uuid,uuid)'),
      ('public.plan_swarm_assignments(uuid,uuid,jsonb)'),
      ('public.dispatch_ready_swarm_assignments(integer)'),
      ('public.record_swarm_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,text,jsonb)'),
      ('public.route_swarm_reviews(integer)'),
      ('public.mark_stale_swarm_assignments(integer,integer)'),
      ('public.get_swarm_runtime(uuid)'),
      ('public.get_swarm_assignment_envelope(uuid,uuid)')
    ) as service_functions(signature)
  loop
    select pg_get_functiondef(to_regprocedure(item.signature)) into function_def;
    if function_def !~* 'auth\.role\(\).*service_role' then
      raise exception 'Service RPC lacks an in-body service_role assertion: %', item.signature;
    end if;
  end loop;

  execute 'create table public.__aria_default_acl_table_probe(id bigint)';
  execute 'create sequence public.__aria_default_acl_sequence_probe';
  execute 'create function public.__aria_default_acl_function_probe() returns integer language sql as ''select 1''';

  select pg_get_userbyid(relowner) into object_owner
    from pg_class where oid = 'public.__aria_default_acl_table_probe'::regclass;
  if object_owner <> 'postgres' then
    raise exception 'Postgres direct-session probe has unexpected owner: %', object_owner;
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'SELECT')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'INSERT')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'UPDATE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'DELETE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'TRUNCATE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'REFERENCES')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'TRIGGER')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'MAINTAIN') then
      raise exception 'New tables expose privileges to role %', role_name;
    end if;
    if has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'USAGE')
       or has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'SELECT')
       or has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'UPDATE') then
      raise exception 'New sequences expose privileges to role %', role_name;
    end if;
    if has_function_privilege(role_name, 'public.__aria_default_acl_function_probe()', 'EXECUTE') then
      raise exception 'New functions expose EXECUTE to role %', role_name;
    end if;
  end loop;

  select exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = to_regprocedure('public.__aria_default_acl_function_probe()')
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New functions still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where c.oid = 'public.__aria_default_acl_table_probe'::regclass
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New tables still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) acl
     where c.oid = 'public.__aria_default_acl_sequence_probe'::regclass
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New sequences still inherit PUBLIC privileges';
  end if;

  execute 'drop function public.__aria_default_acl_function_probe()';
  execute 'drop sequence public.__aria_default_acl_sequence_probe';
  execute 'drop table public.__aria_default_acl_table_probe';
end
$aria_function_privilege_test$;

do $aria_supabase_admin_default_acl_test$
declare
  role_name text;
  public_privilege boolean;
  object_owner text;
begin
  if to_regclass('public.__aria_supabase_admin_default_acl_table_probe') is null
     or to_regclass('public.__aria_supabase_admin_default_acl_sequence_probe') is null
     or to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()') is null then
    raise exception 'Missing probes from the direct supabase_admin session';
  end if;

  select pg_get_userbyid(relowner) into object_owner
    from pg_class
   where oid = 'public.__aria_supabase_admin_default_acl_table_probe'::regclass;
  if object_owner <> 'supabase_admin' then
    raise exception 'Supabase owner probe has unexpected owner: %', object_owner;
  end if;
  select pg_get_userbyid(proowner) into object_owner
    from pg_proc
   where oid = to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()');
  if object_owner <> 'supabase_admin' then
    raise exception 'Supabase owner function has unexpected owner: %', object_owner;
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'SELECT')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'INSERT')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'UPDATE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'DELETE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'TRUNCATE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'REFERENCES')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'TRIGGER')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'MAINTAIN') then
      raise exception 'New supabase_admin tables expose privileges to role %', role_name;
    end if;
    if has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'USAGE')
       or has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'SELECT')
       or has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'UPDATE') then
      raise exception 'New supabase_admin sequences expose privileges to role %', role_name;
    end if;
    if has_function_privilege(
      role_name,
      'public.__aria_supabase_admin_default_acl_function_probe()',
      'EXECUTE'
    ) then
      raise exception 'New supabase_admin functions expose EXECUTE to role %', role_name;
    end if;
  end loop;

  select exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()')
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin functions still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where c.oid = 'public.__aria_supabase_admin_default_acl_table_probe'::regclass
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin tables still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) acl
     where c.oid = 'public.__aria_supabase_admin_default_acl_sequence_probe'::regclass
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin sequences still inherit PUBLIC privileges';
  end if;
end
$aria_supabase_admin_default_acl_test$;

rollback;
