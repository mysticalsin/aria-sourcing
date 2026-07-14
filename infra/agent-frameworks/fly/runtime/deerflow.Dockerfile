ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

ARG DEERFLOW_PATCHED_RUNS_SHA256
ARG DEERFLOW_CLEANUP_GUARD_SHA256
ARG DEERFLOW_RUNTIME_POLICY_SHA256
ARG DEERFLOW_RUNTIME_CONFIG_SHA256
ARG DEERFLOW_DATABASE_BACKEND
ARG DEERFLOW_RUN_EVENTS_BACKEND
ARG DEERFLOW_STREAM_BRIDGE_TYPE

LABEL io.mantu.aria.deerflow.patched-runs-sha256="${DEERFLOW_PATCHED_RUNS_SHA256}" \
      io.mantu.aria.deerflow.cleanup-guard-sha256="${DEERFLOW_CLEANUP_GUARD_SHA256}" \
      io.mantu.aria.deerflow.runtime-policy-sha256="${DEERFLOW_RUNTIME_POLICY_SHA256}" \
      io.mantu.aria.deerflow.runtime-config-sha256="${DEERFLOW_RUNTIME_CONFIG_SHA256}" \
      io.mantu.aria.deerflow.database-backend="${DEERFLOW_DATABASE_BACKEND}" \
      io.mantu.aria.deerflow.run-events-backend="${DEERFLOW_RUN_EVENTS_BACKEND}" \
      io.mantu.aria.deerflow.stream-bridge-type="${DEERFLOW_STREAM_BRIDGE_TYPE}"

COPY --chown=65532:65532 infra/agent-frameworks/deerflow-config.yaml /opt/aria/deerflow/config.yaml
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-agent /tmp/deerflow/agents/aria-proposal
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-skills /opt/aria/deerflow/skills
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/deerflow-entrypoint.sh /usr/local/bin/aria-deerflow-entrypoint
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/fly/runtime/private_http.py /opt/aria/private_http.py
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/private-probe.py /opt/aria/private-probe.py

USER 65532:65532
ENTRYPOINT ["/usr/local/bin/aria-deerflow-entrypoint"]
