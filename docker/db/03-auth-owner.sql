-- The supabase/postgres image pre-creates the auth schema, the auth.uid()/role()/email()
-- functions, and the auth tables owned by postgres/supabase_admin. GoTrue then connects
-- as supabase_auth_admin and runs its own migrations, which `create or replace` those
-- functions and alter those tables -- failing with "must be owner of function uid" because
-- it doesn't own them. Hand the whole auth schema to supabase_auth_admin so GoTrue's
-- migrations apply cleanly. Runs once at first DB init (after the image's auth setup).
do $$
declare r record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    return;
  end if;
  execute 'alter schema auth owner to supabase_auth_admin';
  for r in
    select format('alter table auth.%I owner to supabase_auth_admin', tablename) as cmd
    from pg_tables where schemaname = 'auth'
  loop
    execute r.cmd;
  end loop;
  for r in
    select format(
      'alter function auth.%I(%s) owner to supabase_auth_admin',
      p.proname, pg_get_function_identity_arguments(p.oid)
    ) as cmd
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth'
  loop
    execute r.cmd;
  end loop;
end $$;
