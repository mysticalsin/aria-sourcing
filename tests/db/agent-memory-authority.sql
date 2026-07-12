\set ON_ERROR_STOP on
begin;

create schema aria_agent_memory_test;
revoke all on schema aria_agent_memory_test from public;
grant usage on schema aria_agent_memory_test to authenticated, service_role;

create function aria_agent_memory_test.set_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create function aria_agent_memory_test.assert_scalar(case_name text, statement text, expected text)
returns void language plpgsql set search_path = pg_catalog as $$
declare actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;

create function aria_agent_memory_test.assert_sqlstate(case_name text, statement text, expected_codes text[])
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

revoke all on all functions in schema aria_agent_memory_test from public;
grant execute on all functions in schema aria_agent_memory_test to authenticated, service_role;

select aria_agent_memory_test.assert_scalar(
  'legacy memory is quarantined exactly once',
  $$select count(*)::text from public.agent_memory_legacy_quarantine where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '1'
);
select aria_agent_memory_test.assert_scalar(
  'legacy quarantine contains no recoverable JSON or source identifiers',
  $$select count(*)::text
      from information_schema.columns
     where table_schema='public'
       and table_name='agent_memory_legacy_quarantine'
       and column_name in ('payload','legacy_memory_id','legacy_seat_id')$$,
  '0'
);
select aria_agent_memory_test.assert_scalar(
  'legacy quarantine retains only a one-way hash receipt',
  $$select (payload_sha256 ~ '^[0-9a-f]{64}$')::text
      from public.agent_memory_legacy_quarantine
     where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'true'
);
select aria_agent_memory_test.assert_scalar(
  'legacy plaintext is absent from quarantine row serialization',
  $$select (to_jsonb(q)::text not like '%legacy shared secret instruction%')::text
      from public.agent_memory_legacy_quarantine q
     where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'true'
);
select aria_agent_memory_test.assert_scalar(
  'legacy memory is never activated',
  $$select count(*)::text from public.agent_memories$$,
  '0'
);
select aria_agent_memory_test.assert_scalar(
  'workspace memory authority is emptied during quarantine',
  $$select jsonb_array_length(state->'memory')::text from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '0'
);

-- A stale member client cannot put shared seat memory back into authority.
select aria_agent_memory_test.set_claims('a1000000-0000-4000-8000-000000000001');
set local role authenticated;
update public.workspace_state
   set state = jsonb_set(state, '{memory}', '[{"content":"stale client injection"}]')
 where workspace_id='11111111-1111-4111-8111-111111111111';
select aria_agent_memory_test.assert_scalar(
  'stale shared memory writes are stripped',
  $$select jsonb_array_length(state->'memory')::text from public.workspace_state where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '0'
);
reset role;

insert into public.agent_memories (
  id,workspace_id,owner_id,spec_id,kind,content_ciphertext,content_sha256,
  content_byte_count,revision,status,source_type,created_by,expires_at
) values
  ('71000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','fact','enc:v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:AA==:AA==:AA==','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',128,1,'approved','operator','a1000000-0000-4000-8000-000000000001',now()+interval '1 day'),
  ('72000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a2000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','fact','enc:v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:AA==:AA==:AA==','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',128,1,'approved','operator','a2000000-0000-4000-8000-000000000002',now()+interval '1 day'),
  ('73000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','episodic','enc:v2:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:AA==:AA==:AA==','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',1,1,'approved','operator','a1000000-0000-4000-8000-000000000001',now()-interval '1 second'),
  ('74000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','instruction','enc:v2:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd:AA==:AA==:AA==','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',1,1,'pending_review','operator','a1000000-0000-4000-8000-000000000001',now()+interval '1 day');

