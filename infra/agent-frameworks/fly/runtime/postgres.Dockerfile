ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chmod=0555 infra/agent-frameworks/fly/runtime/postgres-entrypoint.sh /usr/local/bin/aria-postgres-entrypoint

ENTRYPOINT ["/usr/local/bin/aria-postgres-entrypoint"]
CMD ["postgres"]
