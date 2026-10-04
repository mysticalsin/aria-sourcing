\set ON_ERROR_STOP on

-- This file is executed twice by tests/apollo-enrichment-db.sh.
-- base=1 establishes and verifies sequential behavior, then leaves a
-- deterministic concurrency fixture. final=1 verifies the two-session race.

\if :base

create schema aria_apollo_test;
revoke all on schema aria_apollo_test from public;
grant usage on schema aria_apollo_test to service_role;

create function aria_apollo_test.set_claims(jwt_role text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', jwt_role)::text,
    false
  );
  perform set_config('request.jwt.claim.role', jwt_role, false);
end;
$$;

create function aria_apollo_test.assert_scalar(
  case_name text,
  statement text,
  expected text
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;

create function aria_apollo_test.assert_sqlstate(
  case_name text,
  statement text,
  expected_codes text[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  caught text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    if caught = any(expected_codes) then
      return;
    end if;
    raise exception 'Case "%" returned SQLSTATE %, expected %',
      case_name, caught, expected_codes;
  end;
  raise exception 'Case "%" unexpectedly succeeded', case_name;
end;
$$;

revoke all on all functions in schema aria_apollo_test from public;
grant execute on function aria_apollo_test.assert_sqlstate(text, text, text[])
  to service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'b1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apollo-a@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apollo-b@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'b3000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apollo-peer@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'b4000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apollo-admin-b@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.workspaces (id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'Apollo Workspace A'),
  ('a2000000-0000-4000-8000-000000000002', 'Apollo Workspace B');

insert into public.profiles (id, workspace_id, role) values
  (
    'b1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'admin'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000002',
    'admin'
  ),
  (
    'b3000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001',
    'member'
  ),
  (
    'b4000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000001',
    'admin'
  );

-- PostgreSQL ACLs are the first boundary. The function bodies independently
-- validate the JWT role as a defense-in-depth boundary below.
select aria_apollo_test.assert_scalar(
  'only service_role can execute Apollo authority RPCs',
  $$select count(*)::text
      from (values
        ('public.register_apollo_enrichment_targets(uuid,uuid,text,jsonb)'),
        ('public.select_apollo_enrichment_target(uuid,uuid,text,uuid,uuid)'),
        ('public.prepare_apollo_enrichment(uuid,uuid,text,uuid,uuid,text)'),
        ('public.claim_apollo_enrichment(uuid,uuid,text,uuid,uuid,text,uuid,uuid,text)'),
        ('public.complete_apollo_enrichment(uuid,uuid,uuid,uuid,boolean,text,text)'),
        ('public.mark_apollo_enrichment_ambiguous(uuid,uuid,uuid,uuid)'),
        ('public.list_apollo_enrichment_reconciliation(uuid,uuid,timestamptz,uuid,integer)'),
        ('public.reconcile_apollo_enrichment(uuid,uuid,uuid,bigint,text,text,text,text,text)'),
        ('public.erase_apollo_enrichment_target(uuid,uuid,text,uuid,uuid,text,text)'),
        ('public.cleanup_apollo_enrichment_authority(uuid,integer)')
      ) as rpc(signature)
     where has_function_privilege('service_role', signature, 'EXECUTE')
       and not has_function_privilege('authenticated', signature, 'EXECUTE')
       and not has_function_privilege('anon', signature, 'EXECUTE')$$,
  '10'
);

select aria_apollo_test.assert_scalar(
  'service_role has no direct authority-table privileges',
  $$select count(*)::text
      from (values
        ('apollo_enrichment_targets'),
        ('apollo_enrichment_confirmations'),
        ('apollo_enrichment_attempts'),
        ('apollo_enrichment_quota'),
        ('apollo_enrichment_reconciliation_events'),
        ('apollo_enrichment_erasure_events')
      ) as authority(table_name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as operation(privilege_name)
     where has_table_privilege(
       'service_role',
       format('public.%I', authority.table_name),
       operation.privilege_name
     )$$,
  '0'
);

-- A caller that owns the functions still cannot bypass the JWT-role guard.
select aria_apollo_test.set_claims('authenticated');
select aria_apollo_test.assert_sqlstate(
  'registration rejects a non-service JWT role',
  $$select * from public.register_apollo_enrichment_targets(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001', 'campaign-a', '[]'::jsonb)$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'prepare rejects a non-service JWT role',
  $$select public.prepare_apollo_enrichment(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'campaign-a',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001', 'email')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'claim rejects a non-service JWT role',
  $$select public.claim_apollo_enrichment(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'campaign-a',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001', 'email',
    'd1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001', 'request-non-service')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'selection rejects a non-service JWT role',
  $$select public.select_apollo_enrichment_target(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001', 'campaign-a',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'completion rejects a non-service JWT role',
  $$select public.complete_apollo_enrichment(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001', true, '', '')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'ambiguity marking rejects a non-service JWT role',
  $$select public.mark_apollo_enrichment_ambiguous(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'reconciliation listing rejects a non-service JWT role',
  $$select * from public.list_apollo_enrichment_reconciliation(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001', null, null, 20)$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'reconciliation mutation rejects a non-service JWT role',
  $$select public.reconcile_apollo_enrichment(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001', 1,
    'quarantine_stale', '', 'case-1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'request-non-service')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'target erasure rejects a non-service JWT role',
  $$select public.erase_apollo_enrichment_target(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'campaign-a',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'privacy-case-1', 'request-non-service')$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'authority cleanup rejects a non-service JWT role',
  $$select public.cleanup_apollo_enrichment_authority(
    'a1000000-0000-4000-8000-000000000001', 50)$$,
  array['42501']
);

select aria_apollo_test.set_claims('service_role');

-- Compatibility wrappers keep the established sequential scenarios concise.
-- They exist only in this disposable database and delegate to the production
-- campaign/candidate-bound RPCs after the creator selects the exact target.
create function public.register_apollo_enrichment_targets(
  p_workspace_id uuid, p_user_id uuid, p_profiles jsonb
)
returns table (target_id uuid, provider_external_id text)
language sql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select registered.target_id, registered.provider_external_id
  from public.register_apollo_enrichment_targets(
    p_workspace_id, p_user_id, 'campaign-a', p_profiles
  ) as registered;
$$;

create function public.prepare_apollo_enrichment(
  p_workspace_id uuid, p_user_id uuid, p_target_id uuid, p_scope text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  target public.apollo_enrichment_targets%rowtype;
begin
  select * into target from public.apollo_enrichment_targets
   where id = p_target_id and workspace_id = p_workspace_id;
  insert into public.workspace_state (workspace_id, state)
  values (
    p_workspace_id,
    jsonb_build_object(
      'candidates',
      jsonb_build_array(jsonb_build_object(
        'id', target.candidate_id,
        'campaignId', target.campaign_id,
        'sourcePlatform', 'Apollo',
        'sourceAuthorityId', target.id,
        'complianceFlags', jsonb_build_object('anonymized', false)
      ))
    )
  )
  on conflict (workspace_id) do update
  set state = jsonb_set(
    coalesce(public.workspace_state.state, '{}'::jsonb),
    '{candidates}',
    coalesce(public.workspace_state.state -> 'candidates', '[]'::jsonb)
      || (excluded.state -> 'candidates'),
    true
  );
  perform public.select_apollo_enrichment_target(
    p_workspace_id, p_user_id, target.campaign_id, target.id, target.candidate_id
  );
  return public.prepare_apollo_enrichment(
    p_workspace_id, p_user_id, target.campaign_id, target.candidate_id,
    target.id, p_scope
  );
end;
$$;

create function public.claim_apollo_enrichment(
  p_workspace_id uuid, p_user_id uuid, p_target_id uuid, p_scope text,
  p_confirmation_nonce uuid, p_idempotency_key uuid, p_request_id text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  target public.apollo_enrichment_targets%rowtype;
begin
  select * into target from public.apollo_enrichment_targets
   where id = p_target_id and workspace_id = p_workspace_id;
  return public.claim_apollo_enrichment(
    p_workspace_id, p_user_id, target.campaign_id, target.candidate_id,
    target.id, p_scope, p_confirmation_nonce, p_idempotency_key, p_request_id
  );
end;
$$;

revoke all on function public.register_apollo_enrichment_targets(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_apollo_enrichment(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_apollo_enrichment(uuid,uuid,uuid,text,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_apollo_enrichment_targets(uuid,uuid,jsonb) to service_role;
grant execute on function public.prepare_apollo_enrichment(uuid,uuid,uuid,text) to service_role;
grant execute on function public.claim_apollo_enrichment(uuid,uuid,uuid,text,uuid,uuid,text) to service_role;

do $$
declare
  v_workspace_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_other_workspace_id constant uuid := 'a2000000-0000-4000-8000-000000000002';
  v_user_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
  v_peer_id constant uuid := 'b3000000-0000-4000-8000-000000000003';
  target_id uuid;
  candidate_id uuid;
  result jsonb;
  nonce uuid;
  attempt_id uuid;
begin
  select registered.target_id, registered.candidate_id
    into target_id, candidate_id
  from public.register_apollo_enrichment_targets(
    v_workspace_id,
    v_user_id,
    'campaign-binding',
    '[{"providerExternalId":"apollo-binding","profile":{"firstName":"Bound"}}]'::jsonb
  ) as registered;
  if target_id is null or candidate_id is null then
    raise exception 'registration did not generate exact target and candidate ids';
  end if;

  result := public.select_apollo_enrichment_target(
    v_workspace_id, v_user_id, 'campaign-binding', target_id, candidate_id
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'candidate absent from durable workspace state was selected: %', result;
  end if;

  insert into public.workspace_state (workspace_id, state)
  values (
    v_workspace_id,
    jsonb_build_object(
      'candidates',
      jsonb_build_array(jsonb_build_object(
        'id', candidate_id,
        'campaignId', 'campaign-binding',
        'sourcePlatform', 'Apollo',
        'sourceAuthorityId', target_id,
        'complianceFlags', jsonb_build_object('anonymized', false)
      ))
    )
  )
  on conflict (workspace_id) do update set state = excluded.state;

  update public.workspace_state
  set state = jsonb_set(
    state,
    '{candidates,0,sourceAuthorityId}',
    to_jsonb(gen_random_uuid()::text),
    false
  )
  where workspace_id = v_workspace_id;
  result := public.select_apollo_enrichment_target(
    v_workspace_id, v_user_id, 'campaign-binding', target_id, candidate_id
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'mismatched persisted authority selected a target: %', result;
  end if;
  update public.workspace_state
  set state = jsonb_set(
    state,
    '{candidates,0,sourceAuthorityId}',
    to_jsonb(target_id::text),
    false
  )
  where workspace_id = v_workspace_id;

  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, 'campaign-binding', candidate_id, target_id, 'email'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'unselected target became preparable: %', result;
  end if;
  result := public.select_apollo_enrichment_target(
    v_workspace_id, v_user_id, 'campaign-wrong', target_id, candidate_id
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong campaign selected a target: %', result;
  end if;
  result := public.select_apollo_enrichment_target(
    v_workspace_id, v_user_id, 'campaign-binding', target_id, gen_random_uuid()
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong candidate selected a target: %', result;
  end if;
  result := public.select_apollo_enrichment_target(
    v_other_workspace_id, v_peer_id, 'campaign-binding', target_id, candidate_id
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'cross-tenant teammate selected a target: %', result;
  end if;
  result := public.select_apollo_enrichment_target(
    v_workspace_id, v_peer_id, 'campaign-binding', target_id, candidate_id
  );
  if result ->> 'status' <> 'selected' then
    raise exception 'same-workspace teammate selection failed: %', result;
  end if;

  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', gen_random_uuid(), target_id, 'email'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong candidate prepared a selected target: %', result;
  end if;
  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-wrong', candidate_id, target_id, 'email'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong campaign prepared a selected target: %', result;
  end if;
  result := public.prepare_apollo_enrichment(
    v_other_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id, 'email'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'cross-tenant teammate prepared a selected target: %', result;
  end if;
  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id, 'email'
  );
  if result ->> 'status' <> 'prepared' then
    raise exception 'same-workspace teammate binding did not prepare: %', result;
  end if;
  nonce := (result ->> 'confirmation_nonce')::uuid;

  result := public.claim_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-wrong', candidate_id, target_id,
    'email', nonce, 'eb000000-0000-4000-8000-000000000009', 'request-binding-wrong-campaign'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong campaign claimed a selected target: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', gen_random_uuid(), target_id,
    'email', nonce, 'eb000000-0000-4000-8000-000000000009', 'request-binding-wrong-candidate'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong candidate claimed a selected target: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_other_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id,
    'email', nonce, 'eb000000-0000-4000-8000-000000000009', 'request-binding-cross-tenant'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'cross-tenant teammate claimed a selected target: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id,
    'email', nonce, 'eb000000-0000-4000-8000-000000000009', 'request-binding-exact'
  );
  if result ->> 'status' <> 'claimed'
     or result ->> 'provider_external_id' <> 'apollo-binding' then
    raise exception 'same-workspace teammate binding did not claim: %', result;
  end if;
  attempt_id := (result ->> 'attempt_id')::uuid;
  result := public.complete_apollo_enrichment(
    v_workspace_id, v_peer_id, target_id, attempt_id, false, '', ''
  );
  if result ->> 'ok' <> 'true' then
    raise exception 'binding fixture could not close its attempt: %', result;
  end if;

  update public.workspace_state
  set state = jsonb_set(
    state,
    '{candidates,0,complianceFlags,anonymized}',
    'true'::jsonb,
    false
  )
  where workspace_id = v_workspace_id;
  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id, 'email'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'anonymized persisted candidate retained paid authority: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_peer_id, 'campaign-binding', candidate_id, target_id,
    'email', gen_random_uuid(), 'eb000000-0000-4000-8000-000000000009',
    'request-binding-after-anonymize'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'anonymized persisted candidate retained claim authority: %', result;
  end if;
end;
$$;

-- Registration exercises digest() through the function's declared search_path.
select aria_apollo_test.assert_scalar(
  'registration binds targets to the authenticated tenant',
  $$select count(*)::text
      from public.register_apollo_enrichment_targets(
        'a1000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001',
        '[
          {"providerExternalId":"apollo-happy","profile":{"firstName":"Ada"}},
          {"providerExternalId":"apollo-ambiguous","profile":{"firstName":"Grace"}},
          {"providerExternalId":"apollo-user-quota","profile":{"firstName":"Katherine"}},
          {"providerExternalId":"apollo-workspace-quota","profile":{"firstName":"Margaret"}},
          {"providerExternalId":"apollo-concurrent","profile":{"firstName":"Evelyn"}}
        ]'::jsonb
      )$$,
  '5'
);
select aria_apollo_test.assert_scalar(
  'pgcrypto digest resolves under the RPC search_path',
  $$select (
      profile_hash = encode(
        extensions.digest('{"firstName": "Ada"}'::jsonb::text, 'sha256'),
        'hex'
      )
    )::text
    from public.apollo_enrichment_targets
    where provider_external_id = 'apollo-happy'$$,
  'true'
);
select aria_apollo_test.assert_sqlstate(
  'registration rejects a user from another tenant',
  $$select * from public.register_apollo_enrichment_targets(
    'a1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    '[{"providerExternalId":"cross-tenant","profile":{}}]'::jsonb)$$,
  array['P0001']
);
select aria_apollo_test.assert_scalar(
  'cross-tenant registration persists no target',
  $$select count(*)::text from public.apollo_enrichment_targets
     where provider_external_id='cross-tenant'$$,
  '0'
);

do $$
declare
  v_workspace_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_user_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
  v_peer_id constant uuid := 'b3000000-0000-4000-8000-000000000003';
  happy_target uuid;
  ambiguous_target uuid;
  user_quota_target uuid;
  workspace_quota_target uuid;
  prepared jsonb;
  claimed jsonb;
  completed jsonb;
  v_nonce uuid;
  fresh_nonce uuid;
  attempt_id uuid;
  ambiguous_nonce uuid;
  ambiguous_attempt uuid;
  quota_nonce uuid;
begin
  select id into happy_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-happy';
  select id into ambiguous_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-ambiguous';
  select id into user_quota_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-user-quota';
  select id into workspace_quota_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-workspace-quota';

  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email'
  );
  if prepared ->> 'status' <> 'prepared' then
    raise exception 'prepare did not return prepared: %', prepared;
  end if;
  v_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  if not exists (
    select 1 from public.apollo_enrichment_confirmations
    where apollo_enrichment_confirmations.nonce = v_nonce
      and target_id = happy_target
      and workspace_id = v_workspace_id
      and user_id = v_user_id
      and scope = 'email'
      and consumed_at is null
      and expires_at > now()
      and expires_at <= now() + interval '5 minutes'
  ) then
    raise exception 'prepare did not persist an exact short-lived nonce';
  end if;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_peer_id, happy_target, 'email', v_nonce,
    'e3000000-0000-4000-8000-000000000003', 'request-peer-binding'
  );
  if claimed ->> 'status' <> 'nonce_invalid' then
    raise exception 'nonce was not bound to its user: %', claimed;
  end if;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', v_nonce,
    'e1000000-0000-4000-8000-000000000001', 'request-happy-claim'
  );
  if claimed ->> 'status' <> 'claimed'
     or claimed ->> 'provider_external_id' <> 'apollo-happy' then
    raise exception 'first claim did not reveal the exact provider target: %', claimed;
  end if;
  attempt_id := (claimed ->> 'attempt_id')::uuid;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', v_nonce,
    'e2000000-0000-4000-8000-000000000002', 'request-consumed-replay'
  );
  if claimed ->> 'status' <> 'nonce_invalid' then
    raise exception 'consumed nonce replay was admitted: %', claimed;
  end if;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', gen_random_uuid(),
    'e1000000-0000-4000-8000-000000000001', 'request-idempotent-progress'
  );
  if claimed ->> 'status' <> 'in_progress' then
    raise exception 'same idempotency key did not replay in_progress: %', claimed;
  end if;

  completed := public.complete_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, attempt_id, true,
    'enc:v2:apollo-happy-email', ''
  );
  if completed ->> 'ok' <> 'true' then
    raise exception 'completion failed: %', completed;
  end if;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', gen_random_uuid(),
    'e1000000-0000-4000-8000-000000000001', 'request-idempotent-complete'
  );
  if claimed ->> 'status' <> 'completed'
     or claimed ->> 'email_secret' <> 'enc:v2:apollo-happy-email'
     or claimed ->> 'phone_secret' <> '' then
    raise exception 'terminal idempotency replay changed its receipt: %', claimed;
  end if;

  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', v_nonce,
    'e2000000-0000-4000-8000-000000000002', 'request-new-key-old-nonce'
  );
  if claimed ->> 'status' <> 'nonce_invalid' then
    raise exception 'new idempotency key reused a consumed nonce: %', claimed;
  end if;

  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email'
  );
  fresh_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, happy_target, 'email', fresh_nonce,
    'e2000000-0000-4000-8000-000000000002', 'request-cached-fresh-nonce'
  );
  if claimed ->> 'status' <> 'completed'
     or claimed ->> 'email_secret' <> 'enc:v2:apollo-happy-email'
     or claimed ->> 'phone_secret' <> '' then
    raise exception 'fresh nonce did not reveal the cached receipt: %', claimed;
  end if;
  if (select consumed_at is null from public.apollo_enrichment_confirmations
      where apollo_enrichment_confirmations.nonce = fresh_nonce) then
    raise exception 'fresh cached-reveal nonce was not consumed';
  end if;
  if (select used from public.apollo_enrichment_quota
      where apollo_enrichment_quota.workspace_id = v_workspace_id
        and bucket_date = current_date and scope_key = 'workspace') <> 2 then
    raise exception 'cached reveal consumed a second workspace credit';
  end if;

  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, ambiguous_target, 'email'
  );
  ambiguous_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, ambiguous_target, 'email', ambiguous_nonce,
    'e4000000-0000-4000-8000-000000000004', 'request-ambiguous-claim'
  );
  ambiguous_attempt := (claimed ->> 'attempt_id')::uuid;
  if claimed ->> 'status' <> 'claimed' then
    raise exception 'ambiguous fixture was not claimed: %', claimed;
  end if;
  completed := public.mark_apollo_enrichment_ambiguous(
    v_workspace_id, v_user_id, ambiguous_target, ambiguous_attempt
  );
  if completed ->> 'ok' <> 'true' then
    raise exception 'ambiguity receipt was not persisted: %', completed;
  end if;
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, ambiguous_target, 'email', gen_random_uuid(),
    'e4000000-0000-4000-8000-000000000004', 'request-ambiguous-replay'
  );
  if claimed ->> 'status' <> 'ambiguous' then
    raise exception 'same-key ambiguous retry was not blocked: %', claimed;
  end if;
  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, ambiguous_target, 'email'
  );
  fresh_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, ambiguous_target, 'email', fresh_nonce,
    'e5000000-0000-4000-8000-000000000005', 'request-ambiguous-new-key'
  );
  if claimed ->> 'status' <> 'ambiguous' then
    raise exception 'fresh-key ambiguous retry was not blocked: %', claimed;
  end if;
  if (select consumed_at is not null from public.apollo_enrichment_confirmations
      where apollo_enrichment_confirmations.nonce = fresh_nonce) then
    raise exception 'blocked ambiguous retry consumed its confirmation';
  end if;

  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, user_quota_target, 'email'
  );
  quota_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  update public.apollo_enrichment_quota
  set used = 25
  where apollo_enrichment_quota.workspace_id = v_workspace_id
    and bucket_date = current_date
    and scope_key = 'user:' || v_user_id::text;
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, user_quota_target, 'email', quota_nonce,
    'e6000000-0000-4000-8000-000000000006', 'request-user-quota'
  );
  if claimed ->> 'status' <> 'quota_exceeded' then
    raise exception 'per-user quota was not enforced: %', claimed;
  end if;
  if (select consumed_at is not null from public.apollo_enrichment_confirmations
      where apollo_enrichment_confirmations.nonce = quota_nonce) then
    raise exception 'user quota rejection consumed its nonce';
  end if;
  update public.apollo_enrichment_quota
  set used = 2
  where apollo_enrichment_quota.workspace_id = v_workspace_id
    and bucket_date = current_date
    and scope_key = 'user:' || v_user_id::text;

  prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, workspace_quota_target, 'email'
  );
  quota_nonce := (prepared ->> 'confirmation_nonce')::uuid;
  update public.apollo_enrichment_quota
  set used = 100
  where apollo_enrichment_quota.workspace_id = v_workspace_id
    and bucket_date = current_date
    and scope_key = 'workspace';
  claimed := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, workspace_quota_target, 'email', quota_nonce,
    'e7000000-0000-4000-8000-000000000007', 'request-workspace-quota'
  );
  if claimed ->> 'status' <> 'quota_exceeded' then
    raise exception 'workspace quota was not enforced: %', claimed;
  end if;
  if exists (
    select 1 from public.apollo_enrichment_attempts
    where idempotency_key in (
      'e6000000-0000-4000-8000-000000000006',
      'e7000000-0000-4000-8000-000000000007'
    )
  ) then
    raise exception 'quota rejection persisted a provider attempt';
  end if;
  update public.apollo_enrichment_quota
  set used = 2
  where apollo_enrichment_quota.workspace_id = v_workspace_id
    and bucket_date = current_date
    and scope_key = 'workspace';
end;
$$;

-- Privacy retention, explicit erasure, confirmation reuse, and bounded
-- maintenance are real database behaviors, not application-only conventions.
do $$
declare
  v_workspace_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_other_workspace_id constant uuid := 'a2000000-0000-4000-8000-000000000002';
  v_admin_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
  v_other_admin_id constant uuid := 'b2000000-0000-4000-8000-000000000002';
  singleton_target uuid;
  retention_target uuid;
  erasure_target uuid;
  erasure_candidate uuid;
  cleanup_receipt_target uuid;
  cleanup_receipt_candidate uuid;
  replacement_receipt_target uuid;
  cleanup_orphan_target uuid;
  cleanup_orphan_candidate uuid;
  first_prepared jsonb;
  second_prepared jsonb;
  rotated_prepared jsonb;
  result jsonb;
  erasure_result jsonb;
  attempt_id uuid;
  ledger_count integer;
begin
  perform * from public.register_apollo_enrichment_targets(
    v_workspace_id,
    v_admin_id,
    '[
      {"providerExternalId":"apollo-singleton","profile":{"firstName":"Single"}},
      {"providerExternalId":"apollo-retention","profile":{"firstName":"Retain"}},
      {"providerExternalId":"apollo-erasure","profile":{"firstName":"Erase"}},
      {"providerExternalId":"apollo-cleanup-receipt","profile":{"firstName":"Clean"}},
      {"providerExternalId":"apollo-cleanup-orphan","profile":{"firstName":"Orphan"}}
    ]'::jsonb
  );

  select id into singleton_target from public.apollo_enrichment_targets
   where workspace_id = v_workspace_id and provider_external_id = 'apollo-singleton';
  select id into retention_target from public.apollo_enrichment_targets
   where workspace_id = v_workspace_id and provider_external_id = 'apollo-retention';
  select id, candidate_id into erasure_target, erasure_candidate
    from public.apollo_enrichment_targets
   where workspace_id = v_workspace_id and provider_external_id = 'apollo-erasure';
  select id, candidate_id into cleanup_receipt_target, cleanup_receipt_candidate
    from public.apollo_enrichment_targets
   where workspace_id = v_workspace_id and provider_external_id = 'apollo-cleanup-receipt';
  select id, candidate_id into cleanup_orphan_target, cleanup_orphan_candidate
    from public.apollo_enrichment_targets
   where workspace_id = v_workspace_id and provider_external_id = 'apollo-cleanup-orphan';

  first_prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_admin_id, singleton_target, 'email'
  );
  second_prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_admin_id, singleton_target, 'email'
  );
  if first_prepared ->> 'confirmation_nonce' <> second_prepared ->> 'confirmation_nonce'
     or (select count(*) from public.apollo_enrichment_confirmations
         where workspace_id = v_workspace_id and user_id = v_admin_id
           and target_id = singleton_target and scope = 'email'
           and consumed_at is null) <> 1 then
    raise exception 'prepare did not reuse exactly one live confirmation: %, %',
      first_prepared, second_prepared;
  end if;
  update public.apollo_enrichment_confirmations
     set expires_at = now() - interval '1 second'
   where nonce = (first_prepared ->> 'confirmation_nonce')::uuid;
  rotated_prepared := public.prepare_apollo_enrichment(
    v_workspace_id, v_admin_id, singleton_target, 'email'
  );
  if rotated_prepared ->> 'confirmation_nonce' = first_prepared ->> 'confirmation_nonce'
     or (select count(*) from public.apollo_enrichment_confirmations
         where workspace_id = v_workspace_id and user_id = v_admin_id
           and target_id = singleton_target and scope = 'email'
           and consumed_at is null) <> 1 then
    raise exception 'prepare did not rotate an expired singleton confirmation: %', rotated_prepared;
  end if;

  result := public.prepare_apollo_enrichment(v_workspace_id, v_admin_id, retention_target, 'email');
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_admin_id, retention_target, 'email',
    (result ->> 'confirmation_nonce')::uuid,
    'ea000000-0000-4000-8000-000000000001', 'request-retention-claim'
  );
  attempt_id := (result ->> 'attempt_id')::uuid;
  result := public.complete_apollo_enrichment(
    v_workspace_id, v_admin_id, retention_target, attempt_id,
    true, 'enc:v2:retention-email', ''
  );
  if result ->> 'ok' <> 'true'
     or not exists (
       select 1 from public.apollo_enrichment_attempts
        where id = attempt_id
          and receipt_expires_at > completed_at
          and receipt_expires_at <= completed_at + interval '30 days'
          and receipt_erased_at is null
     ) then
    raise exception 'completed email receipt did not receive a bounded retention deadline';
  end if;
  update public.apollo_enrichment_attempts
     set receipt_expires_at = now() - interval '1 second'
   where id = attempt_id;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_admin_id, retention_target, 'email', gen_random_uuid(),
    'ea000000-0000-4000-8000-000000000001', 'request-retention-replay'
  );
  if result ->> 'status' <> 'not_found'
     or exists (select 1 from public.apollo_enrichment_attempts
                 where id = attempt_id and email_secret <> '')
     or not exists (select 1 from public.apollo_enrichment_attempts
                     where id = attempt_id and receipt_erased_at is not null) then
    raise exception 'expired receipt remained replayable or retained: %', result;
  end if;

  result := public.prepare_apollo_enrichment(v_workspace_id, v_admin_id, erasure_target, 'email');
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_admin_id, erasure_target, 'email',
    (result ->> 'confirmation_nonce')::uuid,
    'ea000000-0000-4000-8000-000000000002', 'request-erasure-claim'
  );
  attempt_id := (result ->> 'attempt_id')::uuid;
  result := public.complete_apollo_enrichment(
    v_workspace_id, v_admin_id, erasure_target, attempt_id,
    true, 'enc:v2:erase-this-email', ''
  );
  select count(*) into ledger_count from public.apollo_enrichment_reconciliation_events;
  result := public.erase_apollo_enrichment_target(
    v_workspace_id, v_admin_id, 'campaign-wrong', erasure_candidate, erasure_target,
    'privacy-case-wrong-campaign', 'request-erasure-wrong-campaign'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong campaign erased a target: %', result;
  end if;
  result := public.erase_apollo_enrichment_target(
    v_workspace_id, v_admin_id, 'campaign-a', gen_random_uuid(), erasure_target,
    'privacy-case-wrong-candidate', 'request-erasure-wrong-candidate'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'wrong candidate erased a target: %', result;
  end if;
  result := public.erase_apollo_enrichment_target(
    v_workspace_id, v_admin_id, 'campaign-a', erasure_candidate, erasure_target,
    'privacy-case-erase', 'request-erasure-explicit'
  );
  erasure_result := result;
  if result ->> 'status' <> 'erased'
     or (result ->> 'cleared_receipts')::integer <> 1
     or exists (select 1 from public.apollo_enrichment_attempts
                 where target_id = erasure_target and email_secret <> '')
     or not exists (select 1 from public.apollo_enrichment_targets
                     where id = erasure_target and erased_at is not null
                       and provider_external_id = 'erased:' || erasure_target::text)
     or (select count(*) from public.apollo_enrichment_reconciliation_events) <> ledger_count
     or (select count(*) from public.apollo_enrichment_erasure_events
         where target_id = erasure_target and request_id = 'request-erasure-explicit') <> 1 then
    raise exception 'explicit target erasure was incomplete: result=%, secrets=%, target=%, ledger_before=%, ledger_after=%, erasure_events=%',
      result,
      (select count(*) from public.apollo_enrichment_attempts where target_id = erasure_target and email_secret <> ''),
      (select jsonb_build_object('erased_at', erased_at, 'provider_external_id', provider_external_id)
         from public.apollo_enrichment_targets where id = erasure_target),
      ledger_count,
      (select count(*) from public.apollo_enrichment_reconciliation_events),
      (select jsonb_build_object(
         'matching', count(*) filter (where target_id = erasure_target and request_id = 'request-erasure-explicit'),
         'total', count(*),
         'rows', coalesce(jsonb_agg(to_jsonb(erasure_event)), '[]'::jsonb)
       ) from public.apollo_enrichment_erasure_events as erasure_event);
  end if;
  result := public.erase_apollo_enrichment_target(
    v_workspace_id, v_admin_id, 'campaign-a', erasure_candidate, erasure_target,
    'privacy-case-erase', 'request-erasure-explicit'
  );
  if result ->> 'status' <> 'erased'
     or result ->> 'event_id' <> erasure_result ->> 'event_id'
     or result ->> 'cleared_receipts' <> erasure_result ->> 'cleared_receipts'
     or result ->> 'cancelled_attempts' <> erasure_result ->> 'cancelled_attempts'
     or result ->> 'cached' <> 'true'
     or (select count(*) from public.apollo_enrichment_erasure_events
         where target_id = erasure_target) <> 1 then
    raise exception 'lost-response erasure retry did not replay the durable receipt: %', result;
  end if;
  result := public.erase_apollo_enrichment_target(
    v_workspace_id, v_admin_id, 'campaign-a', erasure_candidate, erasure_target,
    'privacy-case-erase-again', 'request-erasure-distinct'
  );
  if result ->> 'status' <> 'already_erased'
     or result ->> 'original_event_id' <> erasure_result ->> 'event_id'
     or (select count(*) from public.apollo_enrichment_erasure_events
         where target_id = erasure_target) <> 1 then
    raise exception 'distinct erasure request was not explicit and audit-stable: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_admin_id, erasure_target, 'email', gen_random_uuid(),
    'ea000000-0000-4000-8000-000000000002', 'request-erasure-replay'
  );
  if result ->> 'status' <> 'not_found' then
    raise exception 'erased receipt remained replayable: %', result;
  end if;
  if public.prepare_apollo_enrichment(v_workspace_id, v_admin_id, erasure_target, 'email') ->> 'status' <> 'not_found' then
    raise exception 'erased target remained preparable';
  end if;
  begin
    perform public.erase_apollo_enrichment_target(
      v_workspace_id, v_other_admin_id, 'campaign-a', erasure_candidate, erasure_target,
      'privacy-case-cross-tenant', 'request-erasure-cross-tenant'
    );
    raise exception 'cross-tenant erasure unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.apollo_enrichment_attempts (
    target_id, workspace_id, campaign_id, candidate_id, user_id, scope, idempotency_key, status, found,
    email_secret, request_id, completed_at, receipt_expires_at
  ) values (
    cleanup_receipt_target, v_workspace_id, 'campaign-a', cleanup_receipt_candidate, v_admin_id, 'email',
    'ea000000-0000-4000-8000-000000000003', 'completed', true,
    'enc:v2:cleanup-expired-email', 'request-cleanup-receipt',
    now() - interval '31 days', now() - interval '1 day'
  );
  update public.apollo_enrichment_targets
     set expires_at = now() - interval '1 day'
   where id = cleanup_receipt_target;
  -- An unresolved expired attempt still needs its provider handle for the
  -- existing human reconciliation workflow. Cleanup may scrub only terminal
  -- attempted targets.
  update public.apollo_enrichment_targets
     set expires_at = now() - interval '1 day'
   where workspace_id = v_workspace_id
     and provider_external_id = 'apollo-ambiguous';
  update public.apollo_enrichment_targets
     set expires_at = now() - interval '1 day'
   where id = cleanup_orphan_target;
  insert into public.apollo_enrichment_confirmations (
    target_id, workspace_id, campaign_id, candidate_id, user_id, scope, expires_at
  ) values (
    cleanup_orphan_target, v_workspace_id, 'campaign-a', cleanup_orphan_candidate,
    v_admin_id, 'email', now() - interval '1 day'
  );
  insert into public.apollo_enrichment_quota (workspace_id, bucket_date, scope_key, used)
  values
    (v_workspace_id, current_date - 31, 'old-used', 2),
    (v_workspace_id, current_date - 1, 'old-zero', 0);

  result := public.cleanup_apollo_enrichment_authority(v_workspace_id, 50);
  if result ->> 'status' <> 'cleaned'
     or (result ->> 'expired_receipts_cleared')::integer < 1
     or (result ->> 'confirmations_deleted')::integer < 1
     or (result ->> 'targets_deleted')::integer < 1
     or (result ->> 'expired_targets_scrubbed')::integer <> 1
     or (result ->> 'quota_rows_deleted')::integer <> 2
     or (result ->> 'processed')::integer > 50
     or exists (select 1 from public.apollo_enrichment_attempts
                 where target_id = cleanup_receipt_target and email_secret <> '')
     or not exists (
       select 1
       from public.apollo_enrichment_targets
       where id = cleanup_receipt_target
         and provider_external_id = 'expired:' || cleanup_receipt_target::text
         and profile_hash = repeat('0', 64)
     )
     or not exists (
       select 1
       from public.apollo_enrichment_attempts
       where target_id = cleanup_receipt_target
         and status = 'completed'
     )
     or not exists (
       select 1
       from public.apollo_enrichment_targets
       where workspace_id = v_workspace_id
         and provider_external_id = 'apollo-ambiguous'
     )
     or exists (select 1 from public.apollo_enrichment_targets where id = cleanup_orphan_target)
     or exists (select 1 from public.apollo_enrichment_quota
                 where workspace_id = v_workspace_id and scope_key in ('old-used', 'old-zero')) then
    raise exception 'bounded cleanup did not remove exact expired artifacts: %', result;
  end if;

  select registered.target_id into replacement_receipt_target
  from public.register_apollo_enrichment_targets(
    v_workspace_id,
    v_admin_id,
    '[{"providerExternalId":"apollo-cleanup-receipt","profile":{"firstName":"Fresh"}}]'::jsonb
  ) as registered;
  if replacement_receipt_target is null
     or replacement_receipt_target = cleanup_receipt_target
     or not exists (
       select 1
       from public.apollo_enrichment_targets
       where id = cleanup_receipt_target
         and provider_external_id = 'expired:' || cleanup_receipt_target::text
         and profile_hash = repeat('0', 64)
     ) then
    raise exception 'expired attempted target provider handle was restored instead of irreversibly replaced';
  end if;
  begin
    perform public.cleanup_apollo_enrichment_authority(v_other_workspace_id, 0);
    raise exception 'unbounded cleanup unexpectedly succeeded';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

