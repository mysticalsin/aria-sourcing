#!/bin/sh
set -eu

umask 077

# The mounted volume is also the postgres user's home directory. Interactive
# operator tools must not create dotfiles that can later be mistaken for
# database layout data and prevent a safe restart.
export HISTFILE=/dev/null
export PSQL_HISTORY=/dev/null
export LESSHISTFILE=-

mount_root=/var/lib/postgresql
expected_data_directory=/var/lib/postgresql/data
completion_marker="$expected_data_directory/.aria-init-complete"
completion_marker_pending="$expected_data_directory/.aria-init-complete.pending"
migration_journal="$mount_root/.aria-layout-migration-v1"
migration_journal_pending="$mount_root/.aria-layout-migration-v1.pending"
layout_approval="${ARIA_DB_LAYOUT_MIGRATION_APPROVAL:-}"

required_directories='base global pg_commit_ts pg_dynshmem pg_logical pg_multixact pg_notify pg_replslot pg_serial pg_snapshots pg_stat pg_stat_tmp pg_subtrans pg_tblspc pg_twophase pg_wal pg_xact'
required_files='pg_hba.conf pg_ident.conf postgresql.auto.conf postgresql.conf'
optional_files='postmaster.opts'

fail_layout() {
  echo "ERROR: $*" >&2
  exit 78
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

discard_operator_history_files() {
  local name path
  for name in .psql_history .bash_history .lesshst; do
    path="$mount_root/$name"
    path_exists "$path" || continue
    if [ ! -f "$path" ] || [ -L "$path" ]; then
      fail_layout "PostgreSQL operator history entry is not a regular file: $name"
    fi
    rm -f -- "$path"
  done
}

approval_is_valid() {
  if [ "$(printf '%s\n' "$1" | wc -l)" -ne 1 ]; then
    return 1
  fi
  printf '%s\n' "$1" \
    | grep -Eq '^aria-db-root-to-child-v1:[0-9a-f]{40}:[0-9a-f]{64}$'
}

journal_value() {
  local journal="$1"
  if [ ! -f "$journal" ] || [ -L "$journal" ] \
    || [ "$(wc -l < "$journal")" -ne 1 ]; then
    return 1
  fi
  cat "$journal"
}

root_has_cluster_entries() {
  path_exists "$mount_root/PG_VERSION" \
    || path_exists "$mount_root/base" \
    || path_exists "$mount_root/global" \
    || path_exists "$mount_root/pg_wal"
}

directory_has_entries() {
  local directory="$1" entry
  [ -d "$directory" ] || return 1
  for entry in "$directory"/* "$directory"/.[!.]* "$directory"/..?*; do
    if path_exists "$entry"; then
      return 0
    fi
  done
  return 1
}

validate_mount_directories() {
  local name path
  for name in data lost+found; do
    path="$mount_root/$name"
    if path_exists "$path" && { [ ! -d "$path" ] || [ -L "$path" ]; }; then
      fail_layout "PostgreSQL volume entry must be a real directory: $name"
    fi
  done
}

validate_root_entries_for_migration() {
  local path name
  validate_mount_directories
  for path in "$mount_root"/* "$mount_root"/.[!.]* "$mount_root"/..?*; do
    path_exists "$path" || continue
    name="${path##*/}"
    case " $required_directories $required_files $optional_files PG_VERSION " in
      *" $name "*) ;;
      *)
        case "$name" in
          data|lost+found|.aria-layout-migration-v1|.aria-layout-migration-v1.pending) ;;
          *) fail_layout "unexpected entry exists at the PostgreSQL volume root; inspect the preserved clone" ;;
        esac
        ;;
    esac
  done
}

validate_normal_root_entries() {
  local path name
  validate_mount_directories
  for path in "$mount_root"/* "$mount_root"/.[!.]* "$mount_root"/..?*; do
    path_exists "$path" || continue
    name="${path##*/}"
    case "$name" in
      data|lost+found|.aria-layout-migration-v1|.aria-layout-migration-v1.pending) ;;
      *) fail_layout "unexpected entry exists at the PostgreSQL volume root; inspect the preserved clone" ;;
    esac
  done
}

validate_child_entries_for_migration() {
  local path name
  [ -d "$expected_data_directory" ] || return 0
  for path in "$expected_data_directory"/* "$expected_data_directory"/.[!.]* "$expected_data_directory"/..?*; do
    path_exists "$path" || continue
    name="${path##*/}"
    case " $required_directories $required_files $optional_files PG_VERSION " in
      *" $name "*) ;;
      *)
        case "$name" in
          .aria-init-complete.pending) ;;
          *) fail_layout "unexpected entry exists in the in-progress PostgreSQL child layout" ;;
        esac
        ;;
    esac
  done
}

