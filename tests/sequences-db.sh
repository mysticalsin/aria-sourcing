#!/usr/bin/env bash
set -Eeuo pipefail

# Phase 0 negative-proof-first suite for the 0063 outreach sequence authority
# repair. Proves: canonical channel-bound recipient identity, fail-closed
# missing identity, suppression by type/value (never the nonexistent
# suppression_list.candidate_id column 0045 shipped with), erasure tombstones
# at activation/claim/completion, LinkedIn manual_task-only with an
# operator_assertion verification source and zero outbound/provider path,
# transactional cadence advancement, idempotent/concurrent claim and
# completion, serialized stop/complete races, durable provider-send truth, and
# a guarded forward/rollback/reapply.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-sequences-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

holder_pid=""

cleanup() {
  if [[ -n "$holder_pid" ]]; then kill "$holder_pid" >/dev/null 2>&1 || true; fi
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
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  [[ "$(basename "$migration")" == "0063_outreach_sequence_authority_repair.sql" ]] && break
  psql_stdin -q < "$migration"
done

# A pre-0063 database can contain the unsafe pointer that 0045's unrestricted
# binder accepted. A terminal failed outbound is especially dangerous: the
# step remains scheduled but can neither dispatch nor reconcile as sent. Prove
# the upgrade refuses that dirty state, then succeeds only after an operator
# repairs the pointer. The failed migration is expected to leave its earlier
# idempotent DDL committed, which also proves a retry is safe after
# deployment-ledger reconciliation.
psql_stdin -q <<'DIRTY_PRE0063'
insert into public.workspaces(id, name, allowed_domain) values (
  '73333333-3333-4333-8333-333333333333',
  'Unsafe legacy sequence fixture',
  'legacy-sequence.example.test'
);
insert into public.candidates(
  workspace_id, campaign_id, id, email, name, payload
) values (
  '73333333-3333-4333-8333-333333333333',
  'legacy-campaign', 'legacy-candidate', 'legacy@example.test',
  'Legacy candidate', '{}'::jsonb
);
insert into public.outreach_sequences(
  id, workspace_id, candidate_id, campaign_id, status, max_touches
) values (
  '73333333-3333-4333-8333-333333333334',
  '73333333-3333-4333-8333-333333333333',
  'legacy-candidate', 'legacy-campaign', 'active', 1
);
insert into public.messages_outbound(
  id, workspace_id, candidate_id, channel, to_address, type, subject, body,
  status, dedupe_hash, approval_message_id, campaign_id
) values (
  '73333333-3333-4333-8333-333333333336',
  '73333333-3333-4333-8333-333333333333',
  'legacy-candidate', 'Email', 'legacy@example.test', 'candidate_reply', '',
  'legacy body', 'failed', repeat('c', 64), 'legacy-message', 'legacy-campaign'
);
insert into public.outreach_sequence_steps(
  id, sequence_id, ordinal, gap_days, channel, message_id, body,
  body_hash, scope_hash, status, scheduled_at, queued_outbound_id
) values (
  '73333333-3333-4333-8333-333333333335',
  '73333333-3333-4333-8333-333333333334',
  0, 0, 'Email', 'legacy-message', 'legacy body',
  encode(extensions.digest(E'\n' || 'legacy body', 'sha256'), 'hex'),
  encode(extensions.digest(
    'legacy-candidate' || E'\nEmail\n' || 'legacy@example.test', 'sha256'
  ), 'hex'),
  'scheduled', now(),
  '73333333-3333-4333-8333-333333333336'
);
DIRTY_PRE0063

set +e
dirty_upgrade_output="$(psql_stdin -qAt 2>&1 < supabase/migrations/0063_outreach_sequence_authority_repair.sql)"
dirty_upgrade_status=$?
set -e
if [[ "$dirty_upgrade_status" -eq 0 || "$dirty_upgrade_output" != *"unsafe legacy sequence outbound binding"* ]]; then
  echo "0063 dirty upgrade did not refuse the terminal failed legacy outbound" >&2
  echo "$dirty_upgrade_output" >&2
  exit 1
fi

psql_stdin -q <<'REPAIR_PRE0063'
update public.outreach_sequence_steps
   set queued_outbound_id = null
 where id = '73333333-3333-4333-8333-333333333335';
REPAIR_PRE0063
psql_stdin -q < supabase/migrations/0063_outreach_sequence_authority_repair.sql
dirty_upgrade_fk="$(psql_stdin -Atqc "select count(*) from pg_catalog.pg_constraint where conname = 'outreach_sequence_steps_queued_outbound_fkey' and conrelid = 'public.outreach_sequence_steps'::regclass")"
if [[ "$dirty_upgrade_fk" != "1" ]]; then
  echo "0063 repaired dirty upgrade did not install reciprocal outbound authority" >&2
  exit 1
fi
psql_stdin -q <<'CLEAN_PRE0063'
delete from public.outreach_sequences
 where id = '73333333-3333-4333-8333-333333333334';
delete from public.messages_outbound
 where id = '73333333-3333-4333-8333-333333333336';
delete from public.candidates
 where workspace_id = '73333333-3333-4333-8333-333333333333'
   and campaign_id = 'legacy-campaign'
   and id = 'legacy-candidate';
delete from public.workspaces
 where id = '73333333-3333-4333-8333-333333333333';
CLEAN_PRE0063

psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

# ---------------------------------------------------------------------------
# 0063 intentionally has no downgrade path: the prior 0045 behavior would
# re-enable automated LinkedIn scheduling. A forward correction may supersede
# this migration, but rollback must fail before it changes any schema state.
# ---------------------------------------------------------------------------
set +e
rollback_output="$(psql_stdin -qAt 2>&1 < supabase/rollbacks/0063_outreach_sequence_authority_repair.sql)"
rollback_status=$?
set -e
if [[ "$rollback_status" -eq 0 || "$rollback_output" != *"rollback is intentionally unsupported"* ]]; then
  echo "0063 rollback did not refuse an unsafe LinkedIn downgrade" >&2
  exit 1
fi
forward_columns="$(psql_stdin -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='outreach_sequence_steps' and column_name in ('due_at','verification_source','completed_at','completed_by')")"
if [[ "$forward_columns" != "4" ]]; then
  echo "0063 rollback refusal changed the forward schema" >&2
  exit 1
fi

# Reapplying the forward-only repair must be safe. Deploy reconciliation can
# encounter an already-applied schema after an interrupted ledger update.
psql_stdin -q < supabase/migrations/0063_outreach_sequence_authority_repair.sql
reapplied_columns="$(psql_stdin -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='outreach_sequence_steps' and column_name in ('due_at','verification_source','completed_at','completed_by')")"
if [[ "$reapplied_columns" != "4" ]]; then
  echo "0063 forward reapply did not preserve the repaired schema" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema sequences_test;

create table sequences_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function sequences_test.expect(p_case_name text, p_passed boolean, p_detail text default null)
returns void language plpgsql set search_path = pg_catalog, public, sequences_test as $$
begin
  insert into sequences_test.results(case_name, passed, detail) values (p_case_name, p_passed, p_detail);
end;
$$;

create function sequences_test.expect_scalar(p_case_name text, p_statement text, p_expected text)
returns void language plpgsql set search_path = pg_catalog, public, sequences_test as $$
declare actual text;
begin
  execute p_statement into actual;
  perform sequences_test.expect(p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected));
end;
$$;

create function sequences_test.set_service_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function sequences_test.set_authenticated_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

grant usage on schema sequences_test to service_role;
grant execute on all functions in schema sequences_test to service_role;
grant usage on schema sequences_test to authenticated;
grant execute on all functions in schema sequences_test to authenticated;

create function sequences_test.sequence_step_id(p_sequence_id uuid, p_ordinal integer)
returns uuid
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select id from public.outreach_sequence_steps
   where sequence_id = p_sequence_id and ordinal = p_ordinal
$$;
alter function sequences_test.sequence_step_id(uuid, integer) owner to postgres;
grant execute on function sequences_test.sequence_step_id(uuid, integer) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Fixture: one workspace, an admin (operator), a second operator, and
-- candidates covering every recipient-identity/suppression/erasure case.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seq-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seq-admin-b@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seq-other@example.test','',now(),'{}','{}',now(),now())
on conflict (id) do nothing;

insert into public.workspaces(id, name, allowed_domain) values
  ('71111111-1111-4111-8111-111111111111','Sequences','sequences.example.test'),
  ('72222222-2222-4222-8222-222222222222','Other Sequences','other-sequences.example.test')
on conflict (id) do nothing;

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001','seq-admin-a@example.test','Seq Admin A','71111111-1111-4111-8111-111111111111','admin'),
  ('a2000000-0000-4000-8000-000000000002','seq-admin-b@example.test','Seq Admin B','71111111-1111-4111-8111-111111111111','admin'),
  ('a3000000-0000-4000-8000-000000000003','seq-other@example.test','Seq Other','72222222-2222-4222-8222-222222222222','admin')
on conflict (workspace_id, id) do nothing;

insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
values ('71111111-1111-4111-8111-111111111111', gen_random_bytes(32))
on conflict (workspace_id) do nothing;

insert into public.workspace_state(workspace_id, state) values (
  '71111111-1111-4111-8111-111111111111', '{}'::jsonb
) on conflict (workspace_id) do nothing;

-- Dispatch fixtures use real live-seat policy, not direct status mutation.
insert into public.agent_seats(
  id, workspace_id, name, operator_email, provider, status, mode,
  domain_verified, daily_limit, warmup
) values
  (
    '7e000000-0000-4000-8000-000000000001',
    '71111111-1111-4111-8111-111111111111',
    'Sequence Email Seat', 'recruiter@sequences.example.test',
    'Microsoft Graph', 'active', 'live', true, 100, false
  ),
  (
    '7e000000-0000-4000-8000-000000000002',
    '71111111-1111-4111-8111-111111111111',
    'Sequence WhatsApp Seat', 'whatsapp@sequences.example.test',
    'WhatsApp Cloud', 'active', 'live', false, 100, false
  );

insert into public.whatsapp_senders(
  id, workspace_id, seat_id, meta_phone_number_id, status
) values (
  '7e000000-0000-4000-8000-000000000003',
  '71111111-1111-4111-8111-111111111111',
  '7e000000-0000-4000-8000-000000000002',
  'sequence-test-meta-phone-number', 'active'
);

insert into public.whatsapp_contacts(
  workspace_id, recipient_e164, consent_status, consent_source,
  recorded_at, expires_at, last_inbound_at
) values (
  '71111111-1111-4111-8111-111111111111',
  '14155550101', 'opted_in', 'synthetic-sequence-test',
  now(), now() + interval '1 day', now()
);

insert into public.whatsapp_conversation_windows(
  workspace_id, sender_id, recipient_e164,
  last_inbound_message_id, last_inbound_at, freeform_until
) values (
  '71111111-1111-4111-8111-111111111111',
  '7e000000-0000-4000-8000-000000000003',
  '14155550101', 'sequence-test-inbound', now(), now() + interval '1 hour'
);

insert into public.candidates(workspace_id, campaign_id, id, email, phone, linkedin_url, name, payload) values
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-email-ok','ok-email@example.test',null,null,'Email OK','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-email-claim','claim-email@example.test',null,null,'Email Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-email-stop-queued','stop-queued@example.test',null,null,'Email Stop Queued','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-service-block','service-block@example.test',null,null,'Service Block Control','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-service-failed','service-failed@example.test',null,null,'Service Failure Control','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-dispatch-block','dispatch-block@example.test',null,null,'Dispatch Block Control','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-email-sent-kill','sent-kill@example.test',null,null,'Email Sent Kill','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-binding-campaign','binding-campaign@example.test',null,null,'Binding Campaign Guard','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-insert-forge','insert-forge@example.test',null,null,'Insert Origin Guard','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-tombstone-claim','tombstone-claim@example.test',null,null,'Claim Tombstone','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-completion-suppression','completion-suppression@example.test',null,null,'Completion Suppression','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-erasure-live','erasure-live@example.test',null,null,'Live Erasure','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-release-gate','release-gate@example.test',null,null,'Release Gate','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-release-disable-dispatch','release-disable@example.test',null,null,'Release Disable Dispatch','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-kill-disable-dispatch','kill-disable@example.test',null,null,'Kill Disable Dispatch','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-atomic-enqueue-stop','atomic-stop@example.test',null,null,'Atomic Enqueue Stop','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-body-mutation','body-original@example.test',null,null,'Body Mutation','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-scope-mutation','scope-original@example.test',null,null,'Scope Mutation','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-two-step-email','two-step@example.test',null,null,'Two Step Email','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-whatsapp-ok',null,'+14155550100',null,'WhatsApp OK','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-whatsapp-claim',null,'+14155550101',null,'WhatsApp Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-ok',null,null,'https://linkedin.com/in/seq-linkedin-ok','LinkedIn OK','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-claim',null,null,'https://linkedin.com/in/seq-linkedin-claim','LinkedIn Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-manual',null,null,'https://linkedin.com/in/seq-linkedin-manual','LinkedIn Manual','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-alias',null,null,'https://www.linkedin.com/in/seq-linkedin-alias/?trk=fixture','LinkedIn Alias','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-revoked',null,null,'https://linkedin.com/in/seq-linkedin-revoked','LinkedIn Revoked','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-revoked-before-claim',null,null,'https://linkedin.com/in/seq-linkedin-revoked-before-claim','LinkedIn Revoked Before Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-claim-revoke-race',null,null,'https://linkedin.com/in/seq-claim-revoke-race','LinkedIn Claim Revoke Race','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-kill',null,null,'https://linkedin.com/in/seq-linkedin-kill','LinkedIn Kill','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-drift',null,null,'https://linkedin.com/in/seq-linkedin-drift','LinkedIn Drift','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-tombstone',null,null,'https://www.linkedin.com/in/seq-linkedin-tombstone/?trk=fixture','LinkedIn Tombstone','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-linkedin-legacy-alias',null,null,'http://www.linkedin.com/in/seq-linkedin-legacy-alias?trk=reimport','LinkedIn Legacy Alias','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-max-touch',null,null,'https://linkedin.com/in/seq-max-touch','LinkedIn Max Touch','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-completion-race',null,null,'https://linkedin.com/in/seq-completion-race','LinkedIn Completion Race','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-stop-concurrent',null,null,'https://linkedin.com/in/seq-stop-concurrent','LinkedIn Stop Concurrent','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-multi-step-stop',null,null,'https://linkedin.com/in/seq-multi-step-stop','LinkedIn Multi Step Stop','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-suppressed-email','suppressed@example.test',null,null,'Suppressed Email','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-suppressed-email-claim','suppressed-claim@example.test',null,null,'Suppressed Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-suppressed-linkedin',null,null,'https://linkedin.com/in/seq-suppressed','Suppressed LinkedIn','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-no-identity',null,null,null,'No Identity','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-no-identity-claim',null,null,null,'No Identity Claim','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-erased','erased@example.test',null,null,'Erased','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-race','race@example.test',null,null,'Race','{}'),
  ('71111111-1111-4111-8111-111111111111','seq-campaign','seq-manual-race',null,null,'https://linkedin.com/in/seq-manual-race','Manual Race','{}');

