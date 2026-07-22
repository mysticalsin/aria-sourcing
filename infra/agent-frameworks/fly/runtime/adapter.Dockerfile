ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}
ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT
LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}"

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --chown=node:node src/lib/agents/framework/capability-core.mjs src/lib/agents/framework/capability-core.mjs
COPY --chown=node:node src/lib/agents/framework/configuration-core.mjs src/lib/agents/framework/configuration-core.mjs
COPY --chown=node:node src/lib/agents/framework/source-identity.mjs src/lib/agents/framework/source-identity.mjs
COPY --chown=node:node infra/agent-frameworks/adapter/server.mjs infra/agent-frameworks/adapter/server.mjs
COPY --chown=node:node infra/agent-frameworks/adapter/secret-preflight.mjs infra/agent-frameworks/adapter/secret-preflight.mjs
COPY --chown=node:node infra/agent-frameworks/deerflow-config.yaml /opt/aria/policy/reference/deerflow-config.yaml
COPY --chown=node:node infra/agent-frameworks/deerflow-agent /opt/aria/policy/reference/agent
COPY --chown=node:node infra/agent-frameworks/deerflow-skills /opt/aria/policy/reference/skills
COPY --chown=node:node infra/agent-frameworks/deerflow-config.yaml /opt/aria/policy/runtime/deerflow-config.yaml
COPY --chown=node:node infra/agent-frameworks/deerflow-agent /opt/aria/policy/runtime/agent
COPY --chown=node:node infra/agent-frameworks/deerflow-skills /opt/aria/policy/runtime/skills
COPY --chown=node:node infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER node
EXPOSE 8080
HEALTHCHECK NONE
CMD ["node", "infra/agent-frameworks/adapter/server.mjs"]
