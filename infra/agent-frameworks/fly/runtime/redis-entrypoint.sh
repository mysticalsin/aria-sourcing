#!/bin/sh
set -eu

password="$(tr -d '\r\n' < "${ARIA_REDIS_PASSWORD_FILE:?ARIA_REDIS_PASSWORD_FILE is required}")"
case "$password" in
  ''|*[!A-Za-z0-9_-]*) exit 64 ;;
esac
test "${#password}" -ge 32

install -d -m 0700 -o redis -g redis /run/aria-redis
chown -R redis:redis /data
{
  printf 'bind 0.0.0.0 ::\n'
  printf 'protected-mode yes\n'
  printf 'appendonly yes\nappendfsync everysec\n'
  printf 'requirepass %s\n' "$password"
  printf 'maxmemory %s\n' "${ARIA_REDIS_MAXMEMORY:-384mb}"
  printf 'maxmemory-policy noeviction\n'
} > /run/aria-redis/redis.conf
chown redis:redis /run/aria-redis/redis.conf
chmod 0600 /run/aria-redis/redis.conf

exec gosu redis redis-server /run/aria-redis/redis.conf
