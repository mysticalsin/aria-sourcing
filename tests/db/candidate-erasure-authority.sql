\set ON_ERROR_STOP on

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name,allowed_domain) values
  ('11111111-1111-4111-8111-111111111111','Erasure A','example.test'),
  ('22222222-2222-4222-8222-222222222222','Erasure B','other.test');
insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','admin-a@example.test','Admin A','11111111-1111-4111-8111-111111111111','admin'),
  ('a2000000-0000-4000-8000-000000000002','admin-b@example.test','Admin B','22222222-2222-4222-8222-222222222222','admin');

insert into public.workspace_state(workspace_id,state) values
  ('11111111-1111-4111-8111-111111111111', '{
    "candidates":[
      {
        "id":"33333333-3333-4333-8333-333333333333",
        "campaignId":"campaign-a",
        "name":"Ian",
        "email":"ian@example.test",
        "phone":"+14155550101",
        "linkedinUrl":"https://linkedin.test/in/ian",
        "githubUrl":"https://github.test/ian",
        "sourceUrl":"https://github.test/ian",
        "sourceExternalId":"ian-provider",
        "sourceAuthorityId":"",
        "sourcePlatform":"GitHub",
        "currentTitle":"Staff Engineer",
        "currentCompany":"Example Co",
        "techStack":["Go","PostgreSQL"],
        "notes":[{"id":"note-1","text":"Private candidate note","at":"2026-07-01T00:00:00Z"}],
        "createdAt":"2026-07-01T00:00:00Z",
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      },
      {
        "id":"44444444-4444-4444-8444-444444444444",
        "campaignId":"campaign-a",
        "name":"Maya",
        "email":"maya@example.test",
        "phone":"",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "createdAt":"2026-07-01T00:00:00Z",
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      }
    ],
    "activities":[
      {"id":"activity-ian","title":"Ian reviewed","notes":"ian@example.test","outcome":"Open","linkedEntityType":"candidate","linkedEntityId":"33333333-3333-4333-8333-333333333333"},
      {"id":"activity-compliance","title":"Compliance review","notes":"Policy remains","outcome":"Open","linkedEntityType":"campaign","linkedEntityId":"campaign-a"}
    ],
    "outreach":[],"replies":[],"bookings":[],"wins":[],"ledger":[],
    "suppression":[],"campaigns":[],"chats":[],"ingestedMessageIds":[],
    "chatboxSubmissions":[]
  }'),
  ('22222222-2222-4222-8222-222222222222', '{"candidates":[]}');

insert into public.suppression_list(workspace_id,type,value,reason,source) values
  ('11111111-1111-4111-8111-111111111111','email','ian@example.test','candidate request','Operator'),
  ('11111111-1111-4111-8111-111111111111','phone','14155550101','candidate request','Operator');
insert into public.outreach_ledger(workspace_id,candidate_id,candidate_email,campaign_id,status) values
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','ian@example.test','campaign-a','sent');

insert into public.agent_specs(id,workspace_id,owner_id,name,role_brief,status) values
  ('51000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','Erasure runner','{"title":"Test"}','active');
insert into public.agent_runs(
  id,spec_id,workspace_id,owner_id,actor_id,node,state_json,status
) values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'sourcer',
  '{"candidateId":"33333333-3333-4333-8333-333333333333","private":"Ian"}',
  'running'
);
insert into public.agent_events(run_id,workspace_id,type,payload) values (
  '52000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'note',
  '{"message":"Ian confidential detail without candidate id"}'
);
insert into public.agent_memories(
  id, workspace_id, owner_id, spec_id, kind, content_ciphertext,
  content_sha256, content_byte_count, status, source_type, created_by, updated_by
) values (
  '56000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'episodic',
  'enc:v2:' || repeat('1',64) || ':QUFBQQ==:QkJCQg==:Q0NDQw==',
  repeat('2',64), 24, 'approved', 'operator',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.messages_outbound(
  id,workspace_id,candidate_id,channel,to_address,type,subject,body,status,
  dedupe_hash,provider_message_id
) values (
  '53000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  'LinkedIn','https://linkedin.test/in/ian','candidate_reply','Hello','Private body',
  'sent',repeat('c',64),'linkedin-message-1'
);
insert into public.messages_inbound(
  id,workspace_id,candidate_id,channel,from_address,body,provider_id
) values (
  '54000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  null,'Email','ian@example.test','Unbound triage PII','email-message-1'
);
insert into public.apollo_enrichment_targets(
  id,workspace_id,campaign_id,candidate_id,provider_external_id,profile_hash,created_by
) values (
  '55000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'campaign-a','33333333-3333-4333-8333-333333333333',
  'apollo-person-ian',repeat('e',64),'a1000000-0000-4000-8000-000000000001'
);

create schema candidate_erasure_test;
create function candidate_erasure_test.set_service_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'service_role')::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;
create function candidate_erasure_test.assert_scalar(case_name text, statement text, expected text)
returns void language plpgsql set search_path = pg_catalog as $$
declare actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;
create function candidate_erasure_test.assert_sqlstate(
  case_name text, statement text, expected_codes text[]
)
returns void language plpgsql set search_path = pg_catalog as $$
declare caught text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    if caught = any(expected_codes) then return; end if;
    raise exception 'Case "%" returned SQLSTATE %, expected %', case_name, caught, expected_codes;
  end;
  raise exception 'Case "%" unexpectedly succeeded', case_name;
end;
$$;

grant usage on schema candidate_erasure_test to service_role;
grant execute on all functions in schema candidate_erasure_test to service_role;

