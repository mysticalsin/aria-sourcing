---
project: ARIA / MSourcing
agent: claude-code
updated: 2026-07-24
status: retired-not-committed
severity: high
scope: release surface, secret handling
---

# `.gitlab-ci.yml` retired before it was ever committed

## What existed

An untracked `.gitlab-ci.yml` sat in the repo root. Intent, per its own header: deploy the
Aria Mantu Fly stack from a GitLab runner because the runner has a clean, fast network to
Fly — a reaction to the local `flyctl` build stalling while reading the OneDrive working
tree.

Verbatim content, preserved here because it holds only variable *names*, no secret values:

```yaml
# GitLab CI/CD — deploy the Aria Mantu Fly stack from a GitLab runner (clean, fast
# network to Fly). Secrets come from ONE masked CI/CD variable ARIA_DEPLOY_BUNDLE
# (base64 of a tar of production-readiness/.fly-token.env + .fly-secrets.env + .env.local);
# nothing secret is committed. Trigger the "deploy-fly" job manually from the Pipelines UI.

stages:
  - deploy

deploy-fly:
  stage: deploy
  image: alpine:3.20
  variables:
    FLY_NO_METRICS: "1"
    DO_NOT_TRACK: "1"
  before_script:
    - apk add --no-cache curl bash tar coreutils grep
    - curl -L https://fly.io/install.sh | sh
    - export FLYCTL_INSTALL="$HOME/.fly"
    - export PATH="$FLYCTL_INSTALL/bin:$PATH"
    - fly version
  script:
    - |
      if [ -z "$ARIA_DEPLOY_BUNDLE" ]; then
        echo "ERROR: set the ARIA_DEPLOY_BUNDLE CI/CD variable first"; exit 1
      fi
      echo "$ARIA_DEPLOY_BUNDLE" | base64 -d | tar xzf - -C .
      echo "restored:"; ls -1 production-readiness/.fly-*.env .env.local 2>/dev/null
    - bash deploy-fly.sh
  rules:
    - when: manual
  timeout: 45 minutes
```

## Why it is retired rather than committed

1. **It cannot do its job.** `deploy-fly.sh:19-20` requires `GITHUB_ACTIONS=true` and
   `GITHUB_REF_PROTECTED=true` and calls `die` otherwise. On a GitLab runner neither is set,
   so the job fails closed at the guard. The pipeline never reaches a single `fly deploy`.
2. **It still materialises the entire production secret bundle on third-party
   infrastructure.** The `script` block base64-decodes `ARIA_DEPLOY_BUNDLE` — a tar of
   `production-readiness/.fly-token.env`, `.fly-secrets.env` and `.env.local` — onto the
   runner filesystem and then `ls`-es the result into the job log. The Fly deploy token, the
   Supabase service-role key, the data encryption key, the cron secret and every provider API
   key in `.env.local` land on a runner this project does not control, in a job whose log is
   retained by GitLab. That happens *before* the guard rejects the deploy, so the failure mode
   is "secrets exposed, nothing deployed" — strictly worse than not running at all.
3. **It repeats a logged incident.** See
   `_relay/incidents/2026-07-11-fly-deploy-token-exposure.md`.
4. **The repo had already ruled on it.** `.dockerignore:42` lists `.gitlab-ci.yml` and
   `:57-58` list `deploy-fly.sh` / `deploy-fly-*.sh` under "retired deploy surfaces", and
   `tests/infra-release-contract.mts:102-103` names `.gitlab-ci.yml` explicitly in the
   executable-release-surface filter while `:104` matches `ARIA_DEPLOY_BUNDLE` and
   `bash deploy-fly.sh` in its unsafe-surface detector. Committing the file would have made
   `tests/infra-release-contract.mts` fail — the contract was written to catch exactly this.

## Action taken

- The file was removed from the working tree. Its full content is preserved above.
- A session backup also exists outside the repo at
  `<session scratchpad>/gitlab-ci.yml.backup`.
- No secret value was read, printed, or copied at any point.

## If a faster deploy network is still wanted

Do not solve it by moving credentials. The two supported routes:

- **Keep the protected GitHub Actions release workflow as the only credentialed surface** and
  fix the local slowness instead — that is what `scripts/prod-deploy-app.sh` already does by
  rsyncing a small mirror off the OneDrive mount before invoking Fly.
- **If GitLab is genuinely wanted as the runner**, it needs its own first-class release
  authority: an OIDC-federated short-lived Fly token (never a tarball of dotfiles), the
  `ARIA_RELEASE_SHA` + protected-ref + clean-tree checks ported to GitLab's own predefined
  variables, and registration in `reviewedAlternateDeploySurfaces`. That is a design change,
  not a config file, and it needs owner sign-off.

## Owner decision needed

Whether to pursue the GitLab runner properly, or close the idea and keep GitHub Actions as
the single credentialed release path. Until then, GitHub Actions remains the only surface
allowed to hold production credentials.