select aria_apollo_test.assert_scalar(
  'admin reconciliation list returns only unresolved eligible attempts',
  $$select (
      count(*) = 1
      and min(provider_external_id) = 'apollo-ambiguous'
      and min(status) = 'ambiguous'
    )::text
    from public.list_apollo_enrichment_reconciliation(
      'a1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',
      null, null, 20
    )$$,
  'true'
);
select aria_apollo_test.assert_sqlstate(
  'member actor cannot list reconciliation work',
  $$select * from public.list_apollo_enrichment_reconciliation(
    'a1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000003',
    null, null, 20
  )$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'member actor cannot reconcile an ambiguous attempt',
  $$select public.reconcile_apollo_enrichment(
    'a1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000003',
    (select id from public.apollo_enrichment_attempts
      where request_id = 'request-ambiguous-claim'),
    2, 'complete_not_found', '', 'case-member-rejected',
    'abababababababababababababababababababababababababababababababab',
    'request-member-rejected'
  )$$,
  array['42501']
);

do $$
declare
  v_workspace_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_admin_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
  v_user_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
  stale_target uuid;
  release_target uuid;
  v_nonce uuid;
  fresh_nonce uuid;
  attempt_id uuid;
  retry_attempt_id uuid;
  quota_before_release integer;
  result jsonb;
