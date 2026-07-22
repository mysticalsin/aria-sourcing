ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}
ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT
LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}"

COPY --chown=0:0 --chmod=0444 infra/agent-frameworks/upstream/flowise-entrypoint.cjs /opt/aria/flowise-entrypoint.cjs
COPY --chown=0:0 --chmod=0444 infra/agent-frameworks/upstream/flowise-worker-healthcheck.mjs /opt/aria/flowise-worker-healthcheck.mjs
COPY --chown=0:0 --chmod=0444 infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/opt/aria/flowise-entrypoint.cjs"]
CMD ["worker"]
