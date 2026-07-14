#!/bin/sh
set -eu

encode() {
  python -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))'
}

db_password="$(encode < "${DEERFLOW_DATABASE_PASSWORD_FILE:?DEERFLOW_DATABASE_PASSWORD_FILE is required}")"
redis_password="$(encode < "${DEERFLOW_REDIS_PASSWORD_FILE:?DEERFLOW_REDIS_PASSWORD_FILE is required}")"
export DEERFLOW_DATABASE_URL="postgresql://deerflow:${db_password}@${DEERFLOW_DATABASE_HOST:?DEERFLOW_DATABASE_HOST is required}:5432/deerflow"
export DEERFLOW_STREAM_BRIDGE_REDIS_URL="redis://default:${redis_password}@${DEERFLOW_STREAM_BRIDGE_REDIS_HOST:?DEERFLOW_STREAM_BRIDGE_REDIS_HOST is required}:6379/0"
export DEERFLOW_MODEL_API_KEY="$(tr -d '\r\n' < "${DEERFLOW_MODEL_API_KEY_FILE:?DEERFLOW_MODEL_API_KEY_FILE is required}")"
export DEER_FLOW_INTERNAL_AUTH_TOKEN="$(tr -d '\r\n' < "${DEER_FLOW_INTERNAL_AUTH_TOKEN_FILE:?DEER_FLOW_INTERNAL_AUTH_TOKEN_FILE is required}")"

cd /app/backend
exec env PYTHONPATH=. uv run --no-sync uvicorn app.gateway.app:app \
  --host "${DEERFLOW_BIND_HOST:?DEERFLOW_BIND_HOST is required}" --port 8001 --workers 1
