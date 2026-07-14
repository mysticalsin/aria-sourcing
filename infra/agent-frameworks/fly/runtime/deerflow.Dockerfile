ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chown=65532:65532 infra/agent-frameworks/deerflow-config.yaml /opt/aria/deerflow/config.yaml
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-agent /tmp/deerflow/agents/aria-proposal
COPY --chown=65532:65532 infra/agent-frameworks/deerflow-skills /opt/aria/deerflow/skills
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/deerflow-entrypoint.sh /usr/local/bin/aria-deerflow-entrypoint
COPY --chown=65532:65532 --chmod=0555 infra/agent-frameworks/fly/runtime/private-probe.py /opt/aria/private-probe.py

USER 65532:65532
ENTRYPOINT ["/usr/local/bin/aria-deerflow-entrypoint"]