begin
  select id into stale_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-user-quota';
  select id into release_target
  from public.apollo_enrichment_targets t
  where t.workspace_id = v_workspace_id
    and t.provider_external_id = 'apollo-workspace-quota';

  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, stale_target, 'email'
  );
  v_nonce := (result ->> 'confirmation_nonce')::uuid;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, stale_target, 'email', v_nonce,
    'e8000000-0000-4000-8000-000000000008', 'request-stale-reconcile'
  );
  if result ->> 'status' <> 'claimed' then
    raise exception 'stale reconciliation fixture was not claimed: %', result;
  end if;
  attempt_id := (result ->> 'attempt_id')::uuid;

  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 1,
    'quarantine_stale', '', 'case-stale-gate',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'request-stale-gate'
  );
  if result ->> 'status' <> 'not_stale' then
    raise exception 'active lease was not protected from quarantine: %', result;
  end if;
  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 2,
    'quarantine_stale', '', 'case-version-conflict',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'request-version-conflict'
  );
  if result ->> 'status' <> 'conflict' then
    raise exception 'wrong expectedVersion did not conflict: %', result;
  end if;

  update public.apollo_enrichment_attempts
  set lease_expires_at = now() - interval '1 second'
  where id = attempt_id;
  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 1,
    'quarantine_stale', '', 'case-stale-confirmed',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'request-stale-confirmed'
  );
  if result ->> 'status' <> 'reconciled'
     or result ->> 'attempt_status' <> 'ambiguous'
     or result ->> 'version' <> '2' then
    raise exception 'stale attempt was not quarantined atomically: %', result;
  end if;

  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 1,
    'complete_not_found', '', 'case-complete-conflict',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'request-complete-conflict'
  );
  if result ->> 'status' <> 'conflict' then
    raise exception 'stale completion version did not conflict: %', result;
  end if;
  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 2,
    'complete_not_found', '', 'case-complete-not-found',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'request-complete-not-found'
  );
  if result ->> 'status' <> 'reconciled'
     or result ->> 'attempt_status' <> 'completed'
     or result ->> 'version' <> '3' then
    raise exception 'no-match reconciliation did not complete: %', result;
  end if;
  if not exists (
    select 1 from public.apollo_enrichment_attempts a
    where a.id = attempt_id and a.status = 'completed' and a.found is false
      and a.email_secret = '' and a.version = 3
  ) then
    raise exception 'no-match terminal receipt is incoherent';
  end if;

  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email'
  );
  v_nonce := (result ->> 'confirmation_nonce')::uuid;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email', v_nonce,
    'e9000000-0000-4000-8000-000000000009', 'request-release-original'
  );
  if result ->> 'status' <> 'claimed' then
    raise exception 'release fixture was not claimed: %', result;
  end if;
  attempt_id := (result ->> 'attempt_id')::uuid;
  result := public.mark_apollo_enrichment_ambiguous(
    v_workspace_id, v_user_id, release_target, attempt_id
  );
  if result ->> 'ok' <> 'true' then
    raise exception 'release fixture was not marked ambiguous: %', result;
  end if;
  select used into quota_before_release
  from public.apollo_enrichment_quota
  where workspace_id = v_workspace_id
    and bucket_date = current_date
    and scope_key = 'workspace';

  result := public.reconcile_apollo_enrichment(
    v_workspace_id, v_admin_id, attempt_id, 2,
    'release_no_charge', '', 'case-release-no-charge',
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'request-release-no-charge'
  );
  if result ->> 'status' <> 'reconciled'
     or result ->> 'attempt_status' <> 'cancelled'
     or result ->> 'version' <> '3' then
    raise exception 'no-charge release did not cancel the attempt: %', result;
  end if;
  if (select used from public.apollo_enrichment_quota
      where workspace_id = v_workspace_id
        and bucket_date = current_date
        and scope_key = 'workspace') <> quota_before_release then
    raise exception 'no-charge release decremented or incremented quota';
  end if;

  result := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email', v_nonce,
    'ea000000-0000-4000-8000-00000000000a', 'request-release-old-nonce'
  );
  if result ->> 'status' <> 'nonce_invalid' then
    raise exception 'released target accepted a consumed nonce: %', result;
  end if;
  result := public.prepare_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email'
  );
  fresh_nonce := (result ->> 'confirmation_nonce')::uuid;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email', fresh_nonce,
    'e9000000-0000-4000-8000-000000000009', 'request-release-old-key'
  );
  if result ->> 'status' <> 'cancelled' then
    raise exception 'released target accepted the old idempotency key: %', result;
  end if;
  result := public.claim_apollo_enrichment(
    v_workspace_id, v_user_id, release_target, 'email', fresh_nonce,
    'ea000000-0000-4000-8000-00000000000a', 'request-release-retry'
  );
  if result ->> 'status' <> 'claimed' then
    raise exception 'fresh nonce and key did not reopen the released target: %', result;
  end if;
  retry_attempt_id := (result ->> 'attempt_id')::uuid;
  if (select used from public.apollo_enrichment_quota
      where workspace_id = v_workspace_id
        and bucket_date = current_date
        and scope_key = 'workspace') <> quota_before_release + 1 then
    raise exception 'new provider claim did not consume exactly one new credit';
  end if;
  result := public.mark_apollo_enrichment_ambiguous(
    v_workspace_id, v_user_id, release_target, retry_attempt_id
  );
  if result ->> 'ok' <> 'true' then
    raise exception 'reconciliation race fixture was not marked ambiguous: %', result;
  end if;
