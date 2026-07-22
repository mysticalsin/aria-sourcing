ARG DEERFLOW_UV_IMAGE
ARG DEERFLOW_BUILD_IMAGE
ARG UPSTREAM_IMAGE

FROM ${DEERFLOW_UV_IMAGE} AS uv

FROM ${DEERFLOW_BUILD_IMAGE} AS build

COPY --from=uv /uv /uvx /usr/local/bin/

WORKDIR /app/backend
COPY --from=deerflow_source backend/ ./

ARG DEERFLOW_UV_LOCK_SHA256
RUN printf '%s  %s\n' "${DEERFLOW_UV_LOCK_SHA256}" uv.lock | sha256sum --check --strict -
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable --extra redis

COPY infra/agent-frameworks/deerflow-runtime/patch-ephemeral-wait.py /opt/aria/deerflow-patches/patch-ephemeral-wait.py
RUN ["python", "/opt/aria/deerflow-patches/patch-ephemeral-wait.py", "/app/backend/app/gateway/routers/runs.py"]

FROM ${UPSTREAM_IMAGE}

ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT
ARG DEERFLOW_PATCHED_RUNS_SHA256
ARG DEERFLOW_CLEANUP_GUARD_SHA256
ARG DEERFLOW_RUNTIME_POLICY_SHA256
ARG DEERFLOW_RUNTIME_CONFIG_SHA256
ARG DEERFLOW_DATABASE_BACKEND
ARG DEERFLOW_RUN_EVENTS_BACKEND
ARG DEERFLOW_STREAM_BRIDGE_TYPE

LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}" \
      io.mantu.aria.deerflow.patched-runs-sha256="${DEERFLOW_PATCHED_RUNS_SHA256}" \
      io.mantu.aria.deerflow.cleanup-guard-sha256="${DEERFLOW_CLEANUP_GUARD_SHA256}" \
      io.mantu.aria.deerflow.runtime-policy-sha256="${DEERFLOW_RUNTIME_POLICY_SHA256}" \
      io.mantu.aria.deerflow.runtime-config-sha256="${DEERFLOW_RUNTIME_CONFIG_SHA256}" \
      io.mantu.aria.deerflow.database-backend="${DEERFLOW_DATABASE_BACKEND}" \
      io.mantu.aria.deerflow.run-events-backend="${DEERFLOW_RUN_EVENTS_BACKEND}" \
      io.mantu.aria.deerflow.stream-bridge-type="${DEERFLOW_STREAM_BRIDGE_TYPE}"

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONIOENCODING=utf-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app/backend

COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=build --chown=65532:65532 /app/backend/ /app/backend/
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/cleanup-guard.py /app/backend/aria_cleanup_guard.py
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/runtime-policy.py /app/backend/aria_runtime_policy.py
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/aria-deerflow-app.py /app/backend/aria_deerflow_app.py
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-skills /opt/aria/deerflow/skills
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-config.yaml /opt/aria/deerflow/config.yaml
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-agent /tmp/deerflow/agents/aria-proposal
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/deerflow-entrypoint.sh /usr/local/bin/aria-deerflow-entrypoint
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/fly/runtime/private_http.py /opt/aria/private_http.py
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/private-probe.py /opt/aria/private-probe.py

EXPOSE 8001

USER 65532:65532
ENTRYPOINT ["/usr/local/bin/aria-deerflow-entrypoint"]
