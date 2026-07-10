#!/usr/bin/env bash

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    echo "No SHA-256 utility is available." >&2
    return 1
  fi
}

sha256_stream() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{ print $1 }'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{ print $1 }'
  else
    echo "No SHA-256 utility is available." >&2
    return 1
  fi
}

manifest_query() {
  local cid="$1"
  local database="$2"
  local sql="$3"
  docker exec -i "$cid" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -tA -c "$sql"
}

# Generate metadata only: exact normalized schema/policy/function digests,
# migration versions, RLS states, and row counts. No row values leave Postgres.
write_db_manifest() {
  local cid="$1"
  local database="$2"
  local backup_id="$3"
  local archive_sha="$4"
  local output="$5"
  local schema_sha public_tables all_tables all_sequences rls_state policy_md5 function_md5 migrations
  local table_ref sequence_ref schema_name object_name count sequence_state
  local -a manifest_tables manifest_sequences

  schema_sha="$(
    docker exec "$cid" pg_dump -U postgres --schema-only --no-owner --no-privileges "$database" |
      sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' -e '/^-- Dumped from /d' -e '/^-- Dumped by /d' |
      sha256_stream
  )"
  public_tables="$(manifest_query "$cid" "$database" "select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname = 'public';" | tr -d '[:space:]')"
  all_tables="$(manifest_query "$cid" "$database" "select coalesce(string_agg(schemaname || '.' || tablename, ',' order by schemaname, tablename), '') from pg_tables where schemaname not in ('pg_catalog', 'information_schema') and schemaname !~ '^pg_toast';" | tr -d '[:space:]')"
  all_sequences="$(manifest_query "$cid" "$database" "select coalesce(string_agg(schemaname || '.' || sequencename, ',' order by schemaname, sequencename), '') from pg_sequences where schemaname not in ('pg_catalog', 'information_schema') and schemaname !~ '^pg_toast';" | tr -d '[:space:]')"
  rls_state="$(manifest_query "$cid" "$database" "select coalesce(string_agg(tablename || ':' || rowsecurity::text, ',' order by tablename), '') from pg_tables where schemaname = 'public';" | tr -d '[:space:]')"
  policy_md5="$(manifest_query "$cid" "$database" "select md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\\n' order by schemaname, tablename, policyname), '')) from pg_policies where schemaname in ('public', 'auth');" | tr -d '[:space:]')"
  function_md5="$(manifest_query "$cid" "$database" "select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || pg_get_functiondef(p.oid), E'\\n' order by p.oid::regprocedure::text), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';" | tr -d '[:space:]')"
  migrations="$(manifest_query "$cid" "$database" "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations;" | tr -d '[:space:]')"

  {
    printf 'manifest_version=2\n'
    printf 'backup_id=%s\n' "$backup_id"
    printf 'archive_sha256=%s\n' "$archive_sha"
    printf 'schema_sha256=%s\n' "$schema_sha"
    printf 'public_tables=%s\n' "$public_tables"
    printf 'all_tables=%s\n' "$all_tables"
    printf 'all_sequences=%s\n' "$all_sequences"
    printf 'rls_state=%s\n' "$rls_state"
    printf 'policy_md5=%s\n' "$policy_md5"
    printf 'function_md5=%s\n' "$function_md5"
    printf 'migration_versions=%s\n' "$migrations"
    IFS=',' read -r -a manifest_tables <<< "$all_tables"
    for table_ref in "${manifest_tables[@]}"; do
      [ -n "$table_ref" ] || continue
      schema_name="${table_ref%%.*}"
      object_name="${table_ref#*.}"
      [[ "$schema_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$object_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Unsafe table name in manifest." >&2; return 1; }
      count="$(manifest_query "$cid" "$database" "select count(*) from \"${schema_name}\".\"${object_name}\";" | tr -d '[:space:]')"
      printf 'row_count.%s.%s=%s\n' "$schema_name" "$object_name" "$count"
    done
    IFS=',' read -r -a manifest_sequences <<< "$all_sequences"
    for sequence_ref in "${manifest_sequences[@]}"; do
      [ -n "$sequence_ref" ] || continue
      schema_name="${sequence_ref%%.*}"
      object_name="${sequence_ref#*.}"
      [[ "$schema_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$object_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Unsafe sequence name in manifest." >&2; return 1; }
      sequence_state="$(manifest_query "$cid" "$database" "select last_value::text || ':' || is_called::text from \"${schema_name}\".\"${object_name}\";" | tr -d '[:space:]')"
      printf 'sequence_state.%s.%s=%s\n' "$schema_name" "$object_name" "$sequence_state"
    done
  } > "$output"
}
