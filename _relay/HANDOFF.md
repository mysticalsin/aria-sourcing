---
project: MSourcing / ARIA
shift: 440
agent: cursor-cloud
updated: 2026-08-31T04:15Z
status: pr-open
---

# Handoff — Shift 440

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54** against `main`
- Product Verifier PASS on `5b40b5e` (citations, engine evidence, unclustered scores, no `@fixture.example` on Talent Pool)
- Quality on `5b40b5e` failed: `flyctl config validate` → `no access token available`
- Fix: offline TOML/schema check in `infra/agent-frameworks/fly/validate-fly-toml.mjs`; Quality no longer installs flyctl; private-no-proxy assertions unchanged
- No `FLY_API_TOKEN` / `flyctl auth` on the Quality job
- Secret scan / dep audit / db-security still match main — do not chase
- READY TO MERGE stays **no** until Quality is green and Devon Fly-shows

## Done this shift

1. Replaced `execFileSync("flyctl", ["config", "validate", ...])` with `validateFlyRoleToml`
2. Removed Quality `setup-flyctl` (that install is what made Quality worse after ENOENT)
3. Kept `[[services]]` / `[http_service]` fail-closed
4. `node --test infra/agent-frameworks/fly/deployment.test.mjs` 15/15

## Blockers

- Historic CI (secret scan / dep audit / db-security) matches main — still required, merge stays unstable
- Live Fly login proof after land is Devon (`https://aria-mantu-app.fly.dev/`)
- Fly still v163 until this SHA lands

## Next steps

```bash
# Wait for Quality green on this SHA
# Devon: deploy to Fly aria-mantu-app, then login-proof
# Do not merge until Devon Fly-shows
# Do not open a second PR; do not touch Vercel or Polo or PR #53
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Shortlist floor 60%; PR #53 80 floor out of scope
- Quality must validate Fly TOML without a Fly account
- One PR (#54). Fly is the production bar

## Watch out

- Manifest freeze application **154** / all **207** / parity **209**
- Do not put FLY_API_TOKEN on Quality
- Do not weaken private-no-proxy
