FROM deerflow_upstream

USER root
COPY infra/agent-frameworks/deerflow-runtime/patch-ephemeral-wait.py /opt/aria/deerflow-patches/patch-ephemeral-wait.py
RUN ["python", "/opt/aria/deerflow-patches/patch-ephemeral-wait.py", "/app/backend/app/gateway/routers/runs.py"]
RUN rm -rf /opt/aria/deerflow-patches
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/cleanup-guard.py /app/backend/aria_cleanup_guard.py
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/runtime-policy.py /app/backend/aria_runtime_policy.py
COPY --chown=65532:65532 --chmod=0444 infra/agent-frameworks/deerflow-runtime/aria-deerflow-app.py /app/backend/aria_deerflow_app.py

USER 65532:65532