select candidate_erasure_test.assert_scalar(
  'service role retains read-only legacy run and event access',
  $$select concat_ws(':',
      has_table_privilege('service_role','public.agent_runs','SELECT'),
      has_table_privilege('service_role','public.agent_runs','INSERT'),
      has_table_privilege('service_role','public.agent_runs','UPDATE'),
      has_table_privilege('service_role','public.agent_runs','DELETE'),
      has_table_privilege('service_role','public.agent_events','SELECT'),
      has_table_privilege('service_role','public.agent_events','INSERT'),
      has_table_privilege('service_role','public.agent_events','UPDATE'),
      has_table_privilege('service_role','public.agent_events','DELETE'))$$,
  't:f:f:f:t:f:f:f'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'service role cannot update legacy agent runs directly',
  $$update public.agent_runs set node='reporter'
      where id='52000000-0000-4000-8000-000000000001'$$,
  array['42501']
);
select candidate_erasure_test.assert_sqlstate(
  'service role cannot insert legacy agent events directly',
  $$insert into public.agent_events(run_id,workspace_id,type,payload) values (
      '52000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111','note','{}'::jsonb)$$,
  array['42501']
);
select public.create_agent_run_with_memory_context(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001'
);
reset role;
select candidate_erasure_test.assert_scalar(
  'postgres-owned security-definer run receipt RPC remains functional',
  $$select exists (
      select 1 from public.agent_runs
       where workspace_id='11111111-1111-4111-8111-111111111111'
         and spec_id='51000000-0000-4000-8000-000000000001'
         and actor_id='a1000000-0000-4000-8000-000000000001'
         and node='planner' and state_json='{}'::jsonb
    )::text$$,
  'true'
);

set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select public.mutate_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  1,
  'edit',
  null,
  'enc:v2:' || repeat('3',64) || ':QUFBQQ==:QkJCQg==:Q0NDQw==',
  repeat('4',64),
  24,
  null,
  false,
  null,
  true,
  'campaign-a',
  '[{"kind":"email","value":" IAN@EXAMPLE.TEST "}]'::jsonb
);
reset role;
select candidate_erasure_test.assert_scalar(
  'candidate payload provenance stores no plaintext alias value',
  $$select (position('ian@example.test' in row_to_json(provenance)::text)=0)::text
      from public.candidate_payload_provenance provenance
     where memory_id='56000000-0000-4000-8000-000000000001'$$,
  'true'
);

set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'service role cannot bypass atomic provenance through legacy create',
  $$select public.create_agent_memory(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001', 'fact',
      'enc:v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:QUFBQQ==:QkJCQg==:Q0NDQw==',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      24, false, null
    )$$,
  array['42501']
);
select candidate_erasure_test.assert_sqlstate(
  'service role cannot bypass atomic provenance through legacy mutate',
  $$select public.mutate_agent_memory(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '56000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001', 2, 'edit', null,
      'enc:v2:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:QUFBQQ==:QkJCQg==:Q0NDQw==',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      24, null, false, null
    )$$,
  array['42501']
);

create temporary table candidate_memory_writer_result as
select public.create_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'fact',
  'enc:v2:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:QUFBQQ==:QkJCQg==:Q0NDQw==',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  24, false, null, 'campaign-writer',
  '[{"kind":"email","value":"writer-old@example.test"}]'::jsonb
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'atomic memory create reports one HMAC-only identity',
  $$select concat_ws(':', result->>'status', result->>'candidate_identities_recorded')
      from candidate_memory_writer_result$$,
  'created:1'
);
create temporary table generic_memory_writer_result as
select public.create_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'instruction',
  'enc:v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:QUFBQQ==:QkJCQg==:Q0NDQw==',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  24, false, null, null, '[]'::jsonb
) result;
select candidate_erasure_test.assert_scalar(
  'explicit no-candidate classification creates no provenance rows',
  $$select concat_ws(':', result->>'status', result->>'candidate_identities_recorded',
      (select count(*) from public.candidate_payload_provenance provenance
        where provenance.memory_id=(result->>'id')::uuid))
      from generic_memory_writer_result$$,
  'created:0:0'
);
select candidate_erasure_test.assert_scalar(
  'atomic memory create is tenant-bound',
  $$select public.create_agent_memory_with_candidate_provenance(
      '22222222-2222-4222-8222-222222222222',
      'a1000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001', 'fact',
      'enc:v2:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:QUFBQQ==:QkJCQg==:Q0NDQw==',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      24, false, null, null, '[]'::jsonb
    )->>'status'$$,
  'not_found'
);
create temporary table candidate_memory_replace_result as
select public.mutate_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  (result->>'id')::uuid,
  'a1000000-0000-4000-8000-000000000001', 1, 'edit', null,
  'enc:v2:1111111111111111111111111111111111111111111111111111111111111111:QUFBQQ==:QkJCQg==:Q0NDQw==',
  '2222222222222222222222222222222222222222222222222222222222222222',
  25, null, false, null, true, 'campaign-writer',
  '[{"kind":"candidate_id","value":"writer-new-id"}]'::jsonb
) result from candidate_memory_writer_result;
select candidate_erasure_test.assert_scalar(
  'atomic content replacement swaps only the exact memory provenance set',
  $$select concat_ws(':', changed.result->>'status',
      (select count(*) from public.candidate_payload_provenance provenance
        where provenance.memory_id=(select (result->>'id')::uuid from candidate_memory_writer_result)
          and provenance.identifier_kind='email'),
      (select count(*) from public.candidate_payload_provenance provenance
        where provenance.memory_id=(select (result->>'id')::uuid from candidate_memory_writer_result)
          and provenance.identifier_kind='candidate_id')
    ) from candidate_memory_replace_result changed$$,
  'updated:0:1'
);
create temporary table candidate_memory_metadata_result as
select public.mutate_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  (result->>'id')::uuid,
  'a1000000-0000-4000-8000-000000000001', 2, 'edit', null,
  null, null, null, true, false, null, false, null, null
) result from candidate_memory_writer_result;
select candidate_erasure_test.assert_scalar(
  'content cannot bypass classification through metadata preserve mode',
  $$select public.mutate_agent_memory_with_candidate_provenance(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      (result->>'id')::uuid,
      'a1000000-0000-4000-8000-000000000001', 3, 'edit', null,
      'enc:v2:3333333333333333333333333333333333333333333333333333333333333333:QUFBQQ==:QkJCQg==:Q0NDQw==',
      '4444444444444444444444444444444444444444444444444444444444444444',
      24, null, false, null, false, null, null
    )->>'status' from candidate_memory_writer_result$$,
  'invalid_request'
);
select candidate_erasure_test.assert_scalar(
  'metadata-only edits preserve candidate provenance',
  $$select concat_ws(':', changed.result->>'status',
      (select count(*) from public.candidate_payload_provenance provenance
        where provenance.memory_id=(select (result->>'id')::uuid from candidate_memory_writer_result))
    ) from candidate_memory_metadata_result changed$$,
  'updated:1'
);
select candidate_erasure_test.assert_scalar(
  'stale classified content replay preserves the current revision and alias set',
  $$with replay as (
      select public.mutate_agent_memory_with_candidate_provenance(
        '11111111-1111-4111-8111-111111111111',
        'a1000000-0000-4000-8000-000000000001',
        '51000000-0000-4000-8000-000000000001',
        (result->>'id')::uuid,
        'a1000000-0000-4000-8000-000000000001', 2, 'edit', null,
        'enc:v2:5555555555555555555555555555555555555555555555555555555555555555:QUFBQQ==:QkJCQg==:Q0NDQw==',
        '6666666666666666666666666666666666666666666666666666666666666666',
        24, null, false, null, true, null,
        '[{"kind":"email","value":"stale-replay@example.test"}]'::jsonb
      ) result from candidate_memory_writer_result
    )
    select concat_ws(':', replay.result->>'status',
      (select revision from public.agent_memories memory
        where memory.id=(select (result->>'id')::uuid from candidate_memory_writer_result)),
      (select string_agg(identifier_kind, ',' order by identifier_kind)
        from public.candidate_payload_provenance provenance
       where provenance.memory_id=(select (result->>'id')::uuid from candidate_memory_writer_result))
    ) from replay$$,
  'revision_conflict:3:candidate_id'
);
create temporary table candidate_memory_review_result as
select public.mutate_agent_memory_with_candidate_provenance(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  (result->>'id')::uuid,
  'a1000000-0000-4000-8000-000000000001', 3, 'approve', null,
  null, null, null, null, false, null, false, null, null
) result from candidate_memory_writer_result;
select candidate_erasure_test.assert_scalar(
  'review transitions preserve candidate provenance',
  $$select concat_ws(':', changed.result->>'status',
      (select count(*) from public.candidate_payload_provenance provenance
        where provenance.memory_id=(select (result->>'id')::uuid from candidate_memory_writer_result))
    ) from candidate_memory_review_result changed$$,
  'updated:1'
);
reset role;

