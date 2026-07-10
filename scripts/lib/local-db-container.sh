#!/usr/bin/env bash

# Resolve only the running Compose `db` service owned by this checkout. Docker
# contexts over TCP/SSH and containers from other projects are rejected.
resolve_local_db_container() {
  local explicit="${1:-}"
  local docker_host=""
  local cid=""
  local labels=""
  local expected_dir
  expected_dir="$(pwd -P)"

  if ! docker_host="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"; then
    echo "Cannot inspect the active Docker context." >&2
    return 1
  fi
  case "$docker_host" in
    unix://*|npipe://*) ;;
    *) echo "Docker context is not local; refusing database access." >&2; return 1 ;;
  esac

  if [ -n "$explicit" ]; then
    cid="$explicit"
  elif ! cid="$(docker compose ps -q db 2>/dev/null)" || [ -z "$cid" ]; then
    echo "This checkout's Compose db service is not running." >&2
    return 1
  fi
  cid="${cid%%$'\n'*}"

  if ! labels="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{.State.Running}}|{{.Config.Image}}' "$cid" 2>/dev/null)"; then
    echo "Database container does not exist: $cid" >&2
    return 1
  fi
  case "$labels" in
    "$expected_dir|db|true|"*postgres*) ;;
    *) echo "Container is not this checkout's running Compose db service." >&2; return 1 ;;
  esac

  printf '%s\n' "$cid"
}
