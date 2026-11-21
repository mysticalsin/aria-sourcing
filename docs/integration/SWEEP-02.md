# Sweep 2 — remaining blockers

Suite head: `94164d39921a346fceeefce7b934be10c760732f` on `integration/aria-all`.

Click run: `e2e-artifacts/20261121T063931Z/`. Playwright exit 0. Compose exit 0. Playwright 1.65.1 headed under xvfb. Screenshots are also in `docs/integration/screenshots/`. The synthetic demo is `http://127.0.0.1:3000`. Odoo is `http://127.0.0.1:8069/aria/pipeline`. Ingest is `http://127.0.0.1:8091/health`.

Sweep 1 was 13 pass. This run is those 13 plus the CV upload, 14 pass, 0 fail.

## Journey matrix

| Step | Sweep 1 | Sweep 2 | What changed |
|---|---|---|---|
| Create a need | pass | pass | Unchanged. |
| Source and import a synthetic candidate | pass | pass | Unchanged. |
| Ranking with reasons | pass | pass | Unchanged. |
| Draft outreach | pass | pass | Unchanged. |
| Manual exact-text approval | pass | pass | Unchanged. |
| Send to a fake sink | pass | pass | Unchanged. |
| Auto mode blocked until QC | pass | pass | Unchanged. |
| HeyReach off | pass | pass | The label stays Off. The catalog turns the channel on only when the flag, an approval id, and a body hash are all set. |
| LinkedIn token off by default | pass | pass | Unchanged. |
| Kill switch | pass | pass | Unchanged. |
| Quick stats | pass (labels, numbers covered) | pass | Skip closes the tour. The to-rate number accepts a trial click. A later visit has no dialog and the hires number is visible. |
| CV upload | not run | pass | Upload of `e2e/fixtures/casey-example.pdf` shows Casey Example. |
| Odoo pipeline | pass | pass | Unchanged. |
| GDPR opt-out and erasure | pass | pass | Unchanged. |

## Findings

| # | Severity | Root cause | Owner | Fix | Red-first |
|---|---|---|---|---|---|
| 1 | correctness | The first-run dialog stayed mounted after leaving Home, so its focus trap covered later pages. | #177 `src/components/app/onboarding.tsx` | The dialog closes when the path is not Home. Skip still keeps a return visit closed. | `60e8ef68` |
| 2 | spec-mismatch | The candidate screen had no upload, and ingest had no HTTP handler. | #217 child #284 | `POST /v1/cv` parses a text-layer PDF. The candidate screen posts it through `/api/ingest/cv` and adds the person. | `4da47449` |
| 3 | correctness | The campaign page fetched sourcing feedback while Supabase was off, and the dev server logged 503. | `twa-odoo` `src/lib/store.ts` | The route still returns 503. The demo returns an empty list before the fetch and shows "Sourcing learning is off in this demo." | `b733c2ab` |
| 4 | correctness | The overlay replaced ingest with `sleep infinity`. | integration compose | The overlay builds `services/ingest/Dockerfile`, runs `ingest serve`, and checks `ingest ready`. | image build in this sweep |
| 5 | security | The sweep inserted a `172.16.0.0/12` accept rule with no host check. | `scripts/sandbox-bridge.sh` | Darwin always skips. Any other host skips unless `CI`, `GITHUB_ACTIONS`, `CURSOR_AGENT`, or `ARIA_SANDBOX` marks a sandbox. | `dfcebafb` |

`GET /api/sourcing-learning/feedback` stays fail-closed. The sweep's Next log has no 503. The ingest log line is `ingest id=upl-ad17eb434b9c5b12 bytes=851 state=ready_for_to_rate` and does not include the name or the address.

#282 fixes the agents healthcheck with `process.kill(1,0)`. #210 does not add that check.

## Pull requests

| PR | Base | Head | Tree | Red-first |
|---|---|---|---|---|
| [#210](https://github.com/mysticalsin/aria-sourcing/pull/210) | `twa-odoo` | `c61327c460706c558ddd861b1b02a91a44f05063` | `21fba3bb1830b4580d0a9db237ff14251d177940` | `b733c2ab` (learning). Intake red remains `fbc0d5cd`. |
| [#212](https://github.com/mysticalsin/aria-sourcing/pull/212) | `cursor/tony-quick-stats-9bce` (#177) | `e859a278b151eb4a0a02e938e762a9d8d11cfb09` | `ff33461c37736b5978631de1e23f589341fa40ac` | `60e8ef68` (tour). HeyReach red remains `2926fcd1`. |
| [#284](https://github.com/mysticalsin/aria-sourcing/pull/284) | `cursor/aria-174-e2e-fix-e95d` (#217) | `2c1d20476b3dd550e0109549770e024d30eb3f11` | `c1fa4d205264fcfd17f5beda6393de153b68ca67` | `4da47449` |
| [#208](https://github.com/mysticalsin/aria-sourcing/pull/208) | `twa-odoo` | suite `94164d39921a346fceeefce7b934be10c760732f` | `2fb268870b73c51bf064b9bb409471315cb0239c` | `dfcebafb` |

#284 is stacked on #217. The click and stress suite ran at `94164d39`, which contains the tour, learning, CV, and ingest fixes. #212 and #284 each have one later commit that excludes `e2e` from the Next typecheck, because those branches do not install `@playwright/test` and the image build was failing on the new spec. This branch's later commit is the writeup.

## Stress

| Case | Sweep 1 | Sweep 2 | Note |
|---|---|---|---|
| A1 Postgres daily cap | PASS | PASS | sent=50, refused=450, `channel-cap`. |
| A1 per-channel cap | PASS | PASS | |
| A2 kill switch | PASS | PASS | |
| A3 auto-pause | PASS | PASS | |
| A4 approval replay | PASS | PASS | |
| A5 hired gate | PASS | PASS | |
| A6 channel burst | PASS | PASS | |
| A7 LinkedIn token | PASS | PASS | No refresh RPC. |
| A8 soak | PASS at 1800.045s | PASS at 600.074s | `STRESS_SOAK_SECONDS=600`. |

Artifact: `e2e-artifacts/20261121T063931Z/summary.json`. Compose exit 0. Playwright exit 0.

## Remaining

The integration branch still fails four compliance checks that arrived with the token-channel merge: banned labels named from tests and `docs/integration/CONFLICTS.md`, a HeyReach-unrelated LinkedIn surface scan, and `xfail` text inside the token suite's own skip gate. The HeyReach catalog check passes on this head. This branch stays unmerged.
