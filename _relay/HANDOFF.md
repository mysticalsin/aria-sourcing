---
project: MSourcing / ARIA
shift: 441
agent: codex
updated: 2026-10-27
status: connected-demo-prepared-docker-acceptance-deferred-by-owner
---

# Handoff - Shift 441

## Current state

- Branch mbe-branch. Code commits 48af1fab and 66d5df99 pushed successfully.
  Final documentation/relay snapshot follows them in this shift.
- Part 1 implementation is ready for Docker acceptance on another machine.
  `.scratch/local-demo-runtime/spec.md` is ready-for-human for that acceptance.
- No Docker/WSL installation was attempted. Owner explicitly asked to test Docker
  on another machine; respect this instruction in future Windows sessions.
- Local required gate passed after dependency updates: npm run typecheck,
  npm run typecheck:tests, npm test. Production Next build also passed with the
  connected local public URLs/key. Lint passed with zero errors and two existing
  navigation warnings surfaced by the new Next plugin.
- npm audit --audit-level=high reports zero vulnerabilities. Redacted full-history
  Gitleaks scan reports no leaks after exact reviewed false-positive exceptions.
- CI on 66d5df99 was in progress at the last check:
  https://github.com/mysticalsin/aria-sourcing/actions/runs/40488057356
  CodeQL run 40488057141 was also in progress. Do not call either successful yet.
- Earlier own run 40485334903 was cancelled while the browser install stalled;
  its Quality job passed and CodeQL passed. No Docker acceptance receipt exists.
  The current job uses the runner's preinstalled Chrome instead of downloading it.

## Done this shift

1. Reviewed container roles: five justified permanent services (app, db, auth,
   rest, kong) and two short-lived initialization jobs (db-init, bootstrap).
   No Studio, Realtime, Storage, Redis or local AI container added.
2. 48af1fab: multi-stage non-root compiled image by default; development with
   source/node_modules/.next mounts moved to docker-compose.dev.yml.
3. Native PostgREST --ready replaces a bash probe absent from the amd64 image.
   App health now requires /api/ready=200 and verifies baked migration identities.
   Added custom-port Auth origins, bounded owner wait, JSON-safe seeded-user
   extraction and reduced bootstrap credentials to its required postgres scope.
4. Paired db_data/app_config volumes preserve state and the local generated
   encryption key. Runtime rejects corrupt/replaced keys and public build/runtime
   configuration mismatches. Normal helpers never reset DB or overwrite .env.local.
5. Settings -> Workspace -> Check connections verifies core backend/encryption,
   distinguishes saved optional integrations from proven connectivity, makes no
   paid provider calls and requires administrator authentication for live details.
6. Added a guarded disposable Docker/browser acceptance recipe: clean startup,
   real login, UI-created campaign/manual fixture candidate, encrypted fixture key,
   refresh, down/up preserving volumes, fresh login, state and decryption checks.
   It blocks browser external-provider traffic and uses synthetic fixture data.
7. 66d5df99: cleared existing CI blockers without weakening gates. One SQL test
   harness used absent rg; portable fixed-string grep now checks the same SQLSTATE.
   Seven exact historical secret-scan matches were reviewed: mocked fixtures,
   TypeScript type annotations, boolean reporting/profile-mapping fields. Only
   their exact fingerprints were excluded; no paths/rules/history were removed.
8. Removed unused 3D packages; patched Next/ESLint to 16.4.3, Zod to 4.6.7 and
   PostCSS to 8.5.32 with a direct-dependency override. Full type/test gates passed.
9. DOCKER.md now describes start/stop, diagnostics, durable keys, custom ports,
   development override and acceptance. ADR 0001 records the Azure target review.
   No Azure resource, production database or real provider account was changed.

## Blockers

- Actual Compose/browser acceptance is intentionally deferred to another machine
  by the owner. Do not describe the recipe as executed or passed until a real
  receipt is produced. The CI job is pending at the recorded run above.
- Azure Flexible Server is not a drop-in replacement: current reconciliation
  requires a true supabase_admin superuser; Azure administrators do not have it.
  Managed-database bootstrap adaptation stays a separate open finding.
- No GPT/Claude, sourcing, mailbox or calendar provider acceptance was performed
  here; those integrations belong to later slices of the recruiting journey.

## Next steps

1. On the owner's Docker machine, update mbe-branch without discarding local work.
   Follow DOCKER.md: docker compose up --build --detach --wait --wait-timeout 300.
2. Sign in at localhost:3000/login with the documented local sample account.
   Check Settings -> Workspace -> Check connections, create a campaign, refresh,
   stop via docker compose down, start again without deleting volumes, and verify
   the campaign remains. Preserve db_data and app_config together.
3. Run the guarded test:local-demo recipe on a new aria-acceptance-* project if
   Node 22 and an acceptance browser are available. Never use normal workspace
   volumes. Fix observed errors and mark the spec done only after its receipt.
4. Check CI 40488057356 (or the final docs tip's run) to completion, especially
   Local Docker demo and all database security suites. Keep all required gates.
5. After part 1 acceptance, begin the agreed LinkedIn-first unified campaign run
   slice. Configure one GPT/Claude provider later when requested.

## Decisions made (don't relitigate)

- No Docker or WSL installation in this Windows session. Runtime test elsewhere.
- Retain five permanent Supabase/app boundaries and two ordered init jobs;
  optimize the app image and reliability instead of combining unrelated processes.
- Local connected Docker demo first; hosted GPT/Claude for demo simplicity; local
  LLM acceptance deferred. No Fly/Vercel or external agent framework work.
- Proposed first Azure internal pilot reuses the standalone image and current
  boundaries on a private Linux VM with durable storage, Key Vault and HTTPS.
  ADR is a target design, not a deployed/executable production configuration.
  Managed PostgreSQL/Container Apps require a proven authorization migration.
- Preserve `_relay/`, `_agent_state/`, baseline migrations, existing state and
  human approval for outreach. No real sourcing/outreach was executed this shift.

## Watch out

- Default Docker app is compiled; changing public origins/ports requires rebuild.
  Only explicit loopback HTTP gets local cookie/HSTS exceptions; remote origins
  keep production security. Server still uses internal Kong URL.
- Existing DATA_ENCRYPTION_KEY must remain stable. An existing generated key is
  not silently replaced. Back up database plus key together; never reset to fix
  an initialization or decryption error.
- The optional dev override shares app_config. On Linux, ensure its node user can
  write generated checkout files. Development health is liveness, not release identity.
- GitHub default-branch vulnerability warnings describe another branch; use the
  current lockfile audit and current CI results for mbe-branch status.
- Local logs are under $env:TEMP/aria-part1-*.log; ignored tmp contains only test
  helpers and fully redacted scan reports. No secrets are recorded in the relay.