end;
$$;

create function aria_apollo_test.pause_reconciliation_race()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.request_id = 'request-release-retry'
     and old.status = 'ambiguous'
     and new.status = 'completed' then
    perform pg_sleep(2);
  end if;
  return new;
end;
$$;

create trigger aria_apollo_pause_reconciliation_race
before update on public.apollo_enrichment_attempts
for each row execute function aria_apollo_test.pause_reconciliation_race();

-- Both sessions race the same confirmation. The target lock serializes the
-- winner before the loser can reuse the now-consumed nonce.
select public.prepare_apollo_enrichment(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  id,
  'email'
)
from public.apollo_enrichment_targets
where provider_external_id = 'apollo-concurrent';

create function aria_apollo_test.pause_first_concurrent_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_sleep(2);
  return new;
end;
$$;

create trigger aria_apollo_pause_first_concurrent_claim
before insert on public.apollo_enrichment_attempts
for each row execute function aria_apollo_test.pause_first_concurrent_claim();

select 'RESULT apollo-enrichment-authority-sql: sequential=pass tenant=bound nonce=single-use cached=fresh-nonce quotas=enforced ambiguous=blocked reconciliation=state-gated release=fresh-authority' as result;

\endif

\if :final

select aria_apollo_test.assert_scalar(
  'concurrent same-target claims create one provider attempt',
  $$select count(*)::text
      from public.apollo_enrichment_attempts a
      join public.apollo_enrichment_targets t on t.id = a.target_id
     where t.provider_external_id = 'apollo-concurrent'$$,
  '1'
);
select aria_apollo_test.assert_scalar(
  'concurrent same-target claims consume one provider credit',
  $$select used::text from public.apollo_enrichment_quota
     where workspace_id='a1000000-0000-4000-8000-000000000001'
       and bucket_date=current_date and scope_key='workspace'$$,
  '8'
);
select aria_apollo_test.assert_scalar(
  'concurrent same-target claims consume exactly one nonce',
  $$select count(*)::text
      from public.apollo_enrichment_confirmations c
      join public.apollo_enrichment_targets t on t.id = c.target_id
     where t.provider_external_id='apollo-concurrent'
       and c.consumed_at is not null$$,
  '1'
);
select aria_apollo_test.assert_scalar(
  'losing concurrent idempotency key creates no attempt',
  $$select count(*)::text from public.apollo_enrichment_attempts
     where idempotency_key='f2000000-0000-4000-8000-000000000002'$$,
  '0'
);

