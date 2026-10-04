#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-cross-channel-cap-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
email_result_file="$(mktemp /tmp/aria-cap-email.XXXXXX)"
migration_log="$(mktemp /tmp/aria-cap-migration.XXXXXX)"
compose_log="$(mktemp /tmp/aria-cap-compose.XXXXXX)"
email_pid=""
failures=0
export DB_HOST_PORT=0
postgres_password="$(docker compose -p "$project" config --format json | jq -er '.services["db-init"].environment.POSTGRES_TARGET_PASSWORD')"
test -n "$postgres_password"

cleanup() {
  if [ -n "$email_pid" ]; then
    kill "$email_pid" >/dev/null 2>&1 || true
    wait "$email_pid" >/dev/null 2>&1 || true
  fi
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$email_result_file" "$migration_log" "$compose_log"
}
trap cleanup EXIT HUP INT TERM

psql_external() {
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_external_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

json_field() {
  local payload="$1" field="$2"
  jq -r "$field" <<<"$payload"
}

docker info >/dev/null
if ! docker compose -p "$project" up -d db db-init >"$compose_log" 2>&1; then
  tail -n 40 "$compose_log" >&2
  exit 1
fi
db_init_id="$(docker compose -p "$project" ps -a -q db-init)"
test -n "$db_init_id"
db_init_status="$(docker wait "$db_init_id")"
if [ "$db_init_status" != "0" ]; then
  echo "database owner reconciliation failed with status $db_init_status" >&2
  docker logs "$db_init_id" >&2 || true
  exit 1
fi

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  if ! psql_external_stdin -q < "$migration" >"$migration_log" 2>&1; then
    echo "migration failed: $migration" >&2
    tail -n 40 "$migration_log" >&2
    exit 1
  fi
done

psql_external_stdin -q <<'SQL'
create schema aria_cap_test;

create function aria_cap_test.set_claims(subject uuid, jwt_role text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
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

create function aria_cap_test.claim_email(message_id text, candidate_id text)
returns json
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform aria_cap_test.set_claims(
    'ca000000-0000-4000-8000-000000000002'::uuid,
    'authenticated'
  );
  return public.claim_email_outbound(
    message_id,
    repeat('a', 64),
    repeat('b', 64),
    candidate_id,
    candidate_id || '@example.test',
    'cap-test',
    'ca000000-0000-4000-8000-000000000003'::uuid
  );
end;
$$;

create function aria_cap_test.claim_whatsapp(message_id uuid)
returns json
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform aria_cap_test.set_claims(null, 'service_role');
  return public.claim_whatsapp_outbound(message_id);
end;
$$;

create function aria_cap_test.claim_linkedin(message_id uuid)
returns json
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform aria_cap_test.set_claims(null, 'service_role');
  return public.claim_linkedin_outbound_queued(message_id);
end;
$$;

create function aria_cap_test.pause_email_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.channel = 'Email' and new.candidate_id = 'candidate-email-race' then
    perform pg_sleep(3);
  end if;
  return new;
end;
$$;

create trigger aria_cap_pause_email_insert
before insert on public.outreach_ledger
for each row execute function aria_cap_test.pause_email_insert();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ca000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cap-owner@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.workspaces (id, name, allowed_domain)
values ('ca000000-0000-4000-8000-000000000001', 'Cap Test', 'example.test');

insert into public.profiles (id, email, workspace_id, role)
values (
  'ca000000-0000-4000-8000-000000000002',
  'cap-owner@example.test',
  'ca000000-0000-4000-8000-000000000001',
  'admin'
);

insert into public.agent_seats (
  id, workspace_id, name, operator_email, provider, status, mode,
  domain_verified, daily_limit, warmup
) values (
  'ca000000-0000-4000-8000-000000000003',
  'ca000000-0000-4000-8000-000000000001',
  'Cap seat', 'sender@example.test', 'WhatsApp Cloud', 'active', 'live',
  true, 1, false
);

insert into public.whatsapp_senders (
  id, workspace_id, seat_id, meta_phone_number_id, status
) values (
  'ca000000-0000-4000-8000-000000000004',
  'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000003',
  'cap-test-phone-number-id', 'active'
);

insert into public.whatsapp_contacts (
  workspace_id, recipient_e164, consent_status, consent_source,
  recorded_at, expires_at, last_inbound_at
) values (
  'ca000000-0000-4000-8000-000000000001',
  '14155550123', 'opted_in', 'synthetic-test',
  now(), now() + interval '1 day', now()
);

insert into public.whatsapp_conversation_windows (
  workspace_id, sender_id, recipient_e164,
  last_inbound_message_id, last_inbound_at, freeform_until
) values (
  'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000004',
  '14155550123', 'cap-test-inbound', now(), now() + interval '1 hour'
);

insert into public.outreach_approvals (
  workspace_id, message_id, body_hash, approval_scope_hash,
  approved_by, approval_source
) values
  (
    'ca000000-0000-4000-8000-000000000001',
    'email-race', repeat('a', 64), repeat('b', 64),
    'ca000000-0000-4000-8000-000000000002', 'human'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'email-after-ambiguous', repeat('a', 64), repeat('b', 64),
    'ca000000-0000-4000-8000-000000000002', 'human'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000005',
    encode(digest('Cap race' || E'\n' || 'WhatsApp cap race body', 'sha256'), 'hex'),
    encode(digest('candidate-whatsapp-race' || E'\n' || 'WhatsApp' || E'\n' || '14155550123', 'sha256'), 'hex'),
    'ca000000-0000-4000-8000-000000000002', 'human'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000006',
    encode(digest('LinkedIn cap' || E'\n' || 'LinkedIn cap body', 'sha256'), 'hex'),
    encode(digest('candidate-linkedin-cap' || E'\n' || 'LinkedIn' || E'\n' || 'https://www.linkedin.com/in/cap-candidate', 'sha256'), 'hex'),
    'ca000000-0000-4000-8000-000000000002', 'human'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000007',
    encode(digest('LinkedIn recontact' || E'\n' || 'LinkedIn recontact body', 'sha256'), 'hex'),
    encode(digest('candidate-email-race' || E'\n' || 'LinkedIn' || E'\n' || 'https://www.linkedin.com/in/recontact-candidate', 'sha256'), 'hex'),
    'ca000000-0000-4000-8000-000000000002', 'human'
  );

insert into public.messages_outbound (
  id, workspace_id, candidate_id, seat_id, channel, to_address,
  type, subject, body, status, dedupe_hash, scheduled_at,
  recipient_e164, approval_message_id
) values (
  'ca000000-0000-4000-8000-000000000005',
  'ca000000-0000-4000-8000-000000000001',
  'candidate-whatsapp-race',
  'ca000000-0000-4000-8000-000000000003',
  'WhatsApp', '14155550123', 'candidate_reply',
  'Cap race', 'WhatsApp cap race body', 'queued',
  'cap-race-whatsapp-dedupe', now(), '14155550123',
  'ca000000-0000-4000-8000-000000000005'
),
(
  'ca000000-0000-4000-8000-000000000006',
  'ca000000-0000-4000-8000-000000000001',
  'candidate-linkedin-cap',
  'ca000000-0000-4000-8000-000000000003',
  'LinkedIn', 'https://www.linkedin.com/in/cap-candidate', 'candidate_reply',
  'LinkedIn cap', 'LinkedIn cap body', 'queued',
  'cap-race-linkedin-dedupe', now(), null,
  'ca000000-0000-4000-8000-000000000006'
),
(
  'ca000000-0000-4000-8000-000000000007',
  'ca000000-0000-4000-8000-000000000001',
  'candidate-email-race',
  'ca000000-0000-4000-8000-000000000003',
  'LinkedIn', 'https://www.linkedin.com/in/recontact-candidate', 'candidate_reply',
  'LinkedIn recontact', 'LinkedIn recontact body', 'queued',
  'cap-race-linkedin-recontact-dedupe', now(), null,
  'ca000000-0000-4000-8000-000000000007'
);
SQL

psql_external \
  -qAtc "set application_name = 'aria-cap-email'; set lock_timeout = '5s'; set statement_timeout = '15s'; select aria_cap_test.claim_email('email-race', 'candidate-email-race');" \
  >"$email_result_file" &
email_pid=$!

email_paused=""
for _ in $(seq 1 60); do
  email_paused="$(psql_external -qAtc \
    "select count(*) from pg_stat_activity where application_name = 'aria-cap-email' and wait_event = 'PgSleep'")"
  [ "$email_paused" = "1" ] && break
  sleep 0.1
done
if [ "$email_paused" != "1" ]; then
  wait "$email_pid" || true
  email_pid=""
  echo "email claim did not reach the post-count barrier: $(tail -n 20 "$email_result_file")" >&2
  exit 1
fi

whatsapp_result="$(psql_external -qAtc \
  "set lock_timeout = '5s'; set statement_timeout = '15s'; select aria_cap_test.claim_whatsapp('ca000000-0000-4000-8000-000000000005');")"
wait "$email_pid"
email_pid=""
email_result="$(tail -n 1 "$email_result_file")"

email_allowed="$(json_field "$email_result" '.allowed')"
whatsapp_allowed="$(json_field "$whatsapp_result" '.allowed')"
allowed_count=0
[ "$email_allowed" = "true" ] && allowed_count=$((allowed_count + 1))
[ "$whatsapp_allowed" = "true" ] && allowed_count=$((allowed_count + 1))
active_count="$(psql_external -qAtc \
  "select count(*) from public.outreach_ledger where seat_id = 'ca000000-0000-4000-8000-000000000003' and status in ('claimed', 'sent', 'ambiguous')")"

if [ "$allowed_count" != "1" ] || [ "$active_count" != "1" ]; then
  echo "cross-channel cap violated: cap=1 email=$email_result whatsapp=$whatsapp_result active=$active_count" >&2
  failures=$((failures + 1))
fi

psql_external_stdin -q <<'SQL'
delete from public.outreach_ledger;
update public.messages_outbound
set status = 'queued', dispatching_at = null, delivery_attempt_id = null
where id = 'ca000000-0000-4000-8000-000000000005';

insert into public.outreach_ledger (
  workspace_id, candidate_id, candidate_email, seat_id,
  campaign_id, channel, status, approval_message_id
) values (
  'ca000000-0000-4000-8000-000000000001',
  'candidate-ambiguous', 'candidate-ambiguous@example.test',
  'ca000000-0000-4000-8000-000000000003',
  'cap-test', 'Email', 'ambiguous', 'ambiguous-existing'
);
SQL

ambiguous_result="$(psql_external -qAtc \
  "set lock_timeout = '5s'; set statement_timeout = '15s'; select aria_cap_test.claim_email('email-after-ambiguous', 'candidate-after-ambiguous');")"
ambiguous_allowed="$(json_field "$ambiguous_result" '.allowed')"
ambiguous_reason="$(json_field "$ambiguous_result" '.reason')"

if [ "$ambiguous_allowed" != "false" ] || [ "$ambiguous_reason" != "seat daily cap reached" ]; then
  echo "ambiguous outcome did not reserve capacity: $ambiguous_result" >&2
  failures=$((failures + 1))
fi

psql_external_stdin -q <<'SQL'
delete from public.outreach_ledger;
update public.agent_seats
   set provider = 'LinkedIn Assisted Manual'
 where id = 'ca000000-0000-4000-8000-000000000003';

insert into public.outreach_ledger (
  workspace_id, candidate_id, candidate_email, seat_id,
  campaign_id, channel, status, approval_message_id
) values (
  'ca000000-0000-4000-8000-000000000001',
  'candidate-email-race', 'candidate-email-race@example.test',
  'ca000000-0000-4000-8000-000000000003',
  'cap-test', 'Email', 'sent', 'email-race'
);
SQL

linkedin_recontact_result="$(psql_external -qAtc \
  "set lock_timeout = '5s'; set statement_timeout = '15s'; select aria_cap_test.claim_linkedin('ca000000-0000-4000-8000-000000000007');")"
linkedin_recontact_allowed="$(json_field "$linkedin_recontact_result" '.allowed')"
linkedin_recontact_reason="$(json_field "$linkedin_recontact_result" '.reason')"
if [ "$linkedin_recontact_allowed" != "false" ] || [ "$linkedin_recontact_reason" != "recently-contacted" ]; then
  echo "LinkedIn did not honor the email contact window: $linkedin_recontact_result" >&2
  failures=$((failures + 1))
fi

linkedin_cap_result="$(psql_external -qAtc \
  "set lock_timeout = '5s'; set statement_timeout = '15s'; select aria_cap_test.claim_linkedin('ca000000-0000-4000-8000-000000000006');")"
linkedin_cap_allowed="$(json_field "$linkedin_cap_result" '.allowed')"
linkedin_cap_reason="$(json_field "$linkedin_cap_result" '.reason')"
if [ "$linkedin_cap_allowed" != "false" ] || [ "$linkedin_cap_reason" != "seat-daily-cap-reached" ]; then
  echo "LinkedIn did not honor the email-consumed seat cap: $linkedin_cap_result" >&2
  failures=$((failures + 1))
fi

privileges="$(psql_external -qAtc "
  select
    has_function_privilege('authenticated', 'public.claim_and_record(text,text,text,uuid,text,integer)', 'EXECUTE')::text || '|' ||
    has_function_privilege('service_role', 'public.claim_and_record(text,text,text,uuid,text,integer)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'public.claim_whatsapp_outbound(uuid)', 'EXECUTE')::text || '|' ||
    has_function_privilege('service_role', 'public.claim_whatsapp_outbound(uuid)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'public.claim_linkedin_outbound_queued(uuid)', 'EXECUTE')::text || '|' ||
    has_function_privilege('service_role', 'public.claim_linkedin_outbound_queued(uuid)', 'EXECUTE')::text
")"
if [ "$privileges" != "false|true|false|true|false|true" ]; then
  echo "claim RPC privilege boundary changed: $privileges" >&2
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  exit 1
fi

printf 'RESULT cross-channel-cap-postgres: concurrent_claims=1 active_claims=1 ambiguous=blocked linkedin=blocked deadlock=none privileges=service-only\n'
