# Owner: approve #150 → deploy → LI healthy

**As of:** 2026-10-03T16:30Z  
**PR:** https://github.com/mysticalsin/aria-sourcing/pull/150 (`MERGEABLE`, squash auto-merge on, `REVIEW_REQUIRED`)  
**Tip SHA:** `e0bd94325359fd449b979365b0efece38f350730` (docs) / last green code tip `81d3d8d…`  
**Fly now:** `21a42e7…` / `0084` / `hermesRuntime:true` / `agentFrameworks:false` (HTTP 503 on `/api/ready` — expected)

## 1. Approve PR #150

Approve on GitHub (**required**: someone other than the last pusher). Squash auto-merge lands tip onto `deploy/fly-github-actions` as a single commit (branch policy rejects merge commits).

Agent cannot approve (`addPullRequestReview` 403) or push the protected branch directly.

## 2. Wait for green CI on the new deploy HEAD

```bash
git fetch origin deploy/fly-github-actions
RELEASE_SHA=$(git rev-parse origin/deploy/fly-github-actions)
echo "$RELEASE_SHA"
gh run list --commit "$RELEASE_SHA" --workflow ci.yml --limit 1
gh run list --commit "$RELEASE_SHA" --workflow codeql.yml --limit 1
# both must be: completed success
```

## 3. Compute recovery_receipt_sha256

From the reviewed volume recovery receipt file (same JSON as Production secret `ARIA_VOLUME_RECOVERY_RECEIPT_JSON`):

```bash
node scripts/recovery-receipt-digest.mjs /path/to/volume-recovery-receipt.json
# → 64 lowercase hex
```

Workflow also requires a Production environment approval with review comment exactly:

```text
recovery-receipt-sha256:<digest>
```

Approver must not be the dispatch actor.

## 4. Dispatch Deploy Aria Mantu (Fly)

GitHub → Actions → **Deploy Aria Mantu (Fly)** → Run workflow:

- Branch: `deploy/fly-github-actions`
- `release_sha`: `$RELEASE_SHA` (exact 40 hex from step 2)
- `recovery_receipt_sha256`: digest from step 3

Or:

```bash
gh workflow run "Deploy Aria Mantu (Fly)" \
  --ref deploy/fly-github-actions \
  -f release_sha="$RELEASE_SHA" \
  -f recovery_receipt_sha256="$RECEIPT_SHA256"
```

**Expect:** workflow may still fail late on `require_http_200 … /api/ready` because DeerFlow/Flowise sidecars are not on this tenant (`AGENT_FRAMEWORKS_REQUIRED=true`). Migrations (step 7) and app image (step 11) can still land before that check — verify with the proof script below, not workflow green alone.

## 5. Post-deploy proof (N-agent goal gate)

```bash
bash scripts/fly-n-agent-proof.sh   # uses origin/deploy/fly-github-actions tip
# or: bash scripts/fly-n-agent-proof.sh <40-char-deploy-head>
```

Script requires `/api/ready` JSON: `build==tip`, migration includes `0087`, `hermesRuntime` + database/auth/queue true.  
It does **not** require `agentFrameworks:true` or HTTP 200 (tenant intentional 503 — see `_relay/evidence/2026-09-05-fly-linkedin-live.md`).

Then Take→login→Release on each campaign LI desk. `sessionHealthy===true` only after probe — never invent.

## Agent cannot

- Approve #150 / request reviewers
- Push to protected `deploy/fly-github-actions`
- Supply `FLY_API_TOKEN` or invent recovery receipt
