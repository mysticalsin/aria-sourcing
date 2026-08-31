---
project: MSourcing / ARIA
shift: 443
agent: cursor-cloud
updated: 2026-08-31T19:50Z
status: apify-quota-blocks-live-linkedin-harvest-pr53-open
---

# Handoff — Shift 443

## Current state

- **Branch tip:** `cursor/sourcing-quality-contact-track-b91d` @ `7fe6702`.
- **PR #53:** OPEN — https://github.com/mysticalsin/aria-sourcing/pull/53 — human title preserved.
- **Fly `aria-mantu-app`:** `/api/ready` ok — build **`7fe6702b202376b69fb2dcab7e9f062273a3980b`**, migration `0079_autopilot_enqueue_approval_hash_bind.sql`.
- **Vault Apify:** connected (`provider: Apify`, last4 `lRfy`); `/api/keys` GET hydrates UI; `/api/keys/test` → HTTP 200.
- **No Fly secret `APIFY_TOKEN`** (vault path is preferred; env fallback exists in code).
- **Live Source (Calypso Application Support):** HTTP **502** `SOURCING_PROVIDER_QUOTA` — Apify free-plan run limit reached (actor returns SUCCEEDED + empty dataset + statusMessage `free user run limit reached`). Not MISSING_PLUGIN; not a false negative on key detection.

## Done this shift

1. Multi-provider LinkedIn/Apify path + `MISSING_PLUGIN` fail-closed when vault/env Apify absent.
2. LinkedIn-first Source forces multi-provider harvest even when cloud AI is configured.
3. Profile harvest uses `Full + email search`; Fly `idle_timeout=180`.
4. GET `/api/keys` + workspace hydrate so Settings/Source UI show vault Apify.
5. Detect Apify free-plan empty SUCCEEDED → `SOURCING_PROVIDER_QUOTA` (not soft-empty).
6. Deployed tip `7fe6702` to Fly; proved Source returns quota error with settingsHref.

## Blockers

- **Tony must upgrade Apify plan (or wait for free-plan monthly reset)** on account behind vault key last4 `lRfy`. Until then live LinkedIn harvest cannot return candidates.
- Optional: paste a paid `APIFY_TOKEN` into Settings → Access & Keys (or Fly secret) once upgraded.
- PR #53 still needs non-pusher approval for merge.

## Next steps

```bash
# Tony — Apify console: upgrade plan / confirm paid actor rental for harvestapi/linkedin-profile-search
# Then re-test:
curl -s https://aria-mantu-app.fly.dev/api/ready   # expect build 7fe6702…
# Source next batch on Calypso campaign → expect totalFound > 0 with LinkedIn+email
gh pr review 53 --approve
```

## Decisions made (don't relitigate)

- One PR (#53) only — no second PR.
- No Microsoft chase.
- Do not weaken 80% quality floor / hard gates to let GitHub weak matches fill LinkedIn-first roles.
- Soft-empty under hard gates remains OK for GitHub-first; LinkedIn-first + Apify failure must hard-fail (MISSING_PLUGIN or SOURCING_PROVIDER_QUOTA).
- Human PR title/body preserved; append-only body edits.

## Watch out

- Preserve live `ARIA_EXPECTED_*` at migration 0079 / count 78 when redeploying.
- `flyctl` deploy: unset broken `FLY_API_TOKEN` env so config.yml compound token works.
- Apify free SUCCEEDED+empty looks like a real miss unless statusMessage is read.
