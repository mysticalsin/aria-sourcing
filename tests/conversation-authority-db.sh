#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-conversation-authority-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin < "$migration" >/dev/null
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin <<'SQL'
\set VERBOSITY verbose
\echo seed:auth-users
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer-a@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-foreign@example.test','',now(),'{}','{}',now(),now());

\echo seed:workspaces
insert into public.workspaces (id, name, allowed_domain) values
  ('11111111-1111-4111-8111-111111111111','Workspace A','example.test'),
  ('22222222-2222-4222-8222-222222222222','Workspace B','foreign.example.test');

\echo seed:profiles
insert into public.profiles (id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','owner-a@example.test','Owner A','11111111-1111-4111-8111-111111111111','member'),
  ('a2000000-0000-4000-8000-000000000002','owner-b@example.test','Owner B','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','admin-a@example.test','Admin A','11111111-1111-4111-8111-111111111111','admin'),
  ('a4000000-0000-4000-8000-000000000004','viewer-a@example.test','Viewer A','11111111-1111-4111-8111-111111111111','viewer'),
  ('b1000000-0000-4000-8000-000000000001','owner-foreign@example.test','Foreign Owner','22222222-2222-4222-8222-222222222222','member');

\echo seed:workspace-state
insert into public.workspace_state (workspace_id, state) values (
  '11111111-1111-4111-8111-111111111111',
  '{"version":17,"candidates":[{"id":"candidate-a","campaignId":"campaign-a","complianceFlags":{"anonymized":false}}],"campaigns":[{"id":"campaign-a"}]}'::jsonb
);

\echo seed:seat
insert into public.agent_seats (
  id, workspace_id, name, operator_email, provider, status, mode, domain_verified
) values (
  '51000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Workspace A WhatsApp sender',
  'sender-a@example.test',
  'WhatsApp Cloud',
  'active',
  'live',
  true
);

\echo seed:specs
insert into public.agent_specs (id,workspace_id,owner_id,name,role_brief,seat_id,status) values
  ('61000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','Owner A Agent','{"title":"Owner A role"}','51000000-0000-4000-8000-000000000001','active'),
  ('62000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a2000000-0000-4000-8000-000000000002','Owner B Agent','{"title":"Owner B role"}','51000000-0000-4000-8000-000000000001','active'),
  ('63000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','b1000000-0000-4000-8000-000000000001','Foreign Agent','{"title":"Foreign private role"}',null,'active');

\echo seed:whatsapp-sender
insert into public.whatsapp_senders (
  id, workspace_id, seat_id, meta_phone_number_id, status
) values (
  '81000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '51000000-0000-4000-8000-000000000001',
  'meta-phone-a',
  'active'
);

\echo seed:whatsapp-template
insert into public.whatsapp_templates (
  id, workspace_id, sender_id, meta_name, language, category, status,
  parameter_schema, body_parameter_count, approved_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '81000000-0000-4000-8000-000000000001',
  'candidate_intro',
  'en_US',
  'utility',
  'approved',
  '[]'::jsonb,
  0,
  now()
);

\echo seed:approvals
insert into public.outreach_approvals (
  workspace_id, message_id, body_hash, approval_scope_hash, approved_by,
  approved_at, approval_source
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'approved-reply',
    encode(extensions.digest('Approved reply' || E'\n' || 'Hello candidate', 'sha256'), 'hex'),
    encode(extensions.digest('candidate-a' || E'\n' || 'WhatsApp' || E'\n' || '14165550199', 'sha256'), 'hex'),
    'a1000000-0000-4000-8000-000000000001',
    now(),
    'human'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'approved-template',
    encode(extensions.digest(
      'WhatsApp approved-template dispatch' || E'\n' ||
      '{"audit_version":1,"kind":"meta_approved_whatsapp_template","template":{"id":"82000000-0000-4000-8000-000000000001","sender_id":"81000000-0000-4000-8000-000000000001","meta_name":"candidate_intro","language":"en_US","version":1},"parameters":[]}',
      'sha256'
    ), 'hex'),
    encode(extensions.digest('candidate-a' || E'\n' || 'WhatsApp' || E'\n' || '14165550199', 'sha256'), 'hex'),
    'a1000000-0000-4000-8000-000000000001',
    now(),
    'human'
  );

create schema aria_conversation_authority_test;
revoke all on schema aria_conversation_authority_test from public;
grant usage on schema aria_conversation_authority_test to authenticated, service_role;

create function aria_conversation_authority_test.set_claims(subject uuid, jwt_role text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', jwt_role)::text,
    true
  );
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

create function aria_conversation_authority_test.assert_scalar(
  case_name text,
  statement text,
  expected text
) returns void language plpgsql set search_path = pg_catalog as $$
declare actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;

create function aria_conversation_authority_test.assert_sqlstate(
  case_name text,
  statement text,
  expected_codes text[]
) returns void language plpgsql set search_path = pg_catalog as $$
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

revoke all on all functions in schema aria_conversation_authority_test from public;
grant execute on all functions in schema aria_conversation_authority_test to authenticated, service_role;
SQL

# This is the first RED assertion on an unhardened schema: a viewer can forge a
# provider event directly. After 0028 it must fail at the table privilege boundary.
psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(
  'a4000000-0000-4000-8000-000000000004',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_sqlstate(
  'viewer cannot forge a WhatsApp STOP event',
  $$insert into public.messages_inbound(
      workspace_id, channel, from_address, body, provider_id, whatsapp_sender_id
    ) values (
      '11111111-1111-4111-8111-111111111111','WhatsApp','14165550199','STOP',
      'forged-viewer-stop','81000000-0000-4000-8000-000000000001'
    )$$,
  array['42501']
);
select aria_conversation_authority_test.assert_sqlstate(
  'viewer cannot forge an outbound conversation binding',
  $$insert into public.messages_outbound(
      workspace_id, spec_id, candidate_id, seat_id, channel, to_address,
      type, body, status, dedupe_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '63000000-0000-4000-8000-000000000003',
      'candidate-forged',
      '51000000-0000-4000-8000-000000000001',
      'WhatsApp','14165550199','candidate_reply','forged binding','composed',repeat('a',64)
    )$$,
  array['42501']
);
rollback;
SQL

psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(
  'a1000000-0000-4000-8000-000000000001',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_sqlstate(
  'member cannot bypass the authenticated enqueue RPC',
  $$insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address,
      type, body, status, dedupe_hash
    ) values (
      '11111111-1111-4111-8111-111111111111','candidate-a',
      '51000000-0000-4000-8000-000000000001','WhatsApp','14165550199',
      'candidate_reply','direct member write','queued',repeat('b',64)
    )$$,
  array['42501']
);
select aria_conversation_authority_test.assert_sqlstate(
  'member cannot update the service-owned outbox',
  $$update public.messages_outbound set status='sent' where false$$,
  array['42501']
);
select aria_conversation_authority_test.assert_sqlstate(
  'member cannot delete the service-owned inbox',
  $$delete from public.messages_inbound where false$$,
  array['42501']
);
rollback;
SQL

# The only browser-facing write is the narrow enqueue RPC. It locks live actor,
# workspace, candidate, approval, sender, and optional template authority.
psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(
  'a4000000-0000-4000-8000-000000000004',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_scalar(
  'viewer cannot call the enqueue authority',
  $$select public.enqueue_whatsapp_outbound(
      'approved-reply','candidate-a','campaign-a',
      '51000000-0000-4000-8000-000000000001','14165550199',
      'candidate_reply','Approved reply','Hello candidate',null,'[]'::jsonb
    )->>'reason'$$,
  'insufficient-permissions'
);
rollback;

begin;
select aria_conversation_authority_test.set_claims(
  'a1000000-0000-4000-8000-000000000001',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_scalar(
  'member queues an exact approved reply through the RPC',
  $$select public.enqueue_whatsapp_outbound(
      'approved-reply','candidate-a','campaign-a',
      '51000000-0000-4000-8000-000000000001','14165550199',
      'candidate_reply','Approved reply','Hello candidate',null,'[]'::jsonb
    )->>'status'$$,
  'queued'
);
select aria_conversation_authority_test.assert_scalar(
  'queued reply is stamped with the actor owner and no agent spec',
  $$select concat(owner_id,':',spec_id is null) from public.messages_outbound
     where approval_message_id='approved-reply'$$,
  'a1000000-0000-4000-8000-000000000001:t'
);
select aria_conversation_authority_test.assert_scalar(
  'enqueue replay is blocked by the durable dedupe key',
  $$select public.enqueue_whatsapp_outbound(
      'approved-reply','candidate-a','campaign-a',
      '51000000-0000-4000-8000-000000000001','14165550199',
      'candidate_reply','Approved reply','Hello candidate',null,'[]'::jsonb
    )->>'reason'$$,
  'duplicate'
);
select aria_conversation_authority_test.assert_scalar(
  'wrong campaign cannot claim the candidate',
  $$select public.enqueue_whatsapp_outbound(
      'approved-reply','candidate-a','campaign-other',
      '51000000-0000-4000-8000-000000000001','14165550199',
      'candidate_reply','Approved reply','Hello candidate',null,'[]'::jsonb
    )->>'reason'$$,
  'candidate-campaign-mismatch'
);
select aria_conversation_authority_test.assert_scalar(
  'approved template queues through the same authority RPC',
  $$select public.enqueue_whatsapp_outbound(
      'approved-template','candidate-a',null,
      '51000000-0000-4000-8000-000000000001','14165550199',
      'approved_template','WhatsApp approved-template dispatch',
      '{"audit_version":1,"kind":"meta_approved_whatsapp_template","template":{"id":"82000000-0000-4000-8000-000000000001","sender_id":"81000000-0000-4000-8000-000000000001","meta_name":"candidate_intro","language":"en_US","version":1},"parameters":[]}',
      '82000000-0000-4000-8000-000000000001','[]'::jsonb
    )->>'status'$$,
  'queued'
);
commit;
SQL

# Service ingestion remains valid, including signed STOP. The recovery claim
# returns the exact persisted STOP text; browser-originated forgery was denied.
psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(null, 'service_role');
set local role service_role;
insert into public.messages_inbound(
  id, workspace_id, channel, from_address, body, provider_id, whatsapp_sender_id
) values (
  '93000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'WhatsApp','14165550199','STOP','signed-stop',
  '81000000-0000-4000-8000-000000000001'
);
select aria_conversation_authority_test.assert_scalar(
  'signed STOP remains claimable by the service worker',
  $$select public.claim_whatsapp_inbound_processing(
      '93000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001'
    )->>'body'$$,
  'STOP'
);
commit;
SQL

# A composed row has no provider receipt and cannot establish conversation
# authority. A provider-accepted sent row with an exact owner/spec binding can.
psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(null, 'service_role');
set local role service_role;

insert into public.messages_outbound(
  id, workspace_id, owner_id, spec_id, candidate_id, seat_id, channel,
  to_address, recipient_e164, type, body, status, dedupe_hash
) values (
  '92000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'candidate-a','51000000-0000-4000-8000-000000000001',
  'WhatsApp','14165550199','14165550199','candidate_reply',
  'unaccepted draft','composed',repeat('c',64)
);

insert into public.messages_inbound(
  id, workspace_id, channel, from_address, body, provider_id, whatsapp_sender_id
) values (
  '93000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'WhatsApp','14165550199','Tell me more','signed-normal',
  '81000000-0000-4000-8000-000000000001'
);

select public.claim_whatsapp_inbound_processing(
  '93000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001'
);
select aria_conversation_authority_test.assert_scalar(
  'unaccepted composed rows cannot establish conversation authority',
  $$select public.resolve_whatsapp_inbound_conversation(
      '93000000-0000-4000-8000-000000000002',
      processing_claim_id
    )->>'reason'
    from public.messages_inbound
    where id='93000000-0000-4000-8000-000000000002'$$,
  'no-conversation'
);

insert into public.messages_outbound(
  id, workspace_id, owner_id, spec_id, candidate_id, seat_id, channel,
  to_address, recipient_e164, type, body, status, dedupe_hash,
  delivery_attempt_id, provider_message_id, sent_at
) values (
  '92000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'candidate-a','51000000-0000-4000-8000-000000000001',
  'WhatsApp','14165550199','14165550199','candidate_reply',
  'provider accepted message','sent',repeat('d',64),
  '94000000-0000-4000-8000-000000000001','meta-accepted-message',now()
);

select aria_conversation_authority_test.assert_scalar(
  'provider receipt establishes exact owner and spec conversation authority',
  $$select concat(
      public.resolve_whatsapp_inbound_conversation(
        '93000000-0000-4000-8000-000000000002',
        processing_claim_id
      )->>'owner_id',
      ':',
      public.resolve_whatsapp_inbound_conversation(
        '93000000-0000-4000-8000-000000000002',
        processing_claim_id
      )->>'spec_id'
    )
    from public.messages_inbound
    where id='93000000-0000-4000-8000-000000000002'$$,
  'a1000000-0000-4000-8000-000000000001:61000000-0000-4000-8000-000000000001'
);

select aria_conversation_authority_test.assert_sqlstate(
  'database rejects a cross-workspace owner/spec binding',
  $$insert into public.messages_outbound(
      workspace_id, owner_id, spec_id, candidate_id, seat_id, channel,
      to_address, type, body, status, dedupe_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'b1000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000003',
      'candidate-forged','51000000-0000-4000-8000-000000000001',
      'WhatsApp','14165550199','candidate_reply','foreign binding','composed',repeat('e',64)
    )$$,
  array['23503','23514']
);
select aria_conversation_authority_test.assert_sqlstate(
  'database rejects an outbound row bound to another owner conversation',
  $$insert into public.messages_outbound(
      workspace_id, owner_id, spec_id, conversation_id, candidate_id, seat_id,
      channel, to_address, type, body, status, dedupe_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'a2000000-0000-4000-8000-000000000002',
      '62000000-0000-4000-8000-000000000002',
      (select conversation_id from public.messages_inbound
       where id='93000000-0000-4000-8000-000000000002'),
      'candidate-b','51000000-0000-4000-8000-000000000001',
      'Email','candidate-b@example.test','candidate_reply','foreign conversation','composed',repeat('f',64)
    )$$,
  array['23503','23514']
);
commit;
SQL

# Owner-scoped RLS hides another agent's messages and conversations. Viewers see
# no candidate conversation content. A guessed review id cannot bypass owner RLS.
psql_stdin <<'SQL'
begin;
select aria_conversation_authority_test.set_claims(
  'a1000000-0000-4000-8000-000000000001',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_scalar(
  'owner sees the exact trusted conversation',
  $$select count(*)::text from public.agent_conversations$$,
  '1'
);
select aria_conversation_authority_test.assert_scalar(
  'owner sees resolved inbound only, not ownerless signed STOP audit data',
  $$select count(*)::text from public.messages_inbound$$,
  '1'
);
rollback;

begin;
select aria_conversation_authority_test.set_claims(
  'a2000000-0000-4000-8000-000000000002',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_scalar(
  'other owner cannot read owner A conversations',
  $$select count(*)::text from public.agent_conversations$$,
  '0'
);
select aria_conversation_authority_test.assert_scalar(
  'other owner cannot read owner A message content',
  $$select count(*)::text from public.messages_outbound$$,
  '0'
);
rollback;

begin;
select aria_conversation_authority_test.set_claims(
  'a4000000-0000-4000-8000-000000000004',
  'authenticated'
);
set local role authenticated;
select aria_conversation_authority_test.assert_scalar(
  'viewer cannot read candidate conversations',
  $$select count(*)::text from public.agent_conversations$$,
  '0'
);
select aria_conversation_authority_test.assert_scalar(
  'viewer cannot read message content',
  $$select count(*)::text from public.messages_outbound$$,
  '0'
);
rollback;
SQL

# Re-applying the migration is a required contract. Trusted owner bindings and
# service privileges must survive without multiplying or weakening authority.
psql_stdin < supabase/migrations/0028_conversation_authority_hardening.sql >/dev/null
psql_stdin <<'SQL'
select aria_conversation_authority_test.assert_scalar(
  'migration reapply preserves the trusted conversation owner',
  $$select owner_id::text from public.agent_conversations$$,
  'a1000000-0000-4000-8000-000000000001'
);
select aria_conversation_authority_test.assert_scalar(
  'authenticated retains no inbound insert privilege after reapply',
  $$select has_table_privilege('authenticated','public.messages_inbound','insert')::text$$,
  'false'
);
select aria_conversation_authority_test.assert_scalar(
  'authenticated retains no outbound update privilege after reapply',
  $$select has_table_privilege('authenticated','public.messages_outbound','update')::text$$,
  'false'
);
select aria_conversation_authority_test.assert_scalar(
  'service retains inbound insert privilege after reapply',
  $$select has_table_privilege('service_role','public.messages_inbound','insert')::text$$,
  'true'
);
select aria_conversation_authority_test.assert_scalar(
  'service retains outbound update privilege after reapply',
  $$select has_table_privilege('service_role','public.messages_outbound','update')::text$$,
  'true'
);
SQL

echo "RESULT conversation-authority-db: passed"
