FROM node:22.22.0-alpine3.23@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node infra/agent-frameworks/model-gateway/server.mjs /app/server.mjs

USER node
HEALTHCHECK NONE
ENTRYPOINT ["node", "/app/server.mjs"]