-- The hardened WhatsApp enqueue resolves the browser-facing candidate corpus,
-- while sequence authority resolves the relational mirror. Keep both surfaces
-- byte-consistent for every fixture candidate so the mirror trigger neither
-- deletes direct fixtures nor manufactures a different recipient identity.
update public.workspace_state workspace_state
   set state = jsonb_build_object(
     'candidates', (
       select jsonb_agg(
         jsonb_build_object(
           'id', candidate.id,
           'campaignId', candidate.campaign_id,
           'email', candidate.email,
           'phone', candidate.phone,
           'linkedinUrl', candidate.linkedin_url,
           'name', candidate.name,
           'complianceFlags', jsonb_build_object('anonymized', false)
         ) order by candidate.id
       )
       from public.candidates candidate
       where candidate.workspace_id = workspace_state.workspace_id
     )
   )
 where workspace_state.workspace_id = '71111111-1111-4111-8111-111111111111';

insert into public.suppression_list(workspace_id, type, value) values
  ('71111111-1111-4111-8111-111111111111','email','suppressed@example.test'),
  ('71111111-1111-4111-8111-111111111111','linkedin','https://linkedin.com/in/seq-suppressed'),
  ('71111111-1111-4111-8111-111111111111','linkedin','linkedin.com/in/seq-linkedin-alias');

-- Direct tombstone insert (bypassing the full erasure request flow, same
-- technique 0037's person-model suite uses to isolate the tombstone check).
insert into public.candidate_erasure_suppression_tombstones(request_id, workspace_id, identifier_kind, identifier_hmac)
select
  (select id from public.candidate_erasure_requests limit 1),
  '71111111-1111-4111-8111-111111111111',
  'candidate_id',
  public.candidate_erasure_identifier_hmac('71111111-1111-4111-8111-111111111111', 'candidate_id', 'seq-erased')
where exists (select 1 from public.candidate_erasure_requests);

-- No erasure request exists yet in this fresh workspace, so seed one for the
-- FK the tombstones table requires, then the direct tombstone insert above.
do $$
declare req_id uuid;
begin
  if not exists (select 1 from public.candidate_erasure_suppression_tombstones
                  where workspace_id = '71111111-1111-4111-8111-111111111111'
                    and identifier_kind = 'candidate_id') then
    insert into public.candidate_erasure_requests(
      workspace_id, campaign_id, candidate_id, actor_id, request_key, status,
      local_scrub_completed_at, provider_completed_at
    ) values (
      '71111111-1111-4111-8111-111111111111', 'seq-campaign', 'seq-erased-request',
      'a1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'completed', now(), now()
    ) returning id into req_id;

    insert into public.candidate_erasure_suppression_tombstones(request_id, workspace_id, identifier_kind, identifier_hmac)
    values (
      req_id, '71111111-1111-4111-8111-111111111111', 'candidate_id',
      public.candidate_erasure_identifier_hmac('71111111-1111-4111-8111-111111111111', 'candidate_id', 'seq-erased')
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: draft + approve + activate a single-step sequence for one channel.
-- ---------------------------------------------------------------------------
create function sequences_test.build_and_activate(
  p_candidate_id text, p_channel text, p_message_id text
) returns json language plpgsql set search_path = pg_catalog, public, extensions, sequences_test as $$
declare
  wid uuid := '71111111-1111-4111-8111-111111111111';
  body text := 'hello ' || p_candidate_id;
  recipient text;
  body_hash text := encode(digest(E'\n' || body, 'sha256'), 'hex');
  scope_hash text;
  create_result json;
  seq_id uuid;
  activate_result json;
begin
  select case p_channel
    when 'Email' then lower(btrim(email))
    when 'WhatsApp' then public.normalize_whatsapp_e164(phone)
    when 'LinkedIn' then public.normalize_linkedin_profile_url(linkedin_url)
  end into recipient
  from public.candidates
  where workspace_id = wid and campaign_id = 'seq-campaign' and id = p_candidate_id;
  -- create_outreach_sequence requires a non-null draft scope even for the
  -- deliberate missing-identity cases. The value is never accepted because
  -- activation resolves the recipient again and fails closed first.
  scope_hash := encode(digest(p_candidate_id || E'\n' || p_channel || E'\n' || coalesce(recipient, 'missing-identity'), 'sha256'), 'hex');
  perform sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
  set role authenticated;
  perform public.record_outreach_approval(p_message_id, body_hash, scope_hash);
  reset role;

  perform sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
  set role service_role;

  create_result := public.create_outreach_sequence(
    wid, p_candidate_id, 'seq-campaign', 1,
    jsonb_build_array(jsonb_build_object(
      'channel', p_channel, 'messageId', p_message_id, 'body', body,
      'bodyHash', body_hash, 'scopeHash', scope_hash, 'gapDays', 1
    ))
  );
  seq_id := (create_result->>'sequence_id')::uuid;

  activate_result := public.activate_outreach_sequence(seq_id);
  reset role;
  return jsonb_build_object('sequence_id', seq_id, 'activate', activate_result);
end;
$$;

-- Build a two-touch LinkedIn ladder for lock-order regression tests. Both
-- approvals are distinct and consumed when the sequence activates.
create function sequences_test.build_two_step_linkedin()
returns json language plpgsql set search_path = pg_catalog, public, extensions, sequences_test as $$
declare
  wid uuid := '71111111-1111-4111-8111-111111111111';
  candidate_id text := 'seq-multi-step-stop';
  recipient text := public.normalize_linkedin_profile_url('https://linkedin.com/in/seq-multi-step-stop');
  body_0 text := 'multi step first';
  body_1 text := 'multi step second';
  scope_hash text := encode(
    digest(candidate_id || E'\n' || 'LinkedIn' || E'\n' || recipient, 'sha256'),
    'hex'
  );
  create_result json;
  seq_id uuid;
  activate_result json;
begin
  perform sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
  set role authenticated;
  perform public.record_outreach_approval(
    'msg-multi-step-0', encode(digest(E'\n' || body_0, 'sha256'), 'hex'), scope_hash
  );
  perform public.record_outreach_approval(
    'msg-multi-step-1', encode(digest(E'\n' || body_1, 'sha256'), 'hex'), scope_hash
  );
  reset role;

  perform sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
  set role service_role;
  create_result := public.create_outreach_sequence(
    wid, candidate_id, 'seq-campaign', 2,
    jsonb_build_array(
      jsonb_build_object(
        'channel', 'LinkedIn', 'messageId', 'msg-multi-step-0', 'body', body_0,
        'bodyHash', encode(digest(E'\n' || body_0, 'sha256'), 'hex'),
        'scopeHash', scope_hash, 'gapDays', 0
      ),
      jsonb_build_object(
        'channel', 'LinkedIn', 'messageId', 'msg-multi-step-1', 'body', body_1,
        'bodyHash', encode(digest(E'\n' || body_1, 'sha256'), 'hex'),
        'scopeHash', scope_hash, 'gapDays', 0
      )
    )
  );
  seq_id := (create_result->>'sequence_id')::uuid;
  activate_result := public.activate_outreach_sequence(seq_id);
  reset role;
  return jsonb_build_object('sequence_id', seq_id, 'activate', activate_result);
end;
$$;

-- sequences_enabled/kill_switch must allow activation for the fixture cases
-- (Phase 0 keeps sequences_enabled FALSE in production; the disposable test
-- turns it on ONLY inside this throwaway database to exercise the repaired
-- authority end to end).
update public.sourcing_loop_controls
   set kill_switch = false, sequences_enabled = true, updated_by = 'a1000000-0000-4000-8000-000000000001'
 where workspace_id = '71111111-1111-4111-8111-111111111111';
insert into public.sourcing_loop_controls(workspace_id, kill_switch, sequences_enabled, updated_by)
select '71111111-1111-4111-8111-111111111111', false, true, 'a1000000-0000-4000-8000-000000000001'
where not exists (
  select 1 from public.sourcing_loop_controls where workspace_id = '71111111-1111-4111-8111-111111111111'
);

-- Tenant administrators can request sequences, but only the owner-only release
-- control can authorize execution. Its absence is the mechanically dark default.
select sequences_test.expect_scalar('seq-00-tenant-flag-cannot-bypass-release-gate',
  $$select (sequences_test.build_and_activate('seq-release-gate','Email','msg-release-gate')->'activate'->>'reason')$$,
  'sequences_disabled');
insert into public.outreach_sequence_release_controls(
  workspace_id, enabled, enabled_at, enabled_by
) values (
  '71111111-1111-4111-8111-111111111111', true, now(),
  'a1000000-0000-4000-8000-000000000001'
);

-- seq-01/02/03: happy path per channel.
select sequences_test.expect_scalar('seq-01-email-activates',
  $$select (sequences_test.build_and_activate('seq-email-ok','Email','msg-email-ok')->'activate'->>'ok')$$,
  'true');
select sequences_test.expect_scalar('seq-02-whatsapp-activates',
  $$select (sequences_test.build_and_activate('seq-whatsapp-ok','WhatsApp','msg-whatsapp-ok')->'activate'->>'ok')$$,
  'true');
select sequences_test.expect_scalar('seq-03-linkedin-activates',
  $$select (sequences_test.build_and_activate('seq-linkedin-ok','LinkedIn','msg-linkedin-ok')->'activate'->>'ok')$$,
  'true');

-- An approval is bound to the recipient as it existed at approval time. A
-- later candidate change must prevent activation, not silently reuse scope.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table scope_mutation_seq as
select public.create_outreach_sequence(
  '71111111-1111-4111-8111-111111111111', 'seq-scope-mutation', 'seq-campaign', 1,
  jsonb_build_array(jsonb_build_object(
    'channel', 'Email', 'messageId', 'msg-scope-mutation', 'body', 'scope body',
    'bodyHash', encode(digest(E'\n' || 'scope body', 'sha256'), 'hex'),
    'scopeHash', encode(digest('seq-scope-mutation' || E'\n' || 'Email' || E'\n' || 'scope-original@example.test', 'sha256'), 'hex'),
    'gapDays', 0
  ))
) result;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.record_outreach_approval(
  'msg-scope-mutation',
  encode(digest(E'\n' || 'scope body', 'sha256'), 'hex'),
  encode(digest('seq-scope-mutation' || E'\n' || 'Email' || E'\n' || 'scope-original@example.test', 'sha256'), 'hex')
);
reset role;
update public.candidates set email = 'scope-moved@example.test'
 where workspace_id = '71111111-1111-4111-8111-111111111111'
   and campaign_id = 'seq-campaign' and id = 'seq-scope-mutation';
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table scope_mutation_activation as
select public.activate_outreach_sequence(((select result from scope_mutation_seq)->>'sequence_id')::uuid) result;
reset role;
select sequences_test.expect_scalar('seq-03a-recipient-change-invalidates-activation-scope',
  $$select (select result from scope_mutation_activation)->>'reason'$$,
  'steps-unapproved');

-- seq-04/05: activation fails closed on suppression (never restores the
-- broken suppression_list.candidate_id query -- this proves the canonical
-- type/value check runs and blocks).
select sequences_test.expect_scalar('seq-04-suppressed-email-activation-blocked',
  $$select (sequences_test.build_and_activate('seq-suppressed-email','Email','msg-suppressed-email')->'activate'->>'reason')$$,
  'recipient-ineligible');
select sequences_test.expect_scalar('seq-05-suppressed-linkedin-activation-blocked',
  $$select (sequences_test.build_and_activate('seq-suppressed-linkedin','LinkedIn','msg-suppressed-linkedin')->'activate'->>'reason')$$,
  'recipient-ineligible');
select sequences_test.expect_scalar('seq-05a-linkedin-alias-suppression-is-canonical',
  $$select (sequences_test.build_and_activate('seq-linkedin-alias','LinkedIn','msg-linkedin-alias')->'activate'->>'reason')$$,
  'recipient-ineligible');

-- seq-06: no email/phone/linkedin at all -- fails closed, never ambiguous-open.
select sequences_test.expect_scalar('seq-06-missing-identity-activation-blocked',
  $$select (sequences_test.build_and_activate('seq-no-identity','Email','msg-no-identity')->'activate'->>'reason')$$,
  'recipient-ineligible');

-- seq-07: a tombstoned candidate_id blocks activation even though it has a
-- resolvable email (tombstones prevent future activation, invariant #3).
select sequences_test.expect_scalar('seq-07-erased-activation-blocked',
  $$select (sequences_test.build_and_activate('seq-erased','Email','msg-erased')->'activate'->>'reason')$$,
  'recipient-ineligible');

-- seq-08: a null campaign_id is an ambiguous/unresolvable recipient identity
-- and must fail closed at activation, not silently proceed.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table ambiguous_seq as
select public.create_outreach_sequence(
  '71111111-1111-4111-8111-111111111111', 'seq-ambiguous-email', null, 1,
  jsonb_build_array(jsonb_build_object(
    'channel', 'Email', 'messageId', 'msg-ambiguous', 'body', 'x',
    'bodyHash', encode(digest(E'\n' || 'x','sha256'),'hex'),
    'scopeHash', encode(digest('seq-ambiguous-email' || E'\n' || 'Email' || E'\n' || 'ambiguous@example.test','sha256'),'hex'),
    'gapDays', 0
  ))
) result;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.record_outreach_approval(
  'msg-ambiguous', encode(digest(E'\n' || 'x','sha256'),'hex'),
  encode(digest('seq-ambiguous-email' || E'\n' || 'Email' || E'\n' || 'ambiguous@example.test','sha256'),'hex')
);
reset role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table ambiguous_activation as
select public.activate_outreach_sequence(((select result from ambiguous_seq)->>'sequence_id')::uuid) result;
reset role;
select sequences_test.expect_scalar('seq-08-null-campaign-fails-closed',
  $$select (select result from ambiguous_activation)->>'reason'$$,
  'recipient-ineligible');

-- ---------------------------------------------------------------------------
-- Claim behavior: canonical recipient, correct channel transition.
-- ---------------------------------------------------------------------------
create function sequences_test.claim_first_step(p_sequence_id uuid) returns json
language plpgsql set search_path = pg_catalog, public, sequences_test as $$
declare step_id uuid; result json;
begin
  select id into step_id from public.outreach_sequence_steps
   where sequence_id = p_sequence_id and ordinal = 0;
  perform sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
  set role service_role;
  result := public.claim_sequence_step_for_schedule(step_id);
  reset role;
  return result;
end;
$$;
grant execute on function sequences_test.claim_first_step(uuid) to service_role;

create temporary table email_seq as select (sequences_test.build_and_activate('seq-email-claim','Email','msg-email-claim')->>'sequence_id')::uuid seq_id;
create temporary table whatsapp_seq as select (sequences_test.build_and_activate('seq-whatsapp-claim','WhatsApp','msg-whatsapp-claim')->>'sequence_id')::uuid seq_id;
create temporary table linkedin_seq as select (sequences_test.build_and_activate('seq-linkedin-claim','LinkedIn','msg-linkedin-claim')->>'sequence_id')::uuid seq_id;
grant select on whatsapp_seq to authenticated, service_role;
grant select on linkedin_seq to service_role;
create temporary table body_mutation_seq as select (sequences_test.build_and_activate('seq-body-mutation','Email','msg-body-mutation')->>'sequence_id')::uuid seq_id;
update public.outreach_sequence_steps set body = 'tampered body'
 where sequence_id = (select seq_id from body_mutation_seq) and ordinal = 0;
create temporary table body_mutation_claim as select sequences_test.claim_first_step((select seq_id from body_mutation_seq)) result;

create temporary table email_claim as select sequences_test.claim_first_step((select seq_id from email_seq)) result;
create temporary table whatsapp_claim as select sequences_test.claim_first_step((select seq_id from whatsapp_seq)) result;
create temporary table linkedin_claim as select sequences_test.claim_first_step((select seq_id from linkedin_seq)) result;

select sequences_test.expect_scalar('seq-09-email-claim-schedules',
  $$select (select result from email_claim)->>'reason'$$, 'scheduled');
select sequences_test.expect_scalar('seq-10-email-claim-recipient',
  $$select (select result from email_claim)->>'recipient'$$, 'claim-email@example.test');
select sequences_test.expect_scalar('seq-11-whatsapp-claim-schedules',
  $$select (select result from whatsapp_claim)->>'reason'$$, 'scheduled');
select sequences_test.expect_scalar('seq-12-whatsapp-claim-recipient',
  $$select (select result from whatsapp_claim)->>'recipient'$$, '14155550101');

-- The WhatsApp enqueue path historically omitted campaign_id. The sequence
-- trigger must fill it while atomically binding both sides, then the real Meta
-- claim policy must validate sender, consent, reply window, seat, approval,
-- recent-contact ledger, and cap before producing a delivery attempt.
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table whatsapp_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from whatsapp_seq), 0),
  '7e000000-0000-4000-8000-000000000002'
) result;
reset role;
grant select on whatsapp_outbound to service_role;

