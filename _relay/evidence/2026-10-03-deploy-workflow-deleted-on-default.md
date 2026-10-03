# Deploy Aria Mantu workflow deleted on default branch

**Probed:** 2026-10-03T21:37Z

## Evidence

```text
gh api repos/mysticalsin/aria-sourcing/actions/workflows/deploy-aria-mantu.yml
→ state: deleted (id 311052846), path .github/workflows/deploy-aria-mantu.yml
html_url points at vercel-demo blob (file absent)

gh workflow list → no "Deploy Aria Mantu (Fly)"
gh workflow run "Deploy Aria Mantu (Fly)" → could not find any workflows

Default branch: vercel-demo (no deploy-aria-mantu.yml)
deploy/fly-github-actions + tip branches: file present
```

## Fix

PR #151 → `vercel-demo` restores tip’s `deploy-aria-mantu.yml` so Actions reactivates the workflow.
`validate-dispatch` still requires protected `deploy/fly-github-actions`.

## Related

PR #150 lands N-agent tip onto deploy branch (still REVIEW_REQUIRED).