select 'RESULT apollo-enrichment-authority-sql: concurrency=serialized attempts=1 credits=1 loser=nonce-invalid' as result;

\endif

\if :owner

select aria_apollo_test.assert_scalar(
  'stale quarantine and no-match completion each write one event',
  $$select (
      count(*) = 2
      and count(*) filter (where event.action = 'quarantine_stale') = 1
      and count(*) filter (where event.action = 'complete_not_found') = 1
    )::text
    from public.apollo_enrichment_reconciliation_events event
    join public.apollo_enrichment_attempts attempt
      on attempt.id = event.attempt_id
    where attempt.request_id = 'request-stale-reconcile'$$,
  'true'
);
select aria_apollo_test.assert_scalar(
  'no-charge release writes exactly one event',
  $$select count(*)::text
    from public.apollo_enrichment_reconciliation_events event
    join public.apollo_enrichment_attempts attempt
      on attempt.id = event.attempt_id
    where attempt.request_id = 'request-release-original'
      and event.action = 'release_no_charge'
      and event.from_status = 'ambiguous'
      and event.to_status = 'cancelled'
      and event.from_version = 2
      and event.to_version = 3$$,
  '1'
);
select aria_apollo_test.assert_scalar(
  'same-version admin race writes one terminal event',
  $$select count(*)::text
    from public.apollo_enrichment_reconciliation_events event
    join public.apollo_enrichment_attempts attempt
      on attempt.id = event.attempt_id
    where attempt.request_id = 'request-release-retry'
      and event.action = 'complete_not_found'
      and event.from_version = 2
      and event.to_version = 3$$,
  '1'
);
select aria_apollo_test.assert_scalar(
  'reconciliation ledger contains only successful transitions',
  $$select count(*)::text from public.apollo_enrichment_reconciliation_events$$,
  '4'
);
select aria_apollo_test.assert_sqlstate(
  'reconciliation events reject updates',
  $$update public.apollo_enrichment_reconciliation_events
       set request_id = request_id
     where action = 'complete_not_found'$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'reconciliation events reject deletes',
  $$delete from public.apollo_enrichment_reconciliation_events
     where action = 'complete_not_found'$$,
  array['42501']
);
select aria_apollo_test.assert_scalar(
  'append-only rejection preserves every event',
  $$select count(*)::text from public.apollo_enrichment_reconciliation_events$$,
  '4'
);
select aria_apollo_test.assert_scalar(
  'explicit erasure writes one secret-free audit event',
  $$select (
      count(*) = 1
      and min(case_reference) = 'privacy-case-erase'
      and min(request_id) = 'request-erasure-explicit'
      and min(cleared_receipts) = 1
      and min(campaign_id) = 'campaign-a'
      and count(*) filter (where candidate_id is not null) = 1
    )::text
    from public.apollo_enrichment_erasure_events$$,
  'true'
);
select aria_apollo_test.assert_sqlstate(
  'erasure events reject updates',
  $$update public.apollo_enrichment_erasure_events
       set request_id = request_id$$,
  array['42501']
);
select aria_apollo_test.assert_sqlstate(
  'erasure events reject deletes',
  $$delete from public.apollo_enrichment_erasure_events$$,
  array['42501']
);
select aria_apollo_test.assert_scalar(
  'append-only erasure rejection preserves its event',
  $$select count(*)::text from public.apollo_enrichment_erasure_events$$,
  '1'
);

select 'RESULT apollo-enrichment-authority-sql: reconciliation=pass events=append-only erasure=audited admin-race=single-winner' as result;

\endif
