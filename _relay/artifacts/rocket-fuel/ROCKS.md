# ROCKS — agent-framework deployment (post-G2, proofs locked)
## Rock 1: Configure GitHub for the pipeline  [Owner]
Done means: FLY_REGISTRY_TOKEN (deploy-scoped org token) + Production environment + protected branch deploy/fly-github-actions carry the workflow.
Proof: `gh workflow run deploy-agent-frameworks.yml -f release_sha=<sha> -f fly_org=personal` → run starts, passes org+holder-app asserts.
Status: NOT STARTED
## Rock 2: Fund Moonshot provider  [Owner]
Done means: platform.moonshot.ai key funded; gateway can list models.
Proof: `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" https://api.moonshot.ai/v1/models` → 200
Status: NOT STARTED
## Rock 3: Build+sign the 8 images  [Integrator/CI]
Done means: workflow green; 8 images signed+attested in registry.fly.io/aria-mantu-agent-frameworks.
Proof: `cosign verify --certificate-identity <wf-url> --certificate-oidc-issuer https://token.actions.githubusercontent.com <ref>` → exit 0 for each
Status: NOT STARTED
## Rock 4: Flowise private bootstrap  [Owner]
Done means: workspace + readiness sentinel + least-priv API key created.
Proof: flowise-adapter /readyz returns dependencies{database,queue,worker,policy}=true
Status: NOT STARTED
## Rock 5: Manifest + operator deploy  [Integrator]
Done means: signed manifest authored; operator prepare/confirm/deploy --execute succeeds; receipts written.
Proof: `node infra/agent-frameworks/fly/operator.mjs deploy ... --execute` → all 8 apps one started machine on approved digest, /readyz green
Status: NOT STARTED
## Rock 6: App pins → /api/ready green  [Integrator]
Done means: aria-mantu-app DEERFLOW_*/FLOWISE_*/AGENT_FRAMEWORK_* pins set to the deployed digests+identities.
Proof: `curl -s https://aria-mantu-app.fly.dev/api/ready | grep '"agentFrameworks":true'` and `"ok":true`
Status: NOT STARTED
