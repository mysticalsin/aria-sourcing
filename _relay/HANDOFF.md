---
project: MSourcing / ARIA
shift: 439
agent: codex
updated: 2026-10-27
status: local-provider-implemented-tested-push-and-live-acceptance-blocked
---

# Handoff - Shift 439

## Current state

- Branch `mbe-branch`; code tip `52136c69`. This shift has three code commits
  plus the relay/issue snapshot commit. No unrelated initial changes existed.
- Remote `mbe-branch` remains `9c70015b137a5ef4626d69380020a46cb6a367db`
  (verified with `git ls-remote`). Nothing from this shift was pushed.
- Required local gate passed: `npm run typecheck`, `npm run typecheck:tests`,
  `npm test`. Full lint passed; final client-error changes also passed targeted
  ESLint, TypeScript checks and sourcing-agent-contract tests.
- Edge headless smoke: `/exec`, `/candidates`, `/calendar`, `/settings` return
  200 with no page errors. Local provider URL/model survive a browser reload.
  Calendar shows its fixed demo date. Report still shows 30.9 h saved.
- Demo server used port 3100 and has been stopped. No database or live candidate
  data was changed. `_agent_state/` is untouched.

## Done this shift

1. `a0d0c179` - Windows/Git Bash test portability: LF SQL/shell checkout policy,
   curl config paths, platform PATH delimiter, explicit test-certificate trust,
   source-text and repository-path normalization. No schema content changed.
2. `51a0e7a5` - issue 08: bookings use the fixed seed date at 14:00 UTC; demo
   calendar uses the same date; absolute activity dates no longer say "ago".
   Regression tests cover elapsed interview timing and time formatting.
3. `52136c69` - issue 01 implementation: Local / OpenAI-compatible provider,
   admin URL/model fields, optional Custom vault key, server-side URL validation,
   model tags, drafting/intake/classification/chat and campaign tool-loop wiring.
   The neutral validator retains its legacy runtime alias. Redirects and
   metadata/credential/query/fragment URLs remain blocked.
4. Empty, invented-ID, or fully rejected model drafts cannot turn found eligible
   profiles into an empty success. The client shows safe recovery guidance.
   Real empty searches and deterministic real sourcing remain available.
5. Added actual loopback HTTP tool-roundtrip and route/authority regressions;
   documented setup and acceptance in DOCKER.md. Findings have commit references
   in `_relay/codex-findings.md`; issues 01, 06 and 08 contain current evidence.
6. Checked yesterday's public CI at 9c70015b: Quality passed; Dependency audit,
   Secret scan, Database security and their aggregate Release gate failed.
   See `.scratch/demo-cleanup/issues/06-ci-after-cleanup.md` for the exact run.

## Blockers

- `git -c credential.interactive=never push origin mbe-branch` failed with:
  `fatal: Cannot prompt because user interactivity has been disabled.`
  `fatal: unable to get password from user`.
  GitHub credentials are unavailable to this noninteractive Windows session.
  The previous account permission denial was not re-established this shift.
- No Docker executable found and no Ollama service at `127.0.0.1:11434`.
  Issue 01 stays open until a real campaign completes against an installed
  Ollama model and the Docker database. Protocol/authority tests are not that
  acceptance test. Database suites were not rerun here.
- Existing CI failures are on the old remote tip, not these new commits:
  Dependency audit / Audit high and critical advisories;
  Secret scan / Scan full history including the current release commit;
  Database security / Verify candidate erasure authority.
  Public annotations expose exit code 1 only; underlying causes are not yet
  diagnosed. Do not label the release gate green.

## Next steps

1. Configure repository credentials for this session, then run
   `git push origin mbe-branch`; verify the remote SHA and all required CI jobs.
   Do not force-push or rewrite shared history.
2. Triage issue 06 using failed job logs. Reproduce the candidate-erasure DB
   authority suite on disposable Postgres and audit dependencies; keep secret
   scan output redacted and preserve all required gates.
3. Follow DOCKER.md to start Supabase/app and host Ollama. Configure the local
   provider and task-default Saved Models, review a campaign, run its agent,
   verify cloud mode, real search receipts and usable drafts, then close 01.
4. For an existing browser demo snapshot, use Settings -> Reset synthetic demo
   to reload corrected seed dates. Saved snapshots are deliberately preserved.

## Decisions made (don't relitigate)

- Target is a working local Docker product now; internal Azure/Terraform later.
  No Fly/Vercel work. Repo docs remain English.
- Clean baseline schema remains 0001 + 0002; no migration edited semantically.
- `_relay/` and `_agent_state/` stay. One in-process sourcing agent; no external
  agent framework. Decision reporting remains in `/exec`, with shared ROI inputs.
- Existing real-send metrics remain strict. Simulated sends are included only
  by the demo decision report.

## Watch out

- Task-default Saved Models take priority over the default provider. Configure
  them or disable hosted providers when all inference must stay local. Search
  still calls GitHub/public sources; local inference does not mean offline.
- Direct Azure api-key/api-version endpoints need a dedicated adapter; this
  provider expects the OpenAI-compatible chat/completions and Bearer protocol.
- Local URL allow-list: `PROVIDER_ALLOWED_HOSTS` adds deployment-owned exact DNS
  hosts; legacy HERMES_ALLOWED_HOSTS remains supported. No hosted environment
  key is forwarded to a custom endpoint.
- Standard Node/npm were absent from PATH. Temporary verified Node 22.23.4 and
  jq live under `$env:TEMP/aria-node-runtime/node-v22.23.4-win-x64`. Tests also
  need `C:/Program Files/Git/usr/bin` and `C:/Program Files/Git/bin` for OpenSSL
  and Bash. Normal `npm ci` installed the lockfile without changing it.
- Ignored `tmp/aria-*.mjs` contain the reproducible browser/diagnostic scripts;
  test logs are under `$env:TEMP/aria-*.log`. No secrets are stored in the relay.