select candidate_erasure_test.assert_scalar(
  'candidate erasure lock keys normalize equivalent email and phone identities',
  $$select (
      public.candidate_erasure_identity_lock_key(
        '11111111-1111-4111-8111-111111111111', 'email', ' IAN@EXAMPLE.TEST '
      ) = public.candidate_erasure_identity_lock_key(
        '11111111-1111-4111-8111-111111111111', 'email', 'ian@example.test'
      )
      and public.candidate_erasure_identity_lock_key(
        '11111111-1111-4111-8111-111111111111', 'phone', '+1 (415) 555-0101'
      ) = public.candidate_erasure_identity_lock_key(
        '11111111-1111-4111-8111-111111111111', 'phone', '14155550101'
      )
      and public.candidate_erasure_identity_lock_key(
        '11111111-1111-4111-8111-111111111111', 'email', 'ian@example.test'
      ) <> public.candidate_erasure_identity_lock_key(
        '22222222-2222-4222-8222-222222222222', 'email', 'ian@example.test'
      )
    )::text$$,
  'true'
);
select candidate_erasure_test.assert_scalar(
  'erasure and both reimport guard functions take transaction advisory locks through one key authority',
  $$select count(*)::text
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'public'
       and routine.proname in (
         'request_candidate_erasure',
         'reject_candidate_erasure_reimport',
         'reject_candidate_erasure_apollo_reimport'
       )
       and pg_get_functiondef(routine.oid) like '%pg_advisory_xact_lock%'
       and pg_get_functiondef(routine.oid) like '%candidate_erasure_identity_lock_key%'$$,
  '3'
);
select candidate_erasure_test.assert_scalar(
  'all nine candidate reimport triggers use an advisory-locking guard',
  $$select count(*)::text
      from pg_trigger trigger
      join pg_proc routine on routine.oid = trigger.tgfoid
     where not trigger.tgisinternal
       and trigger.tgname in (
         'workspace_state_candidate_erasure_reimport_guard',
         'messages_outbound_candidate_erasure_reimport_guard',
         'messages_inbound_candidate_erasure_reimport_guard',
         'outreach_ledger_candidate_erasure_reimport_guard',
         'suppression_list_candidate_erasure_reimport_guard',
         'whatsapp_contacts_candidate_erasure_reimport_guard',
         'whatsapp_windows_candidate_erasure_reimport_guard',
         'agent_conversations_candidate_erasure_reimport_guard',
         'apollo_target_candidate_erasure_reimport_guard'
       )
       and pg_get_functiondef(routine.oid) like '%pg_advisory_xact_lock%'
       and pg_get_functiondef(routine.oid) like '%candidate_erasure_identity_lock_key%'$$,
  '9'
);

set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table active_hold as
select public.place_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  'LITIGATION',
  'case:hold-1',
  now() + interval '1 day'
) result;
create temporary table active_hold_replay as
select public.place_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  'LITIGATION',
  'case:hold-1',
  (select (result->>'expires_at')::timestamptz from active_hold)
) result;
create temporary table active_hold_conflict as
select public.place_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  'REGULATORY',
  'case:hold-2',
  (select (result->>'expires_at')::timestamptz from active_hold)
) result;
create temporary table held_result as
select public.request_candidate_erasure(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  '61000000-0000-4000-8000-000000000001'
) result;
reset role;

select candidate_erasure_test.assert_scalar(
  'exact active hold replay preserves one legal matter',
  $$select concat_ws(':', result->>'status', result->>'replayed') from active_hold_replay$$,
  'active:true'
);
select candidate_erasure_test.assert_scalar(
  'changed legal matter cannot masquerade as an active hold replay',
  $$select result->>'status' from active_hold_conflict$$,
  'conflict'
);

select candidate_erasure_test.assert_scalar(
  'active legal hold blocks before any scrub',
  $$select result->>'status' from held_result$$,
  'blocked_legal_hold'
);
select candidate_erasure_test.assert_scalar(
  'blocked hold preserves candidate PII',
  $$select state->'candidates'->0->>'email' from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'ian@example.test'
);
select candidate_erasure_test.assert_scalar(
  'blocked hold creates no scrub receipt',
  $$select count(*)::text from public.candidate_erasure_receipts$$,
  '0'
);

