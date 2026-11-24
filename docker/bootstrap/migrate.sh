#!/bin/sh
# Apply every numbered migration in supabase/migrations as the direct postgres
# role, in one serialized transaction, recording each file's SHA-256 in
# public.aria_schema_migrations. A migration whose recorded hash changed fails
# the run instead of being silently re-applied. Called by run.sh.
set -eu
umask 077

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}"
export PGCONNECT_TIMEOUT
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

case "$MIGRATIONS_DIR" in
  *[!A-Za-z0-9_./:-]*) echo "[migrate] ERROR: unsafe migrations path" >&2; exit 1 ;;
esac

MIGRATION_PLAN=""
cleanup() {
  [ -z "$MIGRATION_PLAN" ] || rm -f "$MIGRATION_PLAN"
  unset POSTGRES_TARGET_PASSWORD 2>/dev/null || :
}
trap cleanup EXIT HUP INT TERM

export LC_ALL=C

wait_for_target_postgres() {
  : "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"
  POSTGRES_READY=""
  i=0

  echo "[migrate] waiting for the rotated postgres credential (up to 3 minutes)..."
  while [ -z "$POSTGRES_READY" ]; do
    if PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
      psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
      POSTGRES_READY=1
    fi

    [ -z "$POSTGRES_READY" ] || continue
    i=$((i + 1))
    [ "$i" -le 60 ] || {
      echo "[migrate] ERROR: rotated postgres credential never became ready" >&2
      exit 1
    }
    sleep 3
  done
}

build_migration_plan() {
  MIGRATION_PLAN="$(mktemp /tmp/aria-migrations.sql.XXXXXX)"
  {
    cat <<SQL
\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));

do \$aria_migrator_identity\$
declare
  migrator_is_superuser boolean;
  migrator_can_create_database boolean;
  migrator_can_create_role boolean;
  migrator_can_replicate boolean;
  migrator_bypasses_rls boolean;
begin
  select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    into migrator_is_superuser,
         migrator_can_create_database,
         migrator_can_create_role,
         migrator_can_replicate,
         migrator_bypasses_rls
    from pg_roles
   where rolname = current_user;

  if session_user <> 'postgres'
     or current_user <> 'postgres'
     or migrator_is_superuser is not false
     or migrator_can_create_database is not false
     or migrator_can_create_role is not false
     or migrator_can_replicate is not false
     or migrator_bypasses_rls is not false
     or exists (
       select 1
         from pg_auth_members membership
         join pg_roles member_role on member_role.oid = membership.member
        where member_role.rolname = 'postgres'
     ) then
    raise exception 'direct postgres migration session required'
      using errcode = '42501';
  end if;
end
\$aria_migrator_identity\$;

do \$aria_baseline_guard\$
declare
  app_schema_exists boolean := to_regclass('public.workspace_state') is not null;
  ledger_exists boolean := to_regclass('public.aria_schema_migrations') is not null;
  ledger_has_rows boolean := false;
begin
  if app_schema_exists then
    if not ledger_exists then
      raise exception 'existing ARIA schema has no migration ledger; audited baseline required';
    end if;

    execute 'select exists (select 1 from public.aria_schema_migrations)'
      into ledger_has_rows;
    if not ledger_has_rows then
      raise exception 'existing ARIA schema has an empty migration ledger; audited baseline required';
    end if;
  end if;
end
\$aria_baseline_guard\$;

select to_regclass('public.aria_schema_migrations') is null as create_aria_ledger \gset
\if :create_aria_ledger
create table public.aria_schema_migrations (
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
alter table public.aria_schema_migrations enable row level security;
revoke all on public.aria_schema_migrations from public, anon, authenticated;
grant select on public.aria_schema_migrations to service_role;
create policy aria_schema_migrations_migrator_select
  on public.aria_schema_migrations for select to postgres using (true);
create policy aria_schema_migrations_migrator_insert
  on public.aria_schema_migrations for insert to postgres with check (true);
\endif

do \$aria_ledger_contract\$
begin
  if not exists (
    select 1
      from pg_tables
     where schemaname = 'public'
       and tablename = 'aria_schema_migrations'
       and rowsecurity
  ) then
    raise exception 'ARIA migration ledger must have RLS enabled'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from pg_class ledger
      cross join lateral aclexplode(coalesce(ledger.relacl, acldefault('r', ledger.relowner))) acl
      left join pg_roles grantee on grantee.oid = acl.grantee
     where ledger.oid = 'public.aria_schema_migrations'::regclass
       and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'authenticator'))
  ) then
    raise exception 'ARIA migration ledger exposes runtime write or read authority'
      using errcode = '42501';
  end if;
end
\$aria_ledger_contract\$;

SQL

    for file in "$MIGRATIONS_DIR"/0*.sql; do
      [ -f "$file" ] || {
        echo "[migrate] ERROR: no numbered migrations found" >&2
        exit 1
      }
      filename="$(basename "$file")"
      sha256="$(sha256sum "$file" | awk '{print $1}')"
      case "$filename:$sha256" in
        *[!A-Za-z0-9_.:-]*) echo "[migrate] ERROR: invalid migration identity" >&2; exit 1 ;;
      esac
      cat <<SQL
do \$aria\$
begin
  if exists (
    select 1 from public.aria_schema_migrations
    where filename = '$filename' and sha256 <> '$sha256'
  ) then
    raise exception 'migration hash changed: $filename';
  end if;
end
\$aria\$;
select not exists (
  select 1 from public.aria_schema_migrations where filename = '$filename'
) as apply_migration \gset
\if :apply_migration
\echo applying $filename
\ir $file
insert into public.aria_schema_migrations (filename, sha256)
values ('$filename', '$sha256')
on conflict (filename) do nothing;
\else
\echo already applied $filename
\endif
SQL
    done

    cat <<'SQL'
notify pgrst, 'reload schema';
commit;
SQL
  } > "$MIGRATION_PLAN"
}

run_migrations_phase() {
  : "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"

  [ "${POSTGRES_READY:-}" = 1 ] || wait_for_target_postgres
  build_migration_plan
  echo "[migrate] applying serialized numbered migrations..."
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -q -f "$MIGRATION_PLAN"
  echo "[migrate] complete"
}

run_migrations_phase
