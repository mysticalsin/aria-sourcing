ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chmod=0555 infra/agent-frameworks/fly/runtime/redis-entrypoint.sh /usr/local/bin/aria-redis-entrypoint

ENTRYPOINT ["/usr/local/bin/aria-redis-entrypoint"]
