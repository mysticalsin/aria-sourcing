---
project: MSourcing / ARIA
shift: 457
agent: cursor-cloud
updated: 2026-08-31T20:31Z
status: fly-restore-blocked-no-token
---

# Handoff — Shift 457

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN** (not merged). Do not close. Do not merge
- Fly restore product tip: **`6fd7e3f`** (`4f891b8` + type fix). Includes LinkedIn boolean **`d4399fc`**
- Live `https://aria-mantu-app.fly.dev/api/ready` still `ok:true` **build `7fe6702b202376b69fb2dcab7e9f062273a3980b`** migration `0079_autopilot_enqueue_approval_hash_bind.sql`
- Live `/api/health` HTTP 200. Login HTTP 200
- Devon already rolled machines to `registry.fly.io/aria-mantu-app:deployment-01M1BR8W8JXH84Y5TETMA3DQ8S`. Do not undo
- This VM: `FLY_API_TOKEN` unset; `fly auth whoami` = no access token. Did not invent a token. Did not fake a deploy
- Local gate green on `6fd7e3f`: `npm run typecheck && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no** until a keyed LinkedIn+Apify shortlist

## Done this shift

1. Confirmed live ready still reports leftover 53 SHA `7fe6702` after image rollback (secret-stamped `ARIA_RELEASE_SHA`)
2. `HOSTNAME=::` in `fly.app.toml` and `Dockerfile.prod` so Path B cannot reintroduce `0.0.0.0`-only bind
3. `ariaReleaseIdentitySha` — `/api/ready.build` prefers a baked 40-char image SHA over leftover `ARIA_RELEASE_SHA`

## Blockers

- No `FLY_API_TOKEN` on this VM. Cannot `fly deploy` or `fly secrets set`
- Official LinkedIn partner search is not wired; do not upgrade Apify

## Next steps

```bash
# When FLY_API_TOKEN is present (do not invent one):
# 1. fly auth whoami
# 2. From 6fd7e3f: fly deploy --config fly.app.toml --app aria-mantu-app --remote-only \
#      --build-arg NEXT_PUBLIC_ARIA_GIT_SHA=6fd7e3f3f5834dd1e04fdcbc0a57476083e610cb
#    Do NOT reset HOSTNAME to 0.0.0.0. toml now has HOSTNAME="::"
# 3. fly secrets set ARIA_RELEASE_SHA=6fd7e3f3f5834dd1e04fdcbc0a57476083e610cb --app aria-mantu-app
#    Do NOT change ARIA_EXPECTED_* (live is migration 0079 / count 78)
#    Do NOT set APIFY_TOKEN. Do NOT touch AskToto-Mantu
# 4. Prove:
curl -sS -w '\nHTTP %{http_code} exit %{exitcode}\n' https://aria-mantu-app.fly.dev/api/ready
#    expect ok:true build 6fd7e3f… NEVER 7fe6702
curl -sS -w '\nHTTP %{http_code} exit %{exitcode}\n' https://aria-mantu-app.fly.dev/api/health
#    expect HTTP 200
curl -sS -o /dev/null -w 'login HTTP %{http_code}\n' https://aria-mantu-app.fly.dev/login
# 5. Do not merge PR 53. Do not merge PR 54
# READY TO MERGE: no until a keyed LinkedIn+Apify shortlist
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- PR 54 restore onto Fly. PR 53 stays open and unmerged
- READY TO MERGE stays no until a keyed LinkedIn+Apify shortlist
- Fly only: `https://aria-mantu-app.fly.dev/`. No Vercel. No second implementer
- Preserve live `ARIA_EXPECTED_*` at migration 0079 / count 78
- `HOSTNAME=::` for IPv6 6PN. Do not reintroduce `0.0.0.0`-only
- Secrets override `--env` for `ARIA_RELEASE_SHA` — must `fly secrets set`
- Quality is the gate. Historic CI red matches main
- Do not put FLY_API_TOKEN on Quality
- Do not upgrade Apify as part of this restore

## Watch out

- Do not invent Fly tokens
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel or Polo
- Do not merge PR 53 or PR 54
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
