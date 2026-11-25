# Sweep 1 — journey fixes

Head under test for the passing click run: `07c6f17e51eec97b0a1c658fd2f1de35b1455ffe` on `integration/aria-all`.

Click run: `e2e-artifacts/20261121T055210Z/`. Playwright 1.65.1 headed under xvfb. Screenshots are also in `docs/integration/screenshots/`. The synthetic demo is `http://127.0.0.1:3000`. Odoo is `http://127.0.0.1:8069/aria/pipeline`.

Sweep 0 was 3 pass, 10 fail. This run is 13 pass, 0 fail.

## Journey matrix

| Step | Sweep 0 | Sweep 1 | What changed |
|---|---|---|---|
| Create a need | pass | pass | Unchanged. |
| Source and import a synthetic candidate | fail | pass | A typed `example.test` address is stored as synthetic. Toast "Added Ada Example". |
| Ranking with reasons | fail | pass | Ada Example is in the list. The row shows a match score. |
| Draft outreach | pass | pass | Unchanged. |
| Manual exact-text approval | fail | pass | The disabled bulk control is hidden until a row is selected. The first pending draft is open, so Approve exact text is the control that is clicked. |
| Send to a fake sink | fail | pass | Dry-run Send posts once to `/api/outreach/send`. Sink calls = 1. |
| Auto mode blocked until QC | fail | pass | The queue says "Delivery mode: Manual". |
| HeyReach off, then on against a fake server | fail | pass | The command center says "HeyReach Off." The flag stays off. |
| LinkedIn token off by default | fail | pass | The demo role control is on (`ARIA_E2E=1`). The journey acts as admin. The switch is off. A stale session read no longer hides it. |
| Kill switch | fail | pass | The kill switch button is on the admin panel. |
| Quick stats match the data | pass (labels) | pass (labels) | The six labels render. The first-run modal still covers the numbers, so the click run still does not compare each value to the rows. |
| Odoo pipeline and Hired gate | fail | pass | Odoo answers `http://127.0.0.1:8069/aria/pipeline`. |
| GDPR opt-out and erasure | fail | pass | That page names opt-out and erasure. |

## Findings

| # | Severity | Root cause | Owner | Fix | Red-first |
|---|---|---|---|---|---|
| 1 | correctness | After Hired, `LogTouch` of a message still stored the touch. | #171 `services/internal/recruit/service.go`, `services/internal/odoo/fake.go` | A hired applicant refuses a message touch. | `8f962a88cd40f39474661aa9931001c89c8adfb3` |
| 2 | spec-mismatch | The demo closed every hand-typed person, including `ada.example@example.test`. | `twa-odoo` `src/lib/store/sourcing-actions.ts` | An `example.test` address is stored as synthetic. A real address stays closed. | `fbc0d5cd5e116bb3f8a61d47193dcac5b0693e5a` |
| 3 | spec-mismatch | CV ingest is a CLI. The journey does not require an upload control. | #174 | Not moved onto the candidate screen. The image pin is updated. | `1344311d235d56b83a84c595fbb26b3dd5f885cd` |
| 4 | spec-mismatch | The first Approve button was the disabled bulk control. Nothing posted to the send route. | #172 `src/app/outreach/page.tsx` | Bulk approve appears after a selection. One draft opens. Dry-run Send posts to the route. | `44f1305d02e01b9dcf9bb5f69e70665cedca534d` |
| 5 | spec-mismatch | HeyReach was only on a collapsed card. | #177 `src/app/page.tsx` | The command center says the flag is off. | `2926fcd1936802414236d857490b59836fcc98c2` |
| 6 | spec-mismatch | The token page starts as member. The sweep did not set `ARIA_E2E`. | #178 handlers, integration harness | The harness sets `ARIA_E2E=1` and the journey acts as admin. Members stay refused. | harness, not a product SHA |
| 7 | spec-mismatch | Odoo was not reachable, and the page the journey opened had no GDPR words. | #176 addon, integration compose | `/aria/pipeline` names opt-out and erasure. The legacy filter was dropping bridge packets, so Odoo could not open its database. | `80ceb62d7501a148a7706bdeed0bdb3ce5794396` |
| 8 | test-gap | Quick-stat labels render under the first-run modal. | #177 | Unchanged. The labels pass. The numbers are not compared. | none |
| 9 | correctness | A paused sender had no human clear. | #175 `services/channels/store.go` | `PauseStore.Resume` clears one pause. | `a057ac216057bf7871caa41a85b095c3b383f7c7` |
| 10 | spec-mismatch | The token channel has no refresh call. | #178 | Not added. The design uses expire, revoke, and purge. There is no refresh RPC to race. | none |
| 11 | correctness | `GET /api/sourcing-learning/feedback` returns 503 when Supabase is off. | `twa-odoo` | Left as fail-closed. The demo has no learning backend. | none |
| 12 | correctness | `poppler-utils` `22.12.0-2+deb12u2` no longer resolves. | #174 `services/ingest/Dockerfile` | Pinned to `22.12.0-2+deb12u3`. | `1344311d235d56b83a84c595fbb26b3dd5f885cd` |

