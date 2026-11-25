# Sweep 0 — integration baseline

Head under test: the `integration/aria-all` merge of `twa-odoo` plus PRs #168, #167, #170, #169, #171, #176, #175, #178, #174, #172, #177, in that order. #173 was not merged. Product bugs below were not fixed on this branch.

Click run: Next.js dev on `http://127.0.0.1:3000`, Playwright 1.65.1 headed under xvfb. Screenshots are in `docs/integration/screenshots/`. The script writes a fresh set under `e2e-artifacts/<timestamp>/`.

## Journey matrix

| Step | Result | Screenshot | What happened |
|---|---|---|---|
| Create a need | pass | `docs/integration/screenshots/create-need.png` | Sample brief parsed, title set to "Synthetic platform role", toast "Campaign created". The server log then requested `/campaigns/camp_*_synthetic-platform-role`. |
| Source and import a synthetic candidate | fail | `docs/integration/screenshots/import-candidate.png` | Manual dialog accepts Ada Example, `ada.example@example.test`, and Consent. "Add candidate" does not show "Added Ada Example". The list stays "No candidates yet". CV ingest (#174) is a Go CLI, not this screen. |
| Ranking with reasons | fail | `docs/integration/screenshots/ranking-reasons.png` | No imported person to open. |
| Draft outreach | pass | `docs/integration/screenshots/draft-outreach.png` | `/outreach` shows the queue and "Draft follow-up" controls. |
| Manual exact-text approval | fail | `docs/integration/screenshots/manual-approval.png` | The Approve control stays disabled, so the click never lands. |
| Send to a fake sink | fail | `docs/integration/screenshots/fake-sink-send.png` | No send control called the loopback route. Sink calls = 0. |
| Auto mode blocked until QC | fail | `docs/integration/screenshots/auto-blocked.png` | The outreach queue does not show a manual/auto control. |
| HeyReach off, then on against a fake server | fail | `docs/integration/screenshots/heyreach-off.png` | The queue does not show HeyReach. The picker is mounted on the message card (`src/components/dashboard/channel-picker.tsx`), which this journey could not open. |
| LinkedIn token off by default, admin enable, fake token, OFF purges | fail | `docs/integration/screenshots/linkedin-token.png` | Copy says the channel is off. The session is "member". `GET /api/channels/linkedin-token?workspaceId=synthetic-workspace` returned 403. No switch and no kill-switch button. |
| Kill switch | fail | `docs/integration/screenshots/kill-switch.png` | Same page. The member session is not offered the switch. |
| Odoo pipeline and Hired gate | fail | `docs/integration/screenshots/odoo-pipeline.png` | The Next shell has no Odoo screen. The Hired gate was raced in stress A5 instead. |
| Quick stats match the data | pass (labels) | `docs/integration/screenshots/quick-stats.png` | All six labels render: Candidates to rate, In assessment, Interviews this week, Outreach awaiting approval, Replies, Hires. A first-run modal covers the numbers, so the click run did not compare each value to the rows underneath. |
| GDPR opt-out and erasure | fail | `docs/integration/screenshots/gdpr.png` | No opt-out or erasure control on the Next surface. Those actions live in the Odoo addon (#176). |

Counts: 3 pass, 10 fail, 13 steps.

## Stress

| Case | Result | Repro |
|---|---|---|
| A1 Postgres daily cap | PASS | `consume_outreach_channel_daily_cap` on loopback Postgres, N=50, 20 workers, 500 attempts. sent=50, refused=450, reason `channel-cap`. SQL is `stress/sql/daily-cap.sql`, the same statement as migration `0013`. |
| A1 per-channel cap | PASS | `Email.Send` with `ARIA_EMAIL_SENDER_DAILY_CAP=50`, 20 workers, 500 distinct approvals. Exactly 50 mails. Other refusals are `daily-cap`. |
| A2 kill switch | PASS | 500 queued sends blocked in the sink, switch set to `1`, 2s wait, then 20 new sends. Those 20 are `kill-switch`. A re-exec with `ARIA_SEND_KILL_SWITCH=1` still refuses. In-flight sends that had already passed the check can finish; that is when `authorize` reads the switch. |
| A3 auto-pause | PASS | HeyReach loopback stub returns `account_warning`. The next sends are `sender-paused` and the stub is not called again. There is no resume method, so a later send on the same pause store stays paused. |
| A4 approval replay | PASS | 100 concurrent sends of one token: 1 mail. A token older than its lifetime returns `approval-expired`. An edited body is refused. |
| A5 hired gate | FAIL | 200 concurrent `hired` writes from `to_rate` hired nobody. With a contract and DNA the applicant does reach `hired`. After that commit, `LogTouch` still accepts an email message. The race recorded 1000 such touches. |
| A6 channel burst | PASS | 1000 events plus 100 duplicates plus 25 malformed bodies on a loopback handler in front of `Email.Send`. 1000 accepted, 100 duplicates added no rows, 25 returned 400. Finished inside 10s. |
| A7 LinkedIn token | PASS | Loopback transport. 20 approvals and 20 deliveries, one delivery each. An expired approval is refused. Revoke leaves the next send refused and does not add a delivery. The fixture token is not in the logger file. There is no refresh RPC, so there is no refresh stampede to count. |
| A8 soak | PASS | `STRESS_SOAK_SECONDS=1800`. `go test` reported `ok` at 1800.023s. RSS after warm-up stayed inside the 10% gate (the test fails otherwise). The mailer and auditor discard bodies so the measurement is the channel process, not the harness log. |

## Findings

1. **Severity: correctness.** After Hired, an outreach touch is still stored. **Repro:** A5, `TestStressA5HiredGate`, 20 rounds, contract plus DNA, then `LogTouch` of kind `message` on channel `email`. 1000 touches returned success. **Owning PR:** #171. **File:** `services/internal/odoo/fake.go` (`LogTouch`) and `services/internal/recruit/service.go` (`LogTouch` does not consult the stage).
2. **Severity: spec-mismatch.** The campaign UI does not confirm a manual candidate add. **Repro:** fill Manual name, email, and Consent, click Add candidate. The dialog stays open and "No candidates yet" remains (`docs/integration/screenshots/import-candidate.png`). **Owning PR:** #172 for the console split; the add action itself is still the workspace store. **File:** `src/components/candidates/add-candidate-dialog.tsx`.
3. **Severity: spec-mismatch.** CV ingest is not on that screen. **Repro:** the journey has no upload control. **Owning PR:** #174. **File:** `services/ingest/cmd/ingest/main.go` (CLI only).
4. **Severity: spec-mismatch.** Approve stays disabled and nothing calls a send route. **Repro:** `/outreach`, sink calls 0. **Owning PR:** #172. **File:** `src/app/outreach/page.tsx` and `src/components/outreach/outreach-message-card.tsx`.
5. **Severity: spec-mismatch.** HeyReach off/on is not on the queue the journey can open. **Repro:** `/outreach` body has no HeyReach row. The picker exists on the card. **Owning PR:** #177. **File:** `src/components/dashboard/channel-picker.tsx`.
6. **Severity: spec-mismatch.** A member session cannot open the token switch. **Repro:** `GET /api/channels/linkedin-token?workspaceId=synthetic-workspace` is 403. Screenshot shows "Only an owner or an admin can view this channel." **Owning PR:** #178. **File:** `src/channels/linkedin-token/handlers.ts`.
7. **Severity: spec-mismatch.** Odoo stages, Hired, opt-out, and erasure are not in the Next shell. **Repro:** no Odoo link and no GDPR control from Home. **Owning PR:** #176. **File:** `odoo_addons/aria_recruitment/` (the gate is in the addon; the shell does not navigate there).
8. **Severity: test-gap.** Quick-stat labels render under a first-run modal, so the click run did not check the numbers against the rows. **Owning PR:** #177. **File:** `src/app/page.tsx`.
9. **Severity: correctness.** A paused HeyReach sender cannot be resumed by a human action. `PauseStore` has `Pause` and `Paused` only. **Repro:** A3, a second adapter sharing the pause store is still `sender-paused`. **Owning PR:** #175. **File:** `services/channels/store.go`.
10. **Severity: spec-mismatch.** The token channel has no refresh call, so a refresh race cannot be issued. Expire, revoke, and the log scrub do hold (A7). **Owning PR:** #178. **File:** `src/channels/linkedin-token/channel.ts`.
11. **Severity: correctness.** A new campaign requests `GET /api/sourcing-learning/feedback` and the dev server answers 503. **Repro:** next dev log for `camp_*_synthetic-platform-role`. **Owning PR:** `twa-odoo` (the route is not added by these PRs). **File:** `src/app/api/sourcing-learning/feedback/route.ts`.
12. **Severity: correctness.** `services/ingest/Dockerfile` does not build. **Repro:** `docker compose up --build` fails in the ingest stage with `poppler-utils` depending on `libpoppler126 (= 22.12.0-2+deb12u2)` while `22.12.0-2+deb12u3` is the candidate. **Owning PR:** #174. **File:** `services/ingest/Dockerfile`. The integration overlay does not build that image, so the rest of the stack can still start.

## Commands

`docker compose -p aria-int-sweep -f docker-compose.yml -f e2e/integration/compose.overlay.yml up -d --build` built the app image and started containers under the memory caps (about 4.6 GiB reserved, under 6 GiB). `aria-go` became healthy on `127.0.0.1:8080` inside its container. Postgres for Supabase and for Odoo reported healthy. Odoo then exited: `connection to server at "odoo-db" port 5432 failed: Connection timed out`. `db-init` stayed up and unhealthy because the Postgres image healthcheck probes `localhost:5432` inside a client container. Auth, REST, the gateway, and the app container were created and not started. That cross-container timeout is what this VM's Docker network did; it is recorded here and was not patched in product code.

Linux box:

```bash
bash scripts/integration-e2e.sh
```

That writes `e2e-artifacts/<timestamp>/summary.json` and `SHA256SUMS`. Playwright is headed under `xvfb-run`. The compose overlay caps the stack at about 4.6 GiB, under 6 GiB.

Mac:

```bash
bash scripts/integration-e2e-mac.sh
```

Requires Node 22, Docker Desktop, and Playwright 1.65.1 Chromium `chromium-1255` already installed (`PLAYWRIGHT_BROWSERS_PATH`, default `~/qa-tools/playwright/browsers`). It does not download a browser. Same artifact path.

Stress only:

```bash
bash stress/run.sh
```

`STRESS_SOAK_SECONDS=1800` is the 30 minute soak. Set it to a smaller number only for a smoke run.