select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table whatsapp_provider_claim as
select public.claim_whatsapp_outbound(
  ((select result from whatsapp_outbound)->>'id')::uuid
) result;
create temporary table whatsapp_provider_acceptance as
select public.record_whatsapp_provider_acceptance(
  ((select result from whatsapp_outbound)->>'id')::uuid,
  ((select result from whatsapp_provider_claim)->>'delivery_attempt_id')::uuid,
  'wamid.sequence-test-claim'
) result;
create temporary table whatsapp_provider_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from whatsapp_seq), 0)
) result;
reset role;

select sequences_test.expect_scalar('seq-12a-whatsapp-atomic-enqueue-binds',
  $$select (select result from whatsapp_outbound)->>'reason'$$,
  'queued-and-bound');
select sequences_test.expect_scalar('seq-12b-whatsapp-atomic-enqueue-fills-campaign',
  $$select (outbound.campaign_id = seq.campaign_id
         and outbound.sequence_step_id = step.id
         and step.queued_outbound_id = outbound.id)::text
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from whatsapp_seq) and step.ordinal = 0$$,
  'true');
select sequences_test.expect_scalar('seq-12c-whatsapp-real-claim-passes-policy',
  $$select concat_ws(':', (select result from whatsapp_provider_claim)->>'allowed',
       (select result from whatsapp_provider_claim)->>'reason',
       ((select result from whatsapp_provider_claim)->>'delivery_attempt_id' is not null)::text)$$,
  'true:ok:true');
select sequences_test.expect_scalar('seq-12d-whatsapp-provider-acceptance-is-durable',
  $$select concat_ws(':', (select result from whatsapp_provider_acceptance)->>'allowed',
       (select result from whatsapp_provider_acceptance)->>'reason')$$,
  'true:recorded');
select sequences_test.expect_scalar('seq-12e-whatsapp-provider-send-completes-sequence',
  $$select concat_ws(':', (select result from whatsapp_provider_complete)->>'reason',
       (select result from whatsapp_provider_complete)->>'verification_source',
       (select status from public.outreach_sequences where id = (select seq_id from whatsapp_seq)))$$,
  'sent:provider_confirmed:completed');
select sequences_test.expect_scalar('seq-13-linkedin-claim-manual-task',
  $$select (select result from linkedin_claim)->>'reason'$$, 'manual_task');
select sequences_test.expect_scalar('seq-14-linkedin-claim-completion-mode',
  $$select (select result from linkedin_claim)->>'completion_mode'$$, 'operator_assertion');
select sequences_test.expect_scalar('seq-15-linkedin-step-status-manual-task',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from linkedin_seq) and ordinal = 0$$,
  'manual_task');
select sequences_test.expect_scalar('seq-15aa-unfinished-manual-task-has-no-verification-source',
  $$select (verification_source is null)::text from public.outreach_sequence_steps
      where sequence_id = (select seq_id from linkedin_seq) and ordinal = 0$$,
  'true');
select sequences_test.expect_scalar('seq-15a-step-body-mutation-blocks-claim',
  $$select (select result from body_mutation_claim)->>'reason'$$,
  'approval-content-or-scope-mismatch');

create temporary table revoked_before_claim_seq as
select (sequences_test.build_and_activate(
  'seq-linkedin-revoked-before-claim','LinkedIn','msg-linkedin-revoked-before-claim'
)->>'sequence_id')::uuid seq_id;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.revoke_outreach_approval(
  'msg-linkedin-revoked-before-claim', 'QA revocation before claim'
);
reset role;
create temporary table revoked_before_claim_result as
select sequences_test.claim_first_step((select seq_id from revoked_before_claim_seq)) result;
select sequences_test.expect_scalar('seq-15b-revocation-before-claim-blocks-task',
  $$select (select result from revoked_before_claim_result)->>'reason'$$,
  'approval-revoked');
select sequences_test.expect_scalar('seq-15c-revoked-due-step-is-terminally-cancelled',
  $$select seq.status || ':' || step.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
     where seq.id = (select seq_id from revoked_before_claim_seq)$$,
  'stopped_manual:cancelled');

-- Zero outbound/provider path for LinkedIn: bind_sequence_step_outbound must
-- refuse a manual_task step structurally, not just by caller discipline.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table linkedin_bind_attempt as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from linkedin_seq), 0),
  gen_random_uuid()
) result;
reset role;
select sequences_test.expect_scalar('seq-16-linkedin-never-bindable-to-outbound',
  $$select (select result from linkedin_bind_attempt)->>'ok'$$, 'false');
select sequences_test.expect_scalar('seq-17-linkedin-no-queued-outbound',
  $$select (queued_outbound_id is null)::text from public.outreach_sequence_steps
      where sequence_id = (select seq_id from linkedin_seq) and ordinal = 0$$,
  'true');

-- Suppressed/erased/missing-identity claims fail closed and terminally cancel
-- the remaining sequence so no worker can retry the recipient later.
-- Suppressed email activation was already blocked above; force a fresh
-- pending_approval sequence directly to isolate the CLAIM-time suppression
-- check independent of the activation-time gate.
delete from public.suppression_list where workspace_id = '71111111-1111-4111-8111-111111111111' and type = 'email' and value = 'suppressed@example.test';
create temporary table claim_supp_seq as select (sequences_test.build_and_activate('seq-suppressed-email-claim','Email','msg-supp-claim')->>'sequence_id')::uuid seq_id;
insert into public.suppression_list(workspace_id, type, value) values
  ('71111111-1111-4111-8111-111111111111','email','suppressed-claim@example.test')
on conflict do nothing;
create temporary table claim_supp_result as select sequences_test.claim_first_step((select seq_id from claim_supp_seq)) result;
select sequences_test.expect_scalar('seq-18-claim-time-suppression-blocks',
  $$select (select result from claim_supp_result)->>'reason'$$, 'suppressed');
select sequences_test.expect_scalar('seq-19-suppressed-step-is-terminally-cancelled',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from claim_supp_seq) and ordinal = 0$$,
  'cancelled');

create temporary table missing_seq as select (sequences_test.build_and_activate('seq-no-identity-claim','Email','msg-missing-claim')->>'sequence_id')::uuid seq_id;
-- Activation correctly refuses this sequence. Force the durable state only in
-- the fixture so the independent claim-time fail-closed branch is exercised.
update public.outreach_sequences set status = 'active'
 where id = (select seq_id from missing_seq);
update public.outreach_sequence_steps set status = 'due', due_at = now()
 where sequence_id = (select seq_id from missing_seq) and ordinal = 0;
create temporary table missing_claim as select sequences_test.claim_first_step((select seq_id from missing_seq)) result;
select sequences_test.expect_scalar('seq-20-missing-identity-claim-fails-closed',
  $$select (select result from missing_claim)->>'reason'$$, 'recipient-identity-missing');
select sequences_test.expect_scalar('seq-20a-missing-identity-claim-is-terminally-cancelled',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from missing_seq) and ordinal = 0$$,
  'cancelled');

-- Candidate-id erasure authority is rechecked when a worker claims a due step,
-- not only when the sequence was activated. This closes the activation/claim
-- race without relying on a mutable candidate record.
create temporary table claim_tombstone_seq as
select (sequences_test.build_and_activate(
  'seq-tombstone-claim','Email','msg-tombstone-claim'
)->>'sequence_id')::uuid seq_id;
insert into public.candidate_erasure_suppression_tombstones(
  request_id, workspace_id, identifier_kind, identifier_hmac,
  normalization_version
)
select request.id, '71111111-1111-4111-8111-111111111111', 'candidate_id',
       public.candidate_erasure_identifier_hmac(
         '71111111-1111-4111-8111-111111111111',
         'candidate_id', 'seq-tombstone-claim'
       ),
       'canonical_v2'
  from public.candidate_erasure_requests request
 where request.workspace_id = '71111111-1111-4111-8111-111111111111'
 order by request.created_at
 limit 1
on conflict do nothing;
create temporary table claim_tombstone_result as
select sequences_test.claim_first_step((select seq_id from claim_tombstone_seq)) result;
select sequences_test.expect_scalar('seq-20b-claim-time-tombstone-blocks',
  $$select (select result from claim_tombstone_result)->>'reason'$$,
  'erased');
select sequences_test.expect_scalar('seq-20c-claim-time-tombstone-terminally-stops',
  $$select seq.status || ':' || step.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
     where seq.id = (select seq_id from claim_tombstone_seq)$$,
  'stopped_erasure:cancelled');

-- The legacy binder must reject a campaign mismatch, and a service-role
-- session cannot turn the transaction-local GUC into binding authority for an
-- UPDATE or a fully matching queued INSERT. Both failures must leave the two
-- durable pointers empty.
create temporary table binding_campaign_seq as
select (sequences_test.build_and_activate(
  'seq-binding-campaign','Email','msg-binding-campaign'
)->>'sequence_id')::uuid seq_id;
create temporary table binding_campaign_claim as
select sequences_test.claim_first_step((select seq_id from binding_campaign_seq)) result;
insert into public.messages_outbound(
  id, workspace_id, candidate_id, channel, to_address, type, subject, body,
  status, dedupe_hash, approval_message_id, campaign_id
) values (
  '79999999-0000-4000-8000-000000000001',
  '71111111-1111-4111-8111-111111111111',
  'seq-binding-campaign', 'Email', 'binding-campaign@example.test',
  'candidate_reply', '', 'hello seq-binding-campaign', 'composed',
  repeat('d', 64), 'msg-binding-campaign', 'wrong-campaign'
);

create temporary table insert_forge_seq as
select (sequences_test.build_and_activate(
  'seq-insert-forge','Email','msg-insert-forge'
)->>'sequence_id')::uuid seq_id;
create temporary table insert_forge_claim as
select sequences_test.claim_first_step((select seq_id from insert_forge_seq)) result;
grant select on binding_campaign_seq, insert_forge_seq to service_role;

create temporary table service_authority_attempts (
  case_name text primary key,
  error_state text not null,
  error_message text not null
);
grant insert, select on service_authority_attempts to service_role;

select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table binding_campaign_result as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from binding_campaign_seq), 0),
  '79999999-0000-4000-8000-000000000001'
) result;
do $$
begin
  begin
    perform set_config(
      'aria.sequence_step_id',
      sequences_test.sequence_step_id((select seq_id from binding_campaign_seq), 0)::text,
      true
    );
    update public.messages_outbound
       set sequence_step_id = sequences_test.sequence_step_id(
         (select seq_id from binding_campaign_seq), 0
       )
     where id = '79999999-0000-4000-8000-000000000001';
    insert into service_authority_attempts values (
      'direct-update-attach', 'none', 'update unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'direct-update-attach', sqlstate, sqlerrm
    );
  end;
  perform set_config('aria.sequence_step_id', '', true);

  begin
    perform set_config(
      'aria.sequence_step_id',
      sequences_test.sequence_step_id((select seq_id from insert_forge_seq), 0)::text,
      true
    );
    insert into public.messages_outbound(
      id, workspace_id, candidate_id, channel, to_address, type, subject, body,
      status, dedupe_hash, approval_message_id, campaign_id
    ) values (
      '79999999-0000-4000-8000-000000000002',
      '71111111-1111-4111-8111-111111111111',
      'seq-insert-forge', 'Email', 'insert-forge@example.test',
      'candidate_reply', '', 'hello seq-insert-forge', 'queued',
      repeat('e', 64), 'msg-insert-forge', 'seq-campaign'
    );
    insert into service_authority_attempts values (
      'direct-insert-attach', 'none', 'insert unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'direct-insert-attach', sqlstate, sqlerrm
    );
  end;
  perform set_config('aria.sequence_step_id', '', true);
