#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${GRAPHIFY_IMAGE:-aria-graphify-lessons:test}"
OUTPUT_VOLUME="aria-graphify-lessons-test-$$-${RANDOM}"
cleanup() {
  docker volume rm -f "$OUTPUT_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The Dockerfile pins its base by immutable digest. Avoid an unnecessary tag
# refresh here so a registry outage cannot silently substitute another base.
if [ -z "${GRAPHIFY_IMAGE:-}" ]; then
  docker build --tag "$IMAGE" "$ROOT/workers/graphify-lessons"
fi

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 512m \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700 \
  --volume "$ROOT/workers/graphify-lessons:/tests:ro" \
  --entrypoint python \
  "$IMAGE" \
  -m unittest discover -s /tests -p test_worker.py -v

# Docker Desktop presents bind-mounted macOS directories as root-owned 0755,
# even after a host chmod. Use an ephemeral managed volume so the production
# worker still runs as its declared uid 10001 rather than weakening the test.
docker volume create "$OUTPUT_VOLUME" >/dev/null
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --cap-add CHOWN \
  --security-opt no-new-privileges \
  --user 0:0 \
  --volume "$OUTPUT_VOLUME:/data/output:rw" \
  --entrypoint chown \
  "$IMAGE" \
  10001:10001 /data/output

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 512m \
  --cpus 1 \
  --volume "$ROOT/tests/fixtures/graphify-lessons-input.json:/data/input.json:ro" \
  --volume "$OUTPUT_VOLUME:/data/output:rw" \
  "$IMAGE"

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 32 \
  --memory 128m \
  --cpus 0.5 \
  --volume "$OUTPUT_VOLUME:/data/output:ro" \
  --entrypoint python \
  "$IMAGE" \
  -c '
import json
from pathlib import Path

manifest = json.loads(Path("/data/output/manifest.json").read_text(encoding="utf-8"))
graph = json.loads(Path("/data/output/graph.json").read_text(encoding="utf-8"))
commit = "94d3099540550d58dd121ec3e67cf93e80364079"
assert manifest.get("status") == "ok"
assert manifest.get("graphify", {}).get("commit") == commit
assert manifest.get("graphify", {}).get("semanticLlmUsed") is False
assert manifest.get("graphify", {}).get("queryLoggingDisabled") is True
assert graph.get("built_at_commit") == commit
assert graph.get("directed") is True
attachment = manifest.get("attachments", [{}])[0]
assert attachment.get("lessonId") == "018f47d2-9d32-7a54-8f21-4aa937c604e9"
assert attachment.get("expectedVersion") == 1
print("RESULT graphify-learning-container: exact-runtime=pass network-none=pass receipt=pass")
'
