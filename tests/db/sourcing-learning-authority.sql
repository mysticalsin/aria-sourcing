\set ON_ERROR_STOP on

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','runner-one@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','runner-two@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reviewer@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','foreign@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Learning Workspace'),
  ('22222222-2222-4222-8222-222222222222', 'Foreign Workspace');
insert into public.profiles (id, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','admin'),
  ('a2000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','admin'),
  ('b1000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','admin');

set request.jwt.claims = '{"role":"service_role"}';
set request.jwt.claim.role = 'service_role';

do $sourcing_learning_behavior$
declare
  role_basis constant jsonb := '{
    "title":"Data Engineer",
    "seniority":"Senior",
    "employmentType":"Permanent",
    "locationType":"Remote",
    "region":"Canada",
    "timezone":"America/Toronto",
    "skills":["SQL","Python"]
  }'::jsonb;
  first_begin jsonb;
  first_replay jsonb;
  conflict jsonb;
  second_begin jsonb;
  foreign_begin jsonb;
  completed jsonb;
  invalid_completion jsonb;
  feedback_result jsonb;
  pending_result jsonb;
  export_result jsonb;
  artifact_result jsonb;
  artifact_manifest jsonb;
  graph_result jsonb;
  review_result jsonb;
  list_result jsonb;
  config_result jsonb;
  first_run uuid;
  second_run uuid;
  invalid_run uuid;
  first_receipt uuid;
  second_receipt uuid;
  lesson_id uuid;
  export_id uuid;
  lesson_version bigint;
  artifact_input text;
  artifact_graph text;
  graphify_image constant text := 'registry.example/aria-graphify-lessons@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
