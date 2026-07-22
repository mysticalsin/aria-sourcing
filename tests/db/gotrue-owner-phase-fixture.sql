\set ON_ERROR_STOP on

-- GoTrue normally adds these lifecycle columns. Disposable database suites do
-- not start GoTrue, so its privileged owner phase is represented explicitly
-- before application migrations consume the schema.
do $aria_gotrue_owner_session$
begin
  if session_user <> 'supabase_admin' or current_user <> 'supabase_admin' then
    raise exception 'GoTrue test authority must run directly as supabase_admin';
  end if;
end
$aria_gotrue_owner_session$;

alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users enable row level security;
alter table auth.users no force row level security;

do $aria_gotrue_owner_fixture$
begin
  if pg_get_userbyid(
    (select proowner
       from pg_catalog.pg_proc
      where oid = 'auth.aria_current_active_identity()'::regprocedure)
  ) <> 'supabase_auth_admin' then
    raise exception 'current-identity bridge is not Auth-owned';
  end if;

  if pg_get_userbyid(
    (select proowner
       from pg_catalog.pg_proc
      where oid =
        'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)'::regprocedure)
  ) <> 'supabase_auth_admin' then
    raise exception 'owner-recovery bridge is not Auth-owned';
  end if;
end
$aria_gotrue_owner_fixture$;
