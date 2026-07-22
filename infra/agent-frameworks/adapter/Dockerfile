FROM mirror.gcr.io/library/node:22.22.0-alpine3.23@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY --chown=node:node src/lib/agents/framework/capability-core.mjs src/lib/agents/framework/capability-core.mjs
COPY --chown=node:node src/lib/agents/framework/configuration-core.mjs src/lib/agents/framework/configuration-core.mjs
COPY --chown=node:node src/lib/agents/framework/source-identity.mjs src/lib/agents/framework/source-identity.mjs
COPY --chown=node:node infra/agent-frameworks/adapter/server.mjs infra/agent-frameworks/adapter/server.mjs
COPY --chown=node:node infra/agent-frameworks/adapter/secret-preflight.mjs infra/agent-frameworks/adapter/secret-preflight.mjs
COPY --chown=node:node infra/agent-frameworks/deerflow-config.yaml /opt/aria/policy/reference/deerflow-config.yaml
COPY --chown=node:node infra/agent-frameworks/deerflow-agent /opt/aria/policy/reference/agent
COPY --chown=node:node infra/agent-frameworks/deerflow-skills /opt/aria/policy/reference/skills

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const fs=require('node:fs');const token=process.env.ADAPTER_TOKEN||(process.env.ADAPTER_TOKEN_FILE?fs.readFileSync(process.env.ADAPTER_TOKEN_FILE,'utf8').trim():'');const contract=process.env.ADAPTER_MODE==='deerflow'?'aria.deerflow.run.v1':'aria.flowise.import.v1';fetch('http://127.0.0.1:8080/readyz',{headers:{authorization:'Bearer '+token,'x-aria-framework-contract':contract,'x-aria-workspace-id':process.env.ARIA_WORKSPACE_ID,'x-aria-framework-instance-id':process.env.FRAMEWORK_INSTANCE_ID},signal:AbortSignal.timeout(4000)}).then(async r=>{const body=await r.json();if(!r.ok||body.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "infra/agent-frameworks/adapter/server.mjs"]