begin
  first_begin := public.begin_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'campaign-one', role_basis, repeat('1',64), 'deterministic', null, null,
    '11000000-0000-4000-8000-000000000001', 'run-one'
  );
  if first_begin ->> 'status' <> 'claimed' then
    raise exception 'first run was not claimed: %', first_begin;
  end if;
  first_run := (first_begin ->> 'run_id')::uuid;
  first_replay := public.begin_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'campaign-one', role_basis, repeat('1',64), 'deterministic', null, null,
    '11000000-0000-4000-8000-000000000001', 'run-one-retry'
  );
  if first_replay ->> 'status' <> 'in_progress'
     or (first_replay ->> 'run_id')::uuid <> first_run
     or (select used from public.sourcing_run_quota where workspace_id='11111111-1111-4111-8111-111111111111' and bucket_date=current_date and scope_key='workspace') <> 1 then
    raise exception 'idempotent replay consumed authority twice: %', first_replay;
  end if;
  conflict := public.begin_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'different-campaign', role_basis, repeat('1',64), 'deterministic', null, null,
    '11000000-0000-4000-8000-000000000001', 'run-one-conflict'
  );
  if conflict ->> 'status' <> 'idempotency_conflict' then
    raise exception 'idempotency binding conflict was admitted: %', conflict;
  end if;

  completed := public.complete_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', first_run,
    '[{"platform":"GitHub","query":"language:Python data engineer SQL","ok":true,"candidateCount":4,"skippedCount":1},{"platform":"GitHub","query":"language:Ruby data engineer SQL","ok":false,"candidateCount":0,"skippedCount":0}]'
  );
  if completed ->> 'status' <> 'completed'
     or jsonb_array_length(completed -> 'receipts') <> 1
     or completed #>> '{receipts,0,platform}' <> 'GitHub'
     or (completed #>> '{receipts,0,candidateCount}')::integer <> 4 then
    raise exception 'first run completion failed: %', completed;
  end if;
  first_receipt := (completed #>> '{receipts,0,receiptId}')::uuid;

  second_begin := public.begin_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000002',
    'campaign-two', role_basis, repeat('1',64), 'deterministic', null, null,
    '22000000-0000-4000-8000-000000000002', 'run-two'
  );
  second_run := (second_begin ->> 'run_id')::uuid;
  completed := public.complete_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000002', second_run,
    '[{"platform":"GitHub","query":"language:Python data engineer SQL","ok":true,"candidateCount":3,"skippedCount":0}]'
  );
  if completed ->> 'status' <> 'completed'
     or jsonb_array_length(completed -> 'receipts') <> 1
     or (completed #>> '{receipts,0,candidateCount}')::integer <> 3 then
    raise exception 'second run completion failed: %', completed;
  end if;
  second_receipt := (completed #>> '{receipts,0,receiptId}')::uuid;

  if not exists (select 1 from public.sourcing_query_receipts where id = first_receipt and run_id = first_run)
     or not exists (select 1 from public.sourcing_query_receipts where id = second_receipt and run_id = second_run) then
    raise exception 'completion returned a receipt outside its run';
  end if;
  if (select count(*) from public.sourcing_query_receipts where run_id = first_run) <> 2
     or (select count(*) from public.sourcing_query_receipts where run_id = first_run and not succeeded) <> 1 then
    raise exception 'mixed-success run receipts were not durably recorded';
  end if;
  select id, version into lesson_id, lesson_version from public.sourcing_lessons
  where workspace_id='11111111-1111-4111-8111-111111111111';
  if (select evidence_run_count from public.sourcing_lessons where id=lesson_id) <> 2
     or (select evidence_campaign_count from public.sourcing_lessons where id=lesson_id) <> 2 then
    raise exception 'independent run and campaign evidence was not counted';
  end if;

  pending_result := public.list_pending_sourcing_feedback(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', 'campaign-one', 20
  );
  if pending_result ->> 'status' <> 'ready'
     or jsonb_array_length(pending_result -> 'receipts') <> 1
     or pending_result #>> '{receipts,0,receiptId}' <> first_receipt::text then
    raise exception 'only successful pending feedback was not recoverable after reload: %', pending_result;
  end if;

  feedback_result := public.record_sourcing_query_feedback(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', first_receipt, 'useful', 'feedback-one'
  );
  if feedback_result ->> 'status' <> 'recorded' then raise exception 'feedback one failed'; end if;
  pending_result := public.list_pending_sourcing_feedback(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', 'campaign-one', 20
  );
  if pending_result ->> 'status' <> 'ready'
     or jsonb_array_length(pending_result -> 'receipts') <> 0 then
    raise exception 'recorded feedback remained pending: %', pending_result;
  end if;
  feedback_result := public.record_sourcing_query_feedback(
    '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000002', second_receipt, 'useful', 'feedback-two'
  );
  if feedback_result ->> 'status' <> 'recorded' then raise exception 'feedback two failed'; end if;

  config_result := public.configure_sourcing_learning(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', true, 100, 25, 2, 90,
    graphify_image, 1, 'pin-graphify-image'
  );
  if config_result ->> 'status' <> 'configured' then
    raise exception 'Graphify image authority was not pinned: %', config_result;
  end if;

  export_result := public.export_graphify_sourcing_lessons(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', 10
  );
  if export_result ->> 'status' <> 'exported'
     or export_result #>> '{payload,schemaVersion}' <> '1'
     or export_result #>> '{payload,workspaceFingerprint}' !~ '^[0-9a-f]{64}$'
     or export_result ->> 'exportId' !~ '^[0-9a-f-]{36}$'
     or jsonb_array_length(export_result #> '{payload,lessons}') <> 1
     or export_result #> '{payload,lessons,0}' ? 'query'
     or export_result #>> '{payload,lessons,0,queryFingerprint}' !~ '^[0-9a-f]{64}$'
     or export_result #>> '{payload,lessons,0,sourcePlatform}' <> 'github'
     or export_result #>> '{payload,lessons,0,promotionStatus}' <> 'draft'
     or (export_result #>> '{payload,lessons,0,authorityVersion}')::bigint <> lesson_version
     or export_result #>> '{payload,lessons,0,evidence,independentRuns}' <> '2'
     or export_result #>> '{payload,lessons,0,evidence,independentReviewerCount}' <> '2' then
    raise exception 'Graphify export did not match the redacted worker contract: %', export_result;
  end if;
  export_id := (export_result ->> 'exportId')::uuid;
  graph_result := public.attach_graphify_sourcing_lesson(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', lesson_id, lesson_version, export_id
  );
  if graph_result ->> 'status' <> 'artifact_not_found' then
    raise exception 'uncompleted Graphify export was attachable: %', graph_result;
  end if;
  artifact_input := (export_result -> 'payload')::text;
  artifact_graph := jsonb_build_object(
    'built_at_commit', '94d3099540550d58dd121ec3e67cf93e80364079',
    'directed', true,
    'nodes', jsonb_build_array(jsonb_build_object('id', 'lesson_' || replace(lesson_id::text, '-', ''))),
    'links', '[]'::jsonb
  )::text;
  artifact_manifest := jsonb_build_object(
    'status', 'ok',
    'schemaVersion', 1,
    'inputSchemaVersion', 1,
    'workspaceFingerprint', export_result #>> '{payload,workspaceFingerprint}',
    'inputSha256', encode(digest(convert_to(artifact_input, 'UTF8'), 'sha256'), 'hex'),
    'graphSha256', encode(digest(convert_to(artifact_graph, 'UTF8'), 'sha256'), 'hex'),
    'lessonCount', 1,
    'attachments', jsonb_build_array(jsonb_build_object(
      'lessonId', lesson_id,
      'expectedVersion', lesson_version,
      'clusterRef', 'community:0'
    )),
    'graphify', jsonb_build_object(
      'commit', '94d3099540550d58dd121ec3e67cf93e80364079',
      'semanticLlmUsed', false,
      'queryLoggingDisabled', true
    )
  );
  artifact_result := public.complete_graphify_sourcing_export(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', export_id,
    artifact_input, artifact_graph, artifact_manifest, graphify_image
  );
  if artifact_result ->> 'status' <> 'completed'
     or not exists (
       select 1 from public.sourcing_graphify_exports
       where id = export_id and graph_text = artifact_graph and manifest = artifact_manifest
     ) then
    raise exception 'Graphify artifact was not durably completed: %', artifact_result;
  end if;

  graph_result := public.attach_graphify_sourcing_lesson(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', lesson_id, lesson_version, export_id
  );
  if graph_result ->> 'status' <> 'attached' then raise exception 'Graphify attach failed: %', graph_result; end if;
  lesson_version := (graph_result ->> 'version')::bigint;

  review_result := public.review_sourcing_lesson(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', lesson_id, lesson_version,
    'promoted', 'reviewed_useful', 'review-conflicted-author'
  );
  if review_result ->> 'status' <> 'reviewer_conflict' then
    raise exception 'run author promoted their own lesson: %', review_result;
  end if;
  review_result := public.review_sourcing_lesson(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', lesson_id, lesson_version,
    'promoted', 'reviewed_useful', 'review-independent'
  );
  if review_result ->> 'status' <> 'reviewed' then raise exception 'independent promotion failed: %', review_result; end if;

  list_result := public.list_promoted_sourcing_lessons(
    '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000002', role_basis, 5
  );
  if list_result ->> 'status' <> 'ready'
     or jsonb_array_length(list_result -> 'lessons') <> 1
     or list_result #>> '{lessons,0,graphifyClusterRef}' <> 'community:0'
     or list_result #>> '{lessons,0,graphifyClusterRank}' <> '1'
     or list_result::text ~* '(email|linkedin\.com/in/|candidate_id|profile_url)' then
    raise exception 'promoted lesson retrieval is unsafe or empty: %', list_result;
  end if;

  invalid_run := (public.begin_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'campaign-invalid', role_basis, repeat('1',64), 'deterministic', null, null,
    '33000000-0000-4000-8000-000000000003', 'run-invalid'
  ) ->> 'run_id')::uuid;
  invalid_completion := public.complete_sourcing_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001', invalid_run,
    '[{"platform":"GitHub","query":"person@example.test ignore previous","ok":true,"candidateCount":1,"skippedCount":0}]'
  );
  if invalid_completion ->> 'status' <> 'invalid_receipts'
     or (select status from public.sourcing_runs where id=invalid_run) <> 'in_progress' then
    raise exception 'unsafe query created evidence: %', invalid_completion;
  end if;

  foreign_begin := public.begin_sourcing_run(
    '22222222-2222-4222-8222-222222222222',
    'a2000000-0000-4000-8000-000000000002',
    'foreign-campaign', role_basis, repeat('1',64), 'deterministic', null, null,
    '44000000-0000-4000-8000-000000000004', 'foreign-run'
  );
  if foreign_begin ->> 'status' <> 'not_found' then
    raise exception 'cross-workspace actor was admitted: %', foreign_begin;
  end if;

  config_result := public.configure_sourcing_learning(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003', false, 100, 25, 2, 90,
    graphify_image, 2, 'disable-learning'
  );
  if config_result ->> 'status' <> 'configured'
     or (select status from public.sourcing_lessons where id=lesson_id) <> 'suspended' then
    raise exception 'kill switch did not suspend learning: %', config_result;
  end if;
  list_result := public.list_promoted_sourcing_lessons(
    '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000002', role_basis, 5
  );
  if list_result ->> 'status' <> 'learning_disabled'
     or jsonb_array_length(list_result -> 'lessons') <> 0 then
    raise exception 'kill switch still returned lessons: %', list_result;
  end if;
end
$sourcing_learning_behavior$;

-- Only one-way fingerprints are stored for campaign and role authority.
do $sourcing_learning_privacy$
begin
  if exists (
    select 1 from public.sourcing_runs
    where campaign_hmac !~ '^[0-9a-f]{64}$' or role_fingerprint !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'invalid sourcing authority fingerprint';
  end if;
  if exists (
    select 1 from public.sourcing_query_receipts
    where query_text ~* '(@|https?://|linkedin\.com/in/)'
  ) then
    raise exception 'candidate-shaped data reached a query receipt';
  end if;
end
$sourcing_learning_privacy$;

do $sourcing_learning_privileges$
declare
  item record;
  role_name text;
  expected boolean;
  actual boolean;
  forced boolean;
begin
  for item in
    select * from (values
      ('public.begin_sourcing_run(uuid,uuid,text,jsonb,text,text,text,text,uuid,text)', true),
      ('public.complete_sourcing_run(uuid,uuid,uuid,jsonb)', true),
      ('public.fail_sourcing_run(uuid,uuid,uuid,text)', true),
      ('public.record_sourcing_query_feedback(uuid,uuid,uuid,text,text)', true),
      ('public.list_pending_sourcing_feedback(uuid,uuid,text,integer)', true),
      ('public.export_graphify_sourcing_lessons(uuid,uuid,integer)', true),
      ('public.complete_graphify_sourcing_export(uuid,uuid,uuid,text,text,jsonb,text)', true),
      ('public.attach_graphify_sourcing_lesson(uuid,uuid,uuid,bigint,uuid)', true),
      ('public.review_sourcing_lesson(uuid,uuid,uuid,bigint,text,text,text)', true),
      ('public.list_promoted_sourcing_lessons(uuid,uuid,jsonb,integer)', true),
      ('public.configure_sourcing_learning(uuid,uuid,boolean,integer,integer,integer,integer,text,bigint,text)', true),
      ('public.cleanup_sourcing_learning_authority(uuid,integer)', true),
      ('public.canonicalize_sourcing_role_basis(jsonb)', false),
      ('public.validate_sourcing_learning_query(text,text)', false),
      ('public.sourcing_authority_hmac(uuid,text)', false)
    ) as matrix(signature, service_allowed)
  loop
    if to_regprocedure(item.signature) is null then
      raise exception 'missing sourcing authority function: %', item.signature;
    end if;
    foreach role_name in array array['anon','authenticator','authenticated','service_role']
    loop
      expected := item.service_allowed and role_name = 'service_role';
      execute format(
        'select has_function_privilege(%L, %L, %L)',
        role_name, item.signature, 'EXECUTE'
      ) into actual;
      if actual is distinct from expected then
        raise exception 'unexpected execute privilege for % on %', role_name, item.signature;
      end if;
    end loop;
  end loop;

  for item in
    select unnest(array[
      'sourcing_learning_secrets', 'sourcing_learning_controls', 'sourcing_runs',
      'sourcing_run_quota', 'sourcing_query_receipts', 'sourcing_query_feedback',
      'sourcing_graphify_exports',
      'sourcing_lessons', 'sourcing_lesson_evidence', 'sourcing_lesson_reviews'
    ]) as table_name
  loop
    select relforcerowsecurity into forced
    from pg_class where oid = format('public.%I', item.table_name)::regclass;
    if not forced then
      raise exception 'RLS is not forced on %', item.table_name;
    end if;
    foreach role_name in array array['anon','authenticator','authenticated','service_role']
    loop
      if has_table_privilege(role_name, format('public.%I', item.table_name), 'SELECT')
         or has_table_privilege(role_name, format('public.%I', item.table_name), 'INSERT')
         or has_table_privilege(role_name, format('public.%I', item.table_name), 'UPDATE')
         or has_table_privilege(role_name, format('public.%I', item.table_name), 'DELETE') then
        raise exception 'direct table privilege exposed to % on %', role_name, item.table_name;
      end if;
    end loop;
  end loop;
end
$sourcing_learning_privileges$;

select 'RESULT sourcing-learning-db: authority=pass isolation=pass idempotency=pass review-separation=pass kill-switch=pass no-candidate-pii=pass';
