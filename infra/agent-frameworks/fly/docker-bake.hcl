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
  args = { UPSTREAM_IMAGE = "${DEERFLOW_UPSTREAM_IMAGE}" }
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