select aria_agent_memory_test.assert_sqlstate(
  'memory events reject arbitrary metadata that could carry plaintext',
  $$insert into public.agent_memory_events(memory_id,workspace_id,owner_id,spec_id,event_type,memory_revision,content_sha256,metadata)
    values('71000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','created',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"note":"plaintext leak"}')$$,
  array['23514']
);
select aria_agent_memory_test.assert_sqlstate(
  'run-sourced memory requires an exact source run',
  $$insert into public.agent_memories(id,workspace_id,owner_id,spec_id,kind,content_ciphertext,content_sha256,content_byte_count,revision,status,source_type)
    values('76000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','fact','enc:v2:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff:AA==:AA==:AA==','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',1,1,'approved','run')$$,
  array['23514']
);

-- Ordinary owners see only their own metadata, never encrypted content.
select aria_agent_memory_test.set_claims('a1000000-0000-4000-8000-000000000001');
set local role authenticated;
select aria_agent_memory_test.assert_scalar(
  'owner A sees only owner A metadata',
  $$select count(*)::text from public.agent_memories$$,
  '3'
);
select aria_agent_memory_test.assert_scalar(
  'owner A cannot see owner B metadata despite shared seat',
  $$select count(*)::text from public.agent_memories where spec_id='62000000-0000-4000-8000-000000000002'$$,
  '0'
);
select aria_agent_memory_test.assert_sqlstate(
  'owners cannot select encrypted memory content directly',
  $$select content_ciphertext from public.agent_memories limit 1$$,
  array['42501']
);
select aria_agent_memory_test.assert_sqlstate(
  'ordinary owners cannot execute the service-only run receipt function',
  $$select public.create_agent_run_with_memory_context('11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001')$$,
  array['42501']
);
select aria_agent_memory_test.assert_sqlstate(
  'ordinary members cannot move agent ownership',
  $$update public.agent_specs set owner_id='a2000000-0000-4000-8000-000000000002' where id='61000000-0000-4000-8000-000000000001'$$,
  array['42501']
);
reset role;

select aria_agent_memory_test.set_claims('a4000000-0000-4000-8000-000000000004');
set local role authenticated;
select aria_agent_memory_test.assert_scalar(
  'viewers read no memory metadata',
  $$select count(*)::text from public.agent_memories$$,
  '0'
);
reset role;

update public.agent_memories
   set revision = 99
 where id = '72000000-0000-4000-8000-000000000002';
select aria_agent_memory_test.assert_scalar(
  'memory revisions cannot be forged independently of content',
  $$select revision::text from public.agent_memories where id='72000000-0000-4000-8000-000000000002'$$,
  '1'
);
select aria_agent_memory_test.assert_sqlstate(
  'memory source provenance cannot be rewritten',
  $$update public.agent_memories set source_type='import' where id='72000000-0000-4000-8000-000000000002'$$,
  array['42501']
);
update public.agent_memories
   set content_ciphertext='enc:v2:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:AA==:AA==:AA==',
       content_sha256='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
       content_byte_count=64,
       revision=99,
       status='approved'
 where id='72000000-0000-4000-8000-000000000002';
select aria_agent_memory_test.assert_scalar(
  'changed approved content returns to pending review with a new revision',
  $$select (status='pending_review' and revision=2)::text from public.agent_memories where id='72000000-0000-4000-8000-000000000002'$$,
  'true'
);

-- A privileged direct update still cannot rewrite immutable spec authority.
select aria_agent_memory_test.assert_sqlstate(
  'database owner cannot bypass immutable agent owner authority',
  $$update public.agent_specs set owner_id='a2000000-0000-4000-8000-000000000002' where id='61000000-0000-4000-8000-000000000001'$$,
  array['42501']
);

-- Composite constraints reject cross-workspace/spec memory bindings.
select aria_agent_memory_test.assert_sqlstate(
  'cross-workspace memory binding is rejected',
  $$insert into public.agent_memories(id,workspace_id,owner_id,spec_id,kind,content_ciphertext,content_sha256,content_byte_count,revision,status,source_type)
    values('75000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','fact','enc:v2:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:AA==:AA==:AA==','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',1,1,'approved','operator')$$,
  array['23503']
);

