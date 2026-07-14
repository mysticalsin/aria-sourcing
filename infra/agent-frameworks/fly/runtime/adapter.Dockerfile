ARG UPSTREAM_IMAGE
FROM ${UPSTREAM_IMAGE}

COPY --chown=node:node infra/agent-frameworks/deerflow-config.yaml /opt/aria/policy/runtime/deerflow-config.yaml
COPY --chown=node:node infra/agent-frameworks/deerflow-agent /opt/aria/policy/runtime/agent
COPY --chown=node:node infra/agent-frameworks/deerflow-skills /opt/aria/policy/runtime/skills
COPY --chown=node:node infra/agent-frameworks/fly/runtime/identity-probe.mjs /opt/aria/identity-probe.mjs

USER node
