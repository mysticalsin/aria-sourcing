-- Set passwords on the Supabase roles the supabase/postgres image pre-creates, so the
-- sibling services can authenticate: GoTrue connects as supabase_auth_admin, PostgREST
-- as authenticator. Runs at first DB init (mounted into the image's init-scripts dir).
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER postgres WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';

-- supabase_functions_admin exists only when the pinned image enables pg_net.
-- Keep the core connection roles fail-closed above, but do not make first boot
-- depend on an extension-specific role that may legitimately be absent.
select format('alter user %I with password %L', rolname, :'pgpass')
  from pg_roles
 where rolname = 'supabase_functions_admin'
\gexec