set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select public.release_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select (result->>'hold_id')::uuid from active_hold),
  'case:release-1'
);
create temporary table release_replay as
select public.release_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select (result->>'hold_id')::uuid from active_hold),
  'case:release-1'
) result;
create temporary table release_conflict as
select public.release_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select (result->>'hold_id')::uuid from active_hold),
  'case:release-2'
) result;
create temporary table erasure_result as
select public.request_candidate_erasure(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  '61000000-0000-4000-8000-000000000001'
) result;
reset role;

select candidate_erasure_test.assert_scalar(
  'exact legal hold release replay is evidence-bound',
  $$select concat_ws(':', result->>'status', result->>'replayed') from release_replay$$,
  'released:true'
);
select candidate_erasure_test.assert_scalar(
  'changed release evidence cannot masquerade as a replay',
  $$select result->>'status' from release_conflict$$,
  'conflict'
);

select candidate_erasure_test.assert_scalar(
  'unsupported source provider remains manual and non-final',
  $$select (result->>'status') || ':' || (result->>'replayed') from erasure_result$$,
  'manual_required:false'
);
select candidate_erasure_test.assert_scalar(
  'candidate workspace PII is erased',
  $$select concat_ws(':', state->'candidates'->0->>'name', state->'candidates'->0->>'email', state->'candidates'->0->'complianceFlags'->>'anonymized') from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'Anonymized Candidate::true'
);
select candidate_erasure_test.assert_scalar(
  'candidate tombstone is the exact canonical anonymized shape',
  $$select concat_ws(':', state->'candidates'->0->>'currentTitle', jsonb_array_length(state->'candidates'->0->'techStack'), jsonb_array_length(state->'candidates'->0->'notes')) from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  ':0:0'
);
select candidate_erasure_test.assert_scalar(
  'null-bound inbound triage content is scrubbed by candidate address',
  $$select concat_ws(':', from_address, body, coalesce(provider_id,'')) from public.messages_inbound where id='54000000-0000-4000-8000-000000000001'$$,
  ':Candidate data erased:'
);
select candidate_erasure_test.assert_scalar(
  'provider obligations preserve exact audited channel routing',
  $$select string_agg(provider, ',' order by provider) from public.candidate_erasure_obligations$$,
  'apollo,email,github,linkedin'
);
select candidate_erasure_test.assert_scalar(
  'pending provider authorities are encrypted and contain no visible provider identifiers',
  $$select bool_and(reference_ciphertext is not null and position('ian-provider' in encode(reference_ciphertext,'escape'))=0 and position('linkedin-message-1' in encode(reference_ciphertext,'escape'))=0 and position('email-message-1' in encode(reference_ciphertext,'escape'))=0)::text from public.candidate_erasure_obligations$$,
  'true'
);
select candidate_erasure_test.assert_scalar(
  'short name does not redact an unrelated compliance activity',
  $$select state->'activities'->1->>'title' from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'Compliance review'
);
select candidate_erasure_test.assert_scalar(
  'all events for an affected run are scrubbed without needing candidate id in payload',
  $$select payload::text from public.agent_events where run_id='52000000-0000-4000-8000-000000000001'$$,
  '{"reason": "candidate_erasure", "redacted": true}'
);
select candidate_erasure_test.assert_scalar(
  'encrypted AgentSpec memory is erased through normalized alias provenance',
  $$select concat_ws(':', status, deleted_at is not null, pinned, content_byte_count)
      from public.agent_memories
     where id='56000000-0000-4000-8000-000000000001'$$,
  'deleted:t:f:9'
);
select candidate_erasure_test.assert_scalar(
  'erased AgentSpec memory retains no candidate provenance mapping',
  $$select count(*)::text
      from public.candidate_payload_provenance provenance
     where memory_id='56000000-0000-4000-8000-000000000001'$$,
  '0'
);
select candidate_erasure_test.assert_scalar(
  'plaintext suppression rows are minimized',
  $$select count(*)::text from public.suppression_list where workspace_id='11111111-1111-4111-8111-111111111111' and value in ('ian@example.test','14155550101')$$,
  '0'
);
select candidate_erasure_test.assert_scalar(
  'HMAC suppression tombstones preserve candidate email and phone exclusions',
  $$select count(*)::text from public.candidate_erasure_suppression_tombstones where workspace_id='11111111-1111-4111-8111-111111111111' and identifier_kind in ('candidate_id','email','phone')$$,
  '3'
);
select candidate_erasure_test.assert_scalar(
  'Apollo provider authority has an HMAC suppression tombstone before local erasure',
  $$select count(*)::text from public.candidate_erasure_suppression_tombstones where workspace_id='11111111-1111-4111-8111-111111111111' and identifier_kind='provider_external_id'$$,
  '1'
);
select candidate_erasure_test.assert_scalar(
  'one content-free counter exists for every scrubbed store',
  $$select count(*)::text from public.candidate_erasure_receipts$$,
  '19'
);
select candidate_erasure_test.assert_scalar(
  'receipt schema has no candidate content column',
  $$select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='candidate_erasure_receipts'$$,
  'id,recorded_at,request_id,scrubbed_rows,store_name,workspace_id'
);

