# Owner Fly tip deploy path — divergence + checklist

**Probed:** 2026-10-03T13:35Z  
**Feature tip:** `cursor/linkedin-human-claude-chrome-b91d` @ `ca8cf40e6e222280e25d59dc846f364bf97e7a49`  
**Deploy branch tip:** `deploy/fly-github-actions` @ `f5868fabe1468f1f606c650baf9804cc817c68f5`  
**Merge-base:** `128b03678fc4619fdf4572e0579b1a80994e2493`  
**Divergence:** tip has **657** commits not on deploy; deploy has **2** not on tip  
**Fly live:** still `21a42e7…` / migration `0084` / `agentFrameworks:false` (503 not_ready)

## Why agent cannot finish

Protected workflow `.github/workflows/deploy-aria-mantu.yml` requires:

1. `workflow_dispatch` **from** `refs/heads/deploy/fly-github-actions` with `ref_protected=true`
2. `release_sha` == exact 40-char SHA of that workflow run’s HEAD
3. That SHA is an ancestor of `origin/deploy/fly-github-actions`
4. Successful completed `ci.yml` + `codeql.yml` runs for that SHA
5. `recovery_receipt_sha256` (64-char) + Production environment secrets (`FLY_API_TOKEN`, etc.)

Agent has no `FLY_API_TOKEN`, cannot push to protected deploy, cannot invent recovery receipt.

## Deploy-only commits (not ancestors of tip)

| SHA | Note |
|---|---|
| `ee0cee9` | `fix(ci): remove flaky and unsafe analysis patterns` |
| `f5868fa` | docs(relay) recording PR 3 CI repair |

**Tip already carries the same intent** via `8a63a8f` (`escapeMarkdownTableCell` in `src/lib/utils.ts` + winlog export). Merge conflicts on those files are equivalent-history, not missing fixes.

## Last proven green CI on tip lineage

| SHA | Role | CI |
|---|---|---|
| `5a01024` | last durable-authority code fix with CI+CodeQL success | green |
| `d1b83bf` | later docs tip; full CI success (Quality+Release) | green |
| `ca8cf40` | current tip (docs after PacketFX/ingest code) | **CI+CodeQL success** (Quality+Release gate) |

Deploy SHA must itself have green CI — after landing tip on deploy, re-verify that land SHA (merge may produce a new SHA).

## Owner checklist (ordered)

1. **Land tip on deploy branch** (pick one):
   - Preferred: merge `cursor/linkedin-human-claude-chrome-b91d` → `deploy/fly-github-actions`, resolve the ~8 “changed in both” files by **keeping tip** (`winlog`, `web-tools`, channel/obscura/tavily/winlog tests, HANDOFF/codex-findings).
   - Alt: if policy allows, reset/fast-forward deploy to tip (tip already has CI-fix equivalent).
2. Record `RELEASE_SHA=$(git rev-parse origin/deploy/fly-github-actions)` after the land.
3. Wait until `gh run list --commit $RELEASE_SHA --workflow ci.yml` and `codeql.yml` both show `completed success`.
4. Obtain independently reviewed `recovery_receipt_sha256`.
5. On GitHub Actions → **Deploy Aria Mantu (Fly)** → Run workflow **on branch `deploy/fly-github-actions`** with:
   - `release_sha` = `$RELEASE_SHA` (exact 40 hex)
   - `recovery_receipt_sha256` = receipt
6. Post-deploy proof:

```bash
TIP=$(git rev-parse origin/deploy/fly-github-actions)
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq -e --arg tip "$TIP" \
  '.build==$tip and .components.agentFrameworks==true and (.migration|test("0087"))'
# Then Take→login→Release on each campaign LI desk;
# sessionHealthy===true only after probe — never invent true.
```

## Verdict

Tip N-agent class closed. Production goal remains **blocked on owner steps 1–6**. Do not UpdateGoal complete until Fly build==tip + migration≥0087 + LI desks healthy.
