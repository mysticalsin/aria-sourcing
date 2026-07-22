-- Rollback for 0054_sourcing_batch_authority.sql.
-- Refuses to destroy sourcing evidence, egress receipts, or quota history.

do $$
begin
  if exists (select 1 from public.sourcing_batch_claims limit 1)
     or exists (select 1 from public.sourcing_batch_egress_attempts limit 1)
     or exists (select 1 from public.sourcing_batch_source_receipts limit 1)
     or exists (select 1 from public.sourcing_candidate_evidence limit 1)
     or exists (select 1 from public.sourcing_batch_receipts limit 1)
     or exists (select 1 from public.sourcing_provider_quota_ledger limit 1)
     or exists (
       select 1 from public.candidate_erasure_receipts
        where store_name = 'sourcing_candidate_evidence' limit 1
     ) then
    raise exception '0054 rollback refused: sourcing authority evidence exists'
      using errcode = '55000';
  end if;
end;
$$;

drop trigger if exists aria_jobs_sourcing_batch_transition_guard on public.aria_jobs;
drop trigger if exists candidate_erasure_requests_sourcing_evidence_cleanup
  on public.candidate_erasure_requests;
drop trigger if exists sourcing_candidate_evidence_reimport_guard
  on public.sourcing_candidate_evidence;
drop trigger if exists sourcing_batch_source_receipts_append_only
  on public.sourcing_batch_source_receipts;
drop trigger if exists sourcing_batch_receipts_append_only
  on public.sourcing_batch_receipts;
drop trigger if exists sourcing_provider_quota_ledger_append_only
  on public.sourcing_provider_quota_ledger;

drop function if exists public.get_sourcing_loop_readiness(text);
drop function if exists public.record_sourcing_loop_heartbeat(text, text, text);
drop function if exists public.fail_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  text, boolean, boolean, jsonb, text, integer, integer
);
drop function if exists public.commit_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, uuid,
  jsonb, jsonb, jsonb, text
);
drop function if exists public.begin_sourcing_batch_egress(
  uuid, uuid, uuid, uuid, text, integer, uuid, bigint, text, text
);
drop function if exists public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
);
drop function if exists public.claim_due_sourcing_batch_jobs(text, integer, integer);
drop function if exists public.pause_sourcing_batch_pre_egress(
  uuid, uuid, uuid, uuid, text, integer, text
);
drop function if exists public.validate_sourcing_batch_candidates(
  uuid, uuid, jsonb, jsonb, jsonb
);
drop function if exists public.persist_sourcing_batch_source_receipts(
  uuid, uuid, uuid, text, integer, jsonb, boolean, text
);
drop function if exists public.guard_sourcing_batch_job_transition();
drop function if exists public.cleanup_sourcing_candidate_evidence();
drop function if exists public.reject_sourcing_candidate_evidence_reimport();
drop function if exists public.reject_sourcing_batch_receipt_mutation();
drop function if exists public.sourcing_batch_result_sha256(
  uuid, uuid, uuid, text, integer, uuid, bigint, uuid, jsonb, jsonb, text
);
drop function if exists public.validate_sourcing_batch_source_receipts(jsonb, text, integer, boolean, text);
drop function if exists public.sourcing_batch_query_is_allowed(jsonb, integer, jsonb);
drop function if exists public.sourcing_batch_expected_query(jsonb, integer);
drop function if exists public.sourcing_campaign_document_status(jsonb, uuid);
drop function if exists public.sourcing_candidate_target();
drop function if exists public.sourcing_max_batch_ordinal();
drop function if exists public.expected_sourcing_loop_handler_contract_sha256();

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results'
  ));

drop table if exists public.sourcing_batch_source_receipts;
drop table if exists public.sourcing_candidate_evidence;
drop table if exists public.sourcing_batch_receipts;
drop table if exists public.sourcing_provider_quota_ledger;
drop table if exists public.sourcing_batch_egress_attempts;
drop table if exists public.sourcing_batch_claims;
drop function if exists public.sourcing_batch_lesson_snapshot_sha256(jsonb);

alter table public.loop_worker_heartbeats
  drop column if exists handler_contract_sha256;

alter table public.sourcing_campaigns
  drop column if exists sourcing_pause_reason;