validate_complete_cluster() {
  local directory="$1" label="$2" name
  if [ ! -f "$directory/PG_VERSION" ] || [ -L "$directory/PG_VERSION" ]; then
    fail_layout "$label PostgreSQL cluster is missing its canonical PG_VERSION file"
  fi
  if ! grep -qx '17' "$directory/PG_VERSION"; then
    fail_layout "$label PostgreSQL cluster must be major version 17"
  fi
  for name in $required_directories; do
    if [ ! -d "$directory/$name" ] || [ -L "$directory/$name" ]; then
      fail_layout "$label PostgreSQL cluster is missing canonical directory: $name"
    fi
  done
  for name in $required_files; do
    if [ ! -f "$directory/$name" ] || [ -L "$directory/$name" ]; then
      fail_layout "$label PostgreSQL cluster is missing canonical file: $name"
    fi
  done
  if [ ! -f "$directory/global/pg_control" ] \
    || [ -L "$directory/global/pg_control" ] \
    || [ ! -s "$directory/global/pg_control" ]; then
    fail_layout "$label PostgreSQL cluster has no canonical global/pg_control"
  fi
  for name in $optional_files; do
    if path_exists "$directory/$name" \
      && { [ ! -f "$directory/$name" ] || [ -L "$directory/$name" ]; }; then
      fail_layout "$label PostgreSQL cluster has a non-canonical optional file: $name"
    fi
  done
}

validate_split_cluster() {
  local name source destination source_present destination_present selected
  validate_root_entries_for_migration
  validate_child_entries_for_migration

  for name in $required_directories $required_files PG_VERSION; do
    source="$mount_root/$name"
    destination="$expected_data_directory/$name"
    source_present=0
    destination_present=0
    path_exists "$source" && source_present=1
    path_exists "$destination" && destination_present=1
    if [ "$source_present" -eq 1 ] && [ "$destination_present" -eq 1 ]; then
      fail_layout "layout migration would overwrite an existing PostgreSQL child entry: $name"
    fi
    if [ "$source_present" -eq 0 ] && [ "$destination_present" -eq 0 ]; then
      fail_layout "legacy PostgreSQL cluster is missing canonical entry: $name"
    fi
    if [ "$source_present" -eq 1 ]; then selected="$source"; else selected="$destination"; fi
    case " $required_directories " in
      *" $name "*)
        if [ ! -d "$selected" ] || [ -L "$selected" ]; then
          fail_layout "legacy PostgreSQL cluster has a non-canonical directory: $name"
        fi
        ;;
      *)
        if [ ! -f "$selected" ] || [ -L "$selected" ]; then
          fail_layout "legacy PostgreSQL cluster has a non-canonical file: $name"
        fi
        ;;
    esac
  done

  if path_exists "$mount_root/postmaster.opts" \
    && path_exists "$expected_data_directory/postmaster.opts"; then
    fail_layout "layout migration would overwrite an existing PostgreSQL child entry: postmaster.opts"
  fi
  for selected in "$mount_root/postmaster.opts" "$expected_data_directory/postmaster.opts"; do
    if path_exists "$selected" && { [ ! -f "$selected" ] || [ -L "$selected" ]; }; then
      fail_layout "legacy PostgreSQL cluster has a non-canonical optional file: postmaster.opts"
    fi
  done

  if path_exists "$mount_root/PG_VERSION"; then selected="$mount_root/PG_VERSION"; else selected="$expected_data_directory/PG_VERSION"; fi
  if ! grep -qx '17' "$selected"; then
    fail_layout "legacy PostgreSQL cluster must be major version 17"
  fi
  if [ -d "$mount_root/global" ]; then selected="$mount_root/global/pg_control"; else selected="$expected_data_directory/global/pg_control"; fi
  if [ ! -f "$selected" ] || [ -L "$selected" ] || [ ! -s "$selected" ]; then
    fail_layout "legacy PostgreSQL cluster has no canonical global/pg_control"
  fi
}

require_layout_approval() {
  if [ -z "$layout_approval" ]; then
    fail_layout "explicit layout migration approval is required"
  fi
  if ! approval_is_valid "$layout_approval"; then
    fail_layout "layout migration approval is invalid"
  fi
}

validate_journal_approval() {
  local stored
  if ! stored="$(journal_value "$migration_journal")"; then
    fail_layout "layout migration journal is missing or non-canonical"
  fi
  if [ "$stored" != "$layout_approval" ]; then
    fail_layout "approval does not match the in-progress layout migration"
  fi
}

start_migration_journal() {
  if path_exists "$migration_journal" || path_exists "$migration_journal_pending"; then
    fail_layout "layout migration journal already exists"
  fi
  printf '%s\n' "$layout_approval" > "$migration_journal_pending"
  chmod 0600 "$migration_journal_pending"
  sync
  mv "$migration_journal_pending" "$migration_journal"
  sync
}

