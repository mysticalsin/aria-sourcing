---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-20
status: quick-stats port on twa-odoo
---

# Handoff - Shift 469

## Current state

- Branch `cursor/tony-quick-stats-9bce`, based on `twa-odoo` (`e3fa3f59`). Not merged.
- Red-first commit: `e8a4df86` (`test(processing): red-first checks for Tony's quick stats`). The implementation commit follows it.
- Command Center quick stats are the six sourcing counts from `src/lib/quick-stats.ts`, rendered with Tony's unchanged `MetricCard`.
- Pipeline (`/funnel`), explainable candidate card, outreach composer, and channel picker use the same card, eyebrow, and tokens. HeyReach and the LinkedIn token render Off. Assisted Recruiter InMail is the default and has Mark sent.
- Tokens in `tailwind.config.ts` and `src/styles/globals.css` were already Tony's (paper 270 40% 98%, canvas 270 30% 96%, ink #1A0033, tangerine 275 100% 43%, electric 275 100% 34%, Mantu yellow 57 92% 67%). No second token set was added. PR #173 was not reused.
- Screenshots, synthetic only: `docs/screenshots/command-center-quick-stats.png`, `pipeline-stages.png`, `outreach-composer.png`, `channel-picker.png`, `processing-flow.gif`. Tony's source frame is `docs/screenshots/01-console.png` (from `main` @ `b5480986`).
- This environment could not open a verified demo workspace (`Loading demo workspace`), so the live shell was not screenshotted. The images are the same components the pages mount.

## Done this shift

- Ported the quick-stat Command Center and the processing-flow screens onto `twa-odoo`.
- Selectors cover zero, 10,000, and a missing collection. Channel catalog defaults HeyReach and the LinkedIn token to off.
- Playwright + axe (retries 0) for Command Center, pipeline, composer, and channel picker.

## Blockers

- None in the code. Codex review is unavailable (quota).

## Next steps

1. Wait for the PR checks on this branch. Do not merge.
2. Do not revive PR #173. Do not start a second token set.
3. A later change can turn HeyReach or the LinkedIn token on. That is an admin flag, not a default, and it is not this PR.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: "Keep Aria on twa-odoo". The dark design system in PR #173 is rejected as AI slop and is on hold. Build on `main` @ `b5480986`: MetricCard, the six-card Command Center, and the tokens above.
- Assisted Recruiter InMail is the default channel and is a manual send (Mark sent). Email is on. HeyReach is off. The LinkedIn token is off, admin only, and shows the ban-risk notice.
- Approving the exact text does not deliver a LinkedIn message. Mark sent records a send the person already made.
- Prior owner decisions through shift 468 stay in force. They are in `_relay/archive/2026-11-20-2357-cursor.md`. Do not relitigate them.

## Watch out

- Do not edit `src/lib/store/**` for this design. The pages pass store slices into the selectors.
- `src/lib/pipeline.ts` still uses the older column names. `/funnel` shows the processing stages first. The older campaign matrix is behind the "Campaign columns" disclosure.
- `exactTextDigest` must stay byte-for-byte with `approvalHash`. It does not import `node:crypto`, so the composer can render it.
- The visual test launches system Chrome, then Playwright's Chromium, and installs Chromium only if both launches fail. Retries are 0.
- Full-history gitleaks on 2026-11-21 flagged six historical false positives (test MAC, synthetic Odoo idempotency keys, the `linkedinPublicId` identifier). Exact fingerprints are in `.gitleaksignore`. Do not widen the rules.
- `agents` keeps a temporary process-alive healthcheck (`process.kill(1,0)`), the same block as the other open PRs. #168 deletes the service. Acceptance does not scale it to 0.
- The acceptance script fills the visible Manual-tab Name field (`filter({ visible: true })`), the same as PR #172.
- Do not touch `mbe-*` or `main`. Do not force-push.