select candidate_erasure_test.assert_sqlstate(
  'stale workspace state cannot reimport erased candidate PII',
  $$update public.workspace_state set state=jsonb_set(state,'{candidates,0,email}','"ian@example.test"'::jsonb) where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'stale workspace state cannot restore unallowlisted candidate notes title or skills',
  $$update public.workspace_state set state=jsonb_set(jsonb_set(jsonb_set(state,'{candidates,0,currentTitle}','"Staff Engineer"'::jsonb),'{candidates,0,techStack}','["Go"]'::jsonb),'{candidates,0,notes}','[{"id":"stale","text":"Private"}]'::jsonb) where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'outreach claim ledger cannot reimport an erased candidate',
  $$insert into public.outreach_ledger(workspace_id,candidate_id,candidate_email,campaign_id,status) values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','ian@example.test','campaign-a','claimed')$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'suppression list cannot reimport an erased email',
  $$insert into public.suppression_list(workspace_id,type,value,reason,source) values('11111111-1111-4111-8111-111111111111','email','ian@example.test','stale worker','Operator')$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'WhatsApp contact cannot reimport an erased phone',
  $$insert into public.whatsapp_contacts(workspace_id,recipient_e164,consent_status,consent_source) values('11111111-1111-4111-8111-111111111111','14155550101','opted_in','stale worker')$$,
  array['23514']
);
insert into public.whatsapp_senders(
  id, workspace_id, meta_phone_number_id, status
) values (
  '57000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'sender-erasure-reimport-test',
  'active'
);
select candidate_erasure_test.assert_sqlstate(
  'WhatsApp window cannot reimport an erased phone',
  $$insert into public.whatsapp_conversation_windows(workspace_id,sender_id,recipient_e164,last_inbound_message_id,last_inbound_at,freeform_until) values('11111111-1111-4111-8111-111111111111','57000000-0000-4000-8000-000000000001','14155550101','stale-inbound',now(),now()+interval '1 hour')$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'agent conversation cannot reimport an erased candidate id',
  $$insert into public.agent_conversations(workspace_id,spec_id,candidate_id,channel,provider_thread_key) values('11111111-1111-4111-8111-111111111111','51000000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','Email','stale-provider-thread')$$,
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'agent run cannot reimport an erased candidate alias through structured JSON',
  $$insert into public.agent_runs(
      id,spec_id,workspace_id,owner_id,actor_id,node,state_json,status
    ) values (
      '52000000-0000-4000-8000-000000000009',
      '51000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001','sourcer',
      '{"candidates":[{"id":"new-alias-id","email":"ian@example.test"}]}'::jsonb,
      'running'
    )$$,
  array['23514']
);
insert into public.agent_memories(
  id, workspace_id, owner_id, spec_id, kind, content_ciphertext,
  content_sha256, content_byte_count, status, source_type, created_by, updated_by
) values (
  '56000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', 'episodic',
  'enc:v2:' || repeat('3',64) || ':QUFBQQ==:QkJCQg==:Q0NDQw==',
  repeat('4',64), 24, 'pending_review', 'operator',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'atomic AgentSpec content edit rolls back when an exact alias is erased',
  $$select public.mutate_agent_memory_with_candidate_provenance(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '56000000-0000-4000-8000-000000000009',
      'a1000000-0000-4000-8000-000000000001', 1, 'edit', null,
      'enc:v2:' || repeat('5',64) || ':QUFBQQ==:QkJCQg==:Q0NDQw==',
      repeat('6',64), 25, null, false, null, true, 'campaign-a',
      '[{"kind":"email","value":"ian@example.test"}]'::jsonb
    )$$,
  array['23514']
);
reset role;
select candidate_erasure_test.assert_scalar(
  'tombstoned alias failure leaves the encrypted memory revision and digest unchanged',
  $$select concat_ws(':', revision, content_sha256, content_byte_count)
      from public.agent_memories
     where id='56000000-0000-4000-8000-000000000009'$$,
  '1:' || repeat('4',64) || ':24'
);
select candidate_erasure_test.assert_scalar(
  'tombstoned alias failure leaves no partial memory provenance',
  $$select count(*)::text
      from public.candidate_payload_provenance
     where memory_id='56000000-0000-4000-8000-000000000009'$$,
  '0'
);
delete from public.agent_memories where id='56000000-0000-4000-8000-000000000009';
select candidate_erasure_test.assert_scalar(
  'rejected stale-worker writes leave no raw candidate identifiers',
  $$select concat_ws(':',
      (select count(*) from public.suppression_list where workspace_id='11111111-1111-4111-8111-111111111111' and value='ian@example.test'),
      (select count(*) from public.whatsapp_contacts where workspace_id='11111111-1111-4111-8111-111111111111' and recipient_e164='14155550101'),
      (select count(*) from public.whatsapp_conversation_windows where workspace_id='11111111-1111-4111-8111-111111111111' and recipient_e164='14155550101'),
      (select count(*) from public.agent_conversations where workspace_id='11111111-1111-4111-8111-111111111111' and candidate_id='33333333-3333-4333-8333-333333333333')
    )$$,
  '0:0:0:0'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table pending_queue as
select public.list_candidate_erasure_requests(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  100
) result;
select candidate_erasure_test.assert_sqlstate(
  'Apollo cannot register the same erased provider record under a new candidate',
  $$select * from public.register_apollo_enrichment_targets(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'campaign-b',
    '[{"providerExternalId":"apollo-person-ian","profile":{"name":"Reimport"}}]'::jsonb
  )$$,
  array['23514']
);
reset role;
select candidate_erasure_test.assert_scalar(
  'rejected Apollo reimport leaves no new raw provider authority',
  $$select count(*)::text from public.apollo_enrichment_targets where workspace_id='11111111-1111-4111-8111-111111111111' and provider_external_id='apollo-person-ian'$$,
  '0'
);

set role service_role;
select candidate_erasure_test.set_service_claims('a2000000-0000-4000-8000-000000000002');
create temporary table foreign_result as
select public.request_candidate_erasure(
  '22222222-2222-4222-8222-222222222222',
  'a2000000-0000-4000-8000-000000000002',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  '62000000-0000-4000-8000-000000000002'
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'cross-tenant erasure reveals no foreign candidate',
  $$select result->>'status' from foreign_result$$,
  'not_found'
);

create temporary table obligation_fixture as
select id, provider, attempt_count
  from public.candidate_erasure_obligations
 order by provider, id;
grant select on obligation_fixture to service_role;
create temporary table original_linkedin_authority as
select id, reference_ciphertext
  from public.candidate_erasure_obligations
 where provider = 'linkedin';
grant select on original_linkedin_authority to service_role;
update public.candidate_erasure_obligations
   set reference_ciphertext = (
     select reference_ciphertext
       from public.candidate_erasure_obligations
      where provider = 'email'
   )
 where provider = 'linkedin';
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'ciphertext swap cannot redirect a provider erasure action',
  format(
    $$select public.read_candidate_erasure_obligation_authority(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      %L
    )$$,
    (select id from original_linkedin_authority)
  ),
  array['55000']
);
reset role;
update public.candidate_erasure_obligations obligation
   set reference_ciphertext = original.reference_ciphertext
  from original_linkedin_authority original
 where obligation.id = original.id;
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table late_hold as
select public.place_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  'REGULATORY',
  'case:late-provider-hold',
  now() + interval '1 day'
) result;
create temporary table held_authority as
select public.read_candidate_erasure_obligation_authority(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture where provider='linkedin')
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'a late legal hold blocks provider authority inspection',
  $$select result->>'status' from held_authority$$,
  'blocked_legal_hold'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table held_completion as