-- The service-only function atomically creates the run, content-free receipt,
-- and content-free memory-use event.
select aria_agent_memory_test.assert_sqlstate(
  'new runs cannot omit actor provenance',
  $$insert into public.agent_runs(workspace_id,owner_id,spec_id,state_json,node)
    values('11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','{}','planner')$$,
  array['23502']
);
select aria_agent_memory_test.set_claims('a3000000-0000-4000-8000-000000000003');
set local role service_role;
select public.create_agent_run_with_memory_context(
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003'
) as run_id \gset
reset role;

select aria_agent_memory_test.assert_scalar(
  'receipt stores memory revision and hash only',
  $$select (memory_revision=1 and content_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' and byte_count=128)::text
      from public.agent_run_memory_context
     where run_id=(select id from public.agent_runs where spec_id='61000000-0000-4000-8000-000000000001' order by started_at desc limit 1)$$,
  'true'
);
select aria_agent_memory_test.assert_scalar(
  'run stores actor provenance even when receipts are selected independently',
  $$select (actor_id='a3000000-0000-4000-8000-000000000003')::text
      from public.agent_runs
     where id=(select id from public.agent_runs where spec_id='61000000-0000-4000-8000-000000000001' order by started_at desc limit 1)$$,
  'true'
);
select aria_agent_memory_test.assert_sqlstate(
  'persisted run actor provenance is immutable',
  $$update public.agent_runs
       set actor_id='a1000000-0000-4000-8000-000000000001'
     where id=(select id from public.agent_runs where spec_id='61000000-0000-4000-8000-000000000001' order by started_at desc limit 1)$$,
  array['42501']
);
select aria_agent_memory_test.assert_scalar(
  'memory-selection event stores no content without claiming provider use',
  $$select (event_type='selected' and content_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' and metadata='{}')::text
      from public.agent_memory_events
     where run_id=(select id from public.agent_runs where spec_id='61000000-0000-4000-8000-000000000001' order by started_at desc limit 1)$$,
  'true'
);
select aria_agent_memory_test.assert_scalar(
  'receipt table has no content column',
  $$select count(*)::text from information_schema.columns where table_schema='public' and table_name='agent_run_memory_context' and column_name in ('content','content_ciphertext','plaintext','body','text')$$,
  '0'
);
select aria_agent_memory_test.assert_scalar(
  'event table has no content column',
  $$select count(*)::text from information_schema.columns where table_schema='public' and table_name='agent_memory_events' and column_name in ('content','content_ciphertext','plaintext','body','text')$$,
  '0'
);

-- Expired and unapproved rows can never be auto-selected for a run.
select aria_agent_memory_test.set_claims('a3000000-0000-4000-8000-000000000003');
set local role service_role;
select aria_agent_memory_test.assert_sqlstate(
  'cross-workspace actors cannot be attributed to a run',
  $$select public.create_agent_run_with_memory_context('11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001')$$,
  array['22023']
);
select public.create_agent_run_with_memory_context(
  '11111111-1111-4111-8111-111111111111',
  'a2000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000003'
) as empty_run_id \gset
reset role;

select aria_agent_memory_test.assert_scalar(
  'expired and pending memories are absent from every run receipt',
  $$select count(*)::text from public.agent_run_memory_context where memory_id in ('73000000-0000-4000-8000-000000000003','74000000-0000-4000-8000-000000000004')$$,
  '0'
);
select aria_agent_memory_test.assert_scalar(
  'empty-context runs still persist the exact actor',
  $$select (actor_id='a3000000-0000-4000-8000-000000000003' and spec_id='62000000-0000-4000-8000-000000000002')::text
      from public.agent_runs
     where id=(select id from public.agent_runs where spec_id='62000000-0000-4000-8000-000000000002' order by started_at desc limit 1)$$,
  'true'
);
select aria_agent_memory_test.assert_scalar(
  'changed content cannot re-enter runtime while pending review',
  $$select count(*)::text
      from public.agent_run_memory_context
     where run_id=(select id from public.agent_runs where spec_id='62000000-0000-4000-8000-000000000002' order by started_at desc limit 1)$$,
  '0'
);

rollback;