end;
$$;
reset role;

select sequences_test.expect_scalar('seq-20d-campaign-mismatch-binder-is-rejected',
  $$select (select result from binding_campaign_result)->>'reason'$$,
  'outbound-mismatch');
select sequences_test.expect_scalar('seq-20e-forged-guc-update-cannot-attach',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'direct-update-attach'$$,
  '55000:sequence outbound update requires bounded binding authority');
select sequences_test.expect_scalar('seq-20f-forged-guc-insert-cannot-attach',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'direct-insert-attach'$$,
  '55000:sequence outbound insert requires bounded owner authority');
select sequences_test.expect_scalar('seq-20g-rejected-update-leaves-both-pointers-null',
  $$select concat_ws(':',
       (outbound.sequence_step_id is null)::text,
       (step.queued_outbound_id is null)::text)
      from public.messages_outbound outbound
      cross join public.outreach_sequence_steps step
     where outbound.id = '79999999-0000-4000-8000-000000000001'
       and step.id = sequences_test.sequence_step_id(
         (select seq_id from binding_campaign_seq), 0
       )$$,
  'true:true');
select sequences_test.expect_scalar('seq-20h-rejected-insert-leaves-no-row-or-pointer',
  $$select concat_ws(':',
       (select count(*)::text from public.messages_outbound
         where id = '79999999-0000-4000-8000-000000000002'),
       (step.queued_outbound_id is null)::text)
      from public.outreach_sequence_steps step
     where step.id = sequences_test.sequence_step_id(
       (select seq_id from insert_forge_seq), 0
     )$$,
  '0:true');

-- ---------------------------------------------------------------------------
-- Completion: durable Email/WhatsApp send, idempotent operator manual task,
-- and transactional advancement (two-step ladders).
-- ---------------------------------------------------------------------------
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table two_step_seq as
select (
  select public.create_outreach_sequence(
    '71111111-1111-4111-8111-111111111111', 'seq-two-step-email', 'seq-campaign', 2,
    jsonb_build_array(
      jsonb_build_object('channel','Email','messageId','msg-two-step-0','body','a',
        'bodyHash', encode(digest(E'\n' || 'a','sha256'),'hex'),
        'scopeHash', encode(digest('seq-two-step-email' || E'\n' || 'Email' || E'\n' || 'two-step@example.test','sha256'),'hex'),
        'gapDays', 0),
      jsonb_build_object('channel','Email','messageId','msg-two-step-0','body','a',
        'bodyHash', encode(digest(E'\n' || 'a','sha256'),'hex'),
        'scopeHash', encode(digest('seq-two-step-email' || E'\n' || 'Email' || E'\n' || 'two-step@example.test','sha256'),'hex'),
        'gapDays', 3)
    )
  )->>'sequence_id'
)::uuid seq_id;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.record_outreach_approval('msg-two-step-0', encode(digest(E'\n' || 'a','sha256'),'hex'),
  encode(digest('seq-two-step-email' || E'\n' || 'Email' || E'\n' || 'two-step@example.test','sha256'),'hex'));
select public.record_outreach_approval('msg-two-step-wrong', encode(digest(E'\n' || 'wrong body','sha256'),'hex'),
  encode(digest('seq-two-step-email' || E'\n' || 'Email' || E'\n' || 'two-step@example.test','sha256'),'hex'));
reset role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table two_step_activate as select public.activate_outreach_sequence((select seq_id from two_step_seq)) result;
reset role;
create temporary table two_step_claim as select sequences_test.claim_first_step((select seq_id from two_step_seq)) result;
grant select on two_step_seq to authenticated;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table two_step_wrong_outbound as
select public.enqueue_email_outbound(
  'msg-two-step-wrong', 'seq-two-step-email', 'seq-campaign', null,
  'two-step@example.test', '', 'wrong body'
) result;
reset role;
grant select on two_step_wrong_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table two_step_wrong_bind as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0),
  ((select result from two_step_wrong_outbound)->>'id')::uuid
) result;
reset role;

select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table two_step_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on two_step_outbound to service_role;

select sequences_test.expect_scalar('seq-21-two-step-activates', $$select (select result from two_step_activate)->>'ok'$$, 'true');
select sequences_test.expect_scalar('seq-22-two-step-step0-claims', $$select (select result from two_step_claim)->>'reason'$$, 'scheduled');

select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table two_step_bind as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0),
  ((select result from two_step_outbound)->>'id')::uuid
) result;
create temporary table premature_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-23-completion-refuses-before-durable-send',
  $$select (select result from premature_complete)->>'reason'$$, 'not-durably-sent');
select sequences_test.expect_scalar('seq-23a-completion-uses-authorized-bind',
  $$select (select result from two_step_bind)->>'reason'$$, 'already-bound');
select sequences_test.expect_scalar('seq-23b-outbound-with-wrong-approved-message-is-rejected',
  $$select (select result from two_step_wrong_bind)->>'reason'$$, 'outbound-mismatch');

-- Cross the actual Email provider boundary. This must mint the authoritative
-- ledger claim + delivery attempt, then persist the RFC Message-ID before the
-- sequence completion RPC is allowed to advance cadence.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table two_step_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from two_step_outbound)->>'id')::uuid
) result;
create temporary table two_step_provider_acceptance as
select public.record_email_send_message_id(
  ((select result from two_step_outbound)->>'id')::uuid,
  ((select result from two_step_provider_claim)->>'delivery_attempt_id')::uuid,
  (select result from two_step_provider_claim)->>'rfc_message_id'
) result;
reset role;

select sequences_test.expect_scalar('seq-23c-email-real-claim-passes-policy',
  $$select concat_ws(':', (select result from two_step_provider_claim)->>'allowed',
       (select result from two_step_provider_claim)->>'reason',
       ((select result from two_step_provider_claim)->>'delivery_attempt_id' is not null)::text)$$,
  'true:ok:true');
select sequences_test.expect_scalar('seq-23d-email-provider-message-id-is-durable',
  $$select concat_ws(':', (select result from two_step_provider_acceptance)->>'allowed',
       (select result from two_step_provider_acceptance)->>'reason',
       (outbound.status = 'sent' and outbound.provider_message_id is not null)::text)
      from public.messages_outbound outbound
     where outbound.id = ((select result from two_step_outbound)->>'id')::uuid$$,
  'true:recorded:true');

-- A service worker owns RPC execution, not raw sequence authority. Once a
-- provider receipt exists it cannot clear the reciprocal pointer, rewrite the
-- terminal state, replace the provider id, or erase the send timestamp.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
do $$
begin
  begin
    update public.messages_outbound
       set sequence_step_id = null
     where id = ((select result from two_step_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'direct-pointer-clear', 'none', 'pointer clear unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'direct-pointer-clear', sqlstate, sqlerrm
    );
  end;
  begin
    update public.messages_outbound
       set status = 'failed'
     where id = ((select result from two_step_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'terminal-status-rewrite', 'none', 'terminal status rewrite unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'terminal-status-rewrite', sqlstate, sqlerrm
    );
  end;
  begin
    update public.messages_outbound
       set provider_message_id = 'forged-provider-receipt'
     where id = ((select result from two_step_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'provider-receipt-rewrite', 'none', 'provider receipt rewrite unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'provider-receipt-rewrite', sqlstate, sqlerrm
    );
  end;
  begin
    update public.messages_outbound
       set sent_at = null
     where id = ((select result from two_step_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'sent-time-clear', 'none', 'sent time clear unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'sent-time-clear', sqlstate, sqlerrm
    );
  end;
end;
$$;
reset role;
select sequences_test.expect_scalar('seq-23e-service-cannot-clear-live-binding',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'direct-pointer-clear'$$,
  '55000:sequence outbound binding is immutable');
select sequences_test.expect_scalar('seq-23f-service-cannot-rewrite-terminal-status',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'terminal-status-rewrite'$$,
  '55000:sequence outbound status requires bounded owner authority');
select sequences_test.expect_scalar('seq-23g-service-cannot-rewrite-provider-receipt',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'provider-receipt-rewrite'$$,
  '55000:sequence outbound provider receipt requires bounded owner authority');
select sequences_test.expect_scalar('seq-23h-service-cannot-clear-provider-send-time',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'sent-time-clear'$$,
  '55000:sequence outbound provider receipt requires bounded owner authority');
select sequences_test.expect_scalar('seq-23i-live-provider-evidence-remains-reciprocal',
  $$select concat_ws(':', outbound.status,
       (outbound.provider_message_id is not null)::text,
       (outbound.sent_at is not null)::text,
       (outbound.sequence_step_id = step.id)::text,
       (step.queued_outbound_id = outbound.id)::text,
       outbound.sequence_authority_bound::text)
      from public.messages_outbound outbound
      join public.outreach_sequence_steps step
        on step.id = outbound.sequence_step_id
     where outbound.id = ((select result from two_step_outbound)->>'id')::uuid$$,
  'sent:true:true:true:true:true');

select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table real_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0)
) result;
create temporary table replay_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 0)
) result;
reset role;

select sequences_test.expect_scalar('seq-24-durable-send-completes',
  $$select (select result from real_complete)->>'reason'$$, 'sent');
select sequences_test.expect_scalar('seq-25-durable-send-advances',
  $$select (select result from real_complete)->>'advanced'$$, 'true');
select sequences_test.expect_scalar('seq-26-replay-completion-idempotent',
  $$select (select result from replay_complete)->>'reason'$$, 'already-completed');
select sequences_test.expect_scalar('seq-27-next-step-due-with-gap',
  $$select status || ':' || (due_at > now() + interval '2 days' and due_at < now() + interval '4 days')::text
      from public.outreach_sequence_steps
     where sequence_id = (select seq_id from two_step_seq) and ordinal = 1$$,
  'due:true');
select sequences_test.expect_scalar('seq-28-no-double-advance-single-next-row',
  $$select count(*)::text from public.outreach_sequence_steps
      where sequence_id = (select seq_id from two_step_seq) and status = 'due'$$,
  '1');

-- A sent provider receipt is owned by step 0 and cannot be rebound to a later
-- step even when every tenant/candidate/channel/message/body field matches.
update public.outreach_sequence_steps
   set due_at = now()
 where sequence_id = (select seq_id from two_step_seq) and ordinal = 1;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table same_sequence_replay_claim as
select public.claim_sequence_step_for_schedule(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 1)
) result;
create temporary table same_sequence_receipt_replay as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 1),
  ((select result from two_step_outbound)->>'id')::uuid
) result;
reset role;
select sequences_test.expect_scalar('seq-28aa-provider-receipt-cannot-replay-on-later-step',
  $$select (select result from same_sequence_receipt_replay)->>'reason'$$,
  'outbound-already-bound');
update public.outreach_sequence_steps
   set status = 'due', due_at = now() + interval '3 days'
 where sequence_id = (select seq_id from two_step_seq) and ordinal = 1;

-- A delayed step cannot become claimable by clearing its authoritative due
-- timestamp. Suppression is then checked after restoring a real due time.
do $$
begin
  begin
    update public.outreach_sequence_steps
       set due_at = null
     where sequence_id = (select seq_id from two_step_seq) and ordinal = 1;
    perform sequences_test.expect('seq-28a-null-due-at-is-rejected', false, 'update unexpectedly succeeded');
  exception when check_violation then
    perform sequences_test.expect('seq-28a-null-due-at-is-rejected', true);
  end;
end;
$$;
insert into public.suppression_list(workspace_id, type, value) values
  ('71111111-1111-4111-8111-111111111111','email','two-step@example.test')
on conflict do nothing;
update public.outreach_sequence_steps
   set status = 'due', due_at = now()
 where sequence_id = (select seq_id from two_step_seq) and ordinal = 1;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table blocked_claim as
select public.claim_sequence_step_for_schedule(
  sequences_test.sequence_step_id((select seq_id from two_step_seq), 1)
) result;
reset role;
select sequences_test.expect_scalar('seq-29-post-schedule-suppression-blocks-claim',
  $$select (select result from blocked_claim)->>'reason'$$, 'suppressed');
delete from public.suppression_list where workspace_id = '71111111-1111-4111-8111-111111111111' and type = 'email' and value = 'two-step@example.test';

-- Terminalizing the original ladder permits a new sequence for the candidate,
-- but does not release the immutable provider receipt for reuse.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table cross_sequence_replay_seq as
select (public.create_outreach_sequence(
  '71111111-1111-4111-8111-111111111111', 'seq-two-step-email', 'seq-campaign', 1,
  jsonb_build_array(jsonb_build_object(
    'channel','Email','messageId','msg-two-step-0','body','a',
    'bodyHash', encode(digest(E'\n' || 'a','sha256'),'hex'),
    'scopeHash', encode(digest('seq-two-step-email' || E'\n' || 'Email' || E'\n' || 'two-step@example.test','sha256'),'hex'),
    'gapDays', 0
  ))
)->>'sequence_id')::uuid seq_id;
create temporary table cross_sequence_replay_activate as
select public.activate_outreach_sequence((select seq_id from cross_sequence_replay_seq)) result;
create temporary table cross_sequence_replay_claim as
select public.claim_sequence_step_for_schedule(
  sequences_test.sequence_step_id((select seq_id from cross_sequence_replay_seq), 0)
) result;
create temporary table cross_sequence_receipt_replay as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from cross_sequence_replay_seq), 0),
  ((select result from two_step_outbound)->>'id')::uuid
) result;
select public.stop_outreach_sequence((select seq_id from cross_sequence_replay_seq), 'manual');
reset role;
select sequences_test.expect_scalar('seq-29ad-provider-receipt-cannot-replay-on-new-sequence',
  $$select (select result from cross_sequence_receipt_replay)->>'reason'$$,
  'outbound-already-bound');

