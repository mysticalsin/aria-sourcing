\set ON_ERROR_STOP on
-- Odoo integration tables (migration 0010): service-role only, one hand-off
-- per candidate, and the candidate read scoped to its workspace.
begin;
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('f1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','odoo-fixture@example.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name) values
  ('f2222222-2222-4222-8222-222222222222','Odoo fixture'),
  ('f3333333-3333-4333-8333-333333333333','Other workspace');
insert into public.workspace_state(workspace_id,state) values
  ('f2222222-2222-4222-8222-222222222222',
   '{"settings":{"confidentialityMode":true},"campaigns":[{"id":"camp_odoo","title":"Murex Support"}],"candidates":[{"id":"cand_odoo","campaignId":"camp_odoo","name":"Ada Example","stage":"Interested"}],"activities":[{"id":"a1","title":"Candidate PII revealed","linkedEntityId":"cand_odoo","createdAt":"2026-11-24T09:00:00.000Z"},{"id":"a2","title":"Candidate PII revealed","linkedEntityId":"cand_odoo","createdAt":"2026-11-24T10:00:00.000Z"},{"id":"a3","title":"Candidate PII revealed","linkedEntityId":"other","createdAt":"2026-11-24T11:00:00.000Z"}]}'),
  ('f3333333-3333-4333-8333-333333333333','{"campaigns":[],"candidates":[]}');

do $$ begin
  if has_table_privilege('authenticated','public.odoo_connections','SELECT')
    or has_table_privilege('authenticated','public.odoo_job_links','INSERT')
    or has_table_privilege('authenticated','public.odoo_applicant_links','UPDATE')
    or has_table_privilege('anon','public.odoo_connections','SELECT')
    or has_table_privilege('authenticated','public.odoo_erasures','SELECT')
    or has_table_privilege('anon','public.odoo_erasures','INSERT')
    or has_function_privilege('authenticated','public.odoo_candidate_record(uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.odoo_candidate_record(uuid,text)','EXECUTE') then
    raise exception 'Odoo authority must stay behind the server routes';
  end if;
  if not has_table_privilege('service_role','public.odoo_applicant_links','INSERT')
    or not has_function_privilege('service_role','public.odoo_candidate_record(uuid,text)','EXECUTE') then
    raise exception 'The server must be able to record hand-offs';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'odoo\_%' and c.relkind = 'r'
       and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    raise exception 'Odoo tables must force row-level security';
  end if;
end $$;

set local role service_role;
insert into public.odoo_connections(workspace_id, base_url, database_name, api_key_secret, api_key_last4)
values ('f2222222-2222-4222-8222-222222222222','https://odoo.example.test','prod','enc:v2:fixture','abcd');
insert into public.odoo_job_links(workspace_id, campaign_id, job_id, job_name)
values ('f2222222-2222-4222-8222-222222222222','camp_odoo',7,'Murex Support');
insert into public.odoo_applicant_links(workspace_id, candidate_id, campaign_id, job_id)
values ('f2222222-2222-4222-8222-222222222222','cand_odoo','camp_odoo',7);

do $$
declare record jsonb;
begin
  begin
    insert into public.odoo_applicant_links(workspace_id, candidate_id, campaign_id, job_id)
    values ('f2222222-2222-4222-8222-222222222222','cand_odoo','camp_odoo',7);
    raise exception 'A second hand-off claim for the same candidate was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.odoo_applicant_links set state = 'linked' where candidate_id = 'cand_odoo';
    raise exception 'A link without an Odoo applicant id was accepted';
  exception when check_violation then null;
  end;
  update public.odoo_applicant_links set state = 'linked', applicant_id = 42, odoo_status = 'ongoing' where candidate_id = 'cand_odoo';
  begin
    insert into public.odoo_connections(workspace_id, base_url, database_name, api_key_secret, api_key_last4)
    values ('f3333333-3333-4333-8333-333333333333','javascript:alert(1)','prod','x','abcd');
    raise exception 'A non-http Odoo address was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.odoo_connections(workspace_id, base_url, database_name, api_key_secret, api_key_last4)
    values ('f3333333-3333-4333-8333-333333333333','https://odoo.example.test','prod; drop table x','x','abcd');
    raise exception 'An unsafe database name was accepted';
  exception when check_violation then null;
  end;

  record := public.odoo_candidate_record('f2222222-2222-4222-8222-222222222222','cand_odoo');
  if record->'candidate'->>'name' <> 'Ada Example' or record->>'campaignTitle' <> 'Murex Support' then
    raise exception 'Candidate record not read: %', record;
  end if;
  if record->'confidentialityMode' <> 'true'::jsonb or record->>'lastRevealAt' <> '2026-11-24T10:00:00.000Z' then
    raise exception 'Confidentiality or latest reveal not read: %', record;
  end if;
  begin
    update public.odoo_connections set webhook_token_hash = 'plain-token', webhook_created_at = now()
     where workspace_id = 'f2222222-2222-4222-8222-222222222222';
    raise exception 'A webhook token that is not a SHA-256 was stored';
  exception when check_violation then null;
  end;
  begin
    update public.odoo_connections set webhook_token_hash = repeat('a', 64)
     where workspace_id = 'f2222222-2222-4222-8222-222222222222';
    raise exception 'A webhook hash without its creation time was accepted';
  exception when check_violation then null;
  end;
  update public.odoo_connections set webhook_token_hash = repeat('a', 64), webhook_created_at = now()
   where workspace_id = 'f2222222-2222-4222-8222-222222222222';
  insert into public.odoo_erasures(workspace_id, candidate_id, applicant_id, status)
  values ('f2222222-2222-4222-8222-222222222222','cand_odoo',42,'pending');
  begin
    update public.odoo_erasures set status = 'deleted' where candidate_id = 'cand_odoo';
    raise exception 'A completed erasure without its completion time was accepted';
  exception when check_violation then null;
  end;
  update public.odoo_erasures set status = 'deleted', completed_at = now() where candidate_id = 'cand_odoo';
  if public.odoo_candidate_record('f3333333-3333-4333-8333-333333333333','cand_odoo') is not null then
    raise exception 'A candidate was read across workspaces';
  end if;
end $$;
reset role;

-- Deleting the workspace removes its Odoo connection and links.
delete from public.workspace_state where workspace_id = 'f2222222-2222-4222-8222-222222222222';
delete from public.workspaces where id = 'f2222222-2222-4222-8222-222222222222';
do $$ begin
  if exists (select 1 from public.odoo_connections) or exists (select 1 from public.odoo_applicant_links)
     or exists (select 1 from public.odoo_job_links) or exists (select 1 from public.odoo_erasures) then
    raise exception 'Odoo rows outlived their workspace';
  end if;
end $$;
rollback;