resume_pending_journal() {
  local stored
  if path_exists "$migration_journal"; then
    fail_layout "layout migration journal and pending journal both exist"
  fi
  if ! stored="$(journal_value "$migration_journal_pending")" \
    || [ "$stored" != "$layout_approval" ]; then
    fail_layout "approval does not match the pending layout migration journal"
  fi
  if path_exists "$expected_data_directory"; then
    fail_layout "pending layout migration journal has an ambiguous child layout"
  fi
  mv "$migration_journal_pending" "$migration_journal"
  sync
}

move_cluster_to_child() {
  local name source destination
  for name in $required_directories $required_files $optional_files PG_VERSION; do
    source="$mount_root/$name"
    destination="$expected_data_directory/$name"
    if path_exists "$source"; then
      if path_exists "$destination"; then
        fail_layout "layout migration would overwrite an existing PostgreSQL child entry: $name"
      fi
      mv "$source" "$destination"
    fi
  done
}

finalize_layout_migration() {
  local name
  validate_complete_cluster "$expected_data_directory" "migrated"
  for name in $required_directories $required_files $optional_files PG_VERSION; do
    if path_exists "$mount_root/$name"; then
      fail_layout "legacy PostgreSQL entry remained at the volume root after migration: $name"
    fi
  done
  sync

  if path_exists "$completion_marker"; then
    fail_layout "completion marker existed before the layout migration was verified"
  fi
  if path_exists "$completion_marker_pending"; then
    if [ ! -f "$completion_marker_pending" ] \
      || [ -L "$completion_marker_pending" ] \
      || ! grep -qx 'aria-db-init-v1' "$completion_marker_pending"; then
      fail_layout "pending completion marker is invalid"
    fi
  else
    printf 'aria-db-init-v1\n' > "$completion_marker_pending"
    chmod 0600 "$completion_marker_pending"
    sync
  fi
  mv "$completion_marker_pending" "$completion_marker"
  sync
  rm -f "$migration_journal"
  sync
}

cleanup_completed_journal() {
  local stored
  if path_exists "$migration_journal" && path_exists "$migration_journal_pending"; then
    fail_layout "layout migration journal and pending journal both exist after completion"
  fi
  for stored in "$migration_journal" "$migration_journal_pending"; do
    path_exists "$stored" || continue
    if ! approval_is_valid "$(journal_value "$stored")"; then
      fail_layout "completed layout has an invalid migration journal"
    fi
    rm -f "$stored"
    sync
  done
}

if [ "${PGDATA:-$expected_data_directory}" != "$expected_data_directory" ]; then
  fail_layout "PGDATA must match the Supabase PostgreSQL data_directory: $expected_data_directory"
fi

discard_operator_history_files

# The exact completion marker makes the child layout self-authenticating for
# ordinary restarts. The one-shot approval is deliberately ignored here.
if [ -f "$expected_data_directory/PG_VERSION" ] \
  && [ ! -L "$completion_marker" ] \
  && grep -qx 'aria-db-init-v1' "$completion_marker" 2>/dev/null; then
  validate_complete_cluster "$expected_data_directory" "child"
  if root_has_cluster_entries; then
    fail_layout "completed child and legacy root PostgreSQL clusters both exist"
  fi
  if path_exists "$completion_marker_pending"; then
    fail_layout "completed child has an unexpected pending completion marker"
  fi
  validate_normal_root_entries
  cleanup_completed_journal
  exec /usr/local/bin/docker-entrypoint.sh "$@"
fi

if path_exists "$completion_marker"; then
  fail_layout "incomplete PostgreSQL initialization detected; completion marker does not match a canonical child cluster"
fi

if root_has_cluster_entries; then
  validate_root_entries_for_migration
  if ! path_exists "$migration_journal" && ! path_exists "$migration_journal_pending"; then
    if directory_has_entries "$expected_data_directory" || [ -d "$expected_data_directory" ]; then
      fail_layout "ambiguous PostgreSQL layout exists without a migration journal"
    fi
    require_layout_approval
    validate_complete_cluster "$mount_root" "legacy"
    start_migration_journal
  fi
else
  validate_normal_root_entries
  if ! path_exists "$migration_journal" && ! path_exists "$migration_journal_pending"; then
    if path_exists "$expected_data_directory/PG_VERSION"; then
      fail_layout "incomplete PostgreSQL initialization detected; restore or validate a preserved clone before startup"
    fi
    exec /usr/local/bin/docker-entrypoint.sh "$@"
  fi
fi

require_layout_approval
if path_exists "$migration_journal_pending"; then
  resume_pending_journal
fi
validate_journal_approval

if [ ! -d "$expected_data_directory" ]; then
  mkdir "$expected_data_directory"
  chown postgres:postgres "$expected_data_directory"
  chmod 0700 "$expected_data_directory"
elif [ -L "$expected_data_directory" ]; then
  fail_layout "PostgreSQL child layout must be a real directory"
fi

validate_split_cluster
move_cluster_to_child
finalize_layout_migration

exec /usr/local/bin/docker-entrypoint.sh "$@"
