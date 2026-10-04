ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chown=node:node --chmod=0555 infra/agent-frameworks/fly/runtime/flowise-entrypoint.sh /usr/local/bin/aria-flowise-entrypoint
COPY --chown=node:node infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER node
ENTRYPOINT ["/usr/local/bin/aria-flowise-entrypoint"]
CMD ["/bin/sh", "-c", "node /app/healthcheck/healthcheck.js & exec pnpm run start-worker"]
