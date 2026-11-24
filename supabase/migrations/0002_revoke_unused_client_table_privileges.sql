-- ============================================================================
-- Browser sessions (role "authenticated", reached through PostgREST) only need
-- SELECT / INSERT / UPDATE / DELETE, each further filtered by RLS. The schema
-- still carried TRUNCATE, TRIGGER, REFERENCES and MAINTAIN on several tables
-- (left over from blanket "grant all" statements). TRUNCATE in particular is
-- not subject to row-level security. Remove all four from client roles.
-- ============================================================================

do $aria_revoke_client_table_privileges$
declare
  target record;
begin
  for target in
    select c.oid::regclass as relation
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format(
      'revoke truncate, trigger, references, maintain on table %s from anon, authenticated, authenticator',
      target.relation
    );
  end loop;
end
$aria_revoke_client_table_privileges$;
