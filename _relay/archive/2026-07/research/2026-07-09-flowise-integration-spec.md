# Flowise → ARIA Integration Spec — m2b Report (2026-07-09)

> Sonnet research subagent, shallow clone of FlowiseAI/Flowise @ 3.1.3 (commit bb773ff). Feeds m3 plan (_relay/PLAN.md).

## 1. Runtime
pnpm/Turbo monorepo: packages/server (Express/TypeORM), packages/ui (React SPA canvas), packages/components (26 node categories), **packages/agentflow (standalone embeddable React canvas)**. Node ^24 (engines + .nvmrc v24.15.0; README says >=20 — trust 24). DB: sqlite|mysql|mariadb|postgres via DATABASE_TYPE (DataSource.ts) — **Supabase Postgres compatible**, but Flowise runs 40+ TypeORM migrations at boot → dedicated schema/project mandatory. Env: packages/server/.env.example (SECRETKEY_*, STORAGE_TYPE, JWT_*, IFRAME_ORIGINS, CORS_ORIGINS, MODE=queue+REDIS for scale). Single port (default 3000). Docker: node:24-alpine + chromium/cairo/pango, 8GB heap ceiling — heavy image. **Vercel serverless: NO** (long-lived Express, in-memory pools, SSE, boot migrations, native deps). Host: Railway/Render/Fly/VM, min 2 vCPU/4GB.

## 2. Auth — #1 risk, confirmed
Gate in packages/server/src/index.ts (~220-280): JWT session cookie (x-request-from: internal, enterprise/middleware/passport/index.ts:409) OR workspace-scoped API key (utils/validateKey.ts). Keys resolve to Workspace→Organization, never end-user.
**ALL login/JWT/workspace/org/SSO/RBAC code lives under packages/server/src/enterprise/ — carved out of Apache-2.0 into FlowiseAI Commercial License** (root LICENSE.md; enterprise/LICENSE.md requires paid subscription for production use of that code; copying/modifying for dev/test permitted). Unlicensed self-host: Platform.OPEN_SOURCE (IdentityManager.ts:96-150), one default org + one workspace, CLI-created users (`pnpm run user`), no per-end-user isolation — every login/API key sees the shared flow pool. Multi-workspace/SSO/RBAC = enterprise tier.
**ARIA pattern: single-tenant internal sidecar behind ARIA's own Supabase-JWT-gated proxy; ARIA DB tracks flow ownership, proxy filters. Legal check with FlowiseAI (security@flowiseai.com) advised — carve-out covers even basic login.**

## 3. API
routes/chatflows/index.ts: POST/GET/PUT/DELETE /api/v1/chatflows (Chatflows + Agentflows share table, type column: CHATFLOW|AGENTFLOW|MULTIAGENT|ASSISTANT). POST /api/v1/prediction/:id whitelisted (utils/constants.ts:6-46) but per-flow apikeyid enforced (validateFlowAPIKey); streaming via req.body.streaming=true → SSEStreamer (controllers/predictions/index.ts:58-91). API-key CRUD routes/apikey/. **POST /api/v1/agentflowv2-generator/generate: NL prompt → flow JSON server-side — reusable for AgentSpec → flow pipeline.**

## 4. Flow format
ChatFlow.flowData = JSON text column {nodes, edges, viewport} (ReactFlow shape). Templates: packages/server/marketplaces/chatflows/*.json. Agentflow V2 vocabulary (13 node types, packages/agentflow/README.md): startAgentflow, agentAgentflow, llmAgentflow, conditionAgentflow, conditionAgentAgentflow, directReplyAgentflow, customFunctionAgentflow, toolAgentflow, retrieverAgentflow, stickyNoteAgentflow, httpAgentflow, iterationAgentflow, executeFlowAgentflow. Round-trip from AgentSpec feasible: (a) construct JSON against schema, or (b) drive generator endpoint + validate via @flowiseai/agentflow `validate()`.

## 5. Embed — better than expected
utils/XSS.ts:141-194: IFRAME_ORIGINS env → CSP frame-ancestors + X-Frame-Options, applied globally — **whole builder SPA legitimately iframable, first-class config** (test coverage XSS.test.ts).
**@flowiseai/agentflow: Apache-2.0 standalone npm React component** (ReactFlow-based) — `<Agentflow apiBaseUrl token initialFlow onSave requestInterceptor readOnly/>` + ref API (getFlow, validate, toJSON, addNode). Native embed in Next.js, NO iframe. Caveats: v0.0.0-dev.14 "not yet recommended for production"; auth must be API key not JWT (README troubleshooting). CORS: allow ARIA origin (getCorsOptions, XSS.ts:83).
Recommended: native component in "Agent Studio", apiBaseUrl → Next.js proxy route that attaches server-held workspace API key (never in browser). Fallback: full-UI iframe w/ IFRAME_ORIGINS; degrade to new-tab launch.

## 6. Engine vs editor
Flowise executes server-side (multiagents/Supervisor+Worker; Agentflow V2 DAG w/ branching/looping/sub-flows). Trade-off: running core sourcing logic in Flowise couples to its runtime + release cadence. **Default: Flowise = visual editor/prototyping sandbox; ARIA TS runtime = production execution source of truth**; prediction API only for explicitly-designed lower-stakes flows.

## 7. License
Apache-2.0 outside packages/server/src/enterprise/; that dir = Commercial License (auth/workspace/org/RBAC/SSO/Stripe). @flowiseai/agentflow separately Apache-2.0. GitHub shows Other/NOASSERTION (split). Internal commercial use of Apache parts fine; enterprise-dir gray area → legal read.

## 8. Health
v3.1.3 (2026-06-25), main pushed 2026-07-06. 54.4K stars, 982 open issues, ~monthly releases. Active.

## 9. Recommended architecture
Docker sidecar on Railway/Fly (2vCPU/4GB, MODE=main; queue+Redis later). Dedicated Supabase schema/DB. ARIA backend holds one workspace API key; Next.js proxy (ARIA-JWT-gated) attaches it. Embed @flowiseai/agentflow at /studio through proxy; IFRAME_ORIGINS as fallback. Flow sync: generator endpoint or direct JSON; store chatflow.id on ARIA agent_specs; Flowise = edit source of truth, ARIA runtime = execution source of truth.