-- A terminal stop must cancel a queued provider row without violating the
-- durable outbox status constraint or rolling back the sequence stop.
create temporary table queued_stop_seq as
select (sequences_test.build_and_activate(
  'seq-email-stop-queued','Email','msg-email-stop-queued'
)->>'sequence_id')::uuid seq_id;
grant select on queued_stop_seq to authenticated, service_role;
create temporary table queued_stop_claim as
select sequences_test.claim_first_step((select seq_id from queued_stop_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table queued_stop_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from queued_stop_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on queued_stop_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table queued_stop_bind as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from queued_stop_seq), 0),
  ((select result from queued_stop_outbound)->>'id')::uuid
) result;
create temporary table queued_stop_result as
select public.stop_outreach_sequence((select seq_id from queued_stop_seq), 'manual') result;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table queued_stop_retry as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from queued_stop_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
select sequences_test.expect_scalar('seq-29aa-queued-outbound-stop-commits',
  $$select seq.status || ':' || step.status || ':' || outbound.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from queued_stop_seq)$$,
  'stopped_manual:cancelled:cancelled');
select sequences_test.expect_scalar('seq-29aaa-stopped-enqueue-retry-is-truthful',
  $$select concat_ws(':', (select result from queued_stop_retry)->>'ok',
       (select result from queued_stop_retry)->>'reason')$$,
  'false:bound-terminal-or-inconsistent');

-- A service worker may apply the one authority-reducing runtime transition
-- queued -> blocked. It still cannot detach or fabricate terminal/provider
-- evidence; the privileged stop RPC then owns blocked -> cancelled.
create temporary table service_block_seq as
select (sequences_test.build_and_activate(
  'seq-service-block','Email','msg-service-block'
)->>'sequence_id')::uuid seq_id;
grant select on service_block_seq to authenticated, service_role;
create temporary table service_block_claim as
select sequences_test.claim_first_step((select seq_id from service_block_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table service_block_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from service_block_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on service_block_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
update public.messages_outbound
   set status = 'blocked'
 where id = ((select result from service_block_outbound)->>'id')::uuid;
reset role;
create temporary table service_block_snapshot as
select outbound.status,
       outbound.sequence_authority_bound,
       outbound.sequence_step_id = step.id as outbound_points_to_step,
       step.queued_outbound_id = outbound.id as step_points_to_outbound
  from public.messages_outbound outbound
  join public.outreach_sequence_steps step on step.id = outbound.sequence_step_id
 where outbound.id = ((select result from service_block_outbound)->>'id')::uuid;
set role service_role;
create temporary table service_block_stop as
select public.stop_outreach_sequence((select seq_id from service_block_seq), 'manual') result;
reset role;
select sequences_test.expect_scalar('seq-29aaab-service-can-reduce-queued-to-blocked',
  $$select concat_ws(':', status, sequence_authority_bound::text,
       outbound_points_to_step::text, step_points_to_outbound::text)
      from service_block_snapshot$$,
  'blocked:true:true:true');
select sequences_test.expect_scalar('seq-29aaac-owner-stop-cancels-blocked-binding',
  $$select seq.status || ':' || step.status || ':' || outbound.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from service_block_seq)$$,
  'stopped_manual:cancelled:cancelled');

-- The dispatch worker may also record a pre-claim terminal failure without
-- inventing delivery evidence. The receipt remains bound for audit and the
-- owner-only stop RPC closes the sequence step.
create temporary table service_failed_seq as
select (sequences_test.build_and_activate(
  'seq-service-failed','Email','msg-service-failed'
)->>'sequence_id')::uuid seq_id;
grant select on service_failed_seq to authenticated, service_role;
create temporary table service_failed_claim as
select sequences_test.claim_first_step((select seq_id from service_failed_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table service_failed_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from service_failed_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on service_failed_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
update public.messages_outbound
   set status = 'failed'
 where id = ((select result from service_failed_outbound)->>'id')::uuid;
create temporary table service_failed_snapshot as
select status, sequence_authority_bound,
       delivery_attempt_id is null as no_delivery_attempt,
       dispatching_at is null as no_dispatch_time,
       provider_message_id is null as no_provider_receipt,
       sent_at is null as no_sent_time
  from public.messages_outbound
 where id = ((select result from service_failed_outbound)->>'id')::uuid;
create temporary table service_failed_stop as
select public.stop_outreach_sequence((select seq_id from service_failed_seq), 'manual') result;
reset role;
select sequences_test.expect_scalar('seq-29aaad-service-can-reduce-queued-to-failed',
  $$select concat_ws(':', status, sequence_authority_bound::text,
       no_delivery_attempt::text, no_dispatch_time::text,
       no_provider_receipt::text, no_sent_time::text)
      from service_failed_snapshot$$,
  'failed:true:true:true:true:true');
select sequences_test.expect_scalar('seq-29aaae-failed-binding-remains-auditable-after-stop',
  $$select seq.status || ':' || step.status || ':' || outbound.status || ':' ||
       (outbound.sequence_step_id = step.id)::text
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from service_failed_seq)$$,
  'stopped_manual:cancelled:failed:true');

-- A real owner-defined claim mints dispatch evidence. service_role may reduce
-- that dispatching row to blocked without changing the evidence, but cannot
-- forge claim fields beforehand or jump directly to provider-confirmed sent.
create temporary table dispatch_block_seq as
select (sequences_test.build_and_activate(
  'seq-dispatch-block','Email','msg-dispatch-block'
)->>'sequence_id')::uuid seq_id;
grant select on dispatch_block_seq to authenticated, service_role;
create temporary table dispatch_block_schedule as
select sequences_test.claim_first_step((select seq_id from dispatch_block_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table dispatch_block_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from dispatch_block_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on dispatch_block_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
do $$
begin
  begin
    update public.messages_outbound
       set delivery_attempt_id = extensions.gen_random_uuid()
     where id = ((select result from dispatch_block_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'claim-evidence-forgery', 'none', 'claim evidence forgery unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'claim-evidence-forgery', sqlstate, sqlerrm
    );
  end;
end;
$$;
create temporary table dispatch_block_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from dispatch_block_outbound)->>'id')::uuid
) result;
do $$
begin
  begin
    update public.messages_outbound
       set status = 'sent', provider_message_id = 'forged-direct-send', sent_at = now()
     where id = ((select result from dispatch_block_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'direct-dispatching-sent', 'none', 'direct sent transition unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'direct-dispatching-sent', sqlstate, sqlerrm
    );
  end;
end;
$$;
update public.messages_outbound
   set status = 'blocked'
 where id = ((select result from dispatch_block_outbound)->>'id')::uuid;
create temporary table dispatch_block_snapshot as
select status, sequence_authority_bound,
       delivery_attempt_id is not null as has_delivery_attempt,
       dispatching_at is not null as has_dispatch_time,
       policy_snapshot is not null as has_policy_snapshot,
       provider_message_id is null as no_provider_receipt,
       sent_at is null as no_sent_time
  from public.messages_outbound
 where id = ((select result from dispatch_block_outbound)->>'id')::uuid;
create temporary table dispatch_block_stop as
select public.stop_outreach_sequence((select seq_id from dispatch_block_seq), 'manual') result;
reset role;
select sequences_test.expect_scalar('seq-29aaaf-service-cannot-forge-claim-evidence',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'claim-evidence-forgery'$$,
  '55000:sequence outbound claim evidence requires bounded owner authority');
select sequences_test.expect_scalar('seq-29aaag-real-provider-claim-mints-evidence',
  $$select concat_ws(':',
       (select result from dispatch_block_provider_claim)->>'allowed',
       (select result from dispatch_block_provider_claim)->>'reason')$$,
  'true:ok');
select sequences_test.expect_scalar('seq-29aaah-service-cannot-assert-dispatching-sent',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'direct-dispatching-sent'$$,
  '55000:sequence outbound status requires bounded owner authority');
select sequences_test.expect_scalar('seq-29aaai-service-can-reduce-dispatching-to-blocked',
  $$select concat_ws(':', status, sequence_authority_bound::text,
       has_delivery_attempt::text, has_dispatch_time::text,
       has_policy_snapshot::text, no_provider_receipt::text, no_sent_time::text)
      from dispatch_block_snapshot$$,
  'blocked:true:true:true:true:true:true');
select sequences_test.expect_scalar('seq-29aaaj-owner-stop-cancels-claimed-blocked-row',
  $$select seq.status || ':' || step.status || ':' || outbound.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from dispatch_block_seq)$$,
  'stopped_manual:cancelled:cancelled');

-- The protected release switch and tenant kill switch are rechecked at the
-- last database boundary before dispatch. Disabling either after enqueue must
-- cancel the queued row without minting a ledger claim or delivery attempt.
create temporary table release_disable_seq as
select (sequences_test.build_and_activate(
  'seq-release-disable-dispatch','Email','msg-release-disable-dispatch'
)->>'sequence_id')::uuid seq_id;
grant select on release_disable_seq to authenticated, service_role;
create temporary table release_disable_schedule as
select sequences_test.claim_first_step((select seq_id from release_disable_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table release_disable_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from release_disable_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on release_disable_outbound to service_role;
update public.outreach_sequence_release_controls
   set enabled = false, enabled_at = null, enabled_by = null
 where workspace_id = '71111111-1111-4111-8111-111111111111';
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table release_disable_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from release_disable_outbound)->>'id')::uuid
) result;
reset role;
select sequences_test.expect_scalar('seq-29aab-release-disable-blocks-dispatch',
  $$select concat_ws(':', (select result from release_disable_provider_claim)->>'allowed',
       (select result from release_disable_provider_claim)->>'reason')$$,
  'false:sequences-disabled');
select sequences_test.expect_scalar('seq-29aac-release-disable-has-no-provider-side-effect',
  $$select concat_ws(':', seq.status, step.status, outbound.status,
       (outbound.delivery_attempt_id is null)::text,
       (select count(*)::text from public.outreach_ledger ledger
         where ledger.outbound_message_id = outbound.id))
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from release_disable_seq)$$,
  'stopped_campaign:cancelled:cancelled:true:0');
update public.outreach_sequence_release_controls
   set enabled = true, enabled_at = now(),
       enabled_by = 'a1000000-0000-4000-8000-000000000001'
 where workspace_id = '71111111-1111-4111-8111-111111111111';

create temporary table kill_disable_seq as
select (sequences_test.build_and_activate(
  'seq-kill-disable-dispatch','Email','msg-kill-disable-dispatch'
)->>'sequence_id')::uuid seq_id;
grant select on kill_disable_seq to authenticated, service_role;
create temporary table kill_disable_schedule as
select sequences_test.claim_first_step((select seq_id from kill_disable_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table kill_disable_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from kill_disable_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on kill_disable_outbound to service_role;
update public.sourcing_loop_controls
   set kill_switch = true, sequences_enabled = false
 where workspace_id = '71111111-1111-4111-8111-111111111111';
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table kill_disable_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from kill_disable_outbound)->>'id')::uuid
) result;
reset role;
select sequences_test.expect_scalar('seq-29aad-kill-switch-blocks-dispatch',
  $$select concat_ws(':', (select result from kill_disable_provider_claim)->>'allowed',
       (select result from kill_disable_provider_claim)->>'reason')$$,
  'false:sequences-disabled');
select sequences_test.expect_scalar('seq-29aae-kill-switch-has-no-provider-side-effect',
  $$select concat_ws(':', seq.status, step.status, outbound.status,
       (outbound.delivery_attempt_id is null)::text,
       (select count(*)::text from public.outreach_ledger ledger
         where ledger.outbound_message_id = outbound.id))
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from kill_disable_seq)$$,
  'stopped_campaign:cancelled:cancelled:true:0');
update public.sourcing_loop_controls
   set kill_switch = false, sequences_enabled = true
 where workspace_id = '71111111-1111-4111-8111-111111111111';

-- Once the provider boundary says `sent`, later safety gates may stop future
-- work but must never rewrite that external fact as cancelled.
create temporary table sent_kill_seq as
select (sequences_test.build_and_activate(
  'seq-email-sent-kill','Email','msg-email-sent-kill'
)->>'sequence_id')::uuid seq_id;
grant select on sent_kill_seq to authenticated, service_role;
create temporary table sent_kill_claim as
select sequences_test.claim_first_step((select seq_id from sent_kill_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table sent_kill_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from sent_kill_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on sent_kill_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table sent_kill_bind as
select public.bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from sent_kill_seq), 0),
  ((select result from sent_kill_outbound)->>'id')::uuid
) result;
create temporary table sent_kill_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from sent_kill_outbound)->>'id')::uuid
) result;
create temporary table sent_kill_provider_acceptance as
select public.record_email_send_message_id(
  ((select result from sent_kill_outbound)->>'id')::uuid,
  ((select result from sent_kill_provider_claim)->>'delivery_attempt_id')::uuid,
  (select result from sent_kill_provider_claim)->>'rfc_message_id'
) result;
reset role;
select sequences_test.expect_scalar('seq-29aba-sent-kill-crosses-real-provider-boundary',
  $$select concat_ws(':',
       (select result from sent_kill_provider_claim)->>'allowed',
       (select result from sent_kill_provider_acceptance)->>'allowed',
       (select result from sent_kill_provider_acceptance)->>'reason')$$,
  'true:true:recorded');
update public.sourcing_loop_controls set kill_switch = true, sequences_enabled = false
 where workspace_id = '71111111-1111-4111-8111-111111111111';
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table sent_kill_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from sent_kill_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-29ab-provider-send-recorded-before-kill-stop',
  $$select (select result from sent_kill_complete)->>'reason'$$,
  'sent-stopped');
select sequences_test.expect_scalar('seq-29ac-provider-send-remains-truthful',
  $$select seq.status || ':' || step.status || ':' || step.verification_source || ':' || outbound.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from sent_kill_seq)$$,
  'stopped_campaign:sent:provider_confirmed:sent');
update public.sourcing_loop_controls set kill_switch = false, sequences_enabled = true
 where workspace_id = '71111111-1111-4111-8111-111111111111';