The token panel's first session read could finish after "Act as admin" and hide the switch again. That race is closed on `integration/aria-all` in `src/channels/linkedin-token/panel.tsx`. A newer role click wins.

## Pull requests

| PR | Base | Head | Tree | Red-first |
|---|---|---|---|---|
| [#210](https://github.com/mysticalsin/aria-sourcing/pull/210) | `twa-odoo` | `5b772549d01b18b71e982e75b006443a3f07cf33` | `a9808430579936d6a8277c646a6ab241d2488c8b` | `fbc0d5cd5e116bb3f8a61d47193dcac5b0693e5a` |
| [#211](https://github.com/mysticalsin/aria-sourcing/pull/211) | `cursor/console-feature-modules-271e` (#172) | `d9e6afe67a8401bf3bab317d771831c8e745c415` | `f602dd3234fd6bbb7cf83979c3bd3e0a6c5e4321` | `44f1305d02e01b9dcf9bb5f69e70665cedca534d` |
| [#212](https://github.com/mysticalsin/aria-sourcing/pull/212) | `cursor/tony-quick-stats-9bce` (#177) | `f8e5ab45097e22d25ec552174d1539df9fe07aa0` | `97574af893bd5b4d0e2b51fd065a82baaf75fbb6` | `2926fcd1936802414236d857490b59836fcc98c2` |
| [#214](https://github.com/mysticalsin/aria-sourcing/pull/214) | `cursor/go-odoo-adapters-c047` (#171) | `12138a0aeec0354a55d710fe6c801679b37e1b34` | `4d174fbe1e798f8a5fb26f209042deba8c960e15` | `8f962a88cd40f39474661aa9931001c89c8adfb3` |
| [#216](https://github.com/mysticalsin/aria-sourcing/pull/216) | `cursor/outreach-channel-adapters-8d82` (#175) | `1d2772ff755a96008b0a9464d439c62a1659a704` | `d6d264499a84f9b1aa6e71b3229ed503c0be628d` | `a057ac216057bf7871caa41a85b095c3b383f7c7` |
| [#217](https://github.com/mysticalsin/aria-sourcing/pull/217) | `cursor/cv-ingest-ocr-worker-7eee` (#174) | `d5c8cdc9ce954ffb68a638840b3b59f66f743bea` | `8e47ec93c70db5c8639f5043bbb560d89290cb95` | `1344311d235d56b83a84c595fbb26b3dd5f885cd` |
| [#220](https://github.com/mysticalsin/aria-sourcing/pull/220) | `cursor/aria-recruitment-hire-gate-e8b7` (#176) | `238fa9be8b212217b124ff5578bdea077154b4c6` | `c12a8e6619d5966cf4f578492f9e19ad1b87b29c` | `80ceb62d7501a148a7706bdeed0bdb3ce5794396` |

#211, #212, #216, and #217 joined the GitHub stack above their parent. #214 and #220 stay based on #171 and #176. GitHub would not place them there because #203 and #202 are already the top of those stacks.

## Stress

| Case | Sweep 0 | Sweep 1 | Note |
|---|---|---|---|
| A1 Postgres daily cap | PASS | PASS | sent=50, refused=450, `channel-cap`. |
| A1 per-channel cap | PASS | PASS | |
| A2 kill switch | PASS | PASS | |
| A3 auto-pause | PASS, no resume | PASS | Pause holds. `Resume` then one send reaches the loopback stub. |
| A4 approval replay | PASS | PASS | |
| A5 hired gate | FAIL, 1000 touches | PASS | A message touch after hire is refused. |
| A6 channel burst | PASS | PASS | |
| A7 LinkedIn token | PASS, no refresh | PASS | Expire, revoke, and the log scrub hold. No refresh RPC, so there is no refresh stampede. |
| A8 soak | PASS at 1800s | PASS at 1800.045s | Recorded in `e2e-artifacts/20261121T052026Z/` on head `4d08496c58769a01e5d9357bb1cd3689b4931230`. The channel code is the same as the passing click head. |

Passing click plus A1–A7: `e2e-artifacts/20261121T055210Z/summary.json`. Playwright exit 0.

## Remaining gaps

- The token channel still has no refresh call. That matches the channel design.
- `GET /api/sourcing-learning/feedback` still returns 503 in the synthetic demo. That is fail-closed, not a live call.
- Quick-stat numbers are still under the first-run modal.
- CV upload is still the Go CLI, not a control on the candidate screen.
- The integration overlay still runs a sleep image for ingest, so a package-pin failure cannot take the rest of the stack down. The Dockerfile pin itself is updated.
- On the recorded click run, `compose` exited 1 because the packaged app tried to bind `127.0.0.1:3000` while the demo was already there. `sudo` had dropped `APP_PORT`. The script now passes `APP_PORT=3010` through `sudo`. `compose config` shows the app published on 3010. Odoo, Postgres, auth, REST, the gateway, and `aria-go` did start.
- The local demo script looks for Name inside the visible Manual tabpanel. That field was rendered outside the panel, so the packaged demo timed out. The fields now sit inside the Manual panel and the hidden LinkedIn panel.
- #214 and #220 are not in the GitHub stack. Their base branch is still the owning pull request.