select public.reconcile_candidate_erasure_obligation(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture order by provider, id limit 1),
  0,
  'completed',
  null,
  repeat('a',64),
  'case:blocked-completion'
) result;
select public.release_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select (result->>'hold_id')::uuid from late_hold),
  'case:late-provider-hold-release'
);
reset role;
select candidate_erasure_test.assert_scalar(
  'a late legal hold blocks provider completion',
  $$select result->>'status' from held_completion$$,
  'blocked_legal_hold'
);
select candidate_erasure_test.assert_scalar(
  'releasing a late hold resumes manual provider work without completing it',
  $$select concat_ws(':', request.status, string_agg(distinct obligation.status, ',' order by obligation.status))
      from public.candidate_erasure_requests request
      join public.candidate_erasure_obligations obligation on obligation.request_id=request.id
     where request.id=(select (result->>'request_id')::uuid from erasure_result)
     group by request.status$$,
  'manual_required:manual_required'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table expiring_late_hold as
select public.place_candidate_legal_hold(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  'REGULATORY',
  'case:expiring-late-provider-hold',
  now() + interval '1 day'
) result;
reset role;
update public.candidate_legal_holds
   set placed_at = now() - interval '2 days',
       expires_at = now() - interval '1 day'
 where id = (select (result->>'hold_id')::uuid from expiring_late_hold);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table queue_after_late_hold_expiry as
select public.list_candidate_erasure_requests(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  100
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'an expired late hold is persisted as expired',
  $$select status from public.candidate_legal_holds
     where id=(select (result->>'hold_id')::uuid from expiring_late_hold)$$,
  'expired'
);
select candidate_erasure_test.assert_scalar(
  'queue refresh resumes provider work after a late hold expires naturally',
  $$select concat_ws(':', request.status, string_agg(distinct obligation.status, ',' order by obligation.status))
      from public.candidate_erasure_requests request
      join public.candidate_erasure_obligations obligation on obligation.request_id=request.id
     where request.id=(select (result->>'request_id')::uuid from erasure_result)
     group by request.status$$,
  'manual_required:manual_required'
);
select candidate_erasure_test.assert_scalar(
  'the refreshed queue exposes the resumed non-final request',
  $$select item->>'status'
      from queue_after_late_hold_expiry,
           jsonb_array_elements(result) item
     where item->>'request_id'=(select result->>'request_id' from erasure_result)$$,
  'manual_required'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'manual provider completion requires evidence',
  format(
    $$select public.reconcile_candidate_erasure_obligation(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      %L, 0, 'completed', null, null, null
    )$$,
    (select id from obligation_fixture order by provider, id limit 1)
  ),
  array['22023']
);
select candidate_erasure_test.assert_scalar(
  'caller-supplied hash cannot complete an unsupported provider obligation',
  format(
    $$select public.reconcile_candidate_erasure_obligation(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      %L, 0, 'completed', null, repeat('b',64), 'case:unsupported-evidence'
    )->>'status'$$,
    (select id from obligation_fixture order by provider, id limit 1)
  ),
  'unverified_evidence'
);
select candidate_erasure_test.assert_sqlstate(
  'service callers cannot manufacture provider evidence receipts',
  $$insert into public.candidate_erasure_provider_evidence_receipts(id)
    values (gen_random_uuid())$$,
  array['42501']
);
reset role;

select candidate_erasure_test.assert_sqlstate(
  'future provider verification evidence is rejected',
  format($statement$
    with evidence as materialized (
      select obligation.*, clock_timestamp() + interval '1 second' verified_at
        from public.candidate_erasure_obligations obligation
       where obligation.id=%L
    )
    insert into public.candidate_erasure_provider_evidence_receipts(
      workspace_id, request_id, obligation_id, provider,
      expected_attempt_count, verification_method, adapter_id, adapter_version,
      provider_receipt_hmac, evidence_sha256, case_reference, verified_at
    )
    select evidence.workspace_id, evidence.request_id, evidence.id,
           evidence.provider, evidence.attempt_count,
           'approved_evidence_store', 'fixture-verifier', '1',
           public.candidate_erasure_reference_hmac(
             evidence.workspace_id,
             public.candidate_erasure_provider_evidence_document(
               evidence.workspace_id, evidence.request_id, evidence.id,
               evidence.provider, evidence.attempt_count,
               'approved_evidence_store', 'fixture-verifier', '1',
               repeat('a',64), 'case:provider-future', evidence.verified_at
             )
           ),
           repeat('a',64), 'case:provider-future', evidence.verified_at
      from evidence
  $statement$, (select id from obligation_fixture order by provider, id limit 1)),
  array['22023']
);
select candidate_erasure_test.assert_sqlstate(
  'stale provider verification evidence is rejected',
  format($statement$
    with evidence as materialized (
      select obligation.*, clock_timestamp() - interval '11 minutes' verified_at
        from public.candidate_erasure_obligations obligation
       where obligation.id=%L
    )
    insert into public.candidate_erasure_provider_evidence_receipts(
      workspace_id, request_id, obligation_id, provider,
      expected_attempt_count, verification_method, adapter_id, adapter_version,
      provider_receipt_hmac, evidence_sha256, case_reference, verified_at
    )
    select evidence.workspace_id, evidence.request_id, evidence.id,
           evidence.provider, evidence.attempt_count,
           'approved_evidence_store', 'fixture-verifier', '1',
           public.candidate_erasure_reference_hmac(
             evidence.workspace_id,
             public.candidate_erasure_provider_evidence_document(
               evidence.workspace_id, evidence.request_id, evidence.id,
               evidence.provider, evidence.attempt_count,
               'approved_evidence_store', 'fixture-verifier', '1',
               repeat('a',64), 'case:provider-stale', evidence.verified_at
             )
           ),
           repeat('a',64), 'case:provider-stale', evidence.verified_at
      from evidence
  $statement$, (select id from obligation_fixture order by provider, id limit 1)),
  array['22023']
);
select candidate_erasure_test.assert_sqlstate(
  'provider evidence HMAC binds the verifier adapter identity',
  format($statement$
    with evidence as materialized (
      select obligation.*, clock_timestamp() verified_at
        from public.candidate_erasure_obligations obligation
       where obligation.id=%L
    )
    insert into public.candidate_erasure_provider_evidence_receipts(
      workspace_id, request_id, obligation_id, provider,
      expected_attempt_count, verification_method, adapter_id, adapter_version,
      provider_receipt_hmac, evidence_sha256, case_reference, verified_at
    )
    select evidence.workspace_id, evidence.request_id, evidence.id,
           evidence.provider, evidence.attempt_count,
           'approved_evidence_store', 'forged-verifier', '1',
           public.candidate_erasure_reference_hmac(
             evidence.workspace_id,
             public.candidate_erasure_provider_evidence_document(
               evidence.workspace_id, evidence.request_id, evidence.id,
               evidence.provider, evidence.attempt_count,
               'approved_evidence_store', 'fixture-verifier', '1',
               repeat('a',64), 'case:provider-forged-adapter', evidence.verified_at
             )
           ),
           repeat('a',64), 'case:provider-forged-adapter', evidence.verified_at
      from evidence
  $statement$, (select id from obligation_fixture order by provider, id limit 1)),
  array['23514']
);
select candidate_erasure_test.assert_sqlstate(
  'direct completion cannot bypass independently recorded evidence',
  format(
    $$update public.candidate_erasure_obligations
         set status='completed', completed_at=now(), completed_by=%L,
             completion_evidence_sha256=repeat('c',64),
             completion_case_reference='case:direct-forgery',
             reference_ciphertext=null
       where id=%L$$,
    'a1000000-0000-4000-8000-000000000001',
    (select id from obligation_fixture order by provider, id limit 1)
  ),
  array['23514']
);

with evidence as materialized (
  select obligation.*, clock_timestamp() verified_at
    from public.candidate_erasure_obligations obligation
   where obligation.id in (select id from obligation_fixture)
)
insert into public.candidate_erasure_provider_evidence_receipts(
  workspace_id, request_id, obligation_id, provider,
  expected_attempt_count, verification_method, adapter_id, adapter_version,
  provider_receipt_hmac, evidence_sha256, case_reference, verified_at
)
select evidence.workspace_id, evidence.request_id, evidence.id,
       evidence.provider, evidence.attempt_count,
       'approved_evidence_store', 'fixture-verifier', '1',
       public.candidate_erasure_reference_hmac(
         evidence.workspace_id,
         public.candidate_erasure_provider_evidence_document(
           evidence.workspace_id, evidence.request_id, evidence.id,
           evidence.provider, evidence.attempt_count,
           'approved_evidence_store', 'fixture-verifier', '1',
           repeat('a',64), 'case:provider-manual-1', evidence.verified_at
         )
       ),
       repeat('a',64), 'case:provider-manual-1', evidence.verified_at
  from evidence;
select candidate_erasure_test.assert_sqlstate(
  'provider evidence receipts are immutable',
  $$update public.candidate_erasure_provider_evidence_receipts
       set recorded_at=recorded_at
     where id=(select id from public.candidate_erasure_provider_evidence_receipts order by id limit 1)$$,
  array['42501']
);
select candidate_erasure_test.assert_sqlstate(
  'provider evidence receipts cannot be deleted',
  $$delete from public.candidate_erasure_provider_evidence_receipts
     where id=(select id from public.candidate_erasure_provider_evidence_receipts order by id limit 1)$$,
  array['42501']
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table actionable_authority as
select public.read_candidate_erasure_obligation_authority(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture where provider='linkedin')
) result;
create temporary table completed_result as
select public.reconcile_candidate_erasure_obligation(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture order by provider, id limit 1),
  0,
  'completed',
  null,
  repeat('a',64),
  'case:provider-manual-1'
) result;
create temporary table exact_completion_replay as
select public.reconcile_candidate_erasure_obligation(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture order by provider, id limit 1),
  0,
  'completed',
  null,
  repeat('a',64),
  'case:provider-manual-1'
) result;
create temporary table completion_conflict as
select public.reconcile_candidate_erasure_obligation(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  (select id from obligation_fixture order by provider, id limit 1),
  1,
  'completed',
  null,
  repeat('d',64),
  'case:different-evidence'
) result;
do $$
declare item record;
begin
  for item in
    select id, attempt_count
      from obligation_fixture
     where id <> (select id from obligation_fixture order by provider, id limit 1)
     order by provider, id
  loop
    perform public.reconcile_candidate_erasure_obligation(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      item.id,
      item.attempt_count,
      'completed',
      null,
      repeat('a',64),
      'case:provider-manual-1'
    );
  end loop;