-- Suppression is checked again after a real provider acceptance and before the
-- sequence advances. The immutable send remains sent, while future cadence is
-- terminally stopped as an opt-out.
create temporary table completion_suppression_seq as
select (sequences_test.build_and_activate(
  'seq-completion-suppression','Email','msg-completion-suppression'
)->>'sequence_id')::uuid seq_id;
grant select on completion_suppression_seq to authenticated, service_role;
create temporary table completion_suppression_claim as
select sequences_test.claim_first_step((select seq_id from completion_suppression_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table completion_suppression_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from completion_suppression_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on completion_suppression_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table completion_suppression_provider_claim as
select public.claim_email_outbound_queued(
  ((select result from completion_suppression_outbound)->>'id')::uuid
) result;
create temporary table completion_suppression_provider_acceptance as
select public.record_email_send_message_id(
  ((select result from completion_suppression_outbound)->>'id')::uuid,
  ((select result from completion_suppression_provider_claim)->>'delivery_attempt_id')::uuid,
  (select result from completion_suppression_provider_claim)->>'rfc_message_id'
) result;
reset role;
insert into public.suppression_list(workspace_id, type, value) values (
  '71111111-1111-4111-8111-111111111111',
  'email', 'completion-suppression@example.test'
)
on conflict do nothing;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table completion_suppression_complete as
select public.complete_sequence_step_send(
  sequences_test.sequence_step_id((select seq_id from completion_suppression_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-29ad-completion-time-suppression-stops-advance',
  $$select concat_ws(':',
       (select result from completion_suppression_complete)->>'reason',
       (select result from completion_suppression_complete)->>'stop_reason',
       (select result from completion_suppression_complete)->>'advanced')$$,
  'sent-stopped:optout:false');
select sequences_test.expect_scalar('seq-29ae-completion-suppression-preserves-provider-truth',
  $$select seq.status || ':' || step.status || ':' || outbound.status
      from public.outreach_sequences seq
      join public.outreach_sequence_steps step on step.sequence_id = seq.id
      join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
     where seq.id = (select seq_id from completion_suppression_seq)$$,
  'stopped_optout:sent:sent');
delete from public.suppression_list
 where workspace_id = '71111111-1111-4111-8111-111111111111'
   and type = 'email'
   and value = 'completion-suppression@example.test';

-- Earlier focused gates inserted candidate-id tombstones directly to isolate
-- activation/claim behavior. Restore the real erasure invariant before calling
-- request_candidate_erasure: no already-tombstoned candidate may remain in the
-- workspace document that the RPC rewrites.
update public.workspace_state
   set state = public.scrub_candidate_workspace_document(
     public.scrub_candidate_workspace_document(state, 'seq-erased'),
     'seq-tombstone-claim'
   )
 where workspace_id = '71111111-1111-4111-8111-111111111111';

-- Exercise the real 0033 erasure RPC while an outbound is durably bound and
-- queued. The cleanup trigger must cancel it before deleting the sequence; the
-- FK may clear the pointer, but the historical marker must survive so the
-- scrubbed row can never re-enter the generic dispatcher.
create temporary table erasure_live_seq as
select (sequences_test.build_and_activate(
  'seq-erasure-live','Email','msg-erasure-live'
)->>'sequence_id')::uuid seq_id;
grant select on erasure_live_seq to authenticated, service_role;
create temporary table erasure_live_claim as
select sequences_test.claim_first_step((select seq_id from erasure_live_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table erasure_live_outbound as
select public.enqueue_and_bind_sequence_step_outbound(
  sequences_test.sequence_step_id((select seq_id from erasure_live_seq), 0),
  '7e000000-0000-4000-8000-000000000001'
) result;
reset role;
grant select on erasure_live_outbound to service_role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table erasure_live_result as
select public.request_candidate_erasure(
  '71111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'seq-campaign', 'seq-erasure-live',
  '79999999-0000-4000-8000-000000000003'
) result;
reset role;
select sequences_test.expect_scalar('seq-29af-erasure-removes-live-sequence',
  $$select count(*)::text from public.outreach_sequences
      where id = (select seq_id from erasure_live_seq)$$,
  '0');
select sequences_test.expect_scalar('seq-29ag-erasure-cancels-detaches-and-marks-outbound',
  $$select concat_ws(':', status,
       (sequence_step_id is null)::text,
       sequence_authority_bound::text,
       (candidate_id like 'erased:%')::text,
       (to_address = '')::text,
       (body = 'Candidate data erased')::text)
      from public.messages_outbound
     where id = ((select result from erasure_live_outbound)->>'id')::uuid$$,
  'cancelled:true:true:true:true:true');
select sequences_test.expect_scalar('seq-29ah-detached-marker-denies-generic-claim',
  $$select public.prepare_sequence_outbound_claim(
       ((select result from erasure_live_outbound)->>'id')::uuid,
       'Email'
     )->>'reason'$$,
  'sequence-binding-invalid');

select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
do $$
begin
  begin
    update public.messages_outbound
       set status = 'queued'
     where id = ((select result from erasure_live_outbound)->>'id')::uuid;
    insert into service_authority_attempts values (
      'erased-reactivation', 'none', 'historical reactivation unexpectedly succeeded'
    );
  exception when others then
    insert into service_authority_attempts values (
      'erased-reactivation', sqlstate, sqlerrm
    );
  end;
end;
$$;
reset role;
select sequences_test.expect_scalar('seq-29ai-detached-terminal-row-cannot-reactivate',
  $$select error_state || ':' || error_message
      from service_authority_attempts where case_name = 'erased-reactivation'$$,
  '55000:historical sequence outbound cannot be reactivated');
select sequences_test.expect_scalar('seq-29aj-erased-row-remains-terminal-and-marked',
  $$select status || ':' || (sequence_step_id is null)::text || ':' ||
       sequence_authority_bound::text
      from public.messages_outbound
     where id = ((select result from erasure_live_outbound)->>'id')::uuid$$,
  'cancelled:true:true');

-- ---------------------------------------------------------------------------
-- Manual task completion derives the named operator from the authenticated
-- principal. Service-role callers cannot forge an operator assertion.
-- ---------------------------------------------------------------------------
create temporary table manual_seq as select (sequences_test.build_and_activate('seq-linkedin-manual','LinkedIn','msg-manual-complete')->>'sequence_id')::uuid seq_id;
grant select on manual_seq to authenticated;
create temporary table manual_claim as select sequences_test.claim_first_step((select seq_id from manual_seq)) result;

-- A valid operator in another workspace must receive the same not-found
-- response as an unknown UUID and must not learn the manual task's status.
select sequences_test.set_authenticated_claims('a3000000-0000-4000-8000-000000000003');
set role authenticated;
create temporary table cross_workspace_manual_attempt as
select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from manual_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-29a-manual-task-cross-workspace-is-not-found',
  $$select (select result from cross_workspace_manual_attempt)->>'reason'$$,
  'not-found');

select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table manual_complete as
select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from manual_seq), 0)
) result;
create temporary table manual_replay_same_operator as
select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from manual_seq), 0)
) result;
reset role;

select sequences_test.expect_scalar('seq-30-manual-task-completes',
  $$select (select result from manual_complete)->>'reason'$$,
  'operator-assertion-recorded');
select sequences_test.expect_scalar('seq-31-manual-task-verification-source',
  $$select (select result from manual_complete)->>'verification_source'$$, 'operator_assertion');
select sequences_test.expect_scalar('seq-31a-manual-completion-records-sent-at',
  $$select (sent_at is not null and completed_at is not null and completed_by = 'a1000000-0000-4000-8000-000000000001')::text
      from public.outreach_sequence_steps
     where sequence_id = (select seq_id from manual_seq) and ordinal = 0$$,
  'true');
select sequences_test.expect_scalar('seq-32-manual-task-single-step-completes-sequence',
  $$select status from public.outreach_sequences where id = (select seq_id from manual_seq)$$,
  'completed');
select sequences_test.expect_scalar('seq-33-manual-replay-same-operator-idempotent',
  $$select (select result from manual_replay_same_operator)->>'reason'$$, 'already-completed');
select sequences_test.expect_scalar('seq-33aa-manual-action-has-one-attributed-receipt',
  $$select concat_ws(':', count(*)::text, min(operator_id::text),
       min(asserted_from_status), min(sequence_status_at_assertion))
      from public.outreach_sequence_manual_action_receipts
     where step_id = sequences_test.sequence_step_id((select seq_id from manual_seq), 0)$$,
  '1:a1000000-0000-4000-8000-000000000001:manual_task:active');
do $$
begin
  begin
    update public.outreach_sequence_manual_action_receipts
       set asserted_at = asserted_at + interval '1 second'
     where step_id = sequences_test.sequence_step_id((select seq_id from manual_seq), 0);
    perform sequences_test.expect('seq-33ab-manual-receipt-update-is-rejected', false,
      'append-only receipt update unexpectedly succeeded');
  exception when sqlstate '42501' then
    perform sequences_test.expect('seq-33ab-manual-receipt-update-is-rejected', true);
  end;
  begin
    delete from public.outreach_sequence_manual_action_receipts
     where step_id = sequences_test.sequence_step_id((select seq_id from manual_seq), 0);
    perform sequences_test.expect('seq-33ac-manual-receipt-delete-is-rejected', false,
      'append-only receipt delete unexpectedly succeeded');
  exception when sqlstate '42501' then
    perform sequences_test.expect('seq-33ac-manual-receipt-delete-is-rejected', true);
  end;
end;
$$;

-- Append-only manual evidence deliberately RESTRICTs workspace deletion until
-- a future governed purge exists. Prove the failure is the named FK contract,
-- not the misleading append-only trigger failure produced by ON DELETE CASCADE.
insert into public.workspaces(id, name, allowed_domain) values (
  '74444444-4444-4444-8444-444444444444',
  'Receipt retention fixture', 'receipt-retention.example.test'
);
insert into public.outreach_sequence_manual_action_receipts(
  step_id, workspace_id, sequence_id, operator_id, approval_id, message_id,
  body_hash, scope_hash, approved_by, approved_at, task_issued_at,
  asserted_from_status, sequence_status_at_assertion
) values (
  '74444444-4444-4444-8444-444444444441',
  '74444444-4444-4444-8444-444444444444',
  '74444444-4444-4444-8444-444444444442',
  'a1000000-0000-4000-8000-000000000001',
  '74444444-4444-4444-8444-444444444443',
  'msg-retained-receipt', repeat('a', 64), repeat('b', 64),
  'a1000000-0000-4000-8000-000000000001', now(), now(),
  'manual_task', 'active'
);
do $$
declare failed_constraint text;
begin
  begin
    delete from public.workspaces
     where id = '74444444-4444-4444-8444-444444444444';
    perform sequences_test.expect(
      'seq-33ad-manual-receipt-restricts-workspace-delete', false,
      'workspace delete unexpectedly succeeded'
    );
  exception
    when foreign_key_violation then
      get stacked diagnostics failed_constraint = CONSTRAINT_NAME;
      perform sequences_test.expect(
        'seq-33ad-manual-receipt-restricts-workspace-delete',
        failed_constraint = 'outreach_sequence_manual_action_receipts_workspace_id_fkey',
        'constraint=' || coalesce(failed_constraint, '<null>')
      );
    when others then
      perform sequences_test.expect(
        'seq-33ad-manual-receipt-restricts-workspace-delete', false,
        sqlstate || ':' || sqlerrm
      );
  end;
end;
$$;
select sequences_test.expect_scalar('seq-33ae-restricted-workspace-and-receipt-survive',
  $$select concat_ws(':',
       (select count(*)::text from public.workspaces
         where id = '74444444-4444-4444-8444-444444444444'),
       (select count(*)::text
          from public.outreach_sequence_manual_action_receipts
         where step_id = '74444444-4444-4444-8444-444444444441'))$$,
  '1:1');

-- A human approval is consumed by exactly one LinkedIn sequence step. Even an
-- explicit re-approval of the same message id cannot replay the old decision.
create temporary table approval_replay as
select sequences_test.build_and_activate(
  'seq-linkedin-manual', 'LinkedIn', 'msg-manual-complete'
) result;
select sequences_test.expect_scalar('seq-33a-linkedin-approval-cannot-authorize-a-second-sequence',
  $$select (select result from approval_replay)->'activate'->>'reason'$$,
  'approval-already-consumed');
select sequences_test.expect_scalar('seq-33b-linkedin-approval-has-one-consumption',
  $$select count(*)::text
      from public.outreach_sequence_manual_approval_consumptions
     where message_id = 'msg-manual-complete'$$,
  '1');

-- Revocation, kill, recipient drift, and erasure all land after task creation
-- and must prevent completion, not merely prevent the next step.
create temporary table revoked_seq as select (sequences_test.build_and_activate(
  'seq-linkedin-revoked','LinkedIn','msg-linkedin-revoked'
)->>'sequence_id')::uuid seq_id;
grant select on revoked_seq to authenticated;
create temporary table revoked_claim as select sequences_test.claim_first_step((select seq_id from revoked_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.revoke_outreach_approval('msg-linkedin-revoked', 'QA revocation after claim');
create temporary table revoked_complete as select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from revoked_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-33c-revoked-manual-task-cannot-complete',
  $$select (select result from revoked_complete)->>'reason'$$,
  'operator-assertion-recorded-terminal');
select sequences_test.expect_scalar('seq-33ca-revoked-receipt-does-not-advance',
  $$select concat_ws(':', (select result from revoked_complete)->>'assertion_recorded',
       (select result from revoked_complete)->>'completion_applied',
       (select result from revoked_complete)->>'advanced',
       (select result from revoked_complete)->>'advance_blocked_reason')$$,
  'true:false:false:approval-revoked-or-consumed');
select sequences_test.expect_scalar('seq-33d-revoked-manual-task-is-terminally-cancelled',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from revoked_seq) and ordinal = 0$$,
  'cancelled');

create temporary table killed_seq as select (sequences_test.build_and_activate(
  'seq-linkedin-kill','LinkedIn','msg-linkedin-kill'
)->>'sequence_id')::uuid seq_id;
grant select on killed_seq to authenticated;
create temporary table killed_claim as select sequences_test.claim_first_step((select seq_id from killed_seq)) result;
update public.sourcing_loop_controls set kill_switch = true, sequences_enabled = false
 where workspace_id = '71111111-1111-4111-8111-111111111111';
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table killed_complete as select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from killed_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-33e-kill-switch-blocks-manual-completion',
  $$select (select result from killed_complete)->>'reason'$$,
  'operator-assertion-recorded-terminal');
select sequences_test.expect_scalar('seq-33f-kill-switch-terminally-cancels-task',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from killed_seq) and ordinal = 0$$,
  'cancelled');
