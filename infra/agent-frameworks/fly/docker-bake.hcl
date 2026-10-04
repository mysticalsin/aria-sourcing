variable "FLY_WRAPPER_REGISTRY" {
  default = "registry.invalid/aria-agent-frameworks"
}
variable "POSTGRES_UPSTREAM_IMAGE" {}
variable "REDIS_UPSTREAM_IMAGE" {}
variable "DEERFLOW_UPSTREAM_IMAGE" {}
variable "FLOWISE_UPSTREAM_IMAGE" {}
variable "FLOWISE_WORKER_UPSTREAM_IMAGE" {}
variable "ADAPTER_UPSTREAM_IMAGE" {}
variable "MODEL_GATEWAY_UPSTREAM_IMAGE" {}

group "default" {
  targets = ["postgres", "redis", "deerflow", "flowise", "flowise-worker", "adapter", "model-gateway"]
}

target "postgres" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/postgres.Dockerfile"
  args = { UPSTREAM_IMAGE = "${POSTGRES_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/postgres:aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "redis" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/redis.Dockerfile"
  args = { UPSTREAM_IMAGE = "${REDIS_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/redis:aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "deerflow" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/deerflow.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${DEERFLOW_UPSTREAM_IMAGE}"
    DEERFLOW_PATCHED_RUNS_SHA256 = "79b6601066faa937a2d0b5551f7e1a5311304f1e7b28962c1ccee72cea05d6e7"
    DEERFLOW_CLEANUP_GUARD_SHA256 = "4e4b0006ad7486b5b028dfa9168e3e45d26d33eca46e7b653db29db4683918e6"
    DEERFLOW_RUNTIME_POLICY_SHA256 = "9312dff2f23f04fc8c2a92600d47d8d4958094e4c37e010c10ff1e011dce6025"
    DEERFLOW_RUNTIME_CONFIG_SHA256 = "a5a41ab4a2772e74203820d65a6efb488bc3b6a5948c47a8d1f9dd6cd3a30369"
    DEERFLOW_DATABASE_BACKEND = "memory"
    DEERFLOW_RUN_EVENTS_BACKEND = "memory"
    DEERFLOW_STREAM_BRIDGE_TYPE = "memory"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/deerflow:fabadae4168db81f0eaaf62f209050f978e2f691-aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "flowise" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/flowise.Dockerfile"
  args = { UPSTREAM_IMAGE = "${FLOWISE_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/flowise:bb773ffa710bd22639c4ba2643413a0ea2b679d3-aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "flowise-worker" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/flowise-worker.Dockerfile"
  args = { UPSTREAM_IMAGE = "${FLOWISE_WORKER_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/flowise-worker:bb773ffa710bd22639c4ba2643413a0ea2b679d3-aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "adapter" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/adapter.Dockerfile"
  args = { UPSTREAM_IMAGE = "${ADAPTER_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/adapter:aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
target "model-gateway" {
  context = "."
  dockerfile = "infra/agent-frameworks/fly/runtime/model-gateway.Dockerfile"
  args = { UPSTREAM_IMAGE = "${MODEL_GATEWAY_UPSTREAM_IMAGE}" }
  tags = ["${FLY_WRAPPER_REGISTRY}/model-gateway:aria-fly-v1"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
