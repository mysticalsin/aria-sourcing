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
      ('public.attach_provider_run(uuid,text,text)',                                                               'service_role',  true),
      ('public.audit_dust_connection_authority()',                                                                 'owner_only',    true),
      ('public.backfill_candidate_person_identities()',                                                            'owner_only',    true),
      ('public.backfill_candidates_corpus()',                                                                      'owner_only',    true),
      ('public.begin_provider_run(uuid,text,text,text)',                                                           'service_role',  true),
      ('public.begin_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text)',                            'service_role',  true),
      ('public.candidate_erasure_constant_time_hex_equal(text,text)',                                              'owner_only',    false),
      ('public.candidate_erasure_contains_identity(text,text[])',                                                  'owner_only',    false),
      ('public.candidate_erasure_encrypt_reference(uuid,jsonb)',                                                   'owner_only',    true),
      ('public.candidate_erasure_identifier_hmac(uuid,text,text)',                                                 'owner_only',    true),
      ('public.candidate_erasure_identity_lock_key(uuid,text,text)',                                               'owner_only',    false),
      ('public.candidate_erasure_provider_for_channel(text)',                                                      'owner_only',    false),
      ('public.candidate_erasure_reference_hmac(uuid,jsonb)',                                                      'owner_only',    true),
      ('public.candidate_erasure_response(uuid,boolean)',                                                          'owner_only',    true),
      ('public.candidate_erasure_tombstone_document(jsonb)',                                                       'owner_only',    false),
      ('public.candidate_erasure_tombstone_exists(uuid,text,text)',                                                'owner_only',    true),
      ('public.canonicalize_sourcing_role_basis(jsonb)',                                                           'owner_only',    false),
      ('public.claim_and_record(text,text,text,uuid,text,integer)',                                                'service_role',  true),
      ('public.claim_calendar_booking(uuid,text,timestamptz,text,text)',                                           'service_role',  true),
      ('public.claim_email_outbound_queued(uuid)',                                                                 'service_role',  true),
      ('public.claim_email_outbound(text,text,text,text,text,text,uuid)',                                          'authenticated', true),
      ('public.claim_enrichment_budget(uuid,text,text,integer,text)',                                              'service_role',  true),
      ('public.claim_linkedin_outbound_queued(uuid)',                                                              'service_role',  true),
      ('public.cleanup_email_ledger_delivery_receipts(integer)',                                                   'service_role',  true),
      ('public.cleanup_erased_candidate_mirror()',                                                                 'owner_only',    true),
      ('public.cleanup_erased_candidate_outcomes()',                                                               'owner_only',    true),
      ('public.cleanup_sourcing_learning_authority(uuid,integer)',                                                 'service_role',  true),
      ('public.complete_sourcing_run(uuid,uuid,uuid,jsonb)',                                                       'service_role',  true),
      ('public.configure_sourcing_learning(uuid,uuid,boolean,integer,integer,integer,integer,text,bigint,text)',   'service_role',  true),
      ('public.correlate_inbound_email(uuid,text)',                                                                'service_role',  true),
      ('public.current_profile_role()',                                                                            'authenticated', true),
      ('public.current_workspace_id()',                                                                            'authenticated', true),
      ('public.enforce_active_email_approval()',                                                                   'owner_only',    true),
      ('public.enforce_active_linkedin_approval()',                                                                'owner_only',    true),
      ('public.enforce_agent_spec_authority_immutable()',                                                          'owner_only',    false),
      ('public.enforce_candidate_erasure_obligation_limit()',                                                      'owner_only',    false),
      ('public.enqueue_email_outbound(text,text,text,uuid,text,text,text)',                                        'authenticated', true),
      ('public.ensure_workspace()',                                                                                'authenticated', true),
      ('public.fail_sourcing_run(uuid,uuid,uuid,text)',                                                            'service_role',  true),
      ('public.finalize_email_provider_failure(uuid,uuid,text)',                                                   'service_role',  true),
      ('public.gc_deleted_candidacies()',                                                                          'owner_only',    true),
      ('public.link_candidate_person()',                                                                           'owner_only',    true),
      ('public.link_one_candidate(candidates)',                                                                    'owner_only',    true),
      ('public.list_candidate_erasure_requests(uuid,uuid,integer)',                                                'service_role',  true),
      ('public.list_pending_sourcing_feedback(uuid,uuid,text,integer)',                                            'service_role',  true),
      ('public.list_promoted_sourcing_lessons(uuid,uuid,jsonb,integer)',                                           'service_role',  true),
      ('public.list_workspace_candidates(text,text,text,text,text,integer,integer)',                               'authenticated', true),
      ('public.mirror_workspace_candidates(uuid,jsonb)',                                                           'owner_only',    true),
      ('public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)',                             'service_role',  true),
      ('public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)',                                       'service_role',  true),
      ('public.reconcile_calendar_booking(uuid,uuid,text,text,text)',                                              'service_role',  true),
      ('public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)',                'service_role',  true),
      ('public.record_candidate_outcome(uuid,text,text,text,uuid)',                                                'service_role',  true),
      ('public.record_email_delivery_event(uuid,text,text,timestamptz,integer,boolean)',                           'service_role',  true),
      ('public.record_email_send_message_id(uuid,uuid,text)',                                                      'service_role',  true),
      ('public.record_inbound_email(uuid,text,text,text)',                                                         'service_role',  true),
      ('public.record_linkedin_delivery_outcome(uuid,uuid,text,text,text)',                                        'service_role',  true),
      ('public.record_outreach_approval(text,text,text)',                                                          'authenticated', true),
      ('public.record_sourcing_query_feedback(uuid,uuid,uuid,text,text)',                                          'service_role',  true),
      ('public.refresh_candidate_erasure_legal_hold_state(uuid)',                                                  'owner_only',    true),
      ('public.reject_candidate_erasure_receipt_mutation()',                                                       'owner_only',    false),
      ('public.reject_candidate_erasure_reimport()',                                                               'owner_only',    true),
      ('public.reject_email_connection_quarantine_mutation()',                                                     'owner_only',    false),
      ('public.reject_sourcing_lesson_review_mutation()',                                                          'owner_only',    false),
      ('public.release_candidate_legal_hold(uuid,uuid,uuid,text)',                                                 'service_role',  true),
      ('public.release_elapsed_outreach_contact_window()',                                                         'owner_only',    false),
      ('public.release_enrichment_claim(uuid)',                                                                    'service_role',  true),
      ('public.request_candidate_erasure(uuid,uuid,text,text,uuid)',                                               'service_role',  true),
      ('public.resolve_inbound_mailbox_route(text)',                                                               'service_role',  true),
      ('public.review_sourcing_lesson(uuid,uuid,uuid,bigint,text,text,text)',                                      'service_role',  true),
      ('public.revoke_outreach_approval(text,text)',                                                               'authenticated', true),
      ('public.scrub_candidate_workspace_document(jsonb,text)',                                                    'owner_only',    false),
      ('public.settle_enrichment_spend(uuid,integer)',                                                             'service_role',  true),
      ('public.settle_provider_run_by_external(uuid,text,text,boolean)',                                           'service_role',  true),
      ('public.settle_provider_run(uuid,boolean)',                                                                 'service_role',  true),
      ('public.sourcing_authority_hmac(uuid,text)',                                                                'owner_only',    true),
      ('public.stamp_dust_connection_authority()',                                                                 'owner_only',    false),
      ('public.strip_legacy_dust_authority()',                                                                     'owner_only',    false),
      ('public.sync_candidates_corpus()',                                                                          'owner_only',    true),
      ('public.touch_updated_at()',                                                                                'owner_only',    false),
      ('public.validate_sourcing_learning_query(text,text)',                                                       'owner_only',    false)
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
      ('public.list_candidate_erasure_requests(uuid,uuid,integer)'),
      ('public.request_candidate_erasure(uuid,uuid,text,text,uuid)'),
      ('public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'),
      ('public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'),
      ('public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'),
      ('public.release_candidate_legal_hold(uuid,uuid,uuid,text)'),
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
      ('public.begin_provider_run(uuid,text,text,text)'),
      ('public.attach_provider_run(uuid,text,text)'),
      ('public.settle_provider_run(uuid,boolean)'),
      ('public.settle_provider_run_by_external(uuid,text,text,boolean)'),
      ('public.claim_enrichment_budget(uuid,text,text,integer,text)'),
      ('public.settle_enrichment_spend(uuid,integer)'),
      ('public.release_enrichment_claim(uuid)')
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
