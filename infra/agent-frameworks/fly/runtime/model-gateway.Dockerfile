ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}
ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT
LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}"

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node infra/agent-frameworks/model-gateway/server.mjs /app/server.mjs
COPY --chown=node:node infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER node
HEALTHCHECK NONE
ENTRYPOINT ["node", "/app/server.mjs"]
