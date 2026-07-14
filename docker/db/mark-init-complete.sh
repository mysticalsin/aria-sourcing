#!/bin/sh
set -eu

marker="${PGDATA:?PGDATA is required}/.aria-init-complete"
temporary_marker="${marker}.$$"
cleanup() { rm -f "$temporary_marker"; }
trap cleanup EXIT HUP INT TERM

umask 077
printf 'aria-db-init-v1\n' > "$temporary_marker"
mv "$temporary_marker" "$marker"
sync
