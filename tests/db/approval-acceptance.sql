-- One Postgres case per remaining acceptance item. Synthetic rows only.
-- The claim call is dynamic so this file fails on the 0011 function and
-- passes once 0013 replaces it.

create schema if not exists aria_accept;

create table if not exists aria_accept.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create or replace function aria_accept.expect(p_case text, p_passed boolean, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, aria_accept
as $$
begin
  insert into aria_accept.results(case_name, passed, detail)
  values (p_case, p_passed, p_detail)
  on conflict (case_name) do update
    set passed = excluded.passed, detail = excluded.detail;
end;
$$;

create or replace function aria_accept.set_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

create or replace function aria_accept.claim(
  p_message_id text,
  p_body_hash text,
  p_scope text,
  p_candidate_id text,
  p_email text,
  p_campaign text,
  p_seat uuid,
  p_subject text,
  p_body text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result json;
begin
  begin
    execute $sql$
      select public.claim_email_outbound($1,$2,$3,$4,$5,$6,$7,$8,$9)
    $sql$
      into result
      using p_message_id, p_body_hash, p_scope, p_candidate_id, p_email, p_campaign, p_seat, p_subject, p_body;
    return result;
  exception when undefined_function then
    execute $sql$
      select public.claim_email_outbound($1,$2,$3,$4,$5,$6,$7)
    $sql$
      into result
      using p_message_id, p_body_hash, p_scope, p_candidate_id, p_email, p_campaign, p_seat;
    return result;
  end;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'aa000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'aria-accept@example.test', '', now(),
  '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, allowed_domain) values
  ('aa000000-0000-4000-8000-000000000001', 'Aria Accept', 'accept.example.test');

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('aa000000-0000-4000-8000-000000000002', 'aria-accept@example.test', 'Aria Accept',
   'aa000000-0000-4000-8000-000000000001', 'admin');

insert into public.agent_seats(
  id, workspace_id, name, operator_email, provider, status, mode,
  domain_verified, daily_limit, warmup
) values (
  'aa000000-0000-4000-8000-000000000003',
  'aa000000-0000-4000-8000-000000000001',
  'Accept Seat', 'recruiter@accept.example.test', 'resend', 'active', 'live',
  true, 50, false
);

insert into public.outreach_approvals(
  workspace_id, message_id, body_hash, exact_body_hash, approval_scope_hash,
  approved_by, approved_at, approval_source
) values (
  'aa000000-0000-4000-8000-000000000001',
  'accept-wrong-email',
  public.outreach_wire_body_hash('Hello', 'A short note about the example role.'),
  public.exact_outreach_body_hash(
    'Email', 'ada@example.test', 'Hello', 'A short note about the example role.',
    'outreach-v1', 'aa000000-0000-4000-8000-000000000002', now()
  ),
  encode(digest('candidate-wrong' || E'\n' || 'Email' || E'\n' || 'ada@example.test', 'sha256'), 'hex'),
  'aa000000-0000-4000-8000-000000000002', now(), 'human'
), (
  'aa000000-0000-4000-8000-000000000001',
  'accept-ok',
  public.outreach_wire_body_hash('Hello', 'A short note about the example role.'),
  public.exact_outreach_body_hash(
    'Email', 'ada@example.test', 'Hello', 'A short note about the example role.',
    'outreach-v1', 'aa000000-0000-4000-8000-000000000002', timestamptz '2026-11-20 12:00:00+00'
  ),
  encode(digest('candidate-ok' || E'\n' || 'Email' || E'\n' || 'ada@example.test', 'sha256'), 'hex'),
  'aa000000-0000-4000-8000-000000000002', timestamptz '2026-11-20 12:00:00+00', 'human'
);

-- The exact hash above for accept-wrong-email used now(), so it will not match a
-- later recompute. Store the hash of the row's own approved_at.
update public.outreach_approvals
set exact_body_hash = public.exact_outreach_body_hash(
  'Email', 'ada@example.test', 'Hello', 'A short note about the example role.',
  'outreach-v1', approved_by::text, approved_at
)
where message_id in ('accept-wrong-email', 'accept-ok');

select aria_accept.set_claims('aa000000-0000-4000-8000-000000000002');

-- 1. A different candidate email fails even when the caller echoes the stored scope hash.
do $$
declare
  result json;
  scope text;
  wire text;
begin
  select approval_scope_hash, body_hash into scope, wire
  from public.outreach_approvals where message_id = 'accept-wrong-email';
  result := aria_accept.claim(
    'accept-wrong-email', wire, scope,
    'candidate-wrong', 'other-person@example.test', 'accept-campaign',
    'aa000000-0000-4000-8000-000000000003',
    'Hello', 'A short note about the example role.'
  );
  perform aria_accept.expect(
    '1-different-candidate-email-refused',
    coalesce(result->>'allowed', 'false') = 'false',
    result::text
  );
end $$;

-- 1b. The wire digest is compared to the stored wire column, not the caller's echo.
do $$
declare
  result json;
  scope text;
  wire text;
begin
  select approval_scope_hash, body_hash into scope, wire
  from public.outreach_approvals where message_id = 'accept-ok';
  result := aria_accept.claim(
    'accept-ok', wire, scope,
    'candidate-ok', 'ada@example.test', 'accept-campaign',
    'aa000000-0000-4000-8000-000000000003',
    'Hello', 'A different body than the approved note.'
  );
  perform aria_accept.expect(
    '1-wire-digest-must-match-column',
    coalesce(result->>'allowed', 'false') = 'false',
    result::text
  );
end $$;

-- 2. Both hash columns are 64 lowercase hex.
do $$
declare
  caught text;
begin
  begin
    insert into public.outreach_approvals (
      workspace_id, message_id, body_hash, exact_body_hash, approval_scope_hash,
      approved_by, approved_at, approval_source
    ) values (
      'aa000000-0000-4000-8000-000000000001',
      'accept-bad-digest',
      'not-a-digest',
      'ALSO-NOT-HEX',
      repeat('d', 64),
      'aa000000-0000-4000-8000-000000000002',
      now(),
      'human'
    );
    caught := 'inserted';
  exception when check_violation then
    caught := 'check';
  end;
  perform aria_accept.expect('2-hash-columns-are-64-lowercase-hex', caught = 'check', caught);
end $$;

-- 3. The refused claims above did not take a slot. A matching claim does.
do $$
declare
  used integer;
  result json;
  scope text;
  wire text;
begin
  select sent_count into used
  from public.outreach_channel_daily_sends
  where workspace_id = 'aa000000-0000-4000-8000-000000000001'
    and channel = 'Email'
    and send_day = (now() at time zone 'utc')::date;
  perform aria_accept.expect(
    '3-refusal-does-not-consume',
    coalesce(used, 0) = 0,
    coalesce(used::text, 'missing')
  );

  select approval_scope_hash, body_hash into scope, wire
  from public.outreach_approvals where message_id = 'accept-ok';
  result := aria_accept.claim(
    'accept-ok', wire, scope,
    'candidate-ok', 'ada@example.test', 'accept-campaign',
    'aa000000-0000-4000-8000-000000000003',
    'Hello', 'A short note about the example role.'
  );
  select sent_count into used
  from public.outreach_channel_daily_sends
  where workspace_id = 'aa000000-0000-4000-8000-000000000001'
    and channel = 'Email'
    and send_day = (now() at time zone 'utc')::date;
  perform aria_accept.expect(
    '3-accepted-claim-consumes-server-cap',
    coalesce(result->>'allowed', 'false') = 'true' and coalesce(used, 0) = 1,
    format('claim=%s count=%s', result::text, coalesce(used::text, 'missing'))
  );
end $$;

-- 4. authenticated cannot execute the cap function. The claim wrapper stays the member path.
do $$
declare
  cap_exec boolean;
  claim_exec boolean;
begin
  cap_exec := has_function_privilege(
    'authenticated',
    'public.consume_outreach_channel_daily_cap(uuid,text)',
    'execute'
  );
  if to_regprocedure('public.claim_email_outbound(text,text,text,text,text,text,uuid,text,text)') is not null then
    claim_exec := has_function_privilege(
      'authenticated',
      'public.claim_email_outbound(text,text,text,text,text,text,uuid,text,text)',
      'execute'
    );
  elsif to_regprocedure('public.claim_email_outbound(text,text,text,text,text,text,uuid)') is not null then
    claim_exec := has_function_privilege(
      'authenticated',
      'public.claim_email_outbound(text,text,text,text,text,text,uuid)',
      'execute'
    );
  else
    claim_exec := false;
  end if;
  perform aria_accept.expect(
    '4-authenticated-cannot-execute-cap',
    cap_exec = false and claim_exec = true,
    format('cap=%s claim=%s', cap_exec, claim_exec)
  );
end $$;

-- 5. A member cannot update or delete the ledger, so the dedupe index cannot be cleared.
insert into public.outreach_ledger (
  workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status
) values (
  'aa000000-0000-4000-8000-000000000001',
  'candidate-dodge', 'ada@example.test',
  'aa000000-0000-4000-8000-000000000003',
  'accept-campaign', 'Email', 'claimed'
);

do $$
declare
  caught text;
  second_inserted boolean := false;
begin
  begin
    execute 'set local role authenticated';
    update public.outreach_ledger
      set status = 'skipped'
      where candidate_id = 'candidate-dodge';
    caught := 'updated';
    execute 'reset role';
  exception when insufficient_privilege then
    caught := 'denied';
    execute 'reset role';
  end;
  perform aria_accept.expect('5-member-cannot-update-ledger', caught = 'denied', caught);

  begin
    execute 'set local role authenticated';
    delete from public.outreach_ledger where candidate_id = 'candidate-dodge';
    caught := 'deleted';
    execute 'reset role';
  exception when insufficient_privilege then
    caught := 'denied';
    execute 'reset role';
  end;
  perform aria_accept.expect('5-member-cannot-delete-ledger', caught = 'denied', caught);

  begin
    insert into public.outreach_ledger (
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status
    ) values (
      'aa000000-0000-4000-8000-000000000001',
      'candidate-dodge', 'ada@example.test',
      'aa000000-0000-4000-8000-000000000003',
      'accept-campaign', 'Email', 'claimed'
    );
    second_inserted := true;
  exception when unique_violation then
    second_inserted := false;
  end;
  perform aria_accept.expect('5-dedupe-index-still-blocks-a-second-active-row', second_inserted = false, second_inserted::text);
end $$;

-- 6. The claim function recomputes the exact digest and applies the cap before it returns.
do $$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_email_outbound'
  order by p.pronargs desc
  limit 1;
  perform aria_accept.expect(
    '6-claim-recomputes-exact-and-consumes-in-one-function',
    position('exact_outreach_body_hash' in body) > 0
      and (position('apply_channel_daily_cap' in body) > 0 or position('consume_outreach_channel_daily_cap' in body) > 0)
      and position('exact_body_hash is null' in body) = 0,
    left(body, 240)
  );
end $$;

do $$
declare
  failures text;
begin
  select string_agg(format('%s (%s)', case_name, coalesce(detail, '')), ' | ' order by case_name)
    into failures
  from aria_accept.results
  where passed = false;
  if failures is not null then
    raise exception 'acceptance failures: %', failures;
  end if;
end $$;
