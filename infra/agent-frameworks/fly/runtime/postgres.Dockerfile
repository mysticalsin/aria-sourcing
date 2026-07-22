ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}
ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT
LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}"

COPY --chmod=0555 infra/agent-frameworks/fly/runtime/postgres-entrypoint.sh /usr/local/bin/aria-postgres-entrypoint

ENTRYPOINT ["/usr/local/bin/aria-postgres-entrypoint"]
CMD ["postgres"]
