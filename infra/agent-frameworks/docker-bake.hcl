variable "REGISTRY" {
  default = "registry.invalid/aria-agent-frameworks"
}

group "default" {
  targets = ["adapter", "model-gateway", "deerflow", "flowise", "flowise-worker"]
}

target "release" {
  platforms = ["linux/amd64", "linux/arm64"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "adapter" {
  inherits = ["release"]
  # Run bake from the repository root; this keeps the canonical capability
  # module and adapter source in one explicit build context.
  context = "."
  dockerfile = "infra/agent-frameworks/adapter/Dockerfile"
  tags = ["${REGISTRY}/aria-framework-adapter:node-22.22.0"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "model-gateway" {
  inherits = ["release"]
  context = "."
  dockerfile = "infra/agent-frameworks/model-gateway/Dockerfile"
  tags = ["${REGISTRY}/aria-model-gateway:node-22.22.0"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "deerflow" {
  inherits = ["release"]
  context = "https://github.com/bytedance/deer-flow.git#fabadae4168db81f0eaaf62f209050f978e2f691"
  dockerfile = "backend/Dockerfile"
  target = "runtime"
  args = {
    UV_EXTRAS = "postgres"
  }
  tags = ["${REGISTRY}/deerflow:fabadae4168db81f0eaaf62f209050f978e2f691"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "flowise" {
  inherits = ["release"]
  context = "https://github.com/FlowiseAI/Flowise.git#bb773ffa710bd22639c4ba2643413a0ea2b679d3"
  dockerfile = "Dockerfile"
  tags = ["${REGISTRY}/flowise:bb773ffa710bd22639c4ba2643413a0ea2b679d3"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "flowise-worker" {
  inherits = ["release"]
  context = "https://github.com/FlowiseAI/Flowise.git#bb773ffa710bd22639c4ba2643413a0ea2b679d3"
  dockerfile = "docker/worker/Dockerfile"
  tags = ["${REGISTRY}/flowise-worker:bb773ffa710bd22639c4ba2643413a0ea2b679d3"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}
