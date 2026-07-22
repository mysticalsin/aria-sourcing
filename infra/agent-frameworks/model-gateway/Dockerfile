FROM mirror.gcr.io/library/node:22.22.0-alpine3.23@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node infra/agent-frameworks/model-gateway/server.mjs /app/server.mjs

USER node
HEALTHCHECK NONE
ENTRYPOINT ["node", "/app/server.mjs"]
