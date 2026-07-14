ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chown=node:node infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER node
