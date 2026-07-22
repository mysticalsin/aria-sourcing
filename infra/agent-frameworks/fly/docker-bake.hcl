variable "FLY_WRAPPER_REGISTRY" {
  default = "registry.invalid/aria-agent-frameworks"
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{2,383}$", FLY_WRAPPER_REGISTRY))
    error_message = "FLY_WRAPPER_REGISTRY is invalid."
  }
}
variable "POSTGRES_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", POSTGRES_UPSTREAM_IMAGE))
    error_message = "POSTGRES_UPSTREAM_IMAGE must be immutable."
  }
}
variable "REDIS_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", REDIS_UPSTREAM_IMAGE))
    error_message = "REDIS_UPSTREAM_IMAGE must be immutable."
  }
}
variable "DEERFLOW_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", DEERFLOW_UPSTREAM_IMAGE))
    error_message = "DEERFLOW_UPSTREAM_IMAGE must be immutable."
  }
}
variable "FLOWISE_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", FLOWISE_UPSTREAM_IMAGE))
    error_message = "FLOWISE_UPSTREAM_IMAGE must be immutable."
  }
}
variable "FLOWISE_WORKER_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", FLOWISE_WORKER_UPSTREAM_IMAGE))
    error_message = "FLOWISE_WORKER_UPSTREAM_IMAGE must be immutable."
  }
}
variable "FLOWISE_RUNTIME_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", FLOWISE_RUNTIME_IMAGE))
    error_message = "FLOWISE_RUNTIME_IMAGE must be immutable."
  }
}
variable "FLOWISE_PNPM_LOCK_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", FLOWISE_PNPM_LOCK_SHA256))
    error_message = "FLOWISE_PNPM_LOCK_SHA256 is invalid."
  }
}
variable "ADAPTER_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", ADAPTER_UPSTREAM_IMAGE))
    error_message = "ADAPTER_UPSTREAM_IMAGE must be immutable."
  }
}
variable "MODEL_GATEWAY_UPSTREAM_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", MODEL_GATEWAY_UPSTREAM_IMAGE))
    error_message = "MODEL_GATEWAY_UPSTREAM_IMAGE must be immutable."
  }
}
variable "DEERFLOW_BUILD_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", DEERFLOW_BUILD_IMAGE))
    error_message = "DEERFLOW_BUILD_IMAGE must be immutable."
  }
}
variable "DEERFLOW_UV_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", DEERFLOW_UV_IMAGE))
    error_message = "DEERFLOW_UV_IMAGE must be immutable."
  }
}
variable "DEERFLOW_UV_LOCK_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", DEERFLOW_UV_LOCK_SHA256))
    error_message = "DEERFLOW_UV_LOCK_SHA256 is invalid."
  }
}
variable "DEERFLOW_PATCHED_RUNS_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", DEERFLOW_PATCHED_RUNS_SHA256))
    error_message = "DEERFLOW_PATCHED_RUNS_SHA256 is invalid."
  }
}
variable "DEERFLOW_CLEANUP_GUARD_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", DEERFLOW_CLEANUP_GUARD_SHA256))
    error_message = "DEERFLOW_CLEANUP_GUARD_SHA256 is invalid."
  }
}
variable "DEERFLOW_RUNTIME_POLICY_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", DEERFLOW_RUNTIME_POLICY_SHA256))
    error_message = "DEERFLOW_RUNTIME_POLICY_SHA256 is invalid."
  }
}
variable "DEERFLOW_RUNTIME_CONFIG_SHA256" {
  validation {
    condition = can(regex("^[0-9a-f]{64}$", DEERFLOW_RUNTIME_CONFIG_SHA256))
    error_message = "DEERFLOW_RUNTIME_CONFIG_SHA256 is invalid."
  }
}
variable "DEERFLOW_DATABASE_BACKEND" {
  validation {
    condition = DEERFLOW_DATABASE_BACKEND == "memory"
    error_message = "DEERFLOW_DATABASE_BACKEND must be memory."
  }
}
variable "DEERFLOW_RUN_EVENTS_BACKEND" {
  validation {
    condition = DEERFLOW_RUN_EVENTS_BACKEND == "memory"
    error_message = "DEERFLOW_RUN_EVENTS_BACKEND must be memory."
  }
}
variable "DEERFLOW_STREAM_BRIDGE_TYPE" {
  validation {
    condition = DEERFLOW_STREAM_BRIDGE_TYPE == "memory"
    error_message = "DEERFLOW_STREAM_BRIDGE_TYPE must be memory."
  }
}
variable "RELEASE_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", RELEASE_SOURCE_COMMIT))
    error_message = "RELEASE_SOURCE_COMMIT is invalid."
  }
}
variable "POSTGRES_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", POSTGRES_SOURCE_COMMIT))
    error_message = "POSTGRES_SOURCE_COMMIT is invalid."
  }
}
variable "REDIS_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", REDIS_SOURCE_COMMIT))
    error_message = "REDIS_SOURCE_COMMIT is invalid."
  }
}
variable "DEERFLOW_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", DEERFLOW_SOURCE_COMMIT))
    error_message = "DEERFLOW_SOURCE_COMMIT is invalid."
  }
}
variable "FLOWISE_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", FLOWISE_SOURCE_COMMIT))
    error_message = "FLOWISE_SOURCE_COMMIT is invalid."
  }
}

