variable "REGISTRY" {
  default = "registry.invalid/aria-agent-frameworks"
}
variable "RELEASE_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", RELEASE_SOURCE_COMMIT))
    error_message = "RELEASE_SOURCE_COMMIT must be an exact lowercase Git commit."
  }
}
variable "DEERFLOW_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", DEERFLOW_SOURCE_COMMIT))
    error_message = "DEERFLOW_SOURCE_COMMIT must be an exact lowercase Git commit."
  }
}
variable "FLOWISE_SOURCE_COMMIT" {
  validation {
    condition = can(regex("^[0-9a-f]{40}$", FLOWISE_SOURCE_COMMIT))
    error_message = "FLOWISE_SOURCE_COMMIT must be an exact lowercase Git commit."
  }
}

variable "NODE_22_RUNTIME_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", NODE_22_RUNTIME_IMAGE))
    error_message = "NODE_22_RUNTIME_IMAGE must be immutable."
  }
}
variable "DEERFLOW_RUNTIME_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", DEERFLOW_RUNTIME_IMAGE))
    error_message = "DEERFLOW_RUNTIME_IMAGE must be immutable."
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

variable "FLOWISE_NODE_IMAGE" {
  validation {
    condition = can(regex("^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$", FLOWISE_NODE_IMAGE))
    error_message = "FLOWISE_NODE_IMAGE must be immutable."
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

group "default" {
  targets = ["adapter", "model-gateway", "deerflow", "flowise", "flowise-worker"]
}

target "release" {
  platforms = ["linux/amd64"]
  secret = ["id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN"]
  attest = ["type=provenance,mode=max"]
}

target "adapter" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/adapter.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${NODE_22_RUNTIME_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
  }
  tags = ["${REGISTRY}/aria-framework-adapter:${RELEASE_SOURCE_COMMIT}"]
}

target "model-gateway" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/fly/runtime/model-gateway.Dockerfile"
  args = {
    UPSTREAM_IMAGE = "${NODE_22_RUNTIME_IMAGE}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
  }
  tags = ["${REGISTRY}/aria-model-gateway:${RELEASE_SOURCE_COMMIT}"]
}

target "deerflow" {
  inherits = ["release"]
  context = "https://github.com/mysticalsin/aria-sourcing.git#${RELEASE_SOURCE_COMMIT}"
  dockerfile = "infra/agent-frameworks/upstream/deerflow.Dockerfile"
  contexts = {
    deerflow_source = "https://github.com/bytedance/deer-flow.git#${DEERFLOW_SOURCE_COMMIT}"
  }
  args = {
    UPSTREAM_IMAGE = "${DEERFLOW_RUNTIME_IMAGE}"
    DEERFLOW_BUILD_IMAGE = "${DEERFLOW_BUILD_IMAGE}"
    DEERFLOW_UV_IMAGE = "${DEERFLOW_UV_IMAGE}"
    DEERFLOW_UV_LOCK_SHA256 = "${DEERFLOW_UV_LOCK_SHA256}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${DEERFLOW_SOURCE_COMMIT}"
    DEERFLOW_PATCHED_RUNS_SHA256 = "${DEERFLOW_PATCHED_RUNS_SHA256}"
    DEERFLOW_CLEANUP_GUARD_SHA256 = "${DEERFLOW_CLEANUP_GUARD_SHA256}"
    DEERFLOW_RUNTIME_POLICY_SHA256 = "${DEERFLOW_RUNTIME_POLICY_SHA256}"
    DEERFLOW_RUNTIME_CONFIG_SHA256 = "${DEERFLOW_RUNTIME_CONFIG_SHA256}"
    DEERFLOW_DATABASE_BACKEND = "memory"
    DEERFLOW_RUN_EVENTS_BACKEND = "memory"
    DEERFLOW_STREAM_BRIDGE_TYPE = "memory"
  }
  tags = ["${REGISTRY}/deerflow:${DEERFLOW_SOURCE_COMMIT}-${RELEASE_SOURCE_COMMIT}"]
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
    UPSTREAM_IMAGE = "${FLOWISE_NODE_IMAGE}"
    RUNTIME_IMAGE = "${FLOWISE_RUNTIME_IMAGE}"
    FLOWISE_PNPM_LOCK_SHA256 = "${FLOWISE_PNPM_LOCK_SHA256}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${FLOWISE_SOURCE_COMMIT}"
  }
  tags = ["${REGISTRY}/flowise:${FLOWISE_SOURCE_COMMIT}-${RELEASE_SOURCE_COMMIT}"]
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
    UPSTREAM_IMAGE = "${FLOWISE_NODE_IMAGE}"
    RUNTIME_IMAGE = "${FLOWISE_RUNTIME_IMAGE}"
    FLOWISE_PNPM_LOCK_SHA256 = "${FLOWISE_PNPM_LOCK_SHA256}"
    RELEASE_SOURCE_COMMIT = "${RELEASE_SOURCE_COMMIT}"
    UPSTREAM_SOURCE_COMMIT = "${FLOWISE_SOURCE_COMMIT}"
  }
  tags = ["${REGISTRY}/flowise-worker:${FLOWISE_SOURCE_COMMIT}-${RELEASE_SOURCE_COMMIT}"]
}