end;
$$;
create temporary table replay_result as
select public.request_candidate_erasure(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '33333333-3333-4333-8333-333333333333',
  '61000000-0000-4000-8000-000000000001'
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'durable pending queue survives request response loss',
  $$select jsonb_array_length(result)::text || ':' || (result->0->>'status') from pending_queue$$,
  '1:manual_required'
);
select candidate_erasure_test.assert_scalar(
  'manual workflow decrypts the exact actionable provider reference only on demand',
  $$select concat_ws(':', result->>'provider', result->'reference'->>'providerMessageId') from actionable_authority$$,
  'linkedin:linkedin-message-1'
);
select candidate_erasure_test.assert_scalar(
  'one provider completion cannot make a request complete while obligations remain',
  $$select concat_ws(':', result->>'status', result->>'replayed') from completed_result$$,
  'manual_required:false'
);
select candidate_erasure_test.assert_scalar(
  'exact completion evidence replay is idempotent after a lost response',
  $$select concat_ws(':', result->>'status', result->>'replayed') from exact_completion_replay$$,
  'manual_required:true'
);
select candidate_erasure_test.assert_scalar(
  'changed completion evidence cannot masquerade as an idempotent replay',
  $$select result->>'status' from completion_conflict$$,
  'conflict'
);
select candidate_erasure_test.assert_scalar(
  'lost-response retry replays one durable completed request',
  $$select concat_ws(':', result->>'status', result->>'replayed') from replay_result$$,
  'completed:true'
);
select candidate_erasure_test.assert_scalar(
  'replay creates no duplicate receipts or obligations',
  $$select (select count(*) from public.candidate_erasure_receipts)::text || ':' || (select count(*) from public.candidate_erasure_obligations)::text$$,
  '19:4'
);
select candidate_erasure_test.assert_scalar(
  'verified completion cryptographically erases every actionable provider reference',
  $$select (count(*) filter (where reference_ciphertext is not null))::text from public.candidate_erasure_obligations$$,
  '0'
);

