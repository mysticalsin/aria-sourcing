#!/bin/sh
set -eu

test -r "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE is required}"

# The official entrypoint may start as root only to fix fresh Fly-volume
# ownership. It then executes the PostgreSQL server as the postgres account.
exec /usr/local/bin/docker-entrypoint.sh "$@" \
  -c "listen_addresses=*" \
  -c "password_encryption=scram-sha-256" \
  -c "max_connections=100" \
  -c "shared_buffers=256MB" \
  -c "work_mem=4MB"
