---
project: MSourcing / ARIA
shift: 43
agent: claude-opus-4-8
updated: 2026-07-19 19:30 EDT
status: in-progress — supply-chain pipeline Codex-APPROVED, deploy owner-gated
---

# Handoff — MSourcing / ARIA

## Current state
- **Prod app: v17 live** on Fly (`aria-mantu-app`). `/api/health` 200; swarm routes return clean 401 for anon (fix live). Branch `integration/sourcing-enrichment-on-main`, repo `mysticalsin/aria-sourcing` (id 1285297923).
- **Prod DB: migrations 0001→0046 applied** (45 rows). `/api/ready` = **5/6 green** — only `agentFrameworks` red (by design: the two runtimes aren't deployed yet). `migration` pin fixed this shift.
- **Agent-framework supply-chain CI workflow is Codex-APPROVED** (Rocket Fuel, 5 rounds, REVISE×4→APPROVED, score 72→98). It is NOT yet in git — preserved at `_relay/artifacts/deploy-agent-frameworks.yml` (853 lines, 0 TODO(verify), all actions SHA-pinned). Owner deferred the push (G6).
- Working git clone for this effort: a fresh `git clone` of the branch into scratch sidesteps the OneDrive git stall. All framework infra is at `infra/agent-frameworks/`.

## Done this shift
- Fixed prod `/api/ready` `migration` pin: set `ARIA_EXPECTED_MIGRATION=0046_swarm_orchestration_authority.sql`, `_SHA=a4bcd248fcd39b3a92f27d8b94d420763e7d2a8f7c181d1e9a3ec28c7a7ab226`, `_COUNT=45`, `ARIA_EXPECTED_LEDGER_SHA=d0c3aa94413ffe61c1ad035e7e6bc23c3ad744893111315381ac28760b837474` on `aria-mantu-app` (computed from the live ledger by the route's exact algorithm). `migration` flipped true.
- Fixed a real build blocker: `readBoundedBody` existed only in the working tree, never pushed → git HEAD didn't compile (`next build` exit 1). Pushed it (commit `d3d404b`) so HEAD builds. Redeployed → v17.
- Pushed docs: `docs/ENGAGEMENT-2026-07-swarm-and-channel-hardening.md` (`ffe444`), `docs/runbooks/resend-live-send-quickstart.md` (`7683c02`).
- Discovered the real blocker for `agentFrameworks`: the 8-image supply-chain **CI pipeline was never built**. Operator (`infra/agent-frameworks/fly/operator.mjs`) verifies keyless (Fulcio) cosign signatures + spdxjson SBOM + slsaprovenance + trivy; `certificateIdentity` must be an https URL = a GitHub-Actions OIDC workflow identity. No workflow built/signed these images.
- Authored + hardened `deploy-agent-frameworks.yml` through Rocket Fuel (V: claude, I: codex gpt-5.5). Fixed 12 findings: Fly per-app registry (holder app + tags, refs by @digest), per-op registry re-auth, metadata-driven digests, DeerFlow identity single-sourced from `operator-core.mjs`, operator-contract CI self-check, proper OCI-ref parsing, action pins, runtime org+holder-app ownership proof, stdout-only JSON capture. Receipts at `_relay/artifacts/rocket-fuel/`.
- Installed cosign + trivy. Generated 12 secret authorities + UUIDs (in scratch `secure/` — EPHEMERAL, will be lost; regenerate or owner-provide; see Next step 2).
- Validated both docker-bake HCLs with `--print` (5 base + 7 wrapper targets resolve).

## Blockers (all OWNER-gated — cannot proceed without these)
1. **Moonshot provider unfunded.** `KIMI_API_KEY` on the app → HTTP 402 at `api.moonshot.ai/v1`. The local `.env.local` key is a *coding* key (`api.kimi.com/coding/v1` → 401), NOT usable for the gateway. Need a funded **platform.moonshot.ai** key. Without it the model-gateway `/readyz` is 503 → **deerflow can never be green → agentFrameworks stays red**. (Flowise is provider-independent and CAN go green alone, but the probe needs BOTH.)
2. **GitHub repo config.** `FLY_REGISTRY_TOKEN` must be a **deploy-scoped org token** (app create/list + registry push + cosign write, NOT registry-only). Plus the `Production` environment + protected branch `deploy/fly-github-actions` (exists) must carry the new workflow.
3. **Flowise private bootstrap** (admin registration → workspace UUID + readiness-sentinel chatflow + least-priv API key) must happen before the manifest, because those feed `configurationSha256`.

## Next steps (in order)
1. **Owner G6 decision:** move `_relay/artifacts/deploy-agent-frameworks.yml` → `.github/workflows/deploy-agent-frameworks.yml`, commit, push. (Safe: `workflow_dispatch`-only; won't auto-run.) Then set `FLY_REGISTRY_TOKEN` (deploy-scoped) in repo secrets + `Production` environment. Proof: `gh workflow run deploy-agent-frameworks.yml -f release_sha=<40hex> -f fly_org=personal` starts and passes the org + holder-app asserts.
2. **Owner:** fund `platform.moonshot.ai`, get a working key. Proof: `curl -s -o/dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" https://api.moonshot.ai/v1/models` → **200**. Confirm an approved model id from `/v1/models`.
3. **Run the workflow** (Rock 3): it bakes+scans+signs the 8 images to `registry.fly.io/aria-mantu-agent-frameworks` (holder app, per-image tags), emits the manifest `images` block artifact. Proof: `cosign verify --certificate-identity <wf-url> --certificate-oidc-issuer https://token.actions.githubusercontent.com <ref>` → exit 0 each.
4. **Flowise bootstrap** (Rock 4) per `infra/agent-frameworks/README.md` §bootstrap → record workspace UUID + sentinel workflow id + API key.
5. **Author signed manifest** (`aria.agent-framework.fly-manifest.v2`) from the workflow's emitted images block + UUIDs (scratch `secure/identities.json` had: deploymentId, workspaceId, deerflow/flowise frameworkInstanceIds — regenerate if scratch gone) + the config sha (`node scripts/agent-framework-configuration.mjs --sha-only` with the Fly `.internal` hostnames).
6. **Operator deploy** (Rock 5): `node infra/agent-frameworks/fly/operator.mjs prepare|confirm|deploy --execute` (credentialed — owner authorizes each). Deploy order: flowise-db → flowise-redis → model-gateway → deerflow → flowise → flowise-worker → deerflow-adapter → flowise-adapter.
7. **Set app pins** (Rock 6): `flyctl secrets set` on `aria-mantu-app` the `DEERFLOW_*`/`FLOWISE_*`/`AGENT_FRAMEWORK_*` values (see `.env.production.example:73-103`) using the Fly `.internal` URLs. Proof: `curl -s https://aria-mantu-app.fly.dev/api/ready | grep '"agentFrameworks":true'` and `"ok":true`.

Full rocks with proofs: `_relay/artifacts/rocket-fuel/ROCKS.md`.

## Decisions made (don't relitigate)
- **Keep `AGENT_FRAMEWORK_EXECUTION_ENABLED=false` + `KILL_SWITCH=true`.** `/api/ready` goes green WITHOUT execution (the readiness gate doesn't require it). Execution-enable blockers (Fly egress lockdown, Postgres HA + snapshot drill, live canary) stay for a later, separate decision. README mandates this interim posture.
- **Fly registry is per-app** → ONE holder app `aria-mantu-agent-frameworks` + per-image tags; manifest refs by `@sha256`. Shared adapter/redis pushed once (operator requires `deerflow-adapter.ref===flowise-adapter.ref`, `redis===redis`).
- **Signing is keyless via GitHub Actions OIDC** (not `actions/attest` — that emits SLSA v1.0; operator verifies v0.2 via `cosign attest`). Not hand-signed locally (local OIDC yields an email identity; manifest requires an https-URL identity).
- **DeerFlow's 7 runtime identities** are read from `operator-core.mjs` DEERFLOW_RUNTIME_IDENTITY at CI runtime (single source; drift impossible).
- **Never auto-send / never the approving human** for candidate outreach. Never weaken the operator's security gates to force green.
- `fly_org` = `personal` (verified: `flyctl orgs list`; `aria-mantu-app` owner=personal).

## Watch out
- **OneDrive git is broken** for this repo (rsync/large ops stall). Use the GitHub REST API (blobs→tree→commit→ref) for pushes, and a fresh `git clone` into non-OneDrive scratch for builds. Single-file reads on OneDrive usually work.
- **Fly deploys are classifier-gated** for the AI: credentialed `flyctl secrets set` / `deploy` need the Owner to authorize (it went through once Tony explicitly said so). Hand credentialed prod actions to the Owner.
- **`flyctl auth docker` creds expire ~5 min** — the workflow re-auths before every registry op; keep it that way.
- The scratch `secure/` dir (12 secret files + identities.json) is EPHEMERAL (`/private/tmp/...`). Regenerate with the workflow's own secret-authority steps or owner-provide; the Moonshot key + Flowise API key were always owner/bootstrap-supplied.
- The operator verifies ALL 10 roles even though `deerflow-db`/`deerflow-redis` are release-disabled (they reuse the signed postgres/redis refs).
- Task list: #23 (one-candidate live email — owner, needs Resend key) and #29 (these owner gates) remain open.