-- Expired holds are audit records, not active blockers.
insert into public.candidate_legal_holds(
  workspace_id,campaign_id,candidate_id,reason_code,case_reference,status,
  placed_by,placed_at,expires_at
) values (
  '11111111-1111-4111-8111-111111111111','campaign-a',
  '44444444-4444-4444-8444-444444444444','EXPIRING_HOLD','case:expired',
  'active','a1000000-0000-4000-8000-000000000001',now()-interval '2 days',now()-interval '1 day'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table expired_hold_result as
select public.request_candidate_erasure(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'campaign-a',
  '44444444-4444-4444-8444-444444444444',
  '63000000-0000-4000-8000-000000000003'
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'expired legal hold does not fabricate a block',
  $$select result->>'status' from expired_hold_result$$,
  'completed'
);

-- More provider work than the bounded operator queue can expose must fail
-- before any local scrub. The database transaction is the authority boundary,
-- so a rejected request leaves the candidate and all provider records intact.
update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (state->'candidates') || jsonb_build_array(jsonb_build_object(
       'id', '66666666-6666-4666-8666-666666666666',
       'campaignId', 'campaign-a',
       'name', 'Bounded Queue Candidate',
       'email', 'bounded@example.test',
       'phone', '',
       'sourcePlatform', 'Manual',
       'createdAt', '2026-07-01T00:00:00Z',
       'complianceFlags', jsonb_build_object('anonymized', false, 'gdprExportRequested', false)
     )),
     false
   )
 where workspace_id = '11111111-1111-4111-8111-111111111111';

insert into public.messages_outbound(
  id,workspace_id,candidate_id,channel,to_address,type,body,status,
  dedupe_hash,provider_message_id
)
select gen_random_uuid(),
       '11111111-1111-4111-8111-111111111111',
       '66666666-6666-4666-8666-666666666666',
       'Email','bounded@example.test','candidate_reply','Provider-backed body','sent',
       encode(digest(convert_to('bounded-' || item::text, 'UTF8'), 'sha256'), 'hex'),
       'provider-message-' || item::text
  from generate_series(1, 101) item;

set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
select candidate_erasure_test.assert_sqlstate(
  'provider obligation overflow rejects the whole erasure transaction',
  $$select public.request_candidate_erasure(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'campaign-a',
    '66666666-6666-4666-8666-666666666666',
    '64000000-0000-4000-8000-000000000004'
  )$$,
  array['54000']
);
reset role;

select candidate_erasure_test.assert_scalar(
  'obligation overflow preserves candidate PII',
  $$select candidate->>'email'
      from public.workspace_state state,
           lateral jsonb_array_elements(state.state->'candidates') candidate
     where state.workspace_id='11111111-1111-4111-8111-111111111111'
       and candidate->>'id'='66666666-6666-4666-8666-666666666666'$$,
  'bounded@example.test'
);
select candidate_erasure_test.assert_scalar(
  'obligation overflow preserves every provider-backed message',
  $$select count(*)::text from public.messages_outbound
     where workspace_id='11111111-1111-4111-8111-111111111111'
       and candidate_id='66666666-6666-4666-8666-666666666666'
       and provider_message_id is not null
       and body='Provider-backed body'$$,
  '101'
);
select candidate_erasure_test.assert_scalar(
  'obligation overflow leaves no request, tombstone, receipt, or obligation',
  $$select concat_ws(':',
       (select count(*) from public.candidate_erasure_requests where request_key='64000000-0000-4000-8000-000000000004'),
       (select count(*) from public.candidate_erasure_suppression_tombstones tombstone join public.candidate_erasure_requests request on request.id=tombstone.request_id where request.request_key='64000000-0000-4000-8000-000000000004'),
       (select count(*) from public.candidate_erasure_receipts receipt join public.candidate_erasure_requests request on request.id=receipt.request_id where request.request_key='64000000-0000-4000-8000-000000000004'),
       (select count(*) from public.candidate_erasure_obligations obligation join public.candidate_erasure_requests request on request.id=obligation.request_id where request.request_key='64000000-0000-4000-8000-000000000004')
     )$$,
  '0:0:0:0'
);

-- Model a future provider adapter: failure remains non-final, and only an
-- evidence-bound later reconciliation may complete it.
insert into public.candidate_erasure_requests(
  id,workspace_id,campaign_id,candidate_id,actor_id,request_key,status,local_scrub_completed_at
) values (
  '71000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'campaign-a','provider-pending-fixture','a1000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002','pending_provider',now()
);
insert into public.candidate_erasure_obligations(
  id,request_id,workspace_id,provider,reference_hmac,reference_ciphertext,status
) values (
  '73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111','future_dsr',
  public.candidate_erasure_reference_hmac(
    '11111111-1111-4111-8111-111111111111',
    '{"kind":"future_provider","providerRecordId":"fixture-1"}'::jsonb
  ),
  public.candidate_erasure_encrypt_reference(
    '11111111-1111-4111-8111-111111111111',
    '{"kind":"future_provider","providerRecordId":"fixture-1"}'::jsonb
  ),
  'pending_provider'
);
set role service_role;
select candidate_erasure_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table retryable_result as
select public.reconcile_candidate_erasure_obligation(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000003',0,
  'retryable_failure','PROVIDER_TIMEOUT',null,null
) result;
reset role;
select candidate_erasure_test.assert_scalar(
  'provider failure remains retryable and never completed',
  $$select (result->>'status') || ':' || ((result->'obligations'->0->>'attemptCount')) from retryable_result$$,
  'retryable_failure:1'
);
select candidate_erasure_test.assert_scalar(
  'retryable failure records a future retry time',
  $$select (next_attempt_at > now())::text from public.candidate_erasure_obligations where id='73000000-0000-4000-8000-000000000003'$$,
  'true'
);

select 'RESULT candidate-erasure-authority-sql: pass' as result;
