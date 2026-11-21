# Testing

Aria's design changes are proven red-first, then by the repository gate, then by the journey and stress runs that exist on the integration branch. That integration branch is **in review** (#208) and is a test vehicle. It is not on `twa-odoo`, and it stays unmerged.

## Red-first policy

A behavior change starts as a failing contract.

1. Add the test that names the rule. Run it. It fails for the reason the rule is missing.
2. Add the product change that makes that same command pass.
3. Leave the reviewed head on the passing commit. The failing commit stays in history as the red point.

Docs-only changes have no runtime contract. Their check is the link scan below, plus the repository gate, which still has to pass for the files this branch shares with `twa-odoo`.

The open pull requests that introduced the ledger, the QC gate, the fairness audit, the interviewer adapter, and the cap hardening each record a red commit before the fix. New work on those surfaces keeps that order.

## Repository gate

On `twa-odoo` the source gate is:

```bash
npm run typecheck && npm run typecheck:tests && npm test
```

Continuous integration on every branch runs that gate inside the Quality job, and also runs lint, the production build, the dependency audit, the secret scan, the database security jobs, and the local Docker demo. The workflow file is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). The release gate fails unless every one of those jobs succeeds.

The last CI run on `twa-odoo` itself (run 44824720933, at the commit this design set is based on) failed the secret scan and the local Docker demo. Quality, the dependency audit, and database security succeeded. A docs-only branch inherits those two failures until they are fixed on their own changes. This design set does not change application code.

In-review modules add their own jobs on their own branches: Rust (`cargo test --locked` is the follow-up in #206), the Go services, the model router, CV ingest, the Odoo addon, the channel adapters, and the QC package. Those workflows are not on `twa-odoo`.

## End-to-end journeys

`scripts/integration-e2e.sh` exists only on the integration branch (#208). The click run recorded there used synthetic data. Three steps passed and ten failed.

| Journey | Recorded result | What the run showed |
| --- | --- | --- |
| Create a need | pass | A sample brief became a campaign titled "Synthetic platform role". |
| Source and import a synthetic candidate | fail | The manual dialog accepted a synthetic person and consent. The list stayed empty. CV ingest is a Go worker on #174, not this screen. |
| Ranking with reasons | fail | There was no imported person to open. |
| Draft outreach | pass | The outreach queue and the draft-follow-up controls rendered. |
| Manual exact-text approval | fail | The Approve control stayed disabled, so the click never landed. |
| Send to a fake sink | fail | No send control called the loopback route. Sink calls were 0. |
| Auto mode blocked until QC | fail | The queue did not show a manual/automatic control. |
| HeyReach off, then on against a fake server | fail | The queue did not show HeyReach. The picker is mounted on the message card, which the journey could not open. |
| LinkedIn token off by default | fail | The copy said the channel is off. The session was a member, and the channel route returned 403. No switch was offered. |
| Kill switch | fail | The member session was not offered the switch. |
| Odoo pipeline and Hired gate | fail | The Next.js shell has no Odoo screen. The Hired gate was raced in stress case A5 instead. |
| Quick stats match the data | pass for labels | All six labels rendered. A first-run modal covered the numbers, so the values were not compared with the rows. |
| Opt-out and erasure | fail | Those actions live on the Odoo addon (#176). The Next.js surface did not show them. |

## Stress scenarios

The same integration branch records eight stress cases. They ran against loopback fakes, not against a live provider.

| Case | Recorded result | What it held |
| --- | --- | --- |
| A1 daily cap | pass | Database cap and email cap, 20 workers, 500 attempts, cap 50. Exactly 50 were accepted. |
| A2 kill switch | pass | Queued sends stopped after the switch, including a restarted process. A send that had already passed the check can finish. |
| A3 auto-pause | pass | An account warning paused the sender. Further sends did not call the stub. No human resume is implemented, so the sender stayed paused. |
| A4 replay | pass | 100 concurrent uses of one token produced one delivery. An expired token and an edited body were refused. |
| A5 Hired gate | mixed | 200 concurrent Hired writes from `to_rate` hired nobody. With a contract and a DNA pass, the applicant reached `hired`. After that, the in-memory service still stored outreach touches. That gap is open on #171. |
| A6 burst | pass | 1000 events were accepted, 100 duplicates added no rows, and 25 malformed bodies were refused. |
| A7 token expire, revoke, and log scrub | pass | An expired approval was refused. Revoke refused the next send. The fixture token was absent from the log. No refresh call exists, so a refresh race was not issued. |
| A8 soak | pass | A 30-minute run finished with the memory gate intact. Bodies were discarded so the measurement is the channel process. |

## How to run the integration script

The script is not on `twa-odoo`. Check out the integration branch (#208) to run it. From that tree, on Linux:

```bash
bash scripts/integration-e2e.sh
```

The script brings up the compose stack, runs the Playwright journey headed under a virtual framebuffer when `xvfb-run` is available, then runs `stress/run.sh`. Artifacts land in `e2e-artifacts/<timestamp>/`, including `summary.json` and `SHA256SUMS`.

The companion Mac script on the same branch is `scripts/integration-e2e-mac.sh`. It expects Node 22, Docker, and a Playwright browser that is already installed. It does not download a browser.

Stress only, on that same branch:

```bash
bash stress/run.sh
```

`STRESS_SOAK_SECONDS=1800` is the 30-minute soak. A smaller value is a smoke run.

The recorded sweep also noted that the packaged stack did not finish coming up in that environment: the Odoo database connection timed out, and the CV ingest image failed to build. The click path then used a local Next.js process. Those limits are part of the open testing work, not a claim that the script is green.

## Docs link check

Base CI does not link-check Markdown. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) has no link-check job. `tests/README.md` names `tests/docs-truth.mts`, and that file is not on `twa-odoo` and is not in `tests/test-manifest.mjs`, so `npm test` does not run it.

An open pull request (#181) adds `tests/readme-docs.mts`. That contract checks links in the root `README.md` only. It does not scan `docs/aria/`. It is in review.

Until a repo-wide checker is on this branch, the design set keeps its own scan. From the repository root:

```bash
python3 - << 'PY'
import pathlib, re, sys
root = pathlib.Path(".").resolve()
missing = []
for path in sorted(root.glob("docs/aria/*.md")) + [root / "docs/README.md"]:
    text = path.read_text()
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    for m in re.finditer(r"\[[^\]]+\]\(([^)\s]+)", text):
        target = m.group(1).split("#", 1)[0]
        if not target or re.match(r"[a-z][a-z0-9+.-]*:", target):
            continue
        resolved = (path.parent / target).resolve()
        inside = resolved == root or root in resolved.parents
        if not inside or not (resolved.is_file() or resolved.is_dir()):
            missing.append(f"{path}: {target}")
if missing:
    print("\n".join(missing))
    sys.exit(1)
print("docs links ok")
PY
```

Relative links in this set point at files or directories on this branch. Paths that exist only on an open pull request are written as text, not as links, so this scan stays green.

The broader testing map for the console and the database jobs is [the testing guide](../TESTING.md).