select sequences_test.expect_scalar('seq-33fa-kill-terminal-receipt-is-single-attributed-no-advance',
  $$select concat_ws(':', count(*)::text, min(receipt.operator_id::text),
       (select result from killed_complete)->>'assertion_recorded',
       (select result from killed_complete)->>'completion_applied',
       (select result from killed_complete)->>'advanced',
       (select result from killed_complete)->>'advance_blocked_reason')
      from public.outreach_sequence_manual_action_receipts receipt
     where receipt.step_id = sequences_test.sequence_step_id((select seq_id from killed_seq), 0)$$,
  '1:a1000000-0000-4000-8000-000000000001:true:false:false:sequences-disabled');
update public.sourcing_loop_controls set kill_switch = false, sequences_enabled = true
 where workspace_id = '71111111-1111-4111-8111-111111111111';

create temporary table drift_seq as select (sequences_test.build_and_activate(
  'seq-linkedin-drift','LinkedIn','msg-linkedin-drift'
)->>'sequence_id')::uuid seq_id;
grant select on drift_seq to authenticated;
create temporary table drift_claim as select sequences_test.claim_first_step((select seq_id from drift_seq)) result;
update public.candidates set linkedin_url = 'https://linkedin.com/in/seq-linkedin-drift-moved'
 where workspace_id = '71111111-1111-4111-8111-111111111111'
   and campaign_id = 'seq-campaign' and id = 'seq-linkedin-drift';
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table drift_complete as select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from drift_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-33g-recipient-drift-blocks-manual-completion',
  $$select (select result from drift_complete)->>'reason'$$,
  'operator-assertion-recorded-terminal');
select sequences_test.expect_scalar('seq-33ga-recipient-drift-receipt-does-not-advance',
  $$select concat_ws(':', (select result from drift_complete)->>'advanced',
       (select result from drift_complete)->>'advance_blocked_reason')$$,
  'false:approval-content-or-scope-mismatch');

create temporary table tombstone_seq as select (sequences_test.build_and_activate(
  'seq-linkedin-tombstone','LinkedIn','msg-linkedin-tombstone'
)->>'sequence_id')::uuid seq_id;
grant select on tombstone_seq to authenticated;
create temporary table tombstone_claim as select sequences_test.claim_first_step((select seq_id from tombstone_seq)) result;
insert into public.candidate_erasure_suppression_tombstones(
  request_id, workspace_id, identifier_kind, identifier_hmac, normalization_version
)
select request.id, '71111111-1111-4111-8111-111111111111', 'linkedin',
       public.candidate_erasure_linkedin_canonical_hmac(
         '71111111-1111-4111-8111-111111111111',
         'https://www.linkedin.com/in/seq-linkedin-tombstone'
       ),
       'canonical_v2'
  from public.candidate_erasure_requests request
 where request.workspace_id = '71111111-1111-4111-8111-111111111111'
 order by request.created_at
 limit 1
on conflict do nothing;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table tombstone_complete as select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from tombstone_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-33h-canonical-tombstone-blocks-manual-completion',
  $$select (select result from tombstone_complete)->>'reason'$$,
  'operator-assertion-recorded-terminal');
select sequences_test.expect_scalar('seq-33ha-tombstone-receipt-does-not-advance',
  $$select concat_ws(':', (select result from tombstone_complete)->>'advanced',
       (select result from tombstone_complete)->>'advance_blocked_reason')$$,
  'false:recipient-ineligible');
select sequences_test.expect_scalar('seq-33i-tombstoned-task-never-records-sent',
  $$select (status = 'cancelled' and sent_at is null and completed_at is null)::text
      from public.outreach_sequence_steps
     where sequence_id = (select seq_id from tombstone_seq) and ordinal = 0$$,
  'true');

-- max_touches is a hard execution cap even when a malformed legacy sequence
-- contains more stored steps than its configured limit.
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table max_touch_seq as
select (public.create_outreach_sequence(
  '71111111-1111-4111-8111-111111111111', 'seq-max-touch', 'seq-campaign', 1,
  jsonb_build_array(
    jsonb_build_object('channel','LinkedIn','messageId','msg-max-touch-0','body','first',
      'bodyHash',encode(digest(E'\n' || 'first','sha256'),'hex'),
      'scopeHash',encode(digest('seq-max-touch' || E'\n' || 'LinkedIn' || E'\n' || 'https://www.linkedin.com/in/seq-max-touch','sha256'),'hex'),'gapDays',0),
    jsonb_build_object('channel','LinkedIn','messageId','msg-max-touch-1','body','second',
      'bodyHash',encode(digest(E'\n' || 'second','sha256'),'hex'),
      'scopeHash',encode(digest('seq-max-touch' || E'\n' || 'LinkedIn' || E'\n' || 'https://www.linkedin.com/in/seq-max-touch','sha256'),'hex'),'gapDays',0)
  )
)->>'sequence_id')::uuid seq_id;
grant select on max_touch_seq to authenticated;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
select public.record_outreach_approval(
  'msg-max-touch-0', encode(digest(E'\n' || 'first','sha256'),'hex'),
  encode(digest('seq-max-touch' || E'\n' || 'LinkedIn' || E'\n' || 'https://www.linkedin.com/in/seq-max-touch','sha256'),'hex')
);
reset role;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table max_touch_activate as select public.activate_outreach_sequence((select seq_id from max_touch_seq)) result;
reset role;
create temporary table max_touch_claim as select sequences_test.claim_first_step((select seq_id from max_touch_seq)) result;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table max_touch_complete as select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from max_touch_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-33j-max-touch-sequence-activates',
  $$select (select result from max_touch_activate)->>'ok'$$, 'true');
select sequences_test.expect_scalar('seq-33k-max-touch-cap-cancels-extra-step',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from max_touch_seq) and ordinal = 1$$,
  'cancelled');
select sequences_test.expect_scalar('seq-33l-max-touch-cap-completes-without-advance',
  $$select (select result from max_touch_complete)->>'advanced'$$, 'false');

-- ---------------------------------------------------------------------------
-- Terminal stop wins: stopping a sequence cancels an unclaimed manual_task
-- step, and a subsequent completion attempt on it is rejected.
-- ---------------------------------------------------------------------------
create temporary table stop_seq as select (sequences_test.build_and_activate('seq-manual-race','LinkedIn','msg-stop-race')->>'sequence_id')::uuid seq_id;
grant select on stop_seq to service_role, authenticated;
create temporary table stop_claim as select sequences_test.claim_first_step((select seq_id from stop_seq)) result;
select sequences_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
set role service_role;
create temporary table stop_result as select public.stop_outreach_sequence((select seq_id from stop_seq), 'manual') result;
reset role;
select sequences_test.set_authenticated_claims('a1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table stop_then_complete as
select public.complete_sequence_manual_task(
  sequences_test.sequence_step_id((select seq_id from stop_seq), 0)
) result;
reset role;
select sequences_test.expect_scalar('seq-34-stop-cancels-manual-task',
  $$select status from public.outreach_sequence_steps
      where sequence_id = (select seq_id from stop_seq) and ordinal = 0$$,
  'cancelled');
select sequences_test.expect_scalar('seq-35-stop-wins-over-completion',
  $$select (select result from stop_then_complete)->>'reason'$$,
  'operator-assertion-recorded-terminal');
select sequences_test.expect_scalar('seq-35a-stop-still-records-action-without-advance',
  $$select concat_ws(':', count(*)::text, min(receipt.operator_id::text),
       (select result from stop_then_complete)->>'assertion_recorded',
       (select result from stop_then_complete)->>'completion_applied',
       (select result from stop_then_complete)->>'advanced')
      from public.outreach_sequence_manual_action_receipts receipt
     where receipt.step_id = sequences_test.sequence_step_id((select seq_id from stop_seq), 0)$$,
  '1:a1000000-0000-4000-8000-000000000001:true:false:false');

do $$
declare failed integer; details text;
begin
  select count(*) into failed from sequences_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from sequences_test.results where not passed;
    raise exception 'sequences DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from sequences_test.results")"
echo "sequences-db: fixture behavior: ${assertions} assertions, 0 failed"

# A provider-confirmed terminal binding is historical evidence, not mutable
# delivery authority. Reapplying 0063 after candidate contact drift must retain
# and accept that evidence instead of demanding the candidate's current email.
psql_stdin -q -c "
  update public.candidates
     set email = 'sent-kill-moved@example.test'
   where workspace_id = '71111111-1111-4111-8111-111111111111'
     and campaign_id = 'seq-campaign'
     and id = 'seq-email-sent-kill';
"
psql_stdin -q < supabase/migrations/0063_outreach_sequence_authority_repair.sql
terminal_binding_reapply="$(psql_stdin -Atqc "
  select seq.status || ':' || step.status || ':' || outbound.status || ':' ||
         outbound.sequence_authority_bound::text
    from public.outreach_sequences seq
    join public.outreach_sequence_steps step on step.sequence_id = seq.id
    join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
   where seq.candidate_id = 'seq-email-sent-kill'
     and seq.workspace_id = '71111111-1111-4111-8111-111111111111';
")"
if [[ "$terminal_binding_reapply" != "stopped_campaign:sent:sent:true" ]]; then
  echo "sequences-db: terminal provider binding did not survive contact-drift reapply (${terminal_binding_reapply})" >&2
  exit 1
fi
psql_stdin -q -c "
  update public.candidates
     set email = 'sent-kill@example.test'
   where workspace_id = '71111111-1111-4111-8111-111111111111'
     and campaign_id = 'seq-campaign'
     and id = 'seq-email-sent-kill';
"
echo "sequences-db: terminal provider binding survives candidate contact drift and forward reapply"

# ---------------------------------------------------------------------------
# Concurrency: exactly one worker may claim a due step. Session 1 claims and
# holds the update uncommitted; session 2's claim on the SAME step blocks on
# the row lock, then loses once session 1 commits.
# ---------------------------------------------------------------------------
race_seq_id="$(psql_stdin -Atqc "
  set request.jwt.claims = '{\"sub\":\"a1000000-0000-4000-8000-000000000001\",\"role\":\"service_role\"}';
  set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
  set request.jwt.claim.role = 'service_role';
  set role service_role;
  select (public.create_outreach_sequence(
    '71111111-1111-4111-8111-111111111111', 'seq-race', 'seq-campaign', 1,
    jsonb_build_array(jsonb_build_object(
      'channel','Email','messageId','msg-race','body','r',
      'bodyHash', encode(digest(E'\n' || 'r','sha256'),'hex'),
      'scopeHash', encode(digest('seq-race' || chr(10) || 'Email' || chr(10) || 'race@example.test','sha256'),'hex'),
      'gapDays', 0
    ))
  )->>'sequence_id');
  reset role;
")"
psql_stdin -q <<SQL
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.record_outreach_approval('msg-race', encode(digest(E'\n' || 'r','sha256'),'hex'),
  encode(digest('seq-race' || chr(10) || 'Email' || chr(10) || 'race@example.test','sha256'),'hex'));
reset role;
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.activate_outreach_sequence('${race_seq_id}'::uuid);
reset role;
SQL
race_step_id="$(psql_stdin -Atqc "select id from public.outreach_sequence_steps where sequence_id = '${race_seq_id}'::uuid and ordinal = 0")"

psql_stdin -q <<RACE_HOLDER &
begin;
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.claim_sequence_step_for_schedule('${race_step_id}'::uuid);
reset role;
select pg_sleep(5);
commit;
RACE_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 60); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where state = 'active' and query like '%pg_sleep(5)%' and query not like '%pg_stat_activity%'")"
  [ "$ready" = "1" ] && break
  sleep 0.5
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: race holder never reached its held transaction" >&2
  exit 1
fi

challenger_reason="$(psql_stdin -Atq <<RACE_CHALLENGER | tail -n 1
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.claim_sequence_step_for_schedule('${race_step_id}'::uuid)->>'reason';
reset role;
RACE_CHALLENGER
)"
wait "$holder_pid"
holder_pid=""

if [ "$challenger_reason" != "not-due" ]; then
  echo "sequences-db: concurrent claim did not lose to the row-locked winner (got '${challenger_reason}')" >&2
  exit 1
fi
final_status="$(psql_stdin -Atqc "select status from public.outreach_sequence_steps where id = '${race_step_id}'::uuid")"
if [ "$final_status" != "scheduled" ]; then
  echo "sequences-db: exactly one worker must win the claim race (status='${final_status}')" >&2
  exit 1
fi
echo "sequences-db: concurrent claim race: exactly one winner, challenger reason=not-due"

# ---------------------------------------------------------------------------
# Claim vs revocation: a revocation that owns the shared advisory/approval lock
# must commit before claim can publish a manual task. The waiting claim then
# observes the revoked row and terminally cancels the sequence.
# ---------------------------------------------------------------------------
claim_revoke_seq_id="$(psql_stdin -Atqc "
  select (sequences_test.build_and_activate(
    'seq-claim-revoke-race','LinkedIn','msg-claim-revoke-race'
  )->>'sequence_id');
")"
claim_revoke_step_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${claim_revoke_seq_id}'::uuid and ordinal = 0;
")"

psql_stdin -q <<REVOKE_HOLDER &
set application_name = 'aria-sequence-revoke-holder';
begin;
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.revoke_outreach_approval('msg-claim-revoke-race', 'QA concurrent revoke');
reset role;
select pg_sleep(3);
commit;
REVOKE_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 40); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'aria-sequence-revoke-holder' and state = 'active'")"
  [ "$ready" = "1" ] && break
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: revocation holder never reached its held transaction" >&2
  exit 1
fi

claim_after_revoke_reason="$(psql_stdin -Atq <<CLAIM_AFTER_REVOKE | tail -n 1
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.claim_sequence_step_for_schedule('${claim_revoke_step_id}'::uuid)->>'reason';
reset role;
CLAIM_AFTER_REVOKE
)"
wait "$holder_pid"
holder_pid=""

if [ "$claim_after_revoke_reason" != "approval-revoked" ]; then
  echo "sequences-db: claim did not observe the serialized revocation (got '${claim_after_revoke_reason}')" >&2
  exit 1
fi
claim_revoke_final="$(psql_stdin -Atqc "select seq.status || ':' || step.status from public.outreach_sequences seq join public.outreach_sequence_steps step on step.sequence_id = seq.id where step.id = '${claim_revoke_step_id}'::uuid")"
if [ "$claim_revoke_final" != "stopped_manual:cancelled" ]; then
  echo "sequences-db: revoked claim race ended in '${claim_revoke_final}'" >&2
  exit 1
