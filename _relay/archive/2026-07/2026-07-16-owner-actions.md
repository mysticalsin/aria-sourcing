# Owner-Gated Actions — 2026-07-16

Everything below needs Tony personally (credentials, accounts, spend, or governance decisions).
Compiled from: _relay/2026-07-15-remediation-plan.md Track B, _relay/incidents/2026-07-11-fly-deploy-token-exposure.md,
_relay/codex-findings.md open rows, production-readiness/STATUS.md, and the 2026-07-16 ground-truth sweep.
Each item: exact action + why + evidence source.

## P0 — Security incidents (do first)

### 1. Rotate the exposed Fly deploy token (incident still open-containment)
Incident ARIA-SEC-2026-07-11-01: the compromised token is STILL ACTIVE.
```
fly auth login
fly tokens list
fly tokens create deploy -a aria-mantu-app --json   # new scoped token
# revoke the exposed one from the list output
```
Then replace the token in GitHub → repo Settings → Environments → Production.
Evidence: _relay/incidents/2026-07-11-fly-deploy-token-exposure.md (frontmatter status: open-containment).

### 2. Plaintext prod secrets sit on an OneDrive-synced disk
`production-readiness/.fly-secrets.env` (1.3K) and `.fly-token.env` (651B) are gitignored but live in the
OneDrive-synced checkout — cloud-synced plaintext production credentials. Decide: move to a local keychain /
1Password / non-synced path, or accept the risk explicitly.
Evidence: infra sweep; .gitignore:59-60.

### 3. ElevenLabs keys — two rotations pending
- Old key in .env.local: flagged for rotation since codex-findings (line ~182, Status: open).
- New key pasted in chat on 2026-07-16: treat as exposed-once; rotate after the showcase video is generated.

## P1 — Release-chain governance (GitHub, ~15 min total)

### 4. Delete ARIA_DEPLOY_BUNDLE, install per-secret Production environment
GitHub → Settings → Secrets: remove the monolithic base64 bundle; add individual secrets per
`production-readiness/.fly-secrets.example`. (The untracked .gitlab-ci.yml still references the bundle and
cannot work anyway — deploy-fly.sh refuses outside GitHub Actions. Decide: delete .gitlab-ci.yml or leave as dead file.)

### 5. Branch protection + deploy workflow on default branch + FLY_REGISTRY_TOKEN
Protect `deploy/fly-github-actions` and the default branch; re-enable the deploy workflow; add FLY_REGISTRY_TOKEN.
Evidence: remediation plan Track B3; codex finding "deploy can publish a red exact SHA".

### 5b. GitHub Actions budget exhausted — CI is DEAD until you fix billing
Every CI/CodeQL job on every recent push fails at startup with zero steps run. GitHub's own
annotation: "The job was not started because an Actions budget is preventing further use."
GitHub → Settings (account/org) → Billing → Actions spending limit: raise it (or add payment).
Then re-run the branch CI for 8f2a4e4 — it is the pinned npm-test substitute for the Rock 2 ship.
Evidence: run 29509097086 annotations; same startup-failure on b15e4c3 and bc31d54.

### 6. gh CLI re-auth
Local `gh` token is invalid (DEPLOY_VERCEL_DEMO.md:63) — blocks any workflow_dispatch deploy from this machine.
```
gh auth login
```

## P2 — Data safety

### 7. DB restore receipt (single-machine, single-volume Postgres!)
aria-mantu-db has NO replication; recovery = daily snapshots (retention 14) + restore drill. Never drilled.
```
fly volumes list -a aria-mantu-db
fly volumes snapshots create <vol-id> -a aria-mantu-db
bash scripts/restore-drill.sh
```
Evidence: fly.db.toml:1-3; remediation plan Track B4.

## P3 — Feature unlocks (each one widens the pipeline)

### 8. dev_fusion Apify actor approval — ONE CLICK
https://console.apify.com/actors/2SyF0bVxmgGr8IVCZ?approvePermissions=true
Unlocks the secondary LinkedIn profile enricher (currently 403 full-permission-actor-not-approved; graceful
not_configured in the waterfall). harvestapi alone already covers discover+enrich+email.

### 9. Apollo / Seamless / Sillage keys (optional)
Enter via app Settings → API Keys (encrypted at rest, never env vars). Unlocks the full cost-ascending
enrichment waterfall. Note: Seamless + Sillage are production-disabled by design until they get the same
server-owned receipt authority Apollo has (src/lib/supabase/config.ts:33-39) — keys alone won't enable them in prod.

### 10. WhatsApp go-live (env-var driven, code is ready)
Channel adapters + outbox + policy + signed webhooks are fully built; go-live is purely:
WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET as Fly secrets
(requires a Meta WABA + approved templates). Until then adapters dry-run.

### 11. Delete (or keep) the E2E test user
`e2e-claude@amaris.com` was created — with your approval — in prod GoTrue for the 2026-07-16 acceptance test.
Delete it in Supabase/GoTrue when you want, or keep it for future acceptance runs.

## P4 — Strategic decisions (not clicks)

### 12. Agent-frameworks readiness: deploy or descope
/api/ready reports agentFrameworks=false because the Flowise/Deerflow sidecar stack (infra/agent-frameworks/,
complete but undeployed) isn't on Fly. Options: (a) deploy the sidecars (multi-day, Track C), or (b) make
agentFrameworks readiness conditional on a flag and declare it out of v1 scope. Current workaround: 082178e
removed /api/ready from Fly proxy routing checks.

### 13. Durable scheduler for outbound dispatch on Fly
Fly production has NO cron: the only dispatch backstop is Vercel's daily `13 6 * * *` cron. Queued WhatsApp
messages can sit up to ~24h in quiet periods. Decide: add a Fly scheduled machine / third worker process
(engineering task, Track C "durable scheduler" seam) — recommended before real outreach volume.

## Deferred code items (not owner-gated — queued for a next session)

- **Repo hygiene (REP-01/02, ~179MB tracked binaries):** cherry-pick `66e96e8` from
  `codex/aria-repo-hygiene-20260712`. Analysis showed it's a clean pick (only `.gitignore` +
  `tests/repository-hygiene.mts` conflicts, both safe). MUST run in an isolated git worktree —
  it was aborted this session when concurrent workflow agents raced the shared `.git`. History-
  affecting, so worth doing deliberately, not mid-other-work.

## What shipped this session (code, on integration/sourcing-enrichment-on-main — needs Fly deploy to go live)

- `44031d6` fix(tests): repaired `typecheck:tests` (11 closure-capture never-narrowing errors) — gate now green.
- `25b65de` feat(sourcing): First/Last name fields in the Apify source dialog — the search that resolves a specific person (e.g. your own profile). Was backend-supported, UI-hidden.
- `133be98` / `fb4a60f` docs: closed two stale findings + corrected a broken HANDOFF citation.

## Already done (no action)
- Repo private flip — verified 2026-07-15.
- Apify token rotation — explicitly waived by Tony 2026-07-15 ("keep the API and tokens as is").
- Fly secrets staged (Supabase, DATA_ENCRYPTION_KEY, CRON_SECRET, …) — m6, 2026-07-15.
