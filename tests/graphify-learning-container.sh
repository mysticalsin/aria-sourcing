#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
IMAGE="aria-graphify-lessons:test"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/output"
chmod 0777 "$WORK/output"

# The Dockerfile pins its base by immutable digest. Avoid an unnecessary tag
# refresh here so a registry outage cannot silently substitute another base.
docker build --tag "$IMAGE" "$ROOT/workers/graphify-lessons"
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 512m \
  --cpus 1 \
  --volume "$ROOT/tests/fixtures/graphify-lessons-input.json:/data/input.json:ro" \
  --volume "$WORK/output:/data/output:rw" \
  "$IMAGE"

node - "$WORK/output/manifest.json" "$WORK/output/graph.json" <<'NODE'
const fs = require("node:fs");
const [manifestPath, graphPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const commit = "94d3099540550d58dd121ec3e67cf93e80364079";
if (
  manifest?.status !== "ok" ||
  manifest?.graphify?.commit !== commit ||
  manifest?.graphify?.semanticLlmUsed !== false ||
  manifest?.graphify?.queryLoggingDisabled !== true ||
  graph?.built_at_commit !== commit ||
  graph?.directed !== true ||
  manifest?.attachments?.[0]?.lessonId !== "018f47d2-9d32-7a54-8f21-4aa937c604e9" ||
  manifest?.attachments?.[0]?.expectedVersion !== 1
) {
  throw new Error("Graphify container receipt is invalid");
}
console.log("RESULT graphify-learning-container: exact-runtime=pass network-none=pass receipt=pass");
NODE