fi
echo "sequences-db: concurrent revoke race: committed revocation prevents manual task"

# ---------------------------------------------------------------------------
# Concurrent manual completion: the first named operator holds the step lock;
# a second operator must not overwrite attribution or execute advancement.
# ---------------------------------------------------------------------------
completion_race_seq_id="$(psql_stdin -Atqc "
  select (sequences_test.build_and_activate(
    'seq-completion-race','LinkedIn','msg-completion-race'
  )->>'sequence_id');
")"
completion_race_step_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${completion_race_seq_id}'::uuid and ordinal = 0;
")"
psql_stdin -Atqc "select sequences_test.claim_first_step('${completion_race_seq_id}'::uuid)->>'reason';" >/dev/null

psql_stdin -q <<COMPLETE_HOLDER &
set application_name = 'aria-manual-complete-holder';
begin;
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.complete_sequence_manual_task('${completion_race_step_id}'::uuid);
reset role;
select pg_sleep(3);
commit;
COMPLETE_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 40); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'aria-manual-complete-holder' and state = 'active'")"
  [ "$ready" = "1" ] && break
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: completion holder never reached its held transaction" >&2
  exit 1
fi

completion_challenger_reason="$(psql_stdin -Atq <<COMPLETE_CHALLENGER | tail -n 1
set request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}';
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000002';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.complete_sequence_manual_task('${completion_race_step_id}'::uuid)->>'reason';
reset role;
COMPLETE_CHALLENGER
)"
wait "$holder_pid"
holder_pid=""

if [ "$completion_challenger_reason" != "completed-by-other" ]; then
  echo "sequences-db: concurrent manual completion did not preserve the first operator (got '${completion_challenger_reason}')" >&2
  exit 1
fi
completion_owner="$(psql_stdin -Atqc "select completed_by from public.outreach_sequence_steps where id = '${completion_race_step_id}'::uuid")"
if [ "$completion_owner" != "a1000000-0000-4000-8000-000000000001" ]; then
  echo "sequences-db: concurrent manual completion changed operator attribution to '${completion_owner}'" >&2
  exit 1
fi
echo "sequences-db: concurrent manual completion: exactly one named operator"

# ---------------------------------------------------------------------------
# Concurrent terminal stop: when stop owns the locks first, a racing operator
# may still record the already-performed external action, but cannot convert the
# cancelled task to sent or advance the sequence after the stop commits.
# ---------------------------------------------------------------------------
stop_race_seq_id="$(psql_stdin -Atqc "
  select (sequences_test.build_and_activate(
    'seq-stop-concurrent','LinkedIn','msg-stop-concurrent'
  )->>'sequence_id');
")"
stop_race_step_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${stop_race_seq_id}'::uuid and ordinal = 0;
")"
psql_stdin -Atqc "select sequences_test.claim_first_step('${stop_race_seq_id}'::uuid)->>'reason';" >/dev/null

psql_stdin -q <<STOP_HOLDER &
set application_name = 'aria-sequence-stop-holder';
begin;
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.stop_outreach_sequence('${stop_race_seq_id}'::uuid, 'manual');
reset role;
select pg_sleep(3);
commit;
STOP_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 40); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'aria-sequence-stop-holder' and state = 'active'")"
  [ "$ready" = "1" ] && break
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: stop holder never reached its held transaction" >&2
  exit 1
fi

stop_challenger_reason="$(psql_stdin -Atq <<STOP_CHALLENGER | tail -n 1
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.complete_sequence_manual_task('${stop_race_step_id}'::uuid)->>'reason';
reset role;
STOP_CHALLENGER
)"
wait "$holder_pid"
holder_pid=""

if [ "$stop_challenger_reason" != "operator-assertion-recorded-terminal" ]; then
  echo "sequences-db: terminal stop did not retain a terminal operator assertion (got '${stop_challenger_reason}')" >&2
  exit 1
fi
stop_race_final="$(psql_stdin -Atqc "select seq.status || ':' || step.status from public.outreach_sequences seq join public.outreach_sequence_steps step on step.sequence_id = seq.id where step.id = '${stop_race_step_id}'::uuid")"
if [ "$stop_race_final" != "stopped_manual:cancelled" ]; then
  echo "sequences-db: terminal stop race ended in '${stop_race_final}'" >&2
  exit 1
fi
stop_race_receipt="$(psql_stdin -Atqc "select count(*)::text || ':' || min(operator_id::text) from public.outreach_sequence_manual_action_receipts where step_id = '${stop_race_step_id}'::uuid")"
if [ "$stop_race_receipt" != "1:a1000000-0000-4000-8000-000000000001" ]; then
  echo "sequences-db: terminal stop race lost receipt attribution ('${stop_race_receipt}')" >&2
  exit 1
fi
echo "sequences-db: concurrent stop race: first-committed stop prevents advancement and preserves the operator assertion"

# ---------------------------------------------------------------------------
# Atomic enqueue/bind vs stop. The authenticated enqueue transaction owns the
# parent sequence while its trigger inserts and binds the queued row. A stop
# waits, then must see and cancel that row after the enqueue commits.
# ---------------------------------------------------------------------------
atomic_stop_seq_id="$(psql_stdin -Atqc "
  select (sequences_test.build_and_activate(
    'seq-atomic-enqueue-stop','Email','msg-atomic-enqueue-stop'
  )->>'sequence_id');
")"
atomic_stop_step_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${atomic_stop_seq_id}'::uuid and ordinal = 0;
")"
psql_stdin -Atqc "select sequences_test.claim_first_step('${atomic_stop_seq_id}'::uuid)->>'reason';" >/dev/null

psql_stdin -q <<ATOMIC_ENQUEUE_HOLDER &
set application_name = 'aria-atomic-enqueue-holder';
begin;
set local lock_timeout = '10s';
set local statement_timeout = '15s';
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.enqueue_and_bind_sequence_step_outbound('${atomic_stop_step_id}'::uuid, null);
reset role;
select pg_sleep(4);
commit;
ATOMIC_ENQUEUE_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 40); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'aria-atomic-enqueue-holder' and state = 'active'")"
  [ "$ready" = "1" ] && break
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: atomic enqueue holder never reached its held transaction" >&2
  exit 1
fi

atomic_stop_status="$(psql_stdin -Atq <<ATOMIC_STOP | tail -n 1
set lock_timeout = '10s';
set statement_timeout = '15s';
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.stop_outreach_sequence('${atomic_stop_seq_id}'::uuid, 'manual')->>'status';
reset role;
ATOMIC_STOP
)"
wait "$holder_pid"
holder_pid=""
if [ "$atomic_stop_status" != "stopped_manual" ]; then
  echo "sequences-db: stop after atomic enqueue returned '${atomic_stop_status}'" >&2
  exit 1
fi
atomic_stop_final="$(psql_stdin -Atqc "
  select seq.status || ':' || step.status || ':' || outbound.status
    from public.outreach_sequences seq
    join public.outreach_sequence_steps step on step.sequence_id = seq.id
    join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
   where seq.id = '${atomic_stop_seq_id}'::uuid;
")"
if [ "$atomic_stop_final" != "stopped_manual:cancelled:cancelled" ]; then
  echo "sequences-db: atomic enqueue/stop race ended in '${atomic_stop_final}'" >&2
  exit 1
fi
echo "sequences-db: atomic enqueue/bind is visible to the first terminal stop"

# ---------------------------------------------------------------------------
# Multi-step stop vs later-step completion. The completion transaction owns
# the parent row first. A stop must wait on that parent before locking any
# child step; child-first stop code deadlocks when completion then locks step 1.
# ---------------------------------------------------------------------------
multi_step_seq_id="$(psql_stdin -Atqc "
  select (sequences_test.build_two_step_linkedin()->>'sequence_id');
")"
multi_step_0_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${multi_step_seq_id}'::uuid and ordinal = 0;
")"
multi_step_1_id="$(psql_stdin -Atqc "
  select id from public.outreach_sequence_steps
   where sequence_id = '${multi_step_seq_id}'::uuid and ordinal = 1;
")"

psql_stdin -Atqc "select sequences_test.claim_first_step('${multi_step_seq_id}'::uuid)->>'reason';" >/dev/null
psql_stdin -q <<MULTI_FIRST_COMPLETE >/dev/null
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.complete_sequence_manual_task('${multi_step_0_id}'::uuid);
reset role;
MULTI_FIRST_COMPLETE
multi_step_claim_reason="$(psql_stdin -Atq <<MULTI_SECOND_CLAIM | tail -n 1
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.claim_sequence_step_for_schedule('${multi_step_1_id}'::uuid)->>'reason';
reset role;
MULTI_SECOND_CLAIM
)"
if [ "$multi_step_claim_reason" != "manual_task" ]; then
  echo "sequences-db: multi-step second claim returned '${multi_step_claim_reason}'" >&2
  exit 1
fi

psql_stdin -q <<MULTI_COMPLETE_HOLDER &
set application_name = 'aria-multi-step-completion-holder';
begin;
set local deadlock_timeout = '500ms';
set local lock_timeout = '10s';
set local statement_timeout = '15s';
select 1 from public.outreach_sequences where id = '${multi_step_seq_id}'::uuid for update;
select pg_sleep(4);
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
select public.complete_sequence_manual_task('${multi_step_1_id}'::uuid);
reset role;
commit;
MULTI_COMPLETE_HOLDER
holder_pid=$!

ready=""
for _ in $(seq 1 40); do
  ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'aria-multi-step-completion-holder' and state = 'active'")"
  [ "$ready" = "1" ] && break
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  echo "sequences-db: multi-step completion holder never acquired the sequence" >&2
  exit 1
fi

multi_step_stop_reason="$(psql_stdin -Atq <<MULTI_STOP | tail -n 1
set deadlock_timeout = '500ms';
set lock_timeout = '10s';
set statement_timeout = '15s';
set request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"service_role"}';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.stop_outreach_sequence('${multi_step_seq_id}'::uuid, 'manual')->>'reason';
reset role;
MULTI_STOP
)"
wait "$holder_pid"
holder_pid=""

if [ "$multi_step_stop_reason" != "not-stoppable" ]; then
  echo "sequences-db: serialized multi-step stop returned '${multi_step_stop_reason}'" >&2
  exit 1
fi
multi_step_final="$(psql_stdin -Atqc "
  select seq.status || ':' || string_agg(step.status, ':' order by step.ordinal)
    from public.outreach_sequences seq
    join public.outreach_sequence_steps step on step.sequence_id = seq.id
   where seq.id = '${multi_step_seq_id}'::uuid
   group by seq.status;
")"
if [ "$multi_step_final" != "completed:sent:sent" ]; then
  echo "sequences-db: multi-step completion/stop race ended in '${multi_step_final}'" >&2
  exit 1
fi
echo "sequences-db: multi-step parent-first lock order prevents completion/stop deadlock"

# ---------------------------------------------------------------------------
# Legacy LinkedIn tombstone transition. A pre-0063 raw alias cannot be reversed
# from its HMAC, so LinkedIn sequence activation must fail closed. New canonical
# v2 tombstones, in contrast, match every supported URL alias.
# ---------------------------------------------------------------------------
canonical_alias_match="$(psql_stdin -Atqc "
  select (
    public.candidate_erasure_linkedin_canonical_hmac(
      '71111111-1111-4111-8111-111111111111',
      'https://linkedin.com/in/seq-linkedin-legacy-alias/'
    ) = public.candidate_erasure_linkedin_canonical_hmac(
      '71111111-1111-4111-8111-111111111111',
      'http://www.linkedin.com/in/seq-linkedin-legacy-alias?trk=reimport'
    )
  )::text;
")"
if [ "$canonical_alias_match" != "true" ]; then
  echo "sequences-db: canonical LinkedIn tombstone aliases do not converge" >&2
  exit 1
fi

psql_stdin -q <<'LEGACY_TOMBSTONE'
insert into public.candidate_erasure_suppression_tombstones(
  request_id, workspace_id, identifier_kind, identifier_hmac, normalization_version
)
select request.id,
       '71111111-1111-4111-8111-111111111111',
       'linkedin',
       public.sourcing_authority_hmac(
         '71111111-1111-4111-8111-111111111111',
         'candidate-erasure:linkedin:https://linkedin.com/in/seq-linkedin-legacy-alias/'
       ),
       'legacy_v1'
  from public.candidate_erasure_requests request
 where request.workspace_id = '71111111-1111-4111-8111-111111111111'
 order by request.created_at
 limit 1
on conflict do nothing;
LEGACY_TOMBSTONE

legacy_alias_reason="$(psql_stdin -Atqc "
  select sequences_test.build_and_activate(
    'seq-linkedin-legacy-alias','LinkedIn','msg-linkedin-legacy-alias'
  )->'activate'->>'reason';
")"
if [ "$legacy_alias_reason" != "recipient-ineligible" ]; then
  echo "sequences-db: unresolved legacy LinkedIn tombstone did not fail closed (got '${legacy_alias_reason}')" >&2
  exit 1
fi
echo "sequences-db: LinkedIn tombstones: canonical-v2 aliases converge, unresolved legacy workspace fails closed"

# ---------------------------------------------------------------------------
# Rollback remains unsupported after completion/manual-task evidence.
# ---------------------------------------------------------------------------
set +e
rollback_output="$(psql_stdin -qAt 2>&1 < supabase/rollbacks/0063_outreach_sequence_authority_repair.sql)"
rollback_status=$?
set -e
if [[ "$rollback_status" -eq 0 || "$rollback_output" != *"rollback is intentionally unsupported"* ]]; then
  echo "0063 rollback did not refuse the unsafe downgrade after completion evidence" >&2
  echo "$rollback_output" >&2
  exit 1
fi
post_refusal_columns="$(psql_stdin -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='outreach_sequence_steps' and column_name in ('due_at','verification_source','completed_at','completed_by')")"
if [[ "$post_refusal_columns" != "4" ]]; then
  echo "0063 rollback refusal changed durable completion evidence columns" >&2
  exit 1
fi

echo "RESULT sequences-db: behavior=pass dirty-upgrade=pass reapply=pass provider-claims=pass dispatch-gates=pass manual-receipts=pass receipt-replay=pass atomic-enqueue-stop=pass claim-concurrency=pass completion-concurrency=pass stop-concurrency=pass multi-step-lock-order=pass rollback-guard=pass"