group "default" {
  targets = ["postgres", "redis", "deerflow", "flowise", "flowise-worker", "adapter", "model-gateway"]
}

target "release" {
  platforms = ["linux/amd64"]
  secret = ["id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN"]
  attest = ["type=provenance,mode=max"]
}

target "postgres" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/postgres.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${POSTGRES_UPSTREAM_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${POSTGRES_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/postgres:aria-fly-v1"]
}
target "redis" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/redis.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${REDIS_UPSTREAM_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${REDIS_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/redis:aria-fly-v1"]
}
target "deerflow" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/upstream/deerflow.Dockerfile"
  contexts = {
    deerflow_source = "https://github.com/bytedance/deer-flow.git#${DEERFLOW_SOURCE_COMMIT}"
  }
  args = {
    UPSTREAM_IMAGE = "${DEERFLOW_UPSTREAM_IMAGE}"
    DEERFLOW_BUILD_IMAGE = "${DEERFLOW_BUILD_IMAGE}"
    DEERFLOW_UV_IMAGE = "${DEERFLOW_UV_IMAGE}"
    DEERFLOW_UV_LOCK_SHA256 = "${DEERFLOW_UV_LOCK_SHA256}"
    DEERFLOW_PATCHED_RUNS_SHA256 = "${DEERFLOW_PATCHED_RUNS_SHA256}"
    DEERFLOW_CLEANUP_GUARD_SHA256 = "${DEERFLOW_CLEANUP_GUARD_SHA256}"
    DEERFLOW_RUNTIME_POLICY_SHA256 = "${DEERFLOW_RUNTIME_POLICY_SHA256}"
    DEERFLOW_RUNTIME_CONFIG_SHA256 = "${DEERFLOW_RUNTIME_CONFIG_SHA256}"
    DEERFLOW_DATABASE_BACKEND = "${DEERFLOW_DATABASE_BACKEND}"
    DEERFLOW_RUN_EVENTS_BACKEND = "${DEERFLOW_RUN_EVENTS_BACKEND}"
    DEERFLOW_STREAM_BRIDGE_TYPE = "${DEERFLOW_STREAM_BRIDGE_TYPE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${DEERFLOW_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/deerflow:${DEERFLOW_SOURCE_COMMIT}-aria-fly-v1"]
}
target "flowise" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/upstream/flowise.Dockerfile"
  target = "server"
  contexts = {
    flowise_source = "https://github.com/FlowiseAI/Flowise.git#${FLOWISE_SOURCE_COMMIT}"
  }
  args = {
    UPSTREAM_IMAGE = "${FLOWISE_UPSTREAM_IMAGE}"
    RUNTIME_IMAGE = "${FLOWISE_RUNTIME_IMAGE}"
    FLOWISE_PNPM_LOCK_SHA256 = "${FLOWISE_PNPM_LOCK_SHA256}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${FLOWISE_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/flowise:${FLOWISE_SOURCE_COMMIT}-aria-fly-v1"]
}
target "flowise-worker" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/upstream/flowise.Dockerfile"
  target = "worker"
  contexts = {
    flowise_source = "https://github.com/FlowiseAI/Flowise.git#${FLOWISE_SOURCE_COMMIT}"
  }
  args = {
    UPSTREAM_IMAGE = "${FLOWISE_WORKER_UPSTREAM_IMAGE}"
    RUNTIME_IMAGE = "${FLOWISE_RUNTIME_IMAGE}"
    FLOWISE_PNPM_LOCK_SHA256 = "${FLOWISE_PNPM_LOCK_SHA256}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${FLOWISE_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/flowise-worker:${FLOWISE_SOURCE_COMMIT}-aria-fly-v1"]
}
target "adapter" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/adapter.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${ADAPTER_UPSTREAM_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/adapter:aria-fly-v1"]
}
target "model-gateway" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/model-gateway.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${MODEL_GATEWAY_UPSTREAM_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
  }
  tags = ["${FLY_WRAPPER_REGISTRY}/model-gateway:aria-fly-v1"]
